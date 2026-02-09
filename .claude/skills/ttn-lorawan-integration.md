# TTN LoRaWAN Integration Guide

Reference for integrating ThingsBoard with The Things Network (TTN) LoRaWAN infrastructure. Covers downlink/uplink flows, MQTT topics, payload encoding, and the TTN-TB bridge architecture.

## Architecture Overview

```
    ThingsBoard                              TTN LoRaWAN                    Device
    +-----------+                         +--------------+             +--------------+
    | Dashboard |--RPC-->| Rule Chain |   |              |             |              |
    | (slider)  |        |            |   |  TTN MQTT    |   LoRaWAN  |  LoRaWAN     |
    |           |        | Transform  |-->|  Broker      |----------->|  End Device  |
    |           |        | (TBEL)     |   |              |             |              |
    +-----------+        |            |   |              |             |              |
                         | Save Attr  |   +--------------+             +--------------+
                         +------------+
                               ^
    +-----------+              |
    | TTN-TB    |--telemetry-->|
    | Bridge    |              |
    | (Python)  |<--TTN uplink-+
    +-----------+
```

### Data Flow Summary

| Direction | Flow | Protocol |
|-----------|------|----------|
| Uplink (device to cloud) | Device -> TTN -> Bridge -> ThingsBoard | LoRaWAN -> MQTT -> MQTT |
| Downlink via rule chain | Dashboard -> Rule Chain -> TTN MQTT -> Device | HTTP -> MQTT -> LoRaWAN |
| Downlink via bridge | Dashboard -> Shared Attr -> Bridge -> TTN MQTT -> Device | HTTP -> MQTT -> MQTT -> LoRaWAN |

## Downlink Flow (ThingsBoard to Device)

### Method 1: Rule Chain Direct (RPC)

1. User moves slider widget on dashboard
2. Widget sends RPC request to device (or writes shared attribute)
3. Rule chain receives the message at Message Type Switch
4. "RPC Request to Device" routes to Transform node
5. TBEL script encodes DALI command as base64 payload
6. External MQTT node publishes to TTN downlink topic
7. TTN queues the downlink
8. Device receives payload on next LoRaWAN uplink window

### Method 2: Bridge (Shared Attribute)

1. User moves slider widget on dashboard
2. Widget writes shared attribute `dimLevel` via SET_ATTRIBUTE
3. Bridge subscribes to `v1/devices/me/attributes` on TB MQTT
4. Bridge receives attribute change notification
5. Bridge encodes DALI command and publishes to TTN MQTT
6. TTN queues the downlink
7. Device receives payload on next uplink window

**Recommended**: Method 2 (bridge) is preferred for LoRaWAN devices because:
- SET_ATTRIBUTE returns HTTP 200 immediately (no 408 timeout)
- Bridge handles encoding and delivery
- Attribute persists even if bridge is temporarily offline

## Uplink Flow (Device to ThingsBoard)

1. Device transmits LoRaWAN uplink with sensor data
2. TTN receives and decodes the payload
3. TTN publishes decoded JSON to MQTT uplink topic
4. Bridge subscribes to TTN uplink topic
5. Bridge extracts payload fields and converts to ThingsBoard telemetry format
6. Bridge publishes telemetry to ThingsBoard via MQTT (`v1/devices/me/telemetry`)
7. ThingsBoard rule chain processes telemetry (calculate, save, evaluate alarms)

## TTN MQTT Topic Structure

### Downlink Topics

| Topic | Direction | Description |
|-------|-----------|-------------|
| `v3/{appId}/devices/{deviceId}/down/push` | TB -> TTN | Push downlink immediately |
| `v3/{appId}/devices/{deviceId}/down/replace` | TB -> TTN | Replace queued downlinks |
| `v3/{appId}/devices/{deviceId}/down/queued` | TTN -> subscriber | Confirm downlink queued |
| `v3/{appId}/devices/{deviceId}/down/sent` | TTN -> subscriber | Confirm downlink sent |
| `v3/{appId}/devices/{deviceId}/down/ack` | TTN -> subscriber | Confirm downlink acknowledged |
| `v3/{appId}/devices/{deviceId}/down/nack` | TTN -> subscriber | Downlink not acknowledged |
| `v3/{appId}/devices/{deviceId}/down/failed` | TTN -> subscriber | Downlink failed |

### Uplink Topic

```
v3/{appId}/devices/{deviceId}/up
```

### Wildcards for Monitoring

```bash
# All events for one device
v3/${TTN_APP_ID}/devices/zenopix-test/#

# All downlink events for all devices
v3/${TTN_APP_ID}/devices/+/down/+

# All uplinks for all devices
v3/${TTN_APP_ID}/devices/+/up
```

## Downlink JSON Format

### Standard Downlink

