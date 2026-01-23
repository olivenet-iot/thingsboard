# ThingsBoard White-Label Branding Guide

## Overview

Complete guide for white-labeling ThingsBoard. The branding system applies customizations at deploy time while keeping source files original for clean upstream upgrades.

## Branding Architecture

```
Repository (Clean)              Deploy Time
┌─────────────────────┐         ┌─────────────────────┐
│ Original ThingsBoard│  ──►    │ apply-branding.sh   │
│ Files (untouched)   │         │                     │
└─────────────────────┘         └──────────┬──────────┘
                                           │
┌─────────────────────┐                    ▼
│ branding/           │         ┌─────────────────────┐
│ ├── config.env      │  ──►    │ Modified Source     │
│ ├── assets/         │         │ (logo, colors, etc.)│
│ └── scripts/        │         └──────────┬──────────┘
└─────────────────────┘                    │
                                           ▼
                                ┌─────────────────────┐
                                │ Build & Deploy      │
                                └─────────────────────┘
```

## Branding Configuration

### Config File Location
`branding/config.env`

### Configuration Options

```bash
# Brand Identity
BRAND_NAME="SignConnect"
BRAND_COMPANY="Lumosoft"

# Colors (without #)
PRIMARY_COLOR="17212b"      # Main brand color
SECONDARY_COLOR="f9b11d"    # Accent color
ACCENT_COLOR="f9b11d"       # Button highlights
LOADING_SPINNER_COLOR="249,177,29"  # RGB format

# Feature Toggles
REMOVE_POWERED_BY_FOOTER="true"     # Remove footer attribution
REMOVE_HELP_LINKS="true"            # Remove ThingsBoard docs links
CUSTOM_FAVICON="true"               # Use custom favicon
```

## Files to Customize

### Logo Files

| File | Size | Usage |
|------|------|-------|
| `ui-ngx/src/assets/logo_title_white.svg` | ~200x50 | Login page, full logo |
| `ui-ngx/src/assets/logo_white.svg` | ~50x50 | Sidebar icon |
| `ui-ngx/src/assets/logo_title_white_tb.svg` | ~200x50 | Dark theme variant |

### Favicon

| File | Format | Usage |
|------|--------|-------|
| `ui-ngx/src/thingsboard.ico` | ICO | Browser tab icon |
| `ui-ngx/src/favicon.ico` | ICO | Alternative location |

### Colors

**File**: `ui-ngx/src/scss/constants.scss` (lines 34-39)

```scss
// Original ThingsBoard colors
$tb-primary-color: #305680;
$tb-secondary-color: #527dad;
$tb-hue3-color: #a7c1de;
$tb-dark-primary-color: #9fa8da;

// After branding (example)
$tb-primary-color: #17212b;
$tb-secondary-color: #f9b11d;
$tb-hue3-color: #f9b11d;
$tb-dark-primary-color: #f9b11d;
```

### Page Title

**File**: `ui-ngx/src/index.html` (line 22)

```html
<!-- Original -->
<title>ThingsBoard</title>

<!-- After branding -->
<title>SignConnect</title>
```

### Environment Config

**File**: `ui-ngx/src/environments/environment.ts`

```typescript
export const environment = {
  appTitle: 'SignConnect',  // Changed from 'ThingsBoard'
  production: false
};
```

### Footer

**File**: `ui-ngx/src/app/shared/components/footer.component.html`

```html
<!-- Original -->
<span>Powered by ThingsBoard</span>

<!-- After branding (removed or replaced) -->
<span>&copy; 2024 Lumosoft</span>
```

### Translations

**Location**: `ui-ngx/src/assets/locale/locale.constant-*.json` (27 languages)

Key translations to update:
```json
{
  "white-labeling": {
    "platform-name": "SignConnect"
  },
  "login": {
    "welcome": "Welcome to SignConnect"
  },
  "home": {
    "home": "SignConnect Home"
  }
}
```

### Email Templates

**Location**: `application/src/main/resources/templates/*.ftl`

Key templates:
- `activation.ftl` - Account activation
- `reset.password.ftl` - Password reset
- `test.ftl` - Test email

```ftl
<!-- Header -->
<td style="background-color: #17212b">
  <img src="logo.png" alt="SignConnect">
</td>

<!-- Footer -->
<td>
  &copy; ${.now?string('yyyy')} Lumosoft
</td>
```

## Branding Scripts

### Apply Branding

```bash
./branding/scripts/apply-branding.sh
```

**Actions performed:**
1. Backup original files to `branding/originals/`
2. Copy logo assets
3. Update SCSS color variables
4. Update index.html title
5. Update environment.ts appTitle
6. Modify translations (all 27 languages)
7. Update email templates
8. Remove/replace footer
9. Remove help documentation links

