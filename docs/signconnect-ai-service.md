# SignConnect AI Chatbot Service — Technical Documentation

## 1. Overview

The SignConnect AI Chatbot is a FastAPI microservice that provides a conversational AI assistant for the SignConnect smart lighting platform. It connects customers to their lighting infrastructure through natural language — users can query device status, energy consumption, savings metrics, active alarms, and even control dim levels, all via a chat widget embedded in the SignConnect dashboard.

The service acts as an orchestration layer between the user and ThingsBoard: it receives chat messages, applies guardrails (topic filtering, prompt injection protection, rate limiting), authenticates the user's customer scope, fetches the customer's asset hierarchy, and then delegates to the Claude API with a curated set of tools. Claude autonomously decides which ThingsBoard API calls to make (via tool use), and the service executes them in a loop until a final text response is produced.

| Detail | Value |
|---|---|
| **Port** | `5001` |
| **Key dependencies** | FastAPI, Anthropic Python SDK, httpx, slowapi, Pydantic, python-dotenv |
| **File location on server** | `/home/ubuntu/thingsboard/ai-tools/` |
| **Systemd service name** | `signconnect-ai` |
| **Service unit file** | `/etc/systemd/system/signconnect-ai.service` |
| **Environment file** | `/etc/signconnect-ai/env` |

---

## 2. Architecture

### 2.1 Directory Tree

```
ai-tools/
├── main.py              # FastAPI app, lifespan, routes, rate limiter, exception handler
├── chat.py              # Chat orchestration: pipeline stages, Claude tool-use loop
├── config.py            # Environment variables, defaults, time-range resolver
├── tools.py             # Claude tool definitions + execution logic (8 tools)
├── prompts.py           # System prompt builder (identity, rules, context injection)
├── guardrails.py        # Topic filter, prompt injection detection, input sanitization
├── cache.py             # In-memory TTL caches (hierarchy, entity lookups)
├── models.py            # Pydantic request/response models
├── tb_client.py         # Async ThingsBoard REST API client (httpx + JWT auth)
├── requirements.txt     # Python dependencies
├── .env.example         # Template environment file
├── deploy.sh            # Deployment script (git pull, pip install, systemctl)
└── deploy/
    └── signconnect-ai.service  # systemd unit file
```

### 2.2 Request Pipeline

Every incoming `POST /api/chat` request passes through an 8-stage pipeline defined in `chat.py:process_chat()`:

```
User Message
     │
     ▼
┌─────────────────────────────┐
│ 1. TOPIC GUARD              │  is_on_topic() — regex keyword match
│    Off-topic? → reject      │  No Claude API call needed
└─────────────┬───────────────┘
              │ on-topic
              ▼
┌─────────────────────────────┐
│ 2. INPUT SANITIZATION       │  sanitize_input() — injection patterns,
│    Injection? → reject      │  length check, zero-width char stripping
│    Too long?  → reject      │
└─────────────┬───────────────┘
              │ safe
              ▼
┌─────────────────────────────┐
│ 3. PER-CUSTOMER RATE LIMIT  │  In-memory sliding window
│    Over limit? → reject     │  (20 req / 60s per customer)
└─────────────┬───────────────┘
              │ within limit
              ▼
┌─────────────────────────────┐
│ 4. CUSTOMER VALIDATION      │  GET /api/customer/{id}
│    Invalid? → reject        │  Ensures customer_id exists in TB
└─────────────┬───────────────┘
              │ valid
              ▼
┌─────────────────────────────┐
│ 5. HIERARCHY CACHE          │  Fetch or reuse cached hierarchy
│    Cache hit → use cached   │  (5-min TTL)
│    Cache miss → call        │  get_hierarchy tool internally
│    get_hierarchy + cache    │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ 6. BUILD SYSTEM PROMPT      │  Base prompt + entity context
│    + CONVERSATION MESSAGES   │  + hierarchy JSON injection
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ 7. CLAUDE API TOOL LOOP     │  Up to 10 iterations
│    Claude returns tool_use  │  Execute tool → feed result back
│    → execute → feed back    │  Until stop_reason != "tool_use"
│    Ownership check on       │  or max iterations reached
│    send_dim_command          │
└─────────────┬───────────────┘
              │ stop_reason = "end_turn"
              ▼
┌─────────────────────────────┐
│ 8. EXTRACT RESPONSE         │  Final text + suggestions
│    + METADATA                │  + tools_used + entity_references
└─────────────────────────────┘
```

