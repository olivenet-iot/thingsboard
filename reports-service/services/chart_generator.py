"""Chart generation for SignConnect reports.

Produces matplotlib charts as base64 data-URI strings for embedding
directly in the Jinja2 HTML template.
"""

import io
import base64
from datetime import datetime

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.dates as mdates  # noqa: E402


# ---------------------------------------------------------------------------
# Style constants
# ---------------------------------------------------------------------------
_SLATE_900 = "#0f172a"
_SLATE_600 = "#475569"
_GRID_COLOR = "#e2e8f0"
_AMBER = "#f59e0b"
_AMBER_LIGHT = "#fef3c7"
_AMBER_EDGE = "#d97706"
_EMERALD = "#059669"
_EMERALD_LIGHT = "#d1fae5"
_EMERALD_EDGE = "#047857"
_INDIGO = "#6366f1"
_INDIGO_LIGHT = "#e0e7ff"
_INDIGO_EDGE = "#4f46e5"
_SLATE_400 = "#94a3b8"
_RED = "#ef4444"

_FONT_FAMILY = "sans-serif"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _apply_clean_style(ax: plt.Axes) -> None:
    """Remove top/right spines, add light y-grid, set text colour."""
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color(_GRID_COLOR)
    ax.spines["bottom"].set_color(_GRID_COLOR)
    ax.yaxis.grid(True, color=_GRID_COLOR, alpha=0.6, linewidth=0.5)
    ax.xaxis.grid(False)
    ax.set_axisbelow(True)
    ax.tick_params(colors=_SLATE_600, labelsize=7)
    ax.xaxis.label.set_color(_SLATE_600)
    ax.yaxis.label.set_color(_SLATE_600)
    ax.title.set_color(_SLATE_900)


def _render_to_png(fig: plt.Figure) -> bytes:
    """Save *fig* to a PNG byte-string at 150 dpi and close it."""
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight",
                facecolor="white", edgecolor="none")
    buf.seek(0)
    data = buf.read()
    plt.close(fig)
    return data


def to_base64_img(png_bytes: bytes) -> str:
    """Return a ``data:image/png;base64,...`` URI for HTML embedding."""
    b64 = base64.b64encode(png_bytes).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _ts_to_dates(trend_data: list[dict]) -> tuple[list[datetime], list[float]]:
    """Extract (dates, values) from trend bucket list [{ts, value}, ...]."""
    dates = [datetime.utcfromtimestamp(p["ts"] / 1000) for p in trend_data]
    values = [p["value"] for p in trend_data]
    return dates, values


