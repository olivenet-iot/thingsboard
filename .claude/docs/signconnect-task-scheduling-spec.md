# SignConnect — Zenosmart Task Scheduling Specification

## Overview

The Zenosmart LCCBXLXXXXDXXXX LoRaWAN lighting controller supports automated dimming schedules through a **Task Scheduling** system. Tasks define when and how lights should operate — including sunrise/sunset-aware automation. This document covers the complete task system for building a ThingsBoard management dashboard.

## Architecture

```
┌──────────────────────────────────────────────────┐
│                TASK SYSTEM                         │
│                                                    │
│  20 Task Slots (index 0-19)                        │
│  ┌──────────────────────────────────┐              │
│  │ Task Slot 0                       │              │
│  │  ├─ Profile ID: 1                │              │
│  │  ├─ Date Range: Feb 10 → forever │              │
│  │  ├─ Priority: 1                  │              │
│  │  ├─ Cyclic: Custom (every day)   │              │
│  │  ├─ Channel: 1 (Dim Value)       │              │
│  │  └─ Time Slots (max 4):         │              │
│  │      ├─ Slot 1: sunset→23:00 @100% │           │
│  │      ├─ Slot 2: 23:00→05:00 @50%   │           │
│  │      ├─ Slot 3: 05:00→sunrise @100% │           │
│  │      └─ Slot 4: sunrise→sunrise+1 @0% │         │
│  └──────────────────────────────────┘              │
│  ┌──────────────────────────────────┐              │
│  │ Task Slot 1                       │              │
│  │  └─ (empty or another profile)    │              │
│  └──────────────────────────────────┘              │
│  ... up to Task Slot 19                            │
└──────────────────────────────────────────────────┘
```

## Key Concepts

### Task vs Live Control

| Feature | Live Control | Task Scheduling |
|---------|-------------|-----------------|
| Execution | Instant, temporary | Scheduled, persistent |
| Survives reboot | No | Yes (stored in device) |
| Reflected in sensor data | Delayed/inconsistent | Yes (DALI bus) |
| Sunrise/sunset aware | No | Yes |
| Use case | Manual override, testing | Production automation |
| OpCode | 0x04 | 0x06 |

### Task Capacity
- **20 task slots** (index 0-19) stored in device memory
- Each task has **up to 4 time slots** (dimming periods within a day)
- Tasks persist in device memory until deleted or Clear All is issued
- Tasks are lost on rejoin (device requests Device Setup + Location Setup again)

### Priority System
- Range: **1-5** (1 = highest priority)
- When multiple tasks are active at the same time, highest priority wins
- Use case: override normal schedule on special dates (holidays, events)

### Location Dependency
Tasks using sunrise/sunset require Location Setup to be configured first. The device calculates sunrise/sunset times from GPS coordinates (latitude, longitude, timezone).

Location Setup must be sent BEFORE deploying sunrise/sunset tasks:
```json
{
  "command": "location_setup",
  "latitude": 35.19,
  "longitude": 33.36,
  "timezone": 3.0
}
```

## Data Structures

### Task Object

| Field | Bytes | Type | Range | Description |
|-------|-------|------|-------|-------------|
| operation_type | 1 | byte | 1-3 | 1=Deploy (new), 2=Update (existing), 3=Delete |
| profile_id | 4 | int32 LE | any | Unique task identifier |
| start_year | 1 | byte | 0-99 | Year - 2000 (e.g., 26 = 2026) |
| start_month | 1 | byte | 1-12 | Start month |
| start_day | 1 | byte | 1-31 | Start day |
| end_year | 1 | byte | 0-99 | 99 = forever |
| end_month | 1 | byte | 0-99 | 99 = forever |
| end_day | 1 | byte | 0-99 | 99 = forever |
| priority | 1 | byte | 1-5 | 1 = highest |
| cyclic_type | 1 | byte | 2-5 | See Cyclic Types below |
| cyclic_time | 1 | byte | 0-255 | Used with cyclic_type=4 (every N days) |
| off_days_mask | 1 | byte | 0-127 | Bitmask for days OFF |
| channel_number | 1 | byte | 1-17 | DALI channel (1 = Dim Value) |
| time_slots | 28 | 4×7 | — | 4 time slot definitions |

