<!-- Last updated: 2026-02-09 -->
<!-- Sources: Device profile source code, ThingsBoard docs -->

# Device Profile and Alarm Configuration Guide

Complete guide for creating and managing device profiles with alarm rules in ThingsBoard CE v4.4.0-SNAPSHOT.

## Overview

A device profile defines:
- **Default rule chain** -- which rule chain processes messages from devices of this profile
- **Transport configuration** -- protocol settings (DEFAULT, MQTT, CoAP, LwM2M, SNMP)
- **Alarm rules** -- conditions that trigger/clear alarms based on telemetry
- **Provision configuration** -- auto-provisioning settings (DISABLED in CE typically)

---

## Profile JSON Structure

```json
{
  "name": "Profile Name",
  "type": "DEFAULT",
  "transportType": "DEFAULT",
  "description": "Human-readable description",
  "defaultRuleChainId": {
    "entityType": "RULE_CHAIN",
    "id": "${RULE_CHAIN_ID}"
  },
  "defaultDashboardId": null,
  "defaultQueueName": null,
  "provisionType": "DISABLED",
  "profileData": {
    "configuration": {
      "type": "DEFAULT"
    },
    "transportConfiguration": {
      "type": "DEFAULT"
    },
    "provisionConfiguration": {
      "type": "DISABLED",
      "provisionDeviceSecret": null
    },
    "alarms": [
      // Alarm rules go here -- see sections below
    ]
  }
}
```

### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Profile name (must be unique per tenant) |
| `type` | string | Always "DEFAULT" for standard devices |
| `transportType` | string | "DEFAULT", "MQTT", "COAP", "LWM2M", "SNMP" |
| `defaultRuleChainId` | object | Rule chain for devices of this profile (null = root chain) |
| `defaultDashboardId` | object | Auto-assigned dashboard (optional) |
| `provisionType` | string | "DISABLED", "ALLOW_CREATE_NEW_DEVICES", "CHECK_PRE_PROVISIONED_DEVICES" |
| `profileData.alarms` | array | Alarm rule definitions |

---

## API Endpoints

```
POST ${TB_HOST}/api/deviceProfile              # Create or update (include id+version for update)
GET  ${TB_HOST}/api/deviceProfile/${PROFILE_ID} # Get by ID
GET  ${TB_HOST}/api/deviceProfiles?pageSize=100&page=0  # List all
```

**Same endpoint for both create and update.** For updates, include the `id` and `version` fields from the GET response (optimistic locking).

---

## Alarm Rule Structure

Each alarm rule in the `profileData.alarms` array has this structure:

