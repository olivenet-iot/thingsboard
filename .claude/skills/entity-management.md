<!-- Last updated: 2026-02-09 -->
<!-- Sources: EntityRelationController.java, EntityQueryController.java, AssetController.java, CustomerController.java, https://thingsboard.io/docs/user-guide/entities-and-relations/ -->

# Entity Management Guide

## Entity Types Overview

ThingsBoard models IoT infrastructure as a hierarchy of typed entities. Every entity has a globally
unique `EntityId` composed of an `entityType` string and a UUID `id`:

```json
{ "entityType": "DEVICE", "id": "784f394c-42b6-435a-983c-b7beff2784f9" }
```

### All Entity Types

| EntityType | Description |
|---|---|
| `TENANT` | Top-level business entity (organization) |
| `CUSTOMER` | Sub-entity under tenant; owns/views devices and assets |
| `USER` | Individual login account (table: `tb_user`) |
| `DEVICE` | Physical or virtual IoT device producing telemetry |
| `ASSET` | Abstract grouping entity (building, fleet, zone) |
| `DASHBOARD` | Visualization board |
| `RULE_CHAIN` | Rule engine processing pipeline |
| `RULE_NODE` | Single node within a rule chain |
| `ENTITY_VIEW` | Read-only subset of device/asset data for sharing |
| `WIDGETS_BUNDLE` | Collection of widget types |
| `WIDGET_TYPE` | Single widget definition |
| `TENANT_PROFILE` | Rate limits and API config for tenants |
| `DEVICE_PROFILE` | Transport, alarm, and processing config for devices |
| `ASSET_PROFILE` | Processing config for assets |
| `API_USAGE_STATE` | Tracks API call quotas |
| `TB_RESOURCE` | Uploaded files (images, LwM2M models) |
| `OTA_PACKAGE` | Firmware/software packages for OTA updates |
| `EDGE` | ThingsBoard Edge instance |
| `QUEUE` | Message queue definition |
| `NOTIFICATION_TARGET` | Target group for notifications |
| `NOTIFICATION_TEMPLATE` | Notification message template |
| `NOTIFICATION_RULE` | Trigger rule for notifications |
| `RPC` | Remote procedure call record |
| `OAUTH2_CLIENT` | OAuth2 identity provider |
| `CALCULATED_FIELD` | Derived telemetry field |

### Entity Hierarchy

```
Tenant
  +-- Customer
  |     +-- User (Customer User)
  |     +-- Device (assigned)
  |     +-- Asset (assigned)
  +-- User (Tenant Admin)
  +-- Device (unassigned)
  +-- Asset (unassigned)
  +-- Dashboard
  +-- Rule Chain
```

Every entity supports **attributes** (static key-value pairs), **telemetry** (time-series data),
and **relations** (directional links to other entities).

---

## Asset CRUD API

### Create or Update

```
POST ${TB_HOST}/api/asset
Authorization: Bearer ${TB_TOKEN}
```

Request body:
```json
{
  "name": "Building A",
  "type": "building",
  "label": "Main Office",
  "assetProfileId": { "entityType": "ASSET_PROFILE", "id": "UUID" },
  "additionalInfo": { "description": "HQ building" }
}
```

To update, include the `id` field. Omit `id` to create. The `tenantId` is set server-side.

Optional query params: `nameConflictPolicy` (FAIL|RENAME, default FAIL),
`uniquifySeparator` (default `_`), `uniquifyStrategy` (RANDOM|COUNTER).

### Get / Delete

```
GET  ${TB_HOST}/api/asset/{assetId}
GET  ${TB_HOST}/api/asset/info/{assetId}       # includes customer/profile names
DELETE ${TB_HOST}/api/asset/{assetId}           # TENANT_ADMIN only
```

### List with Pagination

```
GET ${TB_HOST}/api/tenant/assets?pageSize=20&page=0&textSearch=build&sortProperty=name&sortOrder=ASC
GET ${TB_HOST}/api/tenant/assets?pageSize=20&page=0&type=building
GET ${TB_HOST}/api/customer/{customerId}/assets?pageSize=20&page=0
```

Sort properties: `createdTime`, `name`, `type`, `label`, `customerTitle`.

### Lookup by Name

```
GET ${TB_HOST}/api/tenant/assets?assetName=Building%20A
```

### Batch Fetch

```
GET ${TB_HOST}/api/assets?assetIds={id1},{id2},{id3}
```

### Python Example

```python
import requests

BASE = "${TB_HOST}"
HDR = {"Authorization": f"Bearer ${TB_TOKEN}", "Content-Type": "application/json"}

# Create asset
asset = requests.post(f"{BASE}/api/asset", json={
    "name": "Floor 3",
    "type": "floor",
    "assetProfileId": {"entityType": "ASSET_PROFILE", "id": "${PROFILE_ID}"}
}, headers=HDR).json()

# List all building-type assets
page = requests.get(f"{BASE}/api/tenant/assets",
    params={"pageSize": 100, "page": 0, "type": "building"}, headers=HDR).json()
```

