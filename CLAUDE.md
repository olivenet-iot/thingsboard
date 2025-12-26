# ThingsBoard Project Guide

This document provides a comprehensive overview of the ThingsBoard project for development, white-labeling, and maintenance.

## Project Overview

**ThingsBoard** is an open-source IoT platform for device management, data collection, processing, and visualization. This fork is being white-labeled as **SignConnect** by **Lumosoft**.

- **Version**: 4.3.0-RC
- **License**: Apache 2.0
- **Upstream**: https://github.com/thingsboard/thingsboard

## Quick Reference

### Build Commands

```bash
# Full build (all modules)
./build.sh

# Backend only (skip UI)
mvn clean install -DskipTests -pl '!ui-ngx'

# UI only
cd ui-ngx && yarn build:prod

# With Docker images
mvn clean install -DskipTests -Ddockerfile.skip=false

# Specific module
./build.sh msa/web-ui
```

### Development

```bash
# Start UI dev server (hot reload)
cd ui-ngx && yarn start

# Backend runs on :8080, UI dev server proxies to it
# UI dev server: http://localhost:4200
```

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Java | 17+ | OpenJDK recommended |
| Maven | 3.6+ | For backend build |
| Node.js | 22.18.0 | Auto-installed by Maven |
| Yarn | 1.22.22 | Auto-installed by Maven |
| Docker | Latest | For image building |

## Directory Structure

```
thingsboard/
├── application/          # Main Spring Boot application
│   └── src/main/resources/templates/  # Email templates (.ftl)
├── common/               # Shared libraries (15+ submodules)
├── dao/                  # Data access layer
├── docker/               # Docker Compose configurations
├── msa/                  # Microservices architecture
│   ├── tb-node/          # Core service Docker
│   ├── web-ui/           # UI service Docker
│   └── transport/        # Protocol transports
├── rule-engine/          # Rule processing engine
├── transport/            # Protocol implementations
│   ├── http/
│   ├── mqtt/
│   ├── coap/
│   ├── lwm2m/
│   └── snmp/
├── ui-ngx/               # Angular 18 frontend
│   ├── src/
│   │   ├── app/          # Angular application
│   │   ├── assets/       # Static resources, logos
│   │   ├── scss/         # Global styles, variables
│   │   └── theme.scss    # Material theme
│   └── package.json
├── branding/             # White-label infrastructure (custom)
└── docs/                 # Project documentation (custom)
```

## Module Dependencies

```
netty-mqtt
    ↓
common (15+ submodules)
    ↓
rule-engine
    ↓
dao
    ↓
transport (http, mqtt, coap, lwm2m, snmp)
    ↓
application ← ui-ngx (embedded)
    ↓
msa (microservices packaging)
```

## White-Label Customization

### Quick Start

1. Place brand assets in `branding/assets/`
2. Configure `branding/config.env`
3. Run `branding/scripts/apply-branding.sh`
4. Build with `./build.sh`

### Key Files to Modify

| Category | File | Purpose |
|----------|------|---------|
| **Logo** | `ui-ngx/src/assets/logo_title_white.svg` | Main logo with text |
| **Logo** | `ui-ngx/src/assets/logo_white.svg` | Icon only |
| **Favicon** | `ui-ngx/src/thingsboard.ico` | Browser tab icon |
| **Title** | `ui-ngx/src/index.html` | Page title (line 22) |
| **Colors** | `ui-ngx/src/scss/constants.scss` | Brand colors (lines 34-39) |
| **Footer** | `ui-ngx/src/app/shared/components/footer.component.html` | Copyright |
| **Email** | `application/src/main/resources/templates/*.ftl` | Email branding |

### Brand Colors (Original)

```scss
$tb-primary-color: #305680;      // Primary blue
$tb-secondary-color: #527dad;    // Secondary blue
$tb-hue3-color: #a7c1de;         // Light blue
$tb-dark-primary-color: #9fa8da; // Dark mode primary
```

