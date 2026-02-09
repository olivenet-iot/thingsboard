<!-- Last updated: 2026-02-09 -->
<!-- Sources: TelemetryController.java, AttributeScope.java, Aggregation.java, DataConstants.java, TbMsgType.java -->
<!-- Docs: https://thingsboard.io/docs/user-guide/telemetry/, https://thingsboard.io/docs/user-guide/attributes/, https://thingsboard.io/docs/reference/mqtt-api/ -->

# Telemetry & Attributes Guide

## 1. Telemetry vs Attributes: When to Use Which

**Telemetry** is time-series data. Each data point has a timestamp and value. ThingsBoard stores full history
and supports aggregation (AVG, SUM, MIN, MAX, COUNT). Use for sensor readings, metrics, and anything
that changes over time: temperature, humidity, power consumption, voltage, signal strength.

**Attributes** are key-value metadata. Only the latest value is stored (no history). Use for
semi-static properties: firmware version, serial number, configuration parameters, device location.

Attributes come in three scopes (see section 2), each with different read/write permissions.

### Decision Table

| Need | Use |
|------|-----|
| Historical trends, charts, dashboards | Telemetry |
| Latest state only (no history needed) | Attributes |
| Aggregation (AVG, SUM, MIN, MAX, COUNT) | Telemetry |
| Device configuration pushed from server | Shared Attributes |
| Device-reported metadata (firmware, IP) | Client Attributes |
| Server-side labels, notes, billing info | Server Attributes |
| High-frequency data (>1 msg/sec) | Telemetry |
| Rarely changing properties | Attributes |

### Data Point Structure

Both telemetry and attributes support the same value types: `string`, `boolean`, `long`, `double`, `json`.
Key names should use camelCase (recommended for JavaScript processing in widgets).

---

## 2. Attribute Scopes

Defined in `AttributeScope.java` (`common/data/src/main/java/org/thingsboard/server/common/data/AttributeScope.java`):

```java
public enum AttributeScope {
    CLIENT_SCOPE(1),   // Set by device
    SERVER_SCOPE(2),   // Set by server, invisible to device
    SHARED_SCOPE(3);   // Set by server, readable by device
}
```

Constants in `DataConstants.java`: `CLIENT_SCOPE`, `SERVER_SCOPE`, `SHARED_SCOPE`.

### CLIENT_SCOPE

- **Written by:** Device firmware via MQTT/HTTP/CoAP
- **Read by:** Server (REST API, Rule Engine, Widgets)
- **Device can read:** Yes (device wrote it)
- **Examples:** firmwareVersion, ipAddress, macAddress, currentState
- **Entity types:** Devices only

### SERVER_SCOPE

- **Written by:** Server via REST API or Rule Engine
- **Read by:** Server only (REST API, Rule Engine, Widgets)
- **Device can read:** No
- **Examples:** internalNotes, billingTier, location, floorPlan
- **Entity types:** All (Devices, Assets, Customers, Tenants, Users, etc.)

### SHARED_SCOPE

- **Written by:** Server via REST API or Rule Engine
- **Read by:** Both server and device (device can subscribe to updates)
- **Device can read:** Yes (request or subscribe)
- **Examples:** configThreshold, reportingInterval, targetTemperature
- **Entity types:** Devices only

### Access Control Summary

| Scope | Device Writes | Device Reads | Server Writes | Server Reads |
|-------|:---:|:---:|:---:|:---:|
| CLIENT_SCOPE | Yes | - | No | Yes |
| SERVER_SCOPE | No | No | Yes | Yes |
| SHARED_SCOPE | No | Yes | Yes | Yes |

---

## 3. Telemetry REST API

Base path: `/api/plugins/telemetry` (from `TbUrlConstants.TELEMETRY_URL_PREFIX`).

### Save Telemetry (Server-Side)

```
POST /api/plugins/telemetry/{entityType}/{entityId}/timeseries/{scope}
```

The `scope` path variable is required but not used functionally; pass `ANY`.

