import os
from dotenv import load_dotenv

load_dotenv()

# ThingsBoard connection
TB_URL = os.getenv("TB_URL", "http://localhost:8080")
TB_USERNAME = os.getenv("TB_USERNAME", "tenant@thingsboard.org")
TB_PASSWORD = os.getenv("TB_PASSWORD", "tenant")

# The Things Stack connection
TTS_BASE_URL = os.getenv("TTS_BASE_URL", "https://eu1.cloud.thethings.network")
TTS_APP_ID = os.getenv("TTS_APP_ID", "")
TTS_API_KEY = os.getenv("TTS_API_KEY", "")

# LoRaWAN defaults
DEFAULT_FREQUENCY_PLAN = os.getenv("DEFAULT_FREQUENCY_PLAN", "EU_863_870")
DEFAULT_LORAWAN_VERSION = os.getenv("DEFAULT_LORAWAN_VERSION", "MAC_V1_0_4")
DEFAULT_LORAWAN_PHY_VERSION = os.getenv("DEFAULT_LORAWAN_PHY_VERSION", "PHY_V1_0_3_REV_A")
DEFAULT_JOIN_EUI = os.getenv("DEFAULT_JOIN_EUI", "0000000000000000")

# Gateway registration
TTS_ORGANIZATION = os.getenv("TTS_ORGANIZATION", "lumosoft")
TTS_GATEWAY_FREQUENCY_PLAN = os.getenv("TTS_GATEWAY_FREQUENCY_PLAN", "EU_863_870_TTN")
TTS_GATEWAY_LNS_KEY = os.getenv("TTS_GATEWAY_LNS_KEY", "")

# Service settings
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "5002"))
BRIDGE_SERVICE_NAME = os.getenv("BRIDGE_SERVICE_NAME", "ttn-tb-bridge")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "https://portal.lumosoft.io,http://localhost:8080").split(",")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
