# ThingsBoard Architecture

This document describes the high-level architecture of ThingsBoard, including system components, data flow, and key technologies.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│  │  Web    │  │ Mobile  │  │  REST   │  │ Devices │  │  Edge   │           │
│  │   UI    │  │  Apps   │  │  API    │  │ (IoT)   │  │ Gateway │           │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘           │
└───────┼────────────┼────────────┼────────────┼────────────┼─────────────────┘
        │            │            │            │            │
        └────────────┴────────────┼────────────┴────────────┘
                                  │
┌─────────────────────────────────┴───────────────────────────────────────────┐
│                           TRANSPORT LAYER                                    │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│  │  HTTP   │  │  MQTT   │  │  CoAP   │  │  LwM2M  │  │  SNMP   │           │
│  │ :8080   │  │ :1883   │  │ :5683   │  │ :5685   │  │ :161    │           │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘           │
└───────┼────────────┼────────────┼────────────┼────────────┼─────────────────┘
        │            │            │            │            │
        └────────────┴────────────┼────────────┴────────────┘
                                  │
┌─────────────────────────────────┴───────────────────────────────────────────┐
│                           MESSAGE QUEUE                                      │
│                    ┌───────────────────────┐                                │
│                    │   Kafka / RabbitMQ    │                                │
│                    │   / In-Memory Queue   │                                │
│                    └───────────┬───────────┘                                │
└────────────────────────────────┼────────────────────────────────────────────┘
                                 │
┌────────────────────────────────┴────────────────────────────────────────────┐
│                           CORE SERVICES                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      ThingsBoard Node (tb-node)                      │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │   Actor      │  │    Rule      │  │   Device     │              │   │
│  │  │   System     │  │   Engine     │  │   Management │              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │   Alarm      │  │   REST API   │  │  WebSocket   │              │   │
│  │  │   Service    │  │   Controller │  │   Handler    │              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                 │
┌────────────────────────────────┴────────────────────────────────────────────┐
│                           DATA LAYER                                         │
│  ┌─────────────────────┐       ┌─────────────────────┐                     │
│  │     PostgreSQL      │       │   Cassandra/        │                     │
│  │   (Entities, Users, │       │   TimescaleDB       │                     │
│  │    Rules, Dashboards)│       │   (Time-series)     │                     │
│  └─────────────────────┘       └─────────────────────┘                     │
│                                                                              │
│  ┌─────────────────────┐                                                    │
│  │   Redis/Valkey      │                                                    │
│  │   (Cache, Sessions) │                                                    │
│  └─────────────────────┘                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Transport Layer

The transport layer handles device connectivity over multiple protocols.

| Protocol | Port | Use Case |
|----------|------|----------|
| **HTTP/HTTPS** | 8080/443 | REST API, Web UI, Device provisioning |
| **MQTT** | 1883/8883 | Real-time device messaging |
| **CoAP** | 5683/5684 | Constrained devices (UDP) |
| **LwM2M** | 5685/5686 | OMA Lightweight M2M |
| **SNMP** | 161/162 | Network device management |

**Source Code**: `/transport/` directory

### 2. Message Queue

Abstracts message passing between components.

| Queue Type | Use Case |
|------------|----------|
| **In-Memory** | Development, small deployments |
| **Kafka** | Production, high throughput |
| **RabbitMQ** | Alternative production queue |
| **AWS SQS** | Cloud deployments |

**Configuration**: `TB_QUEUE_TYPE` environment variable

### 3. Core Services (tb-node)

The main application containing:

#### Actor System (Akka)
- Device actors for stateful device management
- Tenant actors for multi-tenancy isolation
- Rule chain actors for event processing

**Source**: `/common/actor/`

#### Rule Engine
- Processes incoming telemetry and events
- Executes user-defined rule chains
- Supports JavaScript and TBEL (ThingsBoard Expression Language)

**Source**: `/rule-engine/`

#### REST API
- Spring Boot controllers
- JWT authentication
- Rate limiting

**Source**: `/application/src/main/java/org/thingsboard/server/controller/`

### 4. Data Layer

#### PostgreSQL (Primary Database)
Stores:
- Entities (devices, assets, customers)
- Users and permissions
- Dashboards and widgets
- Rule chains
- Alarms

#### Cassandra/TimescaleDB (Time-Series)
Stores:
- Device telemetry
- Attribute history
- Event logs

#### Redis/Valkey (Cache)
Caches:
- Session data
- Entity metadata
- Rate limit counters

**Source**: `/dao/`

## Data Flow

### Device Telemetry Flow

```
1. Device sends data via MQTT/HTTP/CoAP
              │
2. Transport service receives and validates
              │
3. Message queued (Kafka/RabbitMQ)
              │
4. tb-node consumes message
              │
5. Device actor processes message
              │
6. Rule engine executes rule chain
              │
7. Data saved to database
              │
8. WebSocket pushes to UI (if subscribed)
```

### User Request Flow

```
1. User interacts with Web UI
              │
2. Angular app makes REST API call
              │
3. Spring Security validates JWT
              │
4. Controller processes request
              │
5. Service layer executes business logic
              │
6. DAO layer persists/retrieves data
              │
7. Response returned to UI
```

