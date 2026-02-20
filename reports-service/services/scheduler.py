"""Report scheduler — APScheduler-based cron scheduling for periodic reports."""

from __future__ import annotations

import calendar
import logging
from datetime import datetime, timedelta

from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from pydantic import BaseModel

import config

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class ScheduleRequest(BaseModel):
    entityId: str
    entityType: str                     # "site" | "region" | "estate" | "customer"
    frequency: str                      # "monthly" | "quarterly" | "yearly"
    dayOfMonth: int = 1
    timeUtc: str = "06:00"              # "HH:MM"
    sections: list[str] = ["summary", "energy", "co2", "faults"]
    emails: list[str] = []
    enabled: bool = True


class ScheduleResponse(BaseModel):
    status: str
    scheduleId: str
    nextRun: str | None = None
    frequency: str
    enabled: bool


# ---------------------------------------------------------------------------
# Scheduler lifecycle
# ---------------------------------------------------------------------------

def init_scheduler(db_url: str | None = None) -> BackgroundScheduler:
    """Create and start a BackgroundScheduler with a SQLAlchemy job store."""
    global _scheduler

    if db_url is None:
        db_url = f"sqlite:///{config.PDF_STORAGE_PATH}/schedules.db"

    jobstores = {"default": SQLAlchemyJobStore(url=db_url)}
    _scheduler = BackgroundScheduler(jobstores=jobstores)
    _scheduler.start()
    logger.info("Scheduler started (jobstore: %s)", db_url)
    return _scheduler


