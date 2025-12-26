# ThingsBoard White-Label Analysis

Complete inventory of all branding touchpoints for white-labeling ThingsBoard.

**Target Brand**: SignConnect by Lumosoft
**Source Version**: ThingsBoard 4.3.0-RC

## Summary

| Category | Count | Priority |
|----------|-------|----------|
| Logo/Icon Files | 3 | Critical |
| Page Title | 1 | Critical |
| Color Definitions | 2 files | Critical |
| Copyright/Footer | 2 | Critical |
| Email Templates | 10 | High |
| Help URL References | 1 file (100+ links) | High |
| Translation Files | 27 | Medium |
| Console Logs | 1 | Low |
| Hardcoded Colors | 12+ files | Low |

---

## Critical Priority (Must Change)

### 1. Logo Files

#### Main Logo with Text
- **File**: `ui-ngx/src/assets/logo_title_white.svg`
- **Dimensions**: 1543.4 x 320 pixels
- **Usage**: Header, login page, sidebar
- **Action**: Replace with SignConnect logo

#### Icon Logo
- **File**: `ui-ngx/src/assets/logo_white.svg`
- **Usage**: Loading screens, compact views
- **Action**: Replace with SignConnect icon

#### Favicon
- **File**: `ui-ngx/src/thingsboard.ico`
- **Size**: 4.3 KB
- **Usage**: Browser tab icon
- **Action**: Replace with SignConnect favicon
- **Note**: Also referenced in `ui-ngx/angular.json`

### 2. Page Title

- **File**: `ui-ngx/src/index.html`
- **Line**: 22
- **Current**: `<title>ThingsBoard</title>`
- **Action**: Change to `<title>SignConnect</title>`

Additional locations in same file:
- **Line 26**: Favicon reference `href="thingsboard.ico"`
- **Line 55**: Loading spinner color `background-color: rgb(43,160,199);`

### 3. Color Definitions

#### Primary Constants
- **File**: `ui-ngx/src/scss/constants.scss`
- **Lines**: 34-39

```scss
// Current values:
$tb-primary-color: #305680;      // Line 34 - PRIMARY
$tb-secondary-color: #527dad;    // Line 35 - SECONDARY
$tb-hue3-color: #a7c1de;         // Line 36 - LIGHT
$tb-dark-primary-color: #9fa8da; // Line 38 - DARK MODE
$tb-primary-color-light: #7986cb;// Line 39 - LIGHT PRIMARY
```

#### Material Theme
- **File**: `ui-ngx/src/theme.scss`
- **Description**: Defines Material Design color palette
- **Action**: Update palette definitions to match new brand colors

### 4. Copyright/Footer

#### Footer Component
- **File**: `ui-ngx/src/app/shared/components/footer.component.html`
- **Line**: 19
- **Current**: `<small>Copyright © {{year}} The ThingsBoard Authors</small>`
- **Action**: Change to `Copyright © {{year}} Lumosoft`

#### Dashboard Footer ("Powered by")
- **File**: `ui-ngx/src/app/modules/home/components/dashboard-page/dashboard-page.component.html`
- **Contains**: `Powered by <a href="https://thingsboard.io">ThingsBoard v.{{ thingsboardVersion }}</a>`
- **Action**: Remove or replace attribution

---

## High Priority (Should Change)

### 5. Email Templates

All FreeMarker templates in `application/src/main/resources/templates/`:

| File | Title Line | Signature | Footer |
|------|------------|-----------|--------|
| `activation.ftl` | Line 23: "Thingsboard - Account Activation" | Line 106: "— The Thingsboard" | Line 114: "by Thingsboard" |
| `reset.password.ftl` | Line 23: "Thingsboard - Reset Password Request" | "— The Thingsboard" | "by Thingsboard" |
| `account.activated.ftl` | Similar structure | | |
| `account.lockout.ftl` | Similar structure | | |
| `2fa.verification.code.ftl` | Similar structure | | |
| `password.was.reset.ftl` | Similar structure | | |
| `state.disabled.ftl` | Similar structure | | |
| `state.enabled.ftl` | Similar structure | | |
| `state.warning.ftl` | Similar structure | | |
| `test.ftl` | Similar structure | | |

