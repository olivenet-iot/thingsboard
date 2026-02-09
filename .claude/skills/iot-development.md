<!-- Last updated: 2026-02-09 -->

# IoT Development Guide

Main entry point for ThingsBoard IoT development on this instance.

## Environment

| Component | Details |
|-----------|---------|
| Platform | ThingsBoard CE v4.4.0-SNAPSHOT (SignConnect white-label) |
| Docker container | `signconnect` (image: thingsboard/tb-postgres:latest) |
| HTTP/API port | 8080 |
| MQTT port | 1883 |
| CoAP port | 5683 |
| Database | PostgreSQL 12 (embedded in Docker container) |
| Java | OpenJDK 17 |
| OS | Ubuntu Linux (no sudo access) |

## Authentication

Login to obtain a JWT token:

```bash
curl -s -X POST ${TB_HOST}/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "${TB_USERNAME}", "password": "${TB_PASSWORD}"}' \
  | jq -r .token
```

- Endpoint is `POST /api/auth/login` (NOT `/api/noauth/login`)
- Returns JWT token; use as `X-Authorization: Bearer {token}` header
- Token expires in approximately 15 minutes
- Refresh with `POST /api/auth/token` using the current valid token
- Credentials stored in: `/opt/thingsboard/.claude/credentials.env`

```bash
# Source credentials before running scripts
source /opt/thingsboard/.claude/credentials.env
```

## API Quick Reference Table

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Authenticate, get JWT |
| GET | `/api/devices?pageSize=100&page=0` | List devices (paginated) |
| GET | `/api/device/{deviceId}` | Get device by ID |
| POST | `/api/device` | Create or update device |
| GET | `/api/device/{deviceId}/credentials` | Get device access token |
| GET | `/api/dashboards?pageSize=100&page=0` | List dashboards (paginated) |
| GET | `/api/dashboard/{dashboardId}` | Get full dashboard JSON |
| POST | `/api/dashboard` | Create or update dashboard |
| GET | `/api/ruleChains?pageSize=100&page=0` | List rule chains |
| POST | `/api/ruleChain/metadata` | Update rule chain metadata (nodes + connections) |
| GET | `/api/ruleChain/{ruleChainId}/metadata` | Get rule chain metadata |
| POST | `/api/deviceProfile` | Create or update device profile |
| POST | `/api/v1/{DEVICE_TOKEN}/telemetry` | Push telemetry via device token |
| POST | `/api/plugins/telemetry/DEVICE/{id}/attributes/SHARED_SCOPE` | Write shared attributes |
| POST | `/api/plugins/rpc/oneway/{deviceId}` | Send one-way RPC to device |

## Current Inventory

### Devices

| Name | Type | ID |
|------|------|-----|
| zenopix-test | Zenopix DALI Controller | ${ZENOPIX_DEVICE_ID} |
| olivenet-em300-th | default | (lookup via API) |

### Dashboards

| Name | ID |
|------|-----|
| Zenopix DALI Monitor | ${ZENOPIX_DASHBOARD_ID} |

### Rule Chains

| Name | ID |
|------|-----|
| Root Rule Chain | (default, lookup via API) |
| Zenopix DALI Rule Chain | ${ZENOPIX_RULE_CHAIN_ID} |

### Device Profiles

| Name | ID | Rule Chain |
|------|-----|-----------|
| default | (default) | Root |
| Zenopix DALI Controller | ${ZENOPIX_PROFILE_ID} | Zenopix DALI |

## Skill Files Guide

| File | Read When... |
|------|-------------|
| [iot-development.md](iot-development.md) | Starting any IoT task (this file) |
| [rest-api-reference.md](rest-api-reference.md) | You need API endpoint details, request/response formats |
| [telemetry-attributes-guide.md](telemetry-attributes-guide.md) | You work with telemetry, attributes, scopes, aggregation, MQTT device API |
| [entity-management.md](entity-management.md) | You need entity CRUD, relations, entity queries, dashboard aliases |
| [rpc-guide.md](rpc-guide.md) | You need RPC (remote commands to devices), one-way/two-way/persistent |
| [widget-catalog.md](widget-catalog.md) | You need widget FQNs or widget configuration structures |
| [widget-development.md](widget-development.md) | You are creating custom widgets, need widgetContext API or settings schema |
| [tbel-scripting.md](tbel-scripting.md) | You are writing TBEL/MVEL transform or filter scripts |
| [device-profile-guide.md](device-profile-guide.md) | You need device profiles or alarm rules |
| [rule-chain-development.md](rule-chain-development.md) | You are building rule chains via REST API (75 node catalog) |
| [dashboard-json-guide.md](dashboard-json-guide.md) | You need dashboard JSON structure, widget config, programmatic creation |
| [rule-engine.md](rule-engine.md) | You are building/modifying rule chains (source code level) |
| [architecture.md](architecture.md) | You need system architecture understanding |
| [frontend.md](frontend.md) | You are modifying the Angular UI |
| [backend.md](backend.md) | You need Spring Boot service details |
| [database.md](database.md) | You need PostgreSQL schema, DAO patterns, time-series storage |
| [deployment.md](deployment.md) | You need Docker Compose deployment, scaling, production config |
| [branding.md](branding.md) | You need white-label branding customization |
| [ttn-lorawan-integration.md](ttn-lorawan-integration.md) | You are integrating with The Things Network (TTN) |
| [zenopix-dali-reference.md](zenopix-dali-reference.md) | You are working with Zenopix DALI smart lighting |

