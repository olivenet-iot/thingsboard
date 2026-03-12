# SignConnect Register Service

A FastAPI microservice that handles dual LoRaWAN device registration — creating devices in both The Things Stack (TTS) and ThingsBoard (TB) in a single API call.

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Source Files](#3-source-files)
4. [Configuration](#4-configuration)
5. [API Endpoints](#5-api-endpoints)
6. [Registration Flow](#6-registration-flow)
7. [Data Models](#7-data-models)
8. [Error Handling](#8-error-handling)
9. [Deployment](#9-deployment)
10. [Operations](#10-operations)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Overview

The register service automates the provisioning of LoRaWAN signs. Without it, an operator would need to manually create each device in TTS (4 separate API calls across Identity Server, Join Server, Network Server, and Application Server) and then separately create the device in ThingsBoard with the correct attributes. This service reduces that to a single POST request.

**Key capabilities:**

- Register one or many devices via JSON or CSV upload
- Auto-generate AppKeys when not provided
- Concurrent registration (all devices processed in parallel)
- Device pool management (list unassigned devices)
- TTN-TB bridge restart trigger
- Automatic TB token refresh on 401

**Tech stack:** Python 3, FastAPI, httpx (async HTTP), uvicorn, pydantic

## 2. Architecture

```
┌─────────────┐         ┌──────────────────┐
│  Frontend   │         │  Register        │
│  or cURL    │────────▶│  Service :5002   │
└─────────────┘         └────┬────────┬────┘
                             │        │
                ┌────────────┘        └────────────┐
                ▼                                  ▼
  ┌──────────────────────┐          ┌──────────────────────┐
  │  The Things Stack    │          │  ThingsBoard :8080   │
  │  (eu1.cloud)         │          │                      │
  │                      │          │  - Create device     │
  │  - Identity Server   │          │  - Get credentials   │
  │  - Join Server       │          │  - Save attributes   │
  │  - Network Server    │          └──────────────────────┘
  │  - Application Server│
  └──────────────────────┘
```

The service sits between the operator and both platforms. It holds credentials for both TTS (API key) and TB (username/password with JWT). A shared `httpx.AsyncClient` (30s timeout) is created at startup and reused for all requests.

## 3. Source Files

All source code lives in `/home/ubuntu/thingsboard/register-service/`.

| File | Lines | Purpose |
|------|-------|---------|
| `main.py` | 222 | FastAPI app, endpoints, CORS, device processing orchestration |
| `config.py` | 27 | Environment variable loading with defaults via `python-dotenv` |
| `models.py` | 54 | Pydantic request/response models |
| `tts_api.py` | 140 | 4-step TTS device registration (IS → JS → NS → AS) |
| `tb_api.py` | 123 | TB device creation, credential retrieval, attribute saving, pool query |
| `requirements.txt` | 5 | Python dependencies: `fastapi`, `uvicorn`, `httpx`, `python-dotenv`, `python-multipart` |
| `.env.example` | 21 | Template environment file with all variables |
| `deploy/register-service.service` | 16 | systemd unit file |

## 4. Configuration

All configuration is via environment variables, loaded from `.env` by `python-dotenv`.

### ThingsBoard Connection

| Variable | Default | Description |
|----------|---------|-------------|
| `TB_URL` | `http://localhost:8080` | ThingsBoard REST API base URL |
| `TB_USERNAME` | `tenant@thingsboard.org` | Tenant admin username for JWT auth |
| `TB_PASSWORD` | `tenant` | Tenant admin password |

### The Things Stack Connection

| Variable | Default | Description |
|----------|---------|-------------|
| `TTS_BASE_URL` | `https://eu1.cloud.thethings.network` | TTS cluster URL |
| `TTS_APP_ID` | *(empty — required)* | TTS application ID |
| `TTS_API_KEY` | *(empty — required)* | TTS API key with device write permissions |

### LoRaWAN Defaults

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_FREQUENCY_PLAN` | `EU_863_870` | Frequency plan for EU operation |
| `DEFAULT_LORAWAN_VERSION` | `MAC_V1_0_4` | LoRaWAN MAC version |
| `DEFAULT_LORAWAN_PHY_VERSION` | `PHY_V1_0_3_REV_A` | LoRaWAN PHY version |
| `DEFAULT_JOIN_EUI` | `0000000000000000` | JoinEUI (all-zeros for most devices) |

### Service Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVICE_PORT` | `5002` | Port the service listens on |
| `BRIDGE_SERVICE_NAME` | `ttn-tb-bridge` | systemd service name for the LoRaWAN bridge |
| `CORS_ORIGINS` | `http://46.225.54.21:8080,http://localhost:8080` | Comma-separated allowed origins |
| `LOG_LEVEL` | `INFO` | Python logging level |

> **Note:** `.env.example` has `DEFAULT_FREQUENCY_PLAN=EU_863_870_TTN` and `DEFAULT_LORAWAN_VERSION=MAC_V1_0_3`, which differ from the code defaults. The `.env` file on the server takes precedence.

## 5. API Endpoints

### POST `/register`

Register one or more devices via JSON.

**Request body:**

```json
{
  "devices": [
    {
      "device_name": "sign-001",
      "dev_eui": "A1B2C3D4E5F60001",
      "app_key": null,
      "join_eui": "0000000000000000",
      "frequency_plan": "EU_863_870",
      "lorawan_version": "MAC_V1_0_4",
      "lorawan_phy_version": "PHY_V1_0_3_REV_A",
      "supports_class_c": true
    }
  ]
}
```

Only `device_name` and `dev_eui` are required. All other fields have defaults.

If `app_key` is null or omitted, a random 128-bit key is auto-generated (`secrets.token_hex(16)`).

**Response (200):**

```json
{
  "results": [
    {
      "device_name": "sign-001",
      "dev_eui": "A1B2C3D4E5F60001",
      "status": "success",
      "tts_registered": true,
      "tb_registered": true,
      "tb_access_token": "ABC123xyz",
      "error": null
    }
  ],
  "summary": {
    "total": 1,
    "succeeded": 1,
    "failed": 0
  },
  "bridge_restart_needed": true
}
```

`bridge_restart_needed` is `true` when any device was successfully registered in TTS (the bridge needs to pick up the new device).

**Errors:**

- `400` — Empty device list: `"No devices provided"`

### POST `/register/csv`

Register devices from a CSV file upload. The CSV must be UTF-8 encoded.

**Required columns:** `device_id` (or `device_name`) and `dev_eui`

**Optional columns:** `join_eui`, `app_key`

**Example CSV:**

```csv
device_id,dev_eui,join_eui,app_key
sign-001,A1B2C3D4E5F60001,0000000000000000,
sign-002,A1B2C3D4E5F60002,0000000000000000,AABBCCDD11223344AABBCCDD11223344
```

**Request:** `multipart/form-data` with field name `file`

```bash
curl -X POST http://localhost:5002/register/csv \
  -F "file=@devices.csv"
```

**Response:** Same `RegisterResponse` format as `/register`.

**Errors:**

- `400` — `"CSV must be UTF-8 encoded"`
- `400` — `"CSV must have 'device_id' (or 'device_name') and 'dev_eui' columns"`
- `400` — `"CSV contains no devices"`

### GET `/pool`

List all unassigned (pool) devices in ThingsBoard. A device is "in the pool" when its `customerId` equals the NULL customer ID (`13814000-1dd2-11b2-8080-808080808080`), meaning it hasn't been assigned to any customer yet.

**Response (200):**

```json
{
  "devices": [
    {
      "id": "a1b2c3d4-...",
      "name": "sign-001",
      "dev_eui": "A1B2C3D4E5F60001",
      "created_time": 1709901234567,
      "profile": "default"
    }
  ],
  "count": 1
}
```

For each pool device, the service makes an additional API call to fetch the `dev_eui` server attribute.

**Errors:**

- `502` — `"TB API error: ..."` (ThingsBoard unreachable or auth failure after retry)

### POST `/bridge/restart`

Restart the TTN-TB bridge systemd service. Requires `sudo` access for `systemctl restart`.

**Response (200):**

```json
{
  "status": "ok",
  "message": "ttn-tb-bridge restarted"
}
```

**Error responses (still 200, check `status` field):**

```json
{"status": "error", "message": "Restart timed out"}
{"status": "error", "message": "<stderr from systemctl>"}
```

The subprocess has a 15-second timeout.

### GET `/health`

Simple liveness probe.

**Response (200):**

```json
{"status": "ok"}
```

## 6. Registration Flow

### TTS Registration (tts_api.py)

The device ID sent to TTS is derived from `device_name`: lowercased with spaces replaced by hyphens (e.g., `"Sign 001"` → `"sign-001"`).

**Step 1 — Identity Server (POST)**

```
POST {TTS_BASE_URL}/api/v3/applications/{app_id}/devices
```

Creates the end device identity with IDs, server addresses, frequency plan, LoRaWAN versions, and Class C support flag. Server addresses (join, network, application) are derived by stripping `https://` from `TTS_BASE_URL`.

**Step 2 — Join Server (PUT)**

```
PUT {TTS_BASE_URL}/api/v3/js/applications/{app_id}/devices/{dev_id}
```

Sets the root AppKey for OTAA join. Uses `field_mask: ["root_keys.app_key"]`.

**Step 3 — Network Server (PUT)**

```
PUT {TTS_BASE_URL}/api/v3/ns/applications/{app_id}/devices/{dev_id}
```

Registers the device with the NS including frequency plan, LoRaWAN versions, join support, Class C support, and MAC settings (`desired_rx1_delay: RX_DELAY_10`).

**Step 4 — Application Server (PUT)**

```
PUT {TTS_BASE_URL}/api/v3/as/applications/{app_id}/devices/{dev_id}
```

Registers the device with the AS. Minimal payload — just the device IDs with an empty field mask.

Each step checks for HTTP 200 or 201. If any step fails, the function returns immediately with the error — subsequent TTS steps are skipped.

### ThingsBoard Registration (tb_api.py)

**Step 1 — Create device (POST)**

```
POST {TB_URL}/api/device
```

Creates the device with just `{"name": device_name}`. No customer assignment — the device goes to the "pool" (null customer).

If the response is 401, it returns `{"reauth": true}` to trigger token refresh in the caller.

**Step 2 — Get credentials (GET)**

```
GET {TB_URL}/api/device/{device_id}/credentials
```

Retrieves the auto-generated access token (`credentialsId`).

**Step 3 — Save server attributes (POST)**

```
POST {TB_URL}/api/plugins/telemetry/DEVICE/{device_id}/attributes/SERVER_SCOPE
```

Saves `dev_eui`, `join_eui`, and `registered_at` (ISO 8601 UTC timestamp) as server-side attributes. If this step fails, it logs a warning but the registration is still considered successful.

### Orchestration (main.py)

When multiple devices are submitted, `register_devices()` creates an `asyncio.gather()` of all device tasks, running them concurrently. Each device is processed independently — one failure doesn't affect others.

The TB token is refreshed lazily: if a 401 is received during device creation, the token is refreshed and the TB registration is retried once.

## 7. Data Models

All models are in `models.py` using Pydantic.

### DeviceRegistration (request input)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `device_name` | `str` | *(required)* | Used as TB device name and TTS device ID (lowercased, hyphenated) |
| `dev_eui` | `str` | *(required)* | 16-hex-char device EUI |
| `app_key` | `Optional[str]` | `None` | Auto-generated if omitted |
| `join_eui` | `str` | `"0000000000000000"` | Usually all-zeros |
| `frequency_plan` | `str` | from `DEFAULT_FREQUENCY_PLAN` | TTS frequency plan ID |
| `lorawan_version` | `str` | from `DEFAULT_LORAWAN_VERSION` | e.g., `MAC_V1_0_4` |
| `lorawan_phy_version` | `str` | from `DEFAULT_LORAWAN_PHY_VERSION` | e.g., `PHY_V1_0_3_REV_A` |
| `supports_class_c` | `bool` | `True` | Enables Class C downlinks |

### DeviceResult (response per device)

| Field | Type | Notes |
|-------|------|-------|
| `device_name` | `str` | Echo of input |
| `dev_eui` | `str` | Echo of input |
| `status` | `str` | `"success"` (both TTS+TB OK) or `"failed"` |
| `tts_registered` | `bool` | TTS registration succeeded |
| `tb_registered` | `bool` | TB registration succeeded |
| `tb_access_token` | `Optional[str]` | TB device access token (for MQTT etc.) |
| `error` | `Optional[str]` | Error message(s), semicolon-separated if both fail |

### RegisterResponse

| Field | Type | Notes |
|-------|------|-------|
| `results` | `list[DeviceResult]` | One entry per device |
| `summary` | `dict` | `{"total": N, "succeeded": N, "failed": N}` |
| `bridge_restart_needed` | `bool` | `true` if any device was registered in TTS |

### PoolDevice / PoolResponse

| Field | Type | Notes |
|-------|------|-------|
| `id` | `str` | TB device UUID |
| `name` | `str` | Device display name |
| `dev_eui` | `Optional[str]` | From server attributes (may be null) |
| `created_time` | `int` | Unix timestamp in milliseconds |
| `profile` | `Optional[str]` | Device type/profile name |

### BridgeResponse

| Field | Type |
|-------|------|
| `status` | `str` — `"ok"` or `"error"` |
| `message` | `str` — success/error details |

## 8. Error Handling

### Per-device independence

Each device in a batch is registered independently. If device A fails at TTS, device B can still succeed at both platforms. The response always contains results for every device.

### TTS errors

TTS registration is a sequential 4-step pipeline. If any step fails, the remaining TTS steps are skipped for that device, but TB registration still proceeds. Error messages include the step name and HTTP status:

- `"IS create failed (409): ..."` — device already exists in TTS
- `"JS set key failed (404): ..."` — IS step didn't complete
- `"NS register failed (500): ..."` — TTS server error
- `"AS register failed (403): ..."` — API key lacks permissions
- `"IS create error: ..."` — network/timeout exception

### TB errors

TB registration also proceeds regardless of TTS outcome. Errors include:

- `"TB auth expired"` — triggers automatic token refresh + retry
- `"TB create failed (409): ..."` — device name already exists
- `"TB reauth failed: ..."` — token refresh itself failed
- `"TB credentials error: ..."` — could not fetch access token
- TB attribute save failure is logged as a warning but does **not** mark the device as failed

### Combined errors

When both TTS and TB fail for the same device, errors are joined with a semicolon:

```
"IS create failed (409): already exists; TB create failed (409): duplicate name"
```

### HTTP status codes returned by the service

| Code | Condition |
|------|-----------|
| `200` | Request processed (check per-device `status` for individual results) |
| `400` | Invalid input (empty device list, bad CSV) |
| `422` | Pydantic validation error (malformed JSON) |
| `502` | TB API unreachable (pool endpoint only) |

## 9. Deployment

### Prerequisites

- Python 3.10+
- System packages: none beyond Python stdlib
- Network access to TTS cloud and ThingsBoard

### Install

```bash
cd /home/ubuntu/thingsboard/register-service

# Create virtual environment (optional but recommended)
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure
cp .env.example .env
# Edit .env with actual TTS_APP_ID, TTS_API_KEY, and TB credentials
```

### systemd Service

The unit file is at `deploy/register-service.service`:

```ini
[Unit]
Description=SignConnect Register Service
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/thingsboard/register-service
EnvironmentFile=/home/ubuntu/thingsboard/register-service/.env
ExecStart=/usr/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 5002
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Install and enable:

```bash
sudo cp deploy/register-service.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable register-service
sudo systemctl start register-service
```

### Bridge restart permissions

The `/bridge/restart` endpoint runs `sudo systemctl restart ttn-tb-bridge`. The `ubuntu` user needs passwordless sudo for this specific command. Add to `/etc/sudoers.d/register-service`:

```
ubuntu ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart ttn-tb-bridge
```

## 10. Operations

### Starting and stopping

```bash
sudo systemctl start register-service
sudo systemctl stop register-service
sudo systemctl restart register-service
sudo systemctl status register-service
```

### Viewing logs

```bash
# Follow live logs
journalctl -u register-service -f

# Last 100 lines
journalctl -u register-service -n 100

# Since today
journalctl -u register-service --since today
```

### Health check

```bash
curl http://localhost:5002/health
# {"status":"ok"}
```

### Interactive API docs

FastAPI auto-generates Swagger UI at `http://localhost:5002/docs` and ReDoc at `http://localhost:5002/redoc`.

### Register a single device

```bash
curl -X POST http://localhost:5002/register \
  -H "Content-Type: application/json" \
  -d '{
    "devices": [{
      "device_name": "sign-042",
      "dev_eui": "A1B2C3D4E5F60042"
    }]
  }'
```

### Register from CSV

```bash
curl -X POST http://localhost:5002/register/csv \
  -F "file=@devices.csv"
```

### List pool devices

```bash
curl http://localhost:5002/pool
```

### Restart the bridge

```bash
curl -X POST http://localhost:5002/bridge/restart
```

### Typical workflow

1. Prepare a CSV with device names and DevEUIs
2. `POST /register/csv` with the file
3. Check response — if `bridge_restart_needed` is `true`:
4. `POST /bridge/restart` to make the bridge pick up new TTS devices
5. Verify devices appear in both TTS console and ThingsBoard UI

## 11. Troubleshooting

### Service won't start

**Symptom:** `systemctl status register-service` shows `failed`

**Check:**
- Is `.env` present? The service reads `EnvironmentFile` — if missing, all env vars use defaults.
- Is port 5002 already in use? `ss -tlnp | grep 5002`
- Check logs: `journalctl -u register-service -n 50`

### TB auth fails at startup

**Symptom:** Log shows `TB auth failed at startup (will retry on request): ...`

**Cause:** ThingsBoard is not yet running or credentials are wrong. The service starts anyway and retries auth on the first request.

**Fix:** Ensure TB is running (`curl http://localhost:8080/api/noauth/oauth2Clients`), then verify `TB_USERNAME` and `TB_PASSWORD` in `.env`.

### TTS registration fails with 403

**Symptom:** `"IS create failed (403): ..."`

**Cause:** TTS API key lacks permissions.

**Fix:** In the TTS console, ensure the API key has `Write devices` permission for the target application.

### TTS registration fails with 409

**Symptom:** `"IS create failed (409): ..."`

**Cause:** A device with that DevEUI or device ID already exists in TTS.

**Fix:** Delete the existing device in TTS first, or use a different `device_name`/`dev_eui`.

### TB registration fails with 401 repeatedly

**Symptom:** `"TB reauth failed: ..."`

**Cause:** TB credentials are wrong or the tenant user is disabled.

**Fix:** Verify credentials: `curl -X POST http://localhost:8080/api/auth/login -H "Content-Type: application/json" -d '{"username":"tenant@thingsboard.org","password":"tenant"}'`

### Pool endpoint returns empty but devices exist

**Symptom:** `GET /pool` returns `{"devices": [], "count": 0}`

**Cause:** All devices are assigned to a customer. Only devices with `customerId` equal to `13814000-1dd2-11b2-8080-808080808080` (the null/unassigned customer) appear in the pool.

**Fix:** This is expected behavior. Unassign the device from its customer in ThingsBoard if it should be in the pool.

### Pool endpoint is slow

**Cause:** The pool endpoint fetches all tenant devices (up to 1000), filters for unassigned ones, then makes one additional API call per pool device to fetch the `dev_eui` attribute.

**Mitigation:** This is a known limitation. For large device counts, consider paginating or caching.

### Bridge restart fails

**Symptom:** `{"status": "error", "message": "... permission denied ..."}`

**Cause:** The `ubuntu` user lacks sudo rights for `systemctl restart`.

**Fix:** Add the sudoers rule as described in [Deployment > Bridge restart permissions](#bridge-restart-permissions).

### CSV upload fails with 400

**Check:**
- File is UTF-8 encoded (not Excel's default encoding)
- Column headers include `device_id` (or `device_name`) and `dev_eui`
- No empty rows where both name and EUI are blank

### Partial success

When some devices succeed and others fail, the response has `status: "failed"` on individual results but the HTTP response is still 200. Check the `summary` field for counts and individual `error` fields for details. TTS and TB registration are independent per device — a device can succeed in TB but fail in TTS (or vice versa).
