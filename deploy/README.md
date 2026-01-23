# SignConnect Deployment

Simplified deployment scripts for SignConnect (ThingsBoard white-label by Lumosoft).

## Quick Start (3 Commands)

```bash
# 1. Clone repository
git clone https://github.com/olivenet-iot/thingsboard.git /opt/thingsboard
cd /opt/thingsboard

# 2. Install prerequisites (first time only)
./deploy/setup.sh

# 3. Deploy SignConnect
./deploy/install.sh --demo
```

That's it! SignConnect will be running at `http://localhost:8080`

## Architecture

```
                    YOUR FORK
                        │
    ┌───────────────────┴───────────────────┐
    │     olivenet-iot/thingsboard          │
    │                                        │
    │  ┌──────────────────────────────────┐ │
    │  │ Original ThingsBoard Files       │ │  ← Untouched
    │  │ (synced with upstream)           │ │
    │  └──────────────────────────────────┘ │
    │                                        │
    │  ┌──────────────────────────────────┐ │
    │  │ + branding/    (our addition)    │ │  ← Custom
    │  │ + deploy/      (our addition)    │ │
    │  │ + .claude/     (our addition)    │ │
    │  │ + CLAUDE.md    (our addition)    │ │
    │  └──────────────────────────────────┘ │
    └───────────────────────────────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │  Deploy Script  │
              │                 │
              │ 1. Apply brand  │ ← Modifies files at deploy time
              │ 2. Build        │
              │ 3. Docker up    │
              └─────────────────┘
```

## Scripts Overview

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `setup.sh` | Install prerequisites | Fresh server, first time only |
| `install.sh` | One-click deployment | Full installation from zero |
| `uninstall.sh` | Clean removal | Remove SignConnect completely |
| `deploy.sh` | Full deployment | Manual control over deployment |
| `update.sh` | Quick update | Branding tweaks, UI fixes |
| `upgrade.sh` | Version upgrade | New ThingsBoard release |

---

## Detailed Usage

### setup.sh - Prerequisites Installation

Installs all required software on a fresh Ubuntu 20.04/22.04 server.

```bash
# Interactive installation
./deploy/setup.sh

# Check what's installed (no changes)
./deploy/setup.sh --check

# Force reinstall everything
./deploy/setup.sh --force
```

**What it installs:**
- Git, curl, wget, unzip, jq
- Java 17 (OpenJDK)
- Maven 3.6+
- Node.js 18 LTS
- Yarn
- Docker Engine
- Docker Compose v2

**Important:** After running setup.sh, log out and back in for Docker group membership to take effect, or run `newgrp docker`.

---

### install.sh - One-Click Deployment

Deploys SignConnect from zero to running.

```bash
# Basic installation with demo data (recommended)
./deploy/install.sh --demo

# Production installation (no demo data)
./deploy/install.sh

# Clean install (wipe existing data)
./deploy/install.sh --demo --clean

# Skip build (use existing Docker images)
./deploy/install.sh --skip-build

# Skip branding (plain ThingsBoard)
./deploy/install.sh --skip-branding

# See what would happen without doing it
./deploy/install.sh --dry-run
```

**Options:**
| Option | Description |
|--------|-------------|
| `--demo` | Load demo data (devices, dashboards) |
| `--skip-branding` | Use original ThingsBoard branding |
| `--skip-build` | Skip Maven build, use existing images |
| `--rebuild` | Force rebuild Docker images |
| `--clean` | Remove existing data before install |
| `--dry-run` | Show what would be done |

**Environment variables:**
```bash
# Custom JVM memory (default: 2048MB)
TB_MEMORY=4096 ./deploy/install.sh --demo

# Custom HTTP port (default: 8080)
TB_PORT=80 ./deploy/install.sh --demo

# Custom PostgreSQL password
POSTGRES_PASSWORD=mypassword ./deploy/install.sh --demo
```

---

### uninstall.sh - Clean Removal

Removes SignConnect installation.

```bash
# Interactive uninstall
./deploy/uninstall.sh

# Keep data for later reinstall
./deploy/uninstall.sh --keep-data

# Keep Docker images (faster reinstall)
./deploy/uninstall.sh --keep-images

# Revert to original ThingsBoard files
./deploy/uninstall.sh --revert-branding

# Non-interactive (skip confirmation)
./deploy/uninstall.sh --yes

# Keep everything, just stop services
./deploy/uninstall.sh --keep-data --keep-images
```

**Options:**
| Option | Description |
|--------|-------------|
| `--keep-data` | Preserve database volumes |
| `--keep-images` | Keep Docker images |
| `--revert-branding` | Restore original ThingsBoard files |
| `--yes` | Skip confirmation prompts |

---

### deploy.sh - Manual Deployment

For more control over the deployment process.

```bash
# Full deployment
./deploy/deploy.sh --demo

# Fresh install (wipes data)
./deploy/deploy.sh --fresh --demo

# Skip build (restart only)
./deploy/deploy.sh --skip-build

# Skip branding
./deploy/deploy.sh --skip-branding
```

---

### update.sh - Quick Updates

For minor changes without full rebuild.

