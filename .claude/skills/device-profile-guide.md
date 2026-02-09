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

## API Endpoint

### Create or Update Device Profile

```
POST ${TB_HOST}/api/deviceProfile
X-Authorization: Bearer ${TB_TOKEN}
Content-Type: application/json
```

**Same endpoint for both create and update.** For updates, include the `id` and `version` fields from the GET response (optimistic locking).

### Get Device Profile

```
GET ${TB_HOST}/api/deviceProfile/${PROFILE_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

### List Device Profiles

```
GET ${TB_HOST}/api/deviceProfiles?pageSize=100&page=0
X-Authorization: Bearer ${TB_TOKEN}
```

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
{
  "type": "DURATION",
  "unit": "MINUTES",
  "predicate": {
    "defaultValue": 5,
    "userValue": null,
    "dynamicValue": null
  }
}
```

Units: `SECONDS`, `MINUTES`, `HOURS`, `DAYS`

#### Repeating Spec

```json
{
  "type": "REPEATING",
  "predicate": {
    "defaultValue": 3,
    "userValue": null,
    "dynamicValue": null
  }
}
```

---

## Alarm Details with Variables

Use `${telemetry_key}` in `alarmDetails` to include the current telemetry value:

```json
"alarmDetails": "Temperature above threshold: ${internal_temp}\u00b0C"
```

