# SignConnect AI Chatbot — Architecture & Development Spec

**Version:** 1.0 — Session 23
**Purpose:** Blueprint for signconnect-ai backend service + chat widget

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ ThingsBoard Dashboard (browser, fullscreen)              │
│  ┌─────────────────────────────┐                        │
│  │ chat-widget (custom widget) │                        │
│  │  - Chat UI (HTML/CSS/JS)    │                        │
│  │  - Entity context from TB   │                        │
│  │  - Session/history mgmt     │                        │
│  └──────────┬──────────────────┘                        │
└─────────────┼───────────────────────────────────────────┘
              │ HTTP POST /api/chat
              ▼
┌─────────────────────────────────────────────────────────┐
│ signconnect-ai (FastAPI :5001)                          │
│                                                         │
│  POST /api/chat                                         │
│  ├── Receives: message, entity_context, chat_history    │
│  ├── Builds system prompt with entity context           │
│  ├── Calls Claude API with tools                        │
│  │   ├── Claude decides which TB data to fetch          │
│  │   ├── Executes tool calls (TB REST API)              │
│  │   └── Returns natural language response              │
│  └── Returns: assistant message + metadata              │
│                                                         │
│  POST /api/chat/stream (Phase 2 — SSE streaming)        │
│  GET  /api/health                                       │
│                                                         │
│  Internal modules:                                      │
│  ├── tb_client.py  — ThingsBoard REST API wrapper       │
│  ├── tools.py      — Claude tool definitions            │
│  ├── prompts.py    — System prompt builder              │
│  └── config.py     — Environment config                 │
└─────────────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────┐    ┌──────────────────────┐
│ ThingsBoard REST API │    │ Claude API           │
│ http://localhost:8080│    │ api.anthropic.com    │
│ (same server)        │    │ claude-sonnet-4-5    │
└──────────────────────┘    └──────────────────────┘
```

### Directory Structure

```
/home/ubuntu/thingsboard/ai-tools/
├── main.py                 # FastAPI app entry point
├── config.py               # Environment variables, constants
├── tb_client.py            # ThingsBoard REST API client
├── tools.py                # Claude tool definitions + executors
├── prompts.py              # System prompt templates
├── chat.py                 # Chat endpoint logic, conversation handler
├── models.py               # Pydantic request/response models
├── requirements.txt        # Python dependencies
├── .env                    # API keys, TB credentials (gitignored)
├── .env.example            # Template
└── README.md

/home/ubuntu/thingsboard/branding/widgets/
└── chat-widget/            # TB custom widget
    ├── widget.html
    ├── widget.css
    └── widget.js
```

---

## 2. ThingsBoard REST API — Relevant Endpoints

### Authentication
```
POST /api/auth/login
Body: { "username": "support@lumosoft.io", "password": "..." }
Response: { "token": "eyJhb...", "refreshToken": "..." }

# Token goes in header: X-Authorization: Bearer {token}
# Token expires in ~15min, refresh with:
POST /api/auth/token
Body: { "refreshToken": "..." }
```

### Device & Asset Queries

```
# Get customer's assets (estates, regions, sites)
GET /api/customer/{customerId}/assets?pageSize=100&page=0&type={assetType}
→ Returns paginated asset list

# Get customer's devices
GET /api/customer/{customerId}/devices?pageSize=100&page=0
→ Returns paginated device list

# Get entity relations (hierarchy traversal)
GET /api/relations/info?fromId={entityId}&fromType={entityType}
→ Returns child relations (estate→region→site→device)

# Get specific asset/device by ID
GET /api/asset/{assetId}
GET /api/device/{deviceId}

# Get device credentials (for provisioning context)
GET /api/device/{deviceId}/credentials

# Get server attributes of entity
GET /api/plugins/telemetry/{entityType}/{entityId}/values/attributes/SERVER_SCOPE
→ Returns: dashboard_tier, co2_per_kwh, energy_rate, reference_power_watts, etc.

# Get shared attributes
GET /api/plugins/telemetry/{entityType}/{entityId}/values/attributes/SHARED_SCOPE
→ Returns: dim_value, schedule configs, etc.