### 2.3 Tool-Use Loop Details

The tool-use loop (`chat.py`, lines 163–228) works as follows:

1. Send messages + tool definitions to Claude API (`anthropic_client.messages.create`).
2. If `response.stop_reason == "tool_use"`, iterate over content blocks.
3. For each `tool_use` block:
   - **Ownership check**: If the tool is `send_dim_command` and a `customer_id` is present, verify the target `device_id` exists in the customer's cached hierarchy entity IDs. Reject if not found.
   - Execute the tool via `execute_tool()` dispatch.
   - Collect entity references from tool inputs/results.
   - Append tool result back as a `user` message with `tool_result` content.
4. Append the assistant's response (including `tool_use` blocks) as an `assistant` message.
5. Loop back to step 1 (up to `MAX_TOOL_ITERATIONS = 10`).
6. When `stop_reason != "tool_use"`, extract text blocks as the final response.

---

## 3. API Endpoints

### 3.1 `POST /api/chat`

**Purpose:** Process a chat message through the AI pipeline and return the assistant's response.

**Rate Limiting:** 10 requests per minute per IP address (via slowapi).

**Authentication:** The `customer_id` is extracted from the `context` object in the request body. The chat widget on the dashboard populates this from the logged-in user's JWT claims. The service validates the customer exists by calling `GET /api/customer/{customer_id}` on ThingsBoard.

**Request Body:**