**Common Branding Elements in Email Templates:**
- Title: `<title>Thingsboard - [Action]</title>`
- Heading: "Activate your Thingsboard account" or similar
- Signature: "— The Thingsboard"
- Footer: "by Thingsboard"

**Note**: Some templates reference external image `https://media.thingsboard.io/email/head.png`

### 6. Help URL References

- **File**: `ui-ngx/src/app/shared/models/constants.ts`
- **Line**: 84
- **Current**: `export const helpBaseUrl = 'https://thingsboard.io';`
- **Action**: Remove or point to custom documentation

This file contains 100+ help links using this base URL (lines 91-223+):
- Mail settings documentation
- SMS provider settings
- OAuth2 settings
- Rule engine documentation
- Device profiles
- Dashboards
- Widgets
- And many more...

### 7. Environment Files

- **File**: `ui-ngx/src/environments/environment.ts`
- **File**: `ui-ngx/src/environments/environment.prod.ts`
- **Property**: `appTitle: 'ThingsBoard'`
- **Action**: Change to `appTitle: 'SignConnect'`

---

## Medium Priority (Should Change for Complete White-Label)

### 8. Translation Files

**Location**: `ui-ngx/src/assets/locale/`

All 27 language files contain "ThingsBoard" strings:

| File | Size | Notes |
|------|------|-------|
| `locale.constant-en_US.json` | 10,218 lines | Primary |
| `locale.constant-de_DE.json` | ~10K lines | German |
| `locale.constant-es_ES.json` | ~10K lines | Spanish |
| `locale.constant-fr_FR.json` | ~10K lines | French |
| `locale.constant-zh_CN.json` | ~10K lines | Chinese |
| `locale.constant-ja_JP.json` | ~10K lines | Japanese |
| `locale.constant-ko_KR.json` | ~10K lines | Korean |
| `locale.constant-pt_BR.json` | ~10K lines | Portuguese |
| `locale.constant-ru_RU.json` | ~10K lines | Russian |
| ... | | 18 more files |

**Common ThingsBoard Strings Found**:
- `"white-labeling": "White-labeling"` - Feature name
- `"powered-by": "Powered by ThingsBoard"` - Attribution
- `"thingsboard-version": "ThingsBoard version"` - Version display
- `"flutter-thingsboard-app": "Flutter ThingsBoard Mobile Application"` - Mobile app
- Various references in tooltips and help text

**Script Approach**: Use sed/awk to replace:
- `ThingsBoard` → `SignConnect`
- `Thingsboard` → `SignConnect`
- `thingsboard` → `signconnect` (for URLs)

### 9. Logo Component Default

- **File**: `ui-ngx/src/app/shared/components/logo.component.ts`
- **Line**: 33
- **Current**: `src: string | UrlHolder = 'assets/logo_title_white.svg';`
- **Action**: Will automatically use new logo after file replacement

---

## Low Priority (Optional)

### 10. Console Log

- **File**: `ui-ngx/src/app/app.component.ts`
- **Line**: 51
- **Current**: `console.log('ThingsBoard Version: ${env.tbVersion}');`
- **Action**: Change to `console.log('SignConnect Version: ${env.tbVersion}');`

### 11. Hardcoded Colors in SCSS

Files with hardcoded `#305680` (ThingsBoard blue):

