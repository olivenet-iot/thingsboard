# Deployment Skill

Instructions for deploying ThingsBoard with Docker.

## Quick Start

```bash
# Start single-node deployment
cd docker
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

Access at: http://localhost:8080

Default credentials:
- **Tenant Admin**: tenant@thingsboard.org / tenant
- **System Admin**: sysadmin@thingsboard.org / sysadmin

## Docker Compose Files

| File | Description |
|------|-------------|
| `docker-compose.yml` | Main single-node setup |
| `docker-compose.postgres.yml` | PostgreSQL database |
| `docker-compose.cassandra.yml` | Cassandra time-series |
| `docker-compose.kafka.yml` | Kafka message queue |
| `docker-compose.valkey.yml` | Valkey (Redis) cache |
| `docker-compose.monitoring.yml` | Prometheus + Grafana |

## Single-Node Deployment

### 1. Configure Environment

Copy and edit `.env` file:

```bash
cd docker
cp .env.example .env
```

Key variables:

```bash
# Database
DATABASE_TS_TYPE=sql
SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/thingsboard
SPRING_DATASOURCE_USERNAME=postgres
SPRING_DATASOURCE_PASSWORD=postgres

# Queue
TB_QUEUE_TYPE=in-memory

# Cache
CACHE_TYPE=caffeine

# Ports
HTTP_BIND_PORT=8080
MQTT_BIND_PORT=1883
```

### 2. Start Services

```bash
docker-compose up -d
```

### 3. Initialize Database

First run only - database schema is created automatically.

### 4. Verify Deployment

```bash
# Check containers
docker-compose ps

# Check logs
docker-compose logs -f tb-core

# Health check
curl http://localhost:8080/api/system/info
```

## Service Dependencies

```
                    ┌─────────────┐
                    │   web-ui    │
                    │   (nginx)   │
                    └──────┬──────┘
                           │
                    ┌──────┴──────┐
                    │   tb-core   │
                    │ (main app)  │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐
   │  postgres   │  │    kafka    │  │   valkey    │
   │  (database) │  │   (queue)   │  │   (cache)   │
   └─────────────┘  └─────────────┘  └─────────────┘
```

## Production Deployment

### 1. Configure for Production

```bash
# docker/.env
DATABASE_TS_TYPE=timescale  # Or cassandra for high volume
TB_QUEUE_TYPE=kafka
CACHE_TYPE=redis

# Security
JWT_TOKEN_SIGNING_KEY=your-secret-key-here
SECURITY_USER_LOGIN_CASE_SENSITIVE=true
```

### 2. Enable SSL

```yaml
# docker-compose.override.yml
services:
  tb-core:
    environment:
      - SSL_ENABLED=true
      - SSL_KEY_STORE=/ssl/keystore.p12
      - SSL_KEY_STORE_PASSWORD=your-password
    volumes:
      - ./ssl:/ssl:ro
```

### 3. Configure Volumes

```yaml
# Persistent data volumes
volumes:
  postgres-data:
  tb-data:
  tb-logs:
```

### 4. Memory Configuration

```yaml
services:
  tb-core:
    deploy:
      resources:
        limits:
          memory: 4G
        reservations:
          memory: 2G
    environment:
      - JAVA_OPTS=-Xmx2g -Xms1g
```

## Microservices Deployment

For high-availability and scalability:

### docker-compose.msa.yml

```yaml
version: '3'
services:
  tb-node-1:
    image: thingsboard/tb-node:latest
    # ...

  tb-node-2:
    image: thingsboard/tb-node:latest
    # ...

  mqtt-transport:
    image: thingsboard/tb-mqtt-transport:latest
    # ...

  http-transport:
    image: thingsboard/tb-http-transport:latest
    # ...
```

### Load Balancer

Add nginx or traefik for load balancing:

```yaml
services:
  nginx:
    image: nginx:latest
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
```

## Environment Variables Reference

### Core Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HTTP_BIND_PORT` | 8080 | HTTP API port |
| `MQTT_BIND_PORT` | 1883 | MQTT broker port |
| `COAP_BIND_PORT` | 5683 | CoAP port |
| `DATABASE_TS_TYPE` | sql | Time-series DB (sql/timescale/cassandra) |
| `TB_QUEUE_TYPE` | in-memory | Queue type |
| `CACHE_TYPE` | caffeine | Cache type (caffeine/redis) |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `SPRING_DATASOURCE_URL` | - | PostgreSQL JDBC URL |
| `SPRING_DATASOURCE_USERNAME` | postgres | DB username |
| `SPRING_DATASOURCE_PASSWORD` | postgres | DB password |

### Security

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_TOKEN_SIGNING_KEY` | - | JWT signing key |
| `JWT_TOKEN_EXPIRATION_TIME` | 9000 | Token expiry (seconds) |
| `JWT_REFRESH_TOKEN_EXPIRATION_TIME` | 604800 | Refresh token expiry |

### Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `TB_TRANSPORT_RATE_LIMITS_TENANT` | 1000:1,20000:60 | Tenant rate limit |
| `TB_TRANSPORT_RATE_LIMITS_DEVICE` | 10:1,300:60 | Device rate limit |

## Health Checks

### API Health Check

```bash
curl http://localhost:8080/api/system/info
```

### Container Health

```bash
docker-compose ps
docker-compose logs --tail=100 tb-core
```

### Prometheus Metrics

Enable monitoring:
```bash
docker-compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

Access Grafana: http://localhost:3000

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker-compose logs tb-core

# Common issues:
# - Database not ready: wait and restart
# - Port already in use: change port in .env
# - Out of memory: increase Docker memory limit
```

### Database Connection Failed

```bash
# Check PostgreSQL is running
docker-compose exec postgres pg_isready

# Check connection from tb-core
docker-compose exec tb-core nc -zv postgres 5432
```

### Out of Memory

```bash
# Increase container memory
docker-compose down
# Edit JAVA_OPTS in docker-compose.yml
docker-compose up -d
```

### Reset to Clean State

```bash
# WARNING: Destroys all data
docker-compose down -v
docker-compose up -d
```

## Backup and Restore

### Backup Database

```bash
docker-compose exec postgres pg_dump -U postgres thingsboard > backup.sql
```

### Restore Database

```bash
docker-compose exec -T postgres psql -U postgres thingsboard < backup.sql
```

### Backup Volumes

```bash
docker run --rm -v docker_postgres-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/postgres-backup.tar.gz /data
```

## Ports Reference

| Port | Protocol | Service |
|------|----------|---------|
| 8080 | HTTP | REST API, Web UI |
| 1883 | MQTT | MQTT Broker |
| 8883 | MQTTS | MQTT over TLS |
| 5683 | CoAP | CoAP (UDP) |
| 5684 | CoAPS | CoAP over DTLS |
| 5685 | LwM2M | LwM2M (UDP) |

## Related Documentation

- See `CLAUDE.md` for project overview
- See `.claude/skills/build.md` for building custom images
- See `branding/scripts/build-image.sh` for branded image building