```json
{
  "message": "What's the energy consumption at the Amsterdam site today?",
  "chat_history": [
    {
      "role": "user",
      "content": "Hello"
    },
    {
      "role": "assistant",
      "content": "Hi! How can I help you with your lighting system?"
    }
  ],
  "context": {
    "user_id": "a1b2c3d4-...",
    "customer_id": "e5f6g7h8-...",
    "customer_name": "Acme Corp",
    "dashboard": "site_dashboard",
    "dashboard_state": "default",
    "entity_id": "i9j0k1l2-...",
    "entity_type": "ASSET",
    "entity_name": "Amsterdam Site",
    "entity_subtype": "site",
    "dashboard_tier": "standard"
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `message` | string | Yes | The user's chat message (max 2,000 characters) |
| `chat_history` | array of `{role, content}` | No | Previous conversation turns for context |
| `context` | object | No | Dashboard/entity context from the widget |
| `context.customer_id` | string | No | Customer UUID — used for scoping and rate limiting |
| `context.entity_id` | string | No | Currently selected entity UUID |
| `context.entity_type` | string | No | `"DEVICE"` or `"ASSET"` |

**Response (200 OK):**

```json
{
  "response": "The Amsterdam site has consumed 245.3 kWh today across 12 devices. Total cost is €18.40 with 89.2 kg CO₂ emissions.",
  "metadata": {
    "tools_used": ["get_hierarchy", "get_site_summary"],
    "entity_references": [
      {
        "name": "Amsterdam Site",
        "id": "i9j0k1l2-...",
        "type": "ASSET"
      }
    ],
    "suggestions": [
      "Compare with other sites",
      "Show me the energy savings",
      "Any active alarms?"
    ]
  }
}
```

| Field | Type | Description |
|---|---|---|
| `response` | string | The assistant's natural-language response |
| `metadata.tools_used` | array of strings | De-duplicated list of tools invoked |
| `metadata.entity_references` | array of objects | Entities mentioned (name, id, type) |
| `metadata.suggestions` | array of strings | Follow-up suggestions for the chat widget |

**Error Responses:**

| Status | Cause | Response body `response` field |
|---|---|---|
| 429 | IP rate limit exceeded | slowapi default response |
| 200 | Off-topic message | `"I can only help with SignConnect lighting and energy queries..."` |
| 200 | Prompt injection detected | `"I'm not able to process that request..."` |
| 200 | Message too long | `"Please keep your message shorter (under 2,000 characters)."` |
| 200 | Customer rate limit exceeded | `"Too many requests. Please wait a moment..."` |
| 200 | Invalid customer_id | `"Unable to verify your account. Please refresh and try again."` |
| 500 | Unhandled exception | `"An internal error occurred. Please try again."` |

### 3.2 `GET /api/health`

**Purpose:** Health check endpoint. Reports service status and ThingsBoard connectivity.

**Rate Limiting:** None.

**Authentication:** None.

**Response (200 OK):**

```json
{
  "status": "ok",
  "thingsboard": "connected",
  "model": "claude-sonnet-4-5-20250929"
}
```

| Field | Type | Values |
|---|---|---|
| `status` | string | `"ok"` (TB connected) or `"degraded"` (TB disconnected) |
| `thingsboard` | string | `"connected"` or `"disconnected"` |
| `model` | string | The configured Claude model name |

---

## 4. AI Tools

All tools are defined in `tools.py`. They are sent to Claude as tool definitions, and Claude decides when and how to call them based on the user's query.

### 4.1 `get_hierarchy`

| | |
|---|---|
| **Description (to Claude)** | Get the customer's asset hierarchy (estates, regions, sites) and their devices. Returns the full tree structure. Call this FIRST if you need to resolve a site or device name to an ID. |
| **Internal API calls** | `GET /api/customer/{id}`, `GET /api/customer/{id}/assets` (paginated), `GET /api/relations` (recursive), `GET /api/device/{id}` and `GET /api/asset/{id}` (for each entity) |
| **Input** | `customer_id` (string, required) — Customer UUID |
| **Return format** | Nested hierarchy: `{customer, customer_id, estates: [{id, name, regions: [{id, name, sites: [{id, name, devices: [{id, name, type}]}]}]}]}` |
| **Special behaviour** | Handles three hierarchy shapes: estate→region→site→device, region→site→device (no estates), or site→device (flat). Caches individual device/asset lookups via entity cache (60s TTL). |

### 4.2 `get_site_summary`

| | |
|---|---|
| **Description (to Claude)** | Get summary of a specific site including device count, online/offline status, total energy, cost, CO₂, and power. |
| **Internal API calls** | `GET /api/asset/{id}`, `GET /api/relations`, `GET /api/device/{id}` (per device), `GET /api/plugins/telemetry/DEVICE/{id}/values/timeseries` (historical SUM for energy_wh/co2_grams/cost_currency, latest for power_watts/dim_value), `GET /api/plugins/telemetry/DEVICE/{id}/values/attributes/SERVER_SCOPE` (active status) |
| **Input** | `site_id` (string, required), `time_range` (string, optional — default: `"today"`, enum: today/yesterday/this_week/this_month/last_7_days/last_30_days) |
| **Return format** | `{site_name, site_id, time_range, device_count, online_count, offline_count, total_energy_kwh, total_co2_kg, total_cost, total_power_watts, devices: [{id, name, power_watts, dim_value, energy_kwh, online}]}` |
| **Special behaviour** | Aggregates across all child devices. Converts Wh→kWh and grams→kg. |

### 4.3 `get_device_telemetry`

| | |
|---|---|
| **Description (to Claude)** | Get current or historical telemetry for a specific device. |
| **Internal API calls** | `GET /api/device/{id}`, `GET /api/plugins/telemetry/DEVICE/{id}/values/timeseries` |
| **Input** | `device_id` (string, required), `keys` (array of strings, required — e.g. `["power_watts", "energy_wh", "dim_value"]`), `time_range` (string, optional — default: `"latest"`, includes `"latest"` plus standard named ranges), `aggregation` (string, optional — NONE/AVG/SUM/MIN/MAX, default: `"SUM"`) |
| **Return format** | `{device_name, device_id, time_range, values: {key: value}}` — for `"latest"`, values are single floats; for historical, single-bucket results are flattened to scalars, multi-bucket results are returned as arrays of `{ts, value}`. |
| **Special behaviour** | When `time_range == "latest"`, uses the latest telemetry endpoint (no aggregation). Otherwise uses historical telemetry with the specified aggregation. |

### 4.4 `get_energy_savings`

| | |
|---|---|
| **Description (to Claude)** | Get energy savings data for a device or all devices at a site. Returns saving_pct, energy_saving_wh, cost_saving, co2_saving_grams. |
| **Internal API calls** | `GET /api/device/{id}` or `GET /api/asset/{id}`, `GET /api/relations` (for sites), `GET /api/plugins/telemetry/DEVICE/{id}/values/timeseries` (SUM for savings, AVG for saving_pct) |
| **Input** | `entity_id` (string, required), `entity_type` (string, required — `"DEVICE"` or `"ASSET"`), `time_range` (string, optional — default: `"today"`) |
| **Return format** | For DEVICE: `{entity_name, entity_type, time_range, energy_saving_kwh, cost_saving, co2_saving_kg, average_saving_pct}`. For ASSET (site): same plus `devices: [{device_name, device_id, energy_saving_kwh, average_saving_pct}]` and totals prefixed with `total_`. |
| **Special behaviour** | For sites, aggregates savings across all child devices. Uses SUM for cumulative values and AVG for saving percentage. Overall site average_saving_pct is the mean of per-device averages. |

### 4.5 `get_alarms`

| | |
|---|---|
| **Description (to Claude)** | Get active alarms for a specific entity or all alarms. |
| **Internal API calls** | `GET /api/alarm/{entityType}/{entityId}` (entity-scoped) or `GET /api/alarms` (tenant-wide), paginated |
| **Input** | `entity_id` (string, optional), `entity_type` (string, optional — DEVICE/ASSET), `status` (string, optional — ACTIVE/CLEARED/ANY, default: `"ACTIVE"`) |
| **Return format** | `{alarm_count, status_filter, alarms: [{type, severity, status, originator_name, originator_type, created_time, details}]}` |
| **Special behaviour** | When both `entity_id` and `entity_type` are omitted, fetches all alarms tenant-wide. Results are sorted by `createdTime` descending. |

### 4.6 `get_device_attributes`

| | |
|---|---|
| **Description (to Claude)** | Get server/shared attributes for a device. Includes dashboard_tier, reference_power_watts, co2_per_kwh, energy_rate, dim_value (shared). |
| **Internal API calls** | `GET /api/device/{id}`, `GET /api/plugins/telemetry/DEVICE/{id}/values/attributes/{scope}` |
| **Input** | `device_id` (string, required), `scope` (string, optional — SERVER_SCOPE/SHARED_SCOPE/CLIENT_SCOPE, default: `"SERVER_SCOPE"`) |
| **Return format** | `{device_name, device_id, scope, attributes: {key: value, ...}}` |
| **Special behaviour** | None. Straightforward attribute fetch with entity caching. |

### 4.7 `send_dim_command`

| | |
|---|---|
| **Description (to Claude)** | Set the dim level on a lighting controller via shared attributes. Accepts a device UUID or site asset UUID — if a site ID is given, the command is sent to ALL devices at that site. |
| **Internal API calls** | `GET /api/device/{id}` or `GET /api/asset/{id}` + `GET /api/relations` (to resolve device list), `POST /api/plugins/telemetry/DEVICE/{id}/attributes/SHARED_SCOPE` (to set `dimLevel` attribute) |
| **Input** | `device_id` (string, required — device UUID or site asset UUID), `dim_value` (integer, required — 0–100), `confirmed` (boolean, optional — default: `false`) |
| **Return format** | When `confirmed=false`: `{requires_confirmation: true, message, devices: [{id, name}], dim_value}`. When `confirmed=true`: `{devices_commanded, dim_value, results: [{device_name, device_id, dim_value, status: "sent"}], message}` |
| **Special behaviour** | **Two-step confirmation flow.** First call (`confirmed=false`) returns the resolved device list and a confirmation prompt — Claude presents this to the user. Second call (`confirmed=true`) executes the command. Server-side range validation (0–100). **Audit logging**: every confirmed dim command is logged at WARNING level with customer ID, device ID, and value. **Customer isolation**: before execution, the chat handler checks that the target device_id exists in the customer's cached hierarchy — if not, the tool result is `{"error": "Device not found in your account."}`. The actual command works by writing the `dimLevel` shared attribute; the MQTT bridge detects the change and sends a LoRaWAN downlink. |

### 4.8 `compare_sites`

| | |
|---|---|
| **Description (to Claude)** | Compare energy, cost, and savings metrics across multiple sites. |
| **Internal API calls** | Calls `_get_site_summary()` in parallel for each site (using `asyncio.gather`) |
| **Input** | `site_ids` (array of strings, required), `time_range` (string, optional — default: `"today"`) |
| **Return format** | `{time_range, site_count, sites: [<site_summary>, ...]}` — each site entry is a full site summary object (same as `get_site_summary` output). Failed sites include `{site_id, error}`. |
| **Special behaviour** | Uses `asyncio.gather(*tasks, return_exceptions=True)` for parallel fetching. Individual site failures don't block others. |

---

## 5. Guardrails & Security

### 5.1 Topic Restriction — `is_on_topic()`

Defined in `guardrails.py`. Uses six compiled regex patterns to match against the user's message. If **none** match, the message is rejected without calling Claude.

**Allowed topic categories and sample keywords:**

| Category | Keywords (partial list) |
|---|---|
| Lighting | light, lamp, dim, brightness, led, dali, d4i, fixture, luminaire, controller, driver, lux |
| Energy | energy, power, watts, kwh, consumption, saving, cost, carbon, co2, emission, tariff |
| Status/Devices | device, site, online, offline, fault, alarm, alert, status, health, temperature |
| SignConnect/LoRaWAN | signconnect, lorawan, lora, gateway, mqtt, downlink, uplink, sensor |
| Greetings/Meta | hello, hi, help, what can you, how do, thank, who are you, can you |
| Operations | compare, summary, overview, report, trend, history, schedule, dashboard, chart |

**Rejection response:** `"I can only help with SignConnect lighting and energy queries. Please ask about your devices, energy consumption, or lighting control."`

**Rejection suggestions:** `["Show site overview", "Any active alarms?", "Energy savings today?"]`

### 5.2 Prompt Injection Protection — `sanitize_input()`

Defined in `guardrails.py`. A two-stage check:

1. **Length check**: Messages exceeding `MAX_MESSAGE_LENGTH` (2,000 characters) are rejected with `"Please keep your message shorter (under 2,000 characters)."`.

2. **Character sanitization**: Zero-width and control characters are stripped (except `\n`, `\t`, `\r`). Runs of 10+ spaces/tabs are collapsed to a single space. Sequences of 4+ newlines are collapsed to 3.

3. **Injection pattern matching**: The cleaned message is checked against 11 regex patterns:

| Pattern | Example match |
|---|---|
| `ignore (all )?(previous\|prior\|above)` | "ignore all previous instructions" |
| `forget (your\|all\|previous)` | "forget your rules" |
| `override (your\|the\|system)` | "override your instructions" |
| `pretend (you\|to be)` | "pretend you are GPT" |
| `jailbreak` | "jailbreak" |
| `you are now` | "you are now a pirate" |
| `new instructions` | "new instructions:" |
| `disregard (your\|the\|previous\|all)` | "disregard your system prompt" |
| `system\s*prompt` | "show me your system prompt" |
| `<(system\|admin\|root)` | `<system>` tag injection |
| `\]\s*\[?(INST\|SYS)` | `][INST]` style injection |

**Rejection response:** `"I'm not able to process that request. Please ask about your lighting or energy data."`

### 5.3 Rate Limiting

Two layers:

| Layer | Scope | Limit | Mechanism |
|---|---|---|---|
| **Per-IP** | IP address | 10 requests / minute | slowapi (based on starlette). Returns HTTP 429. |
| **Per-customer** | `customer_id` from context | 20 requests / 60 seconds | In-memory sliding window (`_customer_request_log` dict in `chat.py`). Returns HTTP 200 with rejection message. |

### 5.4 Customer Scoping / Isolation

- The `customer_id` from the request context is validated by calling `GET /api/customer/{id}` on ThingsBoard. If the call returns an HTTP error, the request is rejected.
- Before executing `send_dim_command`, the target `device_id` is checked against `get_hierarchy_entity_ids(customer_id)` — a set of all device and asset IDs from the customer's cached hierarchy. If the device is not in the set, the tool returns an error.
- The hierarchy cache ensures that a customer can only see and act on entities that belong to them.

---

## 6. Prompt Engineering

### 6.1 System Prompt Structure

The system prompt is built by `build_system_prompt()` in `prompts.py`. It has three parts:

1. **Base prompt** (`BASE_SYSTEM_PROMPT`) — static, ~100 lines covering identity, language, tone, scope, knowledge, and rules.
2. **Current Context block** — dynamically appended when `EntityContext` is provided (customer name/ID, entity name/type/ID, dashboard, tier).
3. **Pre-loaded Hierarchy block** — dynamically appended when hierarchy data is available; includes the full JSON so Claude doesn't need to call `get_hierarchy` again.

### 6.2 Identity & Branding

- The assistant identifies as **"SignConnect Assistant"** built by **Lumosoft**.
- **Forbidden mentions**: Claude, Anthropic, AI model, or any other model name.
- If asked who it is: `"I'm the SignConnect Assistant, here to help you manage your smart lighting."`

### 6.3 Language Auto-Detection

- Detect the user's language from their message.
- **Turkish**: If the user writes in Turkish, respond entirely in Turkish.
- **English**: If the user writes in English, respond in English.
- **Other**: Try to respond in that language; default to English if unsure.
- Never mix languages in a single response.

### 6.4 Tone & Personality

- Conversational but professional.
- Action-oriented: "Let me check that for you" (not "I don't know").
- Results-oriented: "I found..." (not "According to the data...").
- Number formatting: `1,234.5 kWh`. Auto-convert Wh→kWh, grams→kg.
- Never show raw JSON. Never show error codes or stack traces.
- Be concise: 2–4 sentences for simple queries; longer only for comparisons/technical explanations.

### 6.5 Critical Behavioural Rules

1. **Act first** — if context has entity_id/customer_id, use them immediately; never ask the user for UUIDs.
2. **Resolve names automatically** — user says "Amsterdam" → call get_hierarchy → find matching site → use that ID.
3. **Default time range is "today"** — only ask if genuinely ambiguous.
4. **No option menus** — never present numbered lists of choices; pick the most likely intent.
5. **Use get_hierarchy first** if you need to resolve any entity name to an ID.
6. **Confirm dim commands** — call `send_dim_command` with `confirmed=false` first, present device names, wait for explicit user confirmation.

### 6.6 Hierarchy Context Injection

When hierarchy data is cached (or freshly fetched), it is serialized as JSON and appended to the system prompt under a `## Pre-loaded Customer Hierarchy` heading with the instruction: *"Use these IDs directly — do NOT call get_hierarchy again unless the user asks about a different customer."*

