<!-- Last updated: 2026-02-09 -->
<!-- Sources: TbUtils.java, TbDate.java, TbJson.java, https://thingsboard.io/docs/user-guide/tbel/ -->

# TBEL/MVEL Scripting Guide

Comprehensive guide for writing TBEL (ThingsBoard Expression Language) scripts in rule engine transform and filter nodes. Includes critical bugs and workarounds discovered through real usage.

## Script Language Selection

In rule node configuration JSON, set `"scriptLang": "TBEL"` to use TBEL instead of JavaScript:

```json
{
  "scriptLang": "TBEL",
  "jsScript": "return {msg: msg, metadata: metadata, msgType: msgType};",
  "tbelScript": "// Your TBEL script here"
}
```

Both `jsScript` and `tbelScript` fields must be present. ThingsBoard uses whichever one matches `scriptLang`.

## Available Objects

| Object | Type | Description |
|--------|------|-------------|
| `msg` | Object | Message body (JSON payload). Mutable -- you can add/modify fields. |
| `metadata` | Object | Message metadata (deviceName, deviceType, ts, etc.). Mutable. |
| `msgType` | String | Message type string (e.g., "POST_TELEMETRY_REQUEST"). |

## Node Types and Return Formats

### Transform Node

Modifies the message and returns a new message object:

```java
// Must return {msg, metadata, msgType}
msg.power_watts = msg.voltage * msg.current;
return {msg: msg, metadata: metadata, msgType: msgType};
```

Can also change `msgType` to re-route the message:

```java
return {msg: {dimLevel: 75}, metadata: metadata, msgType: "POST_ATTRIBUTES_REQUEST"};
```

### Filter Node

Returns a boolean -- `true` routes to "True" output, `false` routes to "False" output:

```java
return msg.temperature > 25;
```

### Log Node

Returns a string for logging:

```java
return '\nIncoming message:\n' + JSON.stringify(msg) + '\nIncoming metadata:\n' + JSON.stringify(metadata);
```

---

## Working Functions

### Encoding

| Function | Description | Example |
|----------|-------------|---------|
| `bytesToBase64(byteArray)` | Binary array to base64 string | `bytesToBase64([0x84, 0x01, 75])` |

**Note:** `btoa()` and `atob()` do NOT work. Use `bytesToBase64()` instead.

### Type Conversion

| Function | Description | Example |
|----------|-------------|---------|
| `parseInt(str)` | String to integer | `parseInt("42")` returns 42 |
| `parseFloat(str)` | String to float | `parseFloat("3.14")` returns 3.14 |
| `String(val)` | Any to string | `String(42)` returns "42" |

### Math

| Function | Description |
|----------|-------------|
| `Math.round(val)` | Round to nearest integer |
| `Math.max(a, b)` | Maximum of two values |
| `Math.min(a, b)` | Minimum of two values |
| `Math.abs(val)` | Absolute value |
| `Math.floor(val)` | Round down |
| `Math.ceil(val)` | Round up |

### String

| Function | Description |
|----------|-------------|
| `str.replace(old, new)` | Basic string replacement (first occurrence) |
| `str.trim()` | Remove whitespace |
| `str.length` | String length |
| `str.indexOf(sub)` | Find substring position |
| `str.substring(start, end)` | Extract substring |

### JSON

| Function | Description |
|----------|-------------|
| `JSON.stringify(obj)` | Object to JSON string |
| `JSON.parse(str)` | JSON string to object |

### Number Formatting

| Function | Description | Example |
|----------|-------------|---------|
| `val.toFixed(N)` | Format to N decimal places | `(3.14159).toFixed(2)` returns "3.14" |
| `parseFloat(val.toFixed(N))` | Format and convert back to number | Returns 3.14 as float |

---

## NOT Working (Critical)

These functions/patterns do NOT work in TBEL and will cause errors:

| Function/Pattern | Error | Alternative |
|-----------------|-------|-------------|
| `btoa()` / `atob()` | undefined | Use `bytesToBase64()` |
| `/pattern/g` (regex) | "unterminated string literal" | Use string comparison operators |
| `Array.map()` | undefined | Use for loop |
| `Array.filter()` | undefined | Use for loop |
| `Array.reduce()` | undefined | Use for loop |
| `getClass().getName()` | Blocked by sandbox | Not available |
| `typeof` (sometimes) | Inconsistent | Check `!= null` instead |
| `===` / `!==` | May not work | Use `==` / `!=` |

---

## Critical Bugs

### Bug 1: var + if-block Scope Bug

**THE MOST COMMON BUG.** Variables declared with `var` and then modified inside an `if` block lose their modified value outside the block.

```java
// BROKEN: dimValue stays 0 even when condition is true
var dimValue = 0;
if (params == "on") {
    dimValue = 100;  // This assignment is lost outside the if block!
}
// dimValue is STILL 0 here
```

**Workaround -- assign directly to msg fields:**

```java
// WORKS: Assign directly to msg fields
msg.dimValue = (params == "on") ? 100 : parseInt(params);
```

**Workaround -- compute inside the if and return immediately:**

```java
if (params == "on") {
    return {msg: {"dimLevel": 100}, metadata: metadata, msgType: "POST_ATTRIBUTES_REQUEST"};
}
return {msg: {"dimLevel": parseInt(params)}, metadata: metadata, msgType: "POST_ATTRIBUTES_REQUEST"};
```

### Bug 2: Ternary with var Fails

```java
// BROKEN: Condition may not evaluate correctly with previously assigned vars
var x = (someVar > 10) ? 100 : 0;
```

**Workaround:**

```java
// WORKS: Assign to msg field directly
msg.x = (msg.someField > 10) ? 100 : 0;
```

### Bug 3: Actor Caching on Compile Failure

If a TBEL script fails to compile (syntax error), the rule engine actor gets stuck in an exponential backoff retry loop. Even after fixing the script, the actor may not recover.

**Fix:** After correcting the script, restart the Docker container to clear the actor cache:

```bash
docker restart signconnect
```

---

## Safe Patterns

### Pattern: Direct msg.field Assignment

```java
// SAFE: Always works
msg.power_watts = msg.voltage * msg.current;
msg.energy_increment = msg.power_watts * (10.0 / 60.0);
return {msg: msg, metadata: metadata, msgType: msgType};
```

### Pattern: Null-Safe Field Access

```java
// SAFE: Check for null before using
var voltage = msg.voltage != null ? msg.voltage : 0;
var current = msg.current != null ? msg.current : 0;
msg.power = parseFloat((voltage * current / 1000.0).toFixed(2));
```

Note: `var` works fine for null-safe reads. The bug only affects `var` + reassignment inside `if` blocks.

### Pattern: String Comparison Without Regex

```java
// For escaped quote comparison (when params might be "on" or "\"on\""):
if (params == "on" || params == "\"on\"") {
    // handle "on"
}

// For basic string matching:
var p = String(params).replace("\"", "").trim();
if (p == "on") {
    // handle on
} else if (p == "off") {
    // handle off
}
```

### Pattern: Change Message Type for Re-Routing

```java
// Transform RPC into attribute save
return {msg: {"dimLevel": 75}, metadata: metadata, msgType: "POST_ATTRIBUTES_REQUEST"};
```

When `msgType` changes to `POST_ATTRIBUTES_REQUEST`, the message re-enters the rule chain and gets routed to the "Post attributes" output of the Message Type Switch node.

---

## Real Script Examples

These are production scripts from the Zenopix DALI rule chain.

### Example 1: Energy Calculator (Transform Node)

Calculates `power_watts` and `energy_wh_increment` from raw telemetry. Uses null-safe access and multiple calculation fallbacks.

