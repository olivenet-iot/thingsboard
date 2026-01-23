# SignConnect (ThingsBoard White-Label)

This is a white-labeled version of ThingsBoard for Lumosoft's SignConnect product.

## Key Principle

**Source files are NOT modified in this repository.**

Branding is applied at deployment time by scripts in `branding/`. This ensures:
- Clean merges with upstream ThingsBoard
- No conflicts during upgrades
- Easy version updates

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
│   ├── deploy.sh                    # Full deployment script
│   ├── update.sh                    # Quick update script
│   ├── upgrade.sh                   # Upstream upgrade script
│   └── README.md
│
├── .claude/                         ← OUR ADDITIONS
│   └── skills/
│
└── CLAUDE.md                        ← This file
```

## Quick Reference

### Commands

```bash
# Full deployment (first time or major changes)
./deploy/deploy.sh --demo

# Quick update (branding/UI changes)
./deploy/update.sh

# Upgrade to new ThingsBoard version
./deploy/upgrade.sh v4.4.0
```

### Build Commands

```bash
# Full build
mvn clean install -DskipTests -Dlicense.skip=true

# UI only
mvn clean install -DskipTests -Dlicense.skip=true -pl ui-ngx,msa/web-ui

# With Docker images
mvn clean install -DskipTests -Dlicense.skip=true -Ddockerfile.skip=false
```

### Docker Commands

```bash
cd docker

# Start
./docker-start-services.sh

# Stop
./docker-stop-services.sh

# Logs
docker compose logs -f tb-core1 tb-core2

# Status
docker compose ps
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

# 2. Deploy on server (branding applied automatically)
./deploy/deploy.sh
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   Upstream      │     │   Your Fork     │
│   ThingsBoard   │────▶│   (clean)       │
│                 │     │                 │
│   v4.3.0        │     │  + branding/    │
│   v4.4.0        │     │  + deploy/      │
│   ...           │     │  + .claude/     │
└─────────────────┘     └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  Deploy Script  │
                        │                 │
                        │ apply-branding  │
                        │ mvn build       │
                        │ docker up       │
                        └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  SignConnect    │
                        │  (branded)      │
                        └─────────────────┘
```

## Technology Stack

- **Backend**: Java 17, Spring Boot 3.4
- **Frontend**: Angular 18, Material 18
- **Database**: PostgreSQL 16
- **Queue**: Kafka
- **Cache**: Valkey (Redis-compatible)

## Default Ports

| Service | Port |
|---------|------|
| Web UI | 80/443 |
| MQTT | 1883 |
| CoAP | 5683 |
| HTTP API | 8080 |

## Default Credentials

| Role | Username | Password |
|------|----------|----------|
| System Admin | sysadmin@thingsboard.org | sysadmin |
| Tenant Admin | tenant@thingsboard.org | tenant |
| Customer | customer@thingsboard.org | customer |
