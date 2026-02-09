# Rule Chain Development Reference

Practical reference for building and modifying ThingsBoard rule chains via the REST API. Covers node types, connection patterns, TBEL scripting, and the metadata API.

## Rule Chain Metadata API

### Endpoint

```
POST ${TB_HOST}/api/ruleChain/metadata
```

**CRITICAL**: The endpoint is `POST /api/ruleChain/metadata` -- NOT `/api/ruleChain/{id}/metadata`. The rule chain ID goes inside the JSON body, not in the URL.

### Request Body Structure

```json
{
  "ruleChainId": {
    "entityType": "RULE_CHAIN",
    "id": "${RULE_CHAIN_ID}"
  },
  "firstNodeIndex": 0,
  "nodes": [
    {
      "type": "org.thingsboard.rule.engine.filter.TbMsgTypeSwitchNode",
      "name": "Message Type Switch",
      "debugMode": false,
      "singletonMode": false,
      "queueName": null,
      "configurationVersion": 0,
      "configuration": {}
    }
  ],
  "connections": [
    {
      "fromIndex": 0,
      "toIndex": 1,
      "type": "Post telemetry"
    }
  ],
  "ruleChainConnections": null
}
```

### GET Metadata

```
GET ${TB_HOST}/api/ruleChain/${RULE_CHAIN_ID}/metadata
```

Returns the same structure. Use this to read, modify, and POST back.

### Create a New Rule Chain

```
POST ${TB_HOST}/api/ruleChain
```

Body:

```json
{
  "name": "My Rule Chain",
  "type": "CORE",
  "debugMode": false,
  "root": false,
  "configuration": {"description": ""}
}
```

Returns the created rule chain with its ID. Then POST metadata separately.

## Node Types Reference

### Core Nodes

| Node | Java Class | configurationVersion | Purpose |
|------|-----------|---------------------|---------|
| Message Type Switch | `TbMsgTypeSwitchNode` | 0 | Routes messages by type |
| Transform (TBEL) | `TbTransformMsgNode` | 0 | Transform message payload/metadata |
| Save Timeseries | `TbMsgTimeseriesNode` | 0 | Save message data as time-series |
| Save Attributes | `TbMsgAttributesNode` | 0 | Save attributes (client/server/shared) |
| Device Profile | `TbDeviceProfileNode` | 0 | Evaluate alarm rules from device profile |
| External MQTT | `TbMqttNode` | 2 | Publish to external MQTT broker |
| Log | `TbLogNode` | 0 | Log message to rule engine console |
| REST API Call | `TbRestApiCallNode` | 0 | Call external REST API |
| Create Alarm | `TbCreateAlarmNode` | 1 | Create or update alarm |
| Clear Alarm | `TbClearAlarmNode` | 0 | Clear existing alarm |
| RPC Call Request | `TbSendRPCRequestNode` | 0 | Send RPC to device |

### Full Java Class Paths

```
org.thingsboard.rule.engine.filter.TbMsgTypeSwitchNode
org.thingsboard.rule.engine.transform.TbTransformMsgNode
org.thingsboard.rule.engine.telemetry.TbMsgTimeseriesNode
org.thingsboard.rule.engine.telemetry.TbMsgAttributesNode
org.thingsboard.rule.engine.profile.TbDeviceProfileNode
org.thingsboard.rule.engine.mqtt.TbMqttNode
org.thingsboard.rule.engine.action.TbLogNode
org.thingsboard.rule.engine.rest.TbRestApiCallNode
org.thingsboard.rule.engine.action.TbCreateAlarmNode
org.thingsboard.rule.engine.action.TbClearAlarmNode
org.thingsboard.rule.engine.rpc.TbSendRPCRequestNode
```

## Node Configuration Details

### Message Type Switch

```json
{
  "type": "org.thingsboard.rule.engine.filter.TbMsgTypeSwitchNode",
  "name": "Message Type Switch",
  "configuration": {},
  "configurationVersion": 0
}
```

No configuration needed. Routes messages by their type.

### Transform (TBEL)

```json
{
  "type": "org.thingsboard.rule.engine.transform.TbTransformMsgNode",
  "name": "Energy Calculator",
  "configuration": {
    "scriptLang": "TBEL",
    "tbelScript": "msg.power_watts = msg.supply_voltage * msg.light_src_current / 1000.0;\nreturn {msg: msg, metadata: metadata, msgType: msgType};",
    "jsScript": "return {msg: msg, metadata: metadata, msgType: msgType};"
  },
  "configurationVersion": 0
}
```

- `scriptLang`: `"TBEL"` or `"JS"`
- `tbelScript`: TBEL script body (used when scriptLang is TBEL)
- `jsScript`: JS script body (used when scriptLang is JS)
- MUST always return `{msg, metadata, msgType}` object
- See TBEL Scripting section below for gotchas

