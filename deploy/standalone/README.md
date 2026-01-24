# SignConnect Standalone Deployment

Simple single-container deployment. No Kafka, no Zookeeper, no complexity.

## Quick Start

```bash
# With demo data (recommended)
./install.sh --demo

# Without demo data
./install.sh
```

That's it! Open http://localhost:8080

## When to Use Standalone

| Scenario | Standalone | Microservices |
|----------|------------|---------------|
| Development | ✓ | |
| < 100 devices | ✓ | |
| < 10,000 devices | ✓ | |
| < 300,000 devices | ✓ | |
| 1M+ devices | | ✓ |
| High Availability required | | ✓ |

## Architecture

```
┌─────────────────────────────────────────────┐
│           SINGLE CONTAINER                   │
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │PostgreSQL│ │ThingsBoard│ │ Web UI  │    │
│  │(embedded)│ │  (Java)   │ │(Angular)│    │
│  └──────────┘ └──────────┘ └──────────┘    │
│                                              │
│  Ports: 8080 (HTTP) | 1883 (MQTT) | 5683   │
└─────────────────────────────────────────────┘
            │
            ▼
     /data volume (persistent)
```

## Options

| Option | Description |
|--------|-------------|
| `--demo` | Load demo devices and dashboards |
| `--build` | Build custom image with branding |
| `--clean` | Remove existing data first |

## Building Custom Image

To apply SignConnect branding:

```bash
./install.sh --demo --build
```

This will:
1. Apply branding from `branding/` folder
2. Build custom Docker image
3. Deploy with branding applied

## Configuration

Edit `.env` file:

```bash
# Ports
TB_PORT=8080
MQTT_PORT=1883

# Memory (adjust based on device count)
JAVA_OPTS=-Xms512M -Xmx1024M   # < 1000 devices
JAVA_OPTS=-Xms1G -Xmx2G        # < 10000 devices
JAVA_OPTS=-Xms2G -Xmx4G        # < 100000 devices
```

## Commands

```bash
# View logs
docker compose logs -f signconnect

# Stop
docker compose stop

# Start
docker compose start

# Restart
docker compose restart

# Remove (keeps data)
docker compose down

# Remove completely (deletes data!)
docker compose down -v
```

## Upgrading

```bash
# 1. Pull new image
docker compose pull

# 2. Stop current
docker compose down

# 3. Run upgrade script
docker run --rm -v signconnect-data:/data \
    thingsboard/tb-postgres:NEW_VERSION \
    upgrade-tb.sh --fromVersion=OLD_VERSION

# 4. Start
docker compose up -d
```

## Backup

```bash
# Backup data
docker run --rm -v signconnect-data:/data -v $(pwd):/backup \
    alpine tar czf /backup/signconnect-backup.tar.gz /data

# Restore
docker run --rm -v signconnect-data:/data -v $(pwd):/backup \
    alpine tar xzf /backup/signconnect-backup.tar.gz -C /
```

## Troubleshooting

### Container won't start
```bash
docker compose logs signconnect
```

### Out of memory
Increase `JAVA_OPTS` in `.env` file.

### Port already in use
Change `TB_PORT` in `.env` file.

### Database corrupted
```bash
docker compose down -v
./install.sh --demo
```
