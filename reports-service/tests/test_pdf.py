"""Tests for pdf_renderer — run with pytest or standalone."""

import pathlib
import sys
import time
from datetime import date

import pytest

# Ensure the project root is importable
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.chart_generator import generate_all_charts  # noqa: E402
from services.pdf_renderer import render  # noqa: E402

# ---------------------------------------------------------------------------
# Mock data builder
# ---------------------------------------------------------------------------

def _make_trend(num_points: int = 14, base_value: float = 10.0) -> list[dict]:
    """Generate fake trend data: [{ts, value}, ...]."""
    now_ms = int(time.time() * 1000)
    day_ms = 86_400_000
    return [
        {"ts": now_ms - (num_points - i) * day_ms,
         "value": round(base_value + i * 0.5 + (i % 3) * 2.0, 2)}
        for i in range(num_points)
    ]


def _build_report_data(include_charts: bool = True) -> dict:
    """Build a complete report_data dict with devices, faults, trends, and KPIs."""
    devices = [
        {"name": "Sign-AMS-01", "site": "McDonald's Amsterdam", "status": "Fault",
         "last_active": "20 Feb 14:30", "energy_kwh": 12.5, "co2_kg": 5.4},
        {"name": "Sign-AMS-02", "site": "McDonald's Amsterdam", "status": "Online",
         "last_active": "20 Feb 14:28", "energy_kwh": 9.8, "co2_kg": 4.2},
        {"name": "Sign-RTD-01", "site": "Burger King Rotterdam", "status": "Online",
         "last_active": "20 Feb 14:25", "energy_kwh": 18.2, "co2_kg": 7.8},
        {"name": "Sign-NOR-01", "site": "Premier Inn Northampton", "status": "Offline",
         "last_active": "18 Feb 09:15", "energy_kwh": 6.7, "co2_kg": 2.9},
        {"name": "Sign-NOR-02", "site": "Premier Inn Northampton", "status": "Online",
         "last_active": "20 Feb 14:22", "energy_kwh": 8.4, "co2_kg": 3.6},
        {"name": "Sign-LDS-01", "site": "Tesco Express Leeds", "status": "Online",
         "last_active": "20 Feb 14:18", "energy_kwh": 11.0, "co2_kg": 4.7},
    ]

    energy_trend = _make_trend(14, 8.0)
    co2_trend = _make_trend(14, 3.5)
    dim_trend = _make_trend(14, 60.0)

    total_energy = sum(d["energy_kwh"] for d in devices)
    total_co2 = sum(d["co2_kg"] for d in devices)

    energy_values = [p["value"] for p in energy_trend]
    co2_values = [p["value"] for p in co2_trend]

    faults = [
        {"date": "18 Feb 08:30", "site": "McDonald's Amsterdam",
         "device": "Sign-AMS-01", "alarm_type": "Power Failure",
         "severity": "CRITICAL", "status": "Active", "duration": "ongoing"},
        {"date": "17 Feb 14:12", "site": "Premier Inn Northampton",
         "device": "Sign-NOR-03", "alarm_type": "Connectivity Lost",
         "severity": "MAJOR", "status": "Cleared", "duration": "3h 22m"},
        {"date": "15 Feb 09:45", "site": "Costa Coffee Bristol",
         "device": "Sign-BRS-02", "alarm_type": "High Temperature",
         "severity": "WARNING", "status": "Active", "duration": "ongoing"},
    ]

    data = {
        "entity_name": "Lumosoft UK Fleet",
        "entity_type": "estate",
        "period": "1 Feb \u2013 20 Feb 2026",
        "generated_date": date.today().strftime("%d %b %Y %H:%M UTC"),

        # KPIs
        "site_count": 4,
        "device_count": 6,
        "online_count": 4,
        "offline_count": 1,
        "fault_count": 1,
        "alarm_count": 3,
        "energy_kwh": round(total_energy, 2),
        "co2_kg": round(total_co2, 2),

        # Trends
        "energy_trend": energy_trend,
        "co2_trend": co2_trend,
        "dim_trend": dim_trend,

        # Stats
        "daily_avg_kwh": round(sum(energy_values) / len(energy_values), 2),
        "peak_kwh": round(max(energy_values), 2),
        "daily_avg_co2": round(sum(co2_values) / len(co2_values), 2),
        "peak_co2": round(max(co2_values), 2),
        "interval_label": "daily",

        # Devices & faults
        "devices": devices,
        "faults": faults,
        "charts": {},
    }

    if include_charts:
        data["charts"] = generate_all_charts(data, ["energy", "co2"])

    return data


