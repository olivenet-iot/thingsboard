"""Environment configuration and time-range helpers."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

# -- ThingsBoard ---------------------------------------------------------
TB_URL: str = os.getenv("TB_URL", "http://localhost:8080")
TB_USERNAME: str = os.getenv("TB_USERNAME", "support@lumosoft.io")
TB_PASSWORD: str = os.getenv("TB_PASSWORD", "tenant")

# -- Anthropic / Claude --------------------------------------------------
ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
AI_MODEL: str = os.getenv("AI_MODEL", "claude-sonnet-4-5-20250929")
AI_MAX_TOKENS: int = int(os.getenv("AI_MAX_TOKENS", "2048"))

# -- Service --------------------------------------------------------------
CORS_ORIGINS: list[str] = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:8080").split(",")
    if o.strip()
]
SERVICE_PORT: int = int(os.getenv("SERVICE_PORT", "5001"))

# -- Tool loop safety -----------------------------------------------------
MAX_TOOL_ITERATIONS: int = 10
MAX_CHAT_HISTORY_MESSAGES: int = 20  # 10 user-assistant turns

# -- Guardrails -----------------------------------------------------------
MAX_MESSAGE_LENGTH: int = 2000

# -- Rate limiting --------------------------------------------------------
RATE_LIMIT_PER_IP: str = "10/minute"
RATE_LIMIT_PER_CUSTOMER: int = 20          # max requests per customer …
RATE_LIMIT_CUSTOMER_WINDOW: int = 60       # … in this many seconds


# -- Time-range helper ----------------------------------------------------

def resolve_time_range(name: str) -> tuple[int, int]:
    """Convert a named time range to (start_ts_ms, end_ts_ms) in UTC.

    Supported names: today, yesterday, this_week, this_month,
                     last_7_days, last_30_days.
    """
    now = datetime.now(timezone.utc)
    start_of_today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    ranges: dict[str, tuple[datetime, datetime]] = {
        "today": (start_of_today, now),
        "yesterday": (
            start_of_today - timedelta(days=1),
            start_of_today,
        ),
        "this_week": (
            start_of_today - timedelta(days=now.weekday()),
            now,
        ),
        "this_month": (
            start_of_today.replace(day=1),
            now,
        ),
        "last_7_days": (
            start_of_today - timedelta(days=6),
            now,
        ),
        "last_30_days": (
            start_of_today - timedelta(days=29),
            now,
        ),
    }

    if name not in ranges:
        raise ValueError(
            f"Unknown time range {name!r}. "
            f"Choose from: {', '.join(ranges)}"
        )

    start_dt, end_dt = ranges[name]
    return int(start_dt.timestamp() * 1000), int(end_dt.timestamp() * 1000)
