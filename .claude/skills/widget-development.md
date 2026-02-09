<!-- Last updated: 2026-02-09 -->
<!-- Sources: WidgetTypeController.java, WidgetsBundleController.java, BaseWidgetType.java, WidgetTypeDetails.java, WidgetsBundle.java, https://thingsboard.io/docs/user-guide/contribution/widgets-development/ -->

# Widget Development Guide

Comprehensive guide for creating, customizing, and managing custom widgets in ThingsBoard CE.

---

## 1. Widget Architecture Overview

ThingsBoard widgets are self-contained UI components rendered inside dashboard cells.
Each widget combines markup, styling, logic, and configuration into a single unit.

### Widget Types

| Type | Enum Value | Purpose |
|------|-----------|---------|
| Time Series | `timeseries` | Charts and graphs over time windows |
| Latest Values | `latest` | Current telemetry or attribute values |
| Control (RPC) | `control` | Send RPC commands to devices |
| Alarm | `alarm` | Display and manage alarms |
| Static | `static` | Custom HTML content, no data subscription |

### Widget Composition

A widget has four parts: **HTML Template** (markup), **CSS Styles** (scoped),
**JavaScript Controller** (lifecycle methods), and **Settings Schema** (generates settings UI).

### Widget Bundle

A **WidgetsBundle** is a named collection of related widget types (e.g., "Charts", "Cards").
Bundles exist at system level (all tenants) or tenant level (private).

### FQN (Fully Qualified Name)

Format: `bundleAlias.widgetTypeAlias` (e.g., `cards.value_card`)

System widgets use `system.` prefix in the FQN API:
`GET /api/widgetType?fqn=system.cards.value_card`

### Widget Lifecycle

```
init --> onDataUpdated --> onResize --> onDestroy
  |          ^
  |          | (each time new data arrives)
  +----------+
```

---

## 2. Widget Type Structure

### BaseWidgetType Fields (from `BaseWidgetType.java`)

| Field | Type | Description |
|-------|------|-------------|
| `id` | `WidgetTypeId` | UUID identifier |
| `tenantId` | `TenantId` | Owning tenant (system tenant for system widgets) |
| `fqn` | `String` | Fully qualified name (`bundleAlias.typeAlias`) |
| `name` | `String` | Human-readable display name |
| `deprecated` | `boolean` | Whether the widget is deprecated |
| `scada` | `boolean` | Whether this is a SCADA symbol widget |
| `version` | `Long` | Version number for optimistic locking |

**WidgetTypeDetails** extends WidgetType adding: `image`, `description`, `tags[]`, `externalId`, `resources[]`

### Full JSON Structure

```json
{
  "id": { "entityType": "WIDGET_TYPE", "id": "uuid-here" },
  "tenantId": { "entityType": "TENANT", "id": "uuid-here" },
  "fqn": "my_bundle.my_widget",
  "name": "My Widget",
  "deprecated": false,
  "scada": false,
  "image": "data:image/png;base64,...",
  "description": "A custom widget that displays sensor data",
  "tags": ["sensor", "display"],
  "descriptor": {
    "type": "latest",
    "sizeX": 6, "sizeY": 4,
    "controllerScript": "self.onInit = function() { ... };",
    "templateHtml": "<div class='my-widget'>{{value}}</div>",
    "templateCss": ".my-widget { color: #333; font-size: 16px; }",
    "settingsSchema": "{}",
    "dataKeySettingsSchema": "{}",
    "latestDataKeySettingsSchema": "{}",
    "defaultConfig": "{\"datasources\":[],\"timewindow\":{}}",
    "resources": []
  }
}
```

### Descriptor Fields

| Field | Description |
|-------|-------------|
| `type` | Widget type: `timeseries`, `latest`, `control`, `alarm`, `static` |
| `sizeX` / `sizeY` | Default grid size (columns x rows) |
| `controllerScript` | JavaScript code with lifecycle methods |
| `templateHtml` | HTML template rendered in the widget container |
| `templateCss` | CSS scoped to the widget |
| `settingsSchema` | JSON Schema for widget-level settings editor |
| `dataKeySettingsSchema` | JSON Schema for per-data-key settings |
| `defaultConfig` | Stringified JSON with default widget configuration |
| `resources` | External JS/CSS resources to load |