**Simple payload** (server assigns current timestamp):
```json
{"temperature": 25.5, "humidity": 70, "status": "OK"}
```

**Payload with timestamp** (milliseconds UTC):
```json
{
  "ts": 1706400000000,
  "values": {"temperature": 25.5, "humidity": 70}
}
```

### Save Telemetry with TTL

```
POST /api/plugins/telemetry/{entityType}/{entityId}/timeseries/{scope}/{ttl}
```

TTL is in seconds. Only effective with Cassandra or TimescaleDB. With PostgreSQL, TTL is managed differently (see section 8).

### Get Latest Telemetry

```
GET /api/plugins/telemetry/{entityType}/{entityId}/values/timeseries?keys=temperature,humidity
```

Omit `keys` to get all latest values. Add `useStrictDataTypes=true` to preserve original types (default returns strings).

**Response:**
```json
{
  "temperature": [{"ts": 1706400000000, "value": "25.5"}],
  "humidity": [{"ts": 1706400000000, "value": "70"}]
}
```

### Get Historical Telemetry (with Aggregation)

```
GET /api/plugins/telemetry/{entityType}/{entityId}/values/timeseries
    ?keys=temperature
    &startTs=1706313600000
    &endTs=1706400000000
    &interval=3600000
    &agg=AVG
    &limit=100
    &orderBy=ASC
    &useStrictDataTypes=true
```

Required params when querying range: `keys`, `startTs`, `endTs`.

### List Telemetry Keys

```
GET /api/plugins/telemetry/{entityType}/{entityId}/keys/timeseries
```

**Response:** `["temperature", "humidity", "voltage"]`

### Delete Telemetry

Delete all data for keys:
```
DELETE /api/plugins/telemetry/{entityType}/{entityId}/timeseries/delete
    ?keys=temperature,humidity
    &deleteAllDataForKeys=true
```

Delete time range:
```
DELETE /api/plugins/telemetry/{entityType}/{entityId}/timeseries/delete
    ?keys=temperature
    &startTs=1706313600000
    &endTs=1706400000000
    &deleteLatest=true
    &rewriteLatestIfDeleted=true
```

- `deleteLatest` (default: true) -- also remove from the latest values table
- `rewriteLatestIfDeleted` (default: false) -- fetch the next most recent value as the new latest

---

## 4. Attributes REST API

### Get Attributes by Scope

```
GET /api/plugins/telemetry/{entityType}/{entityId}/values/attributes/{scope}?keys=key1,key2
```

Scope values: `CLIENT_SCOPE`, `SERVER_SCOPE`, `SHARED_SCOPE`.

### Get Attributes from Any Scope

```
GET /api/plugins/telemetry/{entityType}/{entityId}/values/attributes?keys=key1,key2
```

Omit `keys` to return all attributes. Returns merged results from all scopes.

**Response:**
```json
[
  {"lastUpdateTs": 1706400000000, "key": "firmwareVersion", "value": "1.2.3"},
  {"lastUpdateTs": 1706399000000, "key": "serialNumber", "value": "SN-001"}
]
```

### Save Attributes (Server-Side)

```
POST /api/plugins/telemetry/{entityType}/{entityId}/attributes/{scope}
```

Only `SERVER_SCOPE` and `SHARED_SCOPE` are allowed for server-side writes. Attempting `CLIENT_SCOPE` returns 400 Bad Request.

**Payload:**
```json
{"targetTemperature": 22.0, "reportingInterval": 60, "active": true}
```

Shorthand for devices:
```
POST /api/plugins/telemetry/{deviceId}/{scope}
```

### Delete Attributes

```
DELETE /api/plugins/telemetry/{entityType}/{entityId}/{scope}?keys=key1,key2
```

### List Attribute Keys

All scopes:
```
GET /api/plugins/telemetry/{entityType}/{entityId}/keys/attributes
```

By scope:
```
GET /api/plugins/telemetry/{entityType}/{entityId}/keys/attributes/{scope}
```

**Response:** `["firmwareVersion", "serialNumber", "active"]`

---

