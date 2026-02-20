"""Report generation orchestrator.

Ties together TBClient, chart_generator, and pdf_renderer into a single
pipeline triggered by a ReportRequest.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime

from pydantic import BaseModel

import config
from services.tb_client import TBClient
from services.chart_generator import generate_all_charts
from services import pdf_renderer

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class PeriodSpec(BaseModel):
    start: str   # ISO 8601, e.g. "2026-01-01T00:00:00Z"
    end: str


class ReportRequest(BaseModel):
    entityId: str
    entityType: str               # "site" | "region" | "estate" | "customer"
    period: PeriodSpec
    sections: list[str] = ["summary", "energy", "co2", "faults"]
    emails: list[str] = []
    sendEmail: bool = False


class ReportResult(BaseModel):
    status: str
    reportId: str
    message: str
    downloadUrl: str
    generatedAt: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _iso_to_epoch_ms(iso_str: str) -> int:
    """Convert an ISO-8601 string to epoch milliseconds.

    Handles the ``Z`` suffix that Python 3.10's ``fromisoformat`` rejects.
    """
    s = iso_str.replace("Z", "+00:00")
    return int(datetime.fromisoformat(s).timestamp() * 1000)


def _map_entity_type(raw: str) -> str:
    """Map user-facing entity type to ThingsBoard entity type."""
    mapping = {
        "estate": "ASSET",
        "region": "ASSET",
        "site": "ASSET",
        "customer": "CUSTOMER",
    }
    key = raw.lower()
    if key not in mapping:
        raise ValueError(f"Unsupported entity type: {raw!r}")
    return mapping[key]


def _make_period_label(start_iso: str, end_iso: str) -> str:
    """Build a human-friendly label for the report period."""
    s = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    e = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))

    # Same month
    if s.year == e.year and s.month == e.month:
        return s.strftime("%B %Y")

    # Full year (Jan 1 – Dec 31)
    if s.month == 1 and s.day == 1 and e.month == 12 and e.day == 31 and s.year == e.year:
        return str(s.year)

    # Quarter-aligned
    quarter_starts = {1: "Q1", 4: "Q2", 7: "Q3", 10: "Q4"}
    quarter_ends = {3: "Q1", 6: "Q2", 9: "Q3", 12: "Q4"}
    if (s.day == 1 and s.month in quarter_starts
            and e.month in quarter_ends
            and quarter_starts[s.month] == quarter_ends[e.month]
            and s.year == e.year):
        return f"{quarter_starts[s.month]} {s.year}"

    # Fallback: "1 Jan – 31 Mar 2026"
    return f"{s.day} {s.strftime('%b')} \u2013 {e.day} {e.strftime('%b')} {e.year}"


def _transform_alarms(alarms: list[dict], site_name: str) -> list[dict]:
    """Convert ThingsBoard AlarmInfo dicts to template-friendly fault dicts."""
    faults: list[dict] = []
    for a in alarms:
        created_ms = a.get("createdTime", 0)
        date_str = datetime.utcfromtimestamp(created_ms / 1000).strftime("%Y-%m-%d")
        status_raw = a.get("status", "")
        faults.append({
            "date": date_str,
            "site": site_name,
            "device": a.get("originatorName", "Unknown"),
            "alarm_type": a.get("type", "Unknown"),
            "severity": a.get("severity", "MAJOR"),
            "status": "Active" if status_raw.startswith("ACTIVE") else "Cleared",
        })
    return faults


def calculate_totals(sites: list[dict]) -> dict:
    """Aggregate totals across all sites."""
    return {
        "site_count": len(sites),
        "device_count": sum(s["device_count"] for s in sites),
        "energy_kwh": round(sum(s["energy_wh"] for s in sites) / 1000, 2),
        "co2_kg": round(sum(s["co2_grams"] for s in sites) / 1000, 2),
        "online_count": sum(s["online_count"] for s in sites),
        "offline_count": sum(s["offline_count"] for s in sites),
        "fault_count": sum(s["fault_count"] for s in sites),
    }


def save_pdf(report_id: str, pdf_bytes: bytes) -> str:
    """Save PDF bytes to disk and return the file path."""
    storage_dir = config.PDF_STORAGE_PATH
    os.makedirs(storage_dir, exist_ok=True)
    file_path = os.path.join(storage_dir, f"{report_id}.pdf")
    with open(file_path, "wb") as f:
        f.write(pdf_bytes)
    logger.info("Saved PDF: %s (%d bytes)", file_path, len(pdf_bytes))
    return file_path


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def generate_report(request: ReportRequest) -> ReportResult:
    """Generate a full PDF report and return the result metadata."""
    report_id = f"rpt-{uuid.uuid4()}"
    logger.info("Starting report %s for %s/%s", report_id, request.entityType, request.entityId)

    tb = TBClient()
    tb.authenticate()

    tb_entity_type = _map_entity_type(request.entityType)
    hierarchy = tb.resolve_hierarchy(request.entityId, tb_entity_type)

    start_ts = _iso_to_epoch_ms(request.period.start)
    end_ts = _iso_to_epoch_ms(request.period.end)
    period_label = _make_period_label(request.period.start, request.period.end)

    sites_data: list[dict] = []
    all_faults: list[dict] = []

    for site in hierarchy.sites:
        site_energy_wh = 0.0
        site_co2_grams = 0.0
        site_online = 0
        site_offline = 0

        for device in site.devices:
            site_energy_wh += tb.get_telemetry_sum(device.id, "energy_wh", start_ts, end_ts)
            site_co2_grams += tb.get_telemetry_sum(device.id, "co2_grams", start_ts, end_ts)
            if tb.is_device_active(device.id):
                site_online += 1
            else:
                site_offline += 1

        site_faults: list[dict] = []
        if "faults" in request.sections:
            raw_alarms = tb.get_alarm_history(site.id, "ASSET", start_ts, end_ts)
            site_faults = _transform_alarms(raw_alarms, site.name)
            all_faults.extend(site_faults)

        sites_data.append({
            "name": site.name,
            "device_count": len(site.devices),
            "energy_wh": site_energy_wh,
            "co2_grams": site_co2_grams,
            "online_count": site_online,
            "offline_count": site_offline,
            "fault_count": len(site_faults),
        })

    totals = calculate_totals(sites_data)

    report_data = {
        "entity_name": hierarchy.name,
        "entity_type": request.entityType,
        "period": period_label,
        "generated_date": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "sites": sites_data,
        "faults": all_faults,
        "totals": totals,
        "charts": {},
    }

    if sites_data:
        report_data["charts"] = generate_all_charts(report_data, request.sections)

    pdf_bytes = pdf_renderer.render(report_data, request.sections)
    save_pdf(report_id, pdf_bytes)

    generated_at = datetime.utcnow().isoformat() + "Z"
    download_url = f"/api/report/download/{report_id}"

    logger.info("Report %s complete — %d sites, %d faults", report_id, len(sites_data), len(all_faults))

    return ReportResult(
        status="success",
        reportId=report_id,
        message=f"Report generated for {hierarchy.name} ({period_label})",
        downloadUrl=download_url,
        generatedAt=generated_at,
    )