### Save Timeseries

```json
{
  "type": "org.thingsboard.rule.engine.telemetry.TbMsgTimeseriesNode",
  "name": "Save Timeseries",
  "configuration": {
    "defaultTTL": 0
  },
  "configurationVersion": 0
}
```

- `defaultTTL`: time-to-live in seconds (0 = no expiry)
- Saves all keys in message body as time-series data

### Save Attributes

```json
{
  "type": "org.thingsboard.rule.engine.telemetry.TbMsgAttributesNode",
  "name": "Save Server Attributes",
  "configuration": {
    "scope": "SERVER_SCOPE",
    "notifyDevice": false,
    "sendAttributesUpdatedNotification": false,
    "updateAttributesOnlyOnValueChange": false
  },
  "configurationVersion": 0
}
```

- `scope`: `"CLIENT_SCOPE"`, `"SERVER_SCOPE"`, or `"SHARED_SCOPE"`
- `notifyDevice`: if true, notifies device of shared attribute change
- Message body keys become attribute keys

### Device Profile Node

```json
{
  "type": "org.thingsboard.rule.engine.profile.TbDeviceProfileNode",
  "name": "Device Profile",
  "configuration": {
    "persistAlarmRulesState": false,
    "fetchAlarmRulesStateOnStart": false
  },
  "configurationVersion": 0
}
```

**CRITICAL**: Alarm rules defined in a device profile are ONLY evaluated when telemetry passes through this node. Without a `TbDeviceProfileNode` in the rule chain, alarms are completely ignored.

Output connections:
- `"Success"` -- telemetry processed, no alarm state change
- `"Alarm Created"` -- new alarm was created
- `"Alarm Updated"` -- existing alarm severity/details changed
- `"Alarm Severity Updated"` -- alarm severity specifically changed
- `"Alarm Cleared"` -- alarm condition no longer met

### External MQTT Node (TbMqttNode)

```json
{
  "type": "org.thingsboard.rule.engine.mqtt.TbMqttNode",
  "name": "TTN MQTT Publish",
  "configuration": {
    "topicPattern": "v3/${APP_ID}/devices/${deviceName}/down/push",
    "host": "${TTN_MQTT_HOST}",
    "port": 8883,
    "connectTimeoutSec": 10,
    "clientId": null,
    "cleanSession": true,
    "ssl": true,
    "retainedMessage": false,
    "parseToPlainText": false,
    "protocolVersion": "MQTT_3_1_1",
    "credentials": {
      "type": "basic",
      "username": "${TTN_MQTT_USER}",
      "password": "${TTN_MQTT_PASS}"
    }
  },
  "singletonMode": true,
  "configurationVersion": 2
}
```

Key details:
- `configurationVersion`: MUST be `2` for TB 4.x
- `singletonMode`: `true` -- only one MQTT connection per rule engine instance
- `clientId`: `null` -- let broker assign (avoids collision with other clients)
- `protocolVersion`: `"MQTT_3_1_1"` -- must match root chain pattern
- `${deviceName}` in topic: dynamically replaced from message metadata
- `ssl: true` with `port: 8883` for TLS connections

### Log Node

```json
{
  "type": "org.thingsboard.rule.engine.action.TbLogNode",
  "name": "Log Other",
  "configuration": {
    "scriptLang": "TBEL",
    "tbelScript": "return '\\nIncoming message:\\n' + JSON.stringify(msg) + '\\nMetadata: ' + JSON.stringify(metadata);",
    "jsScript": "return '\\nIncoming message:\\n' + JSON.stringify(msg) + '\\nMetadata: ' + JSON.stringify(metadata);"
  },
  "configurationVersion": 0
}
```

## Connection Types

### From Message Type Switch

These are the output labels from the Message Type Switch node:

| Label | Message Type | Trigger |
|-------|-------------|---------|
| `Post telemetry` | POST_TELEMETRY_REQUEST | Device sends telemetry |
| `Post attributes` | POST_ATTRIBUTES_REQUEST | Device sends client attributes |
| `RPC Request to Device` | RPC_CALL_FROM_SERVER_TO_DEVICE | Server-to-device RPC |
| `RPC Request from Device` | RPC_CALL_FROM_DEVICE_TO_SERVER | Device-to-server RPC |
| `Attributes Updated` | ATTRIBUTES_UPDATED | Attribute change notification |
| `Activity Event` | ACTIVITY_EVENT | Device activity/inactivity |
| `Inactivity Event` | INACTIVITY_EVENT | Device inactivity |
| `Connect Event` | CONNECT_EVENT | Device connected |
| `Disconnect Event` | DISCONNECT_EVENT | Device disconnected |
| `Entity Created` | ENTITY_CREATED | New entity created |
| `Entity Updated` | ENTITY_UPDATED | Entity modified |
| `Entity Deleted` | ENTITY_DELETED | Entity removed |
| `Other` | (everything else) | Catch-all |

