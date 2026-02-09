# Zenopix DALI LoRaWAN Controller Reference

Complete reference for the Zenopix DALI LoRaWAN smart lighting controller integration with ThingsBoard.

## System Overview

The Zenopix DALI LoRaWAN controller is a D4i-compatible smart lighting controller that communicates via LoRaWAN through The Things Network (TTN). It is managed by ThingsBoard with a dedicated device profile, rule chain, and dashboard.

### Key Capabilities
- DALI lighting control (dimming 0-100%)
- Power monitoring (voltage, current, power factor)
- Temperature monitoring (internal and LED module)
- Fault detection (over-voltage, thermal shutdown, light source failure)
- Tilt sensing
- Operating time tracking

## Entity Inventory

All entity IDs are stored in `/opt/thingsboard/.claude/credentials.env`. Reference environment variables -- never hardcode IDs.

| Entity | Name | Env Variable |
|--------|------|-------------|
| Device | zenopix-test | `${ZENOPIX_DEVICE_ID}` |
| Device Profile | Zenopix DALI Controller | `${ZENOPIX_PROFILE_ID}` |
| Rule Chain | Zenopix DALI Rule Chain | `${ZENOPIX_RULE_CHAIN_ID}` |
| Dashboard | Zenopix DALI Monitor | `${ZENOPIX_DASHBOARD_ID}` |

### Setup Script

The infrastructure was created programmatically:

```
/home/ubuntu/setup_zenopix.py
```

This script creates/updates the device profile, rule chain, dashboard, and runs end-to-end tests.

## Rule Chain Architecture

The Zenopix DALI Rule Chain has 10 nodes and 10 connections.

### Visual Layout

```
                    +--"Post telemetry"--> [1] Energy Calculator --"Success"--> [2] Save Timeseries
                    |
[0] Msg Type -------+--"Post telemetry"--> [4] Device Profile Node --"Success"--> [2] Save Timeseries
    Switch          |
                    +--"Post attributes"--> [3] Save Client Attributes
                    |
                    +--"RPC Request"------> [5] Dim Downlink Transform --"Success"--> [6] TTN MQTT Publish
                    |
                    +--"RPC Request"------> [7] Save Dim Level --"Success"--> [8] Save Server Attributes
                    |
                    +--"Other"------------> [9] Log Other
```

### Node Index Table

| Index | Name | Type | Purpose |
|-------|------|------|---------|
| 0 | Message Type Switch | TbMsgTypeSwitchNode | Route by message type |
| 1 | Energy Calculator | TbTransformMsgNode | Calculate power_watts, energy_wh_increment |
| 2 | Save Timeseries | TbMsgTimeseriesNode | Persist telemetry to time-series DB |
| 3 | Save Client Attributes | TbMsgAttributesNode | Save device-reported attributes |
| 4 | Device Profile | TbDeviceProfileNode | Evaluate alarm rules |
| 5 | Dim Downlink Transform | TbTransformMsgNode | Encode DALI command as TTN downlink JSON |
| 6 | TTN MQTT Publish | TbMqttNode | Publish downlink to TTN MQTT broker |
| 7 | Save Dim Level | TbTransformMsgNode | Extract dimLevel from RPC params |
| 8 | Save Server Attributes | TbMsgAttributesNode | Persist dimLevel as server attribute |
| 9 | Log Other | TbLogNode | Log unhandled message types |

### Connection Map

| fromIndex | toIndex | Connection Type |
|-----------|---------|----------------|
| 0 | 1 | Post telemetry |
| 0 | 4 | Post telemetry |
| 0 | 3 | Post attributes |
| 0 | 5 | RPC Request to Device |
| 0 | 7 | RPC Request to Device |
| 0 | 9 | Other |
| 1 | 2 | Success |
| 5 | 6 | Success |
| 7 | 8 | Success |
| 4 | 2 | Success |

### Parallel Processing

Two pairs of connections share the same output label from node 0:
- **"Post telemetry"** goes to BOTH [1] Energy Calculator AND [4] Device Profile -- they run in parallel
- **"RPC Request to Device"** goes to BOTH [5] Dim Downlink AND [7] Save Dim Level -- they run in parallel

This means one RPC request simultaneously sends a DALI command to TTN AND saves the dim level as a server attribute.

### TBEL Scripts

#### Energy Calculator (Node 1)

```
msg.power_watts = msg.supply_voltage * msg.light_src_current / 1000.0;
msg.energy_wh_increment = msg.power_watts * (msg.operating_time / 3600.0);
return {msg: msg, metadata: metadata, msgType: msgType};
```

#### Dim Downlink Transform (Node 5)

