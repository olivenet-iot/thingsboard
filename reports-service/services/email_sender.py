"""Email sender — delivers PDF reports as SMTP attachments."""

from __future__ import annotations

import logging
import os
import pathlib
import re
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from jinja2 import Environment, FileSystemLoader, select_autoescape

logger = logging.getLogger(__name__)

_TEMPLATE_DIR = pathlib.Path(__file__).resolve().parents[1] / "templates"


def _sanitize_filename(name: str) -> str:
    """Replace non-alphanumeric characters with underscores."""
    return re.sub(r'[^\w\-]', '_', name)


def _render_email_body(report_data: dict) -> str:
    """Render the email HTML body from the email.html template."""
    env = Environment(
        loader=FileSystemLoader(str(_TEMPLATE_DIR)),
        autoescape=select_autoescape(["html"]),
    )
    template = env.get_template("email.html")
    return template.render(**report_data)


def send_report(
    recipients: list[str],
    subject: str,
    pdf_path: str,
    report_data: dict,
    smtp_config: dict,
) -> dict:
    """Send a PDF report as an email attachment.

    Parameters
    ----------
    recipients:
        List of email addresses.
    subject:
        Email subject line.
    pdf_path:
        Path to the generated PDF file on disk.
    report_data:
        Dict with ``entity_name``, ``period``, ``totals``, etc.
    smtp_config:
        Dict with keys ``host``, ``port``, ``username``, ``password``,
        ``from_addr``.

    Returns
    -------
    dict
        ``{"sent": True/False, "recipients": [...], "error": None/str}``
    """
    try:
        # Build the MIME message
        msg = MIMEMultipart("mixed")
        msg["Subject"] = subject
        msg["From"] = smtp_config["from_addr"]
        msg["To"] = ", ".join(recipients)

        # HTML body
        html_body = _render_email_body(report_data)
        msg.attach(MIMEText(html_body, "html"))

        # PDF attachment
        entity_name = _sanitize_filename(report_data.get("entity_name", "Report"))
        period = _sanitize_filename(report_data.get("period", ""))
        attachment_name = f"SignConnect_Report_{entity_name}_{period}.pdf"

        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()

        pdf_part = MIMEApplication(pdf_bytes, "pdf")
        pdf_part.add_header("Content-Disposition", "attachment", filename=attachment_name)
        msg.attach(pdf_part)

        # Send via SMTP with STARTTLS
        with smtplib.SMTP(smtp_config["host"], smtp_config["port"]) as server:
            server.starttls()
            server.login(smtp_config["username"], smtp_config["password"])
            server.sendmail(smtp_config["from_addr"], recipients, msg.as_string())

        logger.info("Email sent to %s — subject: %s", recipients, subject)
        return {"sent": True, "recipients": recipients, "error": None}

    except Exception as exc:
        logger.error("Failed to send email to %s: %s", recipients, exc)
        return {"sent": False, "recipients": recipients, "error": str(exc)}