```java
var supplyV = msg.supply_voltage != null ? msg.supply_voltage : 0;
var lightV = msg.light_src_voltage != null ? msg.light_src_voltage : 0;
var lightI = msg.light_src_current != null ? msg.light_src_current : 0;
var pf = msg.power_factor != null ? msg.power_factor : 0;
var dimPct = msg.dim_value != null ? msg.dim_value : 0;
var outputPct = msg.output_current_pct != null ? msg.output_current_pct : 0;

var power_w = 0;
if (lightV > 0 && lightI > 0) {
    power_w = (lightV * lightI * pf) / 1000;
} else if (supplyV > 0 && outputPct > 0) {
    power_w = supplyV * (outputPct / 100) * pf * 0.5;
}

msg.power_watts = parseFloat(power_w.toFixed(2));
msg.energy_wh_increment = parseFloat((power_w * (10.0 / 60.0)).toFixed(4));

return {msg: msg, metadata: metadata, msgType: msgType};
```

**Notes:**
- Uses `var` safely because the variables are only read, not reassigned in if blocks
- The `power_w` variable IS assigned in an if block, but `msg.power_watts` captures the computed result via `power_w.toFixed(2)` which works because `power_w` is read in the same scope level as the if block (not nested further)
- Uses `parseFloat(val.toFixed(N))` pattern for clean decimal output

### Example 2: Dim Downlink Transform (Transform Node)

Converts RPC `setDim` / `setState` commands into TTN LoRaWAN downlink payloads with DALI protocol encoding.

```java
var base64Payload = null;
var fPort = 8;

if (msg != null && msg.method != null) {
    var method = msg.method;
    var params = msg.params;

    if (method == "setDim" || method == "setState") {
        var dimValue = 0;

        if (typeof params === 'object' && params !== null) {
            dimValue = parseInt(params.value || params || 0);
        } else {
            var p = String(params).replace(/"/g, '').trim();
            if (p == "on") dimValue = 100;
            else if (p == "off") dimValue = 0;
            else dimValue = parseInt(p) || 0;
        }

        dimValue = Math.max(0, Math.min(100, dimValue));
        base64Payload = bytesToBase64([0x84, 0x01, dimValue]);
    }
}

if (base64Payload != null) {
    var newMsg = {"downlinks":[{"f_port":fPort,"frm_payload":base64Payload,"priority":"NORMAL"}]};
    return {"msg":newMsg,"metadata":metadata,"msgType":"DOWNLINK"};
} else {
    return {"msg":msg,"metadata":metadata,"msgType":msgType};
}
```

**Notes:**
- DALI command bytes: `[0x84, 0x01, dimValue]` where 0x84 = DAPC, 0x01 = address 1
- `bytesToBase64()` is the ONLY way to encode binary in TBEL
- Clamping with `Math.max(0, Math.min(100, dimValue))`
- Returns custom `msgType: "DOWNLINK"` for routing to MQTT publish node
- The `String(params).replace(/"/g, '').trim()` line uses regex -- this may fail in some TBEL versions. Safer alternative: explicit string comparison.

### Example 3: Save Dim Level (Transform Node)

Extracts `dimLevel` from RPC parameters and converts to a server attribute save request.

```java
var method = msg.method;
var params = msg.params;

if (method == "setDim" || method == "setState") {
    var dimValue = 0;
    var p = String(params).replace(/"/g, '').trim();
    if (p == "on") dimValue = 100;
    else if (p == "off") dimValue = 0;
    else dimValue = parseInt(p) || 0;
    dimValue = Math.max(0, Math.min(100, dimValue));

    return {msg: {"dimLevel": dimValue}, metadata: metadata, msgType: "POST_ATTRIBUTES_REQUEST"};
}
return {msg: msg, metadata: metadata, msgType: msgType};
```

**Notes:**
- Changes `msgType` to `POST_ATTRIBUTES_REQUEST` so the message re-enters the rule chain and gets routed to the Save Server Attributes node
- The `dimLevel` attribute is saved to SERVER_SCOPE by the downstream `TbMsgAttributesNode` configured with `"scope": "SERVER_SCOPE"`
- Only processes `setDim` and `setState` methods; passes other messages through unchanged