## 5. Telemetry Aggregation

Defined in `Aggregation.java` (`common/data/src/main/java/org/thingsboard/server/common/data/kv/Aggregation.java`):

```java
public enum Aggregation { MIN, MAX, AVG, SUM, COUNT, NONE }
```

### Parameters

| Parameter | Description |
|-----------|-------------|
| `agg` | Aggregation function: `MIN`, `MAX`, `AVG`, `SUM`, `COUNT`, `NONE` (default: `NONE`) |
| `interval` | Bucket size in milliseconds (e.g., `3600000` for 1 hour). Required when `agg` is not `NONE` |
| `intervalType` | `MILLISECONDS` (default), `WEEK`, `WEEK_ISO`, `MONTH`, `QUARTER` |
| `timeZone` | Timezone for WEEK/MONTH/QUARTER intervals (e.g., `America/New_York`) |
| `limit` | Max data points returned. Only used when `agg=NONE` (default: `100`) |
| `orderBy` | `ASC` (oldest first) or `DESC` (newest first, default) |
| `useStrictDataTypes` | `true` preserves original types; `false` returns strings (default) |

### How Aggregation Works

Data points within each `interval` bucket are aggregated using the specified function. For example,
with `interval=3600000` and `agg=AVG`, one averaged value is returned per hour.

- `NONE` returns raw data points up to `limit`
- `COUNT` returns the number of data points per interval
- Aggregation is performed server-side (database-level for PostgreSQL/TimescaleDB), more efficient than fetching raw data

---

## 6. MQTT Device API

Devices authenticate with MQTT using Access Token as username (or X.509 certificates).

### Telemetry Upload

**Topic:** `v1/devices/me/telemetry`

Simple (server assigns timestamp):
```json
{"temperature": 25.5, "humidity": 70}
```

With timestamp:
```json
{"ts": 1706400000000, "values": {"temperature": 25.5, "humidity": 70}}
```

Array format (multiple timestamps):
```json
[
  {"ts": 1706400000000, "values": {"temperature": 25.5}},
  {"ts": 1706400060000, "values": {"temperature": 25.7}}
]
```

### Client Attributes Upload

**Topic:** `v1/devices/me/attributes`

```json
{"firmwareVersion": "1.2.3", "ipAddress": "192.168.1.100"}
```

### Request Attributes from Server

**Publish to:** `v1/devices/me/attributes/request/{requestId}`

**Subscribe to:** `v1/devices/me/attributes/response/+`

**Request payload:**
```json
{"clientKeys": "firmwareVersion,ipAddress", "sharedKeys": "targetTemperature,reportingInterval"}
```

**Response (on response topic):**
```json
{
  "client": {"firmwareVersion": "1.2.3", "ipAddress": "192.168.1.100"},
  "shared": {"targetTemperature": 22.0, "reportingInterval": 60}
}
```

### Subscribe to Shared Attribute Updates

**Subscribe to:** `v1/devices/me/attributes`

When the server updates a shared attribute, the device receives:
```json
{"targetTemperature": 23.0}
```

### HTTP Equivalents

| Operation | HTTP Endpoint |
|-----------|---------------|
| Upload telemetry | `POST /api/v1/${ACCESS_TOKEN}/telemetry` |
| Upload client attributes | `POST /api/v1/${ACCESS_TOKEN}/attributes` |
| Request attributes | `GET /api/v1/${ACCESS_TOKEN}/attributes?clientKeys=k1&sharedKeys=k2` |

### CoAP Equivalents

| Operation | CoAP Endpoint |
|-----------|---------------|
| Upload telemetry | `POST coap://${TB_HOST}/api/v1/${ACCESS_TOKEN}/telemetry` |
| Upload client attributes | `POST coap://${TB_HOST}/api/v1/${ACCESS_TOKEN}/attributes` |
| Request attributes | `GET coap://${TB_HOST}/api/v1/${ACCESS_TOKEN}/attributes?clientKeys=k1&sharedKeys=k2` |
| Subscribe to attribute updates | `GET coap://${TB_HOST}/api/v1/${ACCESS_TOKEN}/attributes` (with Observe option) |