## Docker Deployment

### Single Node (Development)

```bash
cd docker
docker-compose up -d
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| tb-core | 8080 | Main application |
| postgres | 5432 | PostgreSQL database |
| redis | 6379 | Cache (optional) |
| kafka | 9092 | Message queue (optional) |

### Environment Variables

Key variables in `.env` files:

```bash
TB_QUEUE_TYPE=in-memory|kafka|rabbitmq|aws-sqs
DATABASE_TS_TYPE=sql|timescale|cassandra
SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/thingsboard
```

## Upgrading from Upstream

### Recommended Workflow

1. **Revert branding**: `branding/scripts/revert-branding.sh`
2. **Fetch upstream**: `git fetch upstream`
3. **Merge**: `git merge upstream/master`
4. **Resolve conflicts** (if any)
5. **Reapply branding**: `branding/scripts/apply-branding.sh`
6. **Test**: Build and verify

### Files That Commonly Conflict

- `pom.xml` (version changes)
- `ui-ngx/package.json` (dependency updates)
- Translation files (`locale.constant-*.json`)

## Technology Stack

### Backend
- **Java 17** with Spring Boot 3.4.10
- **Akka** for actor-based concurrency
- **gRPC** for service communication
- **Protocol Buffers** for serialization

### Frontend
- **Angular 18.2.13** with Material 18.2.14
- **NgRx** for state management
- **Tailwind CSS 3.4.15** for utility styling
- **ECharts** for visualization
- **@ngx-translate** for i18n (27 languages)

### Database
- **PostgreSQL** (primary)
- **Cassandra** (optional, for time-series)
- **TimescaleDB** (optional, for time-series)

### Message Queue
- In-memory (development)
- Kafka (production)
- RabbitMQ (alternative)
- AWS SQS (cloud)

## Common Tasks

### Add a New Translation String

1. Add to `ui-ngx/src/assets/locale/locale.constant-en_US.json`
2. Use in component: `{{ 'your.key' | translate }}`
3. Repeat for other languages as needed

### Modify Theme Colors

1. Edit `ui-ngx/src/scss/constants.scss`
2. Update Material palette in `ui-ngx/src/theme.scss`
3. Rebuild UI: `cd ui-ngx && yarn build:prod`

### Create Custom Email Template

1. Add `.ftl` file to `application/src/main/resources/templates/`
2. Register in email service
3. Use FreeMarker syntax for variables

### Build Docker Image

```bash
# Build all images
mvn clean install -DskipTests -Ddockerfile.skip=false

# Build specific image
cd msa/web-ui && mvn dockerfile:build
```

## Troubleshooting

### Build Fails with Memory Error

```bash
# Increase Maven memory
export MAVEN_OPTS="-Xmx4g"

# Increase Node memory
export NODE_OPTIONS="--max_old_space_size=8192"
```

### UI Build Fails

```bash
# Clear node_modules and rebuild
cd ui-ngx
rm -rf node_modules
yarn install
yarn build:prod
```

### Docker Build Fails

```bash
# Ensure Docker daemon is running
# Check base image availability
docker pull thingsboard/openjdk17:bookworm-slim
docker pull thingsboard/node:22.18.0-bookworm-slim
```

### Port Already in Use

```bash
# Find process using port 8080
lsof -i :8080
# Kill it or change port in application.yml
```

## Related Documentation

- `docs/ARCHITECTURE.md` - System architecture details
- `docs/WHITE-LABEL-ANALYSIS.md` - Complete branding audit
- `docs/UPGRADE-GUIDE.md` - Upgrade procedures
- `.claude/skills/` - Skill files for common operations
- `branding/README.md` - White-label scripts usage

## Support

- **ThingsBoard Docs**: https://thingsboard.io/docs/
- **GitHub Issues**: https://github.com/thingsboard/thingsboard/issues
- **Community Forum**: https://groups.google.com/forum/#!forum/thingsboard