```bash
# UI changes only (fast)
./deploy/update.sh

# Full rebuild
./deploy/update.sh --full

# Just restart services
./deploy/update.sh --restart-only
```

---

### upgrade.sh - Version Upgrades

Upgrade to a new ThingsBoard release.

```bash
# Upgrade to specific version
./deploy/upgrade.sh v4.4.0
```

---

## Workflow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     FRESH SERVER WORKFLOW                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. ./deploy/setup.sh                                          │
│     │                                                           │
│     ├── apt install java, maven, node, docker                   │
│     └── Add user to docker group                               │
│                                                                 │
│  2. logout / login (for docker group)                          │
│                                                                 │
│  3. ./deploy/install.sh --demo                                 │
│     │                                                           │
│     ├── Check prerequisites                                    │
│     ├── Apply branding                                         │
│     ├── Maven build                                            │
│     ├── Configure Docker                                       │
│     ├── Initialize database                                    │
│     ├── Start services                                         │
│     └── Health check                                           │
│                                                                 │
│  4. Access http://localhost:8080                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────┐
│                     UPGRADE WORKFLOW                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. ./deploy/upgrade.sh v4.4.0                                 │
│     │                                                           │
│     ├── git fetch upstream                                     │
│     ├── git merge v4.4.0  ← No conflicts! (files are original) │
│     └── git push origin master                                 │
│                                                                 │
│  2. On server: ./deploy/install.sh                             │
│     │                                                           │
│     ├── git pull                                               │
│     ├── Apply branding                                         │
│     ├── mvn build                                              │
│     └── docker compose up                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

### Automatically Installed by setup.sh

| Tool | Version | Purpose |
|------|---------|---------|
| Java | 17+ | Backend runtime |
| Maven | 3.6+ | Build system |
| Node.js | 18 LTS | Frontend build |
| Yarn | Latest | Package manager |
| Docker | Latest | Containerization |
| Docker Compose | V2 | Container orchestration |
| Git | Latest | Version control |

### System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 8GB | 16GB |
| Disk | 20GB | 50GB |
| CPU | 2 cores | 4+ cores |
| OS | Ubuntu 20.04 | Ubuntu 22.04 |

---

## Default Credentials

| Role | Username | Password |
|------|----------|----------|
| System Admin | sysadmin@thingsboard.org | sysadmin |
| Tenant Admin | tenant@thingsboard.org | tenant |
| Customer | customer@thingsboard.org | customer |

---

## Default Ports

| Service | Port |
|---------|------|
| Web UI / HTTP API | 8080 |
| MQTT | 1883 |
| CoAP | 5683 |
| HTTPS | 443 |

---

## Common Commands

```bash
# View status
cd /opt/thingsboard/docker && docker compose ps

# View logs
docker compose logs -f tb-core1 tb-core2

# View specific service logs
docker compose logs -f tb-web-ui1

# Stop services
./docker-stop-services.sh

# Start services
./docker-start-services.sh

# Restart web UI only
docker compose restart tb-web-ui1 tb-web-ui2
```

---

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `TB_MEMORY` | 2048 | JVM heap size in MB |
| `TB_PORT` | 8080 | HTTP port |
| `POSTGRES_PASSWORD` | (generated) | Database password |
| `TB_QUEUE_TYPE` | kafka | Message queue type |
| `CACHE` | valkey | Cache type |

---

## Troubleshooting

### Services not starting

```bash
# Check container status
docker compose ps

# View logs
docker compose logs -f tb-core1

# Check memory
free -h
```

### 503 Service Unavailable

- **Cause**: Services still starting
- **Fix**: Wait 3-5 minutes, then check logs

### Build Out of Memory

```bash
# Increase Maven memory
export MAVEN_OPTS="-Xmx4g"
./deploy/install.sh --demo
```

### Docker Permission Denied

```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Apply immediately (or logout/login)
newgrp docker
```

### Port Already in Use

```bash
# Find what's using the port
sudo lsof -i :8080

# Use different port
TB_PORT=9090 ./deploy/install.sh --demo
```

### Branding Not Showing

- **Cause**: Browser cache
- **Fix**: Hard refresh (Ctrl+Shift+R) or clear cache

### Merge Conflicts During Upgrade

- **Cause**: Shouldn't happen if source files are clean
- **Fix**: Check if branding was accidentally committed

### Database Connection Failed

```bash
# Check PostgreSQL status
docker compose logs postgres

# Restart database
docker compose restart postgres
```

---

## File Structure

```
deploy/
├── README.md           # This documentation
├── setup.sh            # Prerequisites installer
├── install.sh          # One-click deployment
├── uninstall.sh        # Clean uninstall
├── deploy.sh           # Manual deployment
├── update.sh           # Quick updates
└── upgrade.sh          # Version upgrades
```

---

## How Branding Works

1. **Source files stay original** - We don't commit branding changes
2. **Branding applied at deploy time** - Script modifies files before build
3. **Originals backed up** - Stored in `branding/originals/`
4. **Upgrade is clean** - No merge conflicts with upstream

This approach ensures:
- Clean merges with upstream ThingsBoard
- No conflicts during upgrades
- Easy version updates
- Branding can be changed without rebuilding