---

## 3. Widget Context API (self.ctx)

Inside the controller script, `self.ctx` provides access to the full widget context.

### Core Properties

```javascript
self.ctx.settings            // Object -- parsed settings from settingsSchema
self.ctx.datasources         // Array -- configured datasource descriptors
self.ctx.data                // Array of { dataKey, data: [[timestamp, value], ...] }
self.ctx.defaultSubscription // Subscription -- manages data polling/websocket
self.ctx.$scope              // Angular scope object (legacy widgets)
self.ctx.$container          // jQuery element wrapping the widget
self.ctx.width               // Number -- current widget width in pixels
self.ctx.height              // Number -- current widget height in pixels
self.ctx.dashboard           // Dashboard controller -- navigate states, access entities
self.ctx.stateController     // Navigate between dashboard states
self.ctx.custom              // Object -- store any custom data here (persists during lifecycle)
self.ctx.widgetConfig        // Full widget config object
self.ctx.timeWindow          // Current time window { minTime, maxTime }
self.ctx.dashboardTimewindow // Dashboard-level time window
```

### Service APIs

```javascript
// HTTP client for direct REST API calls
self.ctx.http.get(url, config)     // Returns Promise
self.ctx.http.post(url, data, config)
self.ctx.http.put(url, data, config)
self.ctx.http.delete(url, config)

// RPC control API (for control widgets)
self.ctx.controlApi.sendOneWayCommand(method, params, timeout)  // Promise (fire-and-forget)
self.ctx.controlApi.sendTwoWayCommand(method, params, timeout)  // Promise<response>

// Attribute service
self.ctx.attributeService.getEntityAttributes(entityId, attributeScope, keys)
self.ctx.attributeService.saveEntityAttributes(entityId, attributeScope, attributes)
// attributeScope: 'SERVER_SCOPE', 'CLIENT_SCOPE', 'SHARED_SCOPE'

// Entity services
self.ctx.entityService       // Entity CRUD operations
self.ctx.deviceService       // Device-specific operations
self.ctx.assetService        // Asset-specific operations
self.ctx.dashboardService    // Dashboard operations
self.ctx.alarmService        // Alarm query, acknowledge, clear

// UI utilities
self.ctx.dialogs.alert(title, message)
self.ctx.dialogs.confirm(title, message, ok, cancel)
```

### Utility Methods

```javascript
self.ctx.detectChanges();          // Trigger Angular change detection
self.ctx.updateWidgetParams();     // Update widget after param change
self.ctx.showLoadingIndicator();   // Show spinner
self.ctx.hideLoadingIndicator();   // Hide spinner
self.ctx.getEntityInfo(datasource); // Get entity info for a datasource
```

---

## 4. Widget Controller Script Pattern

### Standard Lifecycle Methods

```javascript
self.onInit = function() {
  let settings = self.ctx.settings;
  let $container = self.ctx.$container;
  let html = '<div class="my-widget">' +
             '  <span class="label">' + (settings.title || 'Value') + '</span>' +
             '  <span class="value">--</span>' +
             '</div>';
  $container.html(html);
  self.ctx.custom.valueElement = $container.find('.value');
};

self.onDataUpdated = function() {
  let data = self.ctx.data;
  if (data && data.length > 0 && data[0].data.length > 0) {
    let latestEntry = data[0].data[data[0].data.length - 1];
    let value = latestEntry[1]; // [0]=timestamp, [1]=value
    self.ctx.custom.valueElement.text(parseFloat(value).toFixed(1));
  }
  self.ctx.detectChanges();
};

self.onResize = function() {
  // Recalculate layout, redraw charts, etc.
};

self.onDestroy = function() {
  // Clean up: remove event listeners, clear intervals/timeouts
};

self.typeParameters = function() {
  return {
    maxDatasources: 1,      // Max datasources (-1 = unlimited)
    maxDataKeys: 10,         // Max data keys per datasource
    dataKeysOptional: false  // Whether data keys are required
  };
};

self.actionSources = function() {
  return {
    'rowClick': { name: 'Row click', multiple: false },
    'headerButton': { name: 'Header button', multiple: true }
  };
};
```