```
var dimValue = msg.params;
var base64Payload = bytesToBase64([0x84, 0x01, dimValue]);
var downlink = new JSON();
downlink.downlinks = [{f_port: 8, frm_payload: base64Payload, priority: "NORMAL"}];
return {msg: downlink, metadata: metadata, msgType: msgType};
```

#### Save Dim Level Transform (Node 7)

```
var newMsg = new JSON();
newMsg.dimLevel = msg.params;
return {msg: newMsg, metadata: metadata, msgType: msgType};
```

## Telemetry Fields (Uplink Payload)

### Sensor Data Fields

| Field | Type | Unit | Range | Description |
|-------|------|------|-------|-------------|
| supply_voltage | float | V | 0-300 | Mains supply voltage (220-240V typical) |
| power_factor | float | - | 0-1 | Power factor |
| internal_temp | int | C | -40 to 125 | Internal enclosure temperature |
| light_src_voltage | float | V | 0-60 | LED driver output voltage |
| light_src_temp | int | C | -40 to 150 | LED module temperature |
| light_src_current | int | mA | 0-2000 | LED driver output current |
| dim_value | int | % | 0-100 | Current dim level |
| output_current_pct | float | % | 0-100 | Output current as percentage of max |
| operating_time | int | hrs | 0-100000 | Total operating hours since install |
| tilt | int | deg | 0-360 | Tilt angle from vertical |
| start_counter | int | - | 0-65535 | Power-on cycle count |
| ldr | int | - | 0-1023 | Light-dependent resistor raw value |
| short_address | int | - | 0-63 | DALI short address |
| message_type | string | - | - | Always "sensor_data" for telemetry |

### Calculated Fields (from Energy Calculator node)

| Field | Formula | Unit | Description |
|-------|---------|------|-------------|
| power_watts | supply_voltage * light_src_current / 1000.0 | W | Real-time power consumption |
| energy_wh_increment | power_watts * operating_time / 3600.0 | Wh | Cumulative energy estimate |

### Fault Flags

| Field | Type | Description |
|-------|------|-------------|
| fault_light_src_failure | bool | Light source has failed |
| fault_over_voltage | bool | Over-voltage condition detected |
| fault_thermal_shutdown | bool | Thermal protection activated |
| fault_overall_failure | bool | General fault flag (any fault active) |

### Status Flags

| Field | Type | Description |
|-------|------|-------------|
| status_lamp_on | bool | Lamp is currently energized |
| status_lamp_failure | bool | Lamp failure detected by driver |

## DALI Command Structure

### Byte Format

3 bytes: `[opcode, address, value]`

| Byte | Name | Description |
|------|------|-------------|
| 0 | Opcode | `0x84` = DAPC (Direct Arc Power Control) |
| 1 | Address | `0x01` = broadcast, `0x02`-`0x3F` = individual DALI address |
| 2 | Value | `0x00`-`0x64` (0-100 dim percentage) |

### Dim Level Quick Reference

| Level | Hex | Base64 | LoRaWAN f_port |
|-------|-----|--------|----------------|
| 0% (OFF) | `84 01 00` | `hAEA` | 8 |
| 10% | `84 01 0A` | `hAEK` | 8 |
| 20% | `84 01 14` | `hAEU` | 8 |
| 25% | `84 01 19` | `hAEZ` | 8 |
| 30% | `84 01 1E` | `hAEe` | 8 |
| 40% | `84 01 28` | `hAEo` | 8 |
| 50% | `84 01 32` | `hAEy` | 8 |
| 60% | `84 01 3C` | `hAE8` | 8 |
| 70% | `84 01 46` | `hAFG` | 8 |
| 75% | `84 01 4B` | `hAFL` | 8 |
| 80% | `84 01 50` | `hAFQ` | 8 |
| 90% | `84 01 5A` | `hAFa` | 8 |
| 100% (ON) | `84 01 64` | `hAFk` | 8 |

### TTN Downlink Envelope

```json
{
  "downlinks": [{
    "f_port": 8,
    "frm_payload": "hAEy",
    "priority": "NORMAL"
  }]
}
```

## Alarm Rules (Device Profile)

The Zenopix DALI Controller device profile defines 5 alarm rules evaluated by the TbDeviceProfileNode.

### Alarm Definitions

#### 1. High Internal Temperature

| Condition | Severity | Threshold |
|-----------|----------|-----------|
| Create | WARNING | internal_temp > 70 |
| Escalate | CRITICAL | internal_temp > 85 |
| Clear | - | internal_temp < 60 |

#### 2. Supply Under-Voltage

| Condition | Severity | Threshold |
|-----------|----------|-----------|
| Create | WARNING | supply_voltage < 198 |
| Clear | - | supply_voltage > 205 |

#### 3. Supply Over-Voltage

| Condition | Severity | Threshold |
|-----------|----------|-----------|
| Create | WARNING | supply_voltage > 253 |
| Clear | - | supply_voltage < 245 |

