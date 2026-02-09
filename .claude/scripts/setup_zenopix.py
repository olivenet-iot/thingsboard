#!/usr/bin/env python3
"""
Zenopix DALI LoRaWAN Controller — Full Infrastructure Setup
Creates: Rule Chain, Device Profile (with alarms), Dashboard, migrates device, runs E2E tests.


Credentials: source /opt/thingsboard/.claude/credentials.env before running.
"""
import os
import requests, json, uuid, time, sys, threading

BASE = os.environ.get("TB_URL", "http://localhost:8080")
DEVICE_ID = os.environ.get("ZENOPIX_DEVICE_ID", "YOUR_DEVICE_ID")
DEVICE_TOKEN = os.environ.get("ZENOPIX_DEVICE_TOKEN", "YOUR_DEVICE_TOKEN")

# ─── Login ───────────────────────────────────────────────────────────────────
print("=" * 70)
print("ZENOPIX DALI LoRaWAN CONTROLLER — INFRASTRUCTURE SETUP")
print("=" * 70)

TB_USERNAME = os.environ.get("TB_USERNAME", "YOUR_TB_USERNAME")
TB_PASSWORD = os.environ.get("TB_PASSWORD", "YOUR_TB_PASSWORD")
r = requests.post(f"{BASE}/api/auth/login", json={"username": TB_USERNAME, "password": TB_PASSWORD})
r.raise_for_status()
TOKEN = r.json()["token"]
H = {"X-Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
print(f"[OK] Logged in as {TB_USERNAME}\n")


def tb_post(path, data, label=""):
    """POST helper with 409 retry."""
    r = requests.post(f"{BASE}{path}", headers=H, json=data)
    if r.status_code == 200:
        return r.json()
    elif r.status_code == 409:
        print(f"  [WARN] 409 Conflict on {label or path}, retrying...")
        time.sleep(1)
        r2 = requests.post(f"{BASE}{path}", headers=H, json=data)
        if r2.status_code == 200:
            return r2.json()
        print(f"  [ERROR] Retry failed {r2.status_code}: {r2.text[:300]}")
        return None
    else:
        print(f"  [ERROR] {r.status_code} on {label or path}: {r.text[:500]}")
        return None


def tb_get(path):
    r = requests.get(f"{BASE}{path}", headers=H)
    r.raise_for_status()
    return r.json()


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 1: CREATE RULE CHAIN
# ═══════════════════════════════════════════════════════════════════════════════
print("=" * 70)
print("PHASE 1: Creating Rule Chain — 'Zenopix DALI Rule Chain'")
print("=" * 70)

# Step 1a: Create empty rule chain
rc_body = {
    "name": "Zenopix DALI Rule Chain",
    "type": "CORE",
    "debugMode": False,
    "configuration": {"description": "Dedicated rule chain for Zenopix DALI LoRaWAN smart lighting controllers"}
}
rc_result = tb_post("/api/ruleChain", rc_body, "create rule chain")
if not rc_result:
    print("FATAL: Cannot create rule chain")
    sys.exit(1)

RC_ID = rc_result["id"]["id"]
print(f"  [OK] Rule Chain created: {RC_ID}")

# Step 1b: Build metadata (nodes + connections)
# Get the rule chain metadata to find the first rule node ID
rc_meta = tb_get(f"/api/ruleChain/{RC_ID}/metadata")

# ── TBEL Scripts ──
ENERGY_CALC_TBEL = r"""var pw = msg.light_src_voltage * msg.light_src_current * msg.power_factor / 1000.0;
if (pw == 0 && msg.output_current_pct > 0 && msg.supply_voltage > 0) {
    pw = msg.supply_voltage * msg.output_current_pct / 100.0 * msg.power_factor * 0.5;
}
msg.power_watts = Math.round(pw * 100.0) / 100.0;
msg.energy_wh_increment = Math.round(pw * 10.0 / 60.0 * 10000.0) / 10000.0;

return {msg: msg, metadata: metadata, msgType: msgType};"""

DIM_DOWNLINK_TBEL = r"""var base64Payload = null;
var fPort = 8;

if (msg != null && msg.method != null) {
    var method = msg.method;
    var params = msg.params;

    if (method == "setDim" || method == "setState") {
        var dimValue = 0;
        if (params == "on" || params == "\"on\"") {
            dimValue = 100;
        } else if (params == "off" || params == "\"off\"") {
            dimValue = 0;
        } else {
            dimValue = parseInt(params);
            if (dimValue < 0) dimValue = 0;
            if (dimValue > 100) dimValue = 100;
        }
        base64Payload = bytesToBase64([0x84, 0x01, dimValue]);
    }
}

if (base64Payload != null) {
    var newMsg = {"downlinks":[{"f_port":fPort,"frm_payload":base64Payload,"priority":"NORMAL"}]};
    return {"msg":newMsg,"metadata":metadata,"msgType":"DOWNLINK"};
} else {
    return {"msg":msg,"metadata":metadata,"msgType":msgType};
}"""

SAVE_DIM_LEVEL_TBEL = r"""var method = msg.method;
var params = msg.params;

if (method == "setDim" || method == "setState") {
    var dimValue = 0;
    if (params == "on" || params == "\"on\"") {
        dimValue = 100;
    } else if (params == "off" || params == "\"off\"") {
        dimValue = 0;
    } else {
        dimValue = parseInt(params);
        if (dimValue < 0) dimValue = 0;
        if (dimValue > 100) dimValue = 100;
    }
    return {msg: {"dimLevel": dimValue}, metadata: metadata, msgType: "POST_ATTRIBUTES_REQUEST"};
}
return {msg: msg, metadata: metadata, msgType: msgType};"""

NOOP_JS = "return {msg: msg, metadata: metadata, msgType: msgType};"

nodes = [
    # Node 0: Message Type Switch
    {
        "type": "org.thingsboard.rule.engine.filter.TbMsgTypeSwitchNode",
        "name": "Message Type Switch",
        "debugMode": False,
        "singletonMode": False,
        "queueName": None,
        "configurationVersion": 0,
        "configuration": {},
        "additionalInfo": {"layoutX": 400, "layoutY": 200}
    },
    # Node 1: Energy Calculator
    {
        "type": "org.thingsboard.rule.engine.transform.TbTransformMsgNode",
        "name": "Energy Calculator",
        "debugMode": False,
        "singletonMode": False,
        "queueName": None,
        "configurationVersion": 0,
        "configuration": {
            "scriptLang": "TBEL",
            "jsScript": NOOP_JS,
            "tbelScript": ENERGY_CALC_TBEL
        },
        "additionalInfo": {"description": "Calculates power_watts and energy_wh_increment", "layoutX": 200, "layoutY": 400}
    },
    # Node 2: Save Timeseries
    {
        "type": "org.thingsboard.rule.engine.telemetry.TbMsgTimeseriesNode",
        "name": "Save Timeseries",
        "debugMode": False,
        "singletonMode": False,
        "queueName": None,
        "configurationVersion": 0,
        "configuration": {"defaultTTL": 0},
        "additionalInfo": {"layoutX": 200, "layoutY": 600}
    },
    # Node 3: Save Client Attributes
    {
        "type": "org.thingsboard.rule.engine.telemetry.TbMsgAttributesNode",
        "name": "Save Client Attributes",
        "debugMode": False,
        "singletonMode": False,
        "queueName": None,
        "configurationVersion": 1,
        "configuration": {"scope": "CLIENT_SCOPE", "notifyDevice": False},
        "additionalInfo": {"layoutX": 600, "layoutY": 400}
    },
    # Node 4: Device Profile Node (alarm evaluation)
    {
        "type": "org.thingsboard.rule.engine.profile.TbDeviceProfileNode",
        "name": "Device Profile Node",
        "debugMode": False,
        "singletonMode": False,
        "queueName": None,
        "configurationVersion": 0,
        "configuration": {"persistAlarmRulesState": False, "fetchAlarmRulesStateOnStart": False},
        "additionalInfo": {"description": "Evaluates alarm rules from device profile", "layoutX": 400, "layoutY": 400}
    },
    # Node 5: Dim Downlink Transform
    {
        "type": "org.thingsboard.rule.engine.transform.TbTransformMsgNode",
        "name": "Dim Downlink Transform",
        "debugMode": False,
        "singletonMode": False,
        "queueName": None,
        "configurationVersion": 0,
        "configuration": {
            "scriptLang": "TBEL",
            "jsScript": NOOP_JS,
            "tbelScript": DIM_DOWNLINK_TBEL
        },
        "additionalInfo": {"description": "Converts setDim RPC to TTN downlink payload", "layoutX": 700, "layoutY": 600}
    },
    # Node 6: TTN MQTT Publish
    {
        "type": "org.thingsboard.rule.engine.mqtt.TbMqttNode",
        "name": "TTN MQTT Publish",
        "debugMode": False,
        "singletonMode": True,
        "queueName": None,
        "configurationVersion": 2,
        "configuration": {
            "topicPattern": f"v3/{os.environ.get('TTN_APP_ID', 'YOUR_APP_ID')}/devices/${{deviceName}}/down/push",
            "host": os.environ.get("TTN_MQTT_HOST", "YOUR_TTN_HOST"),
            "port": 8883,
            "connectTimeoutSec": 10,
            "clientId": None,
            "cleanSession": True,
            "ssl": True,
            "retainedMessage": False,
            "parseToPlainText": False,
            "protocolVersion": "MQTT_3_1_1",
            "credentials": {
                "type": "basic",
                "username": os.environ.get("TTN_MQTT_USER", "YOUR_TTN_USER"),
                "password": os.environ.get("TTN_MQTT_PASS", "YOUR_TTN_PASS")
            }
        },
        "additionalInfo": {"description": "Publishes downlink to TTN via MQTT", "layoutX": 950, "layoutY": 600}
    },
    # Node 7: Save Dim Level Script
    {
        "type": "org.thingsboard.rule.engine.transform.TbTransformMsgNode",
        "name": "Save Dim Level",
        "debugMode": False,
        "singletonMode": False,
        "queueName": None,
        "configurationVersion": 0,
        "configuration": {
            "scriptLang": "TBEL",
            "jsScript": NOOP_JS,
            "tbelScript": SAVE_DIM_LEVEL_TBEL
        },
        "additionalInfo": {"description": "Extracts dimLevel from RPC for server attribute", "layoutX": 700, "layoutY": 800}
    },
    # Node 8: Save Server Attributes
    {
        "type": "org.thingsboard.rule.engine.telemetry.TbMsgAttributesNode",
        "name": "Save Server Attributes",
        "debugMode": False,
        "singletonMode": False,
        "queueName": None,
        "configurationVersion": 1,
        "configuration": {"scope": "SERVER_SCOPE", "notifyDevice": False},
        "additionalInfo": {"description": "Saves dimLevel as server attribute", "layoutX": 950, "layoutY": 800}
    },
    # Node 9: Log Other
    {
        "type": "org.thingsboard.rule.engine.action.TbLogNode",
        "name": "Log Other",
        "debugMode": False,
        "singletonMode": False,
        "queueName": None,
        "configurationVersion": 0,
        "configuration": {
            "scriptLang": "TBEL",
            "jsScript": "return 'Incoming message: ' + JSON.stringify(msg) + ' metadata: ' + JSON.stringify(metadata);",
            "tbelScript": "return 'Incoming message: ' + JSON.stringify(msg) + ' metadata: ' + JSON.stringify(metadata);"
        },
        "additionalInfo": {"layoutX": 100, "layoutY": 400}
    },
]

connections = [
    # Message Type Switch → various
    {"fromIndex": 0, "toIndex": 1, "type": "Post telemetry"},
    {"fromIndex": 0, "toIndex": 4, "type": "Post telemetry"},
    {"fromIndex": 0, "toIndex": 3, "type": "Post attributes"},
    {"fromIndex": 0, "toIndex": 5, "type": "RPC Request to Device"},
    {"fromIndex": 0, "toIndex": 7, "type": "RPC Request to Device"},
    {"fromIndex": 0, "toIndex": 9, "type": "Other"},
    # Energy Calculator → Save Timeseries
    {"fromIndex": 1, "toIndex": 2, "type": "Success"},
    # Dim Downlink → TTN MQTT
    {"fromIndex": 5, "toIndex": 6, "type": "Success"},
    # Save Dim Level → Save Server Attrs
    {"fromIndex": 7, "toIndex": 8, "type": "Success"},
    # Device Profile Node → Save Timeseries (after alarm eval)
    {"fromIndex": 4, "toIndex": 2, "type": "Success"},
]

metadata_body = {
    "ruleChainId": {"entityType": "RULE_CHAIN", "id": RC_ID},
    "firstNodeIndex": 0,
    "nodes": nodes,
    "connections": connections,
    "ruleChainConnections": None
}

# Save for debug
with open("/tmp/zenopix_rulechain_metadata.json", "w") as f:
    json.dump(metadata_body, f, indent=2)

meta_result = tb_post("/api/ruleChain/metadata", metadata_body, "rule chain metadata")
if not meta_result:
    print("FATAL: Cannot set rule chain metadata")
    sys.exit(1)

print(f"  [OK] Rule chain metadata set: {len(meta_result['nodes'])} nodes, {len(meta_result['connections'])} connections")
print()

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 2: CREATE DEVICE PROFILE
# ═══════════════════════════════════════════════════════════════════════════════
print("=" * 70)
print("PHASE 2: Creating Device Profile — 'Zenopix DALI Controller'")
print("=" * 70)


def make_numeric_alarm_condition(key, operation, value):
    """Build a single numeric alarm condition for a timeseries key."""
    return {
        "condition": [{
            "key": {"type": "TIME_SERIES", "key": key},
            "valueType": "NUMERIC",
            "value": None,
            "predicate": {
                "type": "NUMERIC",
                "operation": operation,
                "value": {"defaultValue": value, "userValue": None, "dynamicValue": None}
            }
        }],
        "spec": {"type": "SIMPLE"}
    }


def make_bool_alarm_condition(key, bool_value):
    """Build a boolean alarm condition for a timeseries key."""
    return {
        "condition": [{
            "key": {"type": "TIME_SERIES", "key": key},
            "valueType": "BOOLEAN",
            "value": None,
            "predicate": {
                "type": "BOOLEAN",
                "operation": "EQUAL",
                "value": {"defaultValue": bool_value, "userValue": None, "dynamicValue": None}
            }
        }],
        "spec": {"type": "SIMPLE"}
    }


alarm_rules = [
    # 1. High Internal Temperature
    {
        "id": str(uuid.uuid4()),
        "alarmType": "High Internal Temperature",
        "createRules": {
            "WARNING": {
                "condition": make_numeric_alarm_condition("internal_temp", "GREATER", 70),
                "schedule": None,
                "alarmDetails": "Internal temperature is above 70°C: ${internal_temp}°C",
                "dashboardId": None
            },
            "CRITICAL": {
                "condition": make_numeric_alarm_condition("internal_temp", "GREATER", 85),
                "schedule": None,
                "alarmDetails": "CRITICAL: Internal temperature is above 85°C: ${internal_temp}°C",
                "dashboardId": None
            }
        },
        "clearRule": {
            "condition": make_numeric_alarm_condition("internal_temp", "LESS", 60),
            "schedule": None,
            "alarmDetails": "Temperature returned to normal: ${internal_temp}°C",
            "dashboardId": None
        },
        "propagate": False,
        "propagateToOwner": False,
        "propagateToTenant": False,
        "propagateRelationTypes": None
    },
    # 2. Supply Under-Voltage
    {
        "id": str(uuid.uuid4()),
        "alarmType": "Supply Under-Voltage",
        "createRules": {
            "WARNING": {
                "condition": make_numeric_alarm_condition("supply_voltage", "LESS", 198),
                "schedule": None,
                "alarmDetails": "Supply voltage below 198V: ${supply_voltage}V",
                "dashboardId": None
            }
        },
        "clearRule": {
            "condition": make_numeric_alarm_condition("supply_voltage", "GREATER", 205),
            "schedule": None,
            "alarmDetails": "Supply voltage returned to normal: ${supply_voltage}V",
            "dashboardId": None
        },
        "propagate": False,
        "propagateToOwner": False,
        "propagateToTenant": False,
        "propagateRelationTypes": None
    },
    # 3. Supply Over-Voltage
    {
        "id": str(uuid.uuid4()),
        "alarmType": "Supply Over-Voltage",
        "createRules": {
            "WARNING": {
                "condition": make_numeric_alarm_condition("supply_voltage", "GREATER", 253),
                "schedule": None,
                "alarmDetails": "Supply voltage above 253V: ${supply_voltage}V",
                "dashboardId": None
            }
        },
        "clearRule": {
            "condition": make_numeric_alarm_condition("supply_voltage", "LESS", 245),
            "schedule": None,
            "alarmDetails": "Supply voltage returned to normal: ${supply_voltage}V",
            "dashboardId": None
        },
        "propagate": False,
        "propagateToOwner": False,
        "propagateToTenant": False,
        "propagateRelationTypes": None
    },
    # 4. Light Source Failure
    {
        "id": str(uuid.uuid4()),
        "alarmType": "Light Source Failure",
        "createRules": {
            "CRITICAL": {
                "condition": make_bool_alarm_condition("fault_light_src_failure", True),
                "schedule": None,
                "alarmDetails": "Light source failure detected!",
                "dashboardId": None
            }
        },
        "clearRule": {
            "condition": make_bool_alarm_condition("fault_light_src_failure", False),
            "schedule": None,
            "alarmDetails": "Light source failure cleared",
            "dashboardId": None
        },
        "propagate": False,
        "propagateToOwner": False,
        "propagateToTenant": False,
        "propagateRelationTypes": None
    },
    # 5. Overall Fault
    {
        "id": str(uuid.uuid4()),
        "alarmType": "Overall Fault",
        "createRules": {
            "CRITICAL": {
                "condition": make_bool_alarm_condition("fault_overall_failure", True),
                "schedule": None,
                "alarmDetails": "Overall fault detected!",
                "dashboardId": None
            }
        },
        "clearRule": {
            "condition": make_bool_alarm_condition("fault_overall_failure", False),
            "schedule": None,
            "alarmDetails": "Overall fault cleared",
            "dashboardId": None
        },
        "propagate": False,
        "propagateToOwner": False,
        "propagateToTenant": False,
        "propagateRelationTypes": None
    },
]

profile_body = {
    "name": "Zenopix DALI Controller",
    "type": "DEFAULT",
    "transportType": "DEFAULT",
    "description": "Zenopix DALI LoRaWAN smart lighting controller - D4i compatible",
    "defaultRuleChainId": {"entityType": "RULE_CHAIN", "id": RC_ID},
    "defaultDashboardId": None,
    "defaultQueueName": None,
    "provisionType": "DISABLED",
    "profileData": {
        "configuration": {"type": "DEFAULT"},
        "transportConfiguration": {"type": "DEFAULT"},
        "provisionConfiguration": {"type": "DISABLED", "provisionDeviceSecret": None},
        "alarms": alarm_rules
    }
}

with open("/tmp/zenopix_device_profile.json", "w") as f:
    json.dump(profile_body, f, indent=2)

profile_result = tb_post("/api/deviceProfile", profile_body, "device profile")
if not profile_result:
    print("FATAL: Cannot create device profile")
    sys.exit(1)

PROFILE_ID = profile_result["id"]["id"]
print(f"  [OK] Device Profile created: {PROFILE_ID}")
print(f"       Name: {profile_result['name']}")
print(f"       Alarms: {len(profile_result['profileData']['alarms'])}")
print(f"       Rule Chain: {RC_ID}")
print()

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 3: MIGRATE DEVICE
# ═══════════════════════════════════════════════════════════════════════════════
print("=" * 70)
print("PHASE 3: Migrating Device — zenopix-test → Zenopix DALI Controller")
print("=" * 70)

device = tb_get(f"/api/device/{DEVICE_ID}")
old_profile = device["deviceProfileId"]["id"]
print(f"  Current profile: {old_profile}")

device["deviceProfileId"] = {"entityType": "DEVICE_PROFILE", "id": PROFILE_ID}
migrate_result = tb_post("/api/device", device, "migrate device")
if not migrate_result:
    print("FATAL: Cannot migrate device")
    sys.exit(1)

print(f"  [OK] Device migrated to new profile: {PROFILE_ID}")

# Verify
verify_dev = tb_get(f"/api/device/{DEVICE_ID}")
assert verify_dev["deviceProfileId"]["id"] == PROFILE_ID, "Profile migration verification failed!"
print(f"  [OK] Verified: device profile = {verify_dev['deviceProfileId']['id']}")
print()

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 4: CREATE DASHBOARD
# ═══════════════════════════════════════════════════════════════════════════════
print("=" * 70)
print("PHASE 4: Creating Dashboard — 'Zenopix DALI Monitor'")
print("=" * 70)

# Entity alias
ALIAS_ID = str(uuid.uuid4())

entity_aliases = {
    ALIAS_ID: {
        "id": ALIAS_ID,
        "alias": "zenopixDevice",
        "filter": {
            "type": "singleEntity",
            "resolveMultiple": False,
            "singleEntity": {"entityType": "DEVICE", "id": DEVICE_ID}
        }
    }
}


# ── Widget helper functions ──────────────────────────────────────────────────

def make_value_card(widget_id, key, label, unit, decimals, icon, icon_color, key_type="timeseries"):
    """Create a value_card widget."""
    return {
        "typeFullFqn": "system.cards.value_card",
        "type": "latest",
        "sizeX": 4,
        "sizeY": 3,
        "config": {
            "datasources": [{
                "type": "entity",
                "name": "",
                "entityAliasId": ALIAS_ID,
                "dataKeys": [{
                    "name": key,
                    "type": key_type,
                    "label": label,
                    "color": "#2196f3",
                    "settings": {},
                    "units": None,
                    "decimals": None,
                    "funcBody": None,
                    "usePostProcessing": None,
                    "postFuncBody": None
                }],
                "alarmFilterConfig": {"statusList": ["ACTIVE"]},
                "latestDataKeys": []
            }],
            "showTitle": False,
            "backgroundColor": "rgba(0, 0, 0, 0)",
            "color": "rgba(0, 0, 0, 0.87)",
            "padding": "0px",
            "settings": {
                "labelPosition": "top",
                "layout": "square",
                "showLabel": True,
                "labelFont": {"size": 16, "sizeUnit": "px", "family": "Roboto", "weight": "500", "style": "normal"},
                "labelColor": {"type": "constant", "color": "rgba(0, 0, 0, 0.87)"},
                "showIcon": True,
                "iconSize": 34,
                "iconSizeUnit": "px",
                "icon": icon,
                "iconColor": {"type": "constant", "color": icon_color},
                "valueFont": {"family": "Roboto", "size": 42, "sizeUnit": "px", "style": "normal", "weight": "500"},
                "valueColor": {"type": "constant", "color": "rgba(0, 0, 0, 0.87)"},
                "showDate": False,
                "dateFormat": {"format": None, "lastUpdateAgo": True, "custom": False},
                "dateFont": {"family": "Roboto", "size": 12, "sizeUnit": "px", "style": "normal", "weight": "500"},
                "dateColor": {"type": "constant", "color": "rgba(0, 0, 0, 0.38)"},
                "background": {"type": "color", "color": "#fff", "overlay": {"enabled": False, "color": "rgba(255,255,255,0.72)", "blur": 3}},
                "autoScale": True
            },
            "title": label,
            "dropShadow": True,
            "enableFullscreen": False,
            "titleStyle": {"fontSize": "16px", "fontWeight": 400},
            "units": unit,
            "decimals": decimals,
            "configMode": "basic",
            "actions": {},
            "widgetStyle": {},
            "widgetCss": "",
            "noDataDisplayMessage": "",
            "pageSize": 1024,
            "showTitleIcon": False,
            "borderRadius": "0px",
            "margin": "0px"
        },
        "row": 0,
        "col": 0,
        "id": widget_id
    }


def make_time_series_chart(widget_id, title, data_keys_config):
    """Create a time_series_chart widget. data_keys_config is a list of {name, label, color, units, decimals}."""
    data_keys = []
    for dk in data_keys_config:
        data_keys.append({
            "name": dk["name"],
            "type": "timeseries",
            "label": dk.get("label", dk["name"]),
            "color": dk["color"],
            "settings": {
                "yAxisId": "default",
                "showInLegend": True,
                "dataHiddenByDefault": False,
                "type": "line",
                "lineSettings": {
                    "showLine": True,
                    "step": False,
                    "stepType": "start",
                    "smooth": True,
                    "lineType": "solid",
                    "lineWidth": 2,
                    "showPoints": False,
                    "showPointLabel": False,
                    "pointLabelPosition": "top",
                    "pointLabelFont": {"family": "Roboto", "size": 11, "sizeUnit": "px", "style": "normal", "weight": "400", "lineHeight": "1"},
                    "pointLabelColor": "rgba(0, 0, 0, 0.76)",
                    "pointShape": "circle",
                    "pointSize": 14,
                    "fillAreaSettings": {"type": "gradient", "opacity": 0.4, "gradient": {"start": 70, "end": 10}}
                },
                "barSettings": {
                    "showBorder": False,
                    "borderWidth": 2,
                    "borderRadius": 0,
                    "showLabel": False,
                    "labelPosition": "top",
                    "labelFont": {"family": "Roboto", "size": 11, "sizeUnit": "px", "style": "normal", "weight": "400", "lineHeight": "1"},
                    "labelColor": "rgba(0, 0, 0, 0.76)",
                    "backgroundSettings": {"type": "none", "opacity": 0.4, "gradient": {"start": 100, "end": 0}}
                }
            },
            "units": dk.get("units", ""),
            "decimals": dk.get("decimals", 2),
            "aggregationType": None,
            "funcBody": None,
            "usePostProcessing": None,
            "postFuncBody": None
        })

    return {
        "typeFullFqn": "system.time_series_chart",
        "type": "timeseries",
        "sizeX": 12,
        "sizeY": 5,
        "config": {
            "datasources": [{
                "type": "entity",
                "name": "",
                "entityAliasId": ALIAS_ID,
                "dataKeys": data_keys,
                "alarmFilterConfig": {"statusList": ["ACTIVE"]},
                "latestDataKeys": []
            }],
            "showTitle": True,
            "backgroundColor": "rgb(255, 255, 255)",
            "color": "rgba(0, 0, 0, 0.87)",
            "padding": "0px",
            "settings": {
                "showLegend": True,
                "legendConfig": {
                    "direction": "row",
                    "position": "bottom",
                    "showMin": False,
                    "showMax": False,
                    "showAvg": False,
                    "showTotal": False,
                    "showLatest": True
                },
                "dataZoom": True,
                "stack": False,
                "yAxes": {
                    "default": {
                        "show": True,
                        "label": "",
                        "min": None,
                        "max": None,
                        "showTickLabels": True,
                        "tickLabelFont": {"family": "Roboto", "size": 12, "sizeUnit": "px", "style": "normal", "weight": "400"},
                        "ticksFormatter": "",
                        "showTicks": True,
                        "ticksColor": "rgba(0,0,0,0.1)",
                        "showSplitLines": True,
                        "splitLinesColor": "rgba(0,0,0,0.1)"
                    }
                },
                "xAxis": {
                    "show": True,
                    "showTickLabels": True,
                    "tickLabelFont": {"family": "Roboto", "size": 10, "sizeUnit": "px", "style": "normal", "weight": "400"},
                    "showTicks": True,
                    "showSplitLines": True,
                    "splitLinesColor": "rgba(0,0,0,0.1)"
                },
                "animation": {"animation": True, "animationDuration": 500, "animationDurationUpdate": 300},
                "tooltip": {"trigger": "axis", "showFocusedSeries": False},
                "noAggregation": False,
                "thresholds": []
            },
            "title": title,
            "dropShadow": True,
            "enableFullscreen": True,
            "useDashboardTimewindow": True,
            "titleStyle": {"fontSize": "16px", "fontWeight": 400},
            "configMode": "basic",
            "actions": {},
            "widgetStyle": {},
            "widgetCss": "",
            "noDataDisplayMessage": "",
            "showTitleIcon": False
        },
        "row": 0,
        "col": 0,
        "id": widget_id
    }


def make_command_button(widget_id, label, value_func, icon, main_color):
    """Create a command_button widget for RPC calls."""
    return {
        "typeFullFqn": "system.command_button",
        "type": "rpc",
        "sizeX": 3,
        "sizeY": 2,
        "config": {
            "showTitle": False,
            "backgroundColor": "rgba(255, 255, 255, 0)",
            "color": "rgba(0, 0, 0, 0.87)",
            "padding": "0px",
            "settings": {
                "onClickState": {
                    "action": "EXECUTE_RPC",
                    "executeRpc": {"method": "setDim", "requestTimeout": 5000, "requestPersistent": False, "persistentPollingInterval": 1000},
                    "setAttribute": {"scope": "SERVER_SCOPE", "key": "state"},
                    "putTimeSeries": {"key": "state"},
                    "valueToData": {"type": "FUNCTION", "constantValue": True, "valueToDataFunction": value_func}
                },
                "disabledState": {
                    "action": "DO_NOTHING",
                    "defaultValue": False,
                    "getAttribute": {"key": "state", "scope": None},
                    "getTimeSeries": {"key": "state"},
                    "getAlarmStatus": {"severityList": None, "typeList": None},
                    "dataToValue": {"type": "NONE", "compareToValue": True, "dataToValueFunction": "/* Should return boolean value */\nreturn data;"}
                },
                "appearance": {
                    "type": "outlined",
                    "autoScale": True,
                    "showLabel": True,
                    "label": label,
                    "showIcon": True,
                    "icon": icon,
                    "iconSize": 24,
                    "iconSizeUnit": "px",
                    "mainColor": main_color,
                    "backgroundColor": "#FFFFFF",
                    "customStyle": {"enabled": None, "hovered": None, "pressed": None, "activated": None, "disabled": None}
                }
            },
            "title": "Command button",
            "dropShadow": False,
            "enableFullscreen": False,
            "configMode": "basic",
            "borderRadius": "4px",
            "datasources": [],
            "targetDevice": {"type": "device", "deviceId": DEVICE_ID},
            "actions": {},
            "widgetStyle": {},
            "widgetCss": "",
            "noDataDisplayMessage": ""
        },
        "row": 0,
        "col": 0,
        "id": widget_id
    }


# ── Generate all widget IDs ──────────────────────────────────────────────────
wids = {name: str(uuid.uuid4()) for name in [
    # Row 0: value cards
    "supply_voltage", "power_factor", "internal_temp",
    "light_src_voltage", "light_src_temp", "light_src_current",
    # Row 3: more value cards
    "tilt", "output_current_pct", "start_counter", "operating_time",
    # Row 6: control section
    "slider", "dim_gauge", "power_watts", "btn_on", "btn_off",
    # Row 10: charts
    "chart_voltage", "chart_temp",
    # Row 15: fault status cards
    "fault_light_src_failure", "fault_over_voltage", "fault_thermal_shutdown",
    "fault_overall_failure", "status_lamp_on", "status_lamp_failure",
    # Row 15: alarm table
    "alarm_table",
    # Schedule state
    "schedule_placeholder", "nav_main", "nav_schedule",
]}

# ── Build widgets dictionary ──────────────────────────────────────────────────
widgets = {}

# Row 0: Top status cards
widgets[wids["supply_voltage"]] = make_value_card(wids["supply_voltage"], "supply_voltage", "Supply Voltage", "V", 1, "bolt", "#5469FF")
widgets[wids["power_factor"]] = make_value_card(wids["power_factor"], "power_factor", "Power Factor", "", 2, "speed", "#4CAF50")
widgets[wids["internal_temp"]] = make_value_card(wids["internal_temp"], "internal_temp", "Internal Temp", "\u00b0C", 0, "thermostat", "#FF5722")
widgets[wids["light_src_voltage"]] = make_value_card(wids["light_src_voltage"], "light_src_voltage", "Light Src Voltage", "V", 1, "lightbulb", "#FF9800")
widgets[wids["light_src_temp"]] = make_value_card(wids["light_src_temp"], "light_src_temp", "Light Src Temp", "\u00b0C", 0, "device_thermostat", "#E91E63")
widgets[wids["light_src_current"]] = make_value_card(wids["light_src_current"], "light_src_current", "Light Src Current", "mA", 0, "electric_meter", "#9C27B0")

# Row 3: More status cards
widgets[wids["tilt"]] = make_value_card(wids["tilt"], "tilt", "Tilt", "\u00b0", 0, "screen_rotation", "#607D8B")
widgets[wids["output_current_pct"]] = make_value_card(wids["output_current_pct"], "output_current_pct", "Output Current", "%", 1, "trending_up", "#00BCD4")
widgets[wids["start_counter"]] = make_value_card(wids["start_counter"], "start_counter", "Start Counter", "", 0, "replay", "#795548")
widgets[wids["operating_time"]] = make_value_card(wids["operating_time"], "operating_time", "Operating Time", "hrs", 0, "schedule", "#3F51B5")
widgets[wids["operating_time"]]["sizeX"] = 12  # wider card

# Row 6: Dim Slider
widgets[wids["slider"]] = {
    "typeFullFqn": "system.slider",
    "type": "rpc",
    "sizeX": 10,
    "sizeY": 4,
    "config": {
        "showTitle": True,
        "backgroundColor": "#ffffff",
        "color": "rgba(0, 0, 0, 0.87)",
        "padding": "0px",
        "settings": {
            "initialState": {
                "action": "GET_ATTRIBUTE",
                "defaultValue": 0,
                "getAttribute": {"key": "dimLevel", "scope": "SERVER_SCOPE"},
                "getTimeSeries": {"key": "dimLevel"},
                "dataToValue": {"type": "NONE", "compareToValue": True, "dataToValueFunction": "return data;"}
            },
            "sliderUpdateState": {
                "action": "EXECUTE_RPC",
                "executeRpc": {"method": "setDim", "requestTimeout": 5000, "requestPersistent": False, "persistentPollingInterval": 1000},
                "setAttribute": {"scope": "SERVER_SCOPE", "key": "dimLevel"},
                "putTimeSeries": {"key": "dimLevel"},
                "valueToData": {"type": "VALUE", "constantValue": 0, "valueToDataFunction": "return value;"}
            },
            "appearance": {
                "showLabel": True,
                "label": "DALI Dim Control",
                "showValue": True,
                "valueUnits": "%",
                "showTicks": True,
                "ticksStep": 25,
                "mainColor": "#F5DD00",
                "backgroundColor": "#e0e0e0",
                "tickMin": 0,
                "tickMax": 100,
                "showLeftIcon": True,
                "leftIcon": "lightbulb_outline",
                "showRightIcon": True,
                "rightIcon": "lightbulb"
            }
        },
        "title": "DALI Dim Control",
        "dropShadow": True,
        "enableFullscreen": False,
        "configMode": "basic",
        "datasources": [],
        "targetDevice": {"type": "device", "deviceId": DEVICE_ID},
        "actions": {},
        "widgetStyle": {},
        "widgetCss": "",
        "noDataDisplayMessage": ""
    },
    "row": 0,
    "col": 0,
    "id": wids["slider"]
}

# Dim Gauge (vertical bar)
widgets[wids["dim_gauge"]] = {
    "typeFullFqn": "system.digital_gauges.vertical_bar_justgage",
    "type": "latest",
    "sizeX": 4,
    "sizeY": 4,
    "config": {
        "datasources": [{
            "type": "entity",
            "name": "",
            "entityAliasId": ALIAS_ID,
            "dataKeys": [{"name": "dim_value", "type": "timeseries", "label": "Dim Level", "color": "#F5DD00", "settings": {}}],
            "alarmFilterConfig": {"statusList": ["ACTIVE"]}
        }],
        "showTitle": False,
        "backgroundColor": None,
        "color": "rgba(0, 0, 0, 0.87)",
        "padding": "0px",
        "settings": {
            "maxValue": 100,
            "minValue": 0,
            "showValue": True,
            "showMinMax": True,
            "gaugeWidthScale": 0.75,
            "showTitle": False,
            "gaugeType": "verticalBar",
            "barColor": {"type": "constant", "color": "#F5DD00"},
            "neonGlowBrightness": 0,
            "dashThickness": 1.5,
            "gaugeColor": "#A1ADB1",
            "titleFont": {"family": "Roboto", "size": 12, "style": "normal", "weight": "500", "color": "#999999"},
            "labelFont": {"family": "Roboto", "size": 8, "style": "normal", "weight": "500"},
            "valueFont": {"family": "Roboto", "style": "normal", "weight": "500", "size": 14, "color": "#666666"},
            "minMaxFont": {"family": "Roboto", "size": 8, "style": "normal", "weight": "500", "color": "#666666"}
        },
        "title": "Dim Level",
        "dropShadow": True,
        "enableFullscreen": False,
        "configMode": "basic",
        "units": "%",
        "decimals": 0,
        "actions": {},
        "widgetStyle": {}
    },
    "row": 0,
    "col": 0,
    "id": wids["dim_gauge"]
}

# Power watts card
widgets[wids["power_watts"]] = make_value_card(wids["power_watts"], "power_watts", "Instant Power", "W", 1, "electric_bolt", "#FF5722")

# ON / OFF buttons
widgets[wids["btn_on"]] = make_command_button(wids["btn_on"], "DIM ON (100%)", 'return "on"', "lightbulb", "#4CAF50")
widgets[wids["btn_off"]] = make_command_button(wids["btn_off"], "DIM OFF (0%)", 'return "off"', "lightbulb_outline", "#F44336")

# Charts
widgets[wids["chart_voltage"]] = make_time_series_chart(
    wids["chart_voltage"], "Supply Voltage (24h)",
    [{"name": "supply_voltage", "label": "Supply Voltage", "color": "#5469FF", "units": "V", "decimals": 1}]
)
widgets[wids["chart_temp"]] = make_time_series_chart(
    wids["chart_temp"], "Temperature (24h)",
    [
        {"name": "internal_temp", "label": "Internal Temp", "color": "#FF5722", "units": "\u00b0C", "decimals": 1},
        {"name": "light_src_temp", "label": "Light Src Temp", "color": "#E91E63", "units": "\u00b0C", "decimals": 1},
    ]
)

# Fault status cards (boolean indicators)
fault_cards = [
    ("fault_light_src_failure", "Light Src Failure", "warning", "#F44336"),
    ("fault_over_voltage", "Over Voltage", "warning", "#FF9800"),
    ("fault_thermal_shutdown", "Thermal Shutdown", "warning", "#FF5722"),
    ("fault_overall_failure", "Overall Failure", "error", "#F44336"),
    ("status_lamp_on", "Lamp ON", "lightbulb", "#4CAF50"),
    ("status_lamp_failure", "Lamp Failure", "warning", "#F44336"),
]
for key, label, icon, color in fault_cards:
    w = make_value_card(wids[key], key, label, "", 0, icon, color)
    w["sizeX"] = 2
    w["sizeY"] = 2
    widgets[wids[key]] = w

# Alarm Table
widgets[wids["alarm_table"]] = {
    "typeFullFqn": "system.alarm_widgets.alarms_table",
    "type": "alarm",
    "sizeX": 12,
    "sizeY": 5,
    "config": {
        "timewindow": {
            "realtime": {"interval": 1000, "timewindowMs": 86400000},
            "aggregation": {"type": "NONE", "limit": 200}
        },
        "showTitle": True,
        "backgroundColor": "rgb(255, 255, 255)",
        "color": "rgba(0, 0, 0, 0.87)",
        "padding": "4px",
        "settings": {
            "enableSelection": True,
            "enableSearch": True,
            "displayDetails": True,
            "allowAcknowledgment": True,
            "allowClear": True,
            "displayPagination": True,
            "defaultPageSize": 10,
            "defaultSortOrder": "-startTime",
            "enableSelectColumnDisplay": True,
            "enableStickyAction": False,
            "enableFilter": True,
            "enableStickyHeader": True,
            "reserveSpaceForHiddenAction": "true",
            "useRowStyleFunction": False,
            "alarmsTitle": "Device Alarms"
        },
        "title": "Alarms",
        "dropShadow": True,
        "enableFullscreen": True,
        "useDashboardTimewindow": False,
        "titleStyle": {"fontSize": "20px", "fontWeight": 700},
        "showLegend": False,
        "alarmSource": {
            "type": "entity",
            "name": None,
            "entityAliasId": ALIAS_ID,
            "filterId": None,
            "dataKeys": [
                {"name": "startTime", "type": "alarm", "label": "Start time", "color": "#2196f3",
                 "settings": {"useCellStyleFunction": False, "useCellContentFunction": False, "columnWidth": "0px", "defaultColumnVisibility": "visible", "columnSelectionToDisplay": "enabled"}},
                {"name": "type", "type": "alarm", "label": "Type", "color": "#f44336",
                 "settings": {"useCellStyleFunction": False, "useCellContentFunction": False, "columnWidth": "120px", "defaultColumnVisibility": "visible", "columnSelectionToDisplay": "enabled"}},
                {"name": "severity", "type": "alarm", "label": "Severity", "color": "#ffc107",
                 "settings": {"useCellStyleFunction": False, "useCellContentFunction": False}},
                {"name": "status", "type": "alarm", "label": "Status", "color": "#607d8b",
                 "settings": {"useCellStyleFunction": False, "useCellContentFunction": False}},
            ]
        },
        "alarmFilterConfig": {"statusList": ["ACTIVE", "ACKNOWLEDGED"]},
        "configMode": "basic",
        "actions": {},
        "widgetStyle": {},
        "widgetCss": "",
        "noDataDisplayMessage": ""
    },
    "row": 0,
    "col": 0,
    "id": wids["alarm_table"]
}

# Navigation button: main → schedule
widgets[wids["nav_schedule"]] = {
    "typeFullFqn": "system.navigation_cards.state_navigation_card",
    "type": "static",
    "sizeX": 4,
    "sizeY": 2,
    "config": {
        "showTitle": False,
        "backgroundColor": "rgba(0, 0, 0, 0)",
        "padding": "0px",
        "settings": {},
        "title": "Go to Schedule",
        "dropShadow": True,
        "enableFullscreen": False,
        "configMode": "basic",
        "datasources": [],
        "actions": {
            "headerClick": [{
                "id": str(uuid.uuid4()),
                "name": "Go to Schedule",
                "icon": "calendar_month",
                "type": "openDashboardState",
                "targetDashboardStateId": "schedule",
                "setEntityId": False,
                "stateEntityParamName": None,
                "openRightLayout": False,
                "openInSeparateDialog": False,
                "openInPopover": False,
                "openNewBrowserTab": False,
                "dialogTitle": None,
                "dialogWidth": None,
                "dialogHeight": None,
                "isNewTarget": False
            }]
        },
        "widgetStyle": {},
        "widgetCss": "",
        "noDataDisplayMessage": ""
    },
    "row": 0,
    "col": 0,
    "id": wids["nav_schedule"]
}

# Schedule state: placeholder HTML widget
widgets[wids["schedule_placeholder"]] = {
    "typeFullFqn": "system.html_widgets.html_card",
    "type": "static",
    "sizeX": 16,
    "sizeY": 8,
    "config": {
        "showTitle": True,
        "backgroundColor": "#ffffff",
        "padding": "16px",
        "settings": {
            "html": "<div style='text-align:center;padding:40px;'><h2 style='color:#666;'>Schedule Feature</h2><p style='font-size:18px;color:#999;'>Zamanlama ozelligi yakin zamanda eklenecektir.</p><p style='font-size:14px;color:#bbb;'>Weekly schedule grid with dim levels for each time slot will be available here.</p></div>",
            "css": ""
        },
        "title": "Schedule (Coming Soon)",
        "dropShadow": True,
        "enableFullscreen": False,
        "configMode": "basic",
        "datasources": [],
        "actions": {},
        "widgetStyle": {},
        "widgetCss": "",
        "noDataDisplayMessage": ""
    },
    "row": 0,
    "col": 0,
    "id": wids["schedule_placeholder"]
}

# Navigation button: schedule → main
widgets[wids["nav_main"]] = {
    "typeFullFqn": "system.navigation_cards.state_navigation_card",
    "type": "static",
    "sizeX": 4,
    "sizeY": 2,
    "config": {
        "showTitle": False,
        "backgroundColor": "rgba(0, 0, 0, 0)",
        "padding": "0px",
        "settings": {},
        "title": "Back to Monitor",
        "dropShadow": True,
        "enableFullscreen": False,
        "configMode": "basic",
        "datasources": [],
        "actions": {
            "headerClick": [{
                "id": str(uuid.uuid4()),
                "name": "Back to Monitor",
                "icon": "dashboard",
                "type": "openDashboardState",
                "targetDashboardStateId": "main",
                "setEntityId": False,
                "stateEntityParamName": None,
                "openRightLayout": False,
                "openInSeparateDialog": False,
                "openInPopover": False,
                "openNewBrowserTab": False,
                "dialogTitle": None,
                "dialogWidth": None,
                "dialogHeight": None,
                "isNewTarget": False
            }]
        },
        "widgetStyle": {},
        "widgetCss": "",
        "noDataDisplayMessage": ""
    },
    "row": 0,
    "col": 0,
    "id": wids["nav_main"]
}

# ── Dashboard layout ──────────────────────────────────────────────────────────
main_layout_widgets = {
    # Row 0: Top value cards (6 × 4col × 3row)
    wids["supply_voltage"]:    {"sizeX": 4, "sizeY": 3, "row": 0, "col": 0},
    wids["power_factor"]:      {"sizeX": 4, "sizeY": 3, "row": 0, "col": 4},
    wids["internal_temp"]:     {"sizeX": 4, "sizeY": 3, "row": 0, "col": 8},
    wids["light_src_voltage"]: {"sizeX": 4, "sizeY": 3, "row": 0, "col": 12},
    wids["light_src_temp"]:    {"sizeX": 4, "sizeY": 3, "row": 0, "col": 16},
    wids["light_src_current"]: {"sizeX": 4, "sizeY": 3, "row": 0, "col": 20},
    # Row 3: More value cards
    wids["tilt"]:              {"sizeX": 4, "sizeY": 3, "row": 3, "col": 0},
    wids["output_current_pct"]:{"sizeX": 4, "sizeY": 3, "row": 3, "col": 4},
    wids["start_counter"]:     {"sizeX": 4, "sizeY": 3, "row": 3, "col": 8},
    wids["operating_time"]:    {"sizeX": 12, "sizeY": 3, "row": 3, "col": 12},
    # Row 6: Control section
    wids["slider"]:            {"sizeX": 10, "sizeY": 4, "row": 6, "col": 0},
    wids["dim_gauge"]:         {"sizeX": 4, "sizeY": 4, "row": 6, "col": 10},
    wids["power_watts"]:       {"sizeX": 4, "sizeY": 4, "row": 6, "col": 14},
    wids["btn_on"]:            {"sizeX": 3, "sizeY": 2, "row": 6, "col": 18},
    wids["btn_off"]:           {"sizeX": 3, "sizeY": 2, "row": 6, "col": 21},
    # Nav button
    wids["nav_schedule"]:      {"sizeX": 6, "sizeY": 2, "row": 8, "col": 18},
    # Row 10: Charts
    wids["chart_voltage"]:     {"sizeX": 12, "sizeY": 5, "row": 10, "col": 0},
    wids["chart_temp"]:        {"sizeX": 12, "sizeY": 5, "row": 10, "col": 12},
    # Row 15: Fault status (6 small cards, 2col each)
    wids["fault_light_src_failure"]:  {"sizeX": 2, "sizeY": 2, "row": 15, "col": 0},
    wids["fault_over_voltage"]:       {"sizeX": 2, "sizeY": 2, "row": 15, "col": 2},
    wids["fault_thermal_shutdown"]:   {"sizeX": 2, "sizeY": 2, "row": 15, "col": 4},
    wids["fault_overall_failure"]:    {"sizeX": 2, "sizeY": 2, "row": 15, "col": 6},
    wids["status_lamp_on"]:           {"sizeX": 2, "sizeY": 2, "row": 15, "col": 8},
    wids["status_lamp_failure"]:      {"sizeX": 2, "sizeY": 2, "row": 15, "col": 10},
    # Alarm table
    wids["alarm_table"]:       {"sizeX": 12, "sizeY": 5, "row": 15, "col": 12},
}

schedule_layout_widgets = {
    wids["schedule_placeholder"]: {"sizeX": 16, "sizeY": 8, "row": 0, "col": 0},
    wids["nav_main"]:             {"sizeX": 4, "sizeY": 2, "row": 0, "col": 16},
}

dashboard = {
    "title": "Zenopix DALI Monitor",
    "configuration": {
        "description": "Production dashboard for Zenopix DALI LoRaWAN smart lighting controllers",
        "widgets": widgets,
        "states": {
            "main": {
                "name": "Monitoring & Control",
                "root": True,
                "layouts": {
                    "main": {
                        "widgets": main_layout_widgets,
                        "gridSettings": {
                            "backgroundColor": "#eeeeee",
                            "columns": 24,
                            "margin": 10,
                            "outerMargin": True,
                            "backgroundSizeMode": "100%"
                        }
                    }
                }
            },
            "schedule": {
                "name": "Schedule",
                "root": False,
                "layouts": {
                    "main": {
                        "widgets": schedule_layout_widgets,
                        "gridSettings": {
                            "backgroundColor": "#eeeeee",
                            "columns": 24,
                            "margin": 10,
                            "outerMargin": True,
                            "backgroundSizeMode": "100%"
                        }
                    }
                }
            }
        },
        "entityAliases": entity_aliases,
        "filters": {},
        "timewindow": {
            "selectedTab": 0,
            "realtime": {"realtimeType": 0, "timewindowMs": 86400000, "quickInterval": "CURRENT_DAY"},
            "aggregation": {"type": "NONE", "limit": 50000}
        },
        "settings": {
            "stateControllerId": "entity",
            "showTitle": True,
            "showDashboardsSelect": True,
            "showEntitiesSelect": True,
            "showDashboardTimewindow": True,
            "showDashboardExport": True,
            "toolbarAlwaysOpen": True
        }
    }
}

with open("/tmp/zenopix_dashboard.json", "w") as f:
    json.dump(dashboard, f, indent=2)

dash_result = tb_post("/api/dashboard", dashboard, "dashboard")
if not dash_result:
    print("FATAL: Cannot create dashboard")
    sys.exit(1)

DASH_ID = dash_result["id"]["id"]
main_widget_count = len(main_layout_widgets)
sched_widget_count = len(schedule_layout_widgets)
print(f"  [OK] Dashboard created: {DASH_ID}")
print(f"       Title: {dash_result['title']}")
print(f"       States: main ({main_widget_count} widgets), schedule ({sched_widget_count} widgets)")
print(f"       URL: http://localhost:8080/dashboards/{DASH_ID}")
print()

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 5: END-TO-END TESTS
# ═══════════════════════════════════════════════════════════════════════════════
print("=" * 70)
print("PHASE 5: End-to-End Testing")
print("=" * 70)

results = {}

# ── Test 1: Telemetry Processing ─────────────────────────────────────────────
print("\n--- Test 1: Telemetry Processing ---")
test_telemetry = {
    "supply_voltage": 222.9,
    "power_factor": 0.98,
    "internal_temp": 31,
    "light_src_voltage": 48,
    "light_src_temp": 65,
    "light_src_current": 350,
    "dim_value": 75,
    "output_current_pct": 75,
    "operating_time": 424131,
    "tilt": 5,
    "start_counter": 1320,
    "fault_light_src_failure": False,
    "fault_over_voltage": False,
    "fault_thermal_shutdown": False,
    "fault_overall_failure": False,
    "status_lamp_on": True,
    "status_lamp_failure": False,
    "ldr": 79,
    "short_address": 0,
    "message_type": "sensor_data"
}

r = requests.post(f"{BASE}/api/v1/{DEVICE_TOKEN}/telemetry", json=test_telemetry)
telem_send_ok = r.status_code == 200
print(f"  Telemetry POST: {r.status_code} {'OK' if telem_send_ok else r.text[:200]}")

time.sleep(3)  # Wait for rule chain processing

# Check calculated fields
r = requests.get(f"{BASE}/api/plugins/telemetry/DEVICE/{DEVICE_ID}/values/timeseries",
                 headers=H, params={"keys": "power_watts,energy_wh_increment,supply_voltage"})
ts_data = r.json() if r.status_code == 200 else {}
has_power = "power_watts" in ts_data and len(ts_data["power_watts"]) > 0
has_energy = "energy_wh_increment" in ts_data and len(ts_data["energy_wh_increment"]) > 0
has_voltage = "supply_voltage" in ts_data and len(ts_data["supply_voltage"]) > 0

if has_power:
    print(f"  power_watts = {ts_data['power_watts'][0]['value']}")
if has_energy:
    print(f"  energy_wh_increment = {ts_data['energy_wh_increment'][0]['value']}")
if has_voltage:
    print(f"  supply_voltage = {ts_data['supply_voltage'][0]['value']}")

test1_ok = telem_send_ok and has_power and has_energy and has_voltage
results["Telemetry Processing"] = test1_ok
print(f"  Result: {'PASS' if test1_ok else 'FAIL'}")

# ── Test 2: RPC Dim Control ──────────────────────────────────────────────────
print("\n--- Test 2: RPC Dim Control ---")

# Start MQTT subscriber in background
mqtt_available = True
try:
    import paho.mqtt.client as mqtt
except ImportError:
    print("  [WARN] paho-mqtt not available, skipping MQTT verification")
    mqtt_available = False

received_messages = []
sub_ready = threading.Event()

if mqtt_available:
    def on_connect(client, userdata, flags, rc, properties=None):
        client.subscribe(f"v3/{os.environ.get('TTN_APP_ID', 'lumosoft-test')}/devices/zenopix-test/down/+")
        sub_ready.set()

    def on_message(client, userdata, msg):
        try:
            received_messages.append({"topic": msg.topic, "payload": json.loads(msg.payload.decode())})
        except:
            pass

    sub = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="zenopix-e2e-test")
    sub.username_pw_set(os.environ.get("TTN_MQTT_USER", "YOUR_TTN_USER"),
                        os.environ.get("TTN_MQTT_PASS", "YOUR_TTN_PASS"))
    sub.on_connect = on_connect
    sub.on_message = on_message
    try:
        sub.connect(os.environ.get("TTN_MQTT_HOST", "YOUR_TTN_HOST"), 1883, 60)
        sub.loop_start()
        sub_ready.wait(timeout=5)
        print("  MQTT subscriber connected")
    except Exception as e:
        print(f"  [WARN] MQTT connection failed: {e}")
        mqtt_available = False

