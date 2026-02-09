<!-- Last updated: 2026-02-09 -->
<!-- Sources: @RuleNode classes in rule-engine-components, ThingsBoard official docs -->
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
  "ruleChainId": { "entityType": "RULE_CHAIN", "id": "${RULE_CHAIN_ID}" },
  "firstNodeIndex": 0,
  "nodes": [
    {
      "type": "org.thingsboard.rule.engine.filter.TbMsgTypeSwitchNode",
      "name": "Message Type Switch",
      "debugMode": false, "singletonMode": false,
      "queueName": null, "configurationVersion": 0,
      "configuration": {}
    }
  ],
  "connections": [
    { "fromIndex": 0, "toIndex": 1, "type": "Post telemetry" }
  ],
  "ruleChainConnections": null
}
```

### GET/POST/Create

- **GET metadata**: `GET ${TB_HOST}/api/ruleChain/${RULE_CHAIN_ID}/metadata`
- **Save metadata**: `POST ${TB_HOST}/api/ruleChain/metadata` (body as above)
- **Create rule chain**: `POST ${TB_HOST}/api/ruleChain` with body: `{"name":"My Chain","type":"CORE","debugMode":false,"root":false,"configuration":{"description":""}}`

Returns the created rule chain with ID. Then POST metadata separately.

## Complete Node Catalog

Base package: `org.thingsboard.rule.engine`

#### Filter Nodes (ComponentType.FILTER)

| Node Name | Class | Package | Description |
|-----------|-------|---------|-------------|
| message type switch | TbMsgTypeSwitchNode | filter | Routes messages by type (Post telemetry, Post attributes, RPC, etc.) |
| message type filter | TbMsgTypeFilterNode | filter | Filters by message type; outputs True/False |
| script (filter) | TbJsFilterNode | filter | TBEL/JS boolean filter; outputs True/False |
| switch | TbJsSwitchNode | filter | TBEL/JS returns array of connection names for routing |
| entity type switch | TbOriginatorTypeSwitchNode | filter | Routes by originator entity type (Device, Asset, etc.) |
| entity type filter | TbOriginatorTypeFilterNode | filter | Filters by originator entity type; outputs True/False |
| device profile switch | TbDeviceTypeSwitchNode | filter | Routes by device profile name |
| asset profile switch | TbAssetTypeSwitchNode | filter | Routes by asset profile name |
| check relation presence | TbCheckRelationNode | filter | Checks relation exists between originator and entity; True/False |
| check fields presence | TbCheckMessageNode | filter | Checks specified fields exist in message/metadata; True/False |
| alarm status filter | TbCheckAlarmStatusNode | filter | Checks alarm status matches configured values; True/False |
| gps geofencing filter | TbGpsGeofencingFilterNode | geo | Checks lat/lng against geofence perimeter; True/False |

#### Enrichment Nodes (ComponentType.ENRICHMENT)

| Node Name | Class | Package | Description |
|-----------|-------|---------|-------------|
| originator attributes | TbGetAttributesNode | metadata | Adds originator attributes/latest telemetry to msg or metadata |
| originator telemetry | TbGetTelemetryNode | metadata | Adds originator telemetry for time range to msg or metadata |
| originator fields | TbGetOriginatorFieldsNode | metadata | Adds originator entity fields (name, label, etc.) to msg/metadata |
| related entity data | TbGetRelatedAttributeNode | metadata | Adds related entity attributes/telemetry via relation query |
| related device attributes | TbGetDeviceAttrNode | metadata | Adds related device attributes/telemetry via relation query |
| tenant attributes | TbGetTenantAttributeNode | metadata | Adds tenant attributes or latest telemetry |
| tenant details | TbGetTenantDetailsNode | metadata | Adds tenant contact info (email, phone, address) |
| customer attributes | TbGetCustomerAttributeNode | metadata | Adds customer attributes or latest telemetry |
| customer details | TbGetCustomerDetailsNode | metadata | Adds customer contact info (email, phone, address) |
| fetch device credentials | TbFetchDeviceCredentialsNode | metadata | Adds credentialsType and credentials to msg/metadata |
| calculate delta | CalculateDeltaNode | metadata | Calculates delta between current and previous ts reading |

#### Transformation Nodes (ComponentType.TRANSFORMATION)

| Node Name | Class | Package | Description |
|-----------|-------|---------|-------------|
| script (transform) | TbTransformMsgNode | transform | TBEL/JS transform of msg, metadata, msgType |
| change originator | TbChangeOriginatorNode | transform | Changes originator to Tenant/Customer/Related/AlarmOriginator |
| rename keys | TbRenameKeysNode | transform | Renames keys in message or metadata |
| delete key-value pairs | TbDeleteKeysNode | transform | Deletes keys from message or metadata |
| copy key-value pairs | TbCopyKeysNode | transform | Copies keys between message and metadata |
| to email | TbMsgToEmailNode | mail | Transforms message to SEND_EMAIL type for send email node |
| split array msg | TbSplitArrayMsgNode | transform | Splits JSON array into individual messages |
| json path | TbJsonPathNode | transform | Transforms message body using JSONPath expression |
| deduplication | TbMsgDeduplicationNode | deduplication | Deduplicates messages per originator (FIRST/LAST/ALL strategy) |

#### Action Nodes (ComponentType.ACTION)

| Node Name | Class | Package | Description |
|-----------|-------|---------|-------------|
| save time series | TbMsgTimeseriesNode | telemetry | Saves message data as time-series with configurable TTL |
| save attributes | TbMsgAttributesNode | telemetry | Saves attributes with configurable scope |
| delete attributes | TbMsgDeleteAttributesNode | telemetry | Deletes specified attributes from originator |
| calculated fields and alarm rules | TbCalculatedFieldsNode | telemetry | Pushes to calculated fields/alarm rules without persisting |
| create alarm | TbCreateAlarmNode | action | Creates or updates alarm; outputs Created/Updated/False |
| clear alarm | TbClearAlarmNode | action | Clears existing alarm; outputs Cleared/False |
| log | TbLogNode | action | Logs message via TBEL/JS to rule engine console |
| rpc call request | TbSendRPCRequestNode | rpc | Sends RPC to device (expects method + params) |
| rpc call reply | TbSendRPCReplyNode | rpc | Sends reply to device RPC request |
| rest call reply | TbSendRestApiCallReplyNode | rest | Sends reply to REST API call to rule engine |
| create relation | TbCreateRelationNode | action | Creates relation between originator and target entity |
| delete relation | TbDeleteRelationNode | action | Deletes relation from originator |
| assign to customer | TbAssignToCustomerNode | action | Assigns originator entity to customer by title |
| unassign from customer | TbUnassignFromCustomerNode | action | Unassigns originator entity from customer |
| device profile (deprecated) | TbDeviceProfileNode | profile | Evaluates alarm rules from device profile |
| device state | TbDeviceStateNode | action | Triggers device connectivity events |
| message count | TbMsgCountNode | action | Counts messages per interval, outputs as telemetry |
| copy to view | TbCopyAttributesToEntityViewNode | action | Copies attributes from device/asset to entity view |
| save to custom table | TbSaveToCustomCassandraTableNode | action | Saves to Cassandra custom table (cs_tb_ prefix) |
| gps geofencing events | TbGpsGeofencingActionNode | geo | GPS geofence with Entered/Left/Inside/Outside events |
| math function | TbMathNode | math | Applies math operations (ADD, SUB, SIN, COS, CUSTOM expr) |
| generator | TbMsgGeneratorNode | debug | Periodically generates test messages via TBEL/JS |
| delay (deprecated) | TbMsgDelayNode | delay | Delays messages for configurable period |
| push to edge | TbMsgPushToEdgeNode | edge | Pushes messages from cloud to edge |
| push to cloud | TbMsgPushToCloudNode | edge | Pushes messages from edge to cloud |

#### External Nodes (ComponentType.EXTERNAL)

| Node Name | Class | Package | Description |
|-----------|-------|---------|-------------|
| rest api call | TbRestApiCallNode | rest | Calls external REST API (GET/POST/PUT/DELETE) |
| send email | TbSendEmailNode | mail | Sends email via SMTP (expects SEND_EMAIL msg type) |
| send sms | TbSendSmsNode | sms | Sends SMS via configured provider |
| mqtt | TbMqttNode | mqtt | Publishes to external MQTT broker |
| kafka | TbKafkaNode | kafka | Publishes to Kafka topic |
| rabbitmq | TbRabbitMqNode | rabbitmq | Publishes to RabbitMQ queue |
| aws sns | TbSnsNode | aws.sns | Publishes to AWS SNS topic |
| aws sqs | TbSqsNode | aws.sqs | Publishes to AWS SQS queue |
| aws lambda | TbAwsLambdaNode | aws.lambda | Invokes AWS Lambda function |
| azure iot hub | TbAzureIotHubNode | mqtt.azure | Publishes to Azure IoT Hub via MQTT |
| gcp pubsub | TbPubSubNode | gcp.pubsub | Publishes to Google Cloud Pub/Sub topic |
| send notification | TbNotificationNode | notification | Sends notification via configured template and targets |
| send to slack | TbSlackNode | notification | Sends message to Slack channel or user |
| AI request | TbAiNode | ai | Sends request to AI/LLM model with system+user prompts |

#### Flow Nodes (ComponentType.FLOW)

| Node Name | Class | Package | Description |
|-----------|-------|---------|-------------|
| rule chain | TbRuleChainInputNode | flow | Transfers message to another rule chain |
| output | TbRuleChainOutputNode | flow | Returns message to caller rule chain |
| acknowledge | TbAckNode | flow | Acknowledges message from queue |
| checkpoint | TbCheckpointNode | flow | Transfers message to another queue |

**Total: 75 nodes listed** (2 deprecated in table: device profile, delay; 2 more deprecated not listed: synchronization start/end)

## Key Node Configuration Details

### TbGetAttributesNode (originator attributes)
```json
{ "fetchTo": "METADATA", "clientAttributeNames": ["key1"],
  "serverAttributeNames": ["key2"], "sharedAttributeNames": ["key3"],
  "latestTsKeyNames": ["temp"], "getLatestValueWithTs": false, "tellFailureIfAbsent": true }