def shutdown_scheduler() -> None:
    """Shut down the scheduler if running."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler shut down")
        _scheduler = None


def get_scheduler() -> BackgroundScheduler:
    """Return the module-level scheduler, raising if not initialised."""
    if _scheduler is None:
        raise RuntimeError("Scheduler not initialised — call init_scheduler() first")
    return _scheduler


# ---------------------------------------------------------------------------
# Period calculation
# ---------------------------------------------------------------------------

def calculate_previous_period(frequency: str, now: datetime) -> tuple[str, str]:
    """Return (start_iso, end_iso) for the previous period.

    - monthly:   1st of previous month → last day of previous month
    - quarterly: 1st of previous quarter → last day of previous quarter
    - yearly:    Jan 1 → Dec 31 of previous year
    """
    if frequency == "monthly":
        first_of_current = now.replace(day=1)
        last_of_prev = first_of_current - timedelta(days=1)
        start = last_of_prev.replace(day=1)
        end = last_of_prev
    elif frequency == "quarterly":
        # Current quarter: Q1=1-3, Q2=4-6, Q3=7-9, Q4=10-12
        current_q_start_month = ((now.month - 1) // 3) * 3 + 1
        # Previous quarter start
        prev_q_start = datetime(now.year, current_q_start_month, 1) - timedelta(days=1)
        prev_q_start_month = ((prev_q_start.month - 1) // 3) * 3 + 1
        start = datetime(prev_q_start.year, prev_q_start_month, 1)
        # Previous quarter end: last day of 3rd month
        end_month = prev_q_start_month + 2
        end_day = calendar.monthrange(start.year, end_month)[1]
        end = datetime(start.year, end_month, end_day)
    elif frequency == "yearly":
        start = datetime(now.year - 1, 1, 1)
        end = datetime(now.year - 1, 12, 31)
    else:
        raise ValueError(f"Unknown frequency: {frequency!r}")

    return start.strftime("%Y-%m-%dT00:00:00Z"), end.strftime("%Y-%m-%dT23:59:59Z")


# ---------------------------------------------------------------------------
# Job callback
# ---------------------------------------------------------------------------

def run_scheduled_report(
    entity_id: str,
    entity_type: str,
    sections: list[str],
    emails: list[str],
    frequency: str,
) -> None:
    """Execute a scheduled report job."""
    from services.report_generator import ReportRequest, PeriodSpec, generate_report

    try:
        start_iso, end_iso = calculate_previous_period(frequency, datetime.utcnow())
        request = ReportRequest(
            entityId=entity_id,
            entityType=entity_type,
            period=PeriodSpec(start=start_iso, end=end_iso),
            sections=sections,
            emails=emails,
            sendEmail=True,
        )
        result = generate_report(request)
        logger.info("Scheduled report completed: %s", result.reportId)
    except Exception:
        logger.exception("Scheduled report failed for entity %s", entity_id)


# ---------------------------------------------------------------------------
# Schedule CRUD
# ---------------------------------------------------------------------------

def _build_cron_trigger(frequency: str, day_of_month: int, hour: int, minute: int) -> CronTrigger:
    """Build a CronTrigger for the given frequency."""
    if frequency == "monthly":
        return CronTrigger(day=day_of_month, hour=hour, minute=minute)
    elif frequency == "quarterly":
        return CronTrigger(month="1,4,7,10", day=day_of_month, hour=hour, minute=minute)
    elif frequency == "yearly":
        return CronTrigger(month=1, day=day_of_month, hour=hour, minute=minute)
    else:
        raise ValueError(f"Unknown frequency: {frequency!r}")


def _job_to_response(job, frequency: str | None = None) -> ScheduleResponse:
    """Convert an APScheduler Job to a ScheduleResponse."""
    next_run = None
    if job.next_run_time is not None:
        next_run = job.next_run_time.isoformat()

    # Recover frequency from job kwargs if not provided
    if frequency is None:
        frequency = (job.kwargs or {}).get("frequency", "unknown")

    return ScheduleResponse(
        status="active" if job.next_run_time is not None else "paused",
        scheduleId=job.id,
        nextRun=next_run,
        frequency=frequency,
        enabled=job.next_run_time is not None,
    )


def add_report_schedule(schedule_config: ScheduleRequest) -> ScheduleResponse:
    """Add (or replace) a cron schedule for a report."""
    scheduler = get_scheduler()

    parts = schedule_config.timeUtc.split(":")
    hour = int(parts[0])
    minute = int(parts[1])

    trigger = _build_cron_trigger(schedule_config.frequency, schedule_config.dayOfMonth, hour, minute)
    job_id = f"schedule_{schedule_config.entityId}"

    job = scheduler.add_job(
        run_scheduled_report,
        trigger=trigger,
        id=job_id,
        replace_existing=True,
        kwargs={
            "entity_id": schedule_config.entityId,
            "entity_type": schedule_config.entityType,
            "sections": schedule_config.sections,
            "emails": schedule_config.emails,
            "frequency": schedule_config.frequency,
        },
    )

    if not schedule_config.enabled:
        job.pause()

    logger.info("Schedule %s added (frequency=%s, enabled=%s)", job_id, schedule_config.frequency, schedule_config.enabled)

    # Re-fetch to reflect paused state
    job = scheduler.get_job(job_id)
    return _job_to_response(job, schedule_config.frequency)


def remove_report_schedule(schedule_id: str) -> ScheduleResponse:
    """Remove a schedule by its job ID. Raises LookupError if not found."""
    scheduler = get_scheduler()
    job = scheduler.get_job(schedule_id)
    if job is None:
        raise LookupError(f"Schedule not found: {schedule_id}")

    frequency = (job.kwargs or {}).get("frequency", "unknown")
    scheduler.remove_job(schedule_id)
    return ScheduleResponse(
        status="removed",
        scheduleId=schedule_id,
        nextRun=None,
        frequency=frequency,
        enabled=False,
    )


def get_schedule(schedule_id: str) -> ScheduleResponse | None:
    """Get a single schedule by its job ID, or None if not found."""
    scheduler = get_scheduler()
    job = scheduler.get_job(schedule_id)
    if job is None:
        return None
    return _job_to_response(job)


def get_all_schedules() -> list[ScheduleResponse]:
    """Return all scheduled report jobs."""
    scheduler = get_scheduler()
    jobs = scheduler.get_jobs()
    return [_job_to_response(job) for job in jobs]