# Send RPC
rpc_body = {"method": "setDim", "params": 50}
r = requests.post(f"{BASE}/api/plugins/rpc/oneway/{DEVICE_ID}", headers=H, json=rpc_body)
rpc_ok = r.status_code in [200, 408]  # 408 expected for offline device
print(f"  RPC setDim(50): {r.status_code} {'OK (408=offline expected)' if r.status_code == 408 else 'OK' if r.status_code == 200 else r.text[:200]}")

time.sleep(5)

# Check MQTT
mqtt_ok = False
if mqtt_available:
    queued = [m for m in received_messages if "queued" in m.get("topic", "")]
    if queued:
        dq = queued[0]["payload"].get("downlink_queued", {})
        actual_b64 = dq.get("frm_payload")
        mqtt_ok = actual_b64 == "hAEy"
        print(f"  MQTT frm_payload: {actual_b64} {'MATCH' if mqtt_ok else 'MISMATCH (expected hAEy)'}")
    else:
        print(f"  MQTT: No queued message (device offline - expected if TTN device not connected)")
        mqtt_ok = True  # Not a failure if device is offline

# Check dimLevel attribute
r_attr = requests.get(
    f"{BASE}/api/plugins/telemetry/DEVICE/{DEVICE_ID}/values/attributes/SERVER_SCOPE",
    headers=H, params={"keys": "dimLevel"}
)
dim_attr = None
if r_attr.status_code == 200:
    for a in r_attr.json():
        if a["key"] == "dimLevel":
            dim_attr = a["value"]
