# Widget Catalog and Configuration Reference

Complete widget FQN catalog and configuration guide for ThingsBoard CE v4.4.0-SNAPSHOT dashboards.

## Widget FQN Table

All built-in widgets use the `system.` prefix. Use the FQN with `GET ${TB_HOST}/api/widgetType?fqn=<FQN>` to fetch the full widget type definition.

### Cards

| Widget Name | FQN | Type | Notes |
|-------------|-----|------|-------|
| Value Card | `system.cards.value_card` | latest | Single metric display with icon, label, value |
| Entities Table | `system.cards.entities_table` | latest | Multi-device/key table with search and pagination |
| Timeseries Table | `system.cards.timeseries_table` | timeseries | Time-series data in table format |
| Alarms Table | `system.alarm_widgets.alarms_table` | alarm | Alarm list with acknowledge/clear actions |
| Entity Count | `system.cards.entity_count` | latest | Count of entities matching filter |
| Label Card | `system.cards.label_card` | latest | Simple text label |
| Markdown Card | `system.cards.markdown_card` | latest | Markdown-rendered content |
| Signal Strength | `system.cards.signal_strength` | latest | Signal bars indicator |
| Battery Level | `system.cards.battery_level` | latest | Battery percentage indicator |

### Charts

| Widget Name | FQN | Type | Notes |
|-------------|-----|------|-------|
| Time Series Chart | `system.time_series_chart` | timeseries | Line/bar/area chart (ECharts-based) |
| Bar Chart | `system.bar_chart` | timeseries | Vertical/horizontal bar chart |
| Pie Chart | `system.pie_chart` | latest | Pie/donut chart |
| Polar Area Chart | `system.polar_area_chart` | latest | Polar area chart |
| Radar Chart | `system.radar_chart` | latest | Radar/spider chart |
| State Chart | `system.state_chart` | timeseries | State timeline visualization |
| Doughnut | `system.doughnut` | latest | Doughnut chart variant |

### Gauges

| Widget Name | FQN | Type | Notes |
|-------------|-----|------|-------|
| Vertical Bar | `system.digital_gauges.vertical_bar_justgage` | latest | Vertical bar gauge |
| Simple Gauge | `system.digital_gauges.simple_gauge_justgage` | latest | Radial gauge |
| Arc Gauge | `system.digital_gauges.arc_justgage` | latest | Arc-style gauge |
| Simple Card | `system.digital_gauges.simple_card_justgage` | latest | Card with gauge styling |
| Level Card | `system.level_card` | latest | Level indicator card |

### Control Widgets

| Widget Name | FQN | Type | Notes |
|-------------|-----|------|-------|
| Slider | `system.slider` | rpc | Range slider control (0-100) |
| Command Button | `system.command_button` | rpc | On/Off or custom action button |
| Toggle Button | `system.toggle_button` | rpc | Toggle switch |
| Power Button | `system.power_button` | rpc | Power on/off button |
| Value Stepper | `system.value_stepper` | rpc | Increment/decrement control |
| LED Indicator | `system.led_indicator` | latest | LED on/off display |
| Status Widget | `system.status_widget` | latest | Active/inactive status |

### Navigation and Layout

| Widget Name | FQN | Type | Notes |
|-------------|-----|------|-------|
| State Nav Card | `system.navigation_cards.state_navigation_card` | static | Dashboard state navigation |
| Navigation Card Image | `system.navigation_cards.navigation_card_image` | static | Image-based navigation |

### HTML and Custom

| Widget Name | FQN | Type | Notes |
|-------------|-----|------|-------|
| HTML Card | `system.html_widgets.html_card` | static | Custom HTML/CSS content |
| HTML Value Card | `system.html_widgets.html_value_card` | latest | HTML with data binding |

### Maps

| Widget Name | FQN | Type | Notes |
|-------------|-----|------|-------|
| OpenStreetMap | `system.maps.openstreetmap` | latest | OSM map with device markers |
| Google Map | `system.maps.google_map` | latest | Google Maps with markers |
| Image Map | `system.maps.image_map` | latest | Custom image with data points |
| Trip Animation | `system.maps.trip_animation` | timeseries | Animated route playback |