```
`fetchTo`: METADATA (default) or DATA. Attribute values added with scope prefix (e.g., `cs_key1`, `ss_key2`, `shared_key3`).

### TbGetTelemetryNode (originator telemetry)
```json
{ "latestTsKeyNames": ["temp","humidity"], "fetchMode": "FIRST",
  "orderBy": "ASC", "aggregation": "NONE", "limit": 1000,
  "startInterval": 2, "startIntervalTimeUnit": "MINUTES",
  "endInterval": 1, "endIntervalTimeUnit": "MINUTES" }
```
`fetchMode`: FIRST, LAST, or ALL. `aggregation`: NONE, MIN, MAX, AVG, SUM, COUNT. Max fetch size: 1000.

### TbChangeOriginatorNode (change originator)
```json
{ "originatorSource": "RELATED", "relationsQuery": {
    "direction": "FROM", "maxLevel": 1, "relationType": "Contains",
    "entityTypes": ["ASSET"], "fetchLastLevelOnly": false } }
```
`originatorSource`: CUSTOMER, TENANT, RELATED, ALARM_ORIGINATOR, or ENTITY (by name pattern).

### TbMsgTimeseriesNode (save time series)
```json
{ "defaultTTL": 0, "useServerTs": false,
  "processingSettings": { "type": "ON_EVERY_MESSAGE" } }
