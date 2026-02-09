# ThingsBoard REST API Reference

Complete REST API reference for ThingsBoard CE v4.4.0-SNAPSHOT. All examples use `${TB_HOST}` and `${TB_TOKEN}` placeholders.

## Base Configuration

- Base URL: `${TB_HOST}` (default: `http://localhost:8080`)
- Auth header: `X-Authorization: Bearer ${TB_TOKEN}`
- Content-Type: `application/json` for all POST/PUT requests
- Credentials file: `/opt/thingsboard/.claude/credentials.env`

---

## 1. Authentication

### Login

```
POST ${TB_HOST}/api/auth/login
```

**IMPORTANT**: The endpoint is `/api/auth/login`, NOT `/api/noauth/login`.

**Request:**
```json
{
  "username": "${TB_USERNAME}",
  "password": "${TB_PASSWORD}"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzUxMiJ9...",
  "refreshToken": "eyJhbGciOiJIUzUxMiJ9..."
}
```

**Notes:**
- Token expires in approximately 15 minutes
- Use the `token` field as `X-Authorization: Bearer {token}`
- Store `refreshToken` for renewal

### Token Refresh

```
POST ${TB_HOST}/api/auth/token
```

**Request:**
```json
{
  "refreshToken": "${REFRESH_TOKEN}"
}
```

**Response:** Same format as login (new token + new refreshToken).

### Get Current User

```
GET ${TB_HOST}/api/auth/user
X-Authorization: Bearer ${TB_TOKEN}
```

**Response:** User object with `id`, `email`, `authority` (TENANT_ADMIN, CUSTOMER_USER, SYS_ADMIN).

---

## 2. Pagination Pattern

All list endpoints use consistent pagination:

```
GET ${TB_HOST}/api/{resource}?pageSize=100&page=0&sortProperty=name&sortOrder=ASC
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| pageSize | int | 10 | Items per page (max 1000) |
| page | int | 0 | Zero-based page number |
| sortProperty | string | createdTime | Sort field |
| sortOrder | string | ASC | ASC or DESC |
| textSearch | string | (none) | Filter by name substring |

**Response envelope:**
```json
{
  "data": [ ... ],
  "totalPages": 5,
  "totalElements": 42,
  "hasNext": true
}
```

To fetch all items, loop while `hasNext` is `true`, incrementing `page`.

---

## 3. Device CRUD

### List Devices (Paginated)

```
GET ${TB_HOST}/api/tenant/devices?pageSize=100&page=0
X-Authorization: Bearer ${TB_TOKEN}
```

**Response:** Paginated list of device objects.

### Get Device by ID

```
GET ${TB_HOST}/api/device/${DEVICE_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

**Response:**
```json
{
  "id": {"entityType": "DEVICE", "id": "${DEVICE_ID}"},
  "name": "my-device",
  "type": "default",
  "label": "My Device",
  "deviceProfileId": {"entityType": "DEVICE_PROFILE", "id": "${PROFILE_ID}"},
  "version": 3,
  "createdTime": 1700000000000,
  "additionalInfo": {}
}
```

### Create Device

```
POST ${TB_HOST}/api/device
X-Authorization: Bearer ${TB_TOKEN}
```

**Request:**
```json
{
  "name": "new-device",
  "type": "default",
  "label": "New Device",
  "deviceProfileId": {"entityType": "DEVICE_PROFILE", "id": "${PROFILE_ID}"}
}
```

**Response:** Full device object with generated `id` and `version: 0`.

### Update Device

Same endpoint as create. Include the full object from GET (with `id` and `version`):

```
POST ${TB_HOST}/api/device
X-Authorization: Bearer ${TB_TOKEN}
```

**Request:** Full device object from GET, with modifications. The `version` field is required for optimistic locking.

### Delete Device

```
DELETE ${TB_HOST}/api/device/${DEVICE_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

**Response:** 200 OK (empty body).

### Get Device Credentials

```
GET ${TB_HOST}/api/device/${DEVICE_ID}/credentials
X-Authorization: Bearer ${TB_TOKEN}
```

**Response:**
```json
{
  "id": {"id": "${CREDENTIAL_ID}"},
  "deviceId": {"entityType": "DEVICE", "id": "${DEVICE_ID}"},
  "credentialsType": "ACCESS_TOKEN",
  "credentialsId": "${ACCESS_TOKEN}",
  "credentialsValue": null
}
```

The `credentialsId` is the device access token used for `POST /api/v1/{TOKEN}/telemetry`.

---

## 4. Dashboard CRUD

### List Dashboards (Paginated)

```
GET ${TB_HOST}/api/tenant/dashboards?pageSize=100&page=0
X-Authorization: Bearer ${TB_TOKEN}
```

### Get Full Dashboard JSON

```
GET ${TB_HOST}/api/dashboard/${DASHBOARD_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

**Response:** Complete dashboard object including `configuration` with widgets, aliases, states, and layout. This is the full JSON needed for programmatic dashboard manipulation.

### Create Dashboard

```
POST ${TB_HOST}/api/dashboard
X-Authorization: Bearer ${TB_TOKEN}
```

**Request:**
```json
{
  "title": "My Dashboard",
  "configuration": {
    "widgets": { ... },
    "entityAliases": { ... },
    "states": { ... },
    "filters": {},
    "timewindow": { ... },
    "settings": { ... }
  }
}
```

See `/opt/thingsboard/.claude/templates/dashboard_skeleton.json` for a complete template.

**Response:** Full dashboard object with generated `id`.

### Update Dashboard

Same endpoint as create. Include `id` and `version` from the GET response.

### Delete Dashboard

```
DELETE ${TB_HOST}/api/dashboard/${DASHBOARD_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

---

## 5. Rule Chain CRUD

### List Rule Chains

```
GET ${TB_HOST}/api/ruleChains?pageSize=100&page=0
X-Authorization: Bearer ${TB_TOKEN}
```

### Get Rule Chain (Header Only)

```
GET ${TB_HOST}/api/ruleChain/${RULE_CHAIN_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

Returns the rule chain header (name, type, root flag) but NOT the nodes/connections.

### Get Rule Chain Metadata (Nodes + Connections)

```
GET ${TB_HOST}/api/ruleChain/${RULE_CHAIN_ID}/metadata
X-Authorization: Bearer ${TB_TOKEN}
```

**Response:**
```json
{
  "ruleChainId": {"entityType": "RULE_CHAIN", "id": "${RULE_CHAIN_ID}"},
  "firstNodeIndex": 0,
  "nodes": [ ... ],
  "connections": [ ... ],
  "ruleChainConnections": null
}
```

### Update Rule Chain Metadata

**CRITICAL**: The endpoint for UPDATING metadata is different from the GET endpoint:

```
POST ${TB_HOST}/api/ruleChain/metadata
X-Authorization: Bearer ${TB_TOKEN}
```

**NOT** `/api/ruleChain/{id}/metadata`. The `ruleChainId` is inside the JSON body.

**Request:** The full metadata object (same structure as the GET response).

### Create Empty Rule Chain

```
POST ${TB_HOST}/api/ruleChain
X-Authorization: Bearer ${TB_TOKEN}
```

**Request:**
```json
{
  "name": "My Rule Chain",
  "type": "CORE",
  "debugMode": false
}
```

**Response:** Rule chain object with generated `id`. Then set metadata via `POST /api/ruleChain/metadata`.

### Set as Root Rule Chain

```
POST ${TB_HOST}/api/ruleChain/${RULE_CHAIN_ID}/root
X-Authorization: Bearer ${TB_TOKEN}
```

### Delete Rule Chain

```
DELETE ${TB_HOST}/api/ruleChain/${RULE_CHAIN_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

---

## 6. Device Profile CRUD

### List Device Profiles

```
GET ${TB_HOST}/api/deviceProfiles?pageSize=100&page=0
X-Authorization: Bearer ${TB_TOKEN}
```

### Get Device Profile by ID

```
GET ${TB_HOST}/api/deviceProfile/${PROFILE_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

### Create or Update Device Profile

Same endpoint for both create and update (PUT-like behavior):

```
POST ${TB_HOST}/api/deviceProfile
X-Authorization: Bearer ${TB_TOKEN}
```

**Request (create):**
```json
{
  "name": "My Profile",
  "type": "DEFAULT",
  "transportType": "DEFAULT",
  "defaultRuleChainId": {"entityType": "RULE_CHAIN", "id": "${RULE_CHAIN_ID}"},
  "profileData": {
    "configuration": {"type": "DEFAULT"},
    "transportConfiguration": {"type": "DEFAULT"},
    "provisionConfiguration": {"type": "DISABLED"},
    "alarms": []
  }
}
```

For update, include `id` and `version` from the GET response.

See [device-profile-guide.md](device-profile-guide.md) for alarm rule configuration details.

---

## 7. Telemetry

### Read Telemetry Keys

```
GET ${TB_HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/keys/timeseries
X-Authorization: Bearer ${TB_TOKEN}
```

**Response:** `["temperature", "humidity", "voltage"]`

### Read Latest Telemetry Values

```
GET ${TB_HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/values/timeseries?keys=temperature,humidity
X-Authorization: Bearer ${TB_TOKEN}
```

**Response:**
```json
{
  "temperature": [{"ts": 1700000000000, "value": "25.5"}],
  "humidity": [{"ts": 1700000000000, "value": "60"}]
}
```

### Read Telemetry with Time Range

```
GET ${TB_HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/values/timeseries?keys=temperature&startTs=1700000000000&endTs=1700003600000&limit=100&agg=NONE
X-Authorization: Bearer ${TB_TOKEN}
```

| Parameter | Description |
|-----------|-------------|
| startTs | Start timestamp (ms since epoch) |
| endTs | End timestamp (ms since epoch) |
| limit | Max data points (default 100) |
| agg | Aggregation: NONE, AVG, MIN, MAX, SUM, COUNT |
| interval | Aggregation interval in ms (required if agg != NONE) |

### Write Telemetry via Device Token

No JWT needed -- uses the device access token directly:

```
POST ${TB_HOST}/api/v1/${DEVICE_TOKEN}/telemetry
Content-Type: application/json
```

**Request (simple):**
```json
{"temperature": 25.5, "humidity": 60}
```

**Request (with timestamp):**
```json
{"ts": 1700000000000, "values": {"temperature": 25.5, "humidity": 60}}
```

### Write Telemetry via JWT (Server-Side)

```
POST ${TB_HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/timeseries/ANY?scope=ANY
X-Authorization: Bearer ${TB_TOKEN}
```

**Request:**
```json
{"temperature": 25.5}
```

---

## 8. Attributes

### Scopes

| Scope | Description | Read By | Write By |
|-------|-------------|---------|----------|
| CLIENT_SCOPE | Device-reported attributes | Server, Device | Device only |
| SERVER_SCOPE | Server-managed attributes | Server, Device | Server only |
| SHARED_SCOPE | Pushed to device on change | Server, Device | Server only |

### Read Attributes

```
GET ${TB_HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/values/attributes/SERVER_SCOPE?keys=dimLevel,status
X-Authorization: Bearer ${TB_TOKEN}
```

**Response:**
```json
[
  {"key": "dimLevel", "value": 75, "lastUpdateTs": 1700000000000},
  {"key": "status", "value": "online", "lastUpdateTs": 1700000000000}
]
```

Replace `SERVER_SCOPE` with `CLIENT_SCOPE` or `SHARED_SCOPE` as needed.

### Read All Attributes (All Scopes)

```
GET ${TB_HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/values/attributes
X-Authorization: Bearer ${TB_TOKEN}
```

### Write Server Attributes

```
POST ${TB_HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/attributes/SERVER_SCOPE
X-Authorization: Bearer ${TB_TOKEN}
Content-Type: application/json
```

**Request:**
```json
{"dimLevel": 75, "status": "configured"}
```

### Write Shared Attributes (Pushes to Device)

```
POST ${TB_HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/attributes/SHARED_SCOPE
X-Authorization: Bearer ${TB_TOKEN}
Content-Type: application/json
```

**Request:**
```json
{"dimLevel": 75}
```

**Note:** Devices subscribed to MQTT topic `v1/devices/me/attributes` receive shared attribute updates automatically.

### Write Client Attributes (via Device Token)

```
POST ${TB_HOST}/api/v1/${DEVICE_TOKEN}/attributes
Content-Type: application/json
```

**Request:**
```json
{"firmwareVersion": "1.2.3"}
```

---

## 9. RPC (Remote Procedure Call)

### One-Way RPC (Server to Device)

```
POST ${TB_HOST}/api/plugins/rpc/oneway/${DEVICE_ID}
X-Authorization: Bearer ${TB_TOKEN}
Content-Type: application/json
```

**Request:**
```json
{
  "method": "setDim",
  "params": {"value": 75},
  "timeout": 5000
}
```

**Response:**
- 200 OK if device is online and acknowledges
- 408 Request Timeout if device is offline (but rule chain still processes the RPC message)

### Two-Way RPC (Server to Device, with Response)

```
POST ${TB_HOST}/api/plugins/rpc/twoway/${DEVICE_ID}
X-Authorization: Bearer ${TB_TOKEN}
Content-Type: application/json
```

**Request:** Same as one-way.
**Response:** Device's response body (JSON).

### RPC Gotchas

1. **408 for offline devices**: One-way RPC returns 408 timeout for offline devices, but the rule chain still processes the RPC message. This means transform nodes and external MQTT nodes will still execute.

2. **Persistent RPC ignored in CE**: Setting `"requestPersistent": true` in the RPC body is silently ignored in ThingsBoard CE 4.4.0. Persistent RPC is a PE-only feature. No RPCs are saved to the database for later delivery.

3. **SET_ATTRIBUTE workaround**: For dashboard widgets controlling offline devices, use `SET_ATTRIBUTE` (SHARED_SCOPE) action type instead of `EXECUTE_RPC`. This returns 200 immediately and the attribute change is picked up when the device reconnects.

4. **Max concurrent sessions**: `ACTORS_MAX_CONCURRENT_SESSION_PER_DEVICE=1` (default). Do not increase to 2 -- it causes RPC to hang with HTTP 000 timeout.

---

## 10. Widget Types

### List Widget Bundles

```
GET ${TB_HOST}/api/widgetsBundles?pageSize=100&page=0
X-Authorization: Bearer ${TB_TOKEN}
```

### Get Widget Type by FQN

```
GET ${TB_HOST}/api/widgetType?fqn=system.cards.value_card
X-Authorization: Bearer ${TB_TOKEN}
```

**Response:** Full widget type definition including default config, descriptor, and resources.

### Get All Widget Types in a Bundle

```
GET ${TB_HOST}/api/widgetTypes?widgetsBundleId=${BUNDLE_ID}&pageSize=100&page=0
X-Authorization: Bearer ${TB_TOKEN}
```

See [widget-catalog.md](widget-catalog.md) for FQN catalog.

---

## 11. Alarms

### List Alarms by Device

```
GET ${TB_HOST}/api/alarm/DEVICE/${DEVICE_ID}?pageSize=100&page=0
X-Authorization: Bearer ${TB_TOKEN}
```

Optional filters: `&status=ACTIVE_UNACK&severity=CRITICAL`

**Status values:** `ACTIVE_UNACK`, `ACTIVE_ACK`, `CLEARED_UNACK`, `CLEARED_ACK`
**Severity values:** `CRITICAL`, `MAJOR`, `MINOR`, `WARNING`, `INDETERMINATE`

### Get Alarm by ID

```
GET ${TB_HOST}/api/alarm/${ALARM_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

### Acknowledge Alarm

```
POST ${TB_HOST}/api/alarm/${ALARM_ID}/ack
X-Authorization: Bearer ${TB_TOKEN}
```

### Clear Alarm

```
POST ${TB_HOST}/api/alarm/${ALARM_ID}/clear
X-Authorization: Bearer ${TB_TOKEN}
```

### Delete Alarm

```
DELETE ${TB_HOST}/api/alarm/${ALARM_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

---

## 12. Error Handling

| Status Code | Meaning | Action |
|-------------|---------|--------|
| 200 | Success | Process response |
| 401 | Unauthorized / Token expired | Re-authenticate with `/api/auth/login` |
| 403 | Forbidden | Check user permissions |
| 404 | Entity not found | Verify entity ID exists |
| 408 | RPC timeout | Device offline; rule chain still processes |
| 409 | Optimistic lock conflict | GET fresh copy, re-apply changes, POST again |
| 500 | Internal server error | Check `docker logs signconnect` |

---

## 13. Optimistic Locking Pattern

ThingsBoard uses a `version` field on all entities for optimistic concurrency control.

### Pattern: GET -> Modify -> POST (Retry on 409)

```python
import requests
import time

def update_entity(url, token, modify_fn, max_retries=3):
    """GET-modify-POST pattern with 409 retry."""
    headers = {"X-Authorization": f"Bearer {token}",
               "Content-Type": "application/json"}

    for attempt in range(max_retries):
        # GET current state
        resp = requests.get(url, headers=headers)
        resp.raise_for_status()
        entity = resp.json()

        # Modify the entity
        entity = modify_fn(entity)

        # POST back
        resp = requests.post(url, json=entity, headers=headers)
        if resp.status_code == 409:
            print(f"409 conflict, retry {attempt + 1}/{max_retries}")
            time.sleep(0.5 * (attempt + 1))
            continue
        resp.raise_for_status()
        return resp.json()

    raise Exception("Failed after max retries due to optimistic lock conflicts")
```

### Key Rules

- Always include the `version` field from the GET response in the POST body
- Never cache entities for long periods -- always GET a fresh copy before updating
- On 409, re-GET the entity (with updated version), re-apply your changes, and POST again
- The `version` field auto-increments on each successful update

---

## 14. Batch Operations

### Push Multiple Telemetry Keys at Once

```
POST ${TB_HOST}/api/v1/${DEVICE_TOKEN}/telemetry
Content-Type: application/json
```

```json
[
  {"ts": 1700000000000, "values": {"temperature": 25.5, "humidity": 60}},
  {"ts": 1700000001000, "values": {"temperature": 25.6, "humidity": 59}}
]
```

### Push Telemetry for Multiple Devices (Server-Side)

Use a loop with JWT auth:

```python
for device_id in device_ids:
    requests.post(
        f"{TB_URL}/api/plugins/telemetry/DEVICE/{device_id}/timeseries/ANY?scope=ANY",
        json={"temperature": 25.5},
        headers={"X-Authorization": f"Bearer {token}"}
    )
```

---

## 15. Useful Query Patterns

### Find Device by Name

```
GET ${TB_HOST}/api/tenant/devices?pageSize=1&page=0&textSearch=zenopix-test
X-Authorization: Bearer ${TB_TOKEN}
```

### Find Dashboard by Title

```
GET ${TB_HOST}/api/tenant/dashboards?pageSize=1&page=0&textSearch=DALI
X-Authorization: Bearer ${TB_TOKEN}
```

### Get Device Telemetry Keys

```
GET ${TB_HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/keys/timeseries
X-Authorization: Bearer ${TB_TOKEN}
```

### Get Device Attribute Keys

```
GET ${TB_HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/keys/attributes
X-Authorization: Bearer ${TB_TOKEN}
```