### Triggering Actions

```javascript
let descriptor = self.ctx.actionsApi.getActionDescriptors('rowClick');
if (descriptor.length) {
  self.ctx.actionsApi.handleWidgetAction(event, descriptor[0], entityId, entityName, additionalParams);
}
```

---

## 5. Settings Schema

Uses JSON Schema (draft-04) with react-schema-form extensions to auto-generate the settings UI.

### Example

```json
{
  "schema": {
    "type": "object",
    "title": "Settings",
    "properties": {
      "title": { "title": "Widget Title", "type": "string", "default": "My Widget" },
      "showLabel": { "title": "Show Label", "type": "boolean", "default": true },
      "fontSize": { "title": "Font Size (px)", "type": "number", "default": 14 },
      "color": { "title": "Text Color", "type": "string", "default": "#000000" },
      "displayMode": {
        "title": "Display Mode", "type": "string", "default": "simple",
        "enum": ["simple", "detailed", "compact"]
      }
    },
    "required": ["title"]
  },
  "form": [
    "title",
    "showLabel",
    { "key": "fontSize", "type": "number" },
    { "key": "color", "type": "color" },
    {
      "key": "displayMode", "type": "rc-select",
      "titleMap": [
        { "value": "simple", "name": "Simple" },
        { "value": "detailed", "name": "Detailed" },
        { "value": "compact", "name": "Compact" }
      ]
    }
  ]
}
```

### Common Field Types

| Schema Type | Form Type | Renders |
|-------------|-----------|---------|
| `"type": "string"` | (default) | Text input |
| `"type": "number"` | `"type": "number"` | Number input |
| `"type": "boolean"` | (default) | Checkbox / toggle |
| `"type": "string"` + `"enum"` | `"type": "rc-select"` | Dropdown select |
| `"type": "string"` | `"type": "color"` | Color picker |
| `"type": "string"` | `"type": "image"` | Image upload |
| `"type": "string"` | `"type": "textarea"` | Multi-line text |

### Conditional Visibility

```json
{ "key": "fontSize", "type": "number", "condition": "model.showLabel === true" }
```

The `condition` uses an Angular expression; `model` refers to the settings object.

### Data Key Settings Schema

The `dataKeySettingsSchema` defines per-data-key settings accessible via `dataKey.settings`
in the controller. Structure is identical to widget-level settings schema.

---

## 6. Widget REST API

All endpoints under `/api` require JWT: `Authorization: Bearer ${TB_TOKEN}`

### Widget Bundles

```
GET    ${TB_HOST}/api/widgetsBundles                              -- List all bundles
GET    ${TB_HOST}/api/widgetsBundles?pageSize=100&page=0          -- Paginated listing
GET    ${TB_HOST}/api/widgetsBundle/{widgetsBundleId}             -- Get bundle by ID
POST   ${TB_HOST}/api/widgetsBundle                               -- Create/update bundle
DELETE ${TB_HOST}/api/widgetsBundle/{widgetsBundleId}             -- Delete bundle
POST   ${TB_HOST}/api/widgetsBundle/{id}/widgetTypes              -- Set widget types (by ID list)
POST   ${TB_HOST}/api/widgetsBundle/{id}/widgetTypeFqns           -- Set widget types (by FQN list)
```

### Widget Types

```
GET    ${TB_HOST}/api/widgetTypes?pageSize=100&page=0             -- Paginated list (WidgetTypeInfo)
       Optional: textSearch, widgetTypeList, tenantOnly, deprecatedFilter (ALL|ACTUAL|DEPRECATED)
GET    ${TB_HOST}/api/widgetType/{widgetTypeId}                   -- Get full details + descriptor
       Optional: includeResources=true
POST   ${TB_HOST}/api/widgetType                                  -- Create/update widget type
       Optional: updateExistingByFqn=true (upsert by FQN)
DELETE ${TB_HOST}/api/widgetType/{widgetTypeId}                   -- Delete widget type
GET    ${TB_HOST}/api/widgetType?fqn=system.cards.value_card      -- Get by FQN
GET    ${TB_HOST}/api/widgetTypes?widgetsBundleId={bundleId}      -- List types in bundle
GET    ${TB_HOST}/api/widgetTypesDetails?widgetsBundleId={id}     -- List details in bundle
GET    ${TB_HOST}/api/widgetTypeFqns?widgetsBundleId={id}         -- List FQNs in bundle
```

