import logging

import httpx

import config
from models import DeviceRegistration

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
                        "join_eui": config.DEFAULT_JOIN_EUI,
                    },
                    "join_server_address": base.replace("https://", ""),
                    "network_server_address": base.replace("https://", ""),
                    "application_server_address": base.replace("https://", ""),
                    "frequency_plan_id": device.frequency_plan,
                    "lorawan_version": device.lorawan_version,
                    "lorawan_phy_version": device.lorawan_phy_version,
                    "supports_join": True,
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
                        "join_eui": config.DEFAULT_JOIN_EUI,
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
                        "join_eui": config.DEFAULT_JOIN_EUI,
                    },
                    "frequency_plan_id": device.frequency_plan,
                    "lorawan_version": device.lorawan_version,
                    "lorawan_phy_version": device.lorawan_phy_version,
                    "supports_join": True,
                },
                "field_mask": {
                    "paths": [
                        "frequency_plan_id",
                        "lorawan_version",
                        "lorawan_phy_version",
                        "supports_join",
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
                        "join_eui": config.DEFAULT_JOIN_EUI,
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