---

## 7. WebSocket Subscriptions

### Connection

```
ws://${TB_HOST}/api/ws/plugins/telemetry?token=${JWT_TOKEN}
```

Or authenticate after connecting:
```json
{"authCmd": {"cmdId": 0, "token": "${JWT_TOKEN}"}}
```

Authentication must occur within 10 seconds of connection.

### Subscribe to Attribute Updates

```json
{
  "attrSubCmds": [{
    "entityType": "DEVICE",
    "entityId": "${DEVICE_ID}",
    "scope": "SERVER_SCOPE",
    "cmdId": 1
  }]
}
```

Scope values for attributes: `CLIENT_SCOPE`, `SERVER_SCOPE`, `SHARED_SCOPE`.

### Subscribe to Latest Telemetry

```json
{
  "tsSubCmds": [{
    "entityType": "DEVICE",
    "entityId": "${DEVICE_ID}",
    "scope": "LATEST_TELEMETRY",
    "cmdId": 2,
    "keys": "temperature,humidity"
  }]
}
```

### Historical Telemetry Query via WebSocket

```json
{
  "tsSubCmds": [{
    "entityType": "DEVICE",
    "entityId": "${DEVICE_ID}",
    "scope": "LATEST_TELEMETRY",
    "cmdId": 3,
    "keys": "temperature",
    "startTs": 1706313600000,
    "endTs": 1706400000000,
    "interval": 60000,
    "agg": "AVG"
  }]
}
```

Use `timeWindow` (milliseconds) instead of `startTs`/`endTs` for a rolling window relative to now.

### Unsubscribe

```json
{
  "tsSubCmds": [{"entityType": "DEVICE", "entityId": "${DEVICE_ID}", "cmdId": 2, "unsubscribe": true}]
}
```

### Connection Management

- Server sends periodic pings; client must respond with pong
- Reconnect with exponential backoff on disconnect
- A single WebSocket can manage multiple subscriptions using different `cmdId` values
- `LATEST_TELEMETRY` is used as the scope constant for telemetry subscriptions (see `DataConstants.LATEST_TELEMETRY_SCOPE`)

---

## 8. Data Retention & TTL

### TTL Priority (Highest to Lowest)

1. **Message metadata** `TTL` property (set in rule chain)
2. **Rule node config** -- Save Timeseries node `defaultTTL` field (0 = no TTL)
3. **Tenant Profile** -- `defaultStorageTtlDays` in tenant profile configuration
4. **System-level** -- `SQL_TTL_*` or `TS_KV_TTL` environment variables

TTL is specified in **seconds** at the API level. In TelemetryController, if TTL is 0 and tenant is not system,
the tenant profile's `defaultStorageTtlDays` is used (converted to seconds).

### Database Differences

| Database | TTL Mechanism |
|----------|---------------|
| **PostgreSQL** | Background cleanup job (`sql.ttl.ts.ts_key_value_ttl`). Configurable via `SQL_TTL_*` env vars |
| **Cassandra** | Native TTL support. Set per-record at write time |
| **TimescaleDB** | Hypertable retention policies. More efficient than PostgreSQL for large datasets |

### Manual Cleanup

Use the DELETE timeseries API (section 3) to remove data for specific keys or time ranges.

---

## 9. Rule Chain Integration

### Message Types (from `TbMsgType.java`)

| Message Type | Trigger |
|--------------|---------|
| `POST_TELEMETRY_REQUEST` | Device sends telemetry via MQTT/HTTP/CoAP |
| `POST_ATTRIBUTES_REQUEST` | Device sends client attributes |
| `ATTRIBUTES_UPDATED` | Server/shared attributes changed via REST API |
| `ATTRIBUTES_DELETED` | Attributes deleted via REST API |
| `TIMESERIES_UPDATED` | Telemetry saved via REST API |
| `TIMESERIES_DELETED` | Telemetry deleted via REST API |

### Key Rule Nodes

