"""Tests for chart_generator — run with pytest or standalone."""

import pathlib
import sys

import pytest

# Ensure the project root is importable
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.chart_generator import (  # noqa: E402
    co2_bar_chart,
    energy_bar_chart,
    generate_all_charts,
    status_donut_chart,
    to_base64_img,
)

# ---------------------------------------------------------------------------
# Shared mock data
# ---------------------------------------------------------------------------
MOCK_DATA: dict = {
    "sites": [
        {"name": "McDonald's Amsterdam", "energy_wh": 12500, "co2_grams": 5400, "online_count": 3, "offline_count": 1, "fault_count": 1},
        {"name": "Burger King Rotterdam", "energy_wh": 9800, "co2_grams": 4200, "online_count": 2, "offline_count": 0, "fault_count": 0},
        {"name": "Premier Inn Northampton West", "energy_wh": 18200, "co2_grams": 7800, "online_count": 5, "offline_count": 2, "fault_count": 1},
        {"name": "Tesco Express Leeds", "energy_wh": 6700, "co2_grams": 2900, "online_count": 1, "offline_count": 1, "fault_count": 0},
        {"name": "Costa Coffee Bristol", "energy_wh": 8400, "co2_grams": 3600, "online_count": 2, "offline_count": 0, "fault_count": 1},
        {"name": "Greggs Manchester Piccadilly", "energy_wh": 11000, "co2_grams": 4700, "online_count": 4, "offline_count": 1, "fault_count": 0},
    ],
}

PNG_MAGIC = b"\x89PNG"


# ---------------------------------------------------------------------------
# Pytest tests
# ---------------------------------------------------------------------------

class TestCharts:
    def test_energy_bar_chart(self):
        png = energy_bar_chart(MOCK_DATA)
        assert isinstance(png, bytes)
        assert len(png) > 1000
        assert png[:4] == PNG_MAGIC

    def test_co2_bar_chart(self):
        png = co2_bar_chart(MOCK_DATA)
        assert isinstance(png, bytes)
        assert len(png) > 1000
        assert png[:4] == PNG_MAGIC

    def test_status_donut_chart(self):
        png = status_donut_chart(MOCK_DATA)
        assert isinstance(png, bytes)
        assert len(png) > 1000
        assert png[:4] == PNG_MAGIC

    def test_generate_all_charts(self):
        charts = generate_all_charts(MOCK_DATA, ["energy", "co2", "summary"])
        assert "energy_bar" in charts
        assert "co2_bar" in charts
        assert "status_donut" in charts
        for v in charts.values():
            assert v[:4] == PNG_MAGIC

    def test_generate_all_charts_subset(self):
        charts = generate_all_charts(MOCK_DATA, ["energy"])
        assert "energy_bar" in charts
        assert "co2_bar" not in charts
        assert "status_donut" in charts

    def test_to_base64_img(self):
        png = energy_bar_chart(MOCK_DATA)
        uri = to_base64_img(png)
        assert uri.startswith("data:image/png;base64,")
        assert len(uri) > 100


# ---------------------------------------------------------------------------
# Standalone — generate & save PNGs for visual inspection
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    data_dir = pathlib.Path(__file__).resolve().parents[1] / "data"
    data_dir.mkdir(exist_ok=True)

    charts = {
        "test_energy_bar.png": energy_bar_chart(MOCK_DATA),
        "test_co2_bar.png": co2_bar_chart(MOCK_DATA),
        "test_status_donut.png": status_donut_chart(MOCK_DATA),
    }

    for name, png in charts.items():
        path = data_dir / name
        path.write_bytes(png)
        print(f"  {name}: {len(png):,} bytes -> {path}")

    print("\nAll charts saved to data/")
