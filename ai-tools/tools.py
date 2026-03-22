"""Claude tool definitions and execution logic."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import date, datetime

from cache import get_cached_entity, set_cached_entity
from config import resolve_time_range
from models import EntityContext
from tb_client import TBClient

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Unit conversion helpers
# ---------------------------------------------------------------------------

def wh_to_kwh(wh: float) -> float:
    return round(wh / 1000, 2)


def grams_to_kg(g: float) -> float:
    return round(g / 1000, 2)


# ---------------------------------------------------------------------------
# Tool definitions (sent to Claude)
# ---------------------------------------------------------------------------

TOOL_DEFINITIONS = [
    {
        "name": "get_hierarchy",
        "description": (
            "Get the customer's asset hierarchy (estates, regions, sites) "
            "and their devices. Returns the full tree structure. Call this "
            "FIRST if you need to resolve a site or device name to an ID. "
            "Use when user asks about their sites, locations, or overall structure."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {
                    "type": "string",
                    "description": "Customer UUID. Available from entity context.",
                },
            },
            "required": ["customer_id"],
        },
    },
    {
        "name": "get_site_summary",
        "description": (
            "Get summary of a specific site including device count, "
            "online/offline status, total energy, cost, CO₂, and power. "
            "Use when user asks about a site's status or overview."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "site_id": {
                    "type": "string",
                    "description": "Site asset UUID",
                },
                "time_range": {
                    "type": "string",
                    "enum": [
                        "today", "yesterday", "this_week",
                        "this_month", "last_7_days", "last_30_days",
                    ],
                    "description": "Time range for energy/cost aggregation. Default: today",
                },
            },
            "required": ["site_id"],
        },
    },
    {
        "name": "get_device_telemetry",
        "description": (
            "Get current or historical telemetry for a specific device. "
            "Use when user asks about a device's power, energy, status, "
            "temperature, etc."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "device_id": {
                    "type": "string",
                    "description": "Device UUID",
                },
                "keys": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Telemetry keys to fetch. Common: power_watts, "
                        "energy_wh, dim_value, saving_pct, driver_temperature"
                    ),
                },
                "time_range": {
                    "type": "string",
                    "enum": [
                        "latest", "today", "yesterday", "this_week",
                        "this_month", "last_7_days", "last_30_days",
                    ],
                    "description": (
                        "Time range. 'latest' returns most recent values only."
                    ),
                },
                "aggregation": {
                    "type": "string",
                    "enum": ["NONE", "AVG", "SUM", "MIN", "MAX"],
                    "description": (
                        "Aggregation type for historical data. "
                        "Use SUM for energy_wh, cost_currency, co2_grams. "
                        "Use AVG for power_watts, saving_pct, dim_value. "
                        "Use MAX for driver_temperature."
                    ),
                },
            },
            "required": ["device_id", "keys"],
        },
    },
    {
        "name": "get_energy_savings",
        "description": (
            "Get energy savings data for a device or all devices at a site. "
            "Returns saving_pct, energy_saving_wh, cost_saving, "
            "co2_saving_grams. Use when user asks about energy savings, "
            "efficiency, or dimming impact."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "Device UUID or Site asset UUID",
                },
                "entity_type": {
                    "type": "string",
                    "enum": ["DEVICE", "ASSET"],
                    "description": "Whether entity_id is a device or site",
                },
                "time_range": {
                    "type": "string",
                    "enum": [
                        "today", "yesterday", "this_week",
                        "this_month", "last_7_days", "last_30_days",
                    ],
                    "description": "Time range for savings calculation",
                },
            },
            "required": ["entity_id", "entity_type"],
        },
    },
    {
        "name": "get_alarms",
        "description": (
            "Get active alarms for a specific entity or all alarms. "
            "Returns alarm type, severity, device, timestamp. Use when "
            "user asks about faults, alerts, problems, or alarms."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": (
                        "Optional. Device or Site UUID. Omit for all alarms."
                    ),
                },
                "entity_type": {
                    "type": "string",
                    "enum": ["DEVICE", "ASSET"],
                    "description": "Type of entity_id",
                },
                "status": {
                    "type": "string",
                    "enum": ["ACTIVE", "CLEARED", "ANY"],
                    "description": "Alarm status filter. Default: ACTIVE",
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_device_attributes",
        "description": (
            "Get server/shared attributes for a device. Includes "
            "dashboard_tier, reference_power_watts, co2_per_kwh, "
            "energy_rate, dim_value (shared). Use for configuration "
            "or device info queries."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "device_id": {
                    "type": "string",
                    "description": "Device UUID",
                },
                "scope": {
                    "type": "string",
                    "enum": ["SERVER_SCOPE", "SHARED_SCOPE", "CLIENT_SCOPE"],
                    "description": "Attribute scope. Default: SERVER_SCOPE",
                },
            },
            "required": ["device_id"],
        },
    },
    {
        "name": "send_dim_command",
        "description": (
            "Set the dim level on a lighting controller via shared attributes. "
            "The MQTT bridge detects the dimLevel attribute change and sends a "
            "LoRaWAN downlink to the device. Accepts a device UUID or site "
            "asset UUID — if a site ID is given, the command is sent to ALL "
            "devices at that site.\n\n"
            "TWO-STEP FLOW: First call with confirmed=false (default) to get "
            "the device list and confirmation prompt. Present the device names "
            "and dim value to the user and wait for their confirmation. Then "
            "call again with confirmed=true to actually send the command."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "device_id": {
                    "type": "string",
                    "description": "Device UUID or Site asset UUID",
                },
                "dim_value": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 100,
                    "description": (
                        "Dim level percentage (0=off, 100=full brightness)"
                    ),
                },
                "confirmed": {
                    "type": "boolean",
                    "description": (
                        "Set to true only AFTER the user has explicitly "
                        "confirmed the command. Default: false."
                    ),
                },
            },
            "required": ["device_id", "dim_value"],
        },
    },
    {
        "name": "send_task_schedule",
        "description": (
            "Deploy, update, or delete a DALI lighting schedule on a controller. "
            "Creates time-based automation: lights turn on/off at specific times or sunrise/sunset. "
            "Each schedule supports up to 4 time slots with different dim levels. "
            "IMPORTANT: Sunrise/sunset schedules require location_setup to be configured first. "
            "Always use confirmation flow — first call with confirmed=false to preview, "
            "then confirmed=true to execute."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "device_id": {
                    "type": "string",
                    "description": (
                        "Device UUID or site asset UUID. If site UUID, "
                        "schedule is sent to ALL devices at that site."
                    ),
                },
                "operation": {
                    "type": "string",
                    "enum": ["deploy", "update", "delete"],
                    "description": (
                        "deploy=create new schedule, update=modify existing, "
                        "delete=remove schedule"
                    ),
                },
                "profile_id": {
                    "type": "integer",
                    "description": (
                        "Schedule profile ID (uint32). Required for update/delete. "
                        "For deploy, auto-generated if omitted."
                    ),
                },
                "start_date": {
                    "type": "string",
                    "description": (
                        "Start date in YYYY-MM-DD format. Default: today."
                    ),
                },
                "end_date": {
                    "type": "string",
                    "description": (
                        "End date in YYYY-MM-DD format. Use 'forever' for "
                        "indefinite. Default: 'forever'."
                    ),
                },
                "priority": {
                    "type": "integer",
                    "description": "Schedule priority 1-5 (1=highest). Default: 1.",
                },
                "channel_number": {
                    "type": "integer",
                    "description": "DALI driver channel (1-based). Default: 1.",
                },
                "time_slots": {
                    "type": "array",
                    "description": (
                        "Array of 1-4 time slot objects defining on/off "
                        "times and dim levels."
                    ),
                    "items": {
                        "type": "object",
                        "properties": {
                            "on_time": {
                                "type": "string",
                                "description": (
                                    "Turn-on time: 'HH:MM' (24h format), "
                                    "'sunrise', or 'sunset'"
                                ),
                            },
                            "on_offset": {
                                "type": "integer",
                                "description": (
                                    "Minutes offset from on_time (-60 to +60). "
                                    "E.g., -30 with sunrise = 30 min before sunrise."
                                ),
                            },
                            "off_time": {
                                "type": "string",
                                "description": (
                                    "Turn-off time: 'HH:MM' (24h format), "
                                    "'sunrise', or 'sunset'"
                                ),
                            },
                            "off_offset": {
                                "type": "integer",
                                "description": (
                                    "Minutes offset from off_time (-60 to +60)."
                                ),
                            },
                            "dim_value": {
                                "type": "integer",
                                "description": (
                                    "Brightness level 0-100 during this time slot."
                                ),
                            },
                        },
                        "required": ["on_time", "off_time", "dim_value"],
                    },
                },
                "confirmed": {
                    "type": "boolean",
                    "description": (
                        "false=preview schedule details and ask for confirmation, "
                        "true=execute. Default: false."
                    ),
                },
            },
            "required": ["device_id", "operation", "time_slots"],
        },
    },
    {
        "name": "query_task_schedule",
        "description": (
            "Query the lighting schedule stored at a specific index on a DALI controller. "
            "The device stores up to 20 schedules (index 0-19). "
            "This sends a query command and reads back the response. "
            "Note: The device must send an uplink before the response arrives "
            "(LoRaWAN Class A). The response may not be immediately available — "
            "check the task_query_response attribute."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "device_id": {
                    "type": "string",
                    "description": "Device UUID of the controller to query.",
                },
                "task_index": {
                    "type": "integer",
                    "description": (
                        "Schedule slot index to query (0-19). Default: 0."
                    ),
                },
            },
            "required": ["device_id"],
        },
    },
    {
        "name": "send_location_setup",
        "description": (
            "Configure GPS coordinates and timezone on a DALI controller. "
            "Required before using sunrise/sunset in task schedules. "
            "Claude should resolve city names to coordinates "
            "(e.g., 'London' -> 51.5074, -0.1278, tz=0). "
            "Common locations: London (51.5074, -0.1278, tz=0), "
            "Amsterdam (52.3676, 4.9041, tz=1), "
            "Istanbul (41.0082, 28.9784, tz=3), "
            "Dublin (53.3498, -6.2603, tz=0). "
            "Always use confirmation flow."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "device_id": {
                    "type": "string",
                    "description": (
                        "Device UUID or site asset UUID. If site UUID, "
                        "location is set on ALL devices at that site."
                    ),
                },
                "latitude": {
                    "type": "number",
                    "description": (
                        "GPS latitude in decimal degrees "
                        "(e.g., 51.5074 for London)."
                    ),
                },
                "longitude": {
                    "type": "number",
                    "description": (
                        "GPS longitude in decimal degrees "
                        "(e.g., -0.1278 for London)."
                    ),
                },
                "timezone": {
                    "type": "number",
                    "description": (
                        "UTC timezone offset as float "
                        "(e.g., 0.0 for UK, 1.0 for Netherlands, 3.0 for Turkey)."
                    ),
                },
                "confirmed": {
                    "type": "boolean",
                    "description": (
                        "false=preview and confirm, true=execute. Default: false."
                    ),
                },
            },
            "required": ["device_id", "latitude", "longitude", "timezone"],
        },
    },
    {
        "name": "delete_task_schedule",
        "description": (
            "Delete a specific lighting schedule from a DALI controller by profile ID. "
            "Use query_task_schedule first to find the profile_id if the user "
            "doesn't know it. Always use confirmation flow."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "device_id": {
                    "type": "string",
                    "description": "Device UUID or site asset UUID.",
                },
                "profile_id": {
                    "type": "integer",
                    "description": (
                        "The profile ID of the schedule to delete."
                    ),
                },
                "confirmed": {
                    "type": "boolean",
                    "description": (
                        "false=preview and confirm, true=execute. Default: false."
                    ),
                },
            },
            "required": ["device_id", "profile_id"],
        },
    },
    {
        "name": "compare_sites",
        "description": (
            "Compare energy, cost, and savings metrics across multiple "
            "sites. Use when user asks to compare locations or find "
            "best/worst performing sites."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "site_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of site asset UUIDs to compare",
                },
                "time_range": {
                    "type": "string",
                    "enum": [
                        "today", "yesterday", "this_week",
                        "this_month", "last_7_days", "last_30_days",
                    ],
                    "description": "Time range for comparison",
                },
            },
            "required": ["site_ids"],
        },
    },
]


# ---------------------------------------------------------------------------
# Tool executor dispatch
# ---------------------------------------------------------------------------

async def execute_tool(
    tool_name: str,
    tool_input: dict,
    tb: TBClient,
    context: EntityContext | None = None,
) -> dict:
    """Dispatch a tool call and return the result as a dict."""
    executors = {
        "get_hierarchy": _get_hierarchy,
        "get_site_summary": _get_site_summary,
        "get_device_telemetry": _get_device_telemetry,
        "get_energy_savings": _get_energy_savings,
        "get_alarms": _get_alarms,
        "get_device_attributes": _get_device_attributes,
        "send_dim_command": _send_dim_command,
        "send_task_schedule": _send_task_schedule,
        "query_task_schedule": _query_task_schedule,
        "send_location_setup": _send_location_setup,
        "delete_task_schedule": _delete_task_schedule,
        "compare_sites": _compare_sites,
    }
    executor = executors.get(tool_name)
    if executor is None:
        return {"error": f"Unknown tool: {tool_name}"}

    try:
        return await executor(tool_input, tb, context)
    except Exception as exc:
        logger.exception("Tool %s failed", tool_name)
        return {"error": f"Tool {tool_name} failed: {exc}"}


# ---------------------------------------------------------------------------
# Individual tool executors
# ---------------------------------------------------------------------------

async def _cached_get_device(device_id: str, tb: TBClient) -> dict:
    """Get device with entity cache."""
    cached = get_cached_entity(device_id)
    if cached is not None:
        return cached
    data = await tb.get_device(device_id)
    set_cached_entity(device_id, data)
    return data


async def _cached_get_asset(asset_id: str, tb: TBClient) -> dict:
    """Get asset with entity cache."""
    cached = get_cached_entity(asset_id)
    if cached is not None:
        return cached
    data = await tb.get_asset(asset_id)
    set_cached_entity(asset_id, data)
    return data


async def _get_hierarchy(inp: dict, tb: TBClient, ctx: EntityContext | None = None) -> dict:
    """Walk customer → estate → region → site → device."""
    customer_id = inp["customer_id"]
    customer = await tb.get_customer(customer_id)
    all_assets = await tb.get_customer_assets(customer_id)

    estates = [a for a in all_assets if a.get("type", "").lower() == "estate"]
    regions = [a for a in all_assets if a.get("type", "").lower() == "region"]
    sites_assets = [a for a in all_assets if a.get("type", "").lower() == "site"]

    hierarchy: dict = {
        "customer": customer.get("title", ""),
        "customer_id": customer_id,
        "estates": [],
    }

    async def build_site(site_id: str, site_name: str) -> dict:
        rels = await tb.get_entity_relations(site_id, "ASSET")
        devices = []
        for rel in rels:
            child = rel["to"]
            if child["entityType"] == "DEVICE":
                dev = await _cached_get_device(child["id"], tb)
                devices.append({
                    "id": child["id"],
                    "name": dev.get("name", ""),
                    "type": dev.get("type", ""),
                })
        return {"id": site_id, "name": site_name, "devices": devices}

    async def build_region(region_id: str, region_name: str) -> dict:
        rels = await tb.get_entity_relations(region_id, "ASSET")
        site_nodes = []
        for rel in rels:
            child = rel["to"]
            if child["entityType"] == "ASSET":
                asset = await _cached_get_asset(child["id"], tb)
                if asset.get("type", "").lower() == "site":
                    site_nodes.append(await build_site(child["id"], asset["name"]))
        return {"id": region_id, "name": region_name, "sites": site_nodes}

    if estates:
        for est in estates:
            eid = est["id"]["id"]
            rels = await tb.get_entity_relations(eid, "ASSET")
            region_nodes: list[dict] = []
            direct_sites: list[dict] = []
            for rel in rels:
                child = rel["to"]
                if child["entityType"] == "ASSET":
                    asset = await _cached_get_asset(child["id"], tb)
                    child_type = asset.get("type", "").lower()
                    if child_type == "region":
                        region_nodes.append(
                            await build_region(child["id"], asset["name"])
                        )
                    elif child_type == "site":
                        direct_sites.append(
                            await build_site(child["id"], asset["name"])
                        )
            hierarchy["estates"].append({
                "id": eid,
                "name": est.get("name", ""),
                "regions": region_nodes,
                "sites": direct_sites,
            })
    elif regions:
        # No estates — flat region → site
        for reg in regions:
            rid = reg["id"]["id"]
            hierarchy["estates"].append(
                await build_region(rid, reg.get("name", ""))
            )
    elif sites_assets:
        # Bare sites directly under customer
        for s in sites_assets:
            sid = s["id"]["id"]
            hierarchy["estates"].append(
                await build_site(sid, s.get("name", ""))
            )

    return hierarchy


async def _get_site_summary(inp: dict, tb: TBClient, ctx: EntityContext | None = None) -> dict:
    """Aggregate telemetry across all devices at a site."""
    site_id = inp["site_id"]
    time_range = inp.get("time_range", "today")
    start_ts, end_ts = resolve_time_range(time_range)

    site = await _cached_get_asset(site_id, tb)
    rels = await tb.get_entity_relations(site_id, "ASSET")

    device_ids: list[tuple[str, str]] = []  # (id, name)
    for rel in rels:
        child = rel["to"]
        if child["entityType"] == "DEVICE":
            dev = await _cached_get_device(child["id"], tb)
            device_ids.append((child["id"], dev.get("name", "")))

    energy_keys = ["energy_wh", "co2_grams", "cost_currency"]
    power_keys = ["power_watts", "dim_value"]

    total_energy_wh = 0.0
    total_co2_g = 0.0
    total_cost = 0.0
    total_power_w = 0.0
    devices_info: list[dict] = []
    online_count = 0

    for dev_id, dev_name in device_ids:
        # Historical energy sums
        hist = await tb.get_historical_telemetry(
            "DEVICE", dev_id, energy_keys, start_ts, end_ts, agg="SUM"
        )
        energy = sum(b["value"] for b in hist.get("energy_wh", []))
        co2 = sum(b["value"] for b in hist.get("co2_grams", []))
        cost = sum(b["value"] for b in hist.get("cost_currency", []))

        # Latest power
        latest = await tb.get_latest_telemetry("DEVICE", dev_id, power_keys)
        power = latest.get("power_watts", 0)
        dim = latest.get("dim_value", "N/A")

        total_energy_wh += energy
        total_co2_g += co2
        total_cost += cost
        if isinstance(power, (int, float)):
            total_power_w += power

        # Check active attrs for online status
        attrs = await tb.get_attributes("DEVICE", dev_id, "SERVER_SCOPE", ["active"])
        is_online = attrs.get("active", False)
        if is_online:
            online_count += 1

        devices_info.append({
            "id": dev_id,
            "name": dev_name,
            "power_watts": power,
            "dim_value": dim,
            "energy_kwh": wh_to_kwh(energy),
            "online": is_online,
        })

    return {
        "site_name": site.get("name", ""),
        "site_id": site_id,
        "time_range": time_range,
        "device_count": len(device_ids),
        "online_count": online_count,
        "offline_count": len(device_ids) - online_count,
        "total_energy_kwh": wh_to_kwh(total_energy_wh),
        "total_co2_kg": grams_to_kg(total_co2_g),
        "total_cost": round(total_cost, 2),
        "total_power_watts": round(total_power_w, 2),
        "devices": devices_info,
    }


async def _get_device_telemetry(inp: dict, tb: TBClient, ctx: EntityContext | None = None) -> dict:
    """Fetch latest or historical telemetry for a device."""
    device_id = inp["device_id"]
    keys = inp["keys"]
    time_range = inp.get("time_range", "latest")
    agg = inp.get("aggregation", "SUM")

    dev = await _cached_get_device(device_id, tb)
    result: dict = {"device_name": dev.get("name", ""), "device_id": device_id}

    if time_range == "latest":
        latest = await tb.get_latest_telemetry("DEVICE", device_id, keys)
        result["time_range"] = "latest"
        result["values"] = latest
    else:
        start_ts, end_ts = resolve_time_range(time_range)
        hist = await tb.get_historical_telemetry(
            "DEVICE", device_id, keys, start_ts, end_ts, agg=agg
        )
        # Flatten single-bucket results
        values: dict = {}
        for key, buckets in hist.items():
            if len(buckets) == 1:
                values[key] = buckets[0]["value"]
            else:
                values[key] = buckets
        result["time_range"] = time_range
        result["aggregation"] = agg
        result["values"] = values

    return result


async def _get_energy_savings(inp: dict, tb: TBClient, ctx: EntityContext | None = None) -> dict:
    """Get savings metrics for a device or all devices at a site."""
    entity_id = inp["entity_id"]
    entity_type = inp["entity_type"]
    time_range = inp.get("time_range", "today")
    start_ts, end_ts = resolve_time_range(time_range)

    savings_keys = [
        "energy_saving_wh", "saving_pct", "cost_saving", "co2_saving_grams",
    ]

    if entity_type == "DEVICE":
        dev = await _cached_get_device(entity_id, tb)
        hist = await tb.get_historical_telemetry(
            "DEVICE", entity_id, savings_keys, start_ts, end_ts, agg="SUM"
        )
        # Also get average saving_pct
        avg_hist = await tb.get_historical_telemetry(
            "DEVICE", entity_id, ["saving_pct"], start_ts, end_ts, agg="AVG"
        )
        saving_wh = sum(b["value"] for b in hist.get("energy_saving_wh", []))
        cost_saving = sum(b["value"] for b in hist.get("cost_saving", []))
        co2_saving_g = sum(b["value"] for b in hist.get("co2_saving_grams", []))
        avg_pct_vals = avg_hist.get("saving_pct", [])
        avg_pct = avg_pct_vals[0]["value"] if avg_pct_vals else 0

        return {
            "entity_name": dev.get("name", ""),
            "entity_type": "DEVICE",
            "time_range": time_range,
            "energy_saving_kwh": wh_to_kwh(saving_wh),
            "cost_saving": round(cost_saving, 2),
            "co2_saving_kg": grams_to_kg(co2_saving_g),
            "average_saving_pct": round(avg_pct, 1),
        }

    # ASSET (site) — aggregate across devices
    site = await _cached_get_asset(entity_id, tb)
    rels = await tb.get_entity_relations(entity_id, "ASSET")

    total_saving_wh = 0.0
    total_cost_saving = 0.0
    total_co2_saving_g = 0.0
    pct_values: list[float] = []
    device_savings: list[dict] = []

    for rel in rels:
        child = rel["to"]
        if child["entityType"] != "DEVICE":
            continue
        dev = await _cached_get_device(child["id"], tb)
        hist = await tb.get_historical_telemetry(
            "DEVICE", child["id"], savings_keys, start_ts, end_ts, agg="SUM"
        )
        avg_hist = await tb.get_historical_telemetry(
            "DEVICE", child["id"], ["saving_pct"], start_ts, end_ts, agg="AVG"
        )
        s_wh = sum(b["value"] for b in hist.get("energy_saving_wh", []))
        c_s = sum(b["value"] for b in hist.get("cost_saving", []))
        co2_s = sum(b["value"] for b in hist.get("co2_saving_grams", []))
        avg_vals = avg_hist.get("saving_pct", [])
        avg_p = avg_vals[0]["value"] if avg_vals else 0

        total_saving_wh += s_wh
        total_cost_saving += c_s
        total_co2_saving_g += co2_s
        if avg_p:
            pct_values.append(avg_p)

        device_savings.append({
            "device_name": dev.get("name", ""),
            "device_id": child["id"],
            "energy_saving_kwh": wh_to_kwh(s_wh),
            "average_saving_pct": round(avg_p, 1),
        })

    overall_pct = round(sum(pct_values) / len(pct_values), 1) if pct_values else 0

    return {
        "entity_name": site.get("name", ""),
        "entity_type": "ASSET",
        "time_range": time_range,
        "total_energy_saving_kwh": wh_to_kwh(total_saving_wh),
        "total_cost_saving": round(total_cost_saving, 2),
        "total_co2_saving_kg": grams_to_kg(total_co2_saving_g),
        "average_saving_pct": overall_pct,
        "devices": device_savings,
    }


async def _get_alarms(inp: dict, tb: TBClient, ctx: EntityContext | None = None) -> dict:
    """Fetch alarms for an entity or tenant-wide."""
    entity_id = inp.get("entity_id")
    entity_type = inp.get("entity_type")
    status = inp.get("status", "ACTIVE")

    alarms = await tb.get_alarms(
        entity_type=entity_type,
        entity_id=entity_id,
        status=status,
    )

    formatted = []
    for a in alarms:
        formatted.append({
            "type": a.get("type", ""),
            "severity": a.get("severity", ""),
            "status": a.get("status", ""),
            "originator_name": a.get("originatorName", ""),
            "originator_type": a.get("originator", {}).get("entityType", ""),
            "created_time": a.get("createdTime", 0),
            "details": a.get("details", {}),
        })

    return {
        "alarm_count": len(formatted),
        "status_filter": status,
        "alarms": formatted,
    }


async def _get_device_attributes(inp: dict, tb: TBClient, ctx: EntityContext | None = None) -> dict:
    """Fetch attributes for a device."""
    device_id = inp["device_id"]
    scope = inp.get("scope", "SERVER_SCOPE")

    dev = await _cached_get_device(device_id, tb)
    attrs = await tb.get_attributes("DEVICE", device_id, scope)

    return {
        "device_name": dev.get("name", ""),
        "device_id": device_id,
        "scope": scope,
        "attributes": attrs,
    }


async def _resolve_device_ids(entity_id: str, tb: TBClient) -> list[dict]:
    """If entity_id is a device, return it. If it's an asset (site), resolve child devices."""
    # Try as device first
    try:
        dev = await _cached_get_device(entity_id, tb)
        return [{"id": entity_id, "name": dev.get("name", "")}]
    except Exception:
        pass
    # Try as asset — get child device relations
    try:
        rels = await tb.get_entity_relations(entity_id, "ASSET")
        devices = []
        for rel in rels:
            child = rel["to"]
            if child["entityType"] == "DEVICE":
                dev = await _cached_get_device(child["id"], tb)
                devices.append({"id": child["id"], "name": dev.get("name", "")})
        if devices:
            return devices
    except Exception:
        pass
    return []


