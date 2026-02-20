"""SQLite-backed report metadata storage.

Stores report generation history so users can browse past reports per entity,
with pagination.  On failure the metadata is still saved with status="failed".
A cleanup function purges old reports and their PDF files from disk.
"""

import json
import logging
import os
import sqlite3
from datetime import datetime, timedelta

import config

logger = logging.getLogger(__name__)

_db_path: str | None = None
_keep_alive: sqlite3.Connection | None = None  # holds in-memory DB open


# ---------------------------------------------------------------------------
# Initialisation
# ---------------------------------------------------------------------------

def init_report_store(db_path: str | None = None) -> None:
    """Create the ``reports`` table if it does not already exist.

    Parameters
    ----------
    db_path:
        Full path to the SQLite database file.  Defaults to
        ``{config.PDF_STORAGE_PATH}/reports.db``.  Pass ``":memory:"`` for
        tests.
    """
    global _db_path, _keep_alive
    _db_path = db_path or os.path.join(config.PDF_STORAGE_PATH, "reports.db")

    if _db_path != ":memory:":
        os.makedirs(os.path.dirname(_db_path) or ".", exist_ok=True)

    # For in-memory DBs we keep one connection alive so the shared-cache DB
    # persists across open/close cycles of other connections.
    if _db_path == ":memory:":
        if _keep_alive is not None:
            _keep_alive.close()
        _keep_alive = sqlite3.connect("file::memory:?cache=shared", uri=True)

    con = _connect()
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS reports (
                id             TEXT PRIMARY KEY,
                entity_id      TEXT NOT NULL,
                entity_type    TEXT NOT NULL,
                period_start   TEXT NOT NULL,
                period_end     TEXT NOT NULL,
                sections       TEXT NOT NULL,
                recipients     TEXT NOT NULL,
                status         TEXT NOT NULL,
                error_message  TEXT,
                pdf_path       TEXT,
                file_size_bytes INTEGER,
                generated_at   TEXT NOT NULL
            )
            """
        )
        con.execute(
            "CREATE INDEX IF NOT EXISTS idx_reports_entity ON reports (entity_id)"
        )
        con.commit()
    finally:
        con.close()

    logger.info("Report store initialised: %s", _db_path)


def _connect() -> sqlite3.Connection:
    """Return a new connection to the configured database."""
    if _db_path is None:
        raise RuntimeError("Report store not initialised — call init_report_store() first")
    if _db_path == ":memory:":
        return sqlite3.connect("file::memory:?cache=shared", uri=True)
    return sqlite3.connect(_db_path)


# ---------------------------------------------------------------------------
# CRUD helpers
# ---------------------------------------------------------------------------

def save_report_metadata(report: dict) -> None:
    """Insert a single report metadata row."""
    con = _connect()
    try:
        con.execute(
            """
            INSERT INTO reports
                (id, entity_id, entity_type, period_start, period_end,
                 sections, recipients, status, error_message,
                 pdf_path, file_size_bytes, generated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report["id"],
                report["entity_id"],
                report["entity_type"],
                report["period_start"],
                report["period_end"],
                json.dumps(report["sections"]),
                json.dumps(report["recipients"]),
                report["status"],
                report.get("error_message"),
                report.get("pdf_path"),
                report.get("file_size_bytes"),
                report["generated_at"],
            ),
        )
        con.commit()
    finally:
        con.close()


def get_report_metadata(report_id: str) -> dict | None:
    """Retrieve a single report by its ID, or ``None`` if not found."""
    con = _connect()
    try:
        con.row_factory = sqlite3.Row
        row = con.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
        if row is None:
            return None
        return _row_to_dict(row)
    finally:
        con.close()


def get_report_history(
    entity_id: str, limit: int = 10, offset: int = 0
) -> tuple[list[dict], int]:
    """Return paginated report history for an entity.

    Returns
    -------
    tuple[list[dict], int]
        ``(reports, total)`` where *total* is the full count (before paging).
    """
    con = _connect()
    try:
        con.row_factory = sqlite3.Row

        total = con.execute(
            "SELECT COUNT(*) FROM reports WHERE entity_id = ?", (entity_id,)
        ).fetchone()[0]

        rows = con.execute(
            "SELECT * FROM reports WHERE entity_id = ? ORDER BY generated_at DESC LIMIT ? OFFSET ?",
            (entity_id, limit, offset),
        ).fetchall()

        return [_row_to_dict(r) for r in rows], total
    finally:
        con.close()


def delete_old_reports(retention_days: int = 90) -> int:
    """Delete report rows older than *retention_days* and remove their PDFs.

    Returns the number of rows deleted.
    """
    cutoff = (datetime.utcnow() - timedelta(days=retention_days)).isoformat() + "Z"

    con = _connect()
    try:
        con.row_factory = sqlite3.Row
        old_rows = con.execute(
            "SELECT id, pdf_path FROM reports WHERE generated_at < ?", (cutoff,)
        ).fetchall()

        if not old_rows:
            return 0

        for row in old_rows:
            pdf = row["pdf_path"]
            if pdf and os.path.isfile(pdf):
                os.remove(pdf)
                logger.debug("Deleted PDF: %s", pdf)

        ids = [row["id"] for row in old_rows]
        placeholders = ",".join("?" for _ in ids)
        con.execute(f"DELETE FROM reports WHERE id IN ({placeholders})", ids)
        con.commit()

        logger.info("Purged %d old report(s) (retention=%d days)", len(ids), retention_days)
        return len(ids)
    finally:
        con.close()


# ---------------------------------------------------------------------------
# Internal
# ---------------------------------------------------------------------------

def _row_to_dict(row: sqlite3.Row) -> dict:
    """Convert a ``sqlite3.Row`` to a plain dict, deserialising JSON fields."""
    d = dict(row)
    d["sections"] = json.loads(d["sections"])
    d["recipients"] = json.loads(d["recipients"])
    return d