#### 4. Light Source Failure

| Condition | Severity | Threshold |
|-----------|----------|-----------|
| Create | CRITICAL | fault_light_src_failure == true |
| Clear | - | fault_light_src_failure == false |

#### 5. Overall Fault

| Condition | Severity | Threshold |
|-----------|----------|-----------|
| Create | CRITICAL | fault_overall_failure == true |
| Clear | - | fault_overall_failure == false |

### Hysteresis

Temperature and voltage alarms use hysteresis gaps to prevent flapping:
- Temperature: creates at 70C, clears at 60C (10C gap)
- Under-voltage: creates at 198V, clears at 205V (7V gap)
- Over-voltage: creates at 253V, clears at 245V (8V gap)

### Alarm Processing Requirement

Alarms are ONLY evaluated when telemetry passes through the `TbDeviceProfileNode` (node index 4 in the rule chain). Without this node, alarm rules are completely ignored regardless of the device profile configuration.

## Dashboard Structure

### Dashboard: "Zenopix DALI Monitor"

- 2 states (main + schedule)
- 26 total widgets
- Uses entity alias bound to zenopix-test device

### Main State (24 widgets)

#### Row 0 (y=0): Primary Sensor Cards

| Widget | FQN | sizeX | col | Data Key |
|--------|-----|-------|-----|----------|
| Supply Voltage | system.cards.value_card | 4 | 0 | supply_voltage |
| Power Factor | system.cards.value_card | 4 | 4 | power_factor |
| Internal Temp | system.cards.value_card | 4 | 8 | internal_temp |
| Light Src Voltage | system.cards.value_card | 4 | 12 | light_src_voltage |
| Light Src Temp | system.cards.value_card | 4 | 16 | light_src_temp |
| Light Src Current | system.cards.value_card | 4 | 20 | light_src_current |

#### Row 3 (y=3): Secondary Sensor Cards

| Widget | FQN | sizeX | col | Data Key |
|--------|-----|-------|-----|----------|
| Tilt | system.cards.value_card | 4 | 0 | tilt |
| Output Current % | system.cards.value_card | 6 | 4 | output_current_pct |
| Start Counter | system.cards.value_card | 4 | 10 | start_counter |
| Operating Time | system.cards.value_card | 4 | 14 | operating_time |

#### Row 6 (y=6): Controls

| Widget | FQN | sizeX | col | Description |
|--------|-----|-------|-----|-------------|
| Dim Slider | system.slider | 10 | 0 | Controls dimLevel (0-100) via shared attribute |
| Dim Gauge | system.gauge.radial_gauge_canvas | 4 | 10 | Displays current dim_value |
| Power (W) | system.cards.value_card | 4 | 14 | Shows power_watts |
| ON Button | system.command_button | 3 | 18 | Sets dimLevel=100 |
| OFF Button | system.command_button | 3 | 21 | Sets dimLevel=0 |

RPC widgets (slider, ON/OFF buttons) use **SET_ATTRIBUTE (SHARED_SCOPE)** with key `dimLevel` instead of EXECUTE_RPC. This returns HTTP 200 immediately instead of 408 timeout for offline LoRaWAN devices.

#### Row 8 (y=8): Navigation

| Widget | FQN | sizeX | col | Description |
|--------|-----|-------|-----|-------------|
| Schedule Nav | system.navigation_cards | 24 | 0 | Navigate to schedule state |

#### Row 10 (y=10): Time Series Charts

| Widget | FQN | sizeX | col | Data Keys |
|--------|-----|-------|-----|-----------|
| Voltage Chart | system.time_series_chart | 12 | 0 | supply_voltage, light_src_voltage |
| Temperature Chart | system.time_series_chart | 12 | 12 | internal_temp, light_src_temp |

Charts span 5 rows (sizeY=5), showing 24-hour realtime data with no aggregation.

#### Row 15 (y=15): Fault Status and Alarms

| Widget | FQN | sizeX | col | Data Key |
|--------|-----|-------|-----|----------|
| Light Src Failure | system.cards.value_card | 4 | 0 | fault_light_src_failure |
| Over Voltage | system.cards.value_card | 4 | 4 | fault_over_voltage |
| Thermal Shutdown | system.cards.value_card | 4 | 8 | fault_thermal_shutdown |
| Overall Failure | system.cards.value_card | 4 | 12 | fault_overall_failure |
| Lamp On | system.cards.value_card | 4 | 16 | status_lamp_on |
| Lamp Failure | system.cards.value_card | 4 | 20 | status_lamp_failure |

#### Row 18 (y=18): Alarm Table

| Widget | FQN | sizeX | col | Description |
|--------|-----|-------|-----|-------------|
| Alarm Table | system.alarms_table | 24 | 0 | Shows active alarms with ack/clear |