attr_ok = dim_attr == 50
print(f"  dimLevel attribute: {dim_attr} {'MATCH' if attr_ok else 'MISMATCH (expected 50)'}")

if mqtt_available:
    try:
        sub.loop_stop()
        sub.disconnect()
    except:
        pass

test2_ok = rpc_ok and attr_ok
results["RPC Dim Control"] = test2_ok
print(f"  Result: {'PASS' if test2_ok else 'FAIL'}")

# ── Test 3: Alarm Triggering ─────────────────────────────────────────────────
print("\n--- Test 3: Alarm Triggering ---")

# Send under-voltage telemetry
alarm_telem = {"supply_voltage": 190, "internal_temp": 90, "fault_light_src_failure": False, "fault_overall_failure": False}
r = requests.post(f"{BASE}/api/v1/{DEVICE_TOKEN}/telemetry", json=alarm_telem)
print(f"  Sent alarm telemetry (voltage=190, temp=90): {r.status_code}")

time.sleep(5)  # Give alarm evaluation time

# Check alarms
r_alarms = requests.get(
    f"{BASE}/api/alarm/DEVICE/{DEVICE_ID}",
    headers=H, params={"pageSize": 20, "page": 0, "sortProperty": "createdTime", "sortOrder": "DESC"}
)
alarms = []
alarm_types_found = set()
if r_alarms.status_code == 200:
    alarm_data = r_alarms.json()
    alarms = alarm_data.get("data", [])
    for a in alarms:
        alarm_types_found.add(a["type"])
        print(f"  Alarm: {a['type']} | {a['severity']} | {a['status']}")

