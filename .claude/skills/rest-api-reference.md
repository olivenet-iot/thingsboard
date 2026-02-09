<!-- Last updated: 2026-02-09 -->
<!-- Sources: Controller classes in /application/src/main/java/org/thingsboard/server/controller/, ThingsBoard REST API docs -->

# ThingsBoard REST API Reference

Complete REST API reference for ThingsBoard CE v4.4.0-SNAPSHOT. All examples use `${TB_HOST}` and `${TB_TOKEN}` placeholders.

## Base Configuration

- Base URL: `${TB_HOST}` (default: `http://localhost:8080`)
- Auth header: `X-Authorization: Bearer ${TB_TOKEN}`
- Content-Type: `application/json` for all POST/PUT requests
- Credentials file: `/opt/thingsboard/.claude/credentials.env`

---

## 1. Authentication

### Login

```
POST ${TB_HOST}/api/auth/login
```

**IMPORTANT**: The endpoint is `/api/auth/login`, NOT `/api/noauth/login`.

**Request:**
```json
{
  "username": "${TB_USERNAME}",
  "password": "${TB_PASSWORD}"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzUxMiJ9...",
  "refreshToken": "eyJhbGciOiJIUzUxMiJ9..."
}
```

**Notes:**
- Token expires in approximately 15 minutes
- Use the `token` field as `X-Authorization: Bearer {token}`
- Store `refreshToken` for renewal

### Token Refresh

```
POST ${TB_HOST}/api/auth/token
```

**Request:**
```json
{
  "refreshToken": "${REFRESH_TOKEN}"
}
```

**Response:** Same format as login (new token + new refreshToken).

### Get Current User

```
GET ${TB_HOST}/api/auth/user
X-Authorization: Bearer ${TB_TOKEN}
```

**Response:** User object with `id`, `email`, `authority` (TENANT_ADMIN, CUSTOMER_USER, SYS_ADMIN).

---

## 2. Pagination Pattern

All list endpoints use consistent pagination. See [entity-management.md](entity-management.md) for full pagination details.

