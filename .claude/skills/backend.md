# ThingsBoard Backend Guide

## Overview

Java 17 Spring Boot 3.4.10 application with Akka actors, gRPC communication, and multi-protocol IoT support.

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Java | 17+ | Runtime |
| Spring Boot | 3.4.10 | Framework |
| Akka | 2.6.x | Actor System |
| gRPC | 1.58+ | Service Communication |
| Protocol Buffers | 3.x | Serialization |
| Hibernate | 6.x | ORM |

## Package Structure

```
org.thingsboard.server/
├── controller/           # REST API controllers (68 controllers)
├── service/              # Business logic services (100+ services)
├── actors/               # Akka actor system
├── queue/                # Message queue handling
├── transport/            # Protocol transports
├── dao/                  # Data access layer
└── config/               # Spring configuration
```

## REST Controllers

### Location
`application/src/main/java/org/thingsboard/server/controller/`

### Key Controllers

| Controller | Endpoints | Purpose |
|------------|-----------|---------|
| `AuthController` | `/api/auth/*` | Authentication |
| `DeviceController` | `/api/device/*` | Device CRUD |
| `TelemetryController` | `/api/plugins/telemetry/*` | Telemetry API |
| `DashboardController` | `/api/dashboard/*` | Dashboard management |
| `RuleChainController` | `/api/ruleChain/*` | Rule chains |
| `AlarmController` | `/api/alarm/*` | Alarm handling |
| `AssetController` | `/api/asset/*` | Asset management |
| `CustomerController` | `/api/customer/*` | Customer CRUD |
| `TenantController` | `/api/tenant/*` | Tenant management |
| `UserController` | `/api/user/*` | User management |
| `EntityViewController` | `/api/entityView/*` | Entity views |
| `WidgetTypeController` | `/api/widgetType/*` | Widget types |
| `WidgetsBundleController` | `/api/widgetsBundle/*` | Widget bundles |

### API Patterns

```java
@RestController
@RequestMapping("/api")
public class DeviceController extends BaseController {

    @GetMapping("/device/{deviceId}")
    public Device getDeviceById(@PathVariable DeviceId deviceId) {
        // Implementation
    }

    @PostMapping("/device")
    public Device saveDevice(@RequestBody Device device) {
        // Implementation
    }
}
```

## Services

### Location
`application/src/main/java/org/thingsboard/server/service/`

### Key Services

| Service | Purpose |
|---------|---------|
| `DeviceService` | Device lifecycle management |
| `TelemetryService` | Telemetry data handling |
| `RuleEngineService` | Rule engine processing |
| `AlarmService` | Alarm creation and management |
| `AuthService` | Authentication logic |
| `NotificationService` | Push notifications |
| `OtaPackageService` | OTA firmware updates |
| `EdgeService` | Edge node management |

### Service Pattern

```java
@Service
public class DeviceServiceImpl implements DeviceService {

    @Autowired
    private DeviceDao deviceDao;

    @Override
    public Device saveDevice(Device device) {
        // Validation
        // Business logic
        // Persistence
        return deviceDao.save(device);
    }
}
```

## Actor System

### Architecture
```
AppActor (root)
├── TenantActor (per tenant)
│   ├── DeviceActor (per device)
│   ├── RuleChainActor
│   │   └── RuleNodeActor (per node)
│   └── CalculatedFieldManagerActor
├── StatsActor
└── RuleChainErrorActor
```

### Location
`application/src/main/java/org/thingsboard/server/actors/`

### Key Actor Classes

| Actor | Purpose |
|-------|---------|
| `AppActor` | Root actor, system lifecycle |
| `TenantActor` | Tenant-level message routing |
| `DeviceActor` | Device state, RPC handling |
| `RuleChainActor` | Rule chain execution |
| `RuleNodeActor` | Individual rule node processing |

### Message Flow

```
Device Message → TenantActor → DeviceActor → RuleChainActor
                                    ↓
                              RuleNodeActor → Next Node → ... → Output
```

## Transport Protocols

### HTTP Transport
`transport/http/` - REST API for telemetry ingestion

### MQTT Transport
`transport/mqtt/` - MQTT broker implementation
- Supports MQTT 3.1.1 and 5.0
- TLS/SSL encryption
- Device authentication

### CoAP Transport
`transport/coap/` - CoAP protocol for constrained devices

### LwM2M Transport
`transport/lwm2m/` - LightweightM2M for device management

### SNMP Transport
`transport/snmp/` - SNMP polling and traps

## Configuration

### Main Config
`application/src/main/resources/application.yml`

### Key Properties

```yaml
# Server
server:
  port: 8080

# Database
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/thingsboard
    username: postgres
    password: postgres

# Queue
queue:
  type: kafka  # in-memory, kafka, rabbitmq, aws-sqs

# Cache
cache:
  type: redis  # caffeine, redis

# Transport
transport:
  mqtt:
    enabled: true
    bind_port: 1883
  http:
    enabled: true
  coap:
    enabled: true
    bind_port: 5683
```

## Security

### Authentication Methods
1. **JWT Tokens** - Default, stateless
2. **OAuth 2.0** - Social login, SSO
3. **LDAP** - Enterprise directory integration
4. **Two-Factor Auth** - TOTP support

### Authorization
- Role-based access control (RBAC)
- Tenant isolation
- Entity permissions
- API rate limiting

### Device Authentication
1. Access token (default)
2. X.509 certificates
3. Basic credentials

## Queue System

### Supported Queues

| Queue | Use Case |
|-------|----------|
| In-Memory | Development |
| Kafka | Production (default) |
| RabbitMQ | Alternative |
| AWS SQS | Cloud deployment |
| Azure Service Bus | Azure deployment |
| Google Pub/Sub | GCP deployment |

### Queue Topics

```
tb_core           # Core service messages
tb_rule_engine    # Rule engine processing
tb_transport      # Transport layer
tb_notifications  # Push notifications
```

## gRPC Communication

### Proto Files
`common/proto/src/main/proto/`

### Key Services
- `ClusterService` - Node-to-node communication
- `TransportService` - Transport to core messaging
- `RuleEngineService` - Rule processing

## Email Templates

### Location
`application/src/main/resources/templates/`

### Key Templates

| Template | Purpose |
|----------|---------|
| `activation.ftl` | Account activation |
| `reset.password.ftl` | Password reset |
| `test.ftl` | Test email |

### FreeMarker Syntax
```ftl
Dear ${targetEmail},

Click <a href="${activationLink}">here</a> to activate.

${company}
```

## Build Commands

```bash
# Full backend build
mvn clean install -DskipTests

# Skip UI
mvn clean install -DskipTests -pl '!ui-ngx'

# Specific module
mvn clean install -DskipTests -pl application

# With tests
mvn clean install

# Generate Docker images
mvn clean install -DskipTests -Ddockerfile.skip=false
```

## Debugging

### Enable Debug Logging
```yaml
logging:
  level:
    org.thingsboard: DEBUG
```

### Remote Debug
```bash
java -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005 -jar application.jar
```

### JMX Monitoring
```bash
java -Dcom.sun.management.jmxremote \
     -Dcom.sun.management.jmxremote.port=9999 \
     -jar application.jar
```