---

## 7. Caching

All caches are in-memory (Python dicts in `cache.py`). There is no external cache store.

| Cache | Key | Value | TTL | Purpose |
|---|---|---|---|---|
| **Hierarchy** | `customer_id` | Full hierarchy dict (customer → estates → regions → sites → devices) | **300 seconds (5 min)** | Avoids re-fetching the entire asset tree on every request |
| **Entity** | `entity_id` | Device or asset dict from TB API | **60 seconds (1 min)** | Avoids redundant `GET /api/device/{id}` and `GET /api/asset/{id}` calls during hierarchy walks and tool execution |

### Cache Invalidation

- **TTL-based only**: Entries are checked on read; if `time.time() - stored_timestamp >= TTL`, the entry is treated as a cache miss.
- **No active invalidation**: If a device is renamed or moved in ThingsBoard, the cache will serve stale data until the TTL expires.
- **No size limits**: The dicts grow unbounded. In practice this is fine because the number of customers/entities is small.

### Hierarchy Membership Helper

`get_hierarchy_entity_ids(customer_id)` recursively extracts all `id` fields from the cached hierarchy into a `set[str]`. This is used for the customer isolation check on `send_dim_command` — ensuring a customer can only control devices in their own hierarchy.

---

## 8. Configuration

### 8.1 Environment Variables

