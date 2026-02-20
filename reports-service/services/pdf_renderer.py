"""PDF report renderer using Jinja2 templates and WeasyPrint."""

from __future__ import annotations

import pathlib

from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import HTML

from services.chart_generator import to_base64_img

_TEMPLATE_DIR = pathlib.Path(__file__).resolve().parents[1] / "templates"


def _prepare_charts(report_data: dict) -> dict[str, str]:
    """Convert raw PNG bytes in *charts* dict to base64 data URIs.

    Already-converted URI strings are passed through unchanged.
    Returns a new dict (does not mutate the original).
    """
    raw = report_data.get("charts", {})
    converted: dict[str, str] = {}
    for key, value in raw.items():
        if isinstance(value, bytes):
            converted[key] = to_base64_img(value)
        elif isinstance(value, str) and value.startswith("data:"):
            converted[key] = value
        else:
            converted[key] = value
    return converted


def render(report_data: dict, sections: list[str] | None = None) -> bytes:
    """Render *report_data* to a PDF byte-string.

    Parameters
    ----------
    report_data:
        Dict with keys like ``entity_name``, ``period``, ``sites``,
        ``faults``, ``totals``, ``charts``, ``generated_date``, etc.
    sections:
        Which report sections to include (e.g. ``["summary", "energy",
        "faults"]``).  ``None`` means include all.

    Returns
    -------
    bytes
        The finished PDF document.
    """
    if sections is None:
        sections = ["summary", "energy", "co2", "faults"]

    env = Environment(
        loader=FileSystemLoader(str(_TEMPLATE_DIR)),
        autoescape=select_autoescape(["html"]),
    )
    template = env.get_template("report.html")

    charts = _prepare_charts(report_data)

    context = {
        **report_data,
        "sections": sections,
        "charts": charts,
    }

    html_string = template.render(**context)
    pdf_bytes = HTML(string=html_string).write_pdf()
    return pdf_bytes