```
`processingSettings.type`: ON_EVERY_MESSAGE (default), DEDUPLICATE, or WEBSOCKET_ONLY.

### TbMsgAttributesNode (save attributes)
```json
{ "scope": "SERVER_SCOPE", "notifyDevice": false,
  "sendAttributesUpdatedNotification": false,
  "updateAttributesOnlyOnValueChange": false }
```
`scope`: CLIENT_SCOPE, SERVER_SCOPE, or SHARED_SCOPE. Set `notifyDevice: true` to push shared attributes to device.

### CalculateDeltaNode (calculate delta)
```json
{ "inputValueKey": "pulseCounter", "outputValueKey": "delta",
  "useCache": true, "addPeriodBetweenMsgs": false,
  "periodValueKey": "periodInMs", "round": null,
  "tellFailureIfDeltaIsNegative": true, "excludeZeroDeltas": false }
```
Useful for metering/consumption. Outputs: Success, Failure, Other (first message with no previous value).

### TbCreateRelationNode (create relation)
```json
{ "direction": "FROM", "relationType": "Contains",
  "entityType": "ASSET", "entityNamePattern": "${assetName}",
  "entityCacheExpiration": 300, "createEntityIfNotExists": false }
```

### TbSendEmailNode (send email)
```json
{ "useSystemSmtpSettings": true, "smtpHost": "${SMTP_HOST}",
  "smtpPort": 587, "username": "${SMTP_USER}", "password": "${SMTP_PASS}" }