**Total downlink size: 2 (header) + 44 (data) = 46 bytes**

### Cyclic Types

| Value | Name | Description | Uses cyclic_time | Uses off_days_mask |
|-------|------|-------------|------------------|--------------------|
| 2 | Odd Days | Active on odd calendar days (1st, 3rd, 5th...) | No | No |
| 3 | Even Days | Active on even calendar days (2nd, 4th, 6th...) | No | No |
| 4 | Cyclic | Active every N days | Yes (N) | No |
| 5 | Custom | Active every day, with optional off days | No | Yes |

**Recommended for most use cases: Custom (5) with off_days_mask=0 (all days active)**

### Off Days Mask (Bitmask)

| Bit | Day | Value |
|-----|-----|-------|
| 0 | Sunday | 1 |
| 1 | Monday | 2 |
| 2 | Tuesday | 4 |
| 3 | Wednesday | 8 |
| 4 | Thursday | 16 |
| 5 | Friday | 32 |
| 6 | Saturday | 64 |

Examples:
- `0` = Active every day
- `65` (1+64) = Off on Sunday and Saturday (weekday only)
- `62` (2+4+8+16+32) = Off on weekdays (weekend only)
- `127` = Off every day (task effectively disabled)

### Time Slot Structure

Each time slot defines a dimming period within a single day.

| Field | Bytes | Type | Range | Description |
|-------|-------|------|-------|-------------|
| on_hour | 1 | byte | 0-23, 61, 62 | Start hour (61=sunrise, 62=sunset) |
| on_minute | 1 | byte | 0-59, 61, 62 | Start minute (61=sunrise, 62=sunset) |
| on_offset | 1 | signed byte | -60 to +60 | Minutes offset from sunrise/sunset (only for events) |
| off_hour | 1 | byte | 0-23, 61, 62 | End hour (61=sunrise, 62=sunset) |
| off_minute | 1 | byte | 0-59, 61, 62 | End minute (61=sunrise, 62=sunset) |
| off_offset | 1 | signed byte | -60 to +60 | Minutes offset from sunrise/sunset (only for events) |
| dim_value | 1 | byte | 0-100 | Brightness percentage |

**Special hour/minute values:**
- `61` = Sunrise (calculated from Location Setup GPS coordinates)
- `62` = Sunset (calculated from Location Setup GPS coordinates)
- When using sunrise/sunset, **both hour AND minute must be set to 61 or 62**
- Offset is added to the calculated sunrise/sunset time (e.g., sunset + 15min = offset 15)
- Offset range: -60 to +60 minutes
- For fixed times (0-23), offset is ignored (set to 0)

**Empty slot:** All 7 bytes = 0x00

## LoRaWAN Protocol

### Downlink Commands (fPort: 8)

#### Deploy / Update Task

```
Header: 0x86 0x2C (OpCode=6, Type=1/SET, DataLength=44)
Body:   [operation_type(1)] [profile_id(4)] [start_date(3)] [end_date(3)]
        [priority(1)] [cyclic_type(1)] [cyclic_time(1)] [off_days_mask(1)]
        [channel_number(1)] [time_slots(28)]
Total:  46 bytes
```

#### Delete Task

Same structure as Deploy but with `operation_type = 3`. The device will remove the task matching the `profile_id`.

#### Task Request (Query)

```
Header: 0x06 0x01 (OpCode=6, Type=0/GET, DataLength=1)
Body:   [task_index(1)]
Total:  3 bytes
```

Queries what task is stored at the given index (0-19).

### Uplink Responses (fPort: 6)

#### Task Deployment Response (OpCode 0x87)

Sent by device after receiving a Deploy/Update/Delete command.

```
Header: 0x87 [dataLength]
Body:   [status(1)] [operation(1)] [profile_id(4)] [channel(1)]
        [year(1)] [month(1)] [day(1)] [hour(1)] [minute(1)]
Total:  14 bytes
```

