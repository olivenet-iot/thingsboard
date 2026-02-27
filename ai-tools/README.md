# SignConnect AI Chatbot Backend

FastAPI service that bridges a ThingsBoard chat widget with Claude API for natural-language queries about smart lighting infrastructure.

## Setup

1. **Install dependencies:**

```bash
cd /home/ubuntu/thingsboard/ai-tools
pip install -r requirements.txt
```

2. **Configure environment:**

```bash
cp .env.example .env
# Edit .env with your credentials
```

Required variables:
- `TB_URL` — ThingsBoard API URL (default: `http://localhost:8080`)
- `TB_USERNAME` / `TB_PASSWORD` — ThingsBoard tenant admin credentials
- `ANTHROPIC_API_KEY` — Claude API key
- `AI_MODEL` — Claude model to use (default: `claude-sonnet-4-5-20250929`)

3. **Run the service:**

```bash
python main.py
```

The service starts on port 5001 (configurable via `SERVICE_PORT`).

## API Endpoints

### `POST /api/chat`

Send a chat message with optional entity context.

```json
{
  "message": "How much energy did we save today?",
  "chat_history": [
    {"role": "user", "content": "Show me the status"},
    {"role": "assistant", "content": "Here's your site overview..."}
  ],
  "context": {
    "customer_id": "...",
    "customer_name": "McDonald's",
    "entity_id": "...",
    "entity_type": "ASSET",
    "entity_name": "McDonald's Amsterdam",
    "entity_subtype": "site"
  }
}
```

Response:

```json
{
  "response": "Based on today's data, your Amsterdam site has saved 12.4 kWh...",
  "metadata": {
    "tools_used": ["get_energy_savings"],
    "entity_references": [{"name": "Amsterdam", "id": "...", "type": "ASSET"}],
    "suggestions": ["Compare with other sites", "Show savings trend"]
  }
}
```

### `GET /api/health`

Returns service status and ThingsBoard connectivity.

## Architecture

The service uses Claude's tool-use capability to query ThingsBoard data on demand:

1. User message arrives with dashboard context
2. System prompt with SignConnect domain knowledge is built
3. Claude decides which tools to call (hierarchy, telemetry, alarms, etc.)
4. Tools execute against the ThingsBoard REST API
5. Claude generates a natural-language response from the data

## Available Tools

| Tool | Description |
|------|-------------|
| `get_hierarchy` | Customer asset tree (estates → regions → sites → devices) |
| `get_site_summary` | Site overview with device count, energy, cost, CO₂ |
| `get_device_telemetry` | Latest or historical telemetry for a device |
| `get_energy_savings` | Savings metrics for a device or site |
| `get_alarms` | Active/cleared alarms for entity or tenant-wide |
| `get_device_attributes` | Server/shared/client scope attributes |
| `send_dim_command` | RPC dim command to a lighting controller |
| `compare_sites` | Compare metrics across multiple sites |