### General Connection Types

| Type | Description |
|------|-------------|
| `Success` | Node processed successfully |
| `Failure` | Node processing failed |
| `True` / `False` | Filter node output |
| `Alarm Created` | Device Profile node: new alarm |
| `Alarm Updated` | Device Profile node: alarm updated |
| `Alarm Severity Updated` | Device Profile node: severity changed |
| `Alarm Cleared` | Device Profile node: alarm cleared |

## Common Rule Chain Patterns

### Pattern 1: Telemetry with Calculated Fields

```
[0] Message Type Switch
  --"Post telemetry"--> [1] Transform (calculate power_watts, energy)
    --"Success"--> [2] Save Timeseries
```

TBEL for energy calculation:

```
msg.power_watts = msg.supply_voltage * msg.light_src_current / 1000.0;
msg.energy_wh_increment = msg.power_watts * (msg.operating_time / 3600.0);
return {msg: msg, metadata: metadata, msgType: msgType};
```

### Pattern 2: RPC to External MQTT (Downlink)

```
[0] Message Type Switch
  --"RPC Request to Device"--> [5] Transform (encode DALI command)
    --"Success"--> [6] External MQTT (publish to TTN)
```

TBEL for DALI dimming:

```
var dimValue = msg.params;
var base64Payload = bytesToBase64([0x84, 0x01, dimValue]);
var downlink = new JSON();
downlink.downlinks = [{f_port: 8, frm_payload: base64Payload, priority: "NORMAL"}];
return {msg: downlink, metadata: metadata, msgType: msgType};
```

### Pattern 3: Alarm Evaluation Pipeline

```
[0] Message Type Switch
  --"Post telemetry"--> [4] Device Profile Node
    --"Success"--> [2] Save Timeseries
    --"Alarm Created"--> [10] Notification Handler
    --"Alarm Cleared"--> [10] Notification Handler
```

### Pattern 4: Server Attribute from RPC

```
[0] Message Type Switch
  --"RPC Request to Device"--> [7] Transform (extract dim level)
    --"Success"--> [8] Save Attributes (SERVER_SCOPE)
```

TBEL to extract RPC param as attribute:

```
var newMsg = new JSON();
newMsg.dimLevel = msg.params;
return {msg: newMsg, metadata: metadata, msgType: msgType};
```

### Pattern 5: Parallel Processing

Multiple connections from the same node output run IN PARALLEL.

```
[0] Message Type Switch
  --"Post telemetry"--> [1] Energy Calculator     (runs in parallel)
  --"Post telemetry"--> [4] Device Profile Node   (runs in parallel)
```

Both [1] and [4] receive the same message simultaneously.

Similarly for RPC:
```
[0] Message Type Switch
  --"RPC Request to Device"--> [5] Dim Downlink (encode + MQTT)  (parallel)
  --"RPC Request to Device"--> [7] Save Dim Level (attribute)    (parallel)
```

This is how one RPC request can simultaneously send a DALI command AND save the dim level.

## TBEL Scripting Guide

### Available Variables

| Variable | Description |
|----------|-------------|
| `msg` | Message payload (JSON object) |
| `metadata` | Message metadata (string key-value pairs) |
| `msgType` | Message type string |

### Return Format

Transform nodes MUST return:

```
return {msg: msg, metadata: metadata, msgType: msgType};
```

Or with a new message:

```
var newMsg = new JSON();
newMsg.key = "value";
return {msg: newMsg, metadata: metadata, msgType: msgType};
```

### TBEL Built-in Functions

| Function | Description |
|----------|-------------|
| `bytesToBase64(byteArray)` | Convert byte array to base64 string |
| `JSON.stringify(obj)` | Serialize object to JSON string |
| `JSON.parse(str)` | Parse JSON string to object |
| `parseInt(str)` | Parse integer |
| `parseFloat(str)` | Parse float |
| `Math.round(n)` | Round number |
| `Math.abs(n)` | Absolute value |
| `new JSON()` | Create empty JSON object |

### TBEL Gotchas (Critical)

1. **No regex**: `/pattern/g` syntax causes "unterminated string literal". Use string comparison (`== "value"`) instead.

2. **var + if-block scope bug**: Variables assigned inside an if-block do NOT retain their value outside:
   ```
   var x = 0;
   if (cond) { x = 5; }   // x is STILL 0 after this block
   ```
   **Workaround**: Assign directly to `msg.field`:
   ```
   msg.result = 0;
   if (cond) { msg.result = 5; }   // msg.result is correctly 5
   ```

3. **Ternary with var also unreliable**: `var x = (cond) ? val1 : val2;` may not evaluate correctly.
   **Workaround**: Use `msg.result = (cond) ? val1 : val2;`