# Get client attributes
GET /api/plugins/telemetry/{entityType}/{entityId}/values/attributes/CLIENT_SCOPE
```

### Telemetry Queries

```
# Latest telemetry values
GET /api/plugins/telemetry/DEVICE/{deviceId}/values/timeseries?keys=power_watts,energy_wh,co2_grams,cost_currency,energy_saving_wh,saving_pct,dim_value
→ Returns latest values with timestamps

# Historical telemetry (time range)
GET /api/plugins/telemetry/DEVICE/{deviceId}/values/timeseries?keys={keys}&startTs={ms}&endTs={ms}&interval={ms}&agg={agg}
→ agg: NONE, AVG, SUM, MIN, MAX, COUNT
→ interval: aggregation window in ms (e.g., 3600000 = 1 hour)

# Example: Last 24h energy, hourly aggregation
GET /api/plugins/telemetry/DEVICE/{deviceId}/values/timeseries?keys=energy_wh&startTs=1709251200000&endTs=1709337600000&interval=3600000&agg=SUM
```

### Alarm Queries

```
# Get alarms for specific entity
GET /api/alarm/{entityType}/{entityId}?searchStatus=ACTIVE&pageSize=100&page=0
→ Returns active alarms for entity

# Search all alarms (tenant-wide)
GET /api/alarms?searchStatus=ACTIVE&pageSize=100&page=0
→ Returns all active alarms

# Acknowledge alarm
POST /api/alarm/{alarmId}/ack

# Clear alarm
POST /api/alarm/{alarmId}/clear
```

### RPC (Device Commands)

```
# One-way RPC (fire and forget)
POST /api/rpc/oneway/{deviceId}
Body: { "method": "dim", "params": { "value": 50 } }

# Two-way RPC (with response)
POST /api/rpc/twoway/{deviceId}
Body: { "method": "dim", "params": { "value": 50 } }
→ Returns device response
```

### User & Customer Info

```
# Current user info
GET /api/auth/user
→ Returns user details including customerId