---

## Customer CRUD API

### Create or Update

```
POST ${TB_HOST}/api/customer
Authorization: Bearer ${TB_TOKEN}
```

```json
{
  "title": "Company A",
  "email": "admin@company-a.com",
  "country": "US",
  "state": "NY",
  "city": "New York",
  "address": "42 Broadway Suite 12-400",
  "zip": "10004",
  "phone": "+1(415)777-7777",
  "additionalInfo": {}
}
```

Note: Customer `name` is read-only and always mirrors `title`.

### Get / Delete

```
GET    ${TB_HOST}/api/customer/{customerId}
GET    ${TB_HOST}/api/customer/{customerId}/shortInfo   # returns {title, isPublic}
GET    ${TB_HOST}/api/customer/{customerId}/title        # plain text
DELETE ${TB_HOST}/api/customer/{customerId}              # TENANT_ADMIN only
```

Deleting a customer removes all customer users. Assigned devices, assets, and dashboards
are unassigned but not deleted.

### List Customers

```
GET ${TB_HOST}/api/customers?pageSize=20&page=0&textSearch=comp&sortProperty=title&sortOrder=ASC
```

Sort properties: `createdTime`, `title`, `email`, `country`, `city`.

### Lookup by Title

```
GET ${TB_HOST}/api/tenant/customers?customerTitle=Company%20A
```

### Assign Entities to Customer

```
POST ${TB_HOST}/api/customer/{customerId}/device/{deviceId}
POST ${TB_HOST}/api/customer/{customerId}/asset/{assetId}
```

Unassign:
```
DELETE ${TB_HOST}/api/customer/device/{deviceId}
DELETE ${TB_HOST}/api/customer/asset/{assetId}
```

---

## Entity Relations API

Relations are directional links between any two entities within the same tenant.
Each relation has a `type` string (e.g., "Contains") and a `typeGroup` enum.

### Relation JSON Structure

```json
{
  "from": { "entityType": "ASSET", "id": "from-uuid" },
  "to":   { "entityType": "DEVICE", "id": "to-uuid" },
  "type": "Contains",
  "typeGroup": "COMMON",
  "additionalInfo": { "description": "optional metadata" }
}
```

### Built-in Relation Types

| Constant | Value |
|---|---|
| `CONTAINS_TYPE` | `"Contains"` |
| `MANAGES_TYPE` | `"Manages"` |
| `USES_TYPE` | `"Uses"` |
| `EDGE_TYPE` | `"ManagedByEdge"` |

Custom types are arbitrary strings (max 255 chars).

### RelationTypeGroup Values

`COMMON`, `DASHBOARD`, `RULE_CHAIN`, `RULE_NODE`, `EDGE`, `EDGE_AUTO_ASSIGN_RULE_CHAIN`

Most user-created relations use `COMMON`. Omitting `typeGroup` defaults to `COMMON`.

### Create Relation

```
POST ${TB_HOST}/api/relation
```

```json
{
  "from": { "entityType": "ASSET", "id": "building-uuid" },
  "to":   { "entityType": "ASSET", "id": "floor-uuid" },
  "type": "Contains",
  "typeGroup": "COMMON"
}
```

The unique key is: `(from, to, type, typeGroup)`. Posting the same key updates the relation.

### Delete Relation

```
DELETE ${TB_HOST}/api/relation?fromId={uuid}&fromType=ASSET&relationType=Contains&toId={uuid}&toType=DEVICE
```

Optional: `relationTypeGroup` query param (defaults to COMMON).

Delete all COMMON relations for an entity:
```
DELETE ${TB_HOST}/api/relations?entityId={uuid}&entityType=ASSET
```

### Get Specific Relation

```
GET ${TB_HOST}/api/relation?fromId={uuid}&fromType=ASSET&relationType=Contains&toId={uuid}&toType=DEVICE
```

### Find Relations by Direction

From a given entity (outgoing):
```
GET ${TB_HOST}/api/relations?fromId={uuid}&fromType=ASSET
GET ${TB_HOST}/api/relations?fromId={uuid}&fromType=ASSET&relationType=Contains
```

To a given entity (incoming):
```
GET ${TB_HOST}/api/relations?toId={uuid}&toType=DEVICE
GET ${TB_HOST}/api/relations?toId={uuid}&toType=DEVICE&relationType=Contains
```

Add `relationTypeGroup=COMMON` to filter by group.

### Find by Complex Query

```
POST ${TB_HOST}/api/relations
```

