# ThingsBoard IoT Development Scripts

Utility scripts for ThingsBoard IoT development, testing, and infrastructure setup.

## Prerequisites

- Python 3.8+
- `requests` library (`pip3 install requests`)
- `paho-mqtt` library (`pip3 install paho-mqtt`) — for MQTT tests only

## Credential Loading

All scripts read credentials from environment variables. Before running:

```bash
source /opt/thingsboard/.claude/credentials.env
python3 <script_name>.py
```

## Script Inventory

| Script | Purpose | Dependencies | Env Vars Required |
|--------|---------|-------------|-------------------|
| `tb_api_test.py` | REST API capability test (14 tests) | stdlib only | `TB_URL`, `TB_USERNAME`, `TB_PASSWORD` |
| `setup_zenopix.py` | Full Zenopix infrastructure setup | requests, paho-mqtt | All TB + TTN vars |
| `e2e_test.py` | End-to-end RPC/MQTT/TTN test | requests, paho-mqtt | All TB + TTN vars |
| `mqtt_test.py` | TTN MQTT connectivity test | paho-mqtt | `TTN_MQTT_HOST`, `TTN_MQTT_USER`, `TTN_MQTT_PASS` |

## Script Details

### tb_api_test.py (1187 lines)

Comprehensive ThingsBoard REST API capability test using only Python stdlib (urllib).
Tests: login, inventory, telemetry read/write, dashboard CRUD, widget creation,
entity alias binding, alarm configuration, device profile management, rule chain analysis.
Creates test entities, verifies, then cleans up.

```bash
source ../credentials.env && python3 tb_api_test.py
```

### setup_zenopix.py (1567 lines)

Full infrastructure orchestration for Zenopix DALI LoRaWAN controller:
- Phase 1: Creates rule chain (10 nodes, TBEL scripts, external MQTT)
- Phase 2: Creates device profile (5 alarm rules)
- Phase 3: Migrates device to new profile
- Phase 4: Creates dashboard (26 widgets, 2 states)
- Phase 5: Runs end-to-end tests (telemetry, RPC, alarms, MQTT)

```bash
source ../credentials.env && python3 setup_zenopix.py
```

### e2e_test.py (119 lines)

End-to-end verification: sends RPC commands (dim 0/50/100/on/off),
subscribes to TTN MQTT to verify downlink payloads match expected base64,
and checks dimLevel server attribute storage.

```bash
source ../credentials.env && python3 e2e_test.py
```

### mqtt_test.py (73 lines)

Basic TTN MQTT broker connectivity test. Subscribes on port 1883 (non-TLS),
publishes on port 8883 (TLS), verifies message delivery.

```bash
source ../credentials.env && python3 mqtt_test.py
```