# Customer info
GET /api/customer/{customerId}
→ Returns customer name, etc.
```

---

## 3. SignConnect-Specific Telemetry Keys

### Standard (DALI2) Device Keys
| Key | Unit | Description |
|-----|------|-------------|
| power_watts | W | Instantaneous power (from external meter) |
| energy_wh | Wh | Calculated energy per interval |
| ext_active_power | W | External meter active power |
| ext_voltage | V | Mains voltage |
| ext_current | A | Current draw |
| ext_power_factor | — | Power factor (0-1) |
| ext_reactive_power | VAR | Reactive power |
| dim_value | % | Current dim level (0-100) |
| co2_grams | g | CO₂ emissions per interval |
| cost_currency | £/€ | Cost per interval |
| energy_saving_wh | Wh | Energy saved vs reference |
| saving_pct | % | Saving percentage |
| cost_saving | £/€ | Cost saved per interval |
| co2_saving_grams | g | CO₂ saved per interval |
| status_lamp_failure | bool | Lamp failure fault |
| status_control_gear_failure | bool | Control gear failure |
| status_fade_running | bool | Dim transition active |
| status_limit_error | bool | Dim limit error |
| status_power_on | bool | Power state |
| status_power_failure | bool | Power failure |
| status_arc_power_on | bool | DALI arc power |
| status_above_rated | bool | Above rated power |

### Plus (D4i) Device Keys
All Standard keys PLUS:
| Key | Unit | Description |
|-----|------|-------------|
| driver_voltage | V | LED supply voltage |
| driver_current | A | LED current |
| driver_power_factor | — | Internal PF |
| driver_temperature | °C | Driver temperature |
| driver_load_pct | % | Driver load percentage |
| led_voltage | V | LED voltage |
| led_current | mA | LED current |
| operating_time | h | Total operating hours |
| start_counter | — | Number of start cycles |
| status_led_module_failure | bool | LED module fault |
| status_driver_failure | bool | Driver fault |
| status_thermal_shutdown | bool | Thermal protection |
| status_thermal_derating | bool | Thermal derating active |
| status_overcurrent | bool | Overcurrent protection |
| status_external_supply_undervoltage | bool | Supply undervoltage |
| status_external_supply_overvoltage | bool | Supply overvoltage |

### Server Attributes (on device)
| Attribute | Description |
|-----------|-------------|
| dashboard_tier | "standard" or "plus" |
| co2_per_kwh | CO₂ factor (default: 0.233 kg/kWh UK grid) |
| energy_rate | Energy cost rate (default: 0.30 £/kWh) |
| reference_power_watts | Full-power reference (auto-captured at dim=100%) |

### Server Attributes (on site asset)
| Attribute | Description |
|-----------|-------------|
| dashboard_tier | "standard" or "plus" (propagates to devices) |
| latitude / longitude | GPS for fleet map |

---

## 4. Claude Tool Definitions

These are the tools Claude will have access to via function calling. Each tool maps to one or more TB API calls.

```python
TOOLS = [
    {
        "name": "get_hierarchy",
        "description": "Get the customer's asset hierarchy (estates, regions, sites) and their devices. Returns the full tree structure. Use this when user asks about their sites, locations, or overall structure.",
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {
                    "type": "string",
                    "description": "Customer UUID. Available from entity context."
                }
            },
            "required": ["customer_id"]
        }
    },
    {
        "name": "get_site_summary",
        "description": "Get summary of a specific site including device count, online/offline status, total energy, cost, CO₂, and power. Use when user asks about a site's status or overview.",
        "input_schema": {
            "type": "object",
            "properties": {
                "site_id": {
                    "type": "string",
                    "description": "Site asset UUID"
                },
                "time_range": {
                    "type": "string",
                    "enum": ["today", "yesterday", "this_week", "this_month", "last_7_days", "last_30_days"],
                    "description": "Time range for energy/cost aggregation. Default: today"
                }
            },
            "required": ["site_id"]
        }
    },
    {
        "name": "get_device_telemetry",
        "description": "Get current or historical telemetry for a specific device. Use when user asks about a device's power, energy, status, temperature, etc.",
        "input_schema": {
            "type": "object",
            "properties": {
                "device_id": {
                    "type": "string",
                    "description": "Device UUID"
                },
                "keys": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Telemetry keys to fetch. Common: power_watts, energy_wh, dim_value, saving_pct, driver_temperature"
                },
                "time_range": {
                    "type": "string",
                    "enum": ["latest", "today", "yesterday", "this_week", "this_month", "last_7_days", "last_30_days"],
                    "description": "Time range. 'latest' returns most recent values only."
                },
                "aggregation": {
                    "type": "string",
                    "enum": ["NONE", "AVG", "SUM", "MIN", "MAX"],
                    "description": "Aggregation type for historical data. Use SUM for energy_wh, AVG for power_watts."
                }
            },
            "required": ["device_id", "keys"]
        }
    },
    {
        "name": "get_energy_savings",
        "description": "Get energy savings data for a device or all devices at a site. Returns saving_pct, energy_saving_wh, cost_saving, co2_saving_grams. Use when user asks about energy savings, efficiency, or dimming impact.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "Device UUID or Site asset UUID"
                },
                "entity_type": {
                    "type": "string",
                    "enum": ["DEVICE", "ASSET"],
                    "description": "Whether entity_id is a device or site"
                },
                "time_range": {
                    "type": "string",
                    "enum": ["today", "yesterday", "this_week", "this_month", "last_7_days", "last_30_days"],
                    "description": "Time range for savings calculation"
                }
            },
            "required": ["entity_id", "entity_type"]
        }
    },
    {
        "name": "get_alarms",
        "description": "Get active alarms for a specific entity or all alarms. Returns alarm type, severity, device, timestamp. Use when user asks about faults, alerts, problems, or alarms.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "Optional. Device or Site UUID. Omit for all alarms."
                },
                "entity_type": {
                    "type": "string",
                    "enum": ["DEVICE", "ASSET"],
                    "description": "Type of entity_id"
                },
                "status": {
                    "type": "string",
                    "enum": ["ACTIVE", "CLEARED", "ANY"],
                    "description": "Alarm status filter. Default: ACTIVE"
                }
            },
            "required": []
        }
    },
    {
        "name": "get_device_attributes",
        "description": "Get server/shared attributes for a device. Includes dashboard_tier, reference_power_watts, co2_per_kwh, energy_rate, dim_value (shared). Use for configuration or device info queries.",
        "input_schema": {
            "type": "object",
            "properties": {
                "device_id": {
                    "type": "string",
                    "description": "Device UUID"
                },
                "scope": {
                    "type": "string",
                    "enum": ["SERVER_SCOPE", "SHARED_SCOPE", "CLIENT_SCOPE"],
                    "description": "Attribute scope. Default: SERVER_SCOPE"
                }
            },
            "required": ["device_id"]
        }
    },
    {
        "name": "send_dim_command",
        "description": "Send a dim command to a lighting controller. Sets the DALI dim level (0-100%). IMPORTANT: Always confirm with the user before sending commands. Use when user explicitly asks to change brightness or dim level.",
        "input_schema": {
            "type": "object",
            "properties": {
                "device_id": {
                    "type": "string",
                    "description": "Device UUID"
                },
                "dim_value": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 100,
                    "description": "Dim level percentage (0=off, 100=full brightness)"
                }
            },
            "required": ["device_id", "dim_value"]
        }
    },
    {
        "name": "compare_sites",
        "description": "Compare energy, cost, and savings metrics across multiple sites. Use when user asks to compare locations or find best/worst performing sites.",
        "input_schema": {
            "type": "object",
            "properties": {
                "site_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of site asset UUIDs to compare"
                },
                "time_range": {
                    "type": "string",
                    "enum": ["today", "yesterday", "this_week", "this_month", "last_7_days", "last_30_days"],
                    "description": "Time range for comparison"
                }
            },
            "required": ["site_ids"]
        }
    }
]
```

---

## 5. System Prompt Design

```
You are SignConnect Assistant, an AI helper for the SignConnect smart lighting management platform. You help users monitor their lighting infrastructure, understand energy usage and savings, check for faults, and control their DALI/D4i lighting controllers.