async def _send_dim_command(inp: dict, tb: TBClient, ctx: EntityContext | None = None) -> dict:
    """Set dim level via shared attributes for a device or all devices at a site."""
    device_id = inp["device_id"]
    dim_value = inp["dim_value"]
    confirmed = inp.get("confirmed", False)

    # Server-side range validation
    if not (0 <= dim_value <= 100):
        return {"error": "Dim value must be between 0 and 100"}

    devices = await _resolve_device_ids(device_id, tb)
    if not devices:
        return {"error": f"No devices found for ID {device_id}"}

    # Two-step confirmation flow
    if not confirmed:
        device_names = [d["name"] for d in devices]
        return {
            "requires_confirmation": True,
            "message": (
                f"Please confirm: set {len(devices)} device(s) to {dim_value}% — "
                f"{', '.join(device_names)}"
            ),
            "devices": devices,
            "dim_value": dim_value,
        }

    # Execute the command
    customer_id = ctx.customer_id if ctx else "unknown"
    results = []
    for dev in devices:
        logger.warning(
            "DIM_COMMAND customer=%s device=%s value=%d",
            customer_id, dev["id"], dim_value,
        )
        await tb.update_shared_attributes(dev["id"], {"dimLevel": dim_value})
        results.append({
            "device_name": dev["name"],
            "device_id": dev["id"],
            "dim_value": dim_value,
            "status": "sent",
        })

    return {
        "devices_commanded": len(results),
        "dim_value": dim_value,
        "results": results,
        "message": (
            f"Dim {dim_value}% sent to {len(results)} device(s): "
            f"{', '.join(d['name'] for d in devices)}"
        ),
    }