def _auto_date_format(ax: plt.Axes, num_points: int) -> None:
    """Pick x-axis date formatting based on number of data points."""
    if num_points <= 7:
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    elif num_points <= 31:
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
        ax.xaxis.set_major_locator(mdates.DayLocator(interval=max(1, num_points // 8)))
    else:
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
        ax.xaxis.set_major_locator(mdates.WeekdayLocator(interval=1))

    for label in ax.get_xticklabels():
        label.set_rotation(0)
        label.set_ha("center")


# ---------------------------------------------------------------------------
# Trend area chart builder (shared)
# ---------------------------------------------------------------------------

def _make_trend_area_chart(
    trend_data: list[dict],
    ylabel: str,
    fill_color: str,
    line_color: str,
    edge_color: str,
) -> bytes:
    """Shared area-chart builder. Returns PNG bytes.

    *trend_data* is ``[{ts: int, value: float}, ...]`` sorted by ts.
    """
    if not trend_data:
        return _empty_chart_placeholder()

    dates, values = _ts_to_dates(trend_data)

    # Bar chart for sparse data (≤14 points) — clearer than area for short periods
    if len(dates) <= 14:
        fig, ax = plt.subplots(figsize=(7, 2.5))
        date_labels = [d.strftime("%d %b") for d in dates]
        ax.bar(range(len(values)), values, color=line_color,
               edgecolor=edge_color, linewidth=0.8)
        ax.set_xticks(range(len(values)))
        ax.set_xticklabels(date_labels,
                           rotation=45 if len(dates) > 10 else 0,
                           ha="right" if len(dates) > 10 else "center",
                           fontsize=7)
        ax.set_ylabel(ylabel, fontsize=8)
        ax.set_ylim(bottom=0)
        _apply_clean_style(ax)
        fig.tight_layout(pad=1.0)
        return _render_to_png(fig)

    # Area chart for denser data (>14 points)
    fig, ax = plt.subplots(figsize=(7, 2.5))

    ax.fill_between(dates, values, alpha=0.25, color=fill_color, linewidth=0)
    ax.plot(dates, values, color=line_color, linewidth=1.5, solid_capstyle="round")

    # Subtle dots at each data point
    if len(dates) <= 31:
        ax.scatter(dates, values, color=edge_color, s=12, zorder=5, linewidths=0)

    ax.set_ylabel(ylabel, fontsize=8)
    ax.set_ylim(bottom=0)
    _apply_clean_style(ax)
    _auto_date_format(ax, len(dates))

    fig.tight_layout(pad=1.0)
    return _render_to_png(fig)


def _empty_chart_placeholder() -> bytes:
    """Generate a small 'no data' placeholder chart."""
    fig, ax = plt.subplots(figsize=(7, 2))
    ax.text(0.5, 0.5, "No data available", transform=ax.transAxes,
            ha="center", va="center", fontsize=10, color=_SLATE_400)
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)
    fig.tight_layout(pad=1.0)
    return _render_to_png(fig)


# ---------------------------------------------------------------------------
# Individual chart functions
# ---------------------------------------------------------------------------

def energy_trend_chart(trend_data: list[dict]) -> bytes:
    """Amber area chart for energy consumption trend. Y-axis in kWh."""
    return _make_trend_area_chart(
        trend_data,
        ylabel="kWh",
        fill_color=_AMBER_LIGHT,
        line_color=_AMBER,
        edge_color=_AMBER_EDGE,
    )


def co2_trend_chart(trend_data: list[dict]) -> bytes:
    """Emerald area chart for CO2 emissions trend. Y-axis in kg."""
    return _make_trend_area_chart(
        trend_data,
        ylabel="kg",
        fill_color=_EMERALD_LIGHT,
        line_color=_EMERALD,
        edge_color=_EMERALD_EDGE,
    )


def dim_trend_chart(trend_data: list[dict]) -> bytes:
    """Indigo step chart for dim level trend. Y-axis 0-100%."""
    if not trend_data:
        return _empty_chart_placeholder()

    dates, values = _ts_to_dates(trend_data)

    fig, ax = plt.subplots(figsize=(7, 2))

    ax.fill_between(dates, values, alpha=0.15, color=_INDIGO_LIGHT,
                    step="post", linewidth=0)
    ax.step(dates, values, where="post", color=_INDIGO, linewidth=1.5)

    ax.set_ylabel("%", fontsize=8)
    ax.set_ylim(0, 105)
    _apply_clean_style(ax)
    _auto_date_format(ax, len(dates))

    fig.tight_layout(pad=1.0)
    return _render_to_png(fig)


def device_status_chart(online: int, offline: int, fault: int, total: int) -> bytes:
    """Compact 2.5x2.5 donut chart for device status breakdown."""
    sizes = [online, offline, fault]
    colors = [_EMERALD, _SLATE_400, _RED]
    labels = [f"Online ({online})", f"Offline ({offline})", f"Fault ({fault})"]

    # Filter out zero-count slices
    filtered = [(s, c, l) for s, c, l in zip(sizes, colors, labels) if s > 0]
    if not filtered:
        filtered = [(1, _SLATE_400, "No devices")]

    f_sizes, f_colors, f_labels = zip(*filtered)

    fig, ax = plt.subplots(figsize=(2.5, 2.5))
    wedges, _ = ax.pie(
        f_sizes,
        colors=f_colors,
        startangle=90,
        wedgeprops={"width": 0.35, "edgecolor": "white", "linewidth": 1.5},
    )
    ax.text(0, 0.02, str(total), ha="center", va="center",
            fontsize=20, fontweight="bold", color=_SLATE_900)
    ax.text(0, -0.18, "devices", ha="center", va="top",
            fontsize=8, color=_SLATE_400)
    ax.legend(wedges, f_labels, loc="lower center",
              bbox_to_anchor=(0.5, -0.12), ncol=min(3, len(f_labels)),
              frameon=False, fontsize=7, handlelength=1.0)

    fig.tight_layout(pad=0.3)
    return _render_to_png(fig)


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def generate_all_charts(report_data: dict, sections: list[str]) -> dict[str, str]:
    """Generate charts required by the given report *sections*.

    Returns a dict mapping chart name -> base64 data URI string.
    """
    charts: dict[str, str] = {}

    if "energy" in sections:
        trend = report_data.get("energy_trend", [])
        charts["energy_trend"] = to_base64_img(energy_trend_chart(trend))

    if "co2" in sections:
        trend = report_data.get("co2_trend", [])
        charts["co2_trend"] = to_base64_img(co2_trend_chart(trend))

    # Dim level chart (only if data is present)
    dim_trend = report_data.get("dim_trend")
    if dim_trend:
        charts["dim_trend"] = to_base64_img(dim_trend_chart(dim_trend))

    # Device status donut (always included)
    online = report_data.get("online_count", 0)
    offline = report_data.get("offline_count", 0)
    fault = report_data.get("fault_count", 0)
    total = report_data.get("device_count", online + offline + fault)
    charts["status_donut"] = to_base64_img(
        device_status_chart(online, offline, fault, total)
    )

    return charts