---

## Metadata Fields

Common metadata fields available in TBEL scripts:

| Field | Description | Example |
|-------|-------------|---------|
| `metadata.deviceName` | Device name | "zenopix-test" |
| `metadata.deviceType` | Device type | "Zenopix DALI Controller" |
| `metadata.ts` | Message timestamp (ms) | "1700000000000" |

Access metadata: `var deviceName = metadata.deviceName;`

Set metadata: `metadata.customField = "value";`

**Note:** Metadata values are always strings. Use `parseInt(metadata.ts)` to convert to number.

---

## Debugging TBEL Scripts

### Enable Debug Mode on Nodes

1. In the rule chain editor, click on a node
2. Toggle "Debug mode" on
3. Go to the Events tab for that node
4. View input/output messages for each processed message

### Log Node

Add a `TbLogNode` to print message contents:

```java
return '\nMessage: ' + JSON.stringify(msg) + '\nMetadata: ' + JSON.stringify(metadata) + '\nType: ' + msgType;
```

### Docker Logs

```bash
# View rule engine errors
docker logs signconnect --tail 100 | grep -i "script\|tbel\|error"

# Follow logs in real-time
docker logs signconnect -f --tail 50
```

### Common Error Messages

| Error | Cause | Fix |
|-------|-------|-----|
| "unterminated string literal" | Regex `/pattern/` in TBEL | Use string comparison instead |
| "unable to resolve method" | Calling unsupported function | Check "NOT Working" table above |
| "null pointer" | Accessing field on null object | Add null check: `msg.field != null` |
| "unable to compile" | Syntax error | Fix syntax, then `docker restart signconnect` |
| "script execution timeout" | Infinite loop or heavy computation | Simplify script, avoid loops |

### Actor Cache Recovery

If a TBEL script fails to compile, the actor enters exponential backoff. Even after fixing the script, the actor may remain stuck.

**Recovery steps:**
1. Fix the TBEL script via API (`POST /api/ruleChain/metadata`)
2. Restart the Docker container: `docker restart signconnect`
3. Verify by sending test telemetry and checking debug events

---

## Script Templates

### Minimal Transform (Pass-Through)

```java
return {msg: msg, metadata: metadata, msgType: msgType};
```

### Add Computed Field

```java
msg.temperatureF = msg.temperature * 9.0 / 5.0 + 32.0;
return {msg: msg, metadata: metadata, msgType: msgType};
```

### Null-Safe Multi-Field Transform

```java
var v1 = msg.field1 != null ? msg.field1 : 0;
var v2 = msg.field2 != null ? msg.field2 : 0;
msg.computed = parseFloat((v1 * v2 / 1000.0).toFixed(2));
return {msg: msg, metadata: metadata, msgType: msgType};
```

### Filter by Telemetry Value

```java
return msg.temperature != null && msg.temperature > 50;
```

### Route to Different Message Type

```java
// Convert telemetry to attribute save
return {msg: {"lastTemp": msg.temperature}, metadata: metadata, msgType: "POST_ATTRIBUTES_REQUEST"};
```

### Binary Downlink Encoding

```java
var payload = bytesToBase64([0x01, 0x02, msg.value]);
var downlink = {"downlinks": [{"f_port": 8, "frm_payload": payload, "priority": "NORMAL"}]};
return {msg: downlink, metadata: metadata, msgType: "DOWNLINK"};
```

---

## TBEL Function Reference (Complete)

All functions below are registered in `TbUtils.register()` and available as global functions in TBEL scripts. Source: `TbUtils.java`, `TbDate.java`, `TbJson.java`.

### Hex Parsing Functions

All accept `"0x"` prefix or raw hex. `bigEndian` defaults to `true`.