### Input Widgets

| Widget Name | FQN | Type | Notes |
|-------------|-----|------|-------|
| Update Attribute | `system.input_widgets.update_attribute` | latest | Text field for attribute edit |
| Update Shared Attribute | `system.input_widgets.update_shared_attribute` | latest | Edit shared attributes |

---

## Widget Configuration Structure

### Common Widget Config

Every widget in `configuration.widgets[uuid]` has this structure:

```json
{
  "typeFullFqn": "system.cards.value_card",
  "type": "latest",
  "title": "Widget Title",
  "sizeX": 6,
  "sizeY": 4,
  "config": {
    "datasources": [ ... ],
    "settings": { ... },
    "title": "Widget Title",
    "showTitle": false,
    "backgroundColor": "rgba(0, 0, 0, 0)",
    "color": "rgba(0, 0, 0, 0.87)",
    "padding": "0px",
    "units": "",
    "decimals": 1,
    "actions": {},
    "configMode": "basic",
    "dropShadow": true,
    "enableFullscreen": false,
    "widgetStyle": {},
    "widgetCss": "",
    "noDataDisplayMessage": "",
    "pageSize": 1024,
    "borderRadius": "0px",
    "margin": "0px"
  },
  "row": 0,
  "col": 0,
  "id": "${WIDGET_UUID}"
}
```

### Datasource Types

#### Entity Datasource (for latest/timeseries widgets)

```json
{
  "type": "entity",
  "entityAliasId": "${ALIAS_UUID}",
  "filterId": null,
  "dataKeys": [
    {
      "name": "temperature",
      "type": "timeseries",
      "label": "Temperature",
      "color": "#2196f3",
      "settings": {},
      "units": null,
      "decimals": null,
      "funcBody": null,
      "usePostProcessing": null,
      "postFuncBody": null
    }
  ],
  "latestDataKeys": []
}
```

**Data key types:**
- `"type": "timeseries"` -- telemetry time-series data
- `"type": "attribute"` -- device attributes
- `"type": "entityField"` -- entity fields (name, type, label, createdTime)

#### Alarm Datasource (for alarm widgets)

```json
{
  "type": "entity",
  "entityAliasId": "${ALIAS_UUID}",
  "dataKeys": [ ... ],
  "alarmFilterConfig": {
    "statusList": ["ACTIVE_UNACK", "ACTIVE_ACK"],
    "severityList": ["CRITICAL", "WARNING"],
    "typeList": []
  }
}
```

#### Target Device (for RPC/control widgets)

RPC widgets use `targetDevice` instead of standard datasources:

```json
{
  "targetDevice": {
    "type": "device",
    "deviceId": "${DEVICE_ID}"
  }
}
```

Or using an entity alias:

```json
{
  "targetDevice": {
    "type": "entity",
    "entityAliasId": "${ALIAS_UUID}"
  }
}
```

---

## Widget Type Details

### Value Card (`system.cards.value_card`)

Single metric display with icon and label.

**Minimal config:**
```json
{
  "typeFullFqn": "system.cards.value_card",
  "type": "latest",
  "config": {
    "datasources": [{
      "type": "entity",
      "entityAliasId": "${ALIAS_UUID}",
      "dataKeys": [{"name": "temperature", "type": "timeseries", "label": "Temperature"}]
    }],
    "settings": {
      "labelPosition": "top",
      "layout": "square",
      "showLabel": true,
      "showIcon": true,
      "icon": "thermostat",
      "autoScale": true
    },
    "units": "\u00b0C",
    "decimals": 1
  }
}
```

### Entities Table (`system.cards.entities_table`)

Multi-device/key table with search.