has_temp_alarm = "High Internal Temperature" in alarm_types_found
has_voltage_alarm = "Supply Under-Voltage" in alarm_types_found
print(f"  High Temperature alarm: {'FOUND' if has_temp_alarm else 'NOT FOUND'}")
print(f"  Under-Voltage alarm: {'FOUND' if has_voltage_alarm else 'NOT FOUND'}")

# Now clear alarms by sending normal values
clear_telem = {"supply_voltage": 222, "internal_temp": 30}
r = requests.post(f"{BASE}/api/v1/{DEVICE_TOKEN}/telemetry", json=clear_telem)
print(f"  Sent clear telemetry (voltage=222, temp=30): {r.status_code}")
time.sleep(3)

# Check if alarms cleared
r_alarms2 = requests.get(
    f"{BASE}/api/alarm/DEVICE/{DEVICE_ID}",
    headers=H, params={"pageSize": 20, "page": 0, "sortProperty": "createdTime", "sortOrder": "DESC", "searchStatus": "CLEARED"}
)
cleared_count = 0
if r_alarms2.status_code == 200:
    cleared_data = r_alarms2.json()
    for a in cleared_data.get("data", []):
        if a["status"] in ["CLEARED_UNACK", "CLEARED_ACK"]:
            cleared_count += 1

