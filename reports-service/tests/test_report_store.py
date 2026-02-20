"""Tests for report_store — run with pytest or standalone."""

import pathlib
import sys
from datetime import datetime, timedelta

import pytest

# Ensure the project root is importable
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.report_store import (  # noqa: E402
    init_report_store,
    save_report_metadata,
    get_report_metadata,
    get_report_history,
    delete_old_reports,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def fresh_store():
    """Initialise an in-memory store before each test."""
    init_report_store(db_path=":memory:")


def _make_report(**overrides) -> dict:
    """Build a report metadata dict with sensible defaults."""
    defaults = {
        "id": "rpt-test-001",
        "entity_id": "entity-a",
        "entity_type": "site",
        "period_start": "2026-01-01T00:00:00Z",
        "period_end": "2026-01-31T23:59:59Z",
        "sections": ["summary", "energy"],
        "recipients": ["user@example.com"],
        "status": "success",
        "error_message": None,
        "pdf_path": "/data/rpt-test-001.pdf",
        "file_size_bytes": 12345,
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }
    defaults.update(overrides)
    return defaults


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestReportStore:
    def test_save_and_get_metadata(self):
        """Save a record, retrieve by id, verify all fields."""
        report = _make_report()
        save_report_metadata(report)

        fetched = get_report_metadata("rpt-test-001")
        assert fetched is not None
        assert fetched["id"] == "rpt-test-001"
        assert fetched["entity_id"] == "entity-a"
        assert fetched["entity_type"] == "site"
        assert fetched["period_start"] == "2026-01-01T00:00:00Z"
        assert fetched["period_end"] == "2026-01-31T23:59:59Z"
        assert fetched["sections"] == ["summary", "energy"]
        assert fetched["recipients"] == ["user@example.com"]
        assert fetched["status"] == "success"
        assert fetched["error_message"] is None
        assert fetched["pdf_path"] == "/data/rpt-test-001.pdf"
        assert fetched["file_size_bytes"] == 12345

    def test_get_history_by_entity(self):
        """Save 2 records for entity-a, 1 for entity-b, query entity-a → 2 results."""
        save_report_metadata(_make_report(id="rpt-1", entity_id="entity-a"))
        save_report_metadata(_make_report(id="rpt-2", entity_id="entity-a"))
        save_report_metadata(_make_report(id="rpt-3", entity_id="entity-b"))

        reports, total = get_report_history("entity-a")
        assert total == 2
        assert len(reports) == 2
        assert all(r["entity_id"] == "entity-a" for r in reports)

    def test_pagination(self):
        """Save 5 records, query with limit/offset — correct slicing and total."""
        for i in range(5):
            save_report_metadata(_make_report(
                id=f"rpt-{i}",
                generated_at=f"2026-01-{10 + i:02d}T00:00:00Z",
            ))

        page1, total1 = get_report_history("entity-a", limit=2, offset=0)
        assert total1 == 5
        assert len(page1) == 2

        page2, total2 = get_report_history("entity-a", limit=2, offset=2)
        assert total2 == 5
        assert len(page2) == 2

        # No overlap between pages
        page1_ids = {r["id"] for r in page1}
        page2_ids = {r["id"] for r in page2}
        assert page1_ids.isdisjoint(page2_ids)

    def test_delete_old_reports(self):
        """Save a record 100 days ago, purge at 90 days, verify deleted."""
        old_date = (datetime.utcnow() - timedelta(days=100)).isoformat() + "Z"
        save_report_metadata(_make_report(
            id="rpt-old",
            generated_at=old_date,
            pdf_path="/nonexistent/rpt-old.pdf",  # file won't exist, that's fine
        ))

        deleted = delete_old_reports(retention_days=90)
        assert deleted == 1
        assert get_report_metadata("rpt-old") is None

    def test_get_nonexistent(self):
        """Get by unknown id → returns None."""
        assert get_report_metadata("does-not-exist") is None


# ---------------------------------------------------------------------------
# Standalone — quick smoke test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=== Report store standalone test ===")

    init_report_store(db_path=":memory:")

    report = _make_report()
    save_report_metadata(report)
    fetched = get_report_metadata("rpt-test-001")
    assert fetched is not None
    print(f"Saved and fetched: {fetched['id']} (status={fetched['status']})")

    for i in range(3):
        save_report_metadata(_make_report(id=f"rpt-hist-{i}"))
    history, total = get_report_history("entity-a")
    print(f"History: {len(history)} of {total} total")

    print("All checks passed. Done.")