### Schedule State (2 widgets)

| Widget | FQN | Description |
|--------|-----|-------------|
| Schedule Placeholder | system.html_card | HTML placeholder for future scheduling UI |
| Back to Main | system.navigation_cards | Navigate back to main state |

## TTN-TB Bridge Details

### Bridge Location

```
/opt/ttn-bridge/           -- Active bridge code
/opt/ttn-bridge-orig/      -- Original backup
```

### Bridge Behavior

The bridge handles three functions:

1. **Uplink telemetry**: TTN MQTT uplink -> decode -> ThingsBoard MQTT telemetry
2. **Shared attribute forwarding**: ThingsBoard shared attribute `dimLevel` change -> encode DALI -> TTN MQTT downlink
3. **RPC pre-connection**: Establishes MQTT session for RPC-enabled devices so ThingsBoard can deliver RPC messages

### Single Session Constraint

Only 1 MQTT session per device is allowed (`ACTORS_MAX_CONCURRENT_SESSION_PER_DEVICE=1`). The bridge owns the session for zenopix-test. No separate MQTT client can connect for the same device simultaneously.

### MQTT Node Configuration

The External MQTT node (node 6) in the rule chain uses:
- `singletonMode: true` -- one connection per rule engine instance
- `clientId: null` -- broker assigns client ID
- `protocolVersion: "MQTT_3_1_1"` -- must match root chain pattern
- `configurationVersion: 2` -- required for TB 4.x

## Test Methodology

The `setup_zenopix.py` script includes 5 end-to-end tests:

### Test 1: Telemetry Processing

Send sensor data via device token, verify:
- Raw fields saved as timeseries
- Calculated fields (power_watts, energy_wh_increment) computed correctly
- Values match expected formulas

### Test 2: RPC Dim Control

Send `setDim(50)` RPC, verify:
- MQTT downlink payload matches `hAEy` (base64 for `[0x84, 0x01, 0x32]`)
- `dimLevel` server attribute saved with value 50

### Test 3: Alarm Triggering

Send telemetry with `supply_voltage=190` and `internal_temp=90`, verify:
- Under-voltage WARNING alarm created
- High temperature CRITICAL alarm created
- Alarm details contain correct thresholds

### Test 4: Dashboard Verification

Check dashboard structure, verify:
- Total widget count matches expected (26)
- Both states exist (main, schedule)
- Main state is root

### Test 5: Dynamic Topic

Verify the External MQTT node topic pattern contains `${deviceName}`, confirming the rule chain supports multiple devices without modification.

## Quick Command Reference

All commands require sourcing credentials first:

```bash
source /opt/thingsboard/.claude/credentials.env
```

### Send Test Telemetry

```bash
curl -s -X POST "http://localhost:8080/api/v1/${ZENOPIX_DEVICE_TOKEN}/telemetry" \
  -H "Content-Type: application/json" \
  -d '{
    "supply_voltage": 230.5,
    "power_factor": 0.95,
    "internal_temp": 42,
    "light_src_voltage": 48.2,
    "light_src_current": 350,
    "dim_value": 75,
    "operating_time": 1500,
    "message_type": "sensor_data"
  }'
```

### Read Latest Telemetry

```bash
TOKEN=$(curl -s -X POST ${TB_HOST}/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"${TB_USERNAME}\", \"password\": \"${TB_PASSWORD}\"}" | jq -r .token)

curl -s "${TB_HOST}/api/plugins/telemetry/DEVICE/${ZENOPIX_DEVICE_ID}/values/timeseries?keys=supply_voltage,power_watts,dim_value" \
  -H "X-Authorization: Bearer $TOKEN" | jq .
```

### Set Dim Level (via Shared Attribute)

```bash
curl -s -X POST "${TB_HOST}/api/plugins/telemetry/DEVICE/${ZENOPIX_DEVICE_ID}/attributes/SHARED_SCOPE" \
  -H "Content-Type: application/json" \
  -H "X-Authorization: Bearer $TOKEN" \
  -d '{"dimLevel": 50}'
```

### Check Active Alarms

```bash
curl -s "${TB_HOST}/api/alarm/DEVICE/${ZENOPIX_DEVICE_ID}?pageSize=10&page=0&sortOrder=DESC&searchStatus=ACTIVE" \
  -H "X-Authorization: Bearer $TOKEN" | jq '.data[] | {type: .type, severity: .severity, status: .status}'
```

### Read Server Attributes

```bash
curl -s "${TB_HOST}/api/plugins/telemetry/DEVICE/${ZENOPIX_DEVICE_ID}/values/attributes/SERVER_SCOPE?keys=dimLevel" \
  -H "X-Authorization: Bearer $TOKEN" | jq .
```
