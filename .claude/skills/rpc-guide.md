<!-- Last updated: 2026-02-09 -->
<!-- Sources: RpcV1Controller.java, RpcV2Controller.java, TbSendRPCRequestNode.java, RpcStatus.java, https://thingsboard.io/docs/user-guide/rpc/, https://thingsboard.io/docs/reference/mqtt-api/ -->

# RPC (Remote Procedure Call) Guide

## Overview

RPC in ThingsBoard enables bidirectional command exchange between the platform and
connected devices. It is the primary mechanism for sending commands to devices (server-side
RPC) and for devices to request data or actions from the platform (client-side RPC).

**Server-side RPC** (platform to device): The server sends a command to the device.
Examples include toggling a relay, setting a thermostat temperature, rebooting a gateway,
or reading a sensor value on demand.

**Client-side RPC** (device to platform): The device initiates a request to the server.
Examples include a constrained device requesting the current timestamp or querying
external data through the platform.

### Three RPC Modes

| Mode | Direction | Response | Survives Restart | Edition |
|------|-----------|----------|------------------|---------|
| **One-way** | Server to device | None (fire-and-forget) | No | CE + PE |
| **Two-way** | Server to device | Device sends response | No | CE + PE |
| **Persistent** | Server to device | Optional | Yes (saved to DB) | **PE only** |

**CE vs PE**: Persistent RPC is a Professional Edition feature. In Community Edition,
setting `"persistent": true` is silently ignored -- the RPC is treated as lightweight
(non-persistent). One-way and two-way lightweight RPCs work in both editions.

Use cases:
- Toggle relay: one-way RPC with method `setGpio`
- Read sensor value: two-way RPC with method `getValue`, device returns reading
- Reboot device: one-way RPC with method `reboot`
- Set temperature: two-way RPC with method `setTemperature`, device confirms new value
- Firmware update command to offline device: persistent RPC (PE) queued until device connects

---

## REST API v1 (Legacy)

The v1 API is deprecated but still functional. It uses the `/api/plugins/rpc` prefix.

### One-Way RPC (v1)

```
POST ${TB_HOST}/api/plugins/rpc/oneway/{deviceId}
X-Authorization: Bearer ${TB_TOKEN}
Content-Type: application/json

{
  "method": "setGpio",
  "params": {
    "pin": 1,
    "value": 1
  },
  "timeout": 5000
}
```

Returns `200 OK` with empty body if the device received the message.
Returns `408 Request Timeout` if the device is offline or did not acknowledge in time.
Returns `409 Conflict` if too many concurrent RPC requests are pending.

### Two-Way RPC (v1)

```
POST ${TB_HOST}/api/plugins/rpc/twoway/{deviceId}
X-Authorization: Bearer ${TB_TOKEN}
Content-Type: application/json

{
  "method": "getValue",
  "params": {},
  "timeout": 5000
}
```

Returns `200 OK` with the device's JSON response body.
Returns `408 Request Timeout` if the device did not respond in time.
Returns `409 Conflict` if too many concurrent RPC requests are pending.

**Key difference from v2**: The v1 API returns `408` on timeout (v2 returns `504`) and
`409` on conflict (v2 returns `504`). Prefer v2 for new development.

---

## REST API v2

The v2 API uses the `/api/rpc` prefix and adds persistent RPC support.

### One-Way RPC (v2)

```
POST ${TB_HOST}/api/rpc/oneway/{deviceId}
X-Authorization: Bearer ${TB_TOKEN}
Content-Type: application/json

{
  "method": "setGpio",
  "params": { "pin": 7, "value": 1 },
  "persistent": false,
  "timeout": 5000
}
```

**Lightweight**: Returns `200 OK` if sent, `504 Gateway Timeout` if device is offline.
**Persistent (PE)**: Returns `200 OK` with `rpcId` UUID regardless of device status.

### Two-Way RPC (v2)

```
POST ${TB_HOST}/api/rpc/twoway/{deviceId}
X-Authorization: Bearer ${TB_TOKEN}
Content-Type: application/json

{
  "method": "getTemperature",
  "params": {},
  "timeout": 10000
}
```