# ---------------------------------------------------------------------------
# Pytest tests
# ---------------------------------------------------------------------------

class TestPdfRenderer:
    def test_render_returns_pdf_bytes(self):
        data = _build_report_data()
        pdf = render(data)
        assert isinstance(pdf, bytes)
        assert pdf[:5] == b"%PDF-"
        assert len(pdf) > 5000

    def test_render_all_sections(self):
        data = _build_report_data()
        pdf = render(data, sections=["summary", "energy", "co2", "faults"])
        assert pdf[:5] == b"%PDF-"
        assert len(pdf) > 10000

    def test_render_minimal_sections(self):
        data = _build_report_data(include_charts=False)
        pdf = render(data, sections=["summary"])
        assert isinstance(pdf, bytes)
        assert pdf[:5] == b"%PDF-"

    def test_render_without_faults(self):
        data = _build_report_data()
        data["faults"] = []
        data["fault_count"] = 0
        data["alarm_count"] = 0
        pdf = render(data, sections=["summary", "energy", "faults"])
        assert isinstance(pdf, bytes)
        assert pdf[:5] == b"%PDF-"

    def test_render_no_dim_data(self):
        data = _build_report_data()
        data["dim_trend"] = None
        data["charts"].pop("dim_trend", None)
        pdf = render(data, sections=["summary", "energy", "co2"])
        assert isinstance(pdf, bytes)
        assert pdf[:5] == b"%PDF-"

    def test_render_special_characters_in_names(self):
        data = _build_report_data(include_charts=False)
        data["entity_name"] = "O'Brien & Sons <Fleet>"
        data["devices"][0]["name"] = "Sign \"AMS\" & 01"
        data["devices"][0]["site"] = "McDonald's <Amsterdam>"
        data["faults"][0]["site"] = "McDonald's <Amsterdam>"
        data["faults"][0]["device"] = 'Sign "AMS" & 01'
        pdf = render(data, sections=["summary", "energy", "faults"])
        assert isinstance(pdf, bytes)
        assert pdf[:5] == b"%PDF-"

    def test_render_energy_only(self):
        data = _build_report_data()
        pdf = render(data, sections=["energy"])
        assert isinstance(pdf, bytes)
        assert pdf[:5] == b"%PDF-"

    def test_render_faults_only(self):
        data = _build_report_data(include_charts=False)
        pdf = render(data, sections=["faults"])
        assert isinstance(pdf, bytes)
        assert pdf[:5] == b"%PDF-"


# ---------------------------------------------------------------------------
# Standalone — generate PDFs for visual inspection
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    data_dir = pathlib.Path(__file__).resolve().parents[1] / "data"
    data_dir.mkdir(exist_ok=True)

    # Full report
    data = _build_report_data(include_charts=True)
    pdf_full = render(data, sections=["summary", "energy", "co2", "faults"])
    full_path = data_dir / "test_report.pdf"
    full_path.write_bytes(pdf_full)
    print(f"  test_report.pdf: {len(pdf_full):,} bytes -> {full_path}")

    # Minimal report (summary only)
    data_min = _build_report_data(include_charts=False)
    pdf_min = render(data_min, sections=["summary"])
    min_path = data_dir / "test_report_minimal.pdf"
    min_path.write_bytes(pdf_min)
    print(f"  test_report_minimal.pdf: {len(pdf_min):,} bytes -> {min_path}")

    # No faults
    data_nf = _build_report_data(include_charts=True)
    data_nf["faults"] = []
    data_nf["fault_count"] = 0
    data_nf["alarm_count"] = 0
    pdf_nf = render(data_nf, sections=["summary", "energy", "co2", "faults"])
    nf_path = data_dir / "test_report_no_faults.pdf"
    nf_path.write_bytes(pdf_nf)
    print(f"  test_report_no_faults.pdf: {len(pdf_nf):,} bytes -> {nf_path}")

    print("\nAll PDFs saved to data/")
