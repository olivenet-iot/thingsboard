"""PDF report renderer using Jinja2 templates and WeasyPrint."""

from __future__ import annotations

import pathlib

from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import HTML

_TEMPLATE_DIR = pathlib.Path(__file__).resolve().parents[1] / "templates"


def render(report_data: dict, sections: list[str] | None = None) -> bytes:
    """Render *report_data* to a PDF byte-string.

    Parameters
    ----------
    report_data:
        Dict with keys like ``entity_name``, ``period``, ``devices``,
        ``faults``, ``charts``, ``generated_date``, KPI fields, etc.
        Charts are already base64 data URIs from generate_all_charts().
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

    context = {
        **report_data,
        "sections": sections,
    }

    html_string = template.render(**context)
    pdf_bytes = HTML(string=html_string).write_pdf()
    return pdf_bytes
