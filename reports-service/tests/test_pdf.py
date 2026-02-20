"""Tests for pdf_renderer — run with pytest or standalone."""

import pathlib
import sys
from datetime import date

import pytest

# Ensure the project root is importable
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.chart_generator import generate_all_charts, to_base64_img  # noqa: E402
from services.pdf_renderer import render  # noqa: E402

# ---------------------------------------------------------------------------
# Mock data builder
# ---------------------------------------------------------------------------

def _build_report_data(include_charts: bool = True) -> dict:
    """Build a complete report_data dict with 6 sites, 3 faults, and totals."""
    sites = [
        {"name": "McDonald's Amsterdam", "energy_wh": 12500, "co2_grams": 5400,
         "online_count": 3, "offline_count": 1, "fault_count": 1},
        {"name": "Burger King Rotterdam", "energy_wh": 9800, "co2_grams": 4200,
         "online_count": 2, "offline_count": 0, "fault_count": 0},
        {"name": "Premier Inn Northampton", "energy_wh": 18200, "co2_grams": 7800,
         "online_count": 5, "offline_count": 2, "fault_count": 1},
        {"name": "Tesco Express Leeds", "energy_wh": 6700, "co2_grams": 2900,
         "online_count": 1, "offline_count": 1, "fault_count": 0},
        {"name": "Costa Coffee Bristol", "energy_wh": 8400, "co2_grams": 3600,
         "online_count": 2, "offline_count": 0, "fault_count": 1},
        {"name": "Greggs Manchester", "energy_wh": 11000, "co2_grams": 4700,
         "online_count": 4, "offline_count": 1, "fault_count": 0},
    ]

    total_energy_wh = sum(s["energy_wh"] for s in sites)
    total_co2_g = sum(s["co2_grams"] for s in sites)
    total_online = sum(s["online_count"] for s in sites)
    total_offline = sum(s["offline_count"] for s in sites)
    total_fault = sum(s["fault_count"] for s in sites)

    totals = {
        "site_count": len(sites),
        "device_count": total_online + total_offline + total_fault,
        "energy_kwh": total_energy_wh / 1000,
        "co2_kg": total_co2_g / 1000,
        "online_count": total_online,
        "offline_count": total_offline,
        "fault_count": total_fault,
    }

    faults = [
        {"date": "2026-02-18", "site": "McDonald's Amsterdam",
         "device": "Sign-AMS-01", "alarm_type": "Power Failure",
         "severity": "CRITICAL", "status": "Active"},
        {"date": "2026-02-17", "site": "Premier Inn Northampton",
         "device": "Sign-NOR-03", "alarm_type": "Connectivity Lost",
         "severity": "MAJOR", "status": "Cleared"},
        {"date": "2026-02-15", "site": "Costa Coffee Bristol",
         "device": "Sign-BRS-02", "alarm_type": "High Temperature",
         "severity": "WARNING", "status": "Active"},
    ]

    data = {
        "entity_name": "Lumosoft UK Fleet",
        "period": "1 Feb 2026 – 20 Feb 2026",
        "generated_date": date.today().isoformat(),
        "sites": sites,
        "totals": totals,
        "faults": faults,
        "charts": {},
    }

    if include_charts:
        charts = generate_all_charts(data, ["energy", "co2"])
        # Convert to base64 URIs for default usage
        data["charts"] = {k: to_base64_img(v) for k, v in charts.items()}

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
        pdf = render(data, sections=["summary", "energy", "faults"])
        assert isinstance(pdf, bytes)
        assert pdf[:5] == b"%PDF-"

    def test_render_accepts_raw_chart_bytes(self):
        data = _build_report_data(include_charts=False)
        # Put raw PNG bytes (not base64 URIs) in charts dict
        raw_charts = generate_all_charts(data, ["energy", "co2"])
        data["charts"] = raw_charts
        pdf = render(data, sections=["summary", "energy", "co2"])
        assert isinstance(pdf, bytes)
        assert pdf[:5] == b"%PDF-"
        assert len(pdf) > 5000

    def test_render_special_characters_in_names(self):
        data = _build_report_data(include_charts=False)
        data["entity_name"] = "O'Brien & Sons <Fleet>"
        data["sites"][0]["name"] = "McDonald's <Amsterdam>"
        data["faults"][0]["site"] = "McDonald's <Amsterdam>"
        data["faults"][0]["device"] = 'Sign "AMS" & 01'
        pdf = render(data, sections=["summary", "energy", "faults"])
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

    print("\nAll PDFs saved to data/")