```json
"alarmDetails": "CRITICAL: Supply voltage is ${supply_voltage}V (expected 198-253V)"
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
        "condition": [
          {
            "key": {"type": "TIME_SERIES", "key": "internal_temp"},
            "valueType": "NUMERIC",
            "value": null,
            "predicate": {
              "type": "NUMERIC",
              "operation": "GREATER",
              "value": {"defaultValue": 70, "userValue": null, "dynamicValue": null}
            }
          }
        ],
        "spec": {"type": "SIMPLE"}
      },
      "schedule": null,
      "alarmDetails": "Internal temperature is above 70\u00b0C: ${internal_temp}\u00b0C",
      "dashboardId": null
    },
    "CRITICAL": {
      "condition": {
        "condition": [
          {
            "key": {"type": "TIME_SERIES", "key": "internal_temp"},
            "valueType": "NUMERIC",
            "value": null,
            "predicate": {
              "type": "NUMERIC",
              "operation": "GREATER",
              "value": {"defaultValue": 85, "userValue": null, "dynamicValue": null}
            }
          }
        ],
        "spec": {"type": "SIMPLE"}
      },
      "schedule": null,
      "alarmDetails": "CRITICAL: Internal temperature is above 85\u00b0C: ${internal_temp}\u00b0C",
      "dashboardId": null
    }
  },
  "clearRule": {
    "condition": {
      "condition": [
        {
          "key": {"type": "TIME_SERIES", "key": "internal_temp"},
          "valueType": "NUMERIC",
          "value": null,
          "predicate": {
            "type": "NUMERIC",
            "operation": "LESS",
            "value": {"defaultValue": 60, "userValue": null, "dynamicValue": null}
          }
        }
      ],
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
        "condition": [
          {
            "key": {"type": "TIME_SERIES", "key": "fault_light_src_failure"},
            "valueType": "BOOLEAN",
            "value": null,
            "predicate": {
              "type": "BOOLEAN",
              "operation": "EQUAL",
              "value": {"defaultValue": true, "userValue": null, "dynamicValue": null}
            }
          }
        ],
        "spec": {"type": "SIMPLE"}
      },
      "schedule": null,
      "alarmDetails": "Light source failure detected!",
      "dashboardId": null
    }
  },
  "clearRule": {
    "condition": {
      "condition": [
        {
          "key": {"type": "TIME_SERIES", "key": "fault_light_src_failure"},
          "valueType": "BOOLEAN",
          "value": null,
          "predicate": {
            "type": "BOOLEAN",
            "operation": "EQUAL",
            "value": {"defaultValue": false, "userValue": null, "dynamicValue": null}
          }
        }
      ],
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

### Example 3: Range Alarm (Under-Voltage / Over-Voltage)

Two separate alarm rules for under-voltage and over-voltage.

**Under-Voltage:**
```json
{
  "id": "${ALARM_UUID}",
  "alarmType": "Supply Under-Voltage",
  "createRules": {
    "WARNING": {
      "condition": {
        "condition": [{
          "key": {"type": "TIME_SERIES", "key": "supply_voltage"},
          "valueType": "NUMERIC",
          "value": null,
          "predicate": {
            "type": "NUMERIC",
            "operation": "LESS",
            "value": {"defaultValue": 198, "userValue": null, "dynamicValue": null}
          }
        }],
        "spec": {"type": "SIMPLE"}
      },
      "schedule": null,
      "alarmDetails": "Supply voltage below 198V: ${supply_voltage}V",
      "dashboardId": null
    }
  },
  "clearRule": {
    "condition": {
      "condition": [{
        "key": {"type": "TIME_SERIES", "key": "supply_voltage"},
        "valueType": "NUMERIC",
        "value": null,
        "predicate": {
          "type": "NUMERIC",
          "operation": "GREATER",
          "value": {"defaultValue": 205, "userValue": null, "dynamicValue": null}
        }
      }],
      "spec": {"type": "SIMPLE"}
    },
    "schedule": null,
    "alarmDetails": "Supply voltage returned to normal: ${supply_voltage}V",
    "dashboardId": null
  },
  "propagate": false,
  "propagateToOwner": false,
  "propagateToTenant": false,
  "propagateRelationTypes": null
}
```

**Over-Voltage:** Same structure with `GREATER` > 253 trigger and `LESS` < 245 clear.

---

## Critical Requirement: TbDeviceProfileNode

**Alarm rules defined in a device profile are ONLY evaluated when telemetry flows through a `TbDeviceProfileNode` in the device's rule chain.**

Without this node, alarm rules in the profile are completely ignored -- no alarms will be created regardless of telemetry values.

### Adding TbDeviceProfileNode to a Rule Chain

```json
{
  "type": "org.thingsboard.rule.engine.profile.TbDeviceProfileNode",
  "name": "Device Profile Node",
  "debugMode": false,
  "singletonMode": false,
  "queueName": null,
  "configurationVersion": 0,
  "configuration": {
    "persistAlarmRulesState": false,
    "fetchAlarmRulesStateOnStart": false
  }
}
```

### Rule Chain Wiring

The `TbDeviceProfileNode` must be connected from the Message Type Switch via the "Post telemetry" output:

```
[Message Type Switch] --"Post telemetry"--> [Device Profile Node] --"Success"--> [Save Timeseries]
```

The Device Profile Node evaluates alarm rules and then passes the message through. Its "Success" output should connect to Save Timeseries (or whatever node saves the data).

### Configuration Options

| Field | Default | Description |
|-------|---------|-------------|
| `persistAlarmRulesState` | false | Persist alarm state to DB (enables alarm recovery after restart) |
| `fetchAlarmRulesStateOnStart` | false | Load alarm state from DB on startup |

For production, consider setting both to `true` for alarm state persistence across restarts.

---

## Device Migration Between Profiles

To change a device's profile:

### Step 1: GET Current Device

```
GET ${TB_HOST}/api/device/${DEVICE_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

### Step 2: Modify Profile ID

Change the `deviceProfileId.id` to the new profile UUID:

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

### Step 3: POST Updated Device

```
POST ${TB_HOST}/api/device
X-Authorization: Bearer ${TB_TOKEN}
Content-Type: application/json
```

Send the full device object with modified `deviceProfileId`.

### Step 4: Verify

```
GET ${TB_HOST}/api/device/${DEVICE_ID}
X-Authorization: Bearer ${TB_TOKEN}
```

Confirm `deviceProfileId.id` matches the new profile.

**Important:** After migration, the device's telemetry will be processed by the new profile's rule chain. Existing alarms from the old profile will remain until cleared manually.

---

## Creating a Complete Profile via Python

```python
import requests
import uuid
import os

TB_URL = os.environ["TB_URL"]
TOKEN = os.environ["TB_TOKEN"]

headers = {
    "X-Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json"
}

profile = {
    "name": "My Sensor Profile",
    "type": "DEFAULT",
    "transportType": "DEFAULT",
    "description": "Profile for temperature/humidity sensors",
    "defaultRuleChainId": {
        "entityType": "RULE_CHAIN",
        "id": "${RULE_CHAIN_ID}"
    },
    "profileData": {
        "configuration": {"type": "DEFAULT"},
        "transportConfiguration": {"type": "DEFAULT"},
        "provisionConfiguration": {"type": "DISABLED"},
        "alarms": [
            {
                "id": str(uuid.uuid4()),
                "alarmType": "High Temperature",
                "createRules": {
                    "WARNING": {
                        "condition": {
                            "condition": [{
                                "key": {"type": "TIME_SERIES", "key": "temperature"},
                                "valueType": "NUMERIC",
                                "value": None,
                                "predicate": {
                                    "type": "NUMERIC",
                                    "operation": "GREATER",
                                    "value": {"defaultValue": 50, "userValue": None, "dynamicValue": None}
                                }
                            }],
                            "spec": {"type": "SIMPLE"}
                        },
                        "schedule": None,
                        "alarmDetails": "Temperature above 50: ${temperature}",
                        "dashboardId": None
                    }
                },
                "clearRule": {
                    "condition": {
                        "condition": [{
                            "key": {"type": "TIME_SERIES", "key": "temperature"},
                            "valueType": "NUMERIC",
                            "value": None,
                            "predicate": {
                                "type": "NUMERIC",
                                "operation": "LESS",
                                "value": {"defaultValue": 40, "userValue": None, "dynamicValue": None}
                            }
                        }],
                        "spec": {"type": "SIMPLE"}
                    },
                    "schedule": None,
                    "alarmDetails": "Temperature returned to normal: ${temperature}",
                    "dashboardId": None
                },
                "propagate": False,
                "propagateToOwner": False,
                "propagateToTenant": False,
                "propagateRelationTypes": None
            }
        ]
    }
}

resp = requests.post(f"{TB_URL}/api/deviceProfile", json=profile, headers=headers)
resp.raise_for_status()
created = resp.json()
print(f"Created profile: {created['id']['id']}")
```

---

## Updating an Existing Profile (Optimistic Locking)

```python
# Step 1: GET current profile
resp = requests.get(f"{TB_URL}/api/deviceProfile/{PROFILE_ID}", headers=headers)
profile = resp.json()

# Step 2: Modify (e.g., add a new alarm rule)
new_alarm = {
    "id": str(uuid.uuid4()),
    "alarmType": "Low Battery",
    "createRules": {
        "WARNING": {
            "condition": {
                "condition": [{
                    "key": {"type": "TIME_SERIES", "key": "battery"},
                    "valueType": "NUMERIC",
                    "value": None,
                    "predicate": {
                        "type": "NUMERIC",
                        "operation": "LESS",
                        "value": {"defaultValue": 20, "userValue": None, "dynamicValue": None}
                    }
                }],
                "spec": {"type": "SIMPLE"}
            },
            "schedule": None,
            "alarmDetails": "Battery low: ${battery}%",
            "dashboardId": None
        }
    },
    "clearRule": {
        "condition": {
            "condition": [{
                "key": {"type": "TIME_SERIES", "key": "battery"},
                "valueType": "NUMERIC",
                "value": None,
                "predicate": {
                    "type": "NUMERIC",
                    "operation": "GREATER",
                    "value": {"defaultValue": 30, "userValue": None, "dynamicValue": None}
                }
            }],
            "spec": {"type": "SIMPLE"}
        },
        "schedule": None,
        "alarmDetails": "Battery recovered: ${battery}%",
        "dashboardId": None
    },
    "propagate": False,
    "propagateToOwner": False,
    "propagateToTenant": False,
    "propagateRelationTypes": None
}

profile["profileData"]["alarms"].append(new_alarm)

# Step 3: POST back (include version for optimistic locking)
resp = requests.post(f"{TB_URL}/api/deviceProfile", json=profile, headers=headers)
if resp.status_code == 409:
    print("Optimistic lock conflict -- re-GET and retry")
else:
    resp.raise_for_status()
    print("Profile updated successfully")
```

---

## Multiple Conditions in One Alarm Rule

Combine multiple conditions with AND logic (all must be true):

```json
{
  "condition": {
    "condition": [
      {
        "key": {"type": "TIME_SERIES", "key": "temperature"},
        "valueType": "NUMERIC",
        "value": null,
        "predicate": {
          "type": "NUMERIC",
          "operation": "GREATER",
          "value": {"defaultValue": 50, "userValue": null, "dynamicValue": null}
        }
      },
      {
        "key": {"type": "TIME_SERIES", "key": "humidity"},
        "valueType": "NUMERIC",
        "value": null,
        "predicate": {
          "type": "NUMERIC",
          "operation": "GREATER",
          "value": {"defaultValue": 80, "userValue": null, "dynamicValue": null}
        }
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

1. **Missing TbDeviceProfileNode** -- verify the device's rule chain contains this node and it is wired to receive "Post telemetry" messages
2. **Wrong rule chain** -- the device profile's `defaultRuleChainId` must point to the rule chain that has the TbDeviceProfileNode
3. **Telemetry key mismatch** -- the `key` in alarm condition must exactly match the telemetry key name
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

- Device profile skeleton: See the examples above (no separate template file yet)
- Rule chain skeleton (with TbDeviceProfileNode): `/opt/thingsboard/.claude/templates/rule_chain_skeleton.json`
- Dashboard skeleton: `/opt/thingsboard/.claude/templates/dashboard_skeleton.json`