```json
{
  "parameters": {
    "rootId": "building-uuid",
    "rootType": "ASSET",
    "direction": "FROM",
    "relationTypeGroup": "COMMON",
    "maxLevel": 3,
    "fetchLastLevelOnly": false
  },
  "filters": [
    { "relationType": "Contains", "entityTypes": ["ASSET", "DEVICE"] }
  ]
}
```

Use `POST /api/relations/info` for the same query with entity name/type info included.

---

## Entity Query API

The Entity Query API provides a powerful way to search entities using filters,
field selectors, and pagination. Used by dashboards and backend integrations.

### Main Endpoint

```
POST ${TB_HOST}/api/entitiesQuery/find
POST ${TB_HOST}/api/entitiesQuery/count   # returns count only
```

### EntityDataQuery Structure

```json
{
  "entityFilter": { ... },
  "entityFields": [
    { "type": "ENTITY_FIELD", "key": "name" },
    { "type": "ENTITY_FIELD", "key": "type" },
    { "type": "ENTITY_FIELD", "key": "createdTime" }
  ],
  "latestValues": [
    { "type": "ATTRIBUTE", "key": "serialNumber" },
    { "type": "TIME_SERIES", "key": "temperature" }
  ],
  "keyFilters": [],
  "pageLink": {
    "page": 0,
    "pageSize": 20,
    "textSearch": "",
    "sortOrder": {
      "key": { "type": "ENTITY_FIELD", "key": "name" },
      "direction": "ASC"
    },
    "dynamic": false
  }
}
```

### EntityKey Types

| Type | Description |
|---|---|
| `ENTITY_FIELD` | Built-in fields: `name`, `type`, `label`, `createdTime`, etc. |
| `ATTRIBUTE` | Any scope attribute (auto-selects latest) |
| `CLIENT_ATTRIBUTE` | Client-scope attribute only |
| `SHARED_ATTRIBUTE` | Shared-scope attribute only |
| `SERVER_ATTRIBUTE` | Server-scope attribute only |
| `TIME_SERIES` | Latest telemetry value |
| `ALARM_FIELD` | Alarm data fields (for alarm queries) |

### Filter Types

**singleEntity** / **entityList** / **entityType** / **entityName** -- basic filters:
```json
{ "type": "singleEntity", "singleEntity": { "entityType": "DEVICE", "id": "uuid" } }
{ "type": "entityList", "entityType": "DEVICE", "entityList": ["uuid1", "uuid2"] }
{ "type": "entityType", "entityType": "DEVICE" }
{ "type": "entityName", "entityType": "DEVICE", "entityNameFilter": "therm" }
```

**deviceType** / **assetType** / **edgeType** / **entityViewType** -- profile-based filters:
```json
{ "type": "deviceType", "deviceType": "thermostat", "deviceNameFilter": "" }
{ "type": "assetType", "assetType": "building", "assetNameFilter": "" }
```

**relationsQuery** -- entities related to a root entity:
```json
{
  "type": "relationsQuery",
  "rootEntity": { "entityType": "ASSET", "id": "building-uuid" },
  "direction": "FROM",
  "maxLevel": 5,
  "fetchLastLevelOnly": false,
  "filters": [{ "relationType": "Contains", "entityTypes": ["DEVICE"] }]
}
```

Supports `isMultiRoot`, `multiRootEntitiesType`, `multiRootEntityIds` for multiple roots.
Set `rootStateEntity: true` to use the current dashboard state entity as root.

**assetSearchQuery** / **deviceSearchQuery** / **edgeSearchQuery** / **entityViewSearchQuery** --
relation-based search filtered to a specific entity subtype.

**apiUsageState** -- returns the tenant's API usage state entity.

### Pagination Response

```json
{
  "data": [ { "entityId": {...}, "latest": {...}, "timeseries": {...} } ],
  "totalPages": 5,
  "totalElements": 98,
  "hasNext": true
}
```

---

## Dashboard Entity Aliases

Entity aliases define data sources for dashboard widgets. The alias `filter` uses the same
filter types as the Entity Query API above, plus `stateEntity` for dynamic dashboards.

### Supported Alias Filter Types

| Filter Type | Use Case |
|---|---|
| `singleEntity` | Static reference to one entity |
| `entityList` | Static list of entity IDs |
| `entityType` | All entities of a type (optional name filter) |
| `deviceType` | All devices of a device profile type |
| `assetType` | All assets of an asset profile type |
| `relationsQuery` | Entities related to a root (multi-level, set `rootStateEntity: true` for dynamic) |
| `assetSearchQuery` | Search assets by relation from root, filtered by asset type |
| `deviceSearchQuery` | Search devices by relation from root, filtered by device type |
| `edgeSearchQuery` | Search edges by relation from root |
| `entityViewSearchQuery` | Search entity views by relation from root |
| `stateEntity` | Current dashboard state entity (for drill-down dashboards) |

