# ThingsBoard Rule Engine Guide

## Overview

Visual rule-based data processing engine with 50+ built-in nodes for filtering, transforming, and routing IoT data.

## Architecture

```
Message → Rule Chain → Rule Nodes → Actions
              ↓
         Node 1 → Node 2 → Node 3 → Output
              ↓
         Failure → Error Handler
```

## Rule Chain Structure

### Components
1. **Input Node** - Entry point for messages
2. **Filter Nodes** - Conditional routing
3. **Enrichment Nodes** - Add data context
4. **Transform Nodes** - Modify messages
5. **Action Nodes** - External actions
6. **Output Nodes** - Send results

### Message Types
- `POST_TELEMETRY_REQUEST` - Telemetry data
- `POST_ATTRIBUTES_REQUEST` - Attribute updates
- `ATTRIBUTES_UPDATED` - Attribute change events
- `RPC_CALL_FROM_SERVER_TO_DEVICE` - RPC requests
- `ALARM` - Alarm events

## Built-in Rule Nodes

### Filter Nodes

| Node | Purpose |
|------|---------|
| `Script` | JavaScript filter |
| `Switch` | Route by condition |
| `Message Type` | Filter by message type |
| `Originator Type` | Filter by entity type |
| `Check Relation` | Check entity relations |
| `Check Existence Fields` | Validate fields exist |

### Enrichment Nodes

| Node | Purpose |
|------|---------|
| `Originator Attributes` | Fetch entity attributes |
| `Related Attributes` | Fetch related entity data |
| `Customer Attributes` | Fetch customer data |
| `Tenant Attributes` | Fetch tenant data |
| `Device Profile` | Get device profile |
| `Calculate Delta` | Compute value changes |

### Transform Nodes

| Node | Purpose |
|------|---------|
| `Script` | JavaScript transformation |
| `To Email` | Format email message |
| `Change Originator` | Change message source |
| `Rename Keys` | Rename message fields |
| `Delete Keys` | Remove fields |

### Action Nodes

| Node | Purpose |
|------|---------|
| `Save Telemetry` | Persist telemetry |
| `Save Attributes` | Update attributes |
| `Create Alarm` | Generate alarm |
| `Clear Alarm` | Resolve alarm |
| `RPC Call Request` | Send device RPC |
| `Save to Custom Table` | Custom DB write |
| `REST API Call` | External API call |
| `Send Email` | SMTP email |
| `Send SMS` | Twilio/AWS SNS |
| `Kafka/RabbitMQ` | Queue integration |

### External Integration Nodes

| Node | Purpose |
|------|---------|
| `AWS S3` | S3 storage |
| `AWS SQS` | SQS queue |
| `AWS SNS` | SNS notifications |
| `Azure IoT Hub` | Azure integration |
| `Google Pub/Sub` | GCP messaging |
| `MQTT` | MQTT publish |
| `HTTP` | HTTP requests |

## Rule Node Development

### Location
`rule-engine/rule-engine-components/src/main/java/org/thingsboard/rule/engine/`

### Node Structure

```java
@RuleNode(
    type = ComponentType.FILTER,
    name = "my filter",
    configClazz = MyFilterNodeConfiguration.class
)
public class MyFilterNode implements TbNode {

    @Override
    public void init(TbContext ctx, TbNodeConfiguration configuration) {
        // Initialize node
    }

    @Override
    public void onMsg(TbContext ctx, TbMsg msg) {
        // Process message
        if (condition) {
            ctx.tellNext(msg, "True");
        } else {
            ctx.tellNext(msg, "False");
        }
    }

    @Override
    public void destroy() {
        // Cleanup
    }
}
```

### Configuration Class

```java
@Data
public class MyFilterNodeConfiguration implements NodeConfiguration<MyFilterNodeConfiguration> {

    private String script;
    private int threshold;

    @Override
    public MyFilterNodeConfiguration defaultConfiguration() {
        MyFilterNodeConfiguration config = new MyFilterNodeConfiguration();
        config.setThreshold(100);
        return config;
    }
}
```