### Template Files

| Template | Location |
|----------|----------|
| Rule Chain Skeleton | `/opt/thingsboard/.claude/templates/rule_chain_skeleton.json` |
| Dashboard Skeleton | `/opt/thingsboard/.claude/templates/dashboard_skeleton.json` |

## Top 10 Gotchas

1. **Rule chain metadata endpoint**: `POST /api/ruleChain/metadata` (NOT `/api/ruleChain/{id}/metadata`). The `ruleChainId` goes inside the JSON body, not the URL.

2. **TBEL var scope bug**: `var x = 0; if (cond) { x = val; }` -- x stays 0 outside the if block. MVEL scope issue. Use `msg.field = value;` instead.

3. **No regex in TBEL**: `/pattern/g` syntax causes "unterminated string literal". Use string comparison operators instead.

4. **RPC returns 408 for offline devices**: The RPC call returns HTTP 408 timeout, but the rule chain still processes the message. Use SET_ATTRIBUTE (SHARED_SCOPE) instead for reliable delivery.

5. **Persistent RPC ignored in CE**: `requestPersistent: true` is silently ignored in ThingsBoard CE 4.4.0. No persistent RPCs are saved to the database. This is a PE-only feature.

6. **Max concurrent sessions**: `ACTORS_MAX_CONCURRENT_SESSION_PER_DEVICE` default is 1. Setting it to 2 causes RPC to hang with HTTP 000 timeout. Do not change this value.

7. **Widget FQNs use `system.` prefix**: All built-in widgets use the `system.` prefix: `system.cards.value_card`, `system.slider`, `system.command_button`, etc.

8. **Dashboard widget UUID consistency**: The widget UUID must match in both `configuration.widgets[uuid]` and `states.{state}.layouts.main.widgets[uuid]`. A mismatch causes the widget to not render.

9. **Alarm rules need TbDeviceProfileNode**: Alarm rules defined in a device profile are ONLY evaluated when telemetry flows through a `TbDeviceProfileNode` in the device's rule chain. Without this node, alarms are completely ignored.

10. **Optimistic locking**: ThingsBoard uses a `version` field for optimistic locking. Always GET first, modify the response, then POST back. Retry on 409 Conflict errors.

## Common Workflow Patterns

### Send Telemetry to a Device

```bash
source /opt/thingsboard/.claude/credentials.env
curl -s -X POST "http://localhost:8080/api/v1/${DEVICE_TOKEN}/telemetry" \
  -H "Content-Type: application/json" \
  -d '{"temperature": 25.5, "humidity": 60}'
```

### Read Latest Telemetry

```bash
TOKEN=$(curl -s -X POST ${TB_HOST}/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "${TB_USERNAME}", "password": "${TB_PASSWORD}"}' | jq -r .token)

curl -s "${TB_HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/values/timeseries?keys=temperature,humidity" \
  -H "X-Authorization: Bearer $TOKEN"
```

### Write Shared Attribute (for Downlink)

```bash
curl -s -X POST "${TB_HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/attributes/SHARED_SCOPE" \
  -H "Content-Type: application/json" \
  -H "X-Authorization: Bearer $TOKEN" \
  -d '{"dimLevel": 75}'
```

### Python Script Template

```python
import requests
import os

TB_URL = os.environ.get("TB_URL", "http://localhost:8080")
TB_USERNAME = os.environ["TB_USERNAME"]
TB_PASSWORD = os.environ["TB_PASSWORD"]

def get_token():
    resp = requests.post(f"{TB_URL}/api/auth/login",
                         json={"username": TB_USERNAME, "password": TB_PASSWORD})
    resp.raise_for_status()
    return resp.json()["token"]

def tb_get(path, token):
    resp = requests.get(f"{TB_URL}{path}",
                        headers={"X-Authorization": f"Bearer {token}"})
    resp.raise_for_status()
    return resp.json()

def tb_post(path, body, token):
    resp = requests.post(f"{TB_URL}{path}",
                         json=body,
                         headers={"X-Authorization": f"Bearer {token}"})
    if resp.status_code == 409:
        print("Optimistic lock conflict — retry with fresh GET")
    resp.raise_for_status()
    return resp.json()
```

## Credential Safety Rule

NEVER hardcode credentials in scripts, configs, or documentation.
Always reference: `/opt/thingsboard/.claude/credentials.env`

When writing scripts, use `os.environ["VAR_NAME"]` or `source credentials.env` to load credentials at runtime. Replace any real values with `${PLACEHOLDER}` notation in documentation and templates.

## Docker Management

```bash
# View container status
docker ps | grep signconnect

# View logs (last 100 lines)
docker logs signconnect --tail 100

# Follow logs in real-time
docker logs signconnect -f --tail 50

# Restart (clears actor cache, fixes stuck TBEL scripts)
docker restart signconnect

# Check resource usage
docker stats signconnect --no-stream
```

Note: No `sudo` access on this machine. All Docker commands must work without `sudo` (current user is in the docker group).