### Import / Export

Export: `GET /api/widgetsBundle/{id}?inlineImages=true` then fetch each type with `includeResources=true`.
Import: `POST /api/widgetType` with `updateExistingByFqn=true`.

---

## 7. Data Key Configuration

Data keys define what data a widget subscribes to.

### Data Key Types

| Type | Description |
|------|-------------|
| `timeseries` | Device telemetry over a time window |
| `attribute` | Entity attribute (server, client, or shared scope) |
| `function` | Computed value using a JavaScript function body |
| `alarm` | Alarm fields (severity, status, type, etc.) |

### DataKey Structure

```json
{
  "name": "temperature",
  "type": "timeseries",
  "label": "Temperature",
  "color": "#2196f3",
  "settings": {},
  "funcBody": "",
  "postFuncBody": "",
  "units": "C",
  "decimals": 1,
  "_hash": 0.123456
}
```

### Function Data Keys

Compute values without a device subscription. `funcBody` receives `prevValue`, `time`, `data`:
```javascript
var amplitude = 25;
var period = 60000;
return amplitude * Math.sin(2 * Math.PI * time / period);
```

### Post-processing Function

`postFuncBody` transforms raw values after arrival. Receives `value`, `timestamp`, `data`:
```javascript
return value * 1.8 + 32; // Celsius to Fahrenheit
```

### Units and Decimals

- `units` -- String appended after the value (e.g., `"C"`, `"%"`, `"kWh"`)
- `decimals` -- Number of decimal places (e.g., `1` for `23.5`)

Configurable at widget level (defaults all keys) or per data key.

---

## 8. Widget Action Types

Actions define what happens when a user interacts with widget elements.

### Action Sources

| Source | Typical Use |
|--------|-------------|
| `headerButton` | Button in the widget header bar |
| `rowClick` | Click on a table row |
| `cellClick` | Click on a specific table cell |
| `tooltipClick` | Click inside a map tooltip |
| `markerClick` | Click on a map marker |
| `polygonClick` | Click on a map polygon |
| `callbackAction` | Programmatic trigger from controller |

### Action Types

| Action Type | Description | Key Parameters |
|-------------|-------------|----------------|
| `openDashboardState` | Navigate to a named dashboard state | `targetDashboardStateId` |
| `updateDashboardState` | Update state params without navigation | `stateParams` |
| `openDashboard` | Open a different dashboard | `dashboardId`, `dashboardStateId` |
| `custom` | Execute custom JavaScript function | `customFunction` body |
| `customPrettyAction` | Custom JS with full code editor | `customFunction` body |
| `mobileAction` | Trigger mobile-specific action | `mobileActionType` |
| `setEntityFromWidget` | Set entity context for nested states | (auto from row entity) |

### Custom Action Function

```javascript
// Parameters: widgetContext, entityId, entityName, additionalParams, entityLabel
let $injector = widgetContext.$scope.$injector;
widgetContext.dialogs.alert('Clicked', 'Entity: ' + entityName);
```

### Action Configuration in Dashboard JSON

```json
{
  "actionSources": {
    "rowClick": [{
      "name": "View Details",
      "icon": "visibility",
      "type": "openDashboardState",
      "targetDashboardStateId": "device_details",
      "setEntityId": true
    }]
  }
}
```

---

## 9. Development Workflow

### Using the Built-in Widget Editor

1. Navigate to **Widget Library** in the left menu
2. Open or create a **Widgets Bundle**
3. Click **+** and select **Create new widget type**
4. Select widget type (timeseries, latest, control, alarm, static)
5. Editor opens with tabs: Resources, HTML, CSS, JavaScript, Settings Schema, Preview

**Editor actions:** Run (preview), Save, Save As (clone), Undo (revert)

### Debugging

Use `console.log('data:', self.ctx.data)` and `debugger;` statements with browser DevTools (F12).