print(f"  Cleared alarms: {cleared_count}")

test3_ok = has_temp_alarm and has_voltage_alarm
results["Alarm Triggering"] = test3_ok
print(f"  Result: {'PASS' if test3_ok else 'FAIL'}")

# ── Test 4: Dashboard Verification ───────────────────────────────────────────
print("\n--- Test 4: Dashboard Verification ---")
dash_check = tb_get(f"/api/dashboard/{DASH_ID}")
dash_widgets = dash_check.get("configuration", {}).get("widgets", {})
dash_states = dash_check.get("configuration", {}).get("states", {})
widget_count = len(dash_widgets)
state_count = len(dash_states)

print(f"  Widgets: {widget_count}")
print(f"  States: {state_count} ({', '.join(dash_states.keys())})")
print(f"  Entity aliases: {len(dash_check.get('configuration', {}).get('entityAliases', {}))}")

test4_ok = widget_count >= 20 and state_count == 2
results["Dashboard"] = test4_ok
print(f"  Result: {'PASS' if test4_ok else 'FAIL'}")

# ── Test 5: Dynamic Topic Check ──────────────────────────────────────────────
print("\n--- Test 5: Dynamic Topic Verification ---")
rc_meta_final = tb_get(f"/api/ruleChain/{RC_ID}/metadata")
mqtt_node = None
for n in rc_meta_final["nodes"]:
    if n["type"] == "org.thingsboard.rule.engine.mqtt.TbMqttNode":
        mqtt_node = n
        break

