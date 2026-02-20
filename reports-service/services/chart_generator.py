"""Chart generation for SignConnect reports.

Produces matplotlib charts as PNG bytes for embedding in PDF reports.
"""

import io
import base64

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


# ---------------------------------------------------------------------------
# Style constants
# ---------------------------------------------------------------------------
_SLATE_900 = "#0f172a"
_GRID_COLOR = "#e2e8f0"
_AMBER = "#f59e0b"
_EMERALD = "#059669"
_SLATE_400 = "#94a3b8"
_RED = "#ef4444"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _truncate(name: str, max_len: int = 20) -> str:
    if len(name) > max_len:
        return name[: max_len - 1] + "\u2026"
    return name


def _apply_clean_style(ax: plt.Axes) -> None:
    """Remove top/right spines, add light y-grid, set text colour."""
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.yaxis.grid(True, color=_GRID_COLOR, alpha=0.5)
    ax.xaxis.grid(False)
    ax.set_axisbelow(True)
    ax.tick_params(colors=_SLATE_900)
    ax.xaxis.label.set_color(_SLATE_900)
    ax.yaxis.label.set_color(_SLATE_900)
    ax.title.set_color(_SLATE_900)


def _render_to_png(fig: plt.Figure) -> bytes:
    """Save *fig* to a PNG byte-string at 150 dpi and close it."""
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
    buf.seek(0)
    data = buf.read()
    plt.close(fig)
    return data


# ---------------------------------------------------------------------------
# Chart functions
# ---------------------------------------------------------------------------

def energy_bar_chart(report_data: dict) -> bytes:
    """Horizontal bar chart of energy consumption (kWh) per site."""
    sites = report_data["sites"]
    names = [_truncate(s["name"]) for s in sites]
    values = [s["energy_wh"] / 1000 for s in sites]

    fig, ax = plt.subplots(figsize=(8, max(3, len(sites) * 0.6)))
    bars = ax.barh(names, values, color=_AMBER)
    _apply_clean_style(ax)
    ax.set_title("Energy Consumption by Site", fontsize=14, fontweight="bold", pad=12)
    ax.set_xlabel("kWh")

    for bar, val in zip(bars, values):
        ax.text(
            bar.get_width() + max(values) * 0.01,
            bar.get_y() + bar.get_height() / 2,
            f"{val:.1f} kWh",
            va="center",
            fontsize=9,
            color=_SLATE_900,
        )
    ax.set_xlim(right=max(values) * 1.18)

    return _render_to_png(fig)


def co2_bar_chart(report_data: dict) -> bytes:
    """Horizontal bar chart of CO2 emissions (kg) per site."""
    sites = report_data["sites"]
    names = [_truncate(s["name"]) for s in sites]
    values = [s["co2_grams"] / 1000 for s in sites]

    fig, ax = plt.subplots(figsize=(8, max(3, len(sites) * 0.6)))
    bars = ax.barh(names, values, color=_EMERALD)
    _apply_clean_style(ax)
    ax.set_title("CO\u2082 Emissions by Site", fontsize=14, fontweight="bold", pad=12)
    ax.set_xlabel("kg")

    for bar, val in zip(bars, values):
        ax.text(
            bar.get_width() + max(values) * 0.01,
            bar.get_y() + bar.get_height() / 2,
            f"{val:.1f} kg",
            va="center",
            fontsize=9,
            color=_SLATE_900,
        )
    ax.set_xlim(right=max(values) * 1.18)

    return _render_to_png(fig)


def status_donut_chart(report_data: dict) -> bytes:
    """Donut chart showing online / offline / fault device counts."""
    sites = report_data["sites"]
    online = sum(s["online_count"] for s in sites)
    offline = sum(s["offline_count"] for s in sites)
    fault = sum(s["fault_count"] for s in sites)
    total = online + offline + fault

    sizes = [online, offline, fault]
    colors = [_EMERALD, _SLATE_400, _RED]
    labels = [f"Online ({online})", f"Offline ({offline})", f"Fault ({fault})"]

    fig, ax = plt.subplots(figsize=(5, 5))
    wedges, _ = ax.pie(
        sizes,
        colors=colors,
        startangle=90,
        wedgeprops={"width": 0.4, "edgecolor": "white", "linewidth": 2},
    )
    ax.text(0, 0, str(total), ha="center", va="center",
            fontsize=28, fontweight="bold", color=_SLATE_900)
    ax.text(0, -0.12, "devices", ha="center", va="top",
            fontsize=11, color=_SLATE_400)
    ax.set_title("Device Status", fontsize=14, fontweight="bold", pad=16,
                 color=_SLATE_900)
    ax.legend(wedges, labels, loc="lower center",
              bbox_to_anchor=(0.5, -0.08), ncol=3, frameon=False,
              fontsize=10)

    return _render_to_png(fig)


# ---------------------------------------------------------------------------
# Conversion / dispatch helpers
# ---------------------------------------------------------------------------

def to_base64_img(png_bytes: bytes) -> str:
    """Return a ``data:image/png;base64,…`` URI for HTML embedding."""
    b64 = base64.b64encode(png_bytes).decode("ascii")
    return f"data:image/png;base64,{b64}"


def generate_all_charts(report_data: dict, sections: list[str]) -> dict[str, bytes]:
    """Generate charts required by the given report *sections*.

    Returns a dict mapping chart name → PNG bytes.
    """
    charts: dict[str, bytes] = {}

    if "energy" in sections:
        charts["energy_bar"] = energy_bar_chart(report_data)
    if "co2" in sections:
        charts["co2_bar"] = co2_bar_chart(report_data)

    # Status donut is always useful
    charts["status_donut"] = status_donut_chart(report_data)

    return charts
