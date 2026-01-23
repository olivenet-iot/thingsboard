# ThingsBoard Database Guide

## Overview

PostgreSQL-based persistence with optional Cassandra/TimescaleDB for time-series data. Uses Hibernate ORM with custom DAO layer.

## Database Options

| Database | Use Case | Time-Series |
|----------|----------|-------------|
| PostgreSQL | Default, all data | Basic TS support |
| PostgreSQL + TimescaleDB | Enhanced time-series | Hypertables |
| PostgreSQL + Cassandra | High-volume time-series | Distributed TS |

## Schema Files

### Location
`dao/src/main/resources/sql/`

### Key Files

| File | Purpose |
|------|---------|
| `schema-entities.sql` | Core entity tables |
| `schema-entities-idx.sql` | Indexes for entities |
| `schema-ts-psql.sql` | Time-series (PostgreSQL) |
| `schema-ts-psql-idx.sql` | Time-series indexes |
| `schema-ts-hsql.sql` | Time-series (HSQL for tests) |

## Core Entity Tables

### Tenant & User

```sql
-- Tenants (organizations)
CREATE TABLE tenant (
    id UUID PRIMARY KEY,
    created_time BIGINT,
    title VARCHAR(255),
    region VARCHAR(255),
    country VARCHAR(2),
    tenant_profile_id UUID
);

-- Users
CREATE TABLE tb_user (
    id UUID PRIMARY KEY,
    tenant_id UUID,
    customer_id UUID,
    email VARCHAR(255) UNIQUE,
    authority VARCHAR(50),  -- SYS_ADMIN, TENANT_ADMIN, CUSTOMER_USER
    first_name VARCHAR(255),
    last_name VARCHAR(255)
);
```

### Device & Asset

```sql
-- Devices
CREATE TABLE device (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    customer_id UUID,
    device_profile_id UUID NOT NULL,
    name VARCHAR(255),
    type VARCHAR(255),
    label VARCHAR(255)
);

-- Assets
CREATE TABLE asset (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    customer_id UUID,
    asset_profile_id UUID NOT NULL,
    name VARCHAR(255),
    type VARCHAR(255),
    label VARCHAR(255)
);
```

### Device Credentials

```sql
CREATE TABLE device_credentials (
    id UUID PRIMARY KEY,
    device_id UUID UNIQUE,
    credentials_type VARCHAR(255),  -- ACCESS_TOKEN, X509_CERTIFICATE, etc.
    credentials_id VARCHAR(1000) UNIQUE,
    credentials_value VARCHAR(2000)
);
```

### Telemetry & Attributes

```sql
-- Attributes (key-value store)
CREATE TABLE attribute_kv (
    entity_id UUID,
    attribute_type VARCHAR(255),  -- CLIENT_SCOPE, SERVER_SCOPE, SHARED_SCOPE
    attribute_key VARCHAR(255),
    bool_v BOOLEAN,
    str_v VARCHAR(10000000),
    long_v BIGINT,
    dbl_v DOUBLE PRECISION,
    json_v JSON,
    last_update_ts BIGINT,
    PRIMARY KEY (entity_id, attribute_type, attribute_key)
);

-- Time-series (PostgreSQL)
CREATE TABLE ts_kv (
    entity_id UUID NOT NULL,
    key INT NOT NULL,
    ts BIGINT NOT NULL,
    bool_v BOOLEAN,
    str_v VARCHAR(10000000),
    long_v BIGINT,
    dbl_v DOUBLE PRECISION,
    json_v JSON,
    PRIMARY KEY (entity_id, key, ts)
);
```

### Rule Engine

```sql
-- Rule Chains
CREATE TABLE rule_chain (
    id UUID PRIMARY KEY,
    tenant_id UUID,
    name VARCHAR(255),
    type VARCHAR(32),  -- CORE, EDGE
    root BOOLEAN DEFAULT FALSE,
    debug_mode BOOLEAN DEFAULT FALSE,
    configuration VARCHAR(10000000)
);

-- Rule Nodes
CREATE TABLE rule_node (
    id UUID PRIMARY KEY,
    rule_chain_id UUID,
    type VARCHAR(255),
    name VARCHAR(255),
    debug_mode BOOLEAN,
    configuration VARCHAR(10000000)
);
```

### Alarms

```sql
CREATE TABLE alarm (
    id UUID PRIMARY KEY,
    tenant_id UUID,
    originator_id UUID,
    originator_type VARCHAR(255),
    type VARCHAR(255),
    severity VARCHAR(255),  -- CRITICAL, MAJOR, MINOR, WARNING, INDETERMINATE
    status VARCHAR(255),    -- ACTIVE, CLEARED, ACK
    start_ts BIGINT,
    end_ts BIGINT,
    ack_ts BIGINT,
    clear_ts BIGINT,
    details VARCHAR(10000000)
);
```

### Dashboard

```sql
CREATE TABLE dashboard (
    id UUID PRIMARY KEY,
    tenant_id UUID,
    title VARCHAR(255),
    configuration VARCHAR(10000000)  -- JSON with widgets, layout
);
```

### Widget Bundle & Type