### resolveMultiple Flag

When `true`, the alias returns multiple entities (table/list widgets). When `false`, only
the first resolved entity is used (single-entity widgets like gauges).

### Alias in Dashboard JSON

```json
{
  "entityAliases": {
    "alias-uuid-1": {
      "id": "alias-uuid-1",
      "alias": "My Devices",
      "filter": {
        "type": "deviceType",
        "deviceType": "thermostat",
        "deviceNameFilter": "",
        "resolveMultiple": true
      }
    }
  }
}
```

---

## Relations in Rule Chains

Rule engine nodes can create, delete, and check relations dynamically
as messages flow through the processing pipeline.

### TbCreateRelationNode (Action: "create relation")

Creates a relation between the message originator and a target entity.

Configuration:
- **entityType**: DEVICE, ASSET, ENTITY_VIEW, TENANT, CUSTOMER, DASHBOARD, USER, EDGE
- **entityNamePattern**: supports `${metadataKey}` patterns for dynamic resolution
- **direction**: FROM or TO (relative to originator)
- **relationType**: string, supports `${metadataKey}` patterns (default: "Contains")
- **createEntityIfNotExists**: if true, creates the target device/asset/customer if missing
- **removeCurrentRelations**: removes existing relations of same type/direction first
- **changeOriginatorToRelatedEntity**: replaces message originator with the target entity

Outputs: `Success` or `Failure`.

### TbDeleteRelationNode (Action: "delete relation")

Deletes relation(s) involving the message originator.

Configuration:
- **deleteForSingleEntity**: if true, deletes relation to a specific entity; if false,
  deletes all relations matching the type and direction
- Same entity target config as create node
- **direction**: FROM or TO
- **relationType**: supports `${metadataKey}` patterns

Outputs: `Success` or `Failure`.

### TbCheckRelationNode (Filter: "check relation presence")

Routes messages based on whether a relation exists.

Configuration:
- **checkForSingleEntity**: if true, checks relation to a specific entity
- **entityType** / **entityId**: the specific entity to check against
- **direction**: FROM or TO
- **relationType**: the relation type to check

Outputs: `True` (relation exists) or `False` (no relation), or `Failure`.

### TbChangeOriginatorNode (Transformation: "change originator")

Changes the message originator to a related or parent entity.

Originator sources:
- **CUSTOMER** -- customer of the originator (for assigned devices/assets/users)
- **TENANT** -- current tenant
- **RELATED** -- entity found via a configurable relations query
- **ALARM_ORIGINATOR** -- originator of the alarm (when message is from an alarm entity)
- **ENTITY** -- entity by name pattern and type (DEVICE, ASSET, ENTITY_VIEW, EDGE, USER)

Outputs: `Success` or `Failure`.

### Example: Auto-Creating Asset Hierarchy

Use a **create relation** node after the "Post telemetry" message type filter:

1. Message arrives from a device with metadata `buildingName=HQ`
2. Create relation node targets ASSET type, name pattern `${buildingName}`,
   direction FROM (building -> device), type "Contains", createEntityIfNotExists=true
3. Result: device is automatically linked under the "HQ" asset

---

## Pagination Best Practices

All paginated endpoints return a `PageData` wrapper:

```json
{
  "data": [...],
  "totalPages": 10,
  "totalElements": 195,
  "hasNext": true
}
```

Guidelines:
- Default `pageSize` is typically 10; maximum is technically 2147483647 but never use that
- Recommended `pageSize`: 100-1000 for batch operations, 10-50 for UI
- `page` is zero-indexed
- `textSearch` performs case-insensitive partial match on entity name
- `sortProperty` options vary by entity: `name`, `type`, `label`, `createdTime`, `customerTitle`
- `sortOrder`: `ASC` or `DESC`
- Check `hasNext` to determine if more pages exist

### Iterating All Pages (Python)

```python
import requests

BASE = "${TB_HOST}"
HDR = {"Authorization": f"Bearer ${TB_TOKEN}"}

def fetch_all_assets(asset_type=None):
    all_assets = []
    page = 0
    while True:
        params = {"pageSize": 100, "page": page, "sortProperty": "name", "sortOrder": "ASC"}
        if asset_type:
            params["type"] = asset_type
        resp = requests.get(f"{BASE}/api/tenant/assets", params=params, headers=HDR).json()
        all_assets.extend(resp["data"])
        if not resp["hasNext"]:
            break
        page += 1
    return all_assets

assets = fetch_all_assets("building")
```

### Entity Query Pagination

Use `EntityDataPageLink.dynamic = true` in dashboard widgets for server-side push updates.
For REST batch operations, keep `dynamic = false` and iterate `pageLink.page` using the
same `hasNext` pattern shown above.