All configuration is loaded in `config.py` via `python-dotenv` from a `.env` file in the same directory, or from the systemd `EnvironmentFile` in production.

| Variable | Default | Description |
|---|---|---|
| `TB_URL` | `http://localhost:8080` | ThingsBoard REST API base URL |
| `TB_USERNAME` | `support@lumosoft.io` | ThingsBoard login username (tenant admin) |
| `TB_PASSWORD` | `tenant` | ThingsBoard login password |
| `ANTHROPIC_API_KEY` | `""` (empty) | Anthropic API key (`sk-ant-...`) |
| `AI_MODEL` | `claude-sonnet-4-5-20250929` | Claude model ID |
| `AI_MAX_TOKENS` | `2048` | Maximum tokens in Claude's response |
| `CORS_ORIGINS` | `http://localhost:8080` | Comma-separated allowed CORS origins |
| `SERVICE_PORT` | `5001` | Port the FastAPI server listens on |

### 8.2 Hard-Coded Constants

| Constant | Value | Location | Description |
|---|---|---|---|
| `MAX_TOOL_ITERATIONS` | `10` | `config.py` | Maximum Claude tool-use loop iterations |
| `MAX_MESSAGE_LENGTH` | `2000` | `config.py`, `guardrails.py` | Maximum user message length in characters |
| `RATE_LIMIT_PER_IP` | `"10/minute"` | `config.py` | slowapi rate limit string |
| `RATE_LIMIT_PER_CUSTOMER` | `20` | `config.py` | Max requests per customer per window |
| `RATE_LIMIT_CUSTOMER_WINDOW` | `60` | `config.py` | Customer rate limit window in seconds |
| `HIERARCHY_TTL` | `300` | `cache.py` | Hierarchy cache TTL in seconds |
| `ENTITY_TTL` | `60` | `cache.py` | Entity (device/asset) cache TTL in seconds |

