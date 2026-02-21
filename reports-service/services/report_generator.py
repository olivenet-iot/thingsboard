"""Report generation orchestrator.

Ties together TBClient, chart_generator, and pdf_renderer into a single
pipeline triggered by a ReportRequest.
"""

from __future__ import annotations

import calendar
import logging
import os
import time
import uuid
from collections import defaultdict
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
    """Convert an ISO-8601 string to epoch milliseconds."""
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

    # Exact calendar month (1st to last day)
    if s.year == e.year and s.month == e.month:
        last_day = calendar.monthrange(e.year, e.month)[1]
        if s.day == 1 and e.day >= last_day:
            return s.strftime("%B %Y")

    # Full year (Jan 1 - Dec 31)
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

    # Fallback: "1 Jan - 31 Mar 2026"
    return f"{s.day} {s.strftime('%b')} \u2013 {e.day} {e.strftime('%b')} {e.year}"


def _calculate_interval_ms(start_ts: int, end_ts: int) -> tuple[int, str]:
    """Pick a trend interval based on the period length.

    Returns (interval_ms, label) where label is 'hourly'/'daily'/'weekly'.
    """
    duration_ms = end_ts - start_ts
    one_day = 86_400_000

    if duration_ms <= 90 * one_day:
        return one_day, "daily"
    else:
        return 7 * one_day, "weekly"


def _transform_alarms(alarms: list[dict], site_name: str) -> list[dict]:
    """Convert ThingsBoard AlarmInfo dicts to template-friendly fault dicts."""
    faults: list[dict] = []
    for a in alarms:
        created_ms = a.get("createdTime", 0)
        cleared_ms = a.get("endTs", 0) or a.get("clearTs", 0)
        created_dt = datetime.utcfromtimestamp(created_ms / 1000)
        date_str = created_dt.strftime("%d %b %H:%M")

        # Compute duration
        duration_str = ""
        status_raw = a.get("status", "")
        if cleared_ms and cleared_ms > created_ms:
            delta_s = (cleared_ms - created_ms) / 1000
            if delta_s < 3600:
                duration_str = f"{int(delta_s / 60)}m"
            elif delta_s < 86400:
                hours = int(delta_s / 3600)
                mins = int((delta_s % 3600) / 60)
                duration_str = f"{hours}h {mins}m"
            else:
                days = int(delta_s / 86400)
                hours = int((delta_s % 86400) / 3600)
                duration_str = f"{days}d {hours}h"
        elif status_raw.startswith("ACTIVE"):
            duration_str = "ongoing"

        faults.append({
            "date": date_str,
            "site": site_name,
            "device": a.get("originatorName", "Unknown"),
            "alarm_type": a.get("type", "Unknown"),
            "severity": a.get("severity", "MAJOR"),
            "status": "Active" if status_raw.startswith("ACTIVE") else "Cleared",
            "duration": duration_str,
        })
    return faults