| Field | Values |
|-------|--------|
| status | 0 = PASS, 1 = FAIL |
| operation | 1 = deploy, 2 = update, 3 = delete |
| profile_id | Echoed profile ID |
| channel | Echoed channel number |
| timestamp | Device internal time when processed |

#### Task Set Response (OpCode 0x86)

Sent by device in response to a Task Request query. Contains the full task configuration stored at the requested index.

```
Header: 0x86 [dataLength]
Body:   [program_index(1)] [operation_type(1)] [profile_id(4)]
        [start_date(3)] [end_date(3)]
        [priority(1)] [cyclic_type(1)] [cyclic_time(1)]
        [off_days_mask(1)] [channel_number(1)]
        [time_slots(28)]
Total:  47 bytes
```

## JSON Command Examples

### Deploy: Simple Night Schedule

```json
{
  "command": "send_task",
  "operation_type": 1,
  "profile_id": 1,
  "start_year": 2026,
  "start_month": 2,
  "start_day": 10,
  "end_forever": true,
  "priority": 1,
  "cyclic_type": 5,
  "cyclic_time": 0,
  "off_days_mask": 0,
  "channel_number": 1,
  "time_slots": [
    {
      "on_event": "sunset",
      "on_offset": 0,
      "off_hour": 23,
      "off_minute": 0,
      "dim_value": 100
    },
    {
      "on_hour": 23,
      "on_minute": 0,
      "off_event": "sunrise",
      "off_offset": 0,
      "dim_value": 50
    }
  ]
}
```

### Deploy: Full 4-Slot Night Profile

```json
{
  "command": "send_task",
  "operation_type": 1,
  "profile_id": 100,
  "start_year": 2026,
  "start_month": 1,
  "start_day": 1,
  "end_forever": true,
  "priority": 2,
  "cyclic_type": 5,
  "cyclic_time": 0,
  "off_days_mask": 0,
  "channel_number": 1,
  "time_slots": [
    {
      "on_event": "sunset",
      "on_offset": -15,
      "off_hour": 22,
      "off_minute": 0,
      "dim_value": 100
    },
    {
      "on_hour": 22,
      "on_minute": 0,
      "off_hour": 4,
      "off_minute": 0,
      "dim_value": 40
    },
    {
      "on_hour": 4,
      "on_minute": 0,
      "off_event": "sunrise",
      "off_offset": 15,
      "dim_value": 80
    },
    {
      "on_event": "sunrise",
      "on_offset": 15,
      "off_event": "sunrise",
      "off_offset": 16,
      "dim_value": 0
    }
  ]
}
```

### Deploy: Weekday-Only Schedule

```json
{
  "command": "send_task",
  "operation_type": 1,
  "profile_id": 2,
  "start_year": 2026,
  "start_month": 2,
  "start_day": 10,
  "end_forever": true,
  "priority": 2,
  "cyclic_type": 5,
  "cyclic_time": 0,
  "off_days_mask": 65,
  "channel_number": 1,
  "time_slots": [
    {
      "on_event": "sunset",
      "on_offset": 0,
      "off_event": "sunrise",
      "off_offset": 0,
      "dim_value": 100
    }
  ]
}
```

### Deploy: High-Priority Holiday Override

```json
{
  "command": "send_task",
  "operation_type": 1,
  "profile_id": 50,
  "start_year": 2026,
  "start_month": 10,
  "start_day": 29,
  "end_year": 2026,
  "end_month": 10,
  "end_day": 30,
  "end_forever": false,
  "priority": 1,
  "cyclic_type": 5,
  "cyclic_time": 0,
  "off_days_mask": 0,
  "channel_number": 1,
  "time_slots": [
    {
      "on_event": "sunset",
      "on_offset": 0,
      "off_event": "sunrise",
      "off_offset": 0,
      "dim_value": 100
    }
  ]
}
```

### Deploy: Fixed Time Test (no sunrise/sunset)

```json
{
  "command": "send_task",
  "operation_type": 1,
  "profile_id": 999,
  "start_year": 2026,
  "start_month": 2,
  "start_day": 10,
  "end_forever": true,
  "priority": 1,
  "cyclic_type": 5,
  "cyclic_time": 0,
  "off_days_mask": 0,
  "channel_number": 1,
  "time_slots": [
    {
      "on_hour": 18,
      "on_minute": 0,
      "off_hour": 6,
      "off_minute": 0,
      "dim_value": 75
    }
  ]
}
```

