<!-- Last updated: 2026-02-09 -->
<!-- Sources: Dashboard source code, ThingsBoard docs -->

# Dashboard JSON Structure Guide

Deep-dive reference for ThingsBoard dashboard JSON structure, widget configuration, and programmatic dashboard creation.

## Top-Level Structure

```json
{
  "id": {"entityType": "DASHBOARD", "id": "${DASHBOARD_UUID}"},
  "createdTime": 1234567890000,
  "tenantId": {"entityType": "TENANT", "id": "${TENANT_UUID}"},
  "title": "My Dashboard",
  "assignedCustomers": [],
  "mobileHide": false,
  "mobileOrder": null,
  "image": null,
  "version": 1,
  "configuration": { ... }
}
```

Key fields:
- `id` / `tenantId`: auto-generated on creation; include when updating
- `title`: dashboard display name
- `version`: optimistic lock counter -- GET first, then POST with same version; retry on 409
- `configuration`: the entire dashboard definition (widgets, aliases, states, settings)

## Configuration Tree

```
configuration
├── widgets {uuid -> widget definition}
│   └── {uuid}
│       ├── typeFullFqn (e.g. "system.cards.value_card")
│       ├── type ("latest", "timeseries", "rpc", "alarm", "static")
│       ├── sizeX, sizeY (grid units)
│       └── config
│           ├── datasources[] (entity binding)
│           │   └── {type, entityAliasId, dataKeys[]}
│           ├── settings (widget-specific appearance/behavior)
│           ├── actions {} (click actions, navigation)
│           ├── targetDevice {type, deviceId} (RPC widgets only)
│           ├── widgetCss (custom CSS for this widget)
│           └── configMode ("basic" or "advanced")
├── entityAliases {uuid -> alias definition}
│   └── {uuid}
│       ├── alias (display name)
│       └── filter
│           ├── type: "singleEntity" | "entityList" | "deviceType" | "relationsQuery" | ...
│           └── singleEntity: {entityType, id}
├── states
│   └── {stateName}
│       ├── name, root (boolean)
│       └── layouts.main.widgets {uuid -> position}
│           └── {uuid}: {row, col, sizeX, sizeY}
├── filters {}
├── settings
│   ├── stateControllerId: "entity"
│   ├── showTitle, showDashboardsSelect, showEntitiesSelect
│   ├── showDashboardTimewindow, showDashboardExport
│   ├── toolbarAlwaysOpen
│   └── dashboardCss (custom CSS for entire dashboard)
└── timewindow
    ├── selectedTab (0=realtime, 1=history)
    └── realtime {realtimeType, timewindowMs, interval}
```

## Entity Aliases

Entity aliases decouple widgets from specific devices, allowing re-binding without widget reconfiguration.
For the full list of alias filter types and the Entity Query API, see [entity-management.md](entity-management.md).

### singleEntity

Binds to exactly one entity by ID.

```json
{
  "alias-uuid-here": {
    "id": "alias-uuid-here",
    "alias": "My Device",
    "filter": {
      "type": "singleEntity",
      "resolveMultiple": false,
      "singleEntity": {"entityType": "DEVICE", "id": "${DEVICE_ID}"}
    }
  }
}
```

### entityList

Binds to multiple entities by explicit IDs.

```json
{
  "alias-uuid-here": {
    "id": "alias-uuid-here",
    "alias": "Selected Devices",
    "filter": {
      "type": "entityList",
      "resolveMultiple": true,
      "entityType": "DEVICE",
      "entityList": ["${DEVICE_ID_1}", "${DEVICE_ID_2}"]
    }
  }
}
```

### deviceType

Binds to all devices of a given profile type. Useful for fleet dashboards.

```json
{
  "alias-uuid-here": {
    "id": "alias-uuid-here",
    "alias": "All DALI Controllers",
    "filter": {
      "type": "deviceType",
      "resolveMultiple": true,
      "deviceType": "Zenopix DALI Controller",
      "deviceNameFilter": ""
    }
  }
}
```

### relationsQuery

Binds to entities related to a root entity. Supports multi-level traversal and dynamic root via dashboard state.

```json
{
  "alias-uuid-here": {
    "id": "alias-uuid-here",
    "alias": "Devices in Building",
    "filter": {
      "type": "relationsQuery",
      "rootStateEntity": true,
      "direction": "FROM",
      "maxLevel": 5,
      "fetchLastLevelOnly": false,
      "filters": [{"relationType": "Contains", "entityTypes": ["DEVICE"]}]
    }
  }
}
```

