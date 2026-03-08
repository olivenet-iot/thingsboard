import logging
from datetime import datetime

import httpx

import config

logger = logging.getLogger(__name__)

NULL_CUSTOMER_ID = "13814000-1dd2-11b2-8080-808080808080"


async def get_tb_token(client: httpx.AsyncClient) -> str:
    """Authenticate with ThingsBoard and return JWT token."""
    resp = await client.post(
        f"{config.TB_URL}/api/auth/login",
        json={"username": config.TB_USERNAME, "password": config.TB_PASSWORD},
    )
    resp.raise_for_status()
    return resp.json()["token"]


async def register_device_tb(
    device_name: str, dev_eui: str, join_eui: str, client: httpx.AsyncClient, token: str
) -> dict:
    """Create a device in ThingsBoard and save attributes."""
    headers = {"X-Authorization": f"Bearer {token}"}

    # Step 1: Create device (no customer = pool)
    try:
        resp = await client.post(
            f"{config.TB_URL}/api/device",
            headers=headers,
            json={"name": device_name},
        )
        if resp.status_code == 401:
            return {"success": False, "error": "TB auth expired", "reauth": True}
        resp.raise_for_status()
        device = resp.json()
        device_id = device["id"]["id"]
        logger.info("TB device created: %s (%s)", device_name, device_id)
    except httpx.HTTPStatusError as e:
        return {"success": False, "error": f"TB create failed ({e.response.status_code}): {e.response.text}"}
    except Exception as e:
        return {"success": False, "error": f"TB create error: {e}"}

    # Step 2: Get device credentials (access token)
    try:
        resp = await client.get(
            f"{config.TB_URL}/api/device/{device_id}/credentials",
            headers=headers,
        )
        resp.raise_for_status()
        access_token = resp.json()["credentialsId"]
        logger.info("TB credentials retrieved for: %s", device_name)
    except Exception as e:
        return {"success": False, "error": f"TB credentials error: {e}"}

    # Step 3: Save server attributes (dev_eui + registered_at)
    try:
        resp = await client.post(
            f"{config.TB_URL}/api/plugins/telemetry/DEVICE/{device_id}/attributes/SERVER_SCOPE",
            headers=headers,
            json={
                "dev_eui": dev_eui,
                "join_eui": join_eui,
                "registered_at": datetime.utcnow().isoformat(),
            },
        )
        resp.raise_for_status()
        logger.info("TB attributes saved for: %s", device_name)
    except Exception as e:
        logger.warning("TB attributes save failed for %s: %s", device_name, e)

    return {"success": True, "device_id": device_id, "access_token": access_token}


async def get_pool_devices(client: httpx.AsyncClient, token: str) -> list[dict]:
    """Get unassigned (pool) devices from ThingsBoard."""
    headers = {"X-Authorization": f"Bearer {token}"}

    resp = await client.get(
        f"{config.TB_URL}/api/tenant/devices",
        headers=headers,
        params={"pageSize": 1000, "page": 0},
    )
    if resp.status_code == 401:
        raise httpx.HTTPStatusError("TB auth expired", request=resp.request, response=resp)
    resp.raise_for_status()

    all_devices = resp.json().get("data", [])
    pool_devices = []

    for dev in all_devices:
        customer_id = dev.get("customerId", {}).get("id", "")
        if customer_id == NULL_CUSTOMER_ID:
            device_id = dev["id"]["id"]
            # Fetch server attributes for dev_eui
            dev_eui = None
            try:
                attr_resp = await client.get(
                    f"{config.TB_URL}/api/plugins/telemetry/DEVICE/{device_id}/values/attributes/SERVER_SCOPE",
                    headers=headers,
                    params={"keys": "dev_eui"},
                )
                if attr_resp.status_code == 200:
                    attrs = attr_resp.json()
                    for attr in attrs:
                        if attr.get("key") == "dev_eui":
                            dev_eui = attr.get("value")
            except Exception:
                pass

            pool_devices.append({
                "id": device_id,
                "name": dev.get("name", ""),
                "dev_eui": dev_eui,
                "created_time": dev.get("createdTime", 0),
                "profile": dev.get("type", ""),
            })

    return pool_devices
