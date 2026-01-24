# SignConnect (ThingsBoard White-Label)

This is a white-labeled version of ThingsBoard for Lumosoft's SignConnect product.

## Key Principle

**Source files are NOT modified in this repository.**

Branding is applied at deployment time by scripts in `branding/`. This ensures:
- Clean merges with upstream ThingsBoard
- No conflicts during upgrades
- Easy version updates

## Deployment Options

### Standalone (Recommended for most cases)

Single container, simple deployment. No Kafka, no Zookeeper.

```bash
cd deploy/standalone
./install.sh --demo
```

**Capacity:** Up to 300,000 devices, 10,000 messages/second

### Microservices (For large scale)

Multi-container deployment with Kafka, Zookeeper, etc.

```bash
./deploy/deploy.sh --demo
```

**Capacity:** 1M+ devices (requires more resources)

### Which to choose?

| Devices | Messages/sec | Recommendation |
|---------|--------------|----------------|
| < 1,000 | < 100 | **Standalone** |
| < 100,000 | < 5,000 | **Standalone** |
| < 300,000 | < 10,000 | **Standalone** |
| 1M+ | 10,000+ | Microservices |

## Directory Structure

```
thingsboard/
├── [Original ThingsBoard files]    ← Untouched, synced with upstream
│
├── branding/                        ← OUR ADDITIONS
│   ├── config.env                   # Brand configuration
│   ├── assets/                      # Logos, favicon
│   │   └── logo_title_white.svg
│   ├── scripts/
│   │   ├── apply-branding.sh        # Applies branding to source files
│   │   └── revert-branding.sh       # Restores original files
│   └── originals/                   # Backups (created at deploy time)
│
├── deploy/                          ← OUR ADDITIONS
│   ├── standalone/                  # Simple single-container deployment
│   │   ├── docker-compose.yml
│   │   ├── install.sh
│   │   └── .env
│   ├── deploy.sh                    # Microservices deployment
│   ├── install.sh                   # Microservices install
│   ├── update.sh                    # Quick update script
│   ├── upgrade.sh                   # Upstream upgrade script
│   └── README.md
│
├── docker/                          ← Original ThingsBoard (microservices)
│
├── .claude/                         ← OUR ADDITIONS
│   └── skills/
│
└── CLAUDE.md                        ← This file
```

## Quick Reference

### Standalone Commands

```bash
cd deploy/standalone

# Install with demo data
./install.sh --demo

# Install with custom branding
./install.sh --demo --build

# View logs
docker compose logs -f signconnect

# Stop/Start
docker compose stop
docker compose start

# Remove (keeps data)
docker compose down

# Remove completely
docker compose down -v
```

### Build Commands

```bash
# Standalone image only
mvn clean install -DskipTests -Dlicense.skip=true -Ddockerfile.skip=false -pl msa/tb --also-make

# Full build (all images)
mvn clean install -DskipTests -Dlicense.skip=true -Ddockerfile.skip=false

# UI only
mvn clean install -DskipTests -Dlicense.skip=true -pl ui-ngx,msa/web-ui
```

## Branding Configuration

Edit `branding/config.env`:

```bash
BRAND_NAME="SignConnect"
BRAND_COMPANY="Lumosoft"
PRIMARY_COLOR="17212b"      # Dark navy
SECONDARY_COLOR="f9b11d"    # Golden yellow
```

## Upgrade Workflow

When upstream releases a new version:

```bash
# 1. Merge upstream (no conflicts because files are original)
./deploy/upgrade.sh v4.4.0

# 2. Deploy (standalone)
cd deploy/standalone
./install.sh --build

# Or deploy (microservices)
./deploy/deploy.sh
```

## Architecture

### Standalone

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
     /data volume (PostgreSQL + logs)
```

### Microservices

```
┌─────────────────┐     ┌─────────────────┐
│   Upstream      │     │   Your Fork     │
│   ThingsBoard   │────▶│   (clean)       │
└─────────────────┘     └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  Deploy Script  │
                        │ apply-branding  │
                        │ mvn build       │
                        │ docker up       │
                        └────────┬────────┘
                                 │
    ┌────────────────────────────┼────────────────────────────┐
    │                            │                            │
    ▼                            ▼                            ▼
┌──────────┐              ┌──────────┐              ┌──────────┐
│ Kafka    │              │ TB-Core  │              │ Web UI   │
│ Zookeeper│              │ TB-Rule  │              │ HAProxy  │
│ Valkey   │              │ Transport│              │          │
└──────────┘              └──────────┘              └──────────┘
```

## Technology Stack

- **Backend**: Java 17, Spring Boot 3.4
- **Frontend**: Angular 18, Material 18
- **Database**: PostgreSQL 16 (embedded in standalone)
- **Queue**: In-memory (standalone) or Kafka (microservices)
- **Cache**: Embedded (standalone) or Valkey (microservices)

## Default Ports

| Service | Port |
|---------|------|
| Web UI / REST API | 8080 |
| MQTT | 1883 |
| CoAP | 5683 (UDP) |

## Default Credentials

| Role | Username | Password |
|------|----------|----------|
| System Admin | sysadmin@thingsboard.org | sysadmin |
| Tenant Admin | tenant@thingsboard.org | tenant |
| Customer | customer@thingsboard.org | customer |
