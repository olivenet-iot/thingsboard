# ThingsBoard MCP Server Integration

> Official Model Context Protocol server for natural language access to ThingsBoard.
> Repo: https://github.com/thingsboard/thingsboard-mcp | Version: 2.0.0

## Overview

The ThingsBoard MCP Server lets AI assistants (Claude Code, Claude Desktop, Cursor) interact
with a ThingsBoard instance via 118 tools — querying devices, telemetry, alarms, relations,
and performing CRUD operations without writing REST API calls manually.

**Editions supported:** CE, PE, Cloud, Edge
**Our setup:** CE v4.4.0-SNAPSHOT at `http://46.225.54.21:8080`

## Configuration (Current Setup)

**JAR location:** `.claude/tools/thingsboard-mcp-server-2.0.0.jar`
**Settings file:** `.claude/settings.json`

```json
{
  "mcpServers": {
    "thingsboard": {
      "command": "java",
      "args": ["-jar", ".claude/tools/thingsboard-mcp-server-2.0.0.jar"],
      "env": {
        "THINGSBOARD_URL": "http://46.225.54.21:8080",
        "THINGSBOARD_USERNAME": "support@lumosoft.io",
        "THINGSBOARD_PASSWORD": "tenant",
        "LOGGING_PATTERN_CONSOLE": ""
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `THINGSBOARD_URL` | Required | Base URL of ThingsBoard instance |
| `THINGSBOARD_USERNAME` | Required | Login username |
| `THINGSBOARD_PASSWORD` | Required | Login password |
| `THINGSBOARD_LOGIN_INTERVAL_SECONDS` | 1800 | Session refresh interval (seconds) |
| `LOGGING_PATTERN_CONSOLE` | — | Set to `""` to suppress Java log noise |
| `SPRING_AI_MCP_SERVER_STDIO` | true | false = SSE mode |
| `SPRING_WEB_APPLICATION_TYPE` | none | `servlet` for SSE mode |
| `SERVER_PORT` | 8000 | HTTP port for SSE mode |

## Tool Categories (118 tools)

### Device Operations (7 tools)
- List tenant devices (paginated)
- Get device by ID or name
- Get device credentials
- Get device relations
- List devices by customer
- List devices by entity group (PE only)

### Asset Operations (6 tools)
- List tenant assets
- Get asset by ID or name
- Get asset relations
- List assets by customer
- List assets by entity group (PE only)

### Customer Management (4 tools)
- List customers
- Get customer by ID or title
- Get customer relations

### User Management (6 tools)
- List users
- Get user by ID
- Get users by customer/tenant scope
- Manage user assignments

### Alarm Management (5 tools)
- List alarms (all or by entity)
- Filter by status, severity, type
- Get alarm details by ID

### Entity Groups (6 tools) — PE ONLY
- List entity groups by type
- Get group by ID, name, or owner
- Get entities in a group

### Relations (6 tools)
- Find relations FROM entity
- Find relations TO entity
- Get relation by type and direction
- Navigate entity graph

### Telemetry & Attributes (11 tools)
- Get attribute keys by scope (client, server, shared)
- Get attribute values
- Get time-series keys
- Fetch time-series data with aggregation (avg, sum, min, max, count)
- Insert/update attributes
- Insert time-series data (with optional TTL)

### Entity Data Query (v2.0)
- Complex queries across entity types
- Filter by fields, attributes, telemetry
- Join entities via relations
- Aggregate and group results

### Write Operations (v2.0)
- Create/update/delete devices
- Create/update/delete assets
- Create/update/delete customers
- Create/update/delete alarms
- Create/update/delete relations
- Create/update/delete users

### Admin (4 tools)
- Get system settings
- Get security settings
- Get JWT settings
- Get usage statistics

## Usage Examples (Natural Language)

After MCP is active, Claude can handle requests like:

```
"List all devices"
→ Calls device list tool, returns device names, IDs, types

"Get telemetry for device zenopix-test for the last 24 hours"
→ Fetches time-series data with timestamps

"Show all active alarms with CRITICAL severity"
→ Queries alarm API with severity filter

"Create a new device called 'temperature-sensor-01' with type 'Temperature Sensor'"
→ Creates device via write operation

"What relations does zenopix-test have?"
→ Navigates entity relations in both directions

"Get average temperature readings for the last week, aggregated hourly"
→ Fetches time-series with AVG aggregation, 1-hour interval

"Show system usage statistics"
→ Calls admin tool for usage info
```

## Deployment Modes

### STDIO Mode (Default — our setup)
- Direct stdin/stdout communication
- JAR launched by Claude Code as needed
- No persistent server process
- Best for: Claude Code, Claude Desktop

### SSE Mode (HTTP server)
- Persistent HTTP server on port 8000
- Server-Sent Events for streaming
- Best for: web integrations, multi-client scenarios

```bash
# Start SSE mode manually:
THINGSBOARD_URL=http://localhost:8080 \
THINGSBOARD_USERNAME=support@lumosoft.io \
THINGSBOARD_PASSWORD=tenant \
SPRING_AI_MCP_SERVER_STDIO=false \
SPRING_WEB_APPLICATION_TYPE=servlet \
java -jar .claude/tools/thingsboard-mcp-server-2.0.0.jar
```

## Troubleshooting

### MCP server not starting
1. Check Java 17+: `java -version`
2. Check JAR exists: `ls -la .claude/tools/thingsboard-mcp-server-2.0.0.jar`
3. Check ThingsBoard is running: `curl -s http://localhost:8080/api/noauth/config`
4. Test manually: `THINGSBOARD_URL=http://localhost:8080 THINGSBOARD_USERNAME=support@lumosoft.io THINGSBOARD_PASSWORD=tenant LOGGING_PATTERN_CONSOLE="" java -jar .claude/tools/thingsboard-mcp-server-2.0.0.jar`

### Authentication errors
- Verify credentials: `curl -s -X POST http://localhost:8080/api/auth/login -H 'Content-Type: application/json' -d '{"username":"support@lumosoft.io","password":"tenant"}'`
- Token refresh: increase `THINGSBOARD_LOGIN_INTERVAL_SECONDS` if sessions expire

### Tools not appearing in Claude Code
1. Restart Claude Code after configuring settings.json
2. Check `.claude/settings.json` is valid JSON
3. Ensure `enableAllProjectMcpServers` is not set to `false` globally

### Entity Groups tools returning errors
- Entity Groups are **PE-only** — expected to fail on CE

## Limitations

1. **Entity Groups** — 6 tools are PE-only, will error on CE
2. **Permissions** — write operations require matching user role permissions
3. **Session timeout** — default 30min refresh, increase for long sessions
4. **No rule chain management** — MCP doesn't expose rule chain CRUD (use REST API)
5. **No dashboard management** — MCP doesn't expose dashboard CRUD (use REST API)
6. **No OTA management** — available in newer versions only

## Cross-References

- REST API for operations MCP doesn't cover → `rest-api-reference.md`
- Telemetry data format details → `telemetry-attributes-guide.md`
- Device management context → `entity-management.md`
- Alarm rule configuration → `device-profile-guide.md`
- RPC commands (not in MCP) → `rpc-guide.md`
