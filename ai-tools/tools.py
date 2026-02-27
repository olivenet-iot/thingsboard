"""Claude tool definitions and execution logic."""

from __future__ import annotations

import asyncio
import logging
import time

from config import resolve_time_range
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
            "and their devices. Returns the full tree structure. Use this "
            "when user asks about their sites, locations, or overall structure."
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
                        "Use SUM for energy_wh, AVG for power_watts."
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
            "Send a dim command to a lighting controller. Sets the DALI "
            "dim level (0-100%). IMPORTANT: Always confirm with the user "
            "before sending commands. Use when user explicitly asks to "
            "change brightness or dim level."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "device_id": {
                    "type": "string",
                    "description": "Device UUID",
                },
                "dim_value": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 100,
                    "description": (
                        "Dim level percentage (0=off, 100=full brightness)"
                    ),
                },
            },
            "required": ["device_id", "dim_value"],
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
    tool_name: str, tool_input: dict, tb: TBClient
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
        "compare_sites": _compare_sites,
    }
    executor = executors.get(tool_name)
    if executor is None:
        return {"error": f"Unknown tool: {tool_name}"}

    try:
        return await executor(tool_input, tb)
    except Exception as exc:
        logger.exception("Tool %s failed", tool_name)
        return {"error": f"Tool {tool_name} failed: {exc}"}


# ---------------------------------------------------------------------------
# Individual tool executors
# ---------------------------------------------------------------------------

async def _get_hierarchy(inp: dict, tb: TBClient) -> dict:
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
                dev = await tb.get_device(child["id"])
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
                asset = await tb.get_asset(child["id"])
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
                    asset = await tb.get_asset(child["id"])
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


async def _get_site_summary(inp: dict, tb: TBClient) -> dict:
    """Aggregate telemetry across all devices at a site."""
    site_id = inp["site_id"]
    time_range = inp.get("time_range", "today")
    start_ts, end_ts = resolve_time_range(time_range)

    site = await tb.get_asset(site_id)
    rels = await tb.get_entity_relations(site_id, "ASSET")

    device_ids: list[tuple[str, str]] = []  # (id, name)
    for rel in rels:
        child = rel["to"]
        if child["entityType"] == "DEVICE":
            dev = await tb.get_device(child["id"])
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


async def _get_device_telemetry(inp: dict, tb: TBClient) -> dict:
    """Fetch latest or historical telemetry for a device."""
    device_id = inp["device_id"]
    keys = inp["keys"]
    time_range = inp.get("time_range", "latest")
    agg = inp.get("aggregation", "SUM")

    dev = await tb.get_device(device_id)
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


async def _get_energy_savings(inp: dict, tb: TBClient) -> dict:
    """Get savings metrics for a device or all devices at a site."""
    entity_id = inp["entity_id"]
    entity_type = inp["entity_type"]
    time_range = inp.get("time_range", "today")
    start_ts, end_ts = resolve_time_range(time_range)

    savings_keys = [
        "energy_saving_wh", "saving_pct", "cost_saving", "co2_saving_grams",
    ]

    if entity_type == "DEVICE":
        dev = await tb.get_device(entity_id)
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
    site = await tb.get_asset(entity_id)
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
        dev = await tb.get_device(child["id"])
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


async def _get_alarms(inp: dict, tb: TBClient) -> dict:
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


async def _get_device_attributes(inp: dict, tb: TBClient) -> dict:
    """Fetch attributes for a device."""
    device_id = inp["device_id"]
    scope = inp.get("scope", "SERVER_SCOPE")

    dev = await tb.get_device(device_id)
    attrs = await tb.get_attributes("DEVICE", device_id, scope)

    return {
        "device_name": dev.get("name", ""),
        "device_id": device_id,
        "scope": scope,
        "attributes": attrs,
    }


async def _send_dim_command(inp: dict, tb: TBClient) -> dict:
    """Send an RPC dim command to a device."""
    device_id = inp["device_id"]
    dim_value = inp["dim_value"]

    dev = await tb.get_device(device_id)
    await tb.send_rpc(device_id, "dim", {"value": dim_value})

    return {
        "device_name": dev.get("name", ""),
        "device_id": device_id,
        "dim_value": dim_value,
        "status": "sent",
        "message": (
            f"Dim command sent to {dev.get('name', device_id)}: "
            f"{dim_value}%"
        ),
    }


async def _compare_sites(inp: dict, tb: TBClient) -> dict:
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
