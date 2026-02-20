"""Report API endpoints."""

import logging
import os

import requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

import config
from services.report_generator import ReportRequest, ReportResult, generate_report
from services.report_store import get_report_history
from services.scheduler import (
    ScheduleRequest,
    ScheduleResponse,
    add_report_schedule,
    remove_report_schedule,
    get_schedule,
    get_all_schedules,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["reports"])


@router.post("/generate", response_model=ReportResult)
def generate(req: ReportRequest):
    """Generate a PDF report for the given entity and period."""
    try:
        result = generate_report(req)
        return result
    except requests.ConnectionError:
        raise HTTPException(status_code=502, detail="ThingsBoard server is unreachable")
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception:
        logger.exception("Report generation failed")
        raise HTTPException(status_code=500, detail="Internal error during report generation")


@router.get("/history/{entity_id}")
def history(entity_id: str, limit: int = 10, offset: int = 0):
    """Browse paginated report history for an entity."""
    reports, total = get_report_history(entity_id, limit=limit, offset=offset)
    return {"reports": reports, "total": total, "limit": limit, "offset": offset}


@router.get("/download/{report_id}")
def download(report_id: str):
    """Download a previously generated PDF report."""
    # Sanitize to prevent path traversal
    safe_id = report_id.replace("/", "").replace("..", "")
    file_path = os.path.join(config.PDF_STORAGE_PATH, f"{safe_id}.pdf")

    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Report not found")

    return FileResponse(
        path=file_path,
        media_type="application/pdf",
        filename=f"{safe_id}.pdf",
    )


# ---------------------------------------------------------------------------
# Schedule endpoints
# ---------------------------------------------------------------------------

@router.post("/schedule", response_model=ScheduleResponse)
def create_schedule(req: ScheduleRequest):
    """Create or replace a report schedule."""
    try:
        return add_report_schedule(req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/schedule/{entity_id}", response_model=ScheduleResponse)
def read_schedule(entity_id: str):
    """Get a report schedule by entity ID."""
    result = get_schedule(f"schedule_{entity_id}")
    if result is None:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return result


@router.delete("/schedule/{entity_id}", response_model=ScheduleResponse)
def delete_schedule(entity_id: str):
    """Remove a report schedule."""
    try:
        return remove_report_schedule(f"schedule_{entity_id}")
    except LookupError:
        raise HTTPException(status_code=404, detail="Schedule not found")


@router.get("/schedules", response_model=list[ScheduleResponse])
def list_schedules():
    """List all report schedules."""
    return get_all_schedules()
