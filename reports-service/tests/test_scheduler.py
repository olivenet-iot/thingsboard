"""Tests for scheduler — run with pytest or standalone."""

import pathlib
import sys
from datetime import datetime

import pytest

# Ensure the project root is importable
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.scheduler import (  # noqa: E402
    ScheduleRequest,
    calculate_previous_period,
    init_scheduler,
    shutdown_scheduler,
    add_report_schedule,
    remove_report_schedule,
    get_schedule,
    get_all_schedules,
)


# ---------------------------------------------------------------------------
# Period calculation tests (pure logic, no scheduler needed)
# ---------------------------------------------------------------------------

class TestCalculatePreviousPeriod:
    def test_monthly(self):
        """March 15 → previous period is Feb 1–Feb 28."""
        start, end = calculate_previous_period("monthly", datetime(2026, 3, 15))
        assert start == "2026-02-01T00:00:00Z"
        assert end == "2026-02-28T23:59:59Z"

    def test_monthly_leap_year(self):
        """March in a leap year → Feb 1–Feb 29."""
        start, end = calculate_previous_period("monthly", datetime(2028, 3, 10))
        assert start == "2028-02-01T00:00:00Z"
        assert end == "2028-02-29T23:59:59Z"

    def test_monthly_january(self):
        """January → previous period is Dec of prior year."""
        start, end = calculate_previous_period("monthly", datetime(2026, 1, 5))
        assert start == "2025-12-01T00:00:00Z"
        assert end == "2025-12-31T23:59:59Z"

    def test_quarterly(self):
        """April 10 (Q2) → previous quarter is Q1: Jan 1–Mar 31."""
        start, end = calculate_previous_period("quarterly", datetime(2026, 4, 10))
        assert start == "2026-01-01T00:00:00Z"
        assert end == "2026-03-31T23:59:59Z"

    def test_quarterly_q1(self):
        """February (Q1) → previous quarter is Q4 of prior year."""
        start, end = calculate_previous_period("quarterly", datetime(2026, 2, 15))
        assert start == "2025-10-01T00:00:00Z"
        assert end == "2025-12-31T23:59:59Z"

    def test_yearly(self):
        """2026 → previous year is 2025."""
        start, end = calculate_previous_period("yearly", datetime(2026, 2, 1))
        assert start == "2025-01-01T00:00:00Z"
        assert end == "2025-12-31T23:59:59Z"

    def test_unknown_frequency(self):
        with pytest.raises(ValueError, match="Unknown frequency"):
            calculate_previous_period("weekly", datetime(2026, 3, 1))


# ---------------------------------------------------------------------------
# Scheduler CRUD tests (in-memory SQLite for isolation)
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def scheduler_lifecycle():
    """Start a scheduler with in-memory SQLite before each test, shut down after."""
    init_scheduler(db_url="sqlite://")
    yield
    shutdown_scheduler()


def _make_request(**overrides) -> ScheduleRequest:
    """Build a ScheduleRequest with sensible defaults."""
    defaults = {
        "entityId": "test-entity-001",
        "entityType": "site",
        "frequency": "monthly",
        "dayOfMonth": 1,
        "timeUtc": "06:00",
        "sections": ["summary", "energy"],
        "emails": ["user@example.com"],
        "enabled": True,
    }
    defaults.update(overrides)
    return ScheduleRequest(**defaults)


class TestSchedulerCRUD:
    def test_add_and_get_schedule(self):
        """Adding a schedule should make it retrievable."""
        req = _make_request()
        resp = add_report_schedule(req)

        assert resp.scheduleId == "schedule_test-entity-001"
        assert resp.frequency == "monthly"
        assert resp.enabled is True
        assert resp.nextRun is not None

        fetched = get_schedule("schedule_test-entity-001")
        assert fetched is not None
        assert fetched.scheduleId == resp.scheduleId
        assert fetched.frequency == "monthly"

    def test_remove_schedule(self):
        """Removing a schedule makes it unfindable."""
        add_report_schedule(_make_request())
        resp = remove_report_schedule("schedule_test-entity-001")
        assert resp.status == "removed"

        assert get_schedule("schedule_test-entity-001") is None

    def test_remove_nonexistent_raises(self):
        """Removing a schedule that doesn't exist raises LookupError."""
        with pytest.raises(LookupError):
            remove_report_schedule("schedule_nonexistent")

    def test_schedule_replaces_existing(self):
        """Adding the same entityId twice replaces the old job."""
        add_report_schedule(_make_request(frequency="monthly"))
        add_report_schedule(_make_request(frequency="quarterly"))

        all_jobs = get_all_schedules()
        assert len(all_jobs) == 1
        assert all_jobs[0].frequency == "quarterly"

    def test_get_all_schedules(self):
        """Listing schedules returns all added jobs."""
        add_report_schedule(_make_request(entityId="entity-a"))
        add_report_schedule(_make_request(entityId="entity-b"))

        schedules = get_all_schedules()
        assert len(schedules) == 2
        ids = {s.scheduleId for s in schedules}
        assert ids == {"schedule_entity-a", "schedule_entity-b"}

    def test_disabled_schedule(self):
        """A disabled schedule should have enabled=False and no nextRun."""
        req = _make_request(enabled=False)
        resp = add_report_schedule(req)

        assert resp.enabled is False
        assert resp.nextRun is None

    def test_quarterly_trigger(self):
        """Quarterly schedule should be accepted."""
        req = _make_request(frequency="quarterly")
        resp = add_report_schedule(req)
        assert resp.frequency == "quarterly"

    def test_yearly_trigger(self):
        """Yearly schedule should be accepted."""
        req = _make_request(frequency="yearly")
        resp = add_report_schedule(req)
        assert resp.frequency == "yearly"


# ---------------------------------------------------------------------------
# Standalone — quick smoke test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=== Scheduler standalone test ===")

    scheduler = init_scheduler(db_url="sqlite://")
    print(f"Scheduler running: {scheduler.running}")

    req = ScheduleRequest(
        entityId="standalone-test",
        entityType="site",
        frequency="monthly",
        emails=["admin@example.com"],
    )
    resp = add_report_schedule(req)
    print(f"Added schedule: {resp.scheduleId}, next run: {resp.nextRun}")

    all_s = get_all_schedules()
    print(f"Total schedules: {len(all_s)}")

    remove_report_schedule(resp.scheduleId)
    print(f"Removed {resp.scheduleId}, remaining: {len(get_all_schedules())}")

    shutdown_scheduler()
    print("Scheduler shut down. Done.")