```json
{
  "id": "${ALARM_RULE_UUID}",
  "alarmType": "Human Readable Alarm Name",
  "createRules": {
    "WARNING": { ... condition ... },
    "CRITICAL": { ... condition ... }
  },
  "clearRule": { ... condition ... },
  "propagate": false,
  "propagateToOwner": false,
  "propagateToTenant": false,
  "propagateRelationTypes": null
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique alarm rule identifier (generate with uuid4) |
| `alarmType` | string | Alarm type name shown in alarm table |
| `createRules` | object | Map of severity to trigger condition |
| `clearRule` | object | Condition to clear/resolve the alarm |
| `propagate` | boolean | Propagate alarm to related entities |
| `propagateToOwner` | boolean | Propagate alarm to owner entity |
| `propagateToTenant` | boolean | Propagate alarm to tenant |

### Severity Levels

Severities for `createRules` keys (highest to lowest):
1. `CRITICAL`
2. `MAJOR`
3. `MINOR`
4. `WARNING`
5. `INDETERMINATE`

---

## Alarm Condition Format

Each severity in `createRules` and the `clearRule` uses this format:

```json
{
  "condition": {
    "condition": [
      {
        "key": {
          "type": "TIME_SERIES",
          "key": "telemetry_key_name"
        },
        "valueType": "NUMERIC",
        "value": null,
        "predicate": {
          "type": "NUMERIC",
          "operation": "GREATER",
          "value": {
            "defaultValue": 70,
            "userValue": null,
            "dynamicValue": null
          }
        }
      }
    ],
    "spec": {
      "type": "SIMPLE"
    }
  },
  "schedule": null,
  "alarmDetails": "Temperature above threshold: ${internal_temp}\u00b0C",
  "dashboardId": null
}
```

### Key Types

| Key Type | Description |
|----------|-------------|
| `TIME_SERIES` | Telemetry key |
| `ATTRIBUTE` | Device attribute |
| `CONSTANT` | Fixed value (for comparisons) |

### Value Types

| Value Type | Predicate Type | Available Operations |
|-----------|---------------|---------------------|
| `NUMERIC` | `NUMERIC` | GREATER, LESS, EQUAL, NOT_EQUAL, GREATER_OR_EQUAL, LESS_OR_EQUAL |
| `BOOLEAN` | `BOOLEAN` | EQUAL |
| `STRING` | `STRING` | STARTS_WITH, ENDS_WITH, CONTAINS, NOT_CONTAINS, EQUAL, NOT_EQUAL |

### Condition Spec Types

| Spec Type | Description |
|-----------|-------------|
| `SIMPLE` | Triggers immediately when condition is met |
| `DURATION` | Condition must hold for a specified duration |
| `REPEATING` | Condition must occur N times |

#### Duration Spec

```json
{"type": "DURATION", "unit": "MINUTES", "predicate": {"defaultValue": 5, "userValue": null, "dynamicValue": null}}
```

Units: `SECONDS`, `MINUTES`, `HOURS`, `DAYS`

#### Repeating Spec

```json
{"type": "REPEATING", "predicate": {"defaultValue": 3, "userValue": null, "dynamicValue": null}}
```

Use `REPEATING` spec to require a condition be met N times before triggering. This is also useful for OR logic: define multiple `createRules` severity entries where each uses a different condition -- the first severity whose condition fires will create the alarm.

---

## Dynamic Thresholds

Instead of hardcoding threshold values, use `dynamicValue` to read thresholds from device or tenant attributes. This allows per-device alarm customization without changing the profile.

```json
"predicate": {
  "type": "NUMERIC",
  "operation": "GREATER",
  "value": {
    "defaultValue": 70,
    "userValue": null,
    "dynamicValue": {
      "sourceType": "CURRENT_DEVICE",
      "sourceAttribute": "temperatureThreshold",
      "inherit": true
    }
  }
}
```

- `sourceType`: `CURRENT_DEVICE` or `CURRENT_TENANT`
- `sourceAttribute`: name of the server-side attribute holding the threshold
- `inherit`: if `true` and the attribute is not found on the device, look up the hierarchy (customer, then tenant)
- `defaultValue` is used as fallback when the attribute does not exist

---

## Schedule Config for Alarms

The `schedule` field in each alarm rule severity controls when the alarm is active. Set to `null` for always-on.

```json
"schedule": {
  "type": "SPECIFIC_TIME",
  "timezone": "America/New_York",
  "daysOfWeek": [1, 2, 3, 4, 5],
  "startsOn": 32400000,
  "endsOn": 64800000
}
```

- **`ANY_TIME`** (or `null`): alarm is always active
- **`SPECIFIC_TIME`**: active during specified hours/days. `startsOn`/`endsOn` are milliseconds from midnight (e.g., 32400000 = 9:00 AM, 64800000 = 6:00 PM). `daysOfWeek`: 1=Mon through 7=Sun.
- **`CUSTOM`**: array of per-day time ranges with `enablingFilter`

---

## OR Logic in Alarm Conditions

Multiple entries in the `condition` array use AND logic (all must be true). For OR logic, use separate severity levels or separate alarm rules:

- **Separate alarm rules**: define two alarm rules with different `alarmType` values, each with its own condition
- **Multiple severities**: use WARNING for condition A and CRITICAL for condition B -- whichever fires first creates the alarm at that severity

For count-based OR, use `REPEATING` spec: if telemetry matches condition A or condition B at least N times, the alarm triggers.

---

## Alarm Details with Variables

Use `${telemetry_key}` in `alarmDetails` to include the current telemetry value:

```json
"alarmDetails": "Temperature above threshold: ${internal_temp}\u00b0C"
```

Variables are resolved at alarm creation time using the current message payload.

---

## Complete Examples

### Example 1: NUMERIC Alarm with Multi-Severity Escalation

Temperature alarm: WARNING above 70, CRITICAL above 85, clears below 60.

```json
{
  "id": "${ALARM_UUID}",
  "alarmType": "High Internal Temperature",
  "createRules": {
    "WARNING": {
      "condition": {
        "condition": [{
          "key": {"type": "TIME_SERIES", "key": "internal_temp"},
          "valueType": "NUMERIC",
          "value": null,
          "predicate": {
            "type": "NUMERIC",
            "operation": "GREATER",
            "value": {"defaultValue": 70, "userValue": null, "dynamicValue": null}
          }
        }],
        "spec": {"type": "SIMPLE"}
      },
      "schedule": null,
      "alarmDetails": "Internal temperature is above 70\u00b0C: ${internal_temp}\u00b0C",
      "dashboardId": null
    },
    "CRITICAL": {
      "condition": {
        "condition": [{
          "key": {"type": "TIME_SERIES", "key": "internal_temp"},
          "valueType": "NUMERIC",
          "value": null,
          "predicate": {
            "type": "NUMERIC",
            "operation": "GREATER",
            "value": {"defaultValue": 85, "userValue": null, "dynamicValue": null}
          }
        }],
        "spec": {"type": "SIMPLE"}
      },
      "schedule": null,
      "alarmDetails": "CRITICAL: Internal temperature is above 85\u00b0C: ${internal_temp}\u00b0C",
      "dashboardId": null
    }
  },
  "clearRule": {
    "condition": {
      "condition": [{
        "key": {"type": "TIME_SERIES", "key": "internal_temp"},
        "valueType": "NUMERIC",
        "value": null,
        "predicate": {
          "type": "NUMERIC",
          "operation": "LESS",
          "value": {"defaultValue": 60, "userValue": null, "dynamicValue": null}
        }
      }],
      "spec": {"type": "SIMPLE"}
    },
    "schedule": null,
    "alarmDetails": "Temperature returned to normal: ${internal_temp}\u00b0C",
    "dashboardId": null
  },
  "propagate": false,
  "propagateToOwner": false,
  "propagateToTenant": false,
  "propagateRelationTypes": null
}
```

**Behavior:**
- When `internal_temp > 70`: WARNING alarm created
- When `internal_temp > 85`: Alarm severity escalates to CRITICAL
- When `internal_temp < 60`: Alarm is cleared (with hysteresis -- note the gap between 70 trigger and 60 clear)
- Alarm persists between 60-70 (not cleared, not re-triggered)

### Example 2: BOOLEAN Alarm

Fault detection based on a boolean telemetry key.

```json
{
  "id": "${ALARM_UUID}",
  "alarmType": "Light Source Failure",
  "createRules": {
    "CRITICAL": {
      "condition": {
        "condition": [{
          "key": {"type": "TIME_SERIES", "key": "fault_light_src_failure"},
          "valueType": "BOOLEAN",
          "value": null,
          "predicate": {
            "type": "BOOLEAN",
            "operation": "EQUAL",
            "value": {"defaultValue": true, "userValue": null, "dynamicValue": null}
          }
        }],
        "spec": {"type": "SIMPLE"}
      },
      "schedule": null,
      "alarmDetails": "Light source failure detected!",
      "dashboardId": null
    }
  },
  "clearRule": {
    "condition": {
      "condition": [{
        "key": {"type": "TIME_SERIES", "key": "fault_light_src_failure"},
        "valueType": "BOOLEAN",
        "value": null,
        "predicate": {
          "type": "BOOLEAN",
          "operation": "EQUAL",
          "value": {"defaultValue": false, "userValue": null, "dynamicValue": null}
        }
      }],
      "spec": {"type": "SIMPLE"}
    },
    "schedule": null,
    "alarmDetails": "Light source failure cleared",
    "dashboardId": null
  },
  "propagate": false,
  "propagateToOwner": false,
  "propagateToTenant": false,
  "propagateRelationTypes": null
}
```

---

## Critical Requirement: TbDeviceProfileNode

**Alarm rules defined in a device profile are ONLY evaluated when telemetry flows through a `TbDeviceProfileNode` in the device's rule chain.**

Without this node, alarm rules in the profile are completely ignored -- no alarms will be created regardless of telemetry values.

### Adding TbDeviceProfileNode to a Rule Chain

```json
{
  "type": "org.thingsboard.rule.engine.profile.TbDeviceProfileNode",
  "name": "Device Profile Node",
  "configuration": {
    "persistAlarmRulesState": false,
    "fetchAlarmRulesStateOnStart": false
  }
}
```

### Rule Chain Wiring

```
[Message Type Switch] --"Post telemetry"--> [Device Profile Node] --"Success"--> [Save Timeseries]
```

The Device Profile Node evaluates alarm rules and then passes the message through.

| Field | Default | Description |
|-------|---------|-------------|
| `persistAlarmRulesState` | false | Persist alarm state to DB (enables alarm recovery after restart) |
| `fetchAlarmRulesStateOnStart` | false | Load alarm state from DB on startup |

For production, consider setting both to `true` for alarm state persistence across restarts.

---

## Device Migration Between Profiles

To change a device's profile, GET the device, modify `deviceProfileId.id`, and POST it back:

```
GET  ${TB_HOST}/api/device/${DEVICE_ID}
```

Modify the profile reference:

```json
{
  "id": {"entityType": "DEVICE", "id": "${DEVICE_ID}"},
  "name": "my-device",
  "deviceProfileId": {
    "entityType": "DEVICE_PROFILE",
    "id": "${NEW_PROFILE_ID}"
  },
  "version": 3
}
```

```
POST ${TB_HOST}/api/device
X-Authorization: Bearer ${TB_TOKEN}
Content-Type: application/json
```

**Important:** After migration, existing alarms from the old profile remain until cleared manually.

---

## Creating and Updating Profiles via Python

```python
import requests, uuid, os