## Your Knowledge

SignConnect is a LoRaWAN-based smart lighting system with two product tiers:
- **SignConnect Standard**: DALI2 controllers with external energy meters. Measures mains power, voltage, current, power factor.
- **SignConnect Plus**: D4i controllers with internal diagnostics. Additionally monitors driver temperature, LED voltage/current, driver load, and supports predictive maintenance.

The system uses a hierarchy: Customer → Estate → Region → Site → Device (lighting controller).

## Key Metrics You Can Report On
- **Power**: Real-time power consumption (watts)
- **Energy**: Cumulative energy usage (kWh) over any time period
- **Energy Savings**: Percentage saved by dimming vs full brightness reference. Uses DALI-2 logarithmic dimming curve — 50% dim ≈ 83-92% power savings (not 50%).
- **Cost**: Estimated electricity cost based on configured energy rate
- **CO₂ Emissions**: Calculated from energy × grid carbon factor
- **Faults**: Lamp failure, gear failure, power anomaly, offline alerts
- **Device Health** (Plus only): Temperature, driver load, power factor trends

## Important Technical Notes
- DALI-2 uses logarithmic dimming (IEC 62386): 50% dim command results in ~10-15% of rated current, meaning 83-92% energy savings. This is normal, not a measurement error.
- Energy savings are calculated against a reference_power_watts baseline captured when dimming is at 100%.
- Standard devices measure mains input power (including driver losses). Plus devices measure internal LED-side power.
- A ~6-7W difference between Standard and Plus readings for the same fixture is normal (driver efficiency ~90%).

## Your Capabilities
- Query real-time and historical device data
- Check active alarms and fault status
- Calculate and explain energy savings
- Compare sites and devices
- Send dim commands (with user confirmation)
- Explain lighting and energy concepts

## Guidelines
- Be concise but informative. Use specific numbers from the data.
- When presenting energy savings, always mention the time period.
- Format large numbers readably: 1,234.5 kWh, not 1234567 Wh.
- Convert units for readability: Wh → kWh, grams → kg where appropriate.
- If you don't have data for something, say so clearly rather than guessing.
- When the user asks to dim or control lights, ALWAYS confirm before executing.
- Reference the current entity context — if user is viewing a site, scope answers to that site.

