"""Tests for email_sender — run with pytest or standalone."""

import pathlib
import sys
from datetime import date
from smtplib import SMTPException
from unittest.mock import MagicMock, patch

import pytest

# Ensure the project root is importable
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.email_sender import send_report, _sanitize_filename  # noqa: E402


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

def _build_report_data() -> dict:
    """Build a minimal report_data dict for email tests."""
    return {
        "entity_name": "Lumosoft UK Fleet",
        "period": "February 2026",
        "generated_date": date.today().isoformat(),
        "totals": {
            "energy_kwh": 66.6,
            "co2_kg": 28.6,
            "fault_count": 3,
        },
    }


def _smtp_config() -> dict:
    return {
        "host": "smtp.example.com",
        "port": 587,
        "username": "user@example.com",
        "password": "secret",
        "from_addr": "reports@signconnect.io",
    }


# ---------------------------------------------------------------------------
# Pytest tests
# ---------------------------------------------------------------------------

class TestEmailSender:
    def test_send_constructs_email_correctly(self, tmp_path):
        """Mock SMTP and verify the full send flow."""
        # Create a tiny test PDF
        pdf_file = tmp_path / "test.pdf"
        pdf_file.write_bytes(b"%PDF-1.4 test content")

        mock_server = MagicMock()
        with patch("services.email_sender.smtplib.SMTP") as MockSMTP:
            MockSMTP.return_value.__enter__ = MagicMock(return_value=mock_server)
            MockSMTP.return_value.__exit__ = MagicMock(return_value=False)

            result = send_report(
                recipients=["alice@example.com", "bob@example.com"],
                subject="Test Report",
                pdf_path=str(pdf_file),
                report_data=_build_report_data(),
                smtp_config=_smtp_config(),
            )

        # SMTP connected to correct host/port
        MockSMTP.assert_called_once_with("smtp.example.com", 587)

        # STARTTLS called
        mock_server.starttls.assert_called_once()

        # Login called with correct credentials
        mock_server.login.assert_called_once_with("user@example.com", "secret")

        # sendmail called with correct from/to
        mock_server.sendmail.assert_called_once()
        call_args = mock_server.sendmail.call_args
        assert call_args[0][0] == "reports@signconnect.io"
        assert call_args[0][1] == ["alice@example.com", "bob@example.com"]

        # Message has PDF attachment
        raw_message = call_args[0][2]
        assert ".pdf" in raw_message
        assert "Content-Disposition" in raw_message

        # Message has HTML body
        assert "text/html" in raw_message

        # Returns success
        assert result["sent"] is True
        assert result["recipients"] == ["alice@example.com", "bob@example.com"]
        assert result["error"] is None

    def test_send_handles_smtp_error(self, tmp_path):
        """SMTP failure returns error dict without raising."""
        pdf_file = tmp_path / "test.pdf"
        pdf_file.write_bytes(b"%PDF-1.4 test content")

        with patch("services.email_sender.smtplib.SMTP") as MockSMTP:
            MockSMTP.side_effect = SMTPException("Connection refused")

            result = send_report(
                recipients=["alice@example.com"],
                subject="Test Report",
                pdf_path=str(pdf_file),
                report_data=_build_report_data(),
                smtp_config=_smtp_config(),
            )

        assert result["sent"] is False
        assert "Connection refused" in result["error"]
        assert result["recipients"] == ["alice@example.com"]

    def test_sanitize_filename(self):
        """Special characters in entity names produce safe filenames."""
        assert _sanitize_filename("Simple Name") == "Simple_Name"
        assert _sanitize_filename("O'Brien & Sons") == "O_Brien___Sons"
        assert _sanitize_filename("Test/Report<>") == "Test_Report__"
        assert _sanitize_filename("already_safe-name") == "already_safe-name"
        assert _sanitize_filename("spaces  and\ttabs") == "spaces__and_tabs"


# ---------------------------------------------------------------------------
# Standalone — send a test email (requires real SMTP config)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import config

    report_data = _build_report_data()

    # Create a tiny test PDF
    data_dir = pathlib.Path(__file__).resolve().parents[1] / "data"
    data_dir.mkdir(exist_ok=True)
    test_pdf = data_dir / "test_email.pdf"
    test_pdf.write_bytes(b"%PDF-1.4 tiny test PDF for email")

    smtp_cfg = {
        "host": config.SMTP_HOST,
        "port": config.SMTP_PORT,
        "username": config.SMTP_USERNAME,
        "password": config.SMTP_PASSWORD,
        "from_addr": config.SMTP_FROM,
    }

    result = send_report(
        recipients=["test@example.com"],
        subject="SignConnect Test Report",
        pdf_path=str(test_pdf),
        report_data=report_data,
        smtp_config=smtp_cfg,
    )

    print(f"Result: {result}")