**Lightweight**: Returns `200 OK` with device response, `504` if device is offline.
**Persistent (PE)**: Returns `200 OK` with `rpcId` UUID. Poll status separately.

### Full Request Structure

```json
{
  "method": "setTemperature",
  "params": { "value": 22.5 },
  "timeout": 5000,
  "expirationTime": 1735689600000,
  "persistent": true,
  "retries": 3,
  "additionalInfo": { "key": "value" }
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `method` | Yes | -- | RPC method name (string) |
| `params` | Yes | -- | Parameters (JSON object). Use `{}` if none needed |
| `timeout` | No | 10000 | Timeout in milliseconds. Minimum: 5000 |
| `expirationTime` | No | -- | Epoch ms (UTC). Overrides `timeout` if set |
| `persistent` | No | false | Save to DB, survive restarts (**PE only**) |
| `retries` | No | -- | Retry count for persistent RPC failures |
| `additionalInfo` | No | -- | Custom metadata for persistent RPC events |

### List Persistent RPCs (PE)

```
GET ${TB_HOST}/api/rpc/persistent/device/{deviceId}?page=0&pageSize=10&rpcStatus=QUEUED
X-Authorization: Bearer ${TB_TOKEN}
```

Query parameters: `pageSize`, `page`, `rpcStatus` (optional filter), `textSearch`,
`sortProperty` (`createdTime`, `expirationTime`, `request`, `response`),
`sortOrder` (`ASC`, `DESC`).

Note: Filtering by `DELETED` status is explicitly rejected (returns `400 Bad Request`).

### Get Persistent RPC by ID (PE)

```
GET ${TB_HOST}/api/rpc/persistent/{rpcId}
X-Authorization: Bearer ${TB_TOKEN}
```

### Delete Persistent RPC (PE)

```
DELETE ${TB_HOST}/api/rpc/persistent/{rpcId}
X-Authorization: Bearer ${TB_TOKEN}
```

Requires `TENANT_ADMIN` authority. If the RPC is in an active state (QUEUED, SENT, or
DELIVERED), a delete notification is pushed to the core actor system to cancel it. The
status is set to `DELETED` and an `RPC_DELETED` message is pushed to the rule engine.

---

## Persistent RPC Lifecycle

Persistent RPCs follow a state machine. The `RpcStatus` enum defines these states:

```
QUEUED --> SENT --> DELIVERED --> SUCCESSFUL
  |         |         |
  |         |         +--> TIMEOUT
  |         |
  |         +--> TIMEOUT
  |         +--> FAILED (retries exhausted)
  |
  +--> EXPIRED (expirationTime passed)
  +--> DELETED (manual deletion via API)
```

| Status | Description | Terminal | Delete Notifies Core |
|--------|-------------|----------|---------------------|
| `QUEUED` | Saved to DB, waiting for device to connect | No | Yes |
| `SENT` | Device connected, RPC dispatched to transport | No | Yes |
| `DELIVERED` | Device acknowledged receipt (final for one-way) | One-way: Yes | Yes |
| `SUCCESSFUL` | Device sent response (two-way completion) | Yes | No |
| `TIMEOUT` | No response within timeout window | Yes | No |
| `EXPIRED` | `expirationTime` passed before delivery | Yes | No |
| `FAILED` | Maximum retries exceeded | Yes | No |
| `DELETED` | Manually deleted via REST API | Yes | No |

**Configuration parameters**:
- `ACTORS_RPC_MAX_RETRIES`: Maximum retry attempts (default: 5)
- `ACTORS_RPC_SEQUENTIAL`: Enable sequential delivery for constrained devices
- `SQL_RPC_TTL_CHECKING_INTERVAL`: Cleanup interval for expired RPCs (default: 2 hours)
- Persistent RPC TTL is configured per Tenant Profile

---

## Device-Side MQTT RPC

### Server-Side RPC (Receiving Commands)

The device subscribes to receive RPC commands from the server:

```
Subscribe: v1/devices/me/rpc/request/+
```

When an RPC arrives, the device receives a PUBLISH on:

```
Topic:   v1/devices/me/rpc/request/{requestId}
Payload: {"id": 123, "method": "setGpio", "params": {"pin": 1, "value": 1}}
```

The `{requestId}` is an integer that identifies this specific RPC call.

**One-way RPC**: No response required. The device processes the command silently.

**Two-way RPC**: The device must publish a response to:

```
Topic:   v1/devices/me/rpc/response/{requestId}
Payload: {"result": "ok", "temperature": 22.5}
```

The response payload is forwarded back to the REST API caller.

### Client-Side RPC (Device to Server)

The device initiates RPC calls to the server:

```
Publish: v1/devices/me/rpc/request/{requestId}
Payload: {"method": "getCurrentTime", "params": {}}
```

The `{requestId}` is a client-generated integer. The server processes the request
through the rule chain (message type: `RPC_CALL_FROM_DEVICE_TO_SERVER`) and the
response is delivered to:

```
Topic:   v1/devices/me/rpc/response/{requestId}
Payload: {"time": "2026-02-09T12:00:00Z"}
```

The device must subscribe to `v1/devices/me/rpc/response/+` to receive responses.

### HTTP Device API Equivalents

```
# Server-side RPC: device polls for commands
GET  ${TB_HOST}/api/v1/${DEVICE_ACCESS_TOKEN}/rpc