Set `rootStateEntity: false` and provide `rootEntity: {"entityType": "ASSET", "id": "uuid"}` for a static root.
See [entity-management.md](entity-management.md) for all alias filter types including `assetType`, `assetSearchQuery`, `deviceSearchQuery`, and `stateEntity`.

## Widget Definitions

Each widget in `configuration.widgets` is keyed by UUID. For the full FQN catalog of built-in widgets, see [widget-catalog.md](widget-catalog.md).

### Common Widget Structure

```json
{
  "widget-uuid-here": {
    "typeFullFqn": "system.cards.value_card",
    "type": "latest",
    "sizeX": 4,
    "sizeY": 3,
    "row": 0,
    "col": 0,
    "config": {
      "datasources": [...],
      "settings": {...},
      "actions": {},
      "showTitle": true,
      "title": "Temperature",
      "titleFont": {"size": 16, "sizeUnit": "px", "family": "Roboto"},
      "configMode": "basic",
      "color": "#000",
      "backgroundColor": "#fff",
      "padding": "8px",
      "margin": "0px",
      "borderRadius": "4px",
      "widgetStyle": {},
      "widgetCss": "",
      "titleStyle": {},
      "units": "",
      "decimals": null,
      "noDataDisplayMessage": "",
      "showLegend": false,
      "enableFullscreen": true
    }
  }
}
```

### Widget Types

| type | Description | Binding |
|------|-------------|---------|
| `latest` | Shows latest value of attribute/telemetry | datasources |
| `timeseries` | Time-series chart | datasources |
| `rpc` | Sends RPC commands to device | targetDevice or datasources |
| `alarm` | Shows alarm list/table | datasources |
| `static` | Static content (HTML, markdown, navigation) | none or datasources |

All built-in widgets use the `system.` prefix (e.g., `system.cards.value_card`). Custom widgets use `tenantId.bundleAlias.widgetAlias`. For the complete FQN table, see [widget-catalog.md](widget-catalog.md). For widget-specific settings details, see [widget-development.md](widget-development.md).

## Datasources

Datasources bind widgets to entity data.

### Telemetry Datasource

```json
{
  "datasources": [{
    "type": "entity",
    "entityAliasId": "alias-uuid-here",
    "filterId": null,
    "dataKeys": [{
      "name": "temperature",
      "type": "timeseries",
      "label": "Temperature",
      "color": "#2196f3",
      "settings": {},
      "funcBody": null,
      "postFuncBody": null
    }]
  }]
}
```

### Data Key Types

| type | Description |
|------|-------------|
| `timeseries` | Time-series telemetry key |
| `attribute` | Entity attribute (client, server, or shared) |
| `entityField` | Built-in entity field (name, type, label) |
| `alarm` | Alarm field (severity, type, status) |
| `function` | Calculated field from funcBody |
| `count` | Entity count |

### Data Key with Post-Processing

```json
{
  "name": "temperature",
  "type": "timeseries",
  "label": "Temp (F)",
  "postFuncBody": "return value * 9/5 + 32;"
}
```

## Target Device (RPC Widgets)

RPC widgets use `targetDevice` instead of or in addition to `datasources`.

```json
{"targetDevice": {"type": "device", "deviceId": "${DEVICE_ID}"}}
```

Or via entity alias:

```json
{"targetDevice": {"type": "entity", "entityAliasId": "alias-uuid-here"}}
```

## Layout and Grid System

### Grid Properties
- 24 columns wide, row/col are zero-based
- `sizeX`: width in grid units (max 24), `sizeY`: height in grid units
- Default margin: 10px between widgets
- Widgets cannot overlap in the same layout

### Layout Widgets Object

The `states.{state}.layouts.main.widgets` object maps widget UUIDs to positions:

```json
{
  "main": {
    "name": "Main",
    "root": true,
    "layouts": {
      "main": {
        "widgets": {
          "widget-uuid-1": {"sizeX": 4, "sizeY": 3, "row": 0, "col": 0},
          "widget-uuid-2": {"sizeX": 4, "sizeY": 3, "row": 0, "col": 4},
          "widget-uuid-3": {"sizeX": 8, "sizeY": 3, "row": 0, "col": 8},
          "widget-uuid-4": {"sizeX": 24, "sizeY": 6, "row": 3, "col": 0}
        },
        "gridSettings": {
          "backgroundColor": "#eeeeee",
          "columns": 24,
          "margin": 10,
          "outerMargin": true,
          "backgroundSizeMode": "100%"
        }
      }
    }
  }
}
```

### Typical Row Layouts

| Pattern | Columns per widget | Widgets per row |
|---------|-------------------|-----------------|
| 6 cards | 4 each | `col: 0, 4, 8, 12, 16, 20` |
| 4 cards | 6 each | `col: 0, 6, 12, 18` |
| 3 cards | 8 each | `col: 0, 8, 16` |
| 2 cards | 12 each | `col: 0, 12` |
| Full width | 24 | `col: 0` |

