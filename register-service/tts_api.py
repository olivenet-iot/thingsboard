import base64
import logging
from urllib.parse import urlparse

import httpx

import config
from models import DeviceRegistration, GatewayRegistration

logger = logging.getLogger(__name__)


async def register_device_tts(device: DeviceRegistration, client: httpx.AsyncClient) -> dict:
    """Register a device in The Things Stack (4-step flow)."""
    headers = {
        "Authorization": f"Bearer {config.TTS_API_KEY}",
        "Content-Type": "application/json",
    }
    app_id = config.TTS_APP_ID
    dev_id = device.device_name.lower().replace(" ", "-")
    dev_eui = device.dev_eui.upper()
    app_key = device.app_key.upper() if device.app_key else ""

    base = config.TTS_BASE_URL

    # Step 1: Identity Server — create end device
    try:
        resp = await client.post(
            f"{base}/api/v3/applications/{app_id}/devices",
            headers=headers,
            json={
                "end_device": {
                    "ids": {
                        "device_id": dev_id,
                        "dev_eui": dev_eui,
                        "join_eui": device.join_eui,
                    },
                    "join_server_address": base.replace("https://", ""),
                    "network_server_address": base.replace("https://", ""),
                    "application_server_address": base.replace("https://", ""),
                    "frequency_plan_id": device.frequency_plan,
                    "lorawan_version": device.lorawan_version,
                    "lorawan_phy_version": device.lorawan_phy_version,
                    "supports_join": True,
                    "supports_class_c": device.supports_class_c,
                },
            },
        )
        if resp.status_code not in (200, 201):
            return {"success": False, "error": f"IS create failed ({resp.status_code}): {resp.text}"}
        logger.info("TTS IS created: %s", dev_id)
    except Exception as e:
        return {"success": False, "error": f"IS create error: {e}"}

    # Step 2: Join Server — set app key
    try:
        resp = await client.put(
            f"{base}/api/v3/js/applications/{app_id}/devices/{dev_id}",
            headers=headers,
            json={
                "end_device": {
                    "ids": {
                        "device_id": dev_id,
                        "dev_eui": dev_eui,
                        "join_eui": device.join_eui,
                    },
                    "root_keys": {
                        "app_key": {"key": app_key},
                    },
                },
                "field_mask": {"paths": ["root_keys.app_key"]},
            },
        )
        if resp.status_code not in (200, 201):
            return {"success": False, "error": f"JS set key failed ({resp.status_code}): {resp.text}"}
        logger.info("TTS JS key set: %s", dev_id)
    except Exception as e:
        return {"success": False, "error": f"JS set key error: {e}"}

    # Step 3: Network Server — register
    try:
        resp = await client.put(
            f"{base}/api/v3/ns/applications/{app_id}/devices/{dev_id}",
            headers=headers,
            json={
                "end_device": {
                    "ids": {
                        "device_id": dev_id,
                        "dev_eui": dev_eui,
                        "join_eui": device.join_eui,
                    },
                    "frequency_plan_id": device.frequency_plan,
                    "lorawan_version": device.lorawan_version,
                    "lorawan_phy_version": device.lorawan_phy_version,
                    "supports_join": True,
                    "supports_class_c": device.supports_class_c,
                    "mac_settings": {
                        "desired_rx1_delay": "RX_DELAY_10"
                    },
                },
                "field_mask": {
                    "paths": [
                        "frequency_plan_id",
                        "lorawan_version",
                        "lorawan_phy_version",
                        "supports_join",
                        "supports_class_c",
                        "mac_settings.desired_rx1_delay",
                    ]
                },
            },
        )
        if resp.status_code not in (200, 201):
            return {"success": False, "error": f"NS register failed ({resp.status_code}): {resp.text}"}
        logger.info("TTS NS registered: %s", dev_id)
    except Exception as e:
        return {"success": False, "error": f"NS register error: {e}"}

    # Step 4: Application Server — register
    try:
        resp = await client.put(
            f"{base}/api/v3/as/applications/{app_id}/devices/{dev_id}",
            headers=headers,
            json={
                "end_device": {
                    "ids": {
                        "device_id": dev_id,
                        "dev_eui": dev_eui,
                        "join_eui": device.join_eui,
                    },
                },
                "field_mask": {"paths": []},
            },
        )
        if resp.status_code not in (200, 201):
            return {"success": False, "error": f"AS register failed ({resp.status_code}): {resp.text}"}
        logger.info("TTS AS registered: %s", dev_id)
    except Exception as e:
        return {"success": False, "error": f"AS register error: {e}"}

    return {"success": True}