# Server-side RPC: device sends response
POST ${TB_HOST}/api/v1/${DEVICE_ACCESS_TOKEN}/rpc/{requestId}

# Client-side RPC: device sends request
POST ${TB_HOST}/api/v1/${DEVICE_ACCESS_TOKEN}/rpc
Body: {"method": "getCurrentTime", "params": {}}
```

### CoAP Device API Equivalents

```
# Server-side RPC: device observes for commands
GET  coap://${TB_HOST}/api/v1/${DEVICE_ACCESS_TOKEN}/rpc (Observe)

# Server-side RPC: device sends response
POST coap://${TB_HOST}/api/v1/${DEVICE_ACCESS_TOKEN}/rpc/{requestId}

# Client-side RPC: device sends request
POST coap://${TB_HOST}/api/v1/${DEVICE_ACCESS_TOKEN}/rpc
```

### Session Limits

Devices can query their session limits via client-side RPC:

```json
{"method": "getSessionLimits", "params": {}}
```

Response includes `maxPayloadSize`, `maxInflightMessages`, and rate limit details.

---

## Rule Chain RPC Processing

### TbSendRPCRequestNode ("rpc call request")

Sends an RPC command to a device from within a rule chain.

**Configuration**:
- `timeoutInSeconds`: RPC timeout (default: 60 seconds)

**Input message requirements**:
- Message originator MUST be a Device entity (use "Change Originator" node first if needed)
- Message body MUST contain `"method"` and `"params"` fields:

```json
{
  "method": "setTemperature",
  "params": { "value": 22.5 }
}
```

**Metadata fields read by the node**:
| Metadata Key | Description | Default |
|-------------|-------------|---------|
| `oneway` | `"true"` for one-way RPC | `false` |
| `persistent` | `"true"` for persistent RPC (PE) | `false` |
| `requestUUID` | UUID for tracking | Auto-generated (time-based) |
| `originServiceId` | Originating service ID | `null` |
| `expirationTime` | Epoch ms expiration | Now + `timeoutInSeconds` |
| `retries` | Retry count for persistent RPC | `null` |

**Optional message body fields**: `requestId` (integer), `additionalInfo` (JSON object).

**Outputs**:
- **Success**: Response from device (or empty for one-way) routed to Success chain
- **Failure**: Error object `{"error": "TIMEOUT"}` routed to Failure chain

**Message type**: If the incoming message type is `RPC_CALL_FROM_SERVER_TO_DEVICE`, the
node treats it as a REST API-originated call and forwards the response back to the
original REST API caller automatically.

### TbSendRPCReplyNode ("rpc call reply")

Sends a response back to the device for client-side RPC calls.

**Configuration** (defaults shown):
- `serviceIdMetaDataAttribute`: `"serviceId"`
- `sessionIdMetaDataAttribute`: `"sessionId"`
- `requestIdMetaDataAttribute`: `"requestId"`

**Required metadata fields**: The incoming message must contain `serviceId`, `sessionId`,
and `requestId` in its metadata. These are automatically set when the rule chain
receives a `RPC_CALL_FROM_DEVICE_TO_SERVER` message.

**Input**: Message body is sent as the RPC response to the device. Must not be empty.

**Edge support**: If the metadata contains `edgeId`, the response is saved to the edge
event queue instead of being sent directly, enabling RPC across ThingsBoard Edge instances.

### Key Message Types

| Message Type | Direction | Description |
|-------------|-----------|-------------|
| `RPC_CALL_FROM_SERVER_TO_DEVICE` | Server to device | REST API triggered server-side RPC |
| `RPC_CALL_FROM_DEVICE_TO_SERVER` | Device to server | Client-side RPC from device |
| `RPC_DELETED` | Internal | Persistent RPC was deleted via API |

### Example Rule Chain Pattern

**Server-side RPC from rule chain**:
```
[Trigger Node] --> [Change Originator to Device]
    --> [Create Message with method/params]
    --> [RPC Call Request Node]
    --> [Handle Response / Log]