- `parseHexToInt(hex)` / `parseHexToInt(hex, bigEndian)` -- hex string to int
- `parseBigEndianHexToInt(hex)` / `parseLittleEndianHexToInt(hex)` -- explicit byte order
- `parseHexToLong(hex)` / `parseHexToLong(hex, bigEndian)` -- hex string to long
- `parseBigEndianHexToLong(hex)` / `parseLittleEndianHexToLong(hex)`
- `parseHexToFloat(hex)` / `parseHexToFloat(hex, bigEndian)` -- hex as IEEE 754 float
- `parseBigEndianHexToFloat(hex)` / `parseLittleEndianHexToFloat(hex)`
- `parseHexIntLongToFloat(hex, bigEndian)` -- parse hex as integer, cast to float
- `parseHexToDouble(hex)` / `parseHexToDouble(hex, bigEndian)` -- hex as IEEE 754 double
- `parseBigEndianHexToDouble(hex)` / `parseLittleEndianHexToDouble(hex)`

```java
var temp = parseHexToFloat("41200000");                // 10.0
var tempLE = parseLittleEndianHexToFloat("00002041");  // 10.0
```

### Bytes Parsing Functions

All accept `List<Byte>` or `byte[]`. Overloads: `(data)`, `(data, offset)`, `(data, offset, length)`, `(data, offset, length, bigEndian)`.

- `parseBytesToInt(data, ...)` -- up to 4 bytes to signed int
- `parseBytesToLong(data, ...)` -- up to 8 bytes to signed long
- `parseBytesToFloat(data, ...)` -- 4 bytes as IEEE 754 float
- `parseBytesIntToFloat(data, ...)` -- bytes as integer, cast to float
- `parseBytesToDouble(data, ...)` -- 8 bytes as IEEE 754 double
- `parseBytesLongToDouble(data, ...)` -- bytes as long, cast to double

```java
var val = parseBytesToInt([0x00, 0x0A], 0, 2, true);    // 10
var temp = parseBytesToFloat([0x41, 0x20, 0x00, 0x00]);  // 10.0
```

### Hex/Binary Generation

Optional params: `bigEndian` (default true), `pref` (add "0x" prefix), `len` (output length).

- `intToHex(int, [bigEndian], [pref], [len])` -- int to hex string
- `longToHex(long, [bigEndian], [pref], [len])` -- long to hex string
- `floatToHex(float, [bigEndian])` -- float to IEEE 754 hex (always prefixed "0x")
- `doubleToHex(double, [bigEndian])` -- double to IEEE 754 hex (always prefixed "0x")
- `intLongToRadixString(long, [radix], [bigEndian], [pref])` -- to string in radix 2/8/10/16

### Byte Array Utilities

- `hexToBytes(hex)` -> `List<Byte>` | `hexToBytesArray(hex)` -> `byte[]`
- `bytesToHex(bytes)` -- byte array or list to hex string
- `base64ToHex(base64)` / `hexToBase64(hex)` -- convert between base64 and hex
- `base64ToBytes(base64)` -> `byte[]` | `base64ToBytesList(base64)` -> `List<Byte>`
- `bytesToBase64(bytes)` -- byte array to base64 string
- `stringToBytes(str, [charset])` -> `List<Byte>` | `bytesToString(byteList, [charset])` -> `String`
- `decodeToJson(byteList)` / `decodeToJson(str)` -- parse bytes or string to JSON object
- `printUnsignedBytes(byteList)` -> `List<Integer>` -- signed bytes to unsigned (0-255)

### Binary Array Functions

- `parseByteToBinaryArray(byte, [len], [bigEndian])` -- single byte to array of 0/1 values
- `parseBytesToBinaryArray(data, [len])` -- byte list/array to binary array
- `parseLongToBinaryArray(long, [len])` -- long to binary array (default 64-bit)
- `parseBinaryArrayToInt(data, [offset], [len])` -- binary array back to integer

```java
var bits = parseByteToBinaryArray(0xA5);       // [1,0,1,0,0,1,0,1]
var nibble = parseBinaryArrayToInt(bits, 2, 4); // bits[2..5] => 8
```