async def register_gateway_tts(gateway: GatewayRegistration, client: httpx.AsyncClient) -> dict:
    """Register a gateway in The Things Stack (2-step: create + set LNS secret)."""
    headers = {
        "Authorization": f"Bearer {config.TTS_API_KEY}",
        "Content-Type": "application/json",
    }
    base = config.TTS_BASE_URL
    org_id = config.TTS_ORGANIZATION
    gw_id = gateway.gateway_id.lower()
    gw_eui = gateway.gateway_eui.upper()
    server_address = urlparse(base).hostname

    # Step 1: Create gateway in organization
    try:
        resp = await client.post(
            f"{base}/api/v3/organizations/{org_id}/gateways",
            headers=headers,
            json={
                "gateway": {
                    "ids": {
                        "gateway_id": gw_id,
                        "eui": gw_eui,
                    },
                    "frequency_plan_ids": [config.TTS_GATEWAY_FREQUENCY_PLAN],
                    "gateway_server_address": server_address,
                    "require_authenticated_connection": True,
                    "schedule_downlink_late": False,
                    "enforce_duty_cycle": True,
                    "schedule_anytime_delay": "0.530s",
                    "status_public": False,
                    "location_public": False,
                },
                "collaborator": {
                    "organization_ids": {
                        "organization_id": org_id,
                    },
                },
            },
        )
        if resp.status_code not in (200, 201):
            return {"success": False, "error": f"Gateway create failed ({resp.status_code}): {resp.text}"}
        logger.info("TTS gateway created: %s", gw_id)
    except Exception as e:
        return {"success": False, "error": f"Gateway create error: {e}"}

    # Step 2: Set LNS secret
    try:
        lns_secret_b64 = base64.b64encode(config.TTS_GATEWAY_LNS_KEY.encode()).decode()
        resp = await client.put(
            f"{base}/api/v3/gateways/{gw_id}",
            headers=headers,
            json={
                "gateway": {
                    "ids": {"gateway_id": gw_id},
                    "lbs_lns_secret": {
                        "value": lns_secret_b64,
                    },
                },
                "field_mask": {
                    "paths": ["lbs_lns_secret"],
                },
            },
        )
        if resp.status_code not in (200, 201):
            return {"success": False, "error": f"LNS secret set failed ({resp.status_code}): {resp.text}"}
        logger.info("TTS LNS secret set: %s", gw_id)
    except Exception as e:
        return {"success": False, "error": f"LNS secret error: {e}"}

    return {"success": True}


async def list_gateways_tts(client: httpx.AsyncClient) -> list[dict]:
    """List all gateways in the TTS organization."""
    headers = {
        "Authorization": f"Bearer {config.TTS_API_KEY}",
    }
    base = config.TTS_BASE_URL
    org_id = config.TTS_ORGANIZATION

    resp = await client.get(
        f"{base}/api/v3/organizations/{org_id}/gateways",
        headers=headers,
        params={"field_mask": "ids", "limit": 100, "page": 1},
    )
    resp.raise_for_status()

    data = resp.json()
    gateways = []
    for gw in data.get("gateways", []):
        ids = gw.get("ids", {})
        gateways.append({
            "gateway_id": ids.get("gateway_id", ""),
            "eui": ids.get("eui", ""),
        })
    return gateways