# ---------------------------------------------------------------------------
# Task command helpers
# ---------------------------------------------------------------------------

async def _write_task_command(tb: TBClient, device_id: str, command_dict: dict) -> dict:
    """Write a task_command shared attribute to a device (JSON string value)."""
    payload = {"task_command": json.dumps(command_dict)}
    await tb.update_shared_attributes(device_id, payload)
    return {"status": "sent", "device_id": device_id}


def _parse_time_slot(slot: dict) -> dict:
    """Convert Claude's human-friendly time slot to bridge format."""
    result = {
        "on_offset": max(-60, min(60, slot.get("on_offset", 0))),
        "off_offset": max(-60, min(60, slot.get("off_offset", 0))),
        "dim_value": max(0, min(100, slot["dim_value"])),
    }

    on_time = slot["on_time"].strip().lower()
    if on_time == "sunrise":
        result["on_event"] = "sunrise"
    elif on_time == "sunset":
        result["on_event"] = "sunset"
    else:
        parts = on_time.split(":")
        result["on_hour"] = int(parts[0])
        result["on_minute"] = int(parts[1])

    off_time = slot["off_time"].strip().lower()
    if off_time == "sunrise":
        result["off_event"] = "sunrise"
    elif off_time == "sunset":
        result["off_event"] = "sunset"
    else:
        parts = off_time.split(":")
        result["off_hour"] = int(parts[0])
        result["off_minute"] = int(parts[1])

    return result