### 8.3 `.env` Template

```bash
# Production: copy to /etc/signconnect-ai/env
#   sudo mkdir -p /etc/signconnect-ai
#   sudo cp .env /etc/signconnect-ai/env
#   sudo chown ubuntu:ubuntu /etc/signconnect-ai/env && sudo chmod 600 /etc/signconnect-ai/env

# ThingsBoard connection
TB_URL=http://localhost:8080
TB_USERNAME=support@lumosoft.io
TB_PASSWORD=tenant

# Anthropic Claude API
ANTHROPIC_API_KEY=sk-ant-...

# AI model configuration
AI_MODEL=claude-sonnet-4-5-20250929
AI_MAX_TOKENS=2048

# CORS origins (comma-separated)
CORS_ORIGINS=http://localhost:8080,http://46.225.54.21:8080

# Service port
SERVICE_PORT=5001
```

---

## 9. Deployment

### 9.1 Prerequisites

- Python 3.10+
- pip
- systemd
- Access to ThingsBoard REST API (port 8080)
- A valid Anthropic API key

### 9.2 Step-by-Step Deployment

1. **Create the environment file:**

```bash
sudo mkdir -p /etc/signconnect-ai
sudo cp /home/ubuntu/thingsboard/ai-tools/.env.example /etc/signconnect-ai/env
sudo chown ubuntu:ubuntu /etc/signconnect-ai/env
sudo chmod 600 /etc/signconnect-ai/env
```