### Base Validation

Returns the radix on success, -1 on failure.

- `isBinary(str)` -> 2 or -1 | `isOctal(str)` -> 8 or -1
- `isDecimal(str)` -> 10 or -1 | `isHexadecimal(str)` -> 16 or -1

### Geofencing

- `isInsidePolygon(lat, lng, polygonJson)` -> boolean
- `isInsideCircle(lat, lng, circleJson)` -> boolean

`circleJson`: `{"latitude":51.5,"longitude":-0.1,"radius":500,"radiusUnit":"METER"}`. Units: `METER`, `KILOMETER`, `FOOT`, `MILE`, `NAUTICAL_MILE`.

### URI Functions

- `encodeURI(str)` -- encode string for URI use (MDN-compatible)
- `decodeURI(str)` -- decode a URI-encoded string

### Type Check and Utility Functions

- `isMap(obj)` / `isList(obj)` / `isArray(obj)` / `isSet(obj)` -- type checks (boolean)
- `isNaN(double)` -- true if Not-a-Number
- `toFixed(double, precision)` -- round to N decimal places
- `toInt(double)` -- round to nearest integer
- `toFlatMap(json, [excludeList], [pathInKey])` -- flatten nested JSON to dot-notation map
- `raiseError(message)` -- throw RuntimeException
- `newSet()` / `toSet(list)` -- create empty Set or convert List to Set
- `padStart(str, targetLen, padChar)` / `padEnd(str, targetLen, padChar)` -- pad strings
- `btoa(str)` / `atob(str)` -- base64 encode/decode (registered but unreliable, prefer `bytesToBase64`)

### TbDate Class

Create with `new TbDate(...)`. Provides JavaScript-like Date functionality.

**Constructors:** `TbDate()` (now) | `TbDate(millis)` | `TbDate(dateString, [pattern], [locale], [zoneId])` | `TbDate(y, m, d, [h], [min], [sec], [ms], [tz])`

**Getters (local tz):** `getTime()`, `valueOf()`, `getFullYear()`, `getMonth()` (1-12), `getDate()`, `getDay()` (Mon=1), `getHours()`, `getMinutes()`, `getSeconds()`, `getMilliseconds()`

**UTC variants:** `getUTCFullYear()`, `getUTCMonth()`, `getUTCDate()`, `getUTCDay()`, `getUTCHours()`, `getUTCMinutes()`, `getUTCSeconds()`, `getUTCMilliseconds()` + matching `setUTC*()` methods.

**Setters (local tz):** `setFullYear(y,[m],[d])`, `setMonth(m,[d])`, `setDate(d)`, `setHours(h,[min],[sec],[ms])`, `setMinutes(min,[sec],[ms])`, `setSeconds(sec,[ms])`, `setMilliseconds(ms)`, `setTime(millis)`

**Arithmetic (mutating):** `addYears(n)`, `addMonths(n)`, `addWeeks(n)`, `addDays(n)`, `addHours(n)`, `addMinutes(n)`, `addSeconds(n)`, `addNanos(n)`

**Formatting:** `toISOString()`, `toJSON()`, `toString([locale])`, `toDateString()`, `toTimeString()`, `toUTCString()`, `toLocaleDateString([locale],[options])`, `toLocaleTimeString([locale],[options])`, `toLocaleString([locale],[options])`

**Static:** `TbDate.now()` -> long | `TbDate.parse(str,[format])` -> long (-1 on failure) | `TbDate.UTC(y,[m],[d],[h],[min],[sec],[ms])` -> long

```java
var now = new TbDate();
var eventTime = new TbDate(msg.timestamp);
msg.ageMinutes = parseFloat(((now.getTime() - eventTime.getTime()) / 60000.0).toFixed(1));
```

### JSON Functions (TbJson)

- `JSON.stringify(obj)` -- serialize to JSON string (null returns "null")
- `JSON.parse(str)` -- parse JSON string to Map, List, or primitive