**Minimal config:**
```json
{
  "typeFullFqn": "system.cards.entities_table",
  "type": "latest",
  "config": {
    "datasources": [{
      "type": "entity",
      "entityAliasId": "${ALIAS_UUID}",
      "dataKeys": [
        {"name": "temperature", "type": "timeseries", "label": "Temp"},
        {"name": "humidity", "type": "timeseries", "label": "Humidity"}
      ]
    }],
    "settings": {
      "enableSearch": true,
      "enableStickyHeader": true
    }
  }
}
```

### Time Series Chart (`system.time_series_chart`)

Line/bar/area chart powered by ECharts.

**Key settings:**
```json
{
  "settings": {
    "showLegend": true,
    "legendConfig": {"direction": "row", "position": "bottom", "showLatest": true},
    "dataZoom": true,
    "stack": false,
    "yAxes": {
      "default": {"show": true, "label": "", "min": null, "max": null}
    },
    "thresholds": [
      {"type": "constant", "value": 70, "color": "#ff0000", "lineWidth": 2}
    ]
  },
  "useDashboardTimewindow": true
}
```

**Data key line settings:**
```json
{
  "name": "temperature",
  "type": "timeseries",
  "settings": {
    "yAxisId": "default",
    "type": "line",
    "lineSettings": {
      "showLine": true,
      "smooth": true,
      "lineWidth": 2,
      "showPoints": false,
      "fillAreaSettings": {
        "type": "gradient",
        "opacity": 0.4,
        "gradient": {"start": 70, "end": 10}
      }
    }
  }
}
```

### Slider (`system.slider`)

Range control for RPC commands.

**Key settings:**
```json
{
  "typeFullFqn": "system.slider",
  "type": "rpc",
  "config": {
    "targetDevice": {"type": "device", "deviceId": "${DEVICE_ID}"},
    "settings": {
      "initialValue": 50,
      "minValue": 0,
      "maxValue": 100,
      "getValueMethod": "getValue",
      "setValueMethod": "setValue",
      "requestTimeout": 5000
    }
  }
}
```

### Command Button (`system.command_button`)

Action button for RPC commands or attribute writes.

**Key settings:**
```json
{
  "typeFullFqn": "system.command_button",
  "type": "rpc",
  "config": {
    "targetDevice": {"type": "device", "deviceId": "${DEVICE_ID}"},
    "settings": {
      "title": "Turn On",
      "icon": "power_settings_new",
      "onClickAction": {
        "type": "SET_ATTRIBUTE",
        "attributeScope": "SHARED_SCOPE",
        "setAttributeValueMap": {"dimLevel": 100}
      }
    }
  }
}
```

### Alarm Table (`system.alarm_widgets.alarms_table`)

Alarm list with acknowledge and clear actions.

**Minimal config:**
```json
{
  "typeFullFqn": "system.alarm_widgets.alarms_table",
  "type": "alarm",
  "config": {
    "datasources": [{
      "type": "entity",
      "entityAliasId": "${ALIAS_UUID}",
      "dataKeys": [],
      "alarmFilterConfig": {
        "statusList": ["ACTIVE_UNACK", "ACTIVE_ACK", "CLEARED_UNACK", "CLEARED_ACK"],
        "severityList": ["CRITICAL", "MAJOR", "MINOR", "WARNING"],
        "typeList": []
      }
    }],
    "settings": {
      "enableSearch": true,
      "displayDetails": true,
      "allowAcknowledgment": true,
      "allowClear": true
    }
  }
}
```

---

## Entity Aliases

Entity aliases map symbolic names to real devices/assets. Defined in `configuration.entityAliases`.

### Single Entity Alias

```json
{
  "${ALIAS_UUID}": {
    "id": "${ALIAS_UUID}",
    "alias": "My Device",
    "filter": {
      "type": "singleEntity",
      "resolveMultiple": false,
      "singleEntity": {
        "entityType": "DEVICE",
        "id": "${DEVICE_ID}"
      }
    }
  }
}
```

### Device Type Alias (All Devices of a Type)

```json
{
  "${ALIAS_UUID}": {
    "id": "${ALIAS_UUID}",
    "alias": "All Sensors",
    "filter": {
      "type": "entityType",
      "resolveMultiple": true,
      "entityType": "DEVICE",
      "entityNameFilter": ""
    }
  }
}
```