### Version Control Workflow

1. Export: `GET /api/widgetType/{id}?includeResources=true`
2. Store JSON in repository, edit controller/HTML/CSS/settings
3. Import: `POST /api/widgetType?updateExistingByFqn=true`

### Testing Tips

- Use **Function** datasource in preview to test without real devices
- Test with multiple data keys to verify `self.ctx.data` array handling
- Verify `onDestroy` cleanup by switching dashboard states

---

## 10. Custom Widget Examples

### Example 1: Simple Value Display (latest)

**HTML:**
```html
<div class="simple-value-widget">
  <div class="sv-label"></div>
  <div class="sv-value">--</div>
  <div class="sv-units"></div>
</div>
```

**CSS:**
```css
.simple-value-widget {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; height: 100%; font-family: Roboto, sans-serif;
}
.sv-label { font-size: 14px; color: #999; }
.sv-value { font-size: 32px; font-weight: 500; color: #333; }
.sv-units { font-size: 12px; color: #999; }
```

**JavaScript:**
```javascript
self.onInit = function() {
  var s = self.ctx.settings, $c = self.ctx.$container;
  $c.find('.sv-label').text(s.label || 'Value');
  $c.find('.sv-units').text(s.units || '');
  self.ctx.custom.$value = $c.find('.sv-value');
};
self.onDataUpdated = function() {
  var d = self.ctx.data;
  if (d.length && d[0].data.length) {
    var raw = d[0].data[d[0].data.length - 1][1];
    self.ctx.custom.$value.text(parseFloat(raw).toFixed(self.ctx.settings.decimals || 1));
  }
};
self.onResize = function() {};
self.onDestroy = function() {};
self.typeParameters = function() {
  return { maxDatasources: 1, maxDataKeys: 1, dataKeysOptional: false };
};
```

### Example 2: RPC Button Widget (control)

**HTML:**
```html
<div class="rpc-btn-widget">
  <button class="rpc-button">Send Command</button>
  <div class="rpc-status"></div>
</div>
```

**CSS:**
```css
.rpc-btn-widget {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; height: 100%;
}
.rpc-button {
  padding: 12px 24px; font-size: 16px; border: none; border-radius: 4px;
  background: #1976d2; color: #fff; cursor: pointer;
}
.rpc-button:hover { background: #1565c0; }
.rpc-button:disabled { background: #bbb; cursor: not-allowed; }
.rpc-status { margin-top: 8px; font-size: 13px; color: #666; }
```

**JavaScript:**
```javascript
self.onInit = function() {
  var s = self.ctx.settings, $c = self.ctx.$container;
  var $btn = $c.find('.rpc-button'), $st = $c.find('.rpc-status');
  $btn.text(s.buttonLabel || 'Send Command');
  $btn.on('click', function() {
    $btn.prop('disabled', true);
    $st.text('Sending...');
    self.ctx.controlApi.sendTwoWayCommand(s.rpcMethod || 'setValue', s.rpcParams || {}, s.rpcTimeout || 5000)
      .then(function(r) { $st.text('OK: ' + JSON.stringify(r)); })
      .catch(function(e) { $st.text('Error: ' + (e.message || e)); })
      .finally(function() { $btn.prop('disabled', false); });
  });
  self.ctx.custom.$button = $btn;
};
self.onDataUpdated = function() {};
self.onResize = function() {};
self.onDestroy = function() {
  if (self.ctx.custom.$button) self.ctx.custom.$button.off('click');
};
self.typeParameters = function() {
  return { maxDatasources: 1, maxDataKeys: 0, dataKeysOptional: true };
};
```

---

## CE vs PE Differences

| Feature | CE | PE |
|---------|----|----|
| Custom widgets | Yes | Yes |
| Widget bundles | System + Tenant | System + Tenant + Customer |
| White-labeling widget editor | No | Yes |
| Scheduler / Report widgets | No | PE only |

---

## See Also

- [widget-catalog.md](widget-catalog.md) -- FQN listing of all built-in widgets
- [rest-api-reference.md](rest-api-reference.md) -- REST API reference
- [dashboard-json-guide.md](dashboard-json-guide.md) -- Dashboard JSON structure