### UUID Consistency Rule

**CRITICAL**: Widget UUIDs must match in two places:
1. `configuration.widgets[uuid]` -- widget definition
2. `states.{state}.layouts.main.widgets[uuid]` -- widget position

If these UUIDs do not match, the widget will not render. Always generate the UUID once and use it in both locations.

## Multi-State Dashboards

States define separate "pages" within a single dashboard. Navigation widgets switch between them.

```json
{
  "states": {
    "main": {
      "name": "Main",
      "root": true,
      "layouts": {"main": {"widgets": { ... }}}
    },
    "schedule": {
      "name": "Schedule",
      "root": false,
      "layouts": {"main": {"widgets": { ... }}}
    }
  }
}
```

- Exactly one state should have `"root": true` (shown on first load)
- State names are used as URL parameters

## Dashboard Action Types

Actions define what happens on user interaction (row click, button press, marker click, etc.).

| Action Type | Description | Key Parameters |
|-------------|-------------|----------------|
| `openDashboardState` | Navigate to a named state within this dashboard | `targetDashboardStateId` |
| `updateDashboardState` | Update state params without full navigation | `stateParams` |
| `openDashboard` | Open a different dashboard entirely | `dashboardId`, `dashboardStateId` |
| `custom` | Execute custom JavaScript function | `customFunction` body |
| `customPrettyAction` | Custom JS with full code editor | `customFunction` body |
| `mobileAction` | Trigger mobile-specific action (call, map, etc.) | `mobileActionType` |
| `setEntityFromWidget` | Set entity context for child states | (auto from row entity) |

### Action Example

```json
{
  "actions": {
    "rowClick": {
      "name": "Go to Details",
      "type": "openDashboardState",
      "targetDashboardStateId": "device_details",
      "setEntityId": true,
      "openRightLayout": false
    }
  }
}
```

Or use `system.navigation_cards` widget to provide clickable cards that navigate to other states.

## Dashboard and Widget CSS

### Dashboard-Level CSS

Apply global styles to the entire dashboard via `configuration.settings.dashboardCss`:

```json
{
  "settings": {
    "dashboardCss": ".tb-widget { border: 1px solid #ddd; }\n.mat-toolbar { background: #17212b; }"
  }
}
```

### Widget-Level CSS

Apply scoped styles to an individual widget via `config.widgetCss`:

```json
{
  "config": {
    "widgetCss": ".my-class { color: red; font-weight: bold; }"
  }
}
```

Widget CSS is scoped to the widget container. Dashboard CSS applies globally across all widgets.

## Dashboard Settings

```json
{
  "settings": {
    "stateControllerId": "entity",
    "showTitle": true,
    "showDashboardsSelect": false,
    "showEntitiesSelect": false,
    "showFilters": false,
    "showDashboardTimewindow": true,
    "showDashboardExport": true,
    "toolbarAlwaysOpen": true,
    "dashboardCss": ""
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `stateControllerId` | `"entity"` | State controller type |
| `showTitle` | `true` | Show dashboard title in toolbar |
| `showDashboardsSelect` | `false` | Show dashboard selector dropdown |
| `showEntitiesSelect` | `false` | Show entity selector for aliases |
| `showDashboardTimewindow` | `true` | Show time window selector |
| `showDashboardExport` | `true` | Show export button |
| `toolbarAlwaysOpen` | `true` | Keep toolbar expanded |
| `dashboardCss` | `""` | Custom CSS applied to the entire dashboard |

## Timewindow Configuration

### Realtime (Live Data)

```json
{
  "selectedTab": 0,
  "realtime": {
    "realtimeType": 0,
    "timewindowMs": 86400000,
    "quickInterval": "CURRENT_DAY",
    "interval": 1000
  },
  "aggregation": {"type": "NONE", "limit": 50000}
}
```

### History (Past Data)

```json
{
  "selectedTab": 1,
  "history": {
    "historyType": 0,
    "timewindowMs": 604800000,
    "interval": 60000,
    "fixedTimewindow": {
      "startTimeMs": 1700000000000,
      "endTimeMs": 1700100000000
    }
  },
  "aggregation": {"type": "AVG", "limit": 25000}
}
```

### Aggregation Types

`NONE` (raw), `AVG`, `MIN`, `MAX`, `SUM`, `COUNT`

### Quick Interval Values

`CURRENT_DAY`, `CURRENT_WEEK`, `CURRENT_MONTH`, `CURRENT_YEAR`

## Programmatic Dashboard Creation

### Step-by-Step Process

1. Generate UUIDs for entity aliases (one per device/entity)
2. Generate UUIDs for each widget
3. Build entity aliases dictionary
4. Build widgets dictionary with configs, datasources, and settings
5. Build layout widgets dictionary with row/col/sizeX/sizeY positions
6. Assemble states with layouts
7. Combine into configuration
8. POST to `${TB_HOST}/api/dashboard`

### Python Example

```python
import uuid, requests