```

**Client-side RPC processing**:
```
[Device RPC Request] --> [Script: process request]
    --> [RPC Call Reply Node]
```

---

## Widget to RPC Flow

Dashboard control widgets (buttons, sliders, switches) send RPC commands to devices
internally through the widget API.

### Widget API Methods

```typescript
// One-way: fire-and-forget command
widgetContext.controlApi.sendOneWayCommand(
  "setGpio",                        // method
  { pin: 1, value: 1 },            // params
  5000                               // timeout (ms, optional)
);

// Two-way: command with response
widgetContext.controlApi.sendTwoWayCommand(
  "getValue",                        // method
  {},                                // params
  10000                              // timeout (ms, optional)
).subscribe(response => {
  // Handle device response
  console.log("Device responded:", response);
});
```

### Target Device Configuration

Widgets resolve the target device from their data source configuration:
- **Entity alias**: Widget uses an alias that resolves to a single device
- **Direct entity**: `{ entityType: "DEVICE", id: "device-uuid" }`
- Dashboard state entity: inherited from dashboard state parameters

### Common Widget RPC Patterns

**Toggle switch** (e.g., GPIO control):
```
Method: "setValue"    Params: { "value": true }   (or false)
Method: "setGpio"    Params: { "pin": 1, "value": 1 }
```

**Slider** (e.g., dimmer, fan speed):
```
Method: "setValue"    Params: { "value": 50 }
```

**Button** (e.g., reboot, reset):
```
Method: "reboot"     Params: {}
Method: "reset"      Params: {}
```

**LED indicator / Status** (uses two-way RPC):
```
Method: "getValue"   Params: {}
Response: { "value": true }
```

### RPC Method Naming Conventions

- Use camelCase: `setTemperature`, `getValue`, `getStatus`
- Be descriptive: `setRelayState` rather than `set`
- Group by prefix: `get*` for reads, `set*` for writes
- The method name is a string convention between the dashboard widget and device firmware;
  ThingsBoard does not enforce any naming rules

---

## LoRaWAN RPC Workaround

LoRaWAN Class A devices cannot receive direct RPC commands because they only listen for
downlinks briefly after transmitting an uplink. Standard RPC will timeout.

### Recommended Pattern: Shared Attributes

Use shared attributes as a deferred command mechanism:

1. **Dashboard widget** saves a shared attribute instead of sending RPC:
   ```
   PUT ${TB_HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/SHARED_SCOPE
   Body: { "targetTemperature": 22.5 }
   ```

2. **Rule chain** detects the attribute update and forwards to the integration:
   ```
   [Shared Attribute Update] --> [Filter: is LoRaWAN device?]
       --> [External MQTT Node: publish to TTN downlink topic]
   ```

3. **TTN Integration** queues the downlink. The device receives it after its next uplink.

4. **Device** applies the command and optionally confirms via uplink telemetry.

### Alternative: Direct Integration Downlink

Use an External MQTT node in the rule chain to publish directly to the network server's
downlink API topic (e.g., TTN, ChirpStack). This avoids the shared attribute pattern
but couples the rule chain to the specific LoRaWAN network server.

### SET_ATTRIBUTE Pattern

For devices that check attributes on connect, the flow is:
```
Dashboard --> Save Shared Attribute --> Device connects -->
Device requests shared attributes --> Device applies command
```

This works for any intermittently connected device, not just LoRaWAN.

---

## Error Codes and Troubleshooting

### HTTP Status Codes

| Code | v1 API | v2 API | Meaning |
|------|--------|--------|---------|
| 200 | OK | OK | RPC sent (one-way) or response received (two-way) |
| 400 | Bad Request | Bad Request | Missing `method`/`params`, or invalid `rpcStatus=DELETED` |
| 401 | Unauthorized | Unauthorized | Invalid token or wrong tenant/customer |
| 404 | Not Found | Not Found | Invalid `deviceId` or `rpcId` |
| 408 | Timeout | -- | Device did not respond in time (v1 only) |
| 409 | Conflict | -- | Too many concurrent RPCs (v1 only) |
| 413 | -- | Payload Too Large | Request body exceeds size limit |
| 504 | -- | Gateway Timeout | Device offline or did not respond (v2) |

### Common Issues

**Device not receiving RPC**:
- Device not subscribed to `v1/devices/me/rpc/request/+`
- MQTT wildcard `+` is required; subscribing to the exact topic will miss messages
- Check device "Last Activity" time in the UI to confirm it is connected

**RPC timeout**:
- Default timeout is 10 seconds; increase for slow devices or high-latency networks
- Minimum timeout is 5000 ms; values below this are rejected
- For persistent RPC, use `expirationTime` for long-lived commands

**Two-way RPC returns empty**:
- Device must publish response to `v1/devices/me/rpc/response/{requestId}`
- The `requestId` must match exactly (integer from the received message)

**Persistent RPC silently fails (CE)**:
- Persistent RPC is PE-only. On CE, `"persistent": true` is ignored
- The RPC is treated as lightweight and will fail if the device is offline

**Too many concurrent RPCs**:
- Default limit is approximately 10 concurrent lightweight RPCs per device
- Increase timeout or use persistent RPC to avoid this

### Debugging

1. **Enable rule chain debug**: In the rule chain editor, enable debug mode on the
   RPC-related nodes. Check the "Events" tab for message flow.
2. **Check device connectivity**: Devices page > Last Activity column
3. **MQTT client test**: Use `mosquitto_sub` to verify the device receives messages:
   ```bash
   mosquitto_sub -h ${TB_HOST} -t "v1/devices/me/rpc/request/+" \
     -u "${DEVICE_ACCESS_TOKEN}"
   ```
4. **REST API test**: Use curl to send a test RPC and check the response code.

---

## Python Examples

All examples use the `requests` library with `${TB_HOST}`, `${TB_TOKEN}`, `${DEVICE_ID}` placeholders.

```python
import requests

HEADERS = {"Content-Type": "application/json", "X-Authorization": f"Bearer ${TB_TOKEN}"}

# --- One-Way RPC ---
r = requests.post(f"${TB_HOST}/api/rpc/oneway/${DEVICE_ID}", headers=HEADERS,
    json={"method": "setGpio", "params": {"pin": 1, "value": 1}, "timeout": 5000})
print(f"One-way status: {r.status_code}")  # 200 = sent, 504 = device offline

# --- Two-Way RPC ---
r = requests.post(f"${TB_HOST}/api/rpc/twoway/${DEVICE_ID}", headers=HEADERS,
    json={"method": "getTemperature", "params": {}, "timeout": 10000})
if r.status_code == 200:
    print(f"Device response: {r.json()}")

# --- List Persistent RPCs (PE only) ---
r = requests.get(f"${TB_HOST}/api/rpc/persistent/device/${DEVICE_ID}", headers=HEADERS,
    params={"pageSize": 10, "page": 0, "rpcStatus": "QUEUED", "sortOrder": "DESC"})
if r.status_code == 200:
    for rpc in r.json().get("data", []):
        print(f"RPC {rpc['id']['id']}: {rpc['status']}")

# --- Delete Persistent RPC (PE only) ---
rpc_id = "your-rpc-uuid-here"
r = requests.delete(f"${TB_HOST}/api/rpc/persistent/{rpc_id}", headers=HEADERS)
print(f"Deleted: {r.status_code}")  # 200 = deleted
```