4. **No reflection**: `getClass().getName()` is blocked by the TBEL sandbox.

5. **Actor caching on compile failure**: If a TBEL script fails to compile, the actor gets stuck with exponential backoff. Fix the script, then restart ThingsBoard (`docker restart signconnect`) to clear the actor cache.

6. **Safe pattern**: Always work directly on `msg` fields:
   ```
   msg.power_watts = msg.supply_voltage * msg.light_src_current / 1000.0;
   msg.energy_wh = msg.power_watts * msg.operating_time / 3600.0;
   return {msg: msg, metadata: metadata, msgType: msgType};
   ```

## Debug Mode

Set `"debugMode": true` on individual nodes to see input/output in the Events tab.

```json
{
  "type": "org.thingsboard.rule.engine.transform.TbTransformMsgNode",
  "name": "Energy Calculator",
  "debugMode": true,
  "configuration": { ... }
}
```

View debug events via API:

```
GET ${TB_HOST}/api/events/RULE_NODE/${NODE_ID}/DEBUG_RULE_NODE?pageSize=10&page=0&sortOrder=DESC
```

**Performance impact**: Debug mode stores every message in/out. Disable in production.

## Optimistic Locking

Rule chain metadata uses optimistic locking. The workflow:

1. `GET /api/ruleChain/${RULE_CHAIN_ID}/metadata` -- get current state
2. Modify nodes/connections as needed
3. `POST /api/ruleChain/metadata` -- save changes
4. If 409 Conflict: re-GET and retry

The version field is on the rule chain entity itself, not the metadata.

## Node Index System

Nodes are referenced by their zero-based index in the `nodes` array. Connections use `fromIndex` and `toIndex`.

**Important**: When adding/removing nodes, all connection indices must be recalculated. The safest approach is to rebuild the entire nodes array and connections array together.

Example with 3 nodes:

```json
{
  "nodes": [
    {"name": "Message Type Switch", ...},
    {"name": "Save Timeseries", ...},
    {"name": "Log", ...}
  ],
  "connections": [
    {"fromIndex": 0, "toIndex": 1, "type": "Post telemetry"},
    {"fromIndex": 0, "toIndex": 2, "type": "Other"}
  ],
  "firstNodeIndex": 0
}
```

`firstNodeIndex`: which node receives messages entering the rule chain (usually 0 for Message Type Switch).

## Rule Chain Assignment

### Assign to Device Profile

A device profile specifies which rule chain its devices use:

```json
{
  "name": "My Profile",
  "type": "DEFAULT",
  "defaultRuleChainId": {
    "entityType": "RULE_CHAIN",
    "id": "${RULE_CHAIN_ID}"
  }
}
```

POST to `/api/deviceProfile`.

### RPC Routing

When a device has a custom profile with a custom rule chain, RPC messages are routed through THAT rule chain, not the root chain. This is critical for device-specific RPC handling.

## Complete Rule Chain Build Example (Python)

```python
import requests
import os

TB_URL = os.environ.get("TB_URL", "http://localhost:8080")

def get_token():
    resp = requests.post(f"{TB_URL}/api/auth/login",
                         json={"username": os.environ["TB_USERNAME"],
                               "password": os.environ["TB_PASSWORD"]})
    resp.raise_for_status()
    return resp.json()["token"]

def create_rule_chain(token, name):
    headers = {"X-Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Create rule chain
    rc = requests.post(f"{TB_URL}/api/ruleChain",
                       json={"name": name, "type": "CORE", "debugMode": False, "root": False},
                       headers=headers).json()
    rc_id = rc["id"]["id"]

    # Set metadata
    metadata = {
        "ruleChainId": {"entityType": "RULE_CHAIN", "id": rc_id},
        "firstNodeIndex": 0,
        "nodes": [
            {
                "type": "org.thingsboard.rule.engine.filter.TbMsgTypeSwitchNode",
                "name": "Message Type Switch",
                "debugMode": False,
                "singletonMode": False,
                "configurationVersion": 0,
                "configuration": {}
            },
            {
                "type": "org.thingsboard.rule.engine.telemetry.TbMsgTimeseriesNode",
                "name": "Save Timeseries",
                "debugMode": False,
                "singletonMode": False,
                "configurationVersion": 0,
                "configuration": {"defaultTTL": 0}
            }
        ],
        "connections": [
            {"fromIndex": 0, "toIndex": 1, "type": "Post telemetry"}
        ],
        "ruleChainConnections": None
    }

    requests.post(f"{TB_URL}/api/ruleChain/metadata",
                  json=metadata, headers=headers).raise_for_status()

    return rc_id
```

Reference template: `/opt/thingsboard/.claude/templates/rule_chain_skeleton.json`