## Module Structure

### Maven Modules (Build Order)

```
1. netty-mqtt        - Custom MQTT protocol handler
2. common/           - Shared libraries
   ├── data          - Domain models
   ├── proto         - Protocol Buffers
   ├── util          - Utilities
   ├── actor         - Akka actor system
   ├── queue         - Queue abstraction
   ├── transport     - Transport APIs
   ├── cache         - Caching abstraction
   ├── cluster-api   - gRPC cluster communication
   └── edge-api      - Edge computing API
3. rule-engine/      - Rule processing
   ├── rule-engine-api
   └── rule-engine-components
4. dao/              - Data access
5. edqs/             - Event-driven query service
6. transport/        - Protocol implementations
   ├── http
   ├── mqtt
   ├── coap
   ├── lwm2m
   └── snmp
7. ui-ngx/           - Angular frontend
8. tools/            - Build tools
9. application/      - Main Spring Boot app
10. msa/             - Microservices packaging
11. rest-client/     - REST client library
12. monitoring/      - Observability
```

### Microservices Architecture (msa/)

For scalable deployments:

```
┌─────────────────────────────────────────────────────────────────┐
│                      Load Balancer                               │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────┴───────┐   ┌───────┴───────┐   ┌───────┴───────┐
│   web-ui      │   │   tb-node     │   │   tb-node     │
│   (nginx)     │   │   (replica 1) │   │   (replica 2) │
└───────────────┘   └───────────────┘   └───────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────┴───────┐   ┌───────┴───────┐   ┌───────┴───────┐
│  mqtt-transport│  │ http-transport│  │  coap-transport│
└───────────────┘   └───────────────┘   └───────────────┘
```

## Frontend Architecture (ui-ngx)

### Angular Structure

```
ui-ngx/src/app/
├── core/              # Core services, auth, state
│   ├── auth/          # Authentication
│   ├── http/          # HTTP interceptors
│   ├── services/      # Core services
│   └── translate/     # i18n
├── modules/           # Feature modules
│   ├── home/          # Main application
│   │   ├── components/  # Feature components
│   │   └── pages/       # Route pages
│   ├── login/         # Authentication pages
│   └── common/        # Shared module
├── shared/            # Reusable components
│   ├── components/    # UI components
│   ├── models/        # TypeScript models
│   └── pipe/          # Angular pipes
└── app.component.ts   # Root component
```

### State Management

```
NgRx Store
    │
    ├── auth.state     # Authentication state
    ├── settings.state # User settings
    └── ...
```

### Styling Architecture

```
ui-ngx/src/
├── scss/
│   ├── constants.scss   # Breakpoints, colors
│   ├── mixins.scss      # Reusable mixins
│   └── animations.scss  # Global animations
├── theme.scss           # Material theme
├── theme-overwrites.scss # Component overrides
└── styles.scss          # Global styles
```

## Key Technologies

| Layer | Technology | Version |
|-------|------------|---------|
| **Backend** | Java | 17 |
| **Framework** | Spring Boot | 3.4.10 |
| **Concurrency** | Akka | 2.6.x |
| **RPC** | gRPC | 1.76.0 |
| **Serialization** | Protocol Buffers | 3.25.5 |
| **Frontend** | Angular | 18.2.13 |
| **UI Components** | Angular Material | 18.2.14 |
| **State** | NgRx | 18.x |
| **CSS** | Tailwind CSS | 3.4.15 |
| **Database** | PostgreSQL | 15+ |
| **Time-Series** | Cassandra/TimescaleDB | 4.x/2.x |
| **Cache** | Valkey (Redis) | 7.x |
| **Queue** | Kafka | 3.x |

## Extension Points

### Custom Rule Nodes

Create custom rule nodes by implementing:
- `TbNode` interface
- Node configuration class
- UI component for configuration

### Custom Widgets

Add widgets by creating:
- Angular component
- Widget descriptor JSON
- Settings component

### Custom Transport

Implement custom protocols by:
- Extending transport API
- Registering with transport service
- Adding Docker configuration

## Scalability Considerations

### Horizontal Scaling

- **tb-node**: Stateless, scale with load balancer
- **Transports**: Each protocol can scale independently
- **Database**: PostgreSQL with read replicas, Cassandra cluster

### Vertical Scaling

- Increase JVM heap for tb-node
- Add more threads for rule engine
- Tune database connection pools

### Performance Tuning

```yaml
# Key configuration parameters
TB_RULE_ENGINE_POOL_SIZE: 16
TB_TRANSPORT_SESSIONS_INACTIVITY_TIMEOUT: 300000
TB_TRANSPORT_RATE_LIMITS_TENANT: 1000:1,20000:60
```

## Security Architecture

### Authentication

- JWT tokens for API access
- OAuth2 support (GitHub, Google, custom)
- Two-factor authentication (TOTP)

### Authorization

- Role-based access control (RBAC)
- Tenant isolation
- Entity-level permissions

### Transport Security

- TLS/SSL for all protocols
- Device credentials (tokens, X.509)
- Access token rotation