```json
{
  "downlinks": [
    {
      "f_port": 8,
      "frm_payload": "hAEy",
      "priority": "NORMAL"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `f_port` | int | Application port (1-223). Port 8 for DALI commands. |
| `frm_payload` | string | Base64-encoded payload bytes |
| `priority` | string | `"NORMAL"`, `"HIGH"`, or `"HIGHEST"` |
| `confirmed` | bool | Request acknowledgment (optional, uses confirmed downlink slot) |

### Multiple Downlinks

TTN supports queuing multiple downlinks:

```json
{
  "downlinks": [
    {"f_port": 8, "frm_payload": "hAEA", "priority": "NORMAL"},
    {"f_port": 8, "frm_payload": "hAFk", "priority": "NORMAL"}
  ]
}
```

They are sent one per uplink window, in order.

## Payload Encoding

### TBEL Base64 Encoding

```
var base64Payload = bytesToBase64([0x84, 0x01, dimValue]);
```

This converts a byte array to base64. The `bytesToBase64()` function is a TBEL built-in.

### DALI Command Structure

Format: `[opcode, address, value]` (3 bytes)

| Byte | Description | Values |
|------|-------------|--------|
| Byte 0 | Opcode | `0x84` = DAPC (Direct Arc Power Control) |
| Byte 1 | Address | `0x01` = broadcast to all, `0x02-0x3F` = individual |
| Byte 2 | Value | `0x00`-`0x64` (0-100 dim percentage) |

### DALI Dim Level Lookup

| Dim Level | Hex Bytes | Base64 | Description |
|-----------|-----------|--------|-------------|
| 0% (OFF) | `84 01 00` | `hAEA` | Turn off |
| 10% | `84 01 0A` | `hAEK` | Very dim |
| 25% | `84 01 19` | `hAEZ` | Quarter brightness |
| 50% | `84 01 32` | `hAEy` | Half brightness |
| 75% | `84 01 4B` | `hAFL` | Three-quarter brightness |
| 100% (ON) | `84 01 64` | `hAFk` | Full brightness |

### Complete TBEL Transform for Downlink

```
var dimValue = msg.params;
var base64Payload = bytesToBase64([0x84, 0x01, dimValue]);
var downlink = new JSON();
downlink.downlinks = [{f_port: 8, frm_payload: base64Payload, priority: "NORMAL"}];
return {msg: downlink, metadata: metadata, msgType: msgType};
```

## Dynamic Topic with ${deviceName}

The External MQTT node's `topicPattern` field supports metadata variable substitution:

```
v3/${APP_ID}/devices/${deviceName}/down/push
```

- `${deviceName}` is automatically resolved from message metadata at runtime
- This allows a single rule chain to handle multiple devices
- The device name in ThingsBoard MUST match the device ID in TTN
- Other metadata fields are also available: `${deviceType}`, `${ts}`, etc.

## TTN-TB Bridge

### Location and Service

```
Bridge code:     /opt/ttn-bridge/
Original backup: /opt/ttn-bridge-orig/
Service:         ttn-tb-bridge.service (systemd)
Config:          /opt/ttn-bridge/credentials.env
```

### Bridge Responsibilities

1. **Uplink processing**: Subscribes to TTN MQTT uplink topic, decodes payload, publishes telemetry to ThingsBoard MQTT
2. **Shared attribute forwarding**: Subscribes to `v1/devices/me/attributes` on ThingsBoard MQTT, translates `dimLevel` changes to DALI downlink commands, publishes to TTN MQTT
3. **RPC handling**: Pre-connects RPC-enabled devices to ThingsBoard MQTT for RPC request/response flow
4. **Device session management**: Maintains persistent MQTT sessions for devices

### Bridge MQTT Connections

The bridge maintains two MQTT connections:

| Connection | Broker | Port | Purpose |
|------------|--------|------|---------|
| ThingsBoard | localhost | 1883 | Telemetry publish, attribute subscribe, RPC |
| TTN | ${TTN_MQTT_HOST} | 1883 or 8883 | Uplink subscribe, downlink publish |

### Bridge Service Management

```bash
# Check status
systemctl status ttn-tb-bridge

# View logs
journalctl -u ttn-tb-bridge -f --no-pager -n 50

# Restart
systemctl restart ttn-tb-bridge