2. **Edit the environment file** with your actual credentials:

```bash
sudo nano /etc/signconnect-ai/env
# Set ANTHROPIC_API_KEY, TB_PASSWORD, CORS_ORIGINS, etc.
```

3. **Run the deploy script:**

```bash
cd /home/ubuntu/thingsboard/ai-tools
chmod +x deploy.sh
./deploy.sh
```

### 9.3 What `deploy.sh` Does

1. `git pull --ff-only` — pull latest code
2. `pip install -q -r requirements.txt` — install/update Python dependencies
3. Check that `/etc/signconnect-ai/env` exists (exit with instructions if not)
4. Copy `deploy/signconnect-ai.service` to `/etc/systemd/system/`
5. `systemctl daemon-reload` + `enable` + `restart` the service
6. Wait 2 seconds, then show service status

### 9.4 systemd Unit File

```ini
[Unit]
Description=SignConnect AI Chatbot Service
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu/thingsboard/ai-tools
EnvironmentFile=/etc/signconnect-ai/env
ExecStart=/usr/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 5001 --workers 2 --log-level info
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=signconnect-ai

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/home/ubuntu/thingsboard/ai-tools/__pycache__
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

**Key details:**
- Runs as user `ubuntu`, not root
- 2 uvicorn workers
- Automatic restart on failure (5-second delay)
- Security hardening: `NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`
- Only `__pycache__` is writable (for compiled bytecode)
- Logs to journald (`journalctl -u signconnect-ai`)

### 9.5 Python Dependencies

```
fastapi>=0.109.0
uvicorn>=0.27.0
httpx>=0.27.0
anthropic>=0.42.0
python-dotenv>=1.0.0
pydantic>=2.0.0
slowapi>=0.1.9
```

### 9.6 Verifying the Service

```bash
# Check service status
systemctl status signconnect-ai

