import asyncio
import csv
import io
import logging
import re
import secrets
import subprocess
from contextlib import asynccontextmanager

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

import config
from models import (
    BridgeResponse,
    DeviceRegistration,
    DeviceResult,
    GatewayListResponse,
    GatewayRegisterRequest,
    GatewayRegisterResponse,
    GatewayRegistration,
    GatewayResult,
    PoolDevice,
    PoolResponse,
    RegisterRequest,
    RegisterResponse,
)
from tb_api import get_pool_devices, get_tb_token, register_device_tb
from tts_api import list_gateways_tts, register_device_tts, register_gateway_tts

logging.basicConfig(level=config.LOG_LEVEL, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http_client = httpx.AsyncClient(timeout=30.0)
    try:
        app.state.tb_token = await get_tb_token(app.state.http_client)
        logger.info("TB authenticated successfully")
    except Exception as e:
        logger.warning("TB auth failed at startup (will retry on request): %s", e)
        app.state.tb_token = None
    yield
    await app.state.http_client.aclose()


app = FastAPI(title="SignConnect Register Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def ensure_tb_token() -> str:
    """Get cached TB token, re-authenticate if missing."""
    if not app.state.tb_token:
        app.state.tb_token = await get_tb_token(app.state.http_client)
    return app.state.tb_token


async def process_single_device(device: DeviceRegistration, client: httpx.AsyncClient, tb_token: str) -> DeviceResult:
    """Register one device in TTS and TB."""
    # Auto-generate app_key if not provided
    if not device.app_key:
        device.app_key = secrets.token_hex(16).upper()

    tts_ok = False
    tb_ok = False
    tb_access_token = None
    error = None

    # Register in TTS
    tts_result = await register_device_tts(device, client)
    if tts_result["success"]:
        tts_ok = True
    else:
        error = tts_result["error"]

    # Register in TB (regardless of TTS result)
    tb_result = await register_device_tb(device.device_name, device.dev_eui, device.join_eui, client, tb_token)
    if tb_result.get("reauth"):
        # Re-authenticate and retry once
        try:
            tb_token = await get_tb_token(client)
            app.state.tb_token = tb_token
            tb_result = await register_device_tb(device.device_name, device.dev_eui, device.join_eui, client, tb_token)
        except Exception as e:
            tb_result = {"success": False, "error": f"TB reauth failed: {e}"}

    if tb_result["success"]:
        tb_ok = True
        tb_access_token = tb_result.get("access_token")
    else:
        tb_error = tb_result.get("error", "Unknown TB error")
        error = f"{error}; {tb_error}" if error else tb_error

    status = "success" if (tts_ok and tb_ok) else "failed"

    return DeviceResult(
        device_name=device.device_name,
        dev_eui=device.dev_eui,
        status=status,
        tts_registered=tts_ok,
        tb_registered=tb_ok,
        tb_access_token=tb_access_token,
        error=error,
    )


async def register_devices(devices: list[DeviceRegistration]) -> RegisterResponse:
    """Register multiple devices concurrently."""
    client = app.state.http_client
    tb_token = await ensure_tb_token()

    tasks = [process_single_device(dev, client, tb_token) for dev in devices]
    results = await asyncio.gather(*tasks)

    succeeded = sum(1 for r in results if r.status == "success")
    failed = sum(1 for r in results if r.status == "failed")
    any_tts = any(r.tts_registered for r in results)

    return RegisterResponse(
        results=list(results),
        summary={"total": len(results), "succeeded": succeeded, "failed": failed},
        bridge_restart_needed=any_tts,
    )


@app.post("/register", response_model=RegisterResponse)
async def register(request: RegisterRequest):
    """Register devices in TTS and ThingsBoard."""
    if not request.devices:
        raise HTTPException(status_code=400, detail="No devices provided")
    logger.info("Registering %d device(s)", len(request.devices))
    return await register_devices(request.devices)


@app.post("/register/csv", response_model=RegisterResponse)
async def register_csv(file: UploadFile):
    """Register devices from a CSV file."""
    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="CSV must be UTF-8 encoded")

    reader = csv.DictReader(io.StringIO(text))
    devices = []
    for row in reader:
        # Support both 'device_name' and 'device_id' column headers
        name = (row.get("device_name") or row.get("device_id") or "").strip()
        dev_eui = (row.get("dev_eui") or "").strip()
        if not name or not dev_eui:
            raise HTTPException(status_code=400, detail="CSV must have 'device_id' (or 'device_name') and 'dev_eui' columns")
        devices.append(
            DeviceRegistration(
                device_name=name,
                dev_eui=dev_eui,
                join_eui=(row.get("join_eui") or "0000000000000000").strip(),
                app_key=row.get("app_key", "").strip() or None,
            )
        )

    if not devices:
        raise HTTPException(status_code=400, detail="CSV contains no devices")

    logger.info("Registering %d device(s) from CSV", len(devices))
    return await register_devices(devices)


@app.get("/pool", response_model=PoolResponse)
async def pool():
    """Get unassigned (pool) devices from ThingsBoard."""
    client = app.state.http_client
    tb_token = await ensure_tb_token()

    try:
        devices = await get_pool_devices(client, tb_token)
    except httpx.HTTPStatusError:
        # Re-auth and retry
        try:
            tb_token = await get_tb_token(client)
            app.state.tb_token = tb_token
            devices = await get_pool_devices(client, tb_token)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"TB API error: {e}")

    pool_devices = [PoolDevice(**d) for d in devices]
    return PoolResponse(devices=pool_devices, count=len(pool_devices))