```
Requires SEND_EMAIL message type. Chain `to email` node before this node.

### TbMqttNode (external MQTT)
```json
{ "topicPattern": "devices/${deviceName}/telemetry",
  "host": "${MQTT_HOST}", "port": 8883, "connectTimeoutSec": 10,
  "clientId": null, "cleanSession": true, "ssl": true,
  "retainedMessage": false, "parseToPlainText": false,
  "protocolVersion": "MQTT_3_1_1",
  "credentials": { "type": "basic", "username": "${MQTT_USER}", "password": "${MQTT_PASS}" } }
```
`configurationVersion`: **must be 2** for TB 4.x. Use `singletonMode: true` for single connection.

## Connection Types

### From Message Type Switch

| Label | Trigger |
|-------|---------|
| `Post telemetry` | Device sends telemetry |
| `Post attributes` | Device sends client attributes |
| `RPC Request to Device` | Server-to-device RPC |
| `RPC Request from Device` | Device-to-server RPC |
| `Attributes Updated` | Attribute change notification |
| `Activity Event` / `Inactivity Event` | Device activity state |
| `Connect Event` / `Disconnect Event` | Device connection state |
| `Entity Created` / `Entity Updated` / `Entity Deleted` | Entity lifecycle |
| `Other` | Catch-all for custom types |

### General Connection Types

| Type | Description |
|------|-------------|
| `Success` / `Failure` | Standard node output |
| `True` / `False` | Filter node output |
| `Alarm Created` / `Updated` / `Severity Updated` / `Cleared` | Device Profile node |
| `Created` / `Updated` / `False` | Create Alarm node |
| `Cleared` / `False` | Clear Alarm node |
| `Entered` / `Left` / `Inside` / `Outside` | GPS Geofencing Events node |

## Common Rule Chain Patterns

### Pattern 1: Telemetry with Calculated Fields
```
[0] Message Type Switch
  --"Post telemetry"--> [1] Transform (calculate power_watts)
    --"Success"--> [2] Save Timeseries
```
TBEL: `msg.power_watts = msg.supply_voltage * msg.light_src_current / 1000.0; return {msg: msg, metadata: metadata, msgType: msgType};`

### Pattern 2: RPC to External MQTT (Downlink)
```
[0] Message Type Switch
  --"RPC Request to Device"--> [5] Transform (encode payload)
    --"Success"--> [6] External MQTT
```

### Pattern 3: Alarm Evaluation Pipeline
```
[0] Message Type Switch
  --"Post telemetry"--> [4] Device Profile Node
    --"Success"--> [2] Save Timeseries
    --"Alarm Created"--> [10] Notification Handler
```

### Pattern 4: Parallel Processing
Multiple connections from the same output run **in parallel**:
```
[0] Message Type Switch
  --"Post telemetry"--> [1] Energy Calculator     (parallel)
  --"Post telemetry"--> [4] Device Profile Node   (parallel)
```

### Pattern 5: Enrichment Before Transform
```
[0] Message Type Switch
  --"Post telemetry"--> [1] Originator Attributes (fetch threshold)
    --"Success"--> [2] Script Filter (compare value vs threshold)
      --"True"--> [3] Create Alarm