def _format_time_slot_preview(slot: dict) -> str:
    """Format a time slot for human-readable preview."""
    on = slot["on_time"]
    off = slot["off_time"]
    dim = slot["dim_value"]
    on_off_str = slot.get("on_offset", 0)
    off_off_str = slot.get("off_offset", 0)
    on_label = on.capitalize() if on in ("sunrise", "sunset") else on
    off_label = off.capitalize() if off in ("sunrise", "sunset") else off
    if on_off_str:
        on_label += f" {on_off_str:+d}min"
    if off_off_str:
        off_label += f" {off_off_str:+d}min"
    return f"{on_label} -> {off_label} at {dim}%"


# ---------------------------------------------------------------------------
# Task schedule executor
# ---------------------------------------------------------------------------

async def _send_task_schedule(inp: dict, tb: TBClient, ctx: EntityContext | None = None) -> dict:
    """Deploy, update, or delete a DALI lighting schedule."""
    device_id = inp["device_id"]
    operation = inp["operation"]
    confirmed = inp.get("confirmed", False)
    time_slots = inp.get("time_slots", [])

    # Validation
    op_map = {"deploy": 1, "update": 2, "delete": 3}
    if operation not in op_map:
        return {"error": f"Invalid operation '{operation}'. Must be deploy, update, or delete."}

    if operation in ("update", "delete") and "profile_id" not in inp:
        return {"error": f"profile_id is required for {operation} operation."}

    if not time_slots and operation != "delete":
        return {"error": "At least one time_slot is required for deploy/update."}

    if len(time_slots) > 4:
        return {"error": "Maximum 4 time slots per schedule."}

    priority = inp.get("priority", 1)
    if not (1 <= priority <= 5):
        return {"error": "Priority must be between 1 and 5."}

    channel = inp.get("channel_number", 1)
    if channel < 1:
        return {"error": "Channel number must be >= 1."}

    for i, slot in enumerate(time_slots):
        if not (0 <= slot.get("dim_value", -1) <= 100):
            return {"error": f"Time slot {i+1}: dim_value must be 0-100."}
        on_t = slot.get("on_time", "").strip().lower()
        off_t = slot.get("off_time", "").strip().lower()
        for label, val in [("on_time", on_t), ("off_time", off_t)]:
            if val not in ("sunrise", "sunset"):
                try:
                    parts = val.split(":")
                    h, m = int(parts[0]), int(parts[1])
                    if not (0 <= h <= 23 and 0 <= m <= 59):
                        return {"error": f"Time slot {i+1}: {label} '{val}' out of range."}
                except (ValueError, IndexError):
                    return {"error": f"Time slot {i+1}: {label} must be 'HH:MM', 'sunrise', or 'sunset'."}

    devices = await _resolve_device_ids(device_id, tb)
    if not devices:
        return {"error": f"No devices found for ID {device_id}"}

    # Profile ID
    profile_id = inp.get("profile_id")
    if profile_id is None and operation == "deploy":
        profile_id = int(time.time()) % 100000

    # Dates
    today = date.today()
    start_str = inp.get("start_date", today.isoformat())
    try:
        start_dt = datetime.strptime(start_str, "%Y-%m-%d").date()
    except ValueError:
        return {"error": f"Invalid start_date format: '{start_str}'. Use YYYY-MM-DD."}

    end_str = inp.get("end_date", "forever")
    end_forever = end_str.lower() == "forever"
    end_dt = None
    if not end_forever:
        try:
            end_dt = datetime.strptime(end_str, "%Y-%m-%d").date()
        except ValueError:
            return {"error": f"Invalid end_date format: '{end_str}'. Use YYYY-MM-DD or 'forever'."}

    # Preview
    if not confirmed:
        slot_previews = [_format_time_slot_preview(s) for s in time_slots]
        end_label = "forever" if end_forever else end_str
        return {
            "requires_confirmation": True,
            "message": (
                f"Schedule {operation} on {len(devices)} device(s): "
                f"{', '.join(d['name'] for d in devices)}\n"
                f"Profile ID: {profile_id}\n"
                f"Period: {start_str} -> {end_label}\n"
                f"Priority: {priority}, Channel: {channel}\n"
                f"Time slots:\n" + "\n".join(f"  {i+1}. {s}" for i, s in enumerate(slot_previews))
            ),
            "devices": devices,
            "profile_id": profile_id,
            "operation": operation,
        }

    # Build bridge command JSON
    parsed_slots = [_parse_time_slot(s) for s in time_slots]

    command = {
        "command": "send_task",
        "operation_type": op_map[operation],
        "profile_id": profile_id,
        "start_year": start_dt.year,
        "start_month": start_dt.month,
        "start_day": start_dt.day,
        "end_forever": end_forever,
        "priority": priority,
        "cyclic_type": 5,
        "cyclic_time": 0,
        "off_days_mask": 0,
        "channel_number": channel,
        "time_slots": parsed_slots,
    }
    if not end_forever and end_dt:
        command["end_year"] = end_dt.year
        command["end_month"] = end_dt.month
        command["end_day"] = end_dt.day

    # Execute
    customer_id = ctx.customer_id if ctx else "unknown"
    results = []
    for dev in devices:
        logger.warning(
            "TASK_SCHEDULE customer=%s device=%s op=%s profile=%s",
            customer_id, dev["id"], operation, profile_id,
        )
        await _write_task_command(tb, dev["id"], command)
        results.append({
            "device_name": dev["name"],
            "device_id": dev["id"],
            "status": "sent",
        })

    return {
        "devices_commanded": len(results),
        "operation": operation,
        "profile_id": profile_id,
        "results": results,
        "message": (
            f"Schedule {operation} (profile {profile_id}) sent to "
            f"{len(results)} device(s): {', '.join(d['name'] for d in devices)}"
        ),
    }