## Current Context
{entity_context}  ← injected dynamically per request
```

---

## 6. Entity Context (Widget → Backend)

The chat widget sends entity context with each message so Claude knows what the user is looking at.

```json
{
    "message": "How much energy did we save today?",
    "chat_history": [
        {"role": "user", "content": "Show me the status"},
        {"role": "assistant", "content": "Here's your site overview..."}
    ],
    "context": {
        "user_id": "...",
        "customer_id": "...",
        "customer_name": "McDonald's",
        "dashboard": "fleet|standard|plus",
        "dashboard_state": "HOME|ESTATE|REGION|SITE|default|energy|health|schedule",
        "entity_id": "...",
        "entity_type": "ASSET|DEVICE",
        "entity_name": "McDonald's Amsterdam",
        "entity_subtype": "site|region|estate|Zenopix-D4i|Zenopix-DALI2",
        "dashboard_tier": "standard|plus"
    }
}
```

---

## 7. Response Format

Backend returns:

```json
{
    "response": "Based on today's data, your Amsterdam site has saved 12.4 kWh...",
    "metadata": {
        "tools_used": ["get_energy_savings", "get_site_summary"],
        "entity_references": [
            {"name": "zenopix-test", "id": "...", "type": "DEVICE"}
        ],
        "suggestions": [
            "Compare with other sites",
            "Show me the savings trend",
            "What's the power factor?"
        ]
    }
}
```

- `response`: Markdown-formatted text for display
- `metadata.suggestions`: Quick reply buttons for the chat widget
- `metadata.entity_references`: For potential linking to devices/sites in UI

---

## 8. Chat Widget Design

### Layout (inside TB dashboard sidebar or overlay)

```
┌──────────────────────────────┐
│ 🤖 SignConnect Assistant  ✕  │  ← Header + close button
├──────────────────────────────┤
│                              │
│  👤 How much energy did we   │  ← User message (right-aligned)
│     save today?              │
│                              │
│  🤖 Based on today's data   │  ← Assistant message (left-aligned)
│     for McDonald's Amsterdam │
│     your site saved 12.4 kWh │
│     ...                      │
│                              │
│  ┌──────┐ ┌──────┐ ┌──────┐ │  ← Suggestion chips
│  │Compare│ │Trend │ │Alarms│ │
│  └──────┘ └──────┘ └──────┘ │
│                              │
├──────────────────────────────┤
│ Type a message...     [Send] │  ← Input + send button
└──────────────────────────────┘
```

### Widget Integration Points

```javascript
// Entity context from TB widget API
const entityContext = {
    user_id: self.ctx.currentUser?.userId,
    customer_id: self.ctx.currentUser?.customerId,
    dashboard: self.ctx.dashboard?.id,
    dashboard_state: self.ctx.stateController?.getStateId(),
    entity_id: self.ctx.defaultSubscription?.targetEntityId,
    entity_type: self.ctx.defaultSubscription?.targetEntityType,
    entity_name: self.ctx.defaultSubscription?.targetEntityName,
};

// HTTP call to backend
self.ctx.http.post('http://46.225.54.21:5001/api/chat', {
    message: userMessage,
    chat_history: chatHistory,
    context: entityContext
}).subscribe(response => {
    // Display response.response as markdown
    // Show response.metadata.suggestions as chips
});
```

---

## 9. Security Considerations

### Phase 1 (Demo/Development)
- Backend authenticates to TB as tenant admin (support@lumosoft.io)
- Widget sends customer context but backend verifies
- No public internet exposure needed (same server)

### Phase 2 (Production)
- Backend should authenticate per-customer (JWT passthrough from widget)
- Rate limiting on /api/chat
- Command confirmation required (dim, acknowledge alarm)
- Audit log for all AI-initiated actions
- Customer isolation — queries scoped to customer's entities only

---

## 10. Example Conversations

### Energy Savings Query
```
User: How much energy have we saved this week?
→ Tool: get_energy_savings(entity_id=current_site, entity_type=ASSET, time_range=this_week)
→ Response: "This week, McDonald's Amsterdam saved 87.3 kWh (saving rate: 84.2%).
   That's equivalent to £26.19 in electricity costs and 20.3 kg of CO₂ avoided.
   The site is currently dimmed to 50%, which with DALI-2's logarithmic curve
   achieves much higher savings than you might expect."