# View live logs
journalctl -u signconnect-ai -f

# Health check
curl http://localhost:5001/api/health

# Test chat (from the server itself)
curl -X POST http://localhost:5001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, what can you do?"}'
```

---

## 10. Troubleshooting

| Problem | Cause | Solution |
|---|---|---|
| Service fails to start | Missing `/etc/signconnect-ai/env` | Create the file: `sudo mkdir -p /etc/signconnect-ai && sudo cp ai-tools/.env.example /etc/signconnect-ai/env` and fill in credentials |
| `"I'm having trouble connecting right now"` response | Claude API error — invalid or missing `ANTHROPIC_API_KEY` | Check the API key in `/etc/signconnect-ai/env`. Verify with `curl -H "x-api-key: $KEY" https://api.anthropic.com/v1/messages` |
| `"Unable to verify your account"` response | `customer_id` in context doesn't exist in ThingsBoard, or TB is unreachable | Verify TB is running (`curl http://localhost:8080/api/noauth/healthcheck`). Check the customer UUID is valid. |
| Health endpoint returns `"degraded"` | ThingsBoard API is unreachable or JWT expired | Check TB is running. Check `TB_URL`, `TB_USERNAME`, `TB_PASSWORD` in env file. The client auto-reauthenticates on 401 but can't recover from a down server. |
| All messages rejected as off-topic | User's message doesn't contain any recognised keyword | This is by design. Messages must contain at least one keyword from the topic lists (lighting, energy, devices, etc.). Greetings like "hello" and "help" are allowed. |
| `"Too many requests"` response | Per-customer rate limit (20/60s) exceeded | Wait 60 seconds. The sliding window will clear. For legitimate high-volume use, increase `RATE_LIMIT_PER_CUSTOMER` in `config.py`. |
| HTTP 429 error | Per-IP rate limit (10/min) exceeded via slowapi | Wait 60 seconds. For load testing, increase `RATE_LIMIT_PER_IP` in `config.py`. |
| Dim command returns `"Device not found in your account"` | The target device_id is not in the customer's cached hierarchy | Verify the device belongs to the customer. The hierarchy cache may be stale (5-min TTL) — wait for it to expire or restart the service to clear cache. |
| Stale data in responses | Entity or hierarchy cache serving outdated values | Entity cache TTL is 60s, hierarchy is 300s. Restarting the service (`sudo systemctl restart signconnect-ai`) clears all caches immediately. |
| Tool loop appears stuck / slow responses | Claude making many sequential tool calls (up to 10 iterations) | This is normal for complex queries. The `MAX_TOOL_ITERATIONS = 10` limit prevents infinite loops. If consistently slow, check ThingsBoard API response times. |
| CORS errors in browser console | Frontend origin not in `CORS_ORIGINS` | Add the frontend URL to `CORS_ORIGINS` in `/etc/signconnect-ai/env` (comma-separated). Restart the service. |
| `"An internal error occurred"` response | Unhandled exception caught by the global handler | Check logs: `journalctl -u signconnect-ai --since "5 min ago"`. The full traceback is logged at ERROR level. |
| Service keeps restarting | Python crash on startup (import error, config issue) | Check `journalctl -u signconnect-ai -n 50` for the stack trace. Common causes: missing Python packages (`pip install -r requirements.txt`), syntax errors, missing env vars. |