# ---------------------------------------------------------------------------
# Query task schedule executor
# ---------------------------------------------------------------------------

async def _query_task_schedule(inp: dict, tb: TBClient, ctx: EntityContext | None = None) -> dict:
    """Query a schedule slot on a DALI controller."""
    device_id = inp["device_id"]
    task_index = inp.get("task_index", 0)

    if not (0 <= task_index <= 19):
        return {"error": "task_index must be 0-19."}

    # Send query command
    command = {"command": "task_request", "task_index": task_index}
    await _write_task_command(tb, device_id, command)

    # Brief wait for device response
    await asyncio.sleep(2)

    # Read back client attribute
    attrs = await tb.get_attributes(
        "DEVICE", device_id, "CLIENT_SCOPE", keys=["task_query_response"]
    )

    response_raw = attrs.get("task_query_response")
    if not response_raw:
        return {
            "query_sent": True,
            "task_index": task_index,
            "response": None,
            "message": (
                f"Query sent for schedule slot {task_index}. "
                "The device needs to send an uplink first (LoRaWAN Class A). "
                "The response will be available shortly — ask again in a few minutes."
            ),
        }

    # Parse the response
    try:
        if isinstance(response_raw, str):
            response_data = json.loads(response_raw)
        else:
            response_data = response_raw
    except (json.JSONDecodeError, TypeError):
        response_data = {"raw": response_raw}

    # Check staleness via received_at timestamp
    stale = False
    received_at = response_data.get("received_at")
    if received_at:
        try:
            if isinstance(received_at, (int, float)):
                age = time.time() - received_at
            else:
                age = time.time() - datetime.fromisoformat(str(received_at)).timestamp()
            stale = age > 30
        except (ValueError, TypeError):
            stale = True

    result = {
        "query_sent": True,
        "task_index": task_index,
        "response": response_data,
    }

    if stale:
        result["message"] = (
            f"Query sent for slot {task_index}. The current response may be "
            "from a previous query (stale). The fresh response hasn't arrived yet — "
            "try again in a few minutes after the device sends an uplink."
        )
    else:
        result["message"] = f"Schedule at slot {task_index} retrieved successfully."

    return result