def gen_uuid():
    return str(uuid.uuid4())

# 1. Entity alias
alias_id = gen_uuid()
entity_aliases = {
    alias_id: {
        "id": alias_id, "alias": "My Device",
        "filter": {"type": "singleEntity", "resolveMultiple": False,
                   "singleEntity": {"entityType": "DEVICE", "id": "${DEVICE_ID}"}}
    }
}

# 2. Widget
widget_id = gen_uuid()
widgets = {
    widget_id: {
        "typeFullFqn": "system.cards.value_card", "type": "latest",
        "sizeX": 4, "sizeY": 3,
        "config": {
            "datasources": [{"type": "entity", "entityAliasId": alias_id,
                "dataKeys": [{"name": "temperature", "type": "timeseries",
                              "label": "Temperature", "color": "#2196f3", "settings": {}}]}],
            "settings": {"layout": "square", "autoScale": True},
            "showTitle": True, "title": "Temperature"
        }
    }
}

# 3. Layout
layout_widgets = {widget_id: {"sizeX": 4, "sizeY": 3, "row": 0, "col": 0}}

# 4. Assemble and POST
dashboard = {
    "title": "My Dashboard",
    "configuration": {
        "widgets": widgets, "entityAliases": entity_aliases, "filters": {},
        "states": {"main": {"name": "Main", "root": True, "layouts": {"main": {
            "widgets": layout_widgets,
            "gridSettings": {"backgroundColor": "#eeeeee", "columns": 24, "margin": 10, "outerMargin": True}
        }}}},
        "settings": {"stateControllerId": "entity", "showTitle": True,
                     "showDashboardTimewindow": True, "toolbarAlwaysOpen": True},
        "timewindow": {"selectedTab": 0, "realtime": {"realtimeType": 0, "timewindowMs": 86400000},
                       "aggregation": {"type": "NONE", "limit": 50000}}
    }
}

headers = {"X-Authorization": f"Bearer ${TB_TOKEN}", "Content-Type": "application/json"}
resp = requests.post(f"${TB_HOST}/api/dashboard", json=dashboard, headers=headers)
resp.raise_for_status()
print(f"Dashboard ID: {resp.json()['id']['id']}")
```

### Updating an Existing Dashboard

Always GET first to obtain the current version, then modify and POST:

```python
dash = requests.get(f"${TB_HOST}/api/dashboard/{dashboard_id}", headers=headers).json()
dash["configuration"]["widgets"][new_widget_id] = { ... }
dash["configuration"]["states"]["main"]["layouts"]["main"]["widgets"][new_widget_id] = { ... }
resp = requests.post(f"${TB_HOST}/api/dashboard", json=dash, headers=headers)
# On 409 Conflict: re-GET and retry (version field enables optimistic locking)
```

## Common Mistakes

1. **UUID mismatch**: Widget UUID in `widgets` dict does not match UUID in `states.*.layouts.main.widgets`. Widget silently fails to render.
2. **Missing entity alias**: `datasources[].entityAliasId` references an alias UUID not present in `entityAliases`. Widget shows "Entity not found".
3. **Wrong data key type**: Using `"type": "attribute"` when the key is actually telemetry (or vice versa). Widget shows no data.
4. **Grid overflow**: Widget `col + sizeX > 24`. Widget wraps to next row unexpectedly.
5. **RPC widget without targetDevice**: RPC widgets need `targetDevice` configuration. Without it, the RPC has no destination device.
6. **Version not included on update**: Omitting the `version` field causes the POST to create a new dashboard instead of updating.
7. **Stale version**: Not re-fetching before update; 409 Conflict. Always GET, modify, POST.
8. **configMode mismatch**: Setting `"configMode": "basic"` but providing advanced-mode settings. The UI may not render settings correctly.

## See Also

- [widget-catalog.md](widget-catalog.md) -- Full FQN table of all built-in widgets with configuration details
- [widget-development.md](widget-development.md) -- Widget controller scripts, settings schemas, custom widget creation
- [entity-management.md](entity-management.md) -- All entity alias filter types, entity relations, and Entity Query API

Reference template: `/opt/thingsboard/.claude/templates/dashboard_skeleton.json`