### Device Profile Alias

```json
{
  "${ALIAS_UUID}": {
    "id": "${ALIAS_UUID}",
    "alias": "DALI Controllers",
    "filter": {
      "type": "deviceType",
      "resolveMultiple": true,
      "deviceType": "Zenopix DALI Controller",
      "deviceNameFilter": ""
    }
  }
}
```

---

## Dashboard Layout Structure

### States and Layouts

```json
{
  "states": {
    "default": {
      "name": "default",
      "root": true,
      "layouts": {
        "main": {
          "widgets": {
            "${WIDGET_UUID}": {
              "sizeX": 6,
              "sizeY": 4,
              "row": 0,
              "col": 0
            }
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
}
```

**Grid system:**
- 24 columns total
- `sizeX`: width in columns (max 24)
- `sizeY`: height in rows (each row is ~50px)
- `row`: vertical position (0 = top)
- `col`: horizontal position (0 = left, max 23)

---

## Widget Creation Checklist

When adding a widget to a dashboard programmatically:

1. **Generate UUID** for the widget (any valid UUID, e.g., `str(uuid.uuid4())`)
2. **Create or reuse entity alias** -- the alias UUID must exist in `configuration.entityAliases`
3. **Add widget definition** to `configuration.widgets[uuid]` with:
   - `typeFullFqn` (from FQN table above)
   - `type` (latest, timeseries, alarm, rpc, static)
   - `config.datasources` with `entityAliasId` matching the alias
   - `id` field set to the same UUID
4. **Add layout entry** to `states.{state}.layouts.main.widgets[uuid]` with `row`, `col`, `sizeX`, `sizeY`
5. **Verify UUID consistency** -- the UUID must match in all three places:
   - Key in `configuration.widgets`
   - `id` field inside the widget definition
   - Key in `states.{state}.layouts.main.widgets`
6. **POST the full dashboard** to `${TB_HOST}/api/dashboard`

---

## RPC Widget Special Notes

### targetDevice vs datasources

- **Standard widgets** (value_card, chart, table) use `datasources` with `entityAliasId`
- **RPC widgets** (slider, command_button, toggle) use `targetDevice` with `deviceId`

### SET_ATTRIBUTE Workaround for Offline Devices

RPC widgets configured with `EXECUTE_RPC` action type return HTTP 408 when the device is offline. To avoid this, configure the widget to use `SET_ATTRIBUTE` instead:

```json
{
  "onClickAction": {
    "type": "SET_ATTRIBUTE",
    "attributeScope": "SHARED_SCOPE",
    "setAttributeValueMap": {
      "dimLevel": 100
    }
  }
}
```

This returns HTTP 200 immediately and the attribute change is delivered when the device reconnects (via MQTT `v1/devices/me/attributes` subscription).

### RPC Timeout Behavior

- `EXECUTE_RPC` with online device: 200 with response
- `EXECUTE_RPC` with offline device: 408 timeout (but rule chain still processes)
- `SET_ATTRIBUTE` with any device state: 200 immediately

---

## Dashboard Templates

- Skeleton template: `/opt/thingsboard/.claude/templates/dashboard_skeleton.json`
  - Contains value_card, time_series_chart, entities_table with annotated comments
  - Replace `${DEVICE_ID}` and `${DASHBOARD_TITLE}` before POSTing

## Timewindow Configuration

### Realtime (Last N minutes)

```json
{
  "timewindow": {
    "selectedTab": 0,
    "realtime": {
      "realtimeType": 1,
      "timewindowMs": 3600000,
      "interval": 60000
    }
  }
}
```

Common `timewindowMs` values:
- 900000 = 15 minutes
- 3600000 = 1 hour
- 86400000 = 24 hours
- 604800000 = 7 days

### History (Fixed Time Range)

```json
{
  "timewindow": {
    "selectedTab": 1,
    "history": {
      "historyType": 0,
      "timewindowMs": 86400000,
      "interval": 600000
    }
  }
}
```