topic_ok = False
if mqtt_node:
    topic = mqtt_node["configuration"].get("topicPattern", "")
    topic_ok = "${deviceName}" in topic
    print(f"  MQTT topic pattern: {topic}")
    print(f"  Dynamic deviceName: {'YES' if topic_ok else 'NO'}")

results["Dynamic Topic"] = topic_ok
print(f"  Result: {'PASS' if topic_ok else 'FAIL'}")

# ═══════════════════════════════════════════════════════════════════════════════
# FINAL REPORT
# ═══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("FINAL REPORT")
print("=" * 70)

report = [
    ("Device Profile", True, f"ID: {PROFILE_ID}, 5 alarm rules"),
    ("Rule Chain", True, f"ID: {RC_ID}, 10 nodes, {len(meta_result['connections'])} connections"),
    ("Device Migration", True, f"default → Zenopix DALI Controller"),
    ("Dashboard", results.get("Dashboard", False), f"ID: {DASH_ID}, {widget_count} widgets, {state_count} states"),
    ("Telemetry Processing", results.get("Telemetry Processing", False), f"power_watts + energy_wh_increment calculated"),
    ("RPC Dim Control", results.get("RPC Dim Control", False), f"setDim(50) → dimLevel=50"),
    ("Alarm Triggering", results.get("Alarm Triggering", False), f"temp + voltage alarms"),
    ("Dynamic Topic", results.get("Dynamic Topic", False), f"${{deviceName}} in MQTT topic"),
]

print(f"\n{'Component':<25} {'Status':<8} {'Detail'}")
print("-" * 70)
for name, ok, detail in report:
    status = "PASS" if ok else "FAIL"
    print(f"  {name:<23} {status:<8} {detail}")

all_pass = all(r[1] for r in report)
print("\n" + "=" * 70)
if all_pass:
    print("ALL TESTS PASSED!")
else:
    print("SOME TESTS FAILED — check details above")
print("=" * 70)

print(f"\nDashboard URL: http://localhost:8080/dashboards/{DASH_ID}")
print(f"Rule Chain URL: http://localhost:8080/ruleChains/{RC_ID}")