| File | Lines | Context |
|------|-------|---------|
| `ui-ngx/src/app/shared/components/script-lang.component.scss` | Multiple | Background |
| `ui-ngx/src/app/shared/components/notification/notification.component.ts` | - | Notification |
| `ui-ngx/src/app/shared/components/markdown.component.scss` | - | Code block |
| `ui-ngx/src/app/shared/components/button/widget-button-toggle.component.scss` | - | Checked state |
| `ui-ngx/src/app/modules/home/pages/device/device-check-connectivity-dialog.component.scss` | - | Border |
| `ui-ngx/src/app/modules/home/pages/notification/sent/sent-table-config.resolver.ts` | - | Table colors |
| `ui-ngx/src/app/modules/home/pages/rulechain/rulechain-page.component.scss` | - | Shadows |
| `ui-ngx/src/app/modules/home/components/filter/filter-text.component.scss` | - | Text |
| `ui-ngx/src/app/modules/home/components/alarm-rules/filter/alarm-rule-filter-text.component.scss` | - | Text |
| `ui-ngx/src/app/modules/home/components/profile/tenant/rate-limits/rate-limits-text.component.scss` | - | Text |
| `ui-ngx/src/app/modules/home/components/widget/lib/home-page/getting-started-widget.component.scss` | - | Links |
| `ui-ngx/src/app/modules/home/components/widget/lib/home-page/getting-started-completed-dialog.component.scss` | - | Border |

**Recommended Approach**: Global find/replace `#305680` → `$new-brand-color`

### 12. Loading Spinner Color

- **File**: `ui-ngx/src/index.html`
- **Line**: 55
- **Current**: `background-color: rgb(43,160,199);`
- **Action**: Update to match brand primary color

---

## Files NOT to Modify

### Source Code Copyright Headers

Every source file contains:
```
Copyright © 2016-2025 The Thingsboard Authors
Licensed under the Apache License, Version 2.0
```

**Do NOT change these** - Required for Apache 2.0 license compliance.

### Internal Variable Names

Variable names like `tb-*`, `thingsboard-*` in code are internal and do not need changing.

---

## Branding Checklist

### Before Starting
- [ ] Obtain SignConnect logo (SVG, white version)
- [ ] Obtain SignConnect icon (SVG, white version)
- [ ] Create favicon (ICO format, multiple sizes)
- [ ] Define brand color palette
- [ ] Decide on copyright text

### Critical Changes
- [ ] Replace `ui-ngx/src/assets/logo_title_white.svg`
- [ ] Replace `ui-ngx/src/assets/logo_white.svg`
- [ ] Replace `ui-ngx/src/thingsboard.ico`
- [ ] Update `ui-ngx/src/index.html` (title, favicon reference)
- [ ] Update `ui-ngx/src/scss/constants.scss` (colors)
- [ ] Update `ui-ngx/src/app/shared/components/footer.component.html`

### High Priority Changes
- [ ] Update all email templates in `application/src/main/resources/templates/`
- [ ] Update `ui-ngx/src/app/shared/models/constants.ts` (remove help URLs)
- [ ] Update `ui-ngx/src/environments/environment*.ts`
- [ ] Update dashboard "Powered by" section

### Medium Priority Changes
- [ ] Update all 27 translation files in `ui-ngx/src/assets/locale/`

### Low Priority Changes
- [ ] Update console log in `app.component.ts`
- [ ] Replace hardcoded colors in component SCSS files
- [ ] Update loading spinner color

### Verification
- [ ] Run UI build without errors
- [ ] Check all pages for visual branding
- [ ] Test email templates
- [ ] Verify no "ThingsBoard" text visible to users
- [ ] Check browser tab shows correct favicon/title

---

## Quick Reference: Search Commands

```bash
# Find all ThingsBoard references
grep -r "ThingsBoard" ui-ngx/src/ --include="*.ts" --include="*.html"

# Find hardcoded brand color
grep -r "#305680" ui-ngx/src/ --include="*.scss" --include="*.ts"

# Find logo references
grep -r "logo.*\.svg" ui-ngx/src/ --include="*.ts" --include="*.html"

# Find help URL references
grep -r "thingsboard.io" ui-ngx/src/
```