```

### Alarm Check
```
User: Any problems?
→ Tool: get_alarms(entity_id=current_site, entity_type=ASSET, status=ACTIVE)
→ Response: "Good news — no active alarms at McDonald's Amsterdam.
   All devices are online and operating normally."
```

### Device Control
```
User: Set the lights to 75%
→ Response: "I'll set all devices at McDonald's Amsterdam to 75% brightness.
   This affects 1 controller (zenopix-test). Shall I proceed?"
User: Yes
→ Tool: send_dim_command(device_id=zenopix-test-id, dim_value=75)
→ Response: "Done! Dim command sent to zenopix-test. The new level should
   take effect within a few seconds. At 75% dim, you can expect around
   75% energy savings thanks to the logarithmic dimming curve."
```

### Comparison
```
User: Which site uses the most energy?
→ Tool: get_hierarchy(customer_id=...) → get site list
→ Tool: compare_sites(site_ids=[...], time_range=this_month)
→ Response: "This month's energy usage by site:
   1. McDonald's Amsterdam: 234.5 kWh (£70.35)
   2. McDonald's London: 189.2 kWh (£56.76)
   Amsterdam uses 24% more energy, but it also has D4i controllers
   reporting internal power which is typically lower than mains input."
```

### Technical Explanation
```
User: Why are the savings so high at 50% dim?
→ Response: "Great question! DALI-2 uses a logarithmic dimming curve (IEC 62386),
   not linear. When you set 50% dim, the actual output current drops to only
   10-15% of rated current. This means:
   - 50% dim command → ~85% energy savings
   - 75% dim command → ~75% energy savings
   This is by design — it gives finer control at lower brightness levels
   where the human eye is more sensitive to changes."
```

---

## 11. Development Phases

### Phase 1 — MVP (This Session)
- [ ] FastAPI service skeleton with config
- [ ] TB REST API client (auth, telemetry, alarms, hierarchy)
- [ ] Claude tool definitions + execution
- [ ] /api/chat endpoint (non-streaming)
- [ ] Basic chat widget (HTML/CSS/JS)
- [ ] Entity context passing from widget
- [ ] 5 core tools: hierarchy, site_summary, device_telemetry, energy_savings, alarms

### Phase 2 — Enhanced
- [ ] Dim command tool (with confirmation flow)
- [ ] Suggestion chips in widget
- [ ] Markdown rendering in widget
- [ ] Chat history persistence (localStorage or TB attributes)
- [ ] Streaming responses (SSE)

### Phase 3 — Production
- [ ] Per-customer authentication
- [ ] Rate limiting
- [ ] Audit logging
- [ ] Multi-language support (EN/TR)
- [ ] Predictive maintenance insights (D4i health analysis)

---

## 12. Dependencies

```
# requirements.txt
fastapi>=0.109.0
uvicorn>=0.27.0
httpx>=0.27.0          # Async HTTP client for TB API
anthropic>=0.42.0      # Claude API SDK
python-dotenv>=1.0.0
pydantic>=2.0.0
```

---

## 13. Environment Configuration

```bash
# .env
TB_URL=http://localhost:8080
TB_USERNAME=support@lumosoft.io
TB_PASSWORD=tenant
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-sonnet-4-5-20250929
AI_MAX_TOKENS=2048
CORS_ORIGINS=http://localhost:8080,http://46.225.54.21:8080
```

---

## 14. Claude Code Development Prompt

Below is the comprehensive prompt to give to Claude Code for building this service.

---

### PROMPT START

```
You are building the SignConnect AI Chatbot backend service. This is a FastAPI application that serves as the AI brain for a smart lighting management platform built on ThingsBoard.