TB_URL = os.environ["TB_URL"]
headers = {"X-Authorization": f"Bearer {os.environ['TB_TOKEN']}", "Content-Type": "application/json"}

def make_alarm(alarm_type, key, op, threshold, clear_op, clear_threshold, severity="WARNING"):
    """Helper to build an alarm rule dict."""
    def _cond(operation, value):
        return {"condition": {"condition": [{"key": {"type": "TIME_SERIES", "key": key},
            "valueType": "NUMERIC", "value": None, "predicate": {"type": "NUMERIC",
            "operation": operation, "value": {"defaultValue": value, "userValue": None,
            "dynamicValue": None}}}], "spec": {"type": "SIMPLE"}},
            "schedule": None, "alarmDetails": f"{alarm_type}: ${{{key}}}", "dashboardId": None}
    return {"id": str(uuid.uuid4()), "alarmType": alarm_type,
        "createRules": {severity: _cond(op, threshold)}, "clearRule": _cond(clear_op, clear_threshold),
        "propagate": False, "propagateToOwner": False, "propagateToTenant": False,
        "propagateRelationTypes": None}

# Create a new profile
profile = {
    "name": "My Sensor Profile", "type": "DEFAULT", "transportType": "DEFAULT",
    "description": "Profile for temperature/humidity sensors",
    "defaultRuleChainId": {"entityType": "RULE_CHAIN", "id": "${RULE_CHAIN_ID}"},
    "profileData": {
        "configuration": {"type": "DEFAULT"}, "transportConfiguration": {"type": "DEFAULT"},
        "provisionConfiguration": {"type": "DISABLED"},
        "alarms": [make_alarm("High Temperature", "temperature", "GREATER", 50, "LESS", 40)]
    }
}
resp = requests.post(f"{TB_URL}/api/deviceProfile", json=profile, headers=headers)
resp.raise_for_status()
created = resp.json()
print(f"Created profile: {created['id']['id']}")