```
GET ${TB_HOST}/api/{resource}?pageSize=100&page=0&sortProperty=name&sortOrder=ASC
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| pageSize | int | 10 | Items per page (max 1000) |
| page | int | 0 | Zero-based page number |
| sortProperty | string | createdTime | Sort field |
| sortOrder | string | ASC | ASC or DESC |
| textSearch | string | (none) | Filter by name substring |

**Response envelope:**
```json
{
  "data": [ ... ],
  "totalPages": 5,
  "totalElements": 42,
  "hasNext": true
}
```

To fetch all items, loop while `hasNext` is `true`, incrementing `page`.

---

## 3. Device CRUD

### List Devices (Paginated)

```
GET ${TB_HOST}/api/tenant/devices?pageSize=100&page=0
X-Authorization: Bearer ${TB_TOKEN}
```

### Get Device by ID

```
GET ${TB_HOST}/api/device/${DEVICE_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

**Response:** Device object with `id`, `name`, `type`, `label`, `deviceProfileId`, `version`, `createdTime`, `additionalInfo`.

### Create Device

```
POST ${TB_HOST}/api/device
X-Authorization: Bearer ${TB_TOKEN}
```

**Request:**
```json
{
  "name": "new-device",
  "type": "default",
  "label": "New Device",
  "deviceProfileId": {"entityType": "DEVICE_PROFILE", "id": "${PROFILE_ID}"}
}
```

**Response:** Full device object with generated `id` and `version: 0`.

### Update Device

Same endpoint as create. Include the full object from GET (with `id` and `version`). The `version` field is required for optimistic locking (see section 13).

### Delete Device

```
DELETE ${TB_HOST}/api/device/${DEVICE_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

### Get Device Credentials

```
GET ${TB_HOST}/api/device/${DEVICE_ID}/credentials
X-Authorization: Bearer ${TB_TOKEN}
```

**Response:** Object with `credentialsType` (ACCESS_TOKEN), `credentialsId` (the access token), and `deviceId`. The `credentialsId` is used for `POST /api/v1/{TOKEN}/telemetry`.

---

## 4. Dashboard CRUD

### List Dashboards (Paginated)

```
GET ${TB_HOST}/api/tenant/dashboards?pageSize=100&page=0
X-Authorization: Bearer ${TB_TOKEN}
```

### Get Full Dashboard JSON

```
GET ${TB_HOST}/api/dashboard/${DASHBOARD_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

**Response:** Complete dashboard object including `configuration` with widgets, aliases, states, and layout.

### Create Dashboard

```
POST ${TB_HOST}/api/dashboard
X-Authorization: Bearer ${TB_TOKEN}
```

**Request:**
```json
{
  "title": "My Dashboard",
  "configuration": {
    "widgets": { },
    "entityAliases": { },
    "states": { },
    "filters": {},
    "timewindow": { },
    "settings": { }
  }
}
```

See `/opt/thingsboard/.claude/templates/dashboard_skeleton.json` for a complete template.

### Update Dashboard

Same endpoint as create. Include `id` and `version` from the GET response.

### Delete Dashboard

```
DELETE ${TB_HOST}/api/dashboard/${DASHBOARD_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

---

## 5. Rule Chain CRUD

### List Rule Chains

```
GET ${TB_HOST}/api/ruleChains?pageSize=100&page=0
X-Authorization: Bearer ${TB_TOKEN}
```

### Get Rule Chain (Header Only)

```
GET ${TB_HOST}/api/ruleChain/${RULE_CHAIN_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

Returns the rule chain header (name, type, root flag) but NOT the nodes/connections.

### Get Rule Chain Metadata (Nodes + Connections)

```
GET ${TB_HOST}/api/ruleChain/${RULE_CHAIN_ID}/metadata
X-Authorization: Bearer ${TB_TOKEN}
```

**Response:** Object with `ruleChainId`, `firstNodeIndex`, `nodes[]`, `connections[]`, and `ruleChainConnections`.

### Update Rule Chain Metadata

**CRITICAL**: The endpoint for UPDATING metadata is different from the GET endpoint:

```
POST ${TB_HOST}/api/ruleChain/metadata
X-Authorization: Bearer ${TB_TOKEN}
```

**NOT** `/api/ruleChain/{id}/metadata`. The `ruleChainId` is inside the JSON body.

### Create Empty Rule Chain

```
POST ${TB_HOST}/api/ruleChain
X-Authorization: Bearer ${TB_TOKEN}
```

**Request:**
```json
{
  "name": "My Rule Chain",
  "type": "CORE",
  "debugMode": false
}
```

Then set metadata via `POST /api/ruleChain/metadata`.

### Set as Root Rule Chain

```
POST ${TB_HOST}/api/ruleChain/${RULE_CHAIN_ID}/root
X-Authorization: Bearer ${TB_TOKEN}
```

### Delete Rule Chain

```
DELETE ${TB_HOST}/api/ruleChain/${RULE_CHAIN_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

---

## 6. Device Profile CRUD

### List Device Profiles

```
GET ${TB_HOST}/api/deviceProfiles?pageSize=100&page=0
X-Authorization: Bearer ${TB_TOKEN}
```

### Get Device Profile by ID

```
GET ${TB_HOST}/api/deviceProfile/${PROFILE_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

### Create or Update Device Profile

```
POST ${TB_HOST}/api/deviceProfile
X-Authorization: Bearer ${TB_TOKEN}
```

**Request (create):**
```json
{
  "name": "My Profile",
  "type": "DEFAULT",
  "transportType": "DEFAULT",
  "defaultRuleChainId": {"entityType": "RULE_CHAIN", "id": "${RULE_CHAIN_ID}"},
  "profileData": {
    "configuration": {"type": "DEFAULT"},
    "transportConfiguration": {"type": "DEFAULT"},
    "provisionConfiguration": {"type": "DISABLED"},
    "alarms": []
  }
}
```

For update, include `id` and `version` from the GET response.

See [device-profile-guide.md](device-profile-guide.md) for alarm rule configuration details.

---

## 7. Telemetry (Summary)

For full telemetry API details including aggregation, delete, and MQTT/CoAP protocols, see [telemetry-attributes-guide.md](telemetry-attributes-guide.md).

| Operation | Endpoint |
|-----------|----------|
| Get timeseries keys | `GET /api/plugins/telemetry/DEVICE/${DEVICE_ID}/keys/timeseries` |
| Get latest values | `GET /api/plugins/telemetry/DEVICE/${DEVICE_ID}/values/timeseries?keys=temp,humidity` |
| Get with time range | `GET /api/plugins/telemetry/DEVICE/${DEVICE_ID}/values/timeseries?keys=temp&startTs=...&endTs=...&agg=NONE` |
| Push via device token | `POST /api/v1/${DEVICE_TOKEN}/telemetry` (no JWT needed) |
| Push via JWT (server-side) | `POST /api/plugins/telemetry/DEVICE/${DEVICE_ID}/timeseries/ANY?scope=ANY` |

Aggregation options: `NONE`, `AVG`, `MIN`, `MAX`, `SUM`, `COUNT` (requires `interval` param when not NONE).

---

## 8. Attributes (Summary)

For full attribute API details including scopes, MQTT subscriptions, and best practices, see [telemetry-attributes-guide.md](telemetry-attributes-guide.md).

| Scope | Read By | Write By |
|-------|---------|----------|
| CLIENT_SCOPE | Server, Device | Device only |
| SERVER_SCOPE | Server, Device | Server only |
| SHARED_SCOPE | Server, Device | Server only (pushed to device on change) |

| Operation | Endpoint |
|-----------|----------|
| Read by scope | `GET /api/plugins/telemetry/DEVICE/${DEVICE_ID}/values/attributes/SERVER_SCOPE?keys=key1,key2` |
| Read all scopes | `GET /api/plugins/telemetry/DEVICE/${DEVICE_ID}/values/attributes` |
| Write server attrs | `POST /api/plugins/telemetry/DEVICE/${DEVICE_ID}/attributes/SERVER_SCOPE` |
| Write shared attrs | `POST /api/plugins/telemetry/DEVICE/${DEVICE_ID}/attributes/SHARED_SCOPE` |
| Write client attrs (device) | `POST /api/v1/${DEVICE_TOKEN}/attributes` (no JWT needed) |

---

## 9. RPC (Summary)

For full RPC details including persistent RPC, MQTT protocol, gotchas, and widget integration, see [rpc-guide.md](rpc-guide.md).

| Operation | Endpoint |
|-----------|----------|
| One-way RPC | `POST /api/plugins/rpc/oneway/${DEVICE_ID}` |
| Two-way RPC | `POST /api/plugins/rpc/twoway/${DEVICE_ID}` |

**Request body:** `{"method": "setDim", "params": {"value": 75}, "timeout": 5000}`

**Key gotchas:** 408 for offline devices (rule chain still processes); persistent RPC is PE-only; use SHARED_SCOPE attributes for offline device control from dashboards.

---

## 10. Widget Types

### List Widget Bundles

```
GET ${TB_HOST}/api/widgetsBundles?pageSize=100&page=0
X-Authorization: Bearer ${TB_TOKEN}
```

### Get Widget Type by FQN

```
GET ${TB_HOST}/api/widgetType?fqn=system.cards.value_card
X-Authorization: Bearer ${TB_TOKEN}
```

### Get All Widget Types in a Bundle

```
GET ${TB_HOST}/api/widgetTypes?widgetsBundleId=${BUNDLE_ID}&pageSize=100&page=0
X-Authorization: Bearer ${TB_TOKEN}
```

See [widget-catalog.md](widget-catalog.md) for FQN catalog.

---

## 11. Alarms

### List Alarms by Device

```
GET ${TB_HOST}/api/alarm/DEVICE/${DEVICE_ID}?pageSize=100&page=0
X-Authorization: Bearer ${TB_TOKEN}
```

Optional filters: `&status=ACTIVE_UNACK&severity=CRITICAL`

**Status values:** `ACTIVE_UNACK`, `ACTIVE_ACK`, `CLEARED_UNACK`, `CLEARED_ACK`
**Severity values:** `CRITICAL`, `MAJOR`, `MINOR`, `WARNING`, `INDETERMINATE`

### Get / Acknowledge / Clear / Delete Alarm

```
GET    ${TB_HOST}/api/alarm/${ALARM_ID}
POST   ${TB_HOST}/api/alarm/${ALARM_ID}/ack
POST   ${TB_HOST}/api/alarm/${ALARM_ID}/clear
DELETE ${TB_HOST}/api/alarm/${ALARM_ID}
```

All require `X-Authorization: Bearer ${TB_TOKEN}`.

---

## 12. Audit Log API

### Get Audit Logs for an Entity

```
GET ${TB_HOST}/api/audit/logs/entity/{entityType}/{entityId}?pageSize=20&page=0
X-Authorization: Bearer ${TB_TOKEN}
```

### Get Tenant-Level Audit Logs

```
GET ${TB_HOST}/api/audit/logs?pageSize=20&page=0
X-Authorization: Bearer ${TB_TOKEN}
```

**Filter parameters:** `startTime`, `endTime` (ms since epoch), `actionTypes` (comma-separated: LOGIN, LOGOUT, ADDED, DELETED, UPDATED, ATTRIBUTES_UPDATED, RPC_CALL, etc.).

**Response:** Paginated list of audit log entries, each containing `entityId`, `actionType`, `actionData`, `actionStatus`, and `createdTime`.

---

## 13. Admin / System API

### Security Settings

```
GET  ${TB_HOST}/api/admin/securitySettings
POST ${TB_HOST}/api/admin/securitySettings
X-Authorization: Bearer ${TB_TOKEN}
```

GET returns current security configuration (password policy, max failed login attempts, etc.). POST updates it. Requires SYS_ADMIN authority.

### System Info

```
GET ${TB_HOST}/api/system/info
X-Authorization: Bearer ${TB_TOKEN}
```

Returns system version, build timestamp, and other metadata. No special authority required.

---

## 14. User Management API

### Create User

```
POST ${TB_HOST}/api/user
X-Authorization: Bearer ${TB_TOKEN}
```

**Request:**
```json
{
  "email": "newuser@example.com",
  "firstName": "New",
  "lastName": "User",
  "authority": "TENANT_ADMIN",
  "tenantId": {"entityType": "TENANT", "id": "${TENANT_ID}"}
}
```

For CUSTOMER_USER authority, also include `customerId`.

### Get / Delete User

```
GET    ${TB_HOST}/api/user/${USER_ID}
DELETE ${TB_HOST}/api/user/${USER_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

### Get Activation Link

```
GET ${TB_HOST}/api/user/${USER_ID}/activationLink
X-Authorization: Bearer ${TB_TOKEN}
```

Returns the one-time activation URL for a newly created user who has not yet set a password.

---

## 15. Error Handling

| Status Code | Meaning | Action |
|-------------|---------|--------|
| 200 | Success | Process response |
| 401 | Unauthorized / Token expired | Re-authenticate with `/api/auth/login` |
| 403 | Forbidden | Check user permissions |
| 404 | Entity not found | Verify entity ID exists |
| 408 | RPC timeout | Device offline; rule chain still processes |
| 409 | Optimistic lock conflict | GET fresh copy, re-apply changes, POST again |
| 429 | Too Many Requests | Rate limited; retry after delay (see section 18) |
| 500 | Internal server error | Check `docker logs signconnect` |

---

## 16. Optimistic Locking Pattern

ThingsBoard uses a `version` field on all entities for optimistic concurrency control.

### Pattern: GET -> Modify -> POST (Retry on 409)

1. `GET` the entity to obtain the current `version`
2. Modify the fields you need to change
3. `POST` the full entity (with `id` and `version`) back to the same endpoint
4. If you get a **409 Conflict**, re-GET the entity (which now has a newer `version`), re-apply your changes, and POST again

**Key Rules:**
- Always include the `version` field from the GET response in the POST body
- Never cache entities for long periods -- always GET a fresh copy before updating
- The `version` field auto-increments on each successful update

---

## 17. Useful Query Patterns

### Find Device by Name

```
GET ${TB_HOST}/api/tenant/devices?pageSize=1&page=0&textSearch=my-device-name
X-Authorization: Bearer ${TB_TOKEN}
```

### Find Dashboard by Title

```
GET ${TB_HOST}/api/tenant/dashboards?pageSize=1&page=0&textSearch=DALI
X-Authorization: Bearer ${TB_TOKEN}
```

### Get Device Telemetry / Attribute Keys

```
GET ${TB_HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/keys/timeseries
GET ${TB_HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/keys/attributes
X-Authorization: Bearer ${TB_TOKEN}
```

---

## 18. Rate Limiting

ThingsBoard enforces rate limits configured in the **Tenant Profile**.

- When rate-limited, the API returns **429 Too Many Requests**
- Check the `X-Rate-Limit-Remaining` header to monitor remaining quota
- Rate limits apply per-tenant and cover REST API calls, telemetry messages, and rule engine operations
- Configure limits in: **Tenant Profiles > Rate Limits** (or via `POST /api/tenantProfile` API)
- When hitting 429, implement exponential backoff before retrying
