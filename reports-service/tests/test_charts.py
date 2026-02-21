"""Tests for chart_generator — run with pytest or standalone."""

import pathlib
import sys
import time

import pytest

# Ensure the project root is importable
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.chart_generator import (  # noqa: E402
    co2_trend_chart,
    device_status_chart,
    dim_trend_chart,
    energy_trend_chart,
    generate_all_charts,
    to_base64_img,
)

# ---------------------------------------------------------------------------
# Shared mock data
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


MOCK_ENERGY_TREND = _make_trend(14, 8.0)
MOCK_CO2_TREND = _make_trend(14, 3.5)
MOCK_DIM_TREND = _make_trend(14, 60.0)

MOCK_REPORT_DATA: dict = {
    "energy_trend": MOCK_ENERGY_TREND,
    "co2_trend": MOCK_CO2_TREND,
    "dim_trend": MOCK_DIM_TREND,
    "device_count": 22,
    "online_count": 17,
    "offline_count": 3,
    "fault_count": 2,
}

PNG_MAGIC = b"\x89PNG"


# ---------------------------------------------------------------------------
# Pytest tests
# ---------------------------------------------------------------------------

class TestCharts:
    def test_energy_trend_chart(self):
        png = energy_trend_chart(MOCK_ENERGY_TREND)
        assert isinstance(png, bytes)
        assert len(png) > 1000
        assert png[:4] == PNG_MAGIC

    def test_energy_trend_single_point(self):
        """Single data point falls back to bar chart."""
        png = energy_trend_chart([{"ts": 1700000000000, "value": 5.0}])
        assert png[:4] == PNG_MAGIC

    def test_energy_trend_empty(self):
        """Empty data produces a placeholder chart."""
        png = energy_trend_chart([])
        assert png[:4] == PNG_MAGIC

    def test_co2_trend_chart(self):
        png = co2_trend_chart(MOCK_CO2_TREND)
        assert isinstance(png, bytes)
        assert len(png) > 1000
        assert png[:4] == PNG_MAGIC

    def test_dim_trend_chart(self):
        png = dim_trend_chart(MOCK_DIM_TREND)
        assert isinstance(png, bytes)
        assert len(png) > 1000
        assert png[:4] == PNG_MAGIC

    def test_dim_trend_empty(self):
        png = dim_trend_chart([])
        assert png[:4] == PNG_MAGIC

    def test_device_status_chart(self):
        png = device_status_chart(online=17, offline=3, fault=2, total=22)
        assert isinstance(png, bytes)
        assert len(png) > 1000
        assert png[:4] == PNG_MAGIC

    def test_device_status_all_zeros(self):
        """Edge case: no devices — should still render."""
        png = device_status_chart(online=0, offline=0, fault=0, total=0)
        assert png[:4] == PNG_MAGIC

    def test_generate_all_charts(self):
        charts = generate_all_charts(MOCK_REPORT_DATA, ["energy", "co2", "summary"])
        assert "energy_trend" in charts
        assert "co2_trend" in charts
        assert "dim_trend" in charts
        assert "status_donut" in charts
        # All values should be base64 data URIs
        for v in charts.values():
            assert isinstance(v, str)
            assert v.startswith("data:image/png;base64,")

    def test_generate_all_charts_subset(self):
        charts = generate_all_charts(MOCK_REPORT_DATA, ["energy"])
        assert "energy_trend" in charts
        assert "co2_trend" not in charts
        assert "status_donut" in charts

    def test_generate_all_charts_no_dim(self):
        data = {**MOCK_REPORT_DATA, "dim_trend": None}
        charts = generate_all_charts(data, ["energy", "co2"])
        assert "dim_trend" not in charts

    def test_bar_chart_for_short_period(self):
        """≤14 data points should produce a bar chart (still valid PNG)."""
        short = _make_trend(7, 5.0)
        png = energy_trend_chart(short)
        assert png[:4] == PNG_MAGIC
        assert len(png) > 1000

    def test_bar_chart_at_threshold(self):
        """Exactly 14 points should still use bar chart."""
        trend = _make_trend(14, 5.0)
        png = co2_trend_chart(trend)
        assert png[:4] == PNG_MAGIC
        assert len(png) > 1000

    def test_area_chart_above_threshold(self):
        """15+ data points should use area chart."""
        long = _make_trend(15, 5.0)
        png = energy_trend_chart(long)
        assert png[:4] == PNG_MAGIC
        assert len(png) > 1000

    def test_area_chart_long_period(self):
        """30 data points — area chart with dots."""
        long = _make_trend(30, 5.0)
        png = co2_trend_chart(long)
        assert png[:4] == PNG_MAGIC
        assert len(png) > 1000

    def test_to_base64_img(self):
        png = energy_trend_chart(MOCK_ENERGY_TREND)
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
        "test_energy_trend.png": energy_trend_chart(MOCK_ENERGY_TREND),
        "test_co2_trend.png": co2_trend_chart(MOCK_CO2_TREND),
        "test_dim_trend.png": dim_trend_chart(MOCK_DIM_TREND),
        "test_status_donut.png": device_status_chart(17, 3, 2, 22),
    }

    for name, png in charts.items():
        path = data_dir / name
        path.write_bytes(png)
        print(f"  {name}: {len(png):,} bytes -> {path}")

    print("\nAll charts saved to data/")
