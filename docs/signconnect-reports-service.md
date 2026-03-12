# SignConnect Reports Service

Technical documentation for the SignConnect Reports Service — a FastAPI microservice that generates PDF operational reports from ThingsBoard IoT data.

**Version:** 1.0
**Last updated:** 2026-03-12
**Maintainer:** Lumosoft

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [API Endpoints](#3-api-endpoints)
4. [Report Templates](#4-report-templates)
5. [Scheduling](#5-scheduling)
6. [Email Delivery](#6-email-delivery)
7. [Data Sources](#7-data-sources)
8. [Configuration](#8-configuration)
9. [Deployment](#9-deployment)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Overview

The Reports Service generates PDF operational reports from ThingsBoard IoT telemetry and alarm data. Reports cover energy consumption, CO2 emissions, device status, energy savings analysis, and fault logs across the SignConnect entity hierarchy.

### Key Capabilities

- On-demand PDF report generation via REST API
- Scheduled report delivery (monthly, quarterly, yearly) with email
- Paginated report history with download
- Configurable report sections (summary, energy, CO2, savings, faults)
- Multi-level entity support: Customer, Estate, Region, Site, Device

### Technology Stack

| Component | Library | Version |
|-----------|---------|---------|
| Web framework | FastAPI | 0.115.x |
| ASGI server | uvicorn | 0.34.x |
| PDF rendering | WeasyPrint | 63.x |
| Templates | Jinja2 | 3.1.x |
| Charts | matplotlib | 3.10.x |
| Scheduling | APScheduler | 3.10.x |
| Job store | SQLAlchemy | 2.0.x |
| HTTP client | requests | 2.32.x |
| Environment | python-dotenv | 1.0.x |
| Multipart | python-multipart | 0.0.x |

### Entry Point

`main.py` starts a uvicorn ASGI server on the configured port (default 5000). On startup, the lifespan handler initialises the SQLite report store and the APScheduler background scheduler. On shutdown, the scheduler is gracefully stopped.

CORS is enabled for all origins (`allow_origins=["*"]`) to allow access from ThingsBoard dashboard widgets.

---

## 2. Architecture

### Directory Structure

```
reports-service/
├── main.py                          # FastAPI app, lifespan, health endpoint (42 lines)
├── config.py                        # Environment variable loading (22 lines)
├── requirements.txt                 # Python dependencies (10 packages)
├── routers/
│   └── reports.py                   # All 8 API endpoints (101 lines)
├── services/
│   ├── report_generator.py          # Report pipeline orchestrator (606 lines)
│   ├── tb_client.py                 # ThingsBoard REST API client (434 lines)
│   ├── chart_generator.py           # matplotlib chart generation (361 lines)
│   ├── pdf_renderer.py              # Jinja2 + WeasyPrint rendering (48 lines)
│   ├── scheduler.py                 # APScheduler cron scheduling (246 lines)
│   ├── email_sender.py              # SMTP email delivery (99 lines)
│   └── report_store.py              # SQLite report metadata store (209 lines)
├── templates/
│   ├── report.html                  # A4 PDF template (539 lines)
│   └── email.html                   # Email notification template (80 lines)
├── data/                            # Runtime data (created automatically)
│   ├── reports.db                   # Report metadata (SQLite)
│   ├── schedules.db                 # APScheduler job store (SQLite)
│   └── rpt-*.pdf                    # Generated PDF files
└── docs/
    └── signconnect-reports-service.md  # This file
```

### Request Flow

```
                        ┌─────────────────────────────────────────┐
                        │            API Request                   │
                        │    POST /api/report/generate             │
                        └───────────────┬─────────────────────────┘
                                        │
                                        ▼
                        ┌─────────────────────────────────────────┐
                        │         ReportRequest (Pydantic)         │
                        │  entityId, entityType, period, sections  │
                        └───────────────┬─────────────────────────┘
                                        │
                                        ▼
                        ┌─────────────────────────────────────────┐
                        │           TBClient                       │
                        │  1. Authenticate (JWT)                   │
                        │  2. Resolve entity hierarchy             │
                        │  3. Fetch telemetry per device           │
                        │  4. Fetch alarms per device              │
                        │  5. Fetch device attributes              │
                        └───────────────┬─────────────────────────┘
                                        │
                          ┌─────────────┴──────────────┐
                          ▼                            ▼
               ┌───────────────────┐       ┌───────────────────┐
               │  chart_generator  │       │   Aggregate data  │
               │  (matplotlib)     │       │   KPIs, trends,   │
               │  → base64 PNGs   │       │   device details   │
               └────────┬──────────┘       └────────┬──────────┘
                        │                           │
                        └─────────────┬─────────────┘
                                      ▼
                        ┌─────────────────────────────────────────┐
                        │           pdf_renderer                   │
                        │  Jinja2 template + WeasyPrint → PDF      │
                        └───────────────┬─────────────────────────┘
                                        │
                          ┌─────────────┼──────────────┐
                          ▼             ▼              ▼
                    ┌──────────┐  ┌──────────┐  ┌──────────────┐
                    │ Save PDF │  │ Save meta│  │ Email (opt.) │
                    │ to disk  │  │ to SQLite│  │ SMTP + PDF   │
                    └──────────┘  └──────────┘  └──────────────┘
                                        │
                                        ▼
                        ┌─────────────────────────────────────────┐
                        │          ReportResult (JSON)             │
                        │  status, reportId, downloadUrl, message  │
                        └─────────────────────────────────────────┘
```

### Entity Hierarchy

The service supports four entity levels, each mapping to ThingsBoard entity types:

```
Customer (CUSTOMER)
  └── Estate (ASSET, type="estate")
        └── Region (ASSET, type="region")
              └── Site (ASSET, type="site")
                    └── Device (DEVICE)
```

**Fallback paths:** The hierarchy resolver handles missing levels:
- Customer with no Estates → tries Regions directly
- Customer with no Estates or Regions → tries Sites directly
- Estate → can contain Sites directly (no Region level)

Reports always resolve down to a flat list of `SiteNode` objects, each containing its child `DeviceNode` list. All telemetry and alarm data is collected per-device, then aggregated upward.

---

## 3. API Endpoints

All endpoints are prefixed with `/api/report`. The health endpoint is at the root.

### 3.1 Health Check

```
GET /health
```

Returns service status.

**Response:**

```json
{"status": "ok"}
```

### 3.2 Generate Report

```
POST /api/report/generate
```

Generates a PDF report for the specified entity and time period.

**Request body:**

```json
{
  "entityId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "entityType": "site",
  "period": {
    "start": "2026-01-01T00:00:00Z",
    "end": "2026-01-31T23:59:59Z"
  },
  "sections": ["summary", "energy", "co2", "savings", "faults"],
  "emails": ["ops@example.com"],
  "sendEmail": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `entityId` | string | *required* | ThingsBoard entity UUID |
| `entityType` | string | *required* | `"site"`, `"region"`, `"estate"`, or `"customer"` |
| `period.start` | string | *required* | ISO 8601 start timestamp |
| `period.end` | string | *required* | ISO 8601 end timestamp |
| `sections` | string[] | `["summary","energy","co2","savings","faults"]` | Report sections to include |
| `emails` | string[] | `[]` | Recipient email addresses |
| `sendEmail` | boolean | `false` | Send report via email after generation |

**Response (200):**

```json
{
  "status": "success",
  "reportId": "rpt-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "message": "Report generated for Site Alpha (January 2026)",
  "downloadUrl": "/api/report/download/rpt-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "generatedAt": "2026-02-01T06:00:00Z"
}
```

**Error responses:**

| Status | Condition |
|--------|-----------|
| 502 | ThingsBoard server unreachable (`requests.ConnectionError`) |
| 404 | Entity not found or unsupported entity type (`ValueError`) |
| 500 | Any other generation failure |

**curl example:**

```bash
curl -X POST http://localhost:5000/api/report/generate \
  -H "Content-Type: application/json" \
  -d '{
    "entityId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "entityType": "site",
    "period": {"start": "2026-01-01T00:00:00Z", "end": "2026-01-31T23:59:59Z"}
  }'
```

### 3.3 Report History

```
GET /api/report/history/{entity_id}?limit=10&offset=0
```

Returns paginated report generation history for an entity (includes both successful and failed reports).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `entity_id` | path | *required* | ThingsBoard entity UUID |
| `limit` | query | `10` | Max results per page |
| `offset` | query | `0` | Number of records to skip |

**Response (200):**

```json
{
  "reports": [
    {
      "id": "rpt-...",
      "entity_id": "a1b2...",
      "entity_type": "site",
      "period_start": "2026-01-01T00:00:00Z",
      "period_end": "2026-01-31T23:59:59Z",
      "sections": ["summary", "energy", "co2", "savings", "faults"],
      "recipients": ["ops@example.com"],
      "status": "success",
      "error_message": null,
      "pdf_path": "./data/rpt-....pdf",
      "file_size_bytes": 245780,
      "generated_at": "2026-02-01T06:00:00Z"
    }
  ],
  "total": 1,
  "limit": 10,
  "offset": 0
}
```

### 3.4 Download Report

```
GET /api/report/download/{report_id}
```

Downloads a previously generated PDF file. The `report_id` is sanitised to prevent path traversal (`/` and `..` are stripped).

**Response (200):** PDF file (`application/pdf`)

**Response (404):** Report file not found on disk

**curl example:**

```bash
curl -o report.pdf http://localhost:5000/api/report/download/rpt-a1b2c3d4
```

### 3.5 Create/Replace Schedule

```
POST /api/report/schedule
```

Creates or replaces a report schedule. If a schedule already exists for the same `entityId`, it is replaced (job ID: `schedule_{entityId}`).

**Request body:**

```json
{
  "entityId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "entityType": "site",
  "frequency": "monthly",
  "dayOfMonth": 1,
  "timeUtc": "06:00",
  "sections": ["summary", "energy", "co2", "faults"],
  "emails": ["ops@example.com"],
  "enabled": true
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `entityId` | string | *required* | ThingsBoard entity UUID |
| `entityType` | string | *required* | `"site"`, `"region"`, `"estate"`, or `"customer"` |
| `frequency` | string | *required* | `"monthly"`, `"quarterly"`, or `"yearly"` |
| `dayOfMonth` | integer | `1` | Day of month to run |
| `timeUtc` | string | `"06:00"` | Time in UTC (`"HH:MM"` format) |
| `sections` | string[] | `["summary","energy","co2","faults"]` | Sections to include |
| `emails` | string[] | `[]` | Recipient email addresses |
| `enabled` | boolean | `true` | Whether the schedule is active |

**Response (200):**

```json
{
  "status": "active",
  "scheduleId": "schedule_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "nextRun": "2026-04-01T06:00:00+00:00",
  "frequency": "monthly",
  "enabled": true
}
```

**Response (400):** Invalid frequency value

### 3.6 Get Schedule

```
GET /api/report/schedule/{entity_id}
```

Retrieves the schedule configuration for an entity.

**Response (200):** `ScheduleResponse` (same as create)

**Response (404):** No schedule found for this entity

### 3.7 Delete Schedule

```
DELETE /api/report/schedule/{entity_id}
```

Removes a report schedule.

**Response (200):**

```json
{
  "status": "removed",
  "scheduleId": "schedule_a1b2c3d4",
  "nextRun": null,
  "frequency": "monthly",
  "enabled": false
}
```

**Response (404):** Schedule not found

### 3.8 List All Schedules

```
GET /api/report/schedules
```

Returns all active and paused report schedules.

**Response (200):**

```json
[
  {
    "status": "active",
    "scheduleId": "schedule_a1b2c3d4",
    "nextRun": "2026-04-01T06:00:00+00:00",
    "frequency": "monthly",
    "enabled": true
  }
]
```

---

## 4. Report Templates

### 4.1 PDF Template (`templates/report.html`)

A 539-line Jinja2 template that renders to an A4 PDF via WeasyPrint. The layout uses print-optimised CSS with `@page` rules for margins and page numbering.

**Visual elements:**

| Element | Description |
|---------|-------------|
| Amber accent bar | 4px `#f59e0b` bar at the top of every report |
| Header | Brand name, entity name (20pt), entity type, period label |
| KPI cards | Flexbox row with 5 cards: Devices, Online, Faults, Energy, CO2 |
| Chart sections | Full-width chart images with stats line beneath |
| Device table | Sortable table with status dots (green/grey/red) + donut chart |
| Fault log | Table with severity badges (CRITICAL/MAJOR/WARNING/MINOR) |
| Page footer | "SignConnect | Page X of Y | lumosoft.io" |

**Section-conditional rendering:** Each major section is wrapped in Jinja2 conditionals:

```jinja2
{% if "energy" in sections and charts.energy_trend %}
  ...energy chart and stats...
{% endif %}
```

Available sections: `summary`, `energy`, `co2`, `savings`, `faults`

**Charts are embedded as base64 data URIs** — no external file references. The `chart_generator.py` module renders matplotlib figures to PNG bytes, then base64-encodes them as `data:image/png;base64,...` strings.

### 4.2 Chart Types

| Chart | Function | Colour | Style | Y-axis |
|-------|----------|--------|-------|--------|
| Energy trend | `energy_trend_chart()` | Amber `#f59e0b` | Area/bar | kWh |
| CO2 trend | `co2_trend_chart()` | Emerald `#059669` | Area/bar | kg |
| Dim level | `dim_trend_chart()` | Indigo `#6366f1` | Step chart | % (0-100) |
| Device status | `device_status_chart()` | Green/grey/red | Donut (2.5x2.5) | Count |
| Energy comparison | `energy_comparison_chart()` | Amber + green | Stacked bar | kWh |
| Saving % trend | `saving_pct_trend_chart()` | Green `#22c55e` | Area/bar | % (0-100) |

**Adaptive chart style:** Charts with 14 or fewer data points render as bar charts for clarity. Charts with more points render as area charts with fill and optional scatter dots (up to 31 points).

All charts are rendered at 150 DPI with a clean style: no top/right spines, light y-grid, slate-coloured text.

### 4.3 Email Template (`templates/email.html`)

An 80-line table-based HTML email template designed for broad email client compatibility (600px max width).

| Element | Style |
|---------|-------|
| Header | Dark navy `#17212b` background, gold `#f9b11d` "SignConnect" text |
| Body | Entity name, period, summary stats table |
| Stats table | Energy (kWh), CO2 (kg), Faults, Energy Saved, Cost Saved |
| Footer | "SignConnect by Lumosoft | lumosoft.io" in grey |

Savings rows only appear when `totals.energy_saving_kwh > 0`.

---

## 5. Scheduling

### Overview

Report scheduling uses APScheduler's `BackgroundScheduler` with a `SQLAlchemyJobStore` backed by SQLite (`data/schedules.db`). Jobs persist across service restarts.

### Frequencies

| Frequency | Cron Trigger | Report Period |
|-----------|-------------|---------------|
| `monthly` | Day N at HH:MM UTC | Previous calendar month |
| `quarterly` | Months 1,4,7,10 on day N | Previous calendar quarter |
| `yearly` | Month 1 on day N | Previous calendar year |

### Period Calculation

The `calculate_previous_period()` function auto-computes the report period based on the current date:

| Frequency | Example (run date) | Computed period |
|-----------|---------------------|-----------------|
| Monthly | 2026-03-01 | 2026-02-01 to 2026-02-28 |
| Quarterly | 2026-04-01 | 2026-01-01 to 2026-03-31 |
| Yearly | 2026-01-01 | 2025-01-01 to 2025-12-31 |

### Job Behaviour

- **Job ID format:** `schedule_{entityId}` — adding the same entity replaces the existing schedule
- **`replace_existing=True`:** Prevents duplicate job errors
- **`coalesce` and `max_instances`:** Configured via APScheduler defaults
- **Pausing:** If `enabled=false` in the request, `job.pause()` is called after creation
- **Callback:** `run_scheduled_report()` constructs a `ReportRequest` with `sendEmail=True` and calls `generate_report()`
- **Error handling:** Exceptions in the callback are logged but don't crash the scheduler

### Lifecycle

1. **Startup:** `init_scheduler()` creates the `BackgroundScheduler` with SQLAlchemy job store and starts it
2. **Runtime:** Jobs fire at their scheduled times, generating and emailing reports
3. **Shutdown:** `shutdown_scheduler()` stops the scheduler with `wait=False`

---

## 6. Email Delivery

### Transport

- **Protocol:** SMTP with STARTTLS
- **Auth:** Username/password login after STARTTLS negotiation
- **Library:** Python's built-in `smtplib` and `email.mime` modules

### Message Format

- **MIME type:** `multipart/mixed` (HTML body + PDF attachment)
- **Subject:** `SignConnect Report: {entity_name} — {period_label}`
- **HTML body:** Rendered from `templates/email.html` with report data context
- **PDF attachment:** The generated PDF file from disk

### Attachment Naming

Filenames are sanitised using `re.sub(r'[^\w\-]', '_', name)` to replace non-alphanumeric characters with underscores:

```
SignConnect_Report_{entity_name}_{period}.pdf
```

Example: `SignConnect_Report_Site_Alpha_January_2026.pdf`

### Currency Symbol

The currency symbol displayed in email (and PDF) savings sections is fetched from the first site's `SERVER_SCOPE` attribute `currency_symbol`. Defaults to `"£"` if not set.

### Return Value

`send_report()` never raises exceptions. It returns a dict:

```json
{"sent": true, "recipients": ["ops@example.com"], "error": null}
```

On failure:

```json
{"sent": false, "recipients": ["ops@example.com"], "error": "Connection refused"}
```

---

## 7. Data Sources

### ThingsBoard REST API

The `TBClient` class wraps the ThingsBoard REST API. All requests go through `_request()`, which auto-refreshes the JWT on 401 responses.

**API endpoints used:**

| Purpose | Method | TB Endpoint |
|---------|--------|-------------|
| Authentication | POST | `/api/auth/login` |
| Get asset | GET | `/api/asset/{assetId}` |
| Get device | GET | `/api/device/{deviceId}` |
| Get customer | GET | `/api/customer/{customerId}` |
| Get relations | GET | `/api/relations` |
| Customer assets | GET | `/api/customer/{customerId}/assets` |
| Telemetry (trend) | GET | `/api/plugins/telemetry/DEVICE/{id}/values/timeseries` |
| Telemetry (aggregate) | GET | `/api/plugins/telemetry/DEVICE/{id}/values/timeseries` |
| Device attributes | GET | `/api/plugins/telemetry/{type}/{id}/values/attributes/{scope}` |
| Alarm history | GET | `/api/alarm/{entityType}/{entityId}` |

### Hierarchy Resolution

Entity hierarchy is resolved via ThingsBoard "Contains" relations:

1. **Customer:** Fetch all assigned assets → filter by type (estate/region/site) → traverse downward
2. **Estate:** Get "Contains" relations → recurse into regions and direct sites
3. **Region:** Get "Contains" relations → build sites from child assets of type "site"
4. **Site:** Build directly with its child devices

### Telemetry Keys

| Key | Unit | Aggregation | Used In |
|-----|------|-------------|---------|
| `energy_wh` | Wh | SUM | Energy section (converted to kWh) |
| `co2_grams` | g | SUM | CO2 section (converted to kg) |
| `dim_level` | % | AVG | Dim level chart |
| `energy_saving_wh` | Wh | SUM | Savings section (converted to kWh) |
| `cost_saving` | currency | SUM | Savings section |
| `co2_saving_grams` | g | SUM | Savings section (converted to kg) |
| `saving_pct` | % | AVG | Savings section |

### Trend Intervals

The trend interval is determined by the report period length:

| Period Length | Interval | Label |
|-------------|----------|-------|
| Up to 90 days | 1 day (86,400,000 ms) | "daily" |
| Over 90 days | 7 days (604,800,000 ms) | "weekly" |

### Device Status

Device status is determined by a 3-way check:

1. **Fault:** Any active alarm (`status` starts with `"ACTIVE"`) → `"Fault"` (red)
2. **Online:** `lastActivityTime` within 10 minutes of current time → `"Online"` (green)
3. **Offline:** Otherwise → `"Offline"` (grey)

Fault status takes priority — a device with an active alarm is always shown as "Fault" even if recently active.

### Savings Prerequisites

Energy savings calculations require the `reference_power_watts` server-scope attribute on each device. Devices without this attribute are counted as `devices_without_baseline` and excluded from savings totals. A note appears in the report when devices lack baseline configuration.

---

## 8. Configuration

### Environment Variables

All configuration is loaded from environment variables (with `.env` file support via `python-dotenv`).

| Variable | Default | Description |
|----------|---------|-------------|
| `TB_URL` | `http://localhost:8080` | ThingsBoard server URL |
| `TB_USERNAME` | `tenant@thingsboard.org` | ThingsBoard login username |
| `TB_PASSWORD` | `tenant` | ThingsBoard login password |
| `SMTP_HOST` | `smtp.example.com` | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port (STARTTLS) |
| `SMTP_USERNAME` | `""` | SMTP authentication username |
| `SMTP_PASSWORD` | `""` | SMTP authentication password |
| `SMTP_FROM` | `""` | Sender email address |
| `SERVICE_PORT` | `5000` | Port the reports service listens on |
| `PDF_STORAGE_PATH` | `./data` | Directory for PDFs and SQLite databases |
| `LOG_LEVEL` | `INFO` | Python logging level |

### .env Template

Create a `.env` file in the `reports-service/` directory:

```bash
# ThingsBoard connection
TB_URL=https://signconnect.example.com
TB_USERNAME=tenant@thingsboard.org
TB_PASSWORD=your-tenant-password

# SMTP settings
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=reports@example.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=reports@example.com

# Service settings
SERVICE_PORT=5000
PDF_STORAGE_PATH=./data
LOG_LEVEL=INFO
```

### Dependencies

`requirements.txt` (10 packages):

```
fastapi==0.115.*
uvicorn==0.34.*
weasyprint==63.*
jinja2==3.1.*
matplotlib==3.10.*
apscheduler==3.10.*
sqlalchemy==2.0.*
requests==2.32.*
python-dotenv==1.0.*
python-multipart==0.0.*
```

---

## 9. Deployment

### Prerequisites

- **Python:** 3.10 or later
- **System packages** (required by WeasyPrint):

```bash
sudo apt-get install -y \
  libpango1.0-dev \
  libcairo2-dev \
  libgdk-pixbuf2.0-dev \
  libffi-dev
```

### Installation

```bash
# Clone or navigate to the repository
cd /home/ubuntu/thingsboard/reports-service

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env   # or create from template above
nano .env              # set TB_URL, SMTP credentials, etc.

# Create data directory
mkdir -p data

# Start the service
python main.py
```

The service starts on `http://0.0.0.0:5000` with auto-reload enabled.

### Systemd Service

Create `/etc/systemd/system/signconnect-reports.service`:

```ini
[Unit]
Description=SignConnect Reports Service
After=network.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu/thingsboard/reports-service
Environment=PATH=/home/ubuntu/thingsboard/reports-service/venv/bin:/usr/bin
ExecStart=/home/ubuntu/thingsboard/reports-service/venv/bin/python main.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable signconnect-reports
sudo systemctl start signconnect-reports
```

### Verification

```bash
# Check health endpoint
curl http://localhost:5000/health
# Expected: {"status":"ok"}

# Check service logs
journalctl -u signconnect-reports -f

# Verify data directory
ls -la data/
# Expected: reports.db, schedules.db (created on first startup)
```

### Data Directory Contents

| File | Purpose |
|------|---------|
| `reports.db` | SQLite database storing report metadata (history, status, file paths) |
| `schedules.db` | SQLite database storing APScheduler job definitions |
| `rpt-*.pdf` | Generated PDF report files |

### Report Retention

Use `delete_old_reports(retention_days=90)` from `services/report_store.py` to purge old reports and their PDF files. This function:

1. Finds all report rows with `generated_at` older than `retention_days`
2. Deletes each associated PDF file from disk
3. Removes the metadata rows from SQLite
4. Returns the count of deleted reports

This is not currently wired to an automatic schedule — call it manually or add a cron job.

---

## 10. Troubleshooting

### Common Issues

| Symptom | Cause | Solution |
|---------|-------|----------|
| **502 Bad Gateway** on generate | ThingsBoard server unreachable | Verify `TB_URL` is correct and TB is running. Check network/firewall. |
| **404** on generate | Entity UUID not found in ThingsBoard, or unsupported `entityType` | Verify the entity ID exists in TB. Valid types: `site`, `region`, `estate`, `customer`. |
| **Empty charts** (shows "No data available") | No telemetry data in the requested period | Verify devices are sending `energy_wh` and `co2_grams` telemetry. Check the period range. |
| **Savings section shows "Baseline not configured"** | Missing `reference_power_watts` attribute | Set the `reference_power_watts` server-scope attribute (in watts) on each device in ThingsBoard. |
| **Email not sending** | SMTP configuration incorrect | Verify `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM`. Check firewall allows outbound on port 587. |
| **Schedule not firing** | Schedule created with `enabled: false`, or wrong `timeUtc` | Check `GET /api/report/schedules` — look for `"enabled": false` or `"status": "paused"`. Re-create with `enabled: true`. |
| **PDF rendering crash** | Missing WeasyPrint system dependencies | Install: `sudo apt-get install libpango1.0-dev libcairo2-dev libgdk-pixbuf2.0-dev libffi-dev` |
| **Authentication failures** (401 loop) | Wrong TB credentials or expired password | Verify `TB_USERNAME` and `TB_PASSWORD` in `.env`. Test login manually via TB UI. |
| **Large reports slow** (>30 seconds) | Many devices across multiple sites | Reduce sections (e.g., omit `savings` to skip per-device savings telemetry). Report time scales linearly with device count. |
| **Disk filling up** with old PDFs | No retention policy configured | Run `delete_old_reports(retention_days=90)` periodically, or set up a cron job to clean `data/rpt-*.pdf` files. |

### Logs

The service uses Python's standard `logging` module. Set `LOG_LEVEL=DEBUG` in `.env` for verbose output including:

- JWT authentication events
- Per-device telemetry fetch details
- Chart generation timing
- PDF save paths and sizes
- Email send results
- Scheduler job lifecycle events

### SQLite Database Schema

The `reports` table in `data/reports.db`:

```sql
CREATE TABLE reports (
    id             TEXT PRIMARY KEY,    -- "rpt-{uuid4}"
    entity_id      TEXT NOT NULL,       -- ThingsBoard entity UUID
    entity_type    TEXT NOT NULL,       -- "site", "region", "estate", "customer"
    period_start   TEXT NOT NULL,       -- ISO 8601
    period_end     TEXT NOT NULL,       -- ISO 8601
    sections       TEXT NOT NULL,       -- JSON array
    recipients     TEXT NOT NULL,       -- JSON array
    status         TEXT NOT NULL,       -- "success" or "failed"
    error_message  TEXT,               -- null on success
    pdf_path       TEXT,               -- file path, null on failure
    file_size_bytes INTEGER,           -- PDF size, null on failure
    generated_at   TEXT NOT NULL        -- ISO 8601
);

CREATE INDEX idx_reports_entity ON reports (entity_id);
```

Both `sections` and `recipients` are stored as JSON-serialised arrays and deserialised on read.