# Stop
systemctl stop ttn-tb-bridge
```

## Single Session Constraint

ThingsBoard enforces `ACTORS_MAX_CONCURRENT_SESSION_PER_DEVICE = 1` by default.

Implications:
- Only ONE MQTT client can connect per device at a time
- The bridge owns the session for RPC-enabled devices
- No separate MQTT proxy or debug client can connect simultaneously
- Setting the limit to 2 causes RPC to hang (HTTP 000 timeout) -- do NOT change this value
- If bridge is connected, manual MQTT connections to the same device will be rejected

### Workaround for Debugging

Stop the bridge temporarily to connect a debug MQTT client:

```bash
systemctl stop ttn-tb-bridge
# Now you can connect manually for debugging
# ...
systemctl start ttn-tb-bridge
```

## RPC 408 Issue and Workaround

### The Problem

One-way RPC (`POST /api/plugins/rpc/oneway/{deviceId}`) returns HTTP 408 (Request Timeout) when the device is offline or has high latency. This is expected for LoRaWAN devices that may not respond for minutes or hours.

However, the rule chain STILL processes the RPC message successfully -- the 408 is only the HTTP response to the API caller.

### The Workaround

For dashboard widgets controlling LoRaWAN devices:
- Use **SET_ATTRIBUTE (SHARED_SCOPE)** instead of **EXECUTE_RPC**
- Writing a shared attribute returns HTTP 200 immediately
- The bridge monitors shared attribute changes and sends DALI downlinks
- Widget configuration: use `setValueMethod: "SET_ATTRIBUTE"` with `scope: "SHARED_SCOPE"`

### Persistent RPC (Not Available in CE)

`requestPersistent: true` is silently IGNORED in ThingsBoard Community Edition 4.4.0. No persistent RPCs are saved to the database. This is a Professional Edition feature only.

## TLS Configuration

### TTN MQTT Ports

| Port | Protocol | Use Case |
|------|----------|----------|
| 1883 | Non-TLS MQTT | Development, internal networks |
| 8883 | TLS MQTT | Production, external connections |
| 443 | MQTT over WebSocket (TLS) | Firewall-restricted environments |

### Rule Chain External MQTT Node (TLS)

```json
{
  "host": "${TTN_MQTT_HOST}",
  "port": 8883,
  "ssl": true,
  "credentials": {
    "type": "basic",
    "username": "${TTN_MQTT_USER}",
    "password": "${TTN_MQTT_PASS}"
  }
}
```

### Bridge TLS Configuration

For the Python bridge using paho-mqtt:

```python
import ssl
client.tls_set(ca_certs="/etc/ssl/certs/ca-certificates.crt",
               tls_version=ssl.PROTOCOL_TLS_CLIENT)
client.connect("${TTN_MQTT_HOST}", 8883)
```

## Uplink Payload Decoding

TTN provides decoded payload in the uplink JSON. The bridge extracts relevant fields.

### TTN Uplink JSON Structure (Abbreviated)

```json
{
  "end_device_ids": {
    "device_id": "zenopix-test",
    "application_ids": {"application_id": "${TTN_APP_ID}"},
    "dev_eui": "...",
    "dev_addr": "..."
  },
  "uplink_message": {
    "f_port": 10,
    "frm_payload": "base64-encoded-raw",
    "decoded_payload": {
      "supply_voltage": 230.5,
      "power_factor": 0.95,
      "internal_temp": 42,
      "light_src_voltage": 48.2,
      "light_src_current": 350,
      "dim_value": 75
    },
    "rx_metadata": [...],
    "settings": {"data_rate": {...}, "frequency": "868100000"}
  }
}
```

The bridge maps `decoded_payload` fields directly to ThingsBoard telemetry keys.

## Monitoring and Verification

### Subscribe to TTN Downlink Confirmations

```bash
mosquitto_sub -h ${TTN_MQTT_HOST} -p 1883 \
  -u "${TTN_MQTT_USER}" -P "${TTN_MQTT_PASS}" \
  -t "v3/${TTN_APP_ID}/devices/zenopix-test/down/+"
```

### Verify Telemetry Arrives in ThingsBoard

```bash
TOKEN=$(curl -s -X POST ${TB_HOST}/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "${TB_USERNAME}", "password": "${TB_PASSWORD}"}' | jq -r .token)

curl -s "${TB_HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/values/timeseries?keys=supply_voltage,dim_value" \
  -H "X-Authorization: Bearer $TOKEN" | jq .
```

### Verify Shared Attribute Was Written

```bash
curl -s "${TB_HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/values/attributes/SHARED_SCOPE?keys=dimLevel" \
  -H "X-Authorization: Bearer $TOKEN" | jq .
```

### Verify Server Attribute Was Saved

```bash
curl -s "${TB_HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/values/attributes/SERVER_SCOPE?keys=dimLevel" \
  -H "X-Authorization: Bearer $TOKEN" | jq .
```

## Troubleshooting

### Downlink Not Reaching Device

1. Check rule chain debug events (enable debugMode on MQTT node)
2. Verify TTN MQTT credentials are valid
3. Subscribe to `v3/${TTN_APP_ID}/devices/{deviceId}/down/+` to confirm TTN received it
4. Check device is active in TTN console (last seen recently)
5. LoRaWAN Class A: device only receives downlinks after an uplink. Wait for next uplink window.

### Uplink Not Appearing in ThingsBoard

1. Check bridge is running: `systemctl status ttn-tb-bridge`
2. Check bridge logs: `journalctl -u ttn-tb-bridge -f`
3. Verify TTN is receiving uplinks in the TTN console
4. Verify bridge MQTT connection to ThingsBoard is active
5. Check for payload decoding errors in bridge logs

### RPC Timeout (408)

- Expected for LoRaWAN devices -- rule chain still processes the message
- Switch to SET_ATTRIBUTE approach (see RPC 408 Workaround section above)
- Check that bridge is not competing for the device's MQTT session

### Multiple Session Error

- Only one MQTT session per device is allowed
- Stop the bridge before connecting a debug client
- Never set `ACTORS_MAX_CONCURRENT_SESSION_PER_DEVICE` to 2