```sql
CREATE TABLE widgets_bundle (
    id UUID PRIMARY KEY,
    tenant_id UUID,
    title VARCHAR(255),
    alias VARCHAR(255) UNIQUE,
    image TEXT
);

CREATE TABLE widget_type (
    id UUID PRIMARY KEY,
    tenant_id UUID,
    bundle_alias VARCHAR(255),
    alias VARCHAR(255),
    name VARCHAR(255),
    descriptor VARCHAR(10000000)  -- Widget configuration JSON
);
```

## DAO Layer

### Location
`dao/src/main/java/org/thingsboard/server/dao/`

### Package Structure

```
dao/
├── device/
│   ├── DeviceDao.java
│   ├── DeviceServiceImpl.java
│   └── DeviceCredentialsDao.java
├── asset/
├── tenant/
├── user/
├── customer/
├── dashboard/
├── rule/
├── alarm/
├── attributes/
├── timeseries/
├── relation/
└── widget/
```

### DAO Pattern

```java
public interface DeviceDao extends Dao<Device> {

    Device findById(TenantId tenantId, UUID id);

    Device findByTenantIdAndName(UUID tenantId, String name);

    PageData<Device> findDevicesByTenantId(UUID tenantId, PageLink pageLink);

    Device save(TenantId tenantId, Device device);
}
```

### JPA Repository

```java
@Repository
public interface DeviceRepository extends JpaRepository<DeviceEntity, UUID> {

    @Query("SELECT d FROM DeviceEntity d WHERE d.tenantId = :tenantId")
    Page<DeviceEntity> findByTenantId(@Param("tenantId") UUID tenantId, Pageable pageable);

    Optional<DeviceEntity> findByTenantIdAndName(UUID tenantId, String name);
}
```

## Time-Series Storage

### PostgreSQL (Default)

```sql
-- Basic time-series
SELECT * FROM ts_kv
WHERE entity_id = :deviceId
  AND key = :keyId
  AND ts BETWEEN :startTs AND :endTs
ORDER BY ts DESC;
```

### TimescaleDB Extension

```sql
-- Convert to hypertable
SELECT create_hypertable('ts_kv', 'ts',
    chunk_time_interval => 86400000);  -- 1 day chunks

-- Aggregation query
SELECT time_bucket('1 hour', to_timestamp(ts/1000)) AS bucket,
       AVG(dbl_v) as avg_value
FROM ts_kv
WHERE entity_id = :deviceId
GROUP BY bucket
ORDER BY bucket;
```

### Cassandra (Optional)

```sql
-- Cassandra schema
CREATE TABLE ts_kv_cf (
    entity_id timeuuid,
    key text,
    partition bigint,
    ts bigint,
    bool_v boolean,
    str_v text,
    long_v bigint,
    dbl_v double,
    json_v text,
    PRIMARY KEY ((entity_id, key, partition), ts)
) WITH CLUSTERING ORDER BY (ts DESC);
```

## Migrations

### Migration Location
`application/src/main/data/upgrade/`

### Migration Naming
`{from_version}__{to_version}.sql`

### Running Migrations

```bash
# Via upgrade script
./docker/docker-upgrade-tb.sh --fromVersion=3.5.0

# Via install script (fresh)
./docker/docker-install-tb.sh --loadDemo
```

## Connection Configuration

### PostgreSQL

```yaml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/thingsboard
    username: postgres
    password: postgres
    hikari:
      maximum-pool-size: 50
```

### Redis Cache

```yaml
cache:
  type: redis

redis:
  connection:
    type: standalone
    host: localhost
    port: 6379
```

## Entity Relationships

```
Tenant
├── Customer
│   └── User (CUSTOMER_USER)
├── User (TENANT_ADMIN)
├── Device
│   ├── DeviceCredentials
│   └── DeviceProfile
├── Asset
│   └── AssetProfile
├── Dashboard
├── RuleChain
│   └── RuleNode
├── WidgetsBundle
│   └── WidgetType
└── Alarm
```

## Common Queries

### Get Device with Latest Telemetry

```sql
SELECT d.*,
       (SELECT dbl_v FROM ts_kv
        WHERE entity_id = d.id AND key = (SELECT key_id FROM ts_kv_dictionary WHERE key = 'temperature')
        ORDER BY ts DESC LIMIT 1) as temperature
FROM device d
WHERE d.tenant_id = :tenantId;
```

### Get Alarms by Severity

```sql
SELECT * FROM alarm
WHERE tenant_id = :tenantId
  AND severity IN ('CRITICAL', 'MAJOR')
  AND status = 'ACTIVE_UNACK'
ORDER BY start_ts DESC;
```

### Entity Relations

```sql
SELECT * FROM relation
WHERE from_id = :entityId
  AND relation_type = 'Contains';
```

## Performance Tips

### Indexing
- Entity tables indexed by tenant_id
- Time-series indexed by (entity_id, key, ts)
- Use partial indexes for active records

### Partitioning
- ts_kv partitioned by time (daily/weekly)
- Use TimescaleDB automatic chunking

### Connection Pooling
- HikariCP with appropriate pool size
- Tune based on CPU cores