# ---------------------------------------------------------------------------
# Location setup executor
# ---------------------------------------------------------------------------

async def _send_location_setup(inp: dict, tb: TBClient, ctx: EntityContext | None = None) -> dict:
    """Configure GPS coordinates and timezone on a DALI controller."""
    device_id = inp["device_id"]
    latitude = inp["latitude"]
    longitude = inp["longitude"]
    timezone_offset = inp["timezone"]
    confirmed = inp.get("confirmed", False)

    # Validation
    if not (-90 <= latitude <= 90):
        return {"error": "Latitude must be between -90 and 90."}
    if not (-180 <= longitude <= 180):
        return {"error": "Longitude must be between -180 and 180."}
    if not (-12 <= timezone_offset <= 14):
        return {"error": "Timezone must be between -12 and 14."}

    devices = await _resolve_device_ids(device_id, tb)
    if not devices:
        return {"error": f"No devices found for ID {device_id}"}

    if not confirmed:
        return {
            "requires_confirmation": True,
            "message": (
                f"Set location on {len(devices)} device(s): "
                f"{', '.join(d['name'] for d in devices)}\n"
                f"Latitude: {latitude}, Longitude: {longitude}\n"
                f"Timezone: UTC{timezone_offset:+.1f}"
            ),
            "devices": devices,
            "latitude": latitude,
            "longitude": longitude,
            "timezone": timezone_offset,
        }

    # Execute
    command = {
        "command": "location_setup",
        "latitude": latitude,
        "longitude": longitude,
        "timezone": timezone_offset,
    }

    customer_id = ctx.customer_id if ctx else "unknown"
    results = []
    for dev in devices:
        logger.warning(
            "LOCATION_SETUP customer=%s device=%s lat=%s lon=%s tz=%s",
            customer_id, dev["id"], latitude, longitude, timezone_offset,
        )
        await _write_task_command(tb, dev["id"], command)
        results.append({
            "device_name": dev["name"],
            "device_id": dev["id"],
            "status": "sent",
        })

    return {
        "devices_commanded": len(results),
        "results": results,
        "message": (
            f"Location (lat={latitude}, lon={longitude}, tz=UTC{timezone_offset:+.1f}) "
            f"sent to {len(results)} device(s): {', '.join(d['name'] for d in devices)}"
        ),
    }