@app.post("/bridge/restart", response_model=BridgeResponse)
async def bridge_restart():
    """Restart the TTN-TB bridge service."""
    try:
        result = subprocess.run(
            ["sudo", "systemctl", "restart", config.BRIDGE_SERVICE_NAME],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if result.returncode == 0:
            logger.info("Bridge service restarted")
            return BridgeResponse(status="ok", message=f"{config.BRIDGE_SERVICE_NAME} restarted")
        else:
            logger.error("Bridge restart failed: %s", result.stderr)
            return BridgeResponse(status="error", message=result.stderr.strip())
    except subprocess.TimeoutExpired:
        return BridgeResponse(status="error", message="Restart timed out")
    except Exception as e:
        return BridgeResponse(status="error", message=str(e))


GW_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,34}[a-z0-9]$")
GW_EUI_RE = re.compile(r"^[0-9A-F]{16}$")


async def process_single_gateway(gateway: GatewayRegistration, client: httpx.AsyncClient) -> GatewayResult:
    """Register one gateway in TTS."""
    gw_id = gateway.gateway_id.lower().strip()
    gw_eui = re.sub(r"[^0-9A-Fa-f]", "", gateway.gateway_eui).upper()

    if not GW_EUI_RE.match(gw_eui):
        return GatewayResult(gateway_id=gw_id, eui=gw_eui, success=False, message="EUI must be 16 hex characters")
    if not GW_ID_RE.match(gw_id):
        return GatewayResult(gateway_id=gw_id, eui=gw_eui, success=False, message="ID must be 3-36 chars, lowercase alphanumeric + hyphens, start/end alphanumeric")

    result = await register_gateway_tts(GatewayRegistration(gateway_id=gw_id, gateway_eui=gw_eui), client)
    if result["success"]:
        return GatewayResult(gateway_id=gw_id, eui=gw_eui, success=True, message="Registered + LNS secret set")
    else:
        return GatewayResult(gateway_id=gw_id, eui=gw_eui, success=False, message=result["error"])


@app.post("/api/gateways/register", response_model=GatewayRegisterResponse)
async def register_gateways(request: GatewayRegisterRequest):
    """Register gateways in The Things Stack."""
    if not config.TTS_GATEWAY_LNS_KEY:
        raise HTTPException(status_code=400, detail="TTS_GATEWAY_LNS_KEY not configured")
    if not request.gateways:
        raise HTTPException(status_code=400, detail="No gateways provided")

    logger.info("Registering %d gateway(s)", len(request.gateways))
    client = app.state.http_client

    tasks = [process_single_gateway(gw, client) for gw in request.gateways]
    results = await asyncio.gather(*tasks)

    succeeded = sum(1 for r in results if r.success)
    failed = sum(1 for r in results if not r.success)

    return GatewayRegisterResponse(
        results=list(results),
        summary={"total": len(results), "success": succeeded, "failed": failed},
    )


@app.get("/api/gateways/list", response_model=GatewayListResponse)
async def list_gateways():
    """List gateways from The Things Stack."""
    client = app.state.http_client
    try:
        gateways = await list_gateways_tts(client)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TTS API error: {e}")
    return GatewayListResponse(gateways=gateways, count=len(gateways))


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=config.SERVICE_PORT, reload=True)