def _aggregate_trend(
    all_device_trends: list[dict[str, list[dict]]],
    key: str,
) -> list[dict]:
    """Aggregate trend data across devices into a single time series.

    Each device trend is {key: [{ts, value}, ...]}.  Sum values that
    share the same timestamp bucket.
    """
    bucket_sums: dict[int, float] = defaultdict(float)
    for device_trend in all_device_trends:
        for point in device_trend.get(key, []):
            bucket_sums[point["ts"]] += point["value"]

    return [{"ts": ts, "value": val} for ts, val in sorted(bucket_sums.items())]


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

    try:
        tb = TBClient()
        tb.authenticate()

        tb_entity_type = _map_entity_type(request.entityType)
        hierarchy = tb.resolve_hierarchy(request.entityId, tb_entity_type)

        start_ts = _iso_to_epoch_ms(request.period.start)
        end_ts = _iso_to_epoch_ms(request.period.end)
        period_label = _make_period_label(request.period.start, request.period.end)
        interval_ms, interval_label = _calculate_interval_ms(start_ts, end_ts)

        # -- Collect per-device data ----------------------------------------
        devices_detail: list[dict] = []
        all_faults: list[dict] = []
        energy_trends: list[dict[str, list[dict]]] = []
        co2_trends: list[dict[str, list[dict]]] = []
        dim_trends: list[dict[str, list[dict]]] = []

        total_online = 0
        total_offline = 0
        total_fault = 0
        total_energy_wh = 0.0
        total_co2_grams = 0.0

        for site in hierarchy.sites:
            for device in site.devices:
                # Energy + CO2 totals
                dev_energy = tb.get_telemetry_sum(device.id, "energy_wh", start_ts, end_ts)
                dev_co2 = tb.get_telemetry_sum(device.id, "co2_grams", start_ts, end_ts)
                total_energy_wh += dev_energy
                total_co2_grams += dev_co2

                # Device status + last activity time (single API call)
                attrs = tb.get_attributes(device.id, "DEVICE", "SERVER_SCOPE", ["lastActivityTime"])
                last_ts = attrs.get("lastActivityTime", 0)
                active = bool(last_ts and (time.time() * 1000 - last_ts) < 600_000)
                last_active_str = ""
                if last_ts:
                    last_active_str = datetime.utcfromtimestamp(last_ts / 1000).strftime("%d %b %H:%M")

                # Per-device alarm fetch (for fault detection + fault log)
                dev_alarms = []
                has_active_fault = False
                need_alarms = "faults" in request.sections or "summary" in request.sections
                if need_alarms:
                    dev_alarms = tb.get_alarm_history(device.id, "DEVICE", start_ts, end_ts)
                    has_active_fault = any(
                        "ACTIVE" in a.get("status", "") for a in dev_alarms
                    )
                    if "faults" in request.sections:
                        dev_faults = _transform_alarms(dev_alarms, site.name)
                        all_faults.extend(dev_faults)

                # 3-way device status (fault takes priority)
                if has_active_fault:
                    total_fault += 1
                    dev_status = "Fault"
                elif active:
                    total_online += 1
                    dev_status = "Online"
                else:
                    total_offline += 1
                    dev_status = "Offline"

                # Trend data for charts
                if "energy" in request.sections or "co2" in request.sections:
                    trend = tb.get_telemetry_trend(
                        device.id, "energy_wh,co2_grams", start_ts, end_ts, interval_ms
                    )
                    energy_trends.append(trend)
                    co2_trends.append(trend)

                # Dim level trend (best-effort)
                try:
                    dim = tb.get_telemetry_trend(
                        device.id, "dim_level", start_ts, end_ts, interval_ms
                    )
                    if dim.get("dim_level"):
                        dim_trends.append(dim)
                except Exception:
                    pass

                # Per-device detail record
                devices_detail.append({
                    "name": device.name,
                    "site": site.name,
                    "status": dev_status,
                    "last_active": last_active_str,
                    "energy_kwh": round(dev_energy / 1000, 2),
                    "co2_kg": round(dev_co2 / 1000, 2),
                })

        # Sort faults by date descending
        all_faults.sort(key=lambda f: f["date"], reverse=True)

        # Sort devices by energy desc
        devices_detail.sort(key=lambda d: d["energy_kwh"], reverse=True)

        # -- Aggregate trends -----------------------------------------------
        energy_trend_agg = _aggregate_trend(energy_trends, "energy_wh")
        # Convert Wh -> kWh for chart
        for p in energy_trend_agg:
            p["value"] = round(p["value"] / 1000, 2)

        co2_trend_agg = _aggregate_trend(co2_trends, "co2_grams")
        # Convert grams -> kg for chart
        for p in co2_trend_agg:
            p["value"] = round(p["value"] / 1000, 2)

        dim_trend_agg = _aggregate_trend(dim_trends, "dim_level") if dim_trends else None
        # Average dim values (they were summed)
        if dim_trend_agg and dim_trends:
            num_devices_with_dim = len(dim_trends)
            for p in dim_trend_agg:
                p["value"] = round(p["value"] / num_devices_with_dim, 1)

        # -- Compute summary stats ------------------------------------------
        device_count = total_online + total_offline + total_fault
        energy_kwh = round(total_energy_wh / 1000, 2)
        co2_kg = round(total_co2_grams / 1000, 2)

        # Daily average and peak from trend
        daily_avg_kwh = 0.0
        peak_kwh = 0.0
        if energy_trend_agg:
            values = [p["value"] for p in energy_trend_agg]
            daily_avg_kwh = round(sum(values) / len(values), 2)
            peak_kwh = round(max(values), 2)

        daily_avg_co2 = 0.0
        peak_co2 = 0.0
        if co2_trend_agg:
            values = [p["value"] for p in co2_trend_agg]
            daily_avg_co2 = round(sum(values) / len(values), 2)
            peak_co2 = round(max(values), 2)

        # -- Build report_data dict -----------------------------------------
        report_data = {
            "entity_name": hierarchy.name,
            "entity_type": request.entityType,
            "period": period_label,
            "generated_date": datetime.utcnow().strftime("%d %b %Y %H:%M UTC"),

            # KPI fields
            "site_count": len(hierarchy.sites),
            "device_count": device_count,
            "online_count": total_online,
            "offline_count": total_offline,
            "fault_count": total_fault,
            "energy_kwh": energy_kwh,
            "co2_kg": co2_kg,

            # Trend data for charts
            "energy_trend": energy_trend_agg,
            "co2_trend": co2_trend_agg,
            "dim_trend": dim_trend_agg,

            # Summary stats
            "daily_avg_kwh": daily_avg_kwh,
            "peak_kwh": peak_kwh,
            "daily_avg_co2": daily_avg_co2,
            "peak_co2": peak_co2,
            "interval_label": interval_label,

            # Per-device detail
            "devices": devices_detail,

            # Fault log
            "faults": all_faults,
            "alarm_count": len(all_faults),

            # Charts (populated below)
            "charts": {},
        }

        if devices_detail or hierarchy.sites:
            report_data["charts"] = generate_all_charts(report_data, request.sections)

        pdf_bytes = pdf_renderer.render(report_data, request.sections)
        save_pdf(report_id, pdf_bytes)

        # Save success metadata
        from services.report_store import save_report_metadata
        pdf_path = os.path.join(config.PDF_STORAGE_PATH, f"{report_id}.pdf")
        save_report_metadata({
            "id": report_id,
            "entity_id": request.entityId,
            "entity_type": request.entityType,
            "period_start": request.period.start,
            "period_end": request.period.end,
            "sections": request.sections,
            "recipients": request.emails,
            "status": "success",
            "error_message": None,
            "pdf_path": pdf_path,
            "file_size_bytes": len(pdf_bytes),
            "generated_at": datetime.utcnow().isoformat() + "Z",
        })

        # Email delivery (optional)
        email_result = None
        if request.sendEmail and request.emails:
            from services.email_sender import send_report

            smtp_config = {
                "host": config.SMTP_HOST,
                "port": config.SMTP_PORT,
                "username": config.SMTP_USERNAME,
                "password": config.SMTP_PASSWORD,
                "from_addr": config.SMTP_FROM,
            }
            subject = f"SignConnect Report: {hierarchy.name} \u2014 {period_label}"
            email_result = send_report(request.emails, subject, pdf_path, report_data, smtp_config)

        generated_at = datetime.utcnow().isoformat() + "Z"
        download_url = f"/api/report/download/{report_id}"

        logger.info("Report %s complete \u2014 %d devices, %d faulty, %d alarm events",
                     report_id, device_count, total_fault, len(all_faults))

        # Build result message based on email outcome
        if email_result and email_result["sent"]:
            n = len(request.emails)
            message = f"Report generated for {hierarchy.name} ({period_label}) and sent to {n} recipient(s)"
        elif email_result and not email_result["sent"]:
            message = f"Report generated for {hierarchy.name} ({period_label}). Email failed: {email_result['error']}"
        else:
            message = f"Report generated for {hierarchy.name} ({period_label})"

        return ReportResult(
            status="success",
            reportId=report_id,
            message=message,
            downloadUrl=download_url,
            generatedAt=generated_at,
        )

    except Exception as exc:
        # Save failure metadata so the history records the attempt
        try:
            from services.report_store import save_report_metadata
            save_report_metadata({
                "id": report_id,
                "entity_id": request.entityId,
                "entity_type": request.entityType,
                "period_start": request.period.start,
                "period_end": request.period.end,
                "sections": request.sections,
                "recipients": request.emails,
                "status": "failed",
                "error_message": str(exc),
                "pdf_path": None,
                "file_size_bytes": None,
                "generated_at": datetime.utcnow().isoformat() + "Z",
            })
        except Exception:
            logger.exception("Failed to save failure metadata for %s", report_id)
        raise