### Revert Branding

```bash
./branding/scripts/revert-branding.sh
```

**Actions performed:**
1. Restore files from `branding/originals/`
2. Clean up temporary files

## Script Implementation

### apply-branding.sh Structure

```bash
#!/bin/bash
set -e

# Load configuration
source branding/config.env

# Paths
UI_DIR="ui-ngx/src"
ASSETS_DIR="$UI_DIR/assets"
SCSS_DIR="$UI_DIR/scss"
TEMPLATES_DIR="application/src/main/resources/templates"

# 1. Backup originals
backup_file() {
    if [[ ! -f "branding/originals/$1" ]]; then
        cp "$1" "branding/originals/$1"
    fi
}

# 2. Copy logos
cp branding/assets/logo_title_white.svg "$ASSETS_DIR/"
cp branding/assets/logo_white.svg "$ASSETS_DIR/"

# 3. Update colors
sed -i "s/#305680/#${PRIMARY_COLOR}/g" "$SCSS_DIR/constants.scss"
sed -i "s/#527dad/#${SECONDARY_COLOR}/g" "$SCSS_DIR/constants.scss"

# 4. Update title
sed -i "s/<title>ThingsBoard<\/title>/<title>${BRAND_NAME}<\/title>/" "$UI_DIR/index.html"

# 5. Update translations (all languages)
for locale in "$ASSETS_DIR/locale/"locale.constant-*.json; do
    sed -i "s/ThingsBoard/${BRAND_NAME}/g" "$locale"
done

# 6. Update email templates
for template in "$TEMPLATES_DIR/"*.ftl; do
    sed -i "s/ThingsBoard/${BRAND_NAME}/g" "$template"
done

# 7. Remove footer (optional)
if [[ "$REMOVE_POWERED_BY_FOOTER" == "true" ]]; then
    # Modify footer component
fi
```

## Deployment Workflow

### Fresh Deployment

```bash
# 1. Clone repository
git clone https://github.com/your-org/thingsboard.git
cd thingsboard

# 2. Apply branding
./branding/scripts/apply-branding.sh

# 3. Build
mvn clean install -DskipTests -Dlicense.skip=true

# 4. Deploy
cd docker && ./docker-start-services.sh
```

### Upgrade Workflow

```bash
# 1. Fetch upstream
git fetch upstream
git merge upstream/v4.4.0

# 2. No conflicts (source files are original)

# 3. Apply branding
./branding/scripts/apply-branding.sh

# 4. Build and deploy
./deploy/deploy.sh
```

## Testing Branding Changes

### Visual Checklist

1. **Login Page**
   - [ ] Logo displayed correctly
   - [ ] Page title in browser tab
   - [ ] Loading spinner color

2. **Dashboard**
   - [ ] Sidebar logo
   - [ ] Primary color in navigation
   - [ ] Footer content

3. **Emails**
   - [ ] Brand logo in header
   - [ ] Company name in footer
   - [ ] Correct colors

### Browser Cache

After applying branding, clear browser cache:
- Chrome: `Ctrl+Shift+R` (hard refresh)
- Or open DevTools → Network → Disable cache

## Common Issues

### Colors Not Applied

**Cause**: SCSS not rebuilt

**Fix**: Full UI rebuild
```bash
cd ui-ngx
rm -rf node_modules/.cache dist
yarn build:prod
```

### Logo Not Showing

**Cause**: File format or path issue

**Fix**: Verify SVG format and path
```bash
file ui-ngx/src/assets/logo_title_white.svg
# Should be: SVG Scalable Vector Graphics image
```

### Translation Not Updated

**Cause**: Translation caching

**Fix**: Clear translation cache
```bash
# Rebuild with cache clear
cd ui-ngx && yarn build:prod --delete-output-path
```

### Upgrade Merge Conflicts

**Cause**: Branding committed to source files

**Fix**: Revert branding before merge
```bash
./branding/scripts/revert-branding.sh
git merge upstream/master
./branding/scripts/apply-branding.sh
```

## Assets Preparation

### Logo Requirements

| Asset | Format | Recommended Size | Background |
|-------|--------|------------------|------------|
| Main Logo | SVG | 200x50 px | Transparent |
| Icon | SVG | 50x50 px | Transparent |
| Favicon | ICO | 32x32, 16x16 | Transparent |

### Color Format

| Usage | Format | Example |
|-------|--------|---------|
| SCSS | Hex without # | `17212b` |
| Spinner | RGB comma-separated | `249,177,29` |
| Email HTML | Hex with # | `#17212b` |

### SVG Optimization

```bash
# Install svgo
npm install -g svgo

# Optimize SVG
svgo logo.svg -o logo-optimized.svg
```
