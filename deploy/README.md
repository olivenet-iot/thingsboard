# SignConnect Deployment

Simplified deployment scripts for SignConnect (ThingsBoard white-label by Lumosoft).

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

## Quick Start

### Fresh Server Installation

```bash
# Clone repository
git clone https://github.com/olivenet-iot/thingsboard.git /opt/thingsboard
cd /opt/thingsboard

# Make scripts executable
chmod +x deploy/*.sh branding/scripts/*.sh

# Run full deployment
./deploy/deploy.sh --demo
```

### Update Existing Installation

```bash
cd /opt/thingsboard
./deploy/update.sh          # UI changes only (fast)
./deploy/update.sh --full   # Full rebuild
```

### Upgrade to New ThingsBoard Version

```bash
cd /opt/thingsboard
./deploy/upgrade.sh v4.4.0  # Merge upstream, then deploy
```

## Scripts

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `deploy.sh` | Full deployment | Initial setup, major changes |
| `update.sh` | Quick update | Branding tweaks, UI fixes |
| `upgrade.sh` | Version upgrade | New ThingsBoard release |

## How Branding Works

1. **Source files stay original** - We don't commit branding changes
2. **Branding applied at deploy time** - Script modifies files before build
3. **Originals backed up** - Stored in `branding/originals/`
4. **Upgrade is clean** - No merge conflicts with upstream

## Workflow Diagram

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
│  2. On server: ./deploy/deploy.sh                              │
│     │                                                           │
│     ├── git pull                                               │
│     ├── ./branding/scripts/apply-branding.sh  ← Apply branding │
│     ├── mvn build                                              │
│     └── docker compose up                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Java | 17+ | `apt install openjdk-17-jdk` |
| Maven | 3.6+ | `apt install maven` |
| Docker | Latest | docker.com/get-docker |
| Docker Compose | V2 | Included with Docker |
| Git | Latest | `apt install git` |

**System Requirements:**
- RAM: 8GB minimum, 16GB recommended
- Disk: 20GB free space
- OS: Ubuntu 20.04+ or similar

## Default Credentials

| Role | Username | Password |
|------|----------|----------|
| System Admin | sysadmin@thingsboard.org | sysadmin |
| Tenant Admin | tenant@thingsboard.org | tenant |
| Customer | customer@thingsboard.org | customer |

## Common Commands

```bash
# View status
cd /opt/thingsboard/docker && docker compose ps

# View logs
docker compose logs -f tb-core1 tb-core2

# Stop services
./docker-stop-services.sh

# Start services
./docker-start-services.sh

# Restart web UI only
docker compose restart tb-web-ui1 tb-web-ui2
```

## Troubleshooting

### 503 Service Unavailable
- **Cause**: Services still starting (takes ~3 minutes)
- **Fix**: Wait and check `docker compose logs -f tb-core1`

### Branding Not Showing
- **Cause**: Browser cache
- **Fix**: Hard refresh (Ctrl+Shift+R)

### Build Out of Memory
- **Fix**: `export MAVEN_OPTS="-Xmx4g"`

### Merge Conflicts During Upgrade
- **Cause**: Shouldn't happen if source files are clean
- **Fix**: Check if branding was accidentally committed
