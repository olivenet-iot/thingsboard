# ThingsBoard Deployment Guide

## Overview

Docker Compose-based deployment with support for single-node development and clustered production environments.

## Deployment Options

| Mode | Use Case | Components |
|------|----------|------------|
| Monolithic | Development | Single tb-core container |
| Microservices | Production | Multiple specialized containers |
| Kubernetes | Cloud-native | Helm charts, auto-scaling |

## Docker Directory Structure

```
docker/
├── docker-compose.yml           # Base compose file
├── docker-compose.postgres.yml  # PostgreSQL config
├── docker-compose.kafka.yml     # Kafka queue config
├── docker-compose.valkey.yml    # Valkey/Redis cache
├── docker-compose.ha.yml        # High availability
├── .env                         # Environment variables
├── docker-install-tb.sh         # Database initialization
├── docker-upgrade-tb.sh         # Database migration
├── docker-start-services.sh     # Start all services
├── docker-stop-services.sh      # Stop all services
└── tb-node/                     # Volume mounts
    ├── postgres/                # PostgreSQL data
    ├── kafka/                   # Kafka data
    └── valkey-data/             # Cache data
```

## Quick Start

### Fresh Installation

```bash
cd /opt/thingsboard/docker

# Create environment file
cp .env.example .env

# Create log folders
./docker-create-log-folders.sh

# Initialize database
./docker-install-tb.sh --loadDemo

# Start services
./docker-start-services.sh
```

### Environment Variables

```bash
# Queue type: in-memory, kafka, rabbitmq, aws-sqs
TB_QUEUE_TYPE=kafka

# Cache: caffeine, redis, valkey
CACHE=valkey

# Database: postgres
DATABASE=postgres

# Docker image settings
DOCKER_REPO=thingsboard
TB_VERSION=latest

# Java memory
JAVA_OPTS=-Xmx2048M -Xms2048M
```

## Service Architecture

### Core Services

| Service | Port | Description |
|---------|------|-------------|
| tb-core1/2 | 8080 | Main application nodes |
| tb-web-ui1/2 | 8080 | Angular frontend |
| postgres | 5432 | PostgreSQL database |
| kafka | 9092 | Message queue |
| zookeeper | 2181 | Kafka coordination |
| valkey | 6379 | Redis-compatible cache |
| haproxy | 80/443 | Load balancer |

### Transport Services

| Service | Port | Protocol |
|---------|------|----------|
| tb-mqtt-transport | 1883/8883 | MQTT |
| tb-http-transport | 8081 | HTTP |
| tb-coap-transport | 5683/5684 | CoAP |
| tb-lwm2m-transport | 5685/5686 | LwM2M |
| tb-snmp-transport | 162 | SNMP |

## Docker Compose Files

### Base Configuration
`docker-compose.yml` - Core services definition

### Database
`docker-compose.postgres.yml` - PostgreSQL setup
```yaml
services:
  postgres:
    image: postgres:16
    volumes:
      - ./tb-node/postgres:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: thingsboard
      POSTGRES_PASSWORD: postgres
```

### Queue (Kafka)
`docker-compose.kafka.yml`
```yaml
services:
  zookeeper:
    image: bitnami/zookeeper:3.9.1

  kafka:
    image: bitnami/kafka:3.9.1
    environment:
      KAFKA_CFG_ZOOKEEPER_CONNECT: zookeeper:2181
```

### Cache (Valkey)
`docker-compose.valkey.yml`
```yaml
services:
  valkey:
    image: valkey/valkey:8.0
    ports:
      - "6379:6379"
```

### High Availability
`docker-compose.ha.yml` - Multi-node setup with HAProxy

## Starting Services

### Full Stack

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.postgres.yml \
  -f docker-compose.kafka.yml \
  -f docker-compose.valkey.yml \
  up -d
```

### Using Helper Script

```bash
./docker-start-services.sh
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f tb-core1

# Last 100 lines
docker compose logs --tail=100 tb-core1
```

## Database Operations

### Initialize (Fresh Install)

```bash
# Without demo data
./docker-install-tb.sh

# With demo data
./docker-install-tb.sh --loadDemo
```

### Upgrade Migration

```bash
./docker-upgrade-tb.sh --fromVersion=3.5.0
```

### Backup

```bash
# PostgreSQL backup
docker exec postgres pg_dump -U postgres thingsboard > backup.sql

# Full volume backup
tar -czvf backup.tar.gz tb-node/postgres
```

### Restore

```bash
# PostgreSQL restore
docker exec -i postgres psql -U postgres thingsboard < backup.sql
```

## SSL/TLS Configuration

### HAProxy with Let's Encrypt

```yaml
services:
  haproxy:
    image: certbot/haproxy-certbot
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg
      - ./certs:/etc/letsencrypt
```

### MQTT TLS

```yaml
tb-mqtt-transport:
  environment:
    MQTT_SSL_ENABLED: "true"
    MQTT_SSL_KEY_STORE: /ssl/mqttserver.jks
    MQTT_SSL_KEY_STORE_PASSWORD: password
```

## Health Checks

### API Health

```bash
# Check API availability
curl http://localhost:8080/api/noauth/login

# Expected: 401 (authentication required) = healthy
```

### Container Health

```bash
# All containers
docker compose ps

# Specific container
docker inspect --format='{{.State.Health.Status}}' tb-core1
```

## Scaling

### Horizontal Scaling

```bash
# Scale web UI
docker compose up -d --scale tb-web-ui=4

# Scale transport
docker compose up -d --scale tb-mqtt-transport=2
```

### Resource Limits

```yaml
services:
  tb-core1:
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 4G
        reservations:
          cpus: '2'
          memory: 2G
```

## Troubleshooting

### Service Not Starting

```bash
# Check logs
docker compose logs tb-core1

# Common issues:
# - Port already in use
# - Memory allocation failed
# - Database connection failed
```

### Database Connection Failed

```bash
# Check PostgreSQL status
docker compose ps postgres

# Test connection
docker exec postgres pg_isready -U postgres
```

### Out of Memory

```bash
# Increase Java heap
JAVA_OPTS=-Xmx4096M -Xms4096M

# Check container memory
docker stats
```

### Kafka Connection Issues

```bash
# Check Kafka status
docker compose logs kafka

# Verify Zookeeper
docker exec zookeeper zkCli.sh ls /brokers/ids
```

## Production Checklist

1. **Security**
   - [ ] Change default passwords
   - [ ] Enable HTTPS
   - [ ] Configure firewall rules
   - [ ] Enable JWT token security

2. **Performance**
   - [ ] Allocate sufficient memory
   - [ ] Configure connection pools
   - [ ] Set up Redis cluster
   - [ ] Configure Kafka partitions

3. **Reliability**
   - [ ] Set up database backups
   - [ ] Configure log rotation
   - [ ] Set up monitoring
   - [ ] Configure health checks

4. **Scalability**
   - [ ] Use external PostgreSQL
   - [ ] Use Kafka cluster
   - [ ] Enable Redis cluster
   - [ ] Configure HAProxy

## Maintenance Commands

```bash
# Stop all services
./docker-stop-services.sh

# Remove all containers
./docker-remove-services.sh

# Clean volumes (DESTRUCTIVE)
docker volume prune

# Update images
docker compose pull

# View resource usage
docker stats

# Restart specific service
docker compose restart tb-core1
```
