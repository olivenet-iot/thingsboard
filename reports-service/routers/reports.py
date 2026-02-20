"""Report API endpoints."""

import logging
import os

import requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

import config
from services.report_generator import ReportRequest, ReportResult, generate_report

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
