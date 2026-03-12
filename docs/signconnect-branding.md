# SignConnect Branding System

Technical documentation for the SignConnect branding system — a script-based white-label customization layer for ThingsBoard CE that applies branding at build time without modifying upstream source files.

**Version:** 2.0
**Last updated:** 2026-03-12
**Maintainer:** Lumosoft

---

## Table of Contents

1. [Overview](#1-overview)
2. [Directory Structure](#2-directory-structure)
3. [apply-branding.sh — Full Breakdown](#3-apply-brandingsh--full-breakdown)
4. [Widget Deployment](#4-widget-deployment)
5. [Widget Inventory](#5-widget-inventory)
6. [Configuration Reference (config.env)](#6-configuration-reference-configenv)
7. [Assets](#7-assets)
8. [Adding a New Widget](#8-adding-a-new-widget)
9. [Updating After Upstream Pull](#9-updating-after-upstream-pull)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Overview

The branding system converts ThingsBoard CE into **SignConnect**, Lumosoft's white-labeled IoT platform. It replaces logos, colors, text strings, email templates, and UI behavior — producing a fully branded product from unmodified upstream source code.

### Key Principle

**Source files are NOT modified in this repository.** Branding is applied at build time by `apply-branding.sh`. This ensures:

- Clean merges with upstream ThingsBoard (zero conflicts)
- Easy version upgrades (`git pull` + re-apply)
- Auditable changes (diff `originals/` against current files)
- Reversible branding (`revert-branding.sh` restores originals)

### How It Works

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Upstream TB     │────▶│  apply-branding  │────▶│  Branded Build  │
│  (clean source)  │     │  (sed + cp)      │     │  (SignConnect)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                         reads config.env
                         copies assets/
                         backs up originals/
```

The script performs 24 discrete sections of modifications covering:
- Visual identity (logos, colors, favicon)
- Text replacement (brand name, copyright, help URLs)
- Email templates (10 FreeMarker `.ftl` files)
- Translations (29 locale files)
- Backend configuration (JWT issuer, Swagger, mobile app)
- UX modifications (login page, customer navigation, feature hiding)

---

## 2. Directory Structure

```
branding/
├── config.env                          # All branding configuration (176 lines)
│
├── assets/                             # Brand visual assets
│   ├── logo_title_white.svg            # Sidebar logo (white text on dark bg)
│   ├── logo_title_white2.svg           # Alternate sidebar logo variant
│   ├── logo_title_dark.svg             # Login page logo (dark text on white bg)
│   ├── logo_white.svg                  # Square icon logo (white)
│   ├── logo_white2.svg                 # Alternate square icon variant
│   ├── favicon.ico                     # Browser tab favicon
│   ├── login-bg.png                    # Login page background image (195 KB)
│   ├── branding-fixes.css              # CSS overrides injected into styles.scss
│   └── README.md                       # Asset documentation
│
├── scripts/
│   ├── apply-branding.sh               # Main branding script (959 lines)
│   └── revert-branding.sh              # Restores original files from backups
│
├── originals/                          # Backups of original ThingsBoard files
│   ├── .manifest                       # Backup metadata (date, TB version)
│   ├── logo_title_white.svg            # Original ThingsBoard logos
│   ├── logo_white.svg
│   ├── thingsboard.ico
│   ├── index.html                      # Original Angular index
│   ├── constants.scss                  # Original SCSS color variables
│   ├── theme.scss                      # Original theme file
│   ├── styles.scss                     # Original global styles
│   ├── constants.ts                    # Original TypeScript constants
│   ├── environment.ts                  # Original dev environment config
│   ├── environment.prod.ts             # Original prod environment config
│   ├── app.component.ts                # Original app component
│   ├── footer.component.html           # Original footer
│   ├── dashboard-page.component.html   # Original dashboard page
│   ├── home.component.html             # Original home component template
│   ├── home.component.ts               # Original home component logic
│   ├── login.component.html            # Original login page
│   ├── login.component.scss            # Original login styles
│   ├── user-menu.component.html        # Original user menu template
│   ├── user-menu.component.ts          # Original user menu logic
│   ├── github-badge.component.html     # Original GitHub badge
│   ├── security.component.html         # Original security page
│   ├── security.component.ts           # Original security component
│   ├── two-factor-auth-settings.component.ts  # Original 2FA settings
│   ├── notification-settings-routing.modules.ts  # Original notification routing
│   ├── device-check-connectivity-dialog.component.html  # Original connectivity dialog
│   ├── messages.properties             # Original email subject lines
│   ├── thingsboard.yml                 # Original backend config
│   ├── 2fa.verification.code.ftl       # Original email templates (10 total)
│   ├── account.activated.ftl
│   ├── account.lockout.ftl
│   ├── activation.ftl
│   ├── password.was.reset.ftl
│   ├── reset.password.ftl
│   ├── state.disabled.ftl
│   ├── state.enabled.ftl
│   ├── state.warning.ftl
│   └── test.ftl
│
└── widgets/                            # Custom SignConnect widgets (23 total)
    ├── chat-widget/                    # AI chatbot widget
    ├── customer-manager/               # Customer CRUD management
    ├── dali-scheduler/                 # DALI lighting scheduler
    ├── device-manager/                 # Device management table
    ├── device-pool/                    # Unassigned device pool
    ├── dim-control/                    # Dimming slider control
    ├── fault-status/                   # Generic fault status panel
    ├── fault-status-dali2/             # DALI-2 fault status panel
    ├── fleet-client-summary/           # Fleet client summary cards
    ├── fleet-energy-summary/           # Fleet energy summary
    ├── fleet-map/                      # Fleet map visualization
    ├── fleet-summary/                  # Fleet summary cards
    ├── management-home/                # Management dashboard home
    ├── management-nav-tree/            # Management navigation tree
    ├── nav-buttons/                    # Navigation button bar
    ├── nav-tree/                       # Customer navigation tree
    ├── onboarding-wizard/              # Tenant onboarding wizard
    ├── report/                         # Report viewer widget
    ├── site-energy-summary/            # Site energy summary
    ├── site-fault-status/              # Site fault status panel
    ├── site-manager/                   # Site CRUD management
    ├── site-overview/                  # Site overview dashboard
    └── status-banner/                  # Connection status banner
```

Each widget directory contains 5 standard files (plus `deploy.py`):

| File | Purpose |
|------|---------|
| `deploy.py` | Deployment script (authenticates, creates/updates widget via API) |
| `controller.js` | Widget JavaScript logic (TBEL-compatible) |
| `template.html` | Widget HTML template |
| `template.css` | Widget CSS styles |
| `settings-schema.json` | Widget settings form schema |

Exception: `chat-widget/` also has a `README.md`, and `nav-tree/` has an extra `patch-dashboard-settings.py`.

---

## 3. apply-branding.sh — Full Breakdown

The script has 24 numbered sections (plus a verification step). Each section is logged with `log_section` and can be skipped based on config flags.

### Usage

```bash
cd branding/scripts
./apply-branding.sh [OPTIONS]

Options:
  --dry-run    Show what would be changed without making changes
  --verbose    Enable verbose output
  --no-backup  Skip creating backups
  --help       Show this help message
```

### Helper Functions

| Function | Purpose |
|----------|---------|
| `log()` | Timestamped log output |
| `log_verbose()` | Only outputs when `--verbose` is set |
| `log_action()` | Shows `[DRY-RUN] Would:` in dry-run mode |
| `log_section()` | Visual section separator |
| `backup_file()` | Copies original file to `originals/` (skip if already exists) |
| `modify_file()` | `sed -i "s\|pattern\|replacement\|g"` on a single file |
| `copy_asset()` | Copies asset file with logging |
| `replace_color_globally()` | Recursive `find + sed` for color hex codes |

### Section-by-Section Reference

---

#### Section 1: Backup Original Files

**Guard:** `CREATE_BACKUP="true"` and no `--no-backup` flag

Creates the `originals/` directory and copies all files that will be modified. Only copies if the backup doesn't already exist (idempotent). Backs up:

- Core UI files (logos, favicon, index.html, SCSS, styles)
- Angular components (footer, home, login, user-menu, security, dashboard-page)
- Environment files (environment.ts, environment.prod.ts)
- TypeScript configs (constants.ts, app.component.ts, 2FA settings)
- Email templates (all 10 `.ftl` files)
- Email subject lines (messages.properties)
- Backend config (thingsboard.yml)
- Optionally: all 29 translation files (when `BACKUP_TRANSLATIONS="true"`)

Creates a `.manifest` file recording the backup date and ThingsBoard version.

---

#### Section 2: Copy Brand Assets

**Files touched:**
- `ui-ngx/src/assets/logo_title_white.svg` ← `assets/logo_title_white.svg`
- `ui-ngx/src/assets/logo_white.svg` ← `assets/logo_white.svg`
- `ui-ngx/src/thingsboard.ico` ← `assets/favicon.ico`
- `ui-ngx/src/assets/login-bg.png` ← `assets/login-bg.png` (if exists)
- `ui-ngx/src/assets/logo_title_dark.svg` ← `assets/logo_title_dark.svg` (if exists)

Directly copies brand logos, favicon, login background, and dark logo variant over the ThingsBoard originals.

---

#### Section 3: Update Page Title

**File:** `ui-ngx/src/index.html`

| Pattern | Replacement |
|---------|-------------|
| `<title>ThingsBoard</title>` | `<title>SignConnect</title>` |
| `<title>Thingsboard</title>` | `<title>SignConnect</title>` |
| `background-color: rgb(43,160,199)` | `background-color: rgb(249,177,29)` |

Changes the HTML `<title>` tag and the loading spinner color.

---

#### Section 4: Update SCSS Color Variables

**File:** `ui-ngx/src/scss/constants.scss`

| Pattern | Replacement |
|---------|-------------|
| `$tb-primary-color: #305680` | `$tb-primary-color: #17212b` |
| `$tb-secondary-color: #527dad` | `$tb-secondary-color: #f9b11d` |
| `$tb-hue3-color: #a7c1de` | `$tb-hue3-color: #f9b11d` |
| `$tb-dark-primary-color: #9fa8da` | `$tb-dark-primary-color: #232c36` |
| `$tb-primary-color-light: #7986cb` | `$tb-primary-color-light: #2e3740` |

These SCSS variables control the Angular Material theme — sidebar, toolbar, buttons, and accent colors.

---

#### Section 5: Update Link Colors

**File:** `ui-ngx/src/styles.scss`

| Pattern | Replacement |
|---------|-------------|
| `color: #106cc8` | `color: #f9b11d` |
| `border-bottom: 1px solid #4054b2` | `border-bottom: 1px solid #f9b11d` |

Changes hyperlink text color and underline color.

---

#### Section 6: Replace Hardcoded Colors

**Guard:** `REPLACE_HARDCODED_COLORS="true"`

**Scope:** Recursive search through `ui-ngx/src/app/` and `ui-ngx/src/assets/`

| File types | Pattern | Replacement |
|------------|---------|-------------|
| `*.ts`, `*.scss`, `*.html` | `#305680` (case-insensitive) | `#17212b` |
| `*.json`, `*.svg` | `#305680` (case-insensitive) | `#17212b` |

This is the most aggressive section — it finds and replaces the ThingsBoard primary blue (`#305680`) everywhere it appears as a hardcoded hex value. Affects 60+ locations across TypeScript components, SCSS stylesheets, HTML templates, dashboard JSON files, and SVG images.

---

#### Section 7: Update Footer Copyright

**File:** `ui-ngx/src/app/shared/components/footer.component.html`

| Pattern | Replacement |
|---------|-------------|
| `The ThingsBoard Authors` | `Lumosoft` |

---

#### Section 8: Update Help URLs

**File:** `ui-ngx/src/app/shared/models/constants.ts`

| Condition | Pattern | Replacement |
|-----------|---------|-------------|
| `REMOVE_HELP_LINKS="true"` or `DOCS_URL` empty | `export const helpBaseUrl = 'https://thingsboard.io'` | `export const helpBaseUrl = ''` |
| `DOCS_URL` is set | `https://thingsboard.io` | `$DOCS_URL` |

When help links are removed (current SignConnect config), all "?" help icons throughout the UI show no link.

---

#### Section 9: Hide GitHub Badge

**Guard:** `HIDE_GITHUB_BADGE="true"`

No HTML modification is performed. The GitHub star badge is hidden purely via CSS in `branding-fixes.css`:

```css
tb-github-badge {
  display: none !important;
}
```

This is idempotent — re-running the script doesn't create duplicate changes.

---

#### Section 10: Update Email Templates

**Files:** All 10 `.ftl` files in `application/src/main/resources/templates/`

Templates affected:
- `2fa.verification.code.ftl` — Two-factor auth code email
- `account.activated.ftl` — Account activation confirmation
- `account.lockout.ftl` — Account lockout notification
- `activation.ftl` — New account activation link
- `password.was.reset.ftl` — Password reset confirmation
- `reset.password.ftl` — Password reset link
- `state.disabled.ftl` — Account disabled notification
- `state.enabled.ftl` — Account enabled notification
- `state.warning.ftl` — Account warning notification
- `test.ftl` — Test email template

For each template, the following replacements are applied:

| Pattern | Replacement |
|---------|-------------|
| `<title>Thingsboard` / `<title>ThingsBoard` | `<title>SignConnect` |
| `your Thingsboard account` (various casings) | `your SignConnect account` |
| `Thingsboard space` | `SignConnect space` |
| `Thingsboard user account` | `SignConnect user account` |
| `from Thingsboard` | `from SignConnect` |
| `Activate your Thingsboard` | `Activate your SignConnect` |
| `ThingsBoard is already` / `has already` | `SignConnect is already` / `has already` |
| `— The Thingsboard` / `— The ThingsBoard` | `— The SignConnect Team` |
| `by Thingsboard` / `by ThingsBoard` | `powered by SignConnect` |

---

#### Section 10b: Update Email Subject Lines

**File:** `application/src/main/resources/i18n/messages.properties`

| Pattern | Replacement |
|---------|-------------|
| `from Thingsboard` | `from SignConnect` |
| `on Thingsboard` | `on SignConnect` |
| `Thingsboard -` | `SignConnect -` |
| `ThingsBoard -` | `SignConnect -` |

This file contains Java i18n message keys used for email subject lines.

---

#### Section 11: Update Translations

**Guard:** `UPDATE_ALL_TRANSLATIONS="true"` (processes all 29 locales; otherwise only `en_US`)

**Files:** `ui-ngx/src/assets/locale/locale.constant-*.json` (29 files)

| Pattern | Replacement |
|---------|-------------|
| `ThingsBoard` | `SignConnect` |
| `Thingsboard` | `SignConnect` |

Optionally (when `FIX_POWERED_BY_TEXT="true"`): `powered by SignConnect` → `by SignConnect`.

Locales: ar_AE, ca_ES, cs_CZ, da_DK, de_DE, el_GR, en_US, es_ES, fa_IR, fr_FR, hi_IN, it_IT, ja_JP, ka_GE, ko_KR, lt_LT, lv_LV, nl_BE, nl_NL, no_NO, pl_PL, pt_BR, ro_RO, sl_SI, tr_TR, uk_UA, zh_CN, zh_TW (+ more).

---

#### Section 12: Update Console Log

**File:** `ui-ngx/src/app/app.component.ts`

| Pattern | Replacement |
|---------|-------------|
| `ThingsBoard Version` | `SignConnect Version` |

Changes the browser console startup message.

---

#### Section 13: Update App Title

**Files:** `ui-ngx/src/environments/environment.ts`, `environment.prod.ts`

| Pattern | Replacement |
|---------|-------------|
| `appTitle: 'ThingsBoard'` | `appTitle: 'SignConnect'` |

The `appTitle` is used in the Angular app's window title and various UI locations.

---

#### Section 14: Remove "Powered By" Footer

**Guard:** `REMOVE_POWERED_BY_FOOTER="true"`

**File:** `ui-ngx/src/app/modules/home/components/dashboard-page/dashboard-page.component.html`

Removes the entire `<section *ngIf="!embedded" data-html2canvas-ignore class="tb-powered-by-footer">...</section>` block using a multi-line `sed` deletion.

---

#### Section 15: Update Swagger/API Documentation

**Guard:** `UPDATE_SWAGGER="true"`

**File:** `application/src/main/resources/thingsboard.yml`

| Pattern | Replacement |
|---------|-------------|
| `ThingsBoard REST API` | `SignConnect REST API` |
| `ThingsBoard team` | `Lumosoft team` |
| `ThingsBoard open-source IoT platform` | `SignConnect IoT platform` |

---

#### Section 16: Update Logo SVG Colors

**File:** `ui-ngx/src/assets/logo_title_white.svg`

| Pattern | Replacement |
|---------|-------------|
| `fill="#305680"` | `fill="#17212b"` |

Updates any ThingsBoard-blue text fill in the SVG logo to match the new primary color.

---

#### Section 17: Inject Branding CSS Fixes

**Source:** `branding/assets/branding-fixes.css`
**Target:** `ui-ngx/src/styles.scss` (appended)

The CSS file (321 lines) is read, the secondary color placeholder `#f9b11d` is replaced with the configured `SECONDARY_COLOR`, and the result is appended to `styles.scss`. If already injected (detected by marker comment), the old injection is removed first.

The CSS fixes cover:

| Fix | What it does |
|-----|-------------|
| FIX 1 | Tailwind `!hidden` class exact-match selector |
| FIX 1B | Header toolbar search container visibility |
| FIX 1C | GitHub badge hidden via `tb-github-badge { display: none }` |
| FIX 1D | Device connectivity dialog doc links to thingsboard.io hidden |
| FIX 2 | Dark background form field text/label/border colors |
| FIX 3 | Version info widget "Contact Us" link hidden |
| FIX 4 | Doc links widget thingsboard.io links hidden |
| FIX 5 | Getting Started widget external doc links hidden |
| FIX 6 | Full login/password page redesign (split-panel layout, background image, white card, responsive breakpoints) |

---

#### Section 18: Update Login Page

**Files:**
- `ui-ngx/src/app/modules/login/pages/login/login.component.html`
- `ui-ngx/src/app/modules/login/pages/login/login.component.scss`

| Change | Pattern | Replacement |
|--------|---------|-------------|
| Logo link | `link="https://thingsboard.io"` | `link="https://lumosoft.io"` |
| Background | `background-color: #eee` | `background-color: transparent` |
| Card height | `style="max-height: 80vh; overflow-y: auto;"` | `style="min-height: 100vh; overflow: visible;"` |
| Logo inject | (no existing) | Inserts `<img src="assets/logo_title_dark.svg" class="login-page-logo">` |

The logo injection is guarded by `grep -q "login-page-logo"` to be idempotent.

---

#### Section 19: Update 2FA Issuer

**File:** `ui-ngx/src/app/modules/home/pages/admin/two-factor-auth-settings.component.ts`

| Pattern | Replacement |
|---------|-------------|
| `{value: 'ThingsBoard'` | `{value: 'SignConnect'` |

This controls the issuer name shown in authenticator apps (Google Authenticator, Authy, etc.).

---

#### Section 20: Update Device Connectivity Dialog

**File:** `ui-ngx/src/app/modules/home/pages/device/device-check-connectivity-dialog.component.html`

| Condition | Pattern | Replacement |
|-----------|---------|-------------|
| `DOCS_URL` is set | `https://thingsboard.io` | `$DOCS_URL` |
| `DOCS_URL` empty | No change | Links hidden via CSS (FIX 1D in branding-fixes.css) |

---

#### Section 21: Verify Branding

Runs automated checks (not in dry-run mode):

| Check | What it verifies |
|-------|-----------------|
| `index.html` | No remaining "ThingsBoard" text |
| Color scan | No remaining `#305680` in `.ts`, `.scss`, `.svg` files |
| Login link | No remaining `link="https://thingsboard.io"` |
| 2FA issuer | No remaining `{value: 'ThingsBoard'` |

Outputs warnings for any issues found but does not fail the script.

---

#### Section 22: Update Backend Configuration

**File:** `application/src/main/resources/thingsboard.yml`

| Config | Pattern | Replacement |
|--------|---------|-------------|
| JWT Issuer | `JWT_TOKEN_ISSUER:thingsboard.io` | `JWT_TOKEN_ISSUER:signconnect.io` |
| Swagger URL | `SWAGGER_CONTACT_URL:https://thingsboard.io` | `SWAGGER_CONTACT_URL:https://lumosoft.io` |
| Swagger Email | `SWAGGER_CONTACT_EMAIL:info@thingsboard.io` | `SWAGGER_CONTACT_EMAIL:support@lumosoft.io` |
| Mobile App | `TB_MOBILE_APP_DOMAIN:demo.thingsboard.io` | `TB_MOBILE_APP_DOMAIN:signconnect.io` |

---

#### Section 23: Hide JWT/API Keys/Notifications for Customer Users

This section makes three Angular source code patches to restrict what customer-level users can see:

**23a. security.component.ts**
- Adds imports: `getCurrentAuthUser` from auth selectors, `Authority` enum
- Adds property: `isTenantAdmin = getCurrentAuthUser(this.store).authority !== Authority.CUSTOMER_USER`
- Guard: skips if `getCurrentAuthUser` already present (idempotent)

**23b. security.component.html**
- Adds `*ngIf="isTenantAdmin"` to the first two `<mat-card>` elements (JWT token card and API keys card)
- Customer users see neither JWT tokens nor API keys on the Security page

**23c. notification-settings-routing.modules.ts**
- Removes `Authority.CUSTOMER_USER` from the route auth array
- Before: `Authority.SYS_ADMIN, Authority.TENANT_ADMIN, Authority.CUSTOMER_USER`
- After: `Authority.SYS_ADMIN, Authority.TENANT_ADMIN`
- Customer users can no longer access notification settings

---

#### Section 24: Add "Back to Dashboard" Navigation

This section patches three files to give fullscreen customer users a "Home" button that navigates back to their default dashboard:

**24a. home.component.ts**
- Adds `Router` import and constructor injection
- Replaces `window.history.back()` with `this.goHome()`
- Inserts `goHome()` method that navigates to the user's `defaultDashboardId`

**24b. user-menu.component.ts**
- Adds `getCurrentAuthState` import and `AuthState` type
- Adds properties: `authState`, `isCustomerFullscreen`, `defaultDashboardId`
- Inserts `goHome()` method before `logout()`

**24c. user-menu.component.html**
- Inserts a `<button *ngIf="isCustomerFullscreen" mat-menu-item (click)="goHome()">` before the Account button
- Shows a Home icon with translated "home.home" text

All three patches are guarded by `grep -q 'goHome'` checks — safe to re-run.

---

## 4. Widget Deployment

### Deploy Pattern

Each widget has its own `deploy.py` script that follows a consistent pattern:

```
authenticate → find/create bundle → read widget files → POST/PUT widget → link to bundle
```

### API Flow

```python
# 1. Authenticate
POST /api/auth/login  →  JWT token

# 2. Find or create the "SignConnect" bundle
GET  /api/widgetsBundles  →  search for BUNDLE_NAME
POST /api/widgetsBundle   →  create if not found

# 3. Check if widget already exists
GET  /api/widgetTypesInfos?widgetsBundleId={id}&pageSize=100&page=0  →  search by FQN/name
GET  /api/widgetType/{id}  →  fetch full descriptor if needed

# 4. Create or update the widget
POST /api/widgetType?widgetsBundleId={id}  →  create/update (include existing ID for update)
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TB_URL` | `http://localhost:8080` | ThingsBoard instance URL |
| `TB_USER` | `support@lumosoft.io` | Login username (tenant admin) |
| `TB_PASS` | `tenant` | Login password |

### Widget Payload Structure

```python
{
    "alias": "widget_fqn",           # URL-safe identifier
    "fqn": "widget_fqn",             # Fully qualified name
    "name": "Widget Display Name",   # Human-readable name
    "descriptor": {
        "type": "latest",            # Widget type (latest, timeseries, static, etc.)
        "sizeX": 24, "sizeY": 3,     # Default grid size
        "templateHtml": "...",       # From template.html
        "templateCss": "...",        # From template.css
        "controllerScript": "...",   # From controller.js
        "settingsSchema": "...",     # From settings-schema.json
        "defaultConfig": "..."       # JSON-encoded default widget config
    }
}
```

### Bundle

All widgets are deployed to the **"SignConnect"** bundle. The bundle is auto-created on first widget deploy if it doesn't exist.

### Deploy Commands

```bash
# Deploy a single widget
cd branding/widgets/fleet-summary
python3 deploy.py

# Deploy all widgets
for d in branding/widgets/*/; do
    [ -f "$d/deploy.py" ] && (cd "$d" && python3 deploy.py)
done

# Deploy with custom target
TB_URL=https://signconnect.example.com TB_USER=admin@example.com TB_PASS=secret \
    python3 deploy.py
```

---

## 5. Widget Inventory

| # | Directory | FQN | Description | Files |
|---|-----------|-----|-------------|-------|
| 1 | `chat-widget` | `chat_widget` | AI chatbot widget for support/queries | 6 |
| 2 | `customer-manager` | `customer_manager` | Customer CRUD management table | 5 |
| 3 | `dali-scheduler` | `dali_scheduler` | DALI lighting schedule editor | 5 |
| 4 | `device-manager` | `device_manager` | Device management table with actions | 5 |
| 5 | `device-pool` | `device_pool` | Unassigned device pool for provisioning | 5 |
| 6 | `dim-control` | `dim_control` | Dimming slider RPC control | 5 |
| 7 | `fault-status` | `fault_status` | Generic fault/warning status panel | 5 |
| 8 | `fault-status-dali2` | `fault_status_dali2` | DALI-2 specific fault status panel | 5 |
| 9 | `fleet-client-summary` | `fleet_client_summary` | Fleet-level client summary cards | 5 |
| 10 | `fleet-energy-summary` | `fleet_energy_summary` | Fleet energy consumption summary | 5 |
| 11 | `fleet-map` | `fleet_map` | Fleet map visualization with markers | 5 |
| 12 | `fleet-summary` | `fleet_summary_cards` | Fleet device summary cards | 5 |
| 13 | `management-home` | `management_home` | Management dashboard home panel | 5 |
| 14 | `management-nav-tree` | `management_nav_tree` | Management navigation tree | 5 |
| 15 | `nav-buttons` | `nav_buttons` | Navigation button bar | 5 |
| 16 | `nav-tree` | `nav_tree` | Customer-facing navigation tree | 6 |
| 17 | `onboarding-wizard` | `onboarding_wizard` | Tenant onboarding wizard | 5 |
| 18 | `report` | `report_viewer` | PDF report viewer/generator widget | 5 |
| 19 | `site-energy-summary` | `site_energy_summary` | Site-level energy summary | 5 |
| 20 | `site-fault-status` | `site_fault_status` | Site-level fault status panel | 5 |
| 21 | `site-manager` | `site_manager` | Site CRUD management | 5 |
| 22 | `site-overview` | `site_overview` | Site overview dashboard panel | 5 |
| 23 | `status-banner` | `status_banner` | Connection status banner | 5 |

All widgets use the `latest` telemetry type unless otherwise configured in their `deploy.py`.

---

## 6. Configuration Reference (config.env)

### Brand Identity

| Variable | Value | Description |
|----------|-------|-------------|
| `BRAND_NAME` | `SignConnect` | Replaces "ThingsBoard" throughout UI, emails, translations |
| `BRAND_COMPANY` | `Lumosoft` | Company name for copyright and Swagger |
| `BRAND_DOMAIN` | `signconnect.io` | Domain for URL references |
| `WEBSITE_URL` | `https://lumosoft.io` | Footer links, login logo link, Swagger contact |

### Color Palette

All colors in hex format **without** the `#` prefix.

| Variable | Value | Description | Replaces |
|----------|-------|-------------|----------|
| `PRIMARY_COLOR` | `17212b` | Sidebar, header background (dark navy) | `305680` |
| `SECONDARY_COLOR` | `f9b11d` | Buttons, accents (golden yellow) | `527dad` |
| `ACCENT_COLOR` | `f9b11d` | Highlights, hover states | `a7c1de` |
| `DARK_PRIMARY_COLOR` | `232c36` | Dark mode primary | `9fa8da` |
| `LIGHT_PRIMARY_COLOR` | `2e3740` | Hover states on dark backgrounds | `7986cb` |
| `LINK_COLOR` | `f9b11d` | Text link color | `106cc8` |
| `LOADING_SPINNER_COLOR` | `249,177,29` | RGB format, loading spinner | `43,160,199` |

### Copyright & Legal

| Variable | Value | Description |
|----------|-------|-------------|
| `COPYRIGHT_HOLDER` | `Lumosoft` | Footer copyright holder name |
| `COPYRIGHT_TEXT` | `Copyright ${year} Lumosoft` | Full copyright text |

### Documentation

| Variable | Value | Description |
|----------|-------|-------------|
| `DOCS_URL` | *(empty)* | Help/documentation base URL. Empty = disable help links |

### Email Templates

| Variable | Value | Description |
|----------|-------|-------------|
| `EMAIL_SENDER_NAME` | `SignConnect` | Email sender display name |
| `EMAIL_SIGNATURE` | `— The SignConnect Team` | Email signature line |
| `EMAIL_FOOTER` | `powered by SignConnect` | Email footer text |

### Translation Settings

| Variable | Value | Description |
|----------|-------|-------------|
| `UPDATE_ALL_TRANSLATIONS` | `true` | Update all 29 locales (vs only en_US) |
| `FIX_POWERED_BY_TEXT` | `false` | Replace "powered by X" with "by X" |

### UI Elements

| Variable | Value | Description |
|----------|-------|-------------|
| `HIDE_GITHUB_BADGE` | `true` | Hide GitHub star badge in toolbar |
| `REMOVE_POWERED_BY_FOOTER` | `true` | Remove "Powered by ThingsBoard" from dashboards |
| `REMOVE_HELP_LINKS` | `true` | Remove all help "?" icons |

### Hardcoded Color Replacement

| Variable | Value | Description |
|----------|-------|-------------|
| `REPLACE_HARDCODED_COLORS` | `true` | Global find-replace of `#305680` in 60+ files |

### API Documentation

| Variable | Value | Description |
|----------|-------|-------------|
| `UPDATE_SWAGGER` | `true` | Rebrand Swagger API documentation |

### Backend Configuration

| Variable | Value | Description |
|----------|-------|-------------|
| `JWT_ISSUER_DOMAIN` | `signconnect.io` | JWT token issuer domain |
| `SWAGGER_CONTACT_EMAIL` | `support@lumosoft.io` | Swagger API contact email |
| `MOBILE_APP_DOMAIN` | `signconnect.io` | Mobile app deep-link domain |

### Backup Settings

| Variable | Value | Description |
|----------|-------|-------------|
| `CREATE_BACKUP` | `true` | Create backups before modifying files |
| `BACKUP_DIR` | `originals` | Backup directory (relative to `branding/`) |
| `BACKUP_TRANSLATIONS` | `false` | Also backup translation files (~50MB) |

### Script Settings

| Variable | Value | Description |
|----------|-------|-------------|
| `VERBOSE` | `false` | Enable verbose logging output |

---

## 7. Assets

| File | Format | Size | Description | Destination |
|------|--------|------|-------------|-------------|
| `logo_title_white.svg` | SVG | 2.8 KB | Full brand logo with text (white, for dark sidebar) | `ui-ngx/src/assets/logo_title_white.svg` |
| `logo_title_white2.svg` | SVG | 3.3 KB | Alternate brand logo variant | *(spare, not auto-deployed)* |
| `logo_title_dark.svg` | SVG | 2.8 KB | Full brand logo with text (dark, for white login card) | `ui-ngx/src/assets/logo_title_dark.svg` |
| `logo_white.svg` | SVG | 0.9 KB | Square icon logo (white, for collapsed sidebar) | `ui-ngx/src/assets/logo_white.svg` |
| `logo_white2.svg` | SVG | 0.9 KB | Alternate square icon variant | *(spare, not auto-deployed)* |
| `favicon.ico` | ICO | 4.3 KB | Browser tab favicon | `ui-ngx/src/thingsboard.ico` |
| `login-bg.png` | PNG | 195 KB | Login page left-panel background image | `ui-ngx/src/assets/login-bg.png` |
| `branding-fixes.css` | CSS | 10.5 KB | CSS overrides (321 lines) injected into styles.scss | Appended to `ui-ngx/src/styles.scss` |
| `README.md` | MD | 2.1 KB | Asset documentation | *(not deployed)* |

### Design Specifications

- **Sidebar logos** (`logo_title_white.svg`): White text/icon on transparent background. Displayed in the left sidebar when expanded. Recommended dimensions: ~200×40px viewBox.
- **Collapsed logo** (`logo_white.svg`): White icon only, no text. Shown when sidebar is collapsed. Square aspect ratio (~40×40px viewBox).
- **Login logo** (`logo_title_dark.svg`): Dark text/icon on transparent background. Displayed on the white login card. Same dimensions as sidebar logo.
- **Favicon** (`favicon.ico`): Standard multi-size ICO format. Should include 16×16 and 32×32 sizes minimum.
- **Login background** (`login-bg.png`): Photo or illustration shown on the left panel of the split login page. Should be high-resolution (1200px+ width) with content weighted to the left/center (right edge fades via CSS gradient).

---

## 8. Adding a New Widget

### Step 1: Create Widget Directory

```bash
mkdir branding/widgets/my-new-widget
```

### Step 2: Create Widget Files

Create the 5 standard files:

```
my-new-widget/
├── controller.js           # Widget JavaScript logic
├── template.html           # Widget HTML template
├── template.css            # Widget CSS styles
├── settings-schema.json    # Widget settings form schema
└── deploy.py               # Deployment script
```

### Step 3: Write the deploy.py

Copy an existing `deploy.py` (e.g., from `fleet-summary/`) and update:

```python
WIDGET_FQN = "my_new_widget"        # URL-safe, unique across tenant
WIDGET_NAME = "My New Widget"       # Human-readable display name
```

Configure the descriptor in `build_descriptor()`:
- Set `type` (`latest`, `timeseries`, `static`, `rpc`, `alarm`, `static`)
- Set `sizeX`, `sizeY` (grid units, max 24 wide)
- Define `dataKeys` for required telemetry/attribute keys
- Set `defaultConfig` for initial widget settings

### Step 4: Deploy the Widget

```bash
cd branding/widgets/my-new-widget
python3 deploy.py
```

This creates the widget and adds it to the "SignConnect" bundle automatically.

### Step 5: Add to a Dashboard

1. Open the target dashboard in ThingsBoard edit mode
2. Click "Add widget" → select the "SignConnect" bundle
3. Find your widget by name and add it
4. Configure datasources and settings
5. Save the dashboard

### Step 6: Export Dashboard JSON (Optional)

If the dashboard JSON is version-controlled (e.g., in `ui-ngx/src/assets/dashboard/`), export it:

```bash
# Via API
curl -X GET "$TB_URL/api/dashboard/$DASHBOARD_ID" \
  -H "X-Authorization: Bearer $TOKEN" \
  | jq . > dashboard.json
```

Update the widget's `typeFullFqn` in the dashboard JSON. The format is just the FQN string (e.g., `tenant.my_new_widget`), NOT `bundleAlias.fqn`.

---

## 9. Updating After Upstream Pull

### Standard Workflow

```bash
# 1. Ensure branding is reverted (source files are original)
cd branding/scripts
./revert-branding.sh

# 2. Pull upstream changes
cd /home/ubuntu/thingsboard
git fetch upstream
git merge upstream/master

# 3. Resolve any conflicts (rare — source files should be clean)
#    If conflicts occur, compare with originals/ for reference

# 4. Re-apply branding
cd branding/scripts
./apply-branding.sh

# 5. Rebuild and deploy
cd deploy/standalone
./install.sh --demo --build
```

### How originals/ Helps

The `originals/` directory contains copies of every file from the last time branding was applied. If upstream changes a file that the branding script also modifies:

1. Compare `originals/<file>` with the new upstream version to see what changed upstream
2. Compare `originals/<file>` with the branded version to see what branding changed
3. Update `apply-branding.sh` patterns if upstream restructured the target strings
4. Delete the outdated file from `originals/` so the next run creates a fresh backup

### Common Upstream Changes That Require Script Updates

| Change | Impact | Fix |
|--------|--------|-----|
| SCSS variable renamed | Section 4 `sed` patterns miss | Update variable names in section 4 |
| New email template added | Not branded | Add to section 10 (auto-handled by `for template in *.ftl` loop) |
| HTML structure changed | `sed` patterns don't match | Update HTML patterns in relevant section |
| New hardcoded `#305680` added | Missed by section 6 | Auto-handled (section 6 does recursive find) |
| Angular component restructured | Sections 23/24 patches fail | Update `sed` and insertion logic |

### Dry Run First

Always test with `--dry-run` after an upstream pull to verify patterns still match:

```bash
./apply-branding.sh --dry-run --verbose 2>&1 | grep WARNING
```

---

## 10. Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| "ThingsBoard" still visible in UI | Translation file missed or new string added upstream | Run `grep -r "ThingsBoard" ui-ngx/src/assets/locale/` to find remnants. Update section 11 patterns or add new `sed` rules. |
| Login page shows plain white background | `login-bg.png` not copied or wrong path | Verify `branding/assets/login-bg.png` exists. Re-run section 2. Check browser DevTools network tab for 404. |
| Old ThingsBoard blue (#305680) still appears | Hardcoded color in a file type not covered by section 6 | Check which files: `grep -ri "#305680" ui-ngx/src/`. Add the file type to the `find` command in section 6. |
| Email still says "ThingsBoard" | New email template or new text pattern | Check `grep -r "ThingsBoard" application/src/main/resources/templates/`. Add missing patterns to section 10. |
| Widget deploy fails with 401 | Token expired or wrong credentials | Verify `TB_USER` and `TB_PASS` environment variables. Check the user has TENANT_ADMIN authority. |
| Widget deploy fails with 404 | ThingsBoard API version mismatch | The script tries paginated API first, then falls back. Check TB version supports `/api/widgetType` endpoint. |
| CSS fixes not applied after build | `styles.scss` marker detection failed | Check `grep "SignConnect Branding" ui-ngx/src/styles.scss`. If duplicate markers, clean and re-run. |
| 2FA shows "ThingsBoard" in authenticator app | Section 19 pattern didn't match | Check `grep "value:" ui-ngx/src/app/modules/home/pages/admin/two-factor-auth-settings.component.ts`. Upstream may have changed the format. |
| Customer users still see JWT/API keys | Section 23 patches didn't apply | Check `grep "isTenantAdmin" ui-ngx/src/app/modules/home/pages/security/`. If missing, the HTML structure may have changed. |
| "Back to Dashboard" button missing | Section 24 patches didn't apply | Check `grep "goHome" ui-ngx/src/app/shared/components/user-menu.component.ts`. Verify the insertion anchor (`logout()` method) still exists. |
| Build fails after apply-branding | Syntax error in patched TypeScript/HTML | Run `--dry-run` first. Check the specific error file against its `originals/` backup. Common cause: upstream changed the line structure that `sed` targets. |
| `revert-branding.sh` fails | Missing backup files in `originals/` | Re-checkout the files from git: `git checkout -- <file>`. Then re-run `apply-branding.sh` with `CREATE_BACKUP="true"`. |

### Diagnostic Commands

```bash
# Check for remaining ThingsBoard references
grep -ri "ThingsBoard" ui-ngx/src/index.html
grep -ri "thingsboard.io" ui-ngx/src/app/ --include="*.html" --include="*.ts"

# Check hardcoded colors
grep -ri "#305680" ui-ngx/src/ --include="*.ts" --include="*.scss" --include="*.svg" | wc -l

# Verify CSS injection
tail -5 ui-ngx/src/styles.scss

# Check widget bundle exists
curl -s "$TB_URL/api/widgetsBundles" -H "X-Authorization: Bearer $TOKEN" | jq '.[].title'

# List widgets in SignConnect bundle
BUNDLE_ID=$(curl -s "$TB_URL/api/widgetsBundles" -H "X-Authorization: Bearer $TOKEN" | jq -r '.[] | select(.title=="SignConnect") | .id.id')
curl -s "$TB_URL/api/widgetTypesInfos?widgetsBundleId=$BUNDLE_ID&pageSize=100&page=0" \
  -H "X-Authorization: Bearer $TOKEN" | jq '.data[].name'

# Verify branding was applied (automated)
./apply-branding.sh --dry-run --verbose 2>&1 | grep -E "WARNING|ERROR"
```