**Save Timeseries** (`TbMsgTimeseriesNode`)
- Saves incoming telemetry to the database
- Config: `defaultTTL` (seconds, 0 = use tenant profile), `skipLatestPersistence`, `useServerTs`
- Input: `POST_TELEMETRY_REQUEST` messages

**Save Attributes** (`TbMsgAttributesNode`)
- Saves incoming client attributes to the database
- Config: `scope` (usually CLIENT_SCOPE for device-originated), `notifyDevice`
- Input: `POST_ATTRIBUTES_REQUEST` messages

**Enrichment: Get Attributes** (`TbGetAttributesNode`)
- Fetches attributes and adds them to message metadata
- Config: select which scopes and keys to fetch (client, server, shared)
- Useful for adding device config to telemetry messages before processing

**Enrichment: Get Telemetry** (`TbGetTelemetryNode`)
- Fetches latest or historical telemetry into message metadata
- Config: keys, fetch mode (LATEST or time range), aggregation, limit, order

### Typical Flow

```
Device Telemetry --> POST_TELEMETRY_REQUEST
  --> [Message Type Switch]
  --> [Save Timeseries]
  --> [Rule Chain Logic / Alarms / Notifications]
```

```
Device Attributes --> POST_ATTRIBUTES_REQUEST
  --> [Message Type Switch]
  --> [Save Attributes]
  --> [Rule Chain Logic]
```

---

## 10. Python Examples

### Save Telemetry via REST API

```python
import requests

TB_HOST = "${TB_HOST}"
TB_TOKEN = "${TB_TOKEN}"  # JWT token from /api/auth/login
DEVICE_ID = "${DEVICE_ID}"

url = f"http://{TB_HOST}/api/plugins/telemetry/DEVICE/{DEVICE_ID}/timeseries/ANY"
headers = {"Content-Type": "application/json", "X-Authorization": f"Bearer {TB_TOKEN}"}

payload = {"temperature": 25.5, "humidity": 70}
resp = requests.post(url, json=payload, headers=headers)
print(resp.status_code)  # 200
```

### Get Historical Telemetry with Aggregation

```python
import requests

url = f"http://{TB_HOST}/api/plugins/telemetry/DEVICE/{DEVICE_ID}/values/timeseries"
params = {
    "keys": "temperature",
    "startTs": 1706313600000,
    "endTs": 1706400000000,
    "interval": 3600000,
    "agg": "AVG",
    "limit": 100,
    "orderBy": "ASC",
    "useStrictDataTypes": "true"
}
headers = {"X-Authorization": f"Bearer {TB_TOKEN}"}

resp = requests.get(url, params=params, headers=headers)
data = resp.json()
# {"temperature": [{"ts": 1706313600000, "value": 24.8}, ...]}
```

### Save and Get Attributes

```python
import requests

headers = {"Content-Type": "application/json", "X-Authorization": f"Bearer {TB_TOKEN}"}

# Save shared attributes
url = f"http://{TB_HOST}/api/plugins/telemetry/DEVICE/{DEVICE_ID}/attributes/SHARED_SCOPE"
payload = {"targetTemperature": 22.0, "reportingInterval": 60}
requests.post(url, json=payload, headers=headers)

# Get shared attributes
url = f"http://{TB_HOST}/api/plugins/telemetry/DEVICE/{DEVICE_ID}/values/attributes/SHARED_SCOPE"
resp = requests.get(url, params={"keys": "targetTemperature,reportingInterval"}, headers=headers)
print(resp.json())
# [{"lastUpdateTs": 1706400000000, "key": "targetTemperature", "value": 22.0}, ...]
```

### Device Telemetry via HTTP Device API

```python
import requests

ACCESS_TOKEN = "${ACCESS_TOKEN}"  # Device access token
url = f"http://{TB_HOST}/api/v1/{ACCESS_TOKEN}/telemetry"

payload = {"temperature": 25.5, "humidity": 70}
resp = requests.post(url, json=payload)
print(resp.status_code)  # 200
```
