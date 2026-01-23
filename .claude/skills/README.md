# ThingsBoard Claude Skills

Comprehensive reference documentation for working with ThingsBoard/SignConnect codebase.

## Available Skills

| Skill | Description |
|-------|-------------|
| [architecture.md](architecture.md) | System architecture, module hierarchy, actor system |
| [frontend.md](frontend.md) | Angular 18 UI, components, theming, translations |
| [backend.md](backend.md) | Spring Boot services, REST API, controllers |
| [rule-engine.md](rule-engine.md) | Rule nodes, visual programming, JavaScript scripting |
| [database.md](database.md) | PostgreSQL schema, DAO layer, time-series storage |
| [deployment.md](deployment.md) | Docker Compose, service configuration, scaling |
| [branding.md](branding.md) | White-label customization, logos, colors |

## Quick Reference

### Build Commands

```bash
# Full build
mvn clean install -DskipTests -Dlicense.skip=true

# UI only
cd ui-ngx && yarn build:prod

# With Docker images
mvn clean install -DskipTests -Ddockerfile.skip=false
```

### Development

```bash
# Start UI dev server
cd ui-ngx && yarn start
# Available at http://localhost:4200

# Backend runs at http://localhost:8080
```

### Deployment

```bash
# Fresh install
./deploy/deploy.sh --demo

# Quick update
./deploy/update.sh

# Upgrade from upstream
./deploy/upgrade.sh v4.4.0
```

## Project Structure Overview

```
thingsboard/
├── application/          # Main Spring Boot app
├── common/               # Shared libraries (15 modules)
├── dao/                  # Data access layer
├── docker/               # Docker deployment
├── msa/                  # Microservices
├── rule-engine/          # Rule processing
├── transport/            # IoT protocols
├── ui-ngx/               # Angular frontend
├── branding/             # White-label assets
└── deploy/               # Deployment scripts
```

## Key Technologies

| Layer | Technology | Version |
|-------|------------|---------|
| Backend | Spring Boot | 3.4.10 |
| Frontend | Angular | 18.2.13 |
| Database | PostgreSQL | 16 |
| Cache | Redis/Valkey | 8.0 |
| Queue | Kafka | 3.9.1 |

## Common Tasks

- **Add translation**: See [frontend.md](frontend.md#translations-i18n)
- **Create rule node**: See [rule-engine.md](rule-engine.md#rule-node-development)
- **Add REST endpoint**: See [backend.md](backend.md#rest-controllers)
- **Customize branding**: See [branding.md](branding.md)
- **Deploy to production**: See [deployment.md](deployment.md)