### Update Existing Task

```json
{
  "command": "send_task",
  "operation_type": 2,
  "profile_id": 1,
  "start_year": 2026,
  "start_month": 3,
  "start_day": 1,
  "end_forever": true,
  "priority": 1,
  "cyclic_type": 5,
  "cyclic_time": 0,
  "off_days_mask": 0,
  "channel_number": 1,
  "time_slots": [
    {
      "on_event": "sunset",
      "on_offset": 0,
      "off_event": "sunrise",
      "off_offset": 0,
      "dim_value": 80
    }
  ]
}
```

### Delete Task

```json
{
  "command": "send_task",
  "operation_type": 3,
  "profile_id": 1,
  "start_year": 2026,
  "start_month": 1,
  "start_day": 1,
  "end_forever": true,
  "priority": 1,
  "cyclic_type": 5,
  "cyclic_time": 0,
  "off_days_mask": 0,
  "channel_number": 1,
  "time_slots": []
}
```

### Query Task at Index

```json
{
  "command": "task_request",
  "task_index": 0
}
```

## ThingsBoard Dashboard Requirements

### Task Management UI

The dashboard should allow users to:

1. **View Active Tasks** — Query all 20 task slots and display active tasks in a list/table
2. **Create New Task** — Form with all fields, deploy to device
3. **Edit Existing Task** — Modify and send update command
4. **Delete Task** — Remove task from device
5. **Live Override** — Send instant dim command (Live Control) that overrides current task temporarily

### Recommended Dashboard Widgets

#### Task List Table
| Column | Source |
|--------|--------|
| Slot Index | 0-19 |
| Profile ID | From task query response |
| Status | Active/Inactive based on date range |
| Priority | 1-5 |
| Date Range | Start → End |
| Schedule | Visual summary of time slots |
| Actions | Edit / Delete buttons |

#### Task Creation Form Fields

**Basic:**
- Profile ID (number input)
- Date Range (date pickers, "forever" checkbox for end)
- Priority (dropdown 1-5)

**Schedule Type:**
- Cyclic Type (dropdown: Custom/Odd Days/Even Days/Cyclic)
- Off Days (checkboxes for each day of week, visible when Custom)
- Cyclic Interval (number input, visible when Cyclic type=4)

**Time Slots (repeatable, max 4):**
- On Time Type (dropdown: Fixed Time / Sunrise / Sunset)
- On Time (time picker, visible for Fixed Time)
- On Offset (slider -60 to +60 min, visible for Sunrise/Sunset)
- Off Time Type (dropdown: Fixed Time / Sunrise / Sunset)
- Off Time (time picker, visible for Fixed Time)
- Off Offset (slider -60 to +60 min, visible for Sunrise/Sunset)
- Dim Value (slider 0-100%)

**Channel:**
- Channel Number (usually fixed at 1 for Dim Value)

#### Visual Schedule Timeline
A 24-hour timeline showing:
- Time slots as colored bars
- Sunrise/sunset markers (calculated from device location)
- Dim values shown as bar height or color intensity
- Multiple tasks overlaid with priority indication

### Downlink Integration

ThingsBoard sends downlinks via TTS integration. The flow:

```
ThingsBoard Dashboard
  → User creates/edits task
  → ThingsBoard RPC call or Rule Engine
  → TTS MQTT/HTTP downlink API
  → TTS queues downlink (fPort 8)
  → Device receives in RX1 window after next uplink
  → Device sends Task Response (fPort 6, OpCode 0x87)
  → TTS forwards to ThingsBoard
  → Dashboard updates task status (PASS/FAIL)
```

### Important Operational Notes

1. **Rejoin resets tasks** — When device rejoins the network, all tasks are lost. The system must re-deploy tasks after detecting a rejoin (indicated by device_setup_request on fPort 6).

2. **Task deployment is NOT instant** — Device processes commands with delay due to firmware timing issue (internal clock runs at half speed). Expect 2-4 real minutes before task takes effect.

