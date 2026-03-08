from pydantic import BaseModel, Field
from typing import Optional

import config


class DeviceRegistration(BaseModel):
    device_name: str
    dev_eui: str
    app_key: Optional[str] = None
    join_eui: str = "0000000000000000"
    frequency_plan: str = config.DEFAULT_FREQUENCY_PLAN
    lorawan_version: str = config.DEFAULT_LORAWAN_VERSION
    lorawan_phy_version: str = config.DEFAULT_LORAWAN_PHY_VERSION
    supports_class_c: bool = True


class RegisterRequest(BaseModel):
    devices: list[DeviceRegistration]


class DeviceResult(BaseModel):
    device_name: str
    dev_eui: str
    status: str  # "success" or "failed"
    tts_registered: bool = False
    tb_registered: bool = False
    tb_access_token: Optional[str] = None
    error: Optional[str] = None


class RegisterResponse(BaseModel):
    results: list[DeviceResult]
    summary: dict
    bridge_restart_needed: bool


class PoolDevice(BaseModel):
    id: str
    name: str
    dev_eui: Optional[str] = None
    created_time: int
    profile: Optional[str] = None


class PoolResponse(BaseModel):
    devices: list[PoolDevice]
    count: int


class BridgeResponse(BaseModel):
    status: str
    message: str