```

## TBEL Scripting Guide

### Available Variables

| Variable | Description |
|----------|-------------|
| `msg` | Message payload (JSON object) |
| `metadata` | Message metadata (string key-value pairs) |
| `msgType` | Message type string |

### Return Format
Transform nodes: `return {msg: msg, metadata: metadata, msgType: msgType};`
Filter nodes: `return msg.temperature > 50;` (boolean)
Switch nodes: `return ['High', 'Critical'];` (array of connection names)

### TBEL Built-in Functions

| Function | Description |
|----------|-------------|
| `bytesToBase64(byteArray)` | Convert byte array to base64 |
| `JSON.stringify(obj)` / `JSON.parse(str)` | JSON serialize/parse |
| `parseInt(str)` / `parseFloat(str)` | Parse numbers |
| `Math.round(n)` / `Math.abs(n)` | Math functions |
| `new JSON()` | Create empty JSON object |

### TBEL Gotchas (Critical)

1. **No regex**: `/pattern/g` causes "unterminated string literal". Use `==` instead.
2. **var + if-block scope bug**: Variables assigned in if-block lose value outside. **Workaround**: assign to `msg.field` directly.
3. **Ternary with var unreliable**: Use `msg.result = (cond) ? val1 : val2;` instead.
4. **No reflection**: `getClass().getName()` blocked by sandbox.
5. **Actor caching on compile failure**: Fix script, then `docker restart signconnect` to clear cache.
6. **Safe pattern**: Always work on `msg` fields directly:
   ```
   msg.power_watts = msg.supply_voltage * msg.light_src_current / 1000.0;
   return {msg: msg, metadata: metadata, msgType: msgType};
   ```

## Debug Mode

Set `"debugMode": true` on individual nodes. View events:
```
GET ${TB_HOST}/api/events/RULE_NODE/${NODE_ID}/DEBUG_RULE_NODE?pageSize=10&page=0&sortOrder=DESC
```
**Performance impact**: Stores every message in/out. Disable in production.

## Optimistic Locking & Node Index System

1. `GET` metadata, modify, `POST` back. If 409 Conflict: re-GET and retry.
2. Nodes referenced by zero-based index. Connections use `fromIndex`/`toIndex`.
3. When adding/removing nodes, rebuild all indices. `firstNodeIndex` = entry point (usually 0).

## Rule Chain Assignment

### Assign to Device Profile
```json
{ "name": "My Profile", "type": "DEFAULT",
  "defaultRuleChainId": { "entityType": "RULE_CHAIN", "id": "${RULE_CHAIN_ID}" } }
```
POST to `/api/deviceProfile`. RPC messages route through the profile's rule chain, not root.

## Complete Rule Chain Build Example (Python)

```python
import requests, os

TB_URL = os.environ.get("TB_URL", "http://localhost:8080")

def get_token():
    resp = requests.post(f"{TB_URL}/api/auth/login",
        json={"username": os.environ["TB_USERNAME"], "password": os.environ["TB_PASSWORD"]})
    return resp.json()["token"]

def create_rule_chain(token, name):
    h = {"X-Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    rc = requests.post(f"{TB_URL}/api/ruleChain",
        json={"name": name, "type": "CORE", "debugMode": False, "root": False}, headers=h).json()
    rc_id = rc["id"]["id"]
    metadata = {
        "ruleChainId": {"entityType": "RULE_CHAIN", "id": rc_id},
        "firstNodeIndex": 0,
        "nodes": [
            {"type": "org.thingsboard.rule.engine.filter.TbMsgTypeSwitchNode",
             "name": "Message Type Switch", "debugMode": False,
             "singletonMode": False, "configurationVersion": 0, "configuration": {}},
            {"type": "org.thingsboard.rule.engine.telemetry.TbMsgTimeseriesNode",
             "name": "Save Timeseries", "debugMode": False,
             "singletonMode": False, "configurationVersion": 0,
             "configuration": {"defaultTTL": 0}}
        ],
        "connections": [{"fromIndex": 0, "toIndex": 1, "type": "Post telemetry"}],
        "ruleChainConnections": None
    }
    requests.post(f"{TB_URL}/api/ruleChain/metadata", json=metadata, headers=h).raise_for_status()
    return rc_id
```