# ---------------------------------------------------------------------------
# Delete task schedule executor
# ---------------------------------------------------------------------------

async def _delete_task_schedule(inp: dict, tb: TBClient, ctx: EntityContext | None = None) -> dict:
    """Delete a specific lighting schedule from a DALI controller by profile ID."""
    device_id = inp["device_id"]
    profile_id = inp["profile_id"]
    confirmed = inp.get("confirmed", False)

    if not isinstance(profile_id, int) or profile_id <= 0:
        return {"error": "profile_id must be a positive integer."}

    devices = await _resolve_device_ids(device_id, tb)
    if not devices:
        return {"error": f"No devices found for ID {device_id}"}

    if not confirmed:
        return {
            "requires_confirmation": True,
            "message": (
                f"Delete schedule (profile {profile_id}) from {len(devices)} device(s): "
                f"{', '.join(d['name'] for d in devices)}"
            ),
            "devices": devices,
            "profile_id": profile_id,
        }

    # Build delete command — operation_type 3, today's date, empty time_slots
    today = date.today()
    command = {
        "command": "send_task",
        "operation_type": 3,
        "profile_id": profile_id,
        "start_year": today.year,
        "start_month": today.month,
        "start_day": today.day,
        "end_forever": True,
        "priority": 1,
        "cyclic_type": 5,
        "cyclic_time": 0,
        "off_days_mask": 0,
        "channel_number": 1,
        "time_slots": [],
    }

    customer_id = ctx.customer_id if ctx else "unknown"
    results = []
    for dev in devices:
        logger.warning(
            "DELETE_SCHEDULE customer=%s device=%s profile=%s",
            customer_id, dev["id"], profile_id,
        )
        await _write_task_command(tb, dev["id"], command)
        results.append({
            "device_name": dev["name"],
            "device_id": dev["id"],
            "status": "sent",
        })

    return {
        "devices_deleted": len(results),
        "profile_id": profile_id,
        "results": results,
        "message": (
            f"Delete schedule (profile {profile_id}) sent to "
            f"{len(results)} device(s): {', '.join(d['name'] for d in devices)}"
        ),
    }


async def _compare_sites(inp: dict, tb: TBClient, ctx: EntityContext | None = None) -> dict:
    """Fetch summaries for multiple sites in parallel for comparison."""
    site_ids = inp["site_ids"]
    time_range = inp.get("time_range", "today")

    tasks = [
        _get_site_summary({"site_id": sid, "time_range": time_range}, tb)
        for sid in site_ids
    ]
    summaries = await asyncio.gather(*tasks, return_exceptions=True)

    results = []
    for sid, summary in zip(site_ids, summaries):
        if isinstance(summary, Exception):
            results.append({"site_id": sid, "error": str(summary)})
        else:
            results.append(summary)

    return {
        "time_range": time_range,
        "site_count": len(results),
        "sites": results,
    }