3. **Confirmation flow** — After deploying a task, wait for Task Response (OpCode 0x87) with status=PASS before considering it active. If FAIL, retry.

4. **Location must be set first** — Sunrise/sunset tasks won't work without Location Setup. Dashboard should enforce this.

5. **8500 heartbeat** — Device sends empty sensor payload (0x8500) alternating with full data. Dashboard should ignore these.

6. **Sensor data delay** — The dim_value in sensor data reflects the actual DALI bus state but is subject to timestamp drift. Use the payload's internal timestamp, not the uplink receive time, for accurate state tracking.

7. **Live Control vs Tasks** — Live Control is an instant override that doesn't persist. It does NOT affect the scheduled task. When the next task time slot triggers, it will override the live control value.

## Known Firmware Issues (as of SW v2.9.39)

| Issue | Description | Impact |
|-------|-------------|--------|
| Timestamp drift | Internal clock runs at half speed (1 min per 2 real min) | ~12 hour/day drift, delayed sensor data |
| Device Reset (0x88) | No response, device continues normally | Cannot remotely reboot |
| Clear All (0x89) | Does not clear tasks/location as documented | Cannot factory reset remotely |
| Restart Join (0x8A) | No effect, device stays connected | Cannot force rejoin remotely |
| Uplink interval SET | Setting new interval doesn't take effect | Stuck at default 1 min |
| 8500 heartbeat | Unknown empty payload every other uplink | Wasted airtime |

These are reported to Zenopix (Ali) and pending firmware fix.

## Byte-Level Reference

### Send Task Downlink (46 bytes)

```
Byte  Offset  Field                    Example
─────────────────────────────────────────────────
0     0       Header (0x86)            10000110 = Type=1, OpCode=6
1     1       DataLength (0x2C = 44)   44
2     2       Operation Type           0x01 = Deploy
3-6   3       Profile ID (LE)          0x01 0x00 0x00 0x00 = 1
7     7       Start Year               0x1A = 26 → 2026
8     8       Start Month              0x02 = February
9     9       Start Day                0x0A = 10
10    10      End Year                 0x63 = 99 → forever
11    11      End Month                0x63 = 99 → forever
12    12      End Day                  0x63 = 99 → forever
13    13      Priority                 0x01 = highest
14    14      Cyclic Type              0x05 = Custom
15    15      Cyclic Time              0x00
16    16      Off Days Mask            0x00 = every day
17    17      Channel Number           0x01 = Dim Value
─── Time Slot 1 (7 bytes) ───
18    18      On Hour                  0x3E = 62 → sunset
19    19      On Minute                0x3E = 62 → sunset
20    20      On Offset                0x00 = no offset
21    21      Off Hour                 0x17 = 23
22    22      Off Minute               0x00
23    23      Off Offset               0x00
24    24      Dim Value                0x64 = 100%
─── Time Slot 2 (7 bytes) ───
25    25      On Hour                  0x17 = 23
26    26      On Minute                0x00
27    27      On Offset                0x00
28    28      Off Hour                 0x3D = 61 → sunrise
29    29      Off Minute               0x3D = 61 → sunrise
30    30      Off Offset               0x00
31    31      Dim Value                0x32 = 50%
─── Time Slot 3 (7 bytes) ───
32-38         (all zeros = empty)
─── Time Slot 4 (7 bytes) ───
39-45         (all zeros = empty)
```

### Task Response Uplink (14 bytes)

```
Byte  Field              Example
───────────────────────────────
0     Header (0x87)      OpCode=7, Type=1
1     DataLength         0x0C = 12
2     Status             0x00 = PASS
3     Operation          0x01 = deploy
4-7   Profile ID (LE)    0x01 0x00 0x00 0x00 = 1
8     Channel            0x01
9     Year               0x1A → 2026
10    Month              0x02
11    Day                0x0A
12    Hour               0x09
13    Minute             0x34
```

### Task Query Request (3 bytes)

```
Byte  Field              Example
───────────────────────────────
0     Header (0x06)      OpCode=6, Type=0 (GET)
1     DataLength         0x01
2     Task Index         0x00 (slot 0)
```