## Project Location
- Backend: /home/ubuntu/thingsboard/ai-tools/
- Widget: /home/ubuntu/thingsboard/branding/widgets/chat-widget/

## What To Build

### 1. FastAPI Backend (signconnect-ai)

Create the following files:

**config.py** — Load .env, define constants (TB_URL, API keys, model name, time range helpers)

**tb_client.py** — Async ThingsBoard REST API client class:
- Token management (login, refresh, auto-refresh on 401)
- get_customer_assets(customer_id, asset_type) → list
- get_entity_relations(entity_id, entity_type) → list of children
- get_latest_telemetry(entity_type, entity_id, keys) → dict
- get_historical_telemetry(entity_type, entity_id, keys, start_ts, end_ts, agg, interval) → dict
- get_attributes(entity_type, entity_id, scope) → dict
- get_alarms(entity_type, entity_id, status, page_size) → list
- send_rpc(device_id, method, params) → response
- Proper error handling, logging

**tools.py** — Define Claude tools and their execution functions:
- TOOL_DEFINITIONS: list of tool schemas (see Section 4 of the spec)
- execute_tool(tool_name, tool_input, tb_client) → result dict
- Each tool maps to one or more tb_client calls
- Time range resolution (today, this_week, etc. → startTs/endTs in milliseconds)
- Unit conversion helpers (Wh→kWh, grams→kg)

**prompts.py** — System prompt builder:
- build_system_prompt(context) → string
- Base prompt with SignConnect domain knowledge (see Section 5 of the spec)
- Entity context injection (current site, device, dashboard state)

**models.py** — Pydantic models:
- ChatRequest(message, chat_history, context)
- ChatResponse(response, metadata)
- EntityContext(user_id, customer_id, dashboard, entity_id, etc.)

**chat.py** — Chat handler:
- process_chat(request: ChatRequest, tb_client, anthropic_client) → ChatResponse
- Build messages array with system prompt + history + new message
- Call Claude API with tools
- Handle tool_use responses: execute tool, send result back to Claude
- Support multi-step tool use (Claude may need multiple tools)
- Extract suggestions from response
- Error handling for both Claude API and TB API failures

**main.py** — FastAPI app:
- CORS middleware (allow TB origin)
- Lifespan: initialize tb_client, anthropic client
- POST /api/chat → chat handler
- GET /api/health → status check
- Error handlers

### 2. Chat Widget (ThingsBoard custom widget)

Create a single-file widget structure (HTML + CSS + JS in widget.js following TB widget conventions):

**Requirements:**
- Chat message list with user/assistant message styling
- Text input with send button (Enter key support)
- Loading indicator (typing dots animation)
- Entity context extraction from TB widget API
- Chat history management (in-memory, max 20 messages for context)
- Suggestion chips from response metadata
- Basic markdown rendering (bold, code blocks, lists)
- Responsive layout (sidebar-friendly, ~350px wide)
- Dark theme compatible (TB dark mode)
- Scrolls to bottom on new message
- Error state handling

**Widget context access:**
- self.ctx.currentUser — user info
- self.ctx.stateController.getStateId() — current dashboard state
- self.ctx.http.post() — HTTP calls
- Entity context from dashboard state params or subscription

## Technical Notes

- ThingsBoard CE is at http://localhost:8080 (same server)
- Use httpx for async HTTP in the backend
- Use the Anthropic Python SDK for Claude API calls
- Claude model: claude-sonnet-4-5-20250929
- Tool execution should be iterative (Claude may call multiple tools in sequence)
- All timestamps in ThingsBoard API are Unix milliseconds
- Backend runs on port 5001
- Widget communicates via standard HTTP POST (not WebSocket for Phase 1)

## Environment
- Ubuntu 24 server
- Python 3.12+
- The .env file will be created manually with credentials

## File Creation Order
1. requirements.txt
2. .env.example
3. config.py
4. models.py
5. tb_client.py
6. tools.py
7. prompts.py
8. chat.py
9. main.py
10. README.md
11. Widget files

Create all files with full implementation, not stubs. Include proper error handling, logging, and docstrings.
```

### PROMPT END
