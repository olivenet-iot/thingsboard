# ThingsBoard Architecture Guide

## Overview

ThingsBoard is a sophisticated IoT platform (v4.4.0-SNAPSHOT) white-labeled as **SignConnect** by Lumosoft.

## Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Backend | Spring Boot | 3.4.10 |
| Frontend | Angular | 18.2.13 |
| Database | PostgreSQL | 16 |
| Cache | Redis/Valkey | 8.0 |
| Queue | Kafka | 3.9.1 |
| Build | Maven/Yarn | 3.6+/1.22 |

## Module Hierarchy

```
netty-mqtt (custom MQTT library)
    ↓
common/ (15 submodules)
├── data, proto, util, message
├── actor, queue, transport
├── dao-api, cluster-api
├── stats, cache, script
└── edge-api, version-control, discovery-api
    ↓
rule-engine/ (2 modules)
├── rule-engine-api
└── rule-engine-components (50+ built-in nodes)
    ↓
dao/ (Data Access Layer)
    ↓
transport/ (5 protocols)
├── http, mqtt, coap, lwm2m, snmp
    ↓
application/ (Main Spring Boot App)
    ↓
msa/ (Microservices)
├── tb-node, tb, web-ui
├── js-executor, vc-executor
└── transport services
```

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `application/src/main/java/.../controller/` | 68 REST API controllers |
| `application/src/main/java/.../service/` | 100+ business services |
| `application/src/main/java/.../actors/` | Akka actor system |
| `dao/src/main/java/.../dao/` | 45+ DAO packages |
| `ui-ngx/src/app/` | Angular application |
| `ui-ngx/src/scss/` | Styling & theming |
| `docker/` | Docker Compose configs |

## Actor System (Akka)

```
AppActor (root)
├── TenantActor (per tenant)
│   ├── DeviceActor (per device)
│   ├── RuleChainActor
│   │   └── RuleNodeActor
│   └── CalculatedFieldManagerActor
├── StatsActor
└── RuleChainErrorActor
```

## Database Schema

- **Entity tables**: `dao/src/main/resources/sql/schema-entities.sql`
- **Time-series**: `dao/src/main/resources/sql/schema-ts-psql.sql`
- **Indexes**: `dao/src/main/resources/sql/schema-entities-idx.sql`

## Message Flow

```
Device → Transport → Auth → Queue (Kafka) → Core Service
    → Rule Engine → Persistence → WebSocket → Dashboard
```

## Build Commands

```bash
# Full build
./build.sh

# Backend only
mvn clean install -DskipTests -pl '!ui-ngx'

# Frontend only
cd ui-ngx && yarn build:prod

# With Docker images
mvn clean install -DskipTests -Ddockerfile.skip=false
```