### Message Context (TbContext)

```java
// Route to success
ctx.tellSuccess(msg);

// Route to failure
ctx.tellFailure(msg, exception);

// Route to specific relation
ctx.tellNext(msg, "RelationName");

// Transform and forward
TbMsg newMsg = TbMsg.transformMsg(msg, newMetadata, newData);
ctx.tellSuccess(newMsg);

// Create alarm
ctx.alarmService().createOrUpdateAlarm(alarm);

// Fetch attributes
ctx.getAttributesService().find(entityId, scope, keys);
```

## JavaScript in Rule Nodes

### Script Node Example

```javascript
// Filter: Return true to pass, false to filter out
var temperature = msg.temperature;
return temperature > 25;
```

### Transform Example

```javascript
// Transform: Return modified message
var newMsg = {};
newMsg.tempF = msg.temperature * 9/5 + 32;
newMsg.humidity = msg.humidity;
return { msg: newMsg, metadata: metadata, msgType: msgType };
```

### Available Variables

| Variable | Description |
|----------|-------------|
| `msg` | Message payload (JSON) |
| `metadata` | Message metadata |
| `msgType` | Message type string |

### Available Functions

```javascript
// Logging
log("Debug message");

// Type conversion
parseInt(value)
parseFloat(value)
JSON.stringify(obj)
JSON.parse(str)

// Date/Time
new Date()
Date.now()

// Math
Math.round()
Math.abs()
Math.max()
```

## Rule Chain Templates

### Device Telemetry Processing

```
[Input] → [Check Attributes] → [Script Filter] → [Save Telemetry]
                                      ↓
                              [Create Alarm] → [Send Notification]
```

### Alarm Handling

```
[Input] → [Check Field: alarmType] → [Create Alarm]
                                          ↓
                                    [Related Attributes]
                                          ↓
                                    [To Email] → [Send Email]
```

### Multi-Protocol Routing

```
[Input] → [Switch by Type]
              ├── Telemetry → [Save Telemetry]
              ├── Attributes → [Save Attributes]
              └── RPC → [RPC Handler]
```

## Database Schema

### Rule Chain Table
```sql
CREATE TABLE rule_chain (
    id UUID PRIMARY KEY,
    tenant_id UUID,
    name VARCHAR(255),
    type VARCHAR(32),
    root BOOLEAN,
    debug_mode BOOLEAN,
    configuration TEXT
);
```

### Rule Node Table
```sql
CREATE TABLE rule_node (
    id UUID PRIMARY KEY,
    rule_chain_id UUID,
    type VARCHAR(255),
    name VARCHAR(255),
    configuration TEXT,
    debug_mode BOOLEAN
);
```

## API Endpoints

### Rule Chain Management

```
GET    /api/ruleChain/{ruleChainId}
POST   /api/ruleChain
DELETE /api/ruleChain/{ruleChainId}
GET    /api/ruleChains
POST   /api/ruleChain/{ruleChainId}/metadata
```

### Rule Chain Activation

```
POST /api/ruleChain/{ruleChainId}/root
```

## Debugging

### Enable Debug Mode
1. Open rule chain in UI
2. Click debug toggle on node
3. View debug events in real-time

### Debug Event Data
```json
{
  "type": "IN",
  "entityId": "device-uuid",
  "msgId": "message-uuid",
  "msg": { "temperature": 25 },
  "metadata": { "deviceName": "Sensor1" },
  "error": null
}
```

### Log Statements
```javascript
// In script nodes
log("Processing: " + JSON.stringify(msg));
```

## Performance Optimization

### Best Practices
1. Minimize JavaScript nodes (use built-in when possible)
2. Use message type filters early in chain
3. Batch database operations
4. Enable debug only when needed
5. Use queue partitioning for high throughput

### Queue Configuration
```yaml
queue:
  rule-engine:
    queues:
      - name: "HighPriority"
        poll-interval: 25
      - name: "Main"
        poll-interval: 100
```