# Update an existing profile (optimistic locking)
profile = requests.get(f"{TB_URL}/api/deviceProfile/{created['id']['id']}", headers=headers).json()
profile["profileData"]["alarms"].append(make_alarm("Low Battery", "battery", "LESS", 20, "GREATER", 30))
resp = requests.post(f"{TB_URL}/api/deviceProfile", json=profile, headers=headers)
if resp.status_code == 409:
    print("Optimistic lock conflict -- re-GET and retry")
else:
    resp.raise_for_status()
    print("Profile updated successfully")
```

---

## Multiple Conditions (AND Logic)

Combine multiple conditions in one alarm rule -- all must be true (AND logic):

```json
{
  "condition": {
    "condition": [
      {
        "key": {"type": "TIME_SERIES", "key": "temperature"},
        "valueType": "NUMERIC", "value": null,
        "predicate": {"type": "NUMERIC", "operation": "GREATER",
          "value": {"defaultValue": 50, "userValue": null, "dynamicValue": null}}
      },
      {
        "key": {"type": "TIME_SERIES", "key": "humidity"},
        "valueType": "NUMERIC", "value": null,
        "predicate": {"type": "NUMERIC", "operation": "GREATER",
          "value": {"defaultValue": 80, "userValue": null, "dynamicValue": null}}
      }
    ],
    "spec": {"type": "SIMPLE"}
  }
}
```

This triggers only when BOTH temperature > 50 AND humidity > 80.

---

## Troubleshooting

### Alarms Not Triggering

1. **Missing TbDeviceProfileNode** -- verify the device's rule chain contains this node wired to "Post telemetry"
2. **Wrong rule chain** -- `defaultRuleChainId` must point to the chain with TbDeviceProfileNode
3. **Telemetry key mismatch** -- `key` in alarm condition must exactly match the telemetry key name
4. **Data type mismatch** -- NUMERIC conditions require numeric telemetry values (not strings)

### Alarms Not Clearing

1. Verify the `clearRule` condition is met by the incoming telemetry
2. Check hysteresis values -- clear threshold should be safely below/above the trigger threshold
3. Send explicit telemetry that satisfies the clear condition

### Debug Approach

1. Enable debug mode on the TbDeviceProfileNode
2. Send test telemetry: `POST /api/v1/${DEVICE_TOKEN}/telemetry` with `{"internal_temp": 75}`
3. Check the Events tab on the Device Profile Node for alarm evaluation results

---

## Template Reference

- Device profile skeleton: See the examples above
- Rule chain skeleton (with TbDeviceProfileNode): `/opt/thingsboard/.claude/templates/rule_chain_skeleton.json`
- Dashboard skeleton: `/opt/thingsboard/.claude/templates/dashboard_skeleton.json`
