# White-Label Skill

Instructions for applying custom branding to ThingsBoard.

## Quick Start

```bash
# 1. Configure branding
cp branding/config.env.example branding/config.env
# Edit config.env with your brand values

# 2. Place assets
cp your-logo.svg branding/assets/logo_title_white.svg
cp your-icon.svg branding/assets/logo_white.svg
cp your-favicon.ico branding/assets/favicon.ico

# 3. Apply branding
./branding/scripts/apply-branding.sh

# 4. Build
./build.sh
```

## Configuration

### branding/config.env

```bash
# Brand Identity
BRAND_NAME="SignConnect"
BRAND_COMPANY="Lumosoft"
BRAND_DOMAIN="signconnect.io"

# Colors (hex without #)
PRIMARY_COLOR="305680"
SECONDARY_COLOR="527dad"
ACCENT_COLOR="a7c1de"
DARK_PRIMARY_COLOR="9fa8da"

# Copyright
COPYRIGHT_TEXT="Copyright © {year} Lumosoft"

# Optional: Documentation URL (leave empty to remove help links)
DOCS_URL=""
```

## Asset Specifications

### Logo with Text (`logo_title_white.svg`)

- **Format**: SVG (vector)
- **Dimensions**: ~1543 x 320 pixels (or proportional)
- **Color**: White on transparent (for dark backgrounds)
- **Usage**: Header, login page, sidebar

### Icon Logo (`logo_white.svg`)

- **Format**: SVG (vector)
- **Dimensions**: Square, ~100 x 100 pixels recommended
- **Color**: White on transparent
- **Usage**: Loading screens, compact views

### Favicon (`favicon.ico`)

- **Format**: ICO
- **Sizes**: Multi-size (16x16, 32x32, 48x48, 64x64)
- **Usage**: Browser tab

**Create with ImageMagick**:
```bash
convert logo.png -define icon:auto-resize=64,48,32,16 favicon.ico
```

## Manual Branding Steps

If not using scripts, modify these files manually:

### 1. Replace Logo Files

```bash
cp your-logo.svg ui-ngx/src/assets/logo_title_white.svg
cp your-icon.svg ui-ngx/src/assets/logo_white.svg
cp your-favicon.ico ui-ngx/src/thingsboard.ico
```

### 2. Update Page Title

Edit `ui-ngx/src/index.html`:

```html
<!-- Line 22 -->
<title>SignConnect</title>

<!-- Line 26: Update favicon reference (optional, or rename file) -->
<link rel="icon" type="image/x-icon" href="signconnect.ico">
```

### 3. Update Colors

Edit `ui-ngx/src/scss/constants.scss`:

```scss
// Lines 34-39
$tb-primary-color: #YOUR_PRIMARY;
$tb-secondary-color: #YOUR_SECONDARY;
$tb-hue3-color: #YOUR_ACCENT;
$tb-dark-primary-color: #YOUR_DARK_PRIMARY;
$tb-primary-color-light: #YOUR_LIGHT_PRIMARY;
```

### 4. Update Footer

Edit `ui-ngx/src/app/shared/components/footer.component.html`:

```html
<!-- Line 19 -->
<small>Copyright © {{year}} Lumosoft</small>
```

### 5. Remove Help URLs

Edit `ui-ngx/src/app/shared/models/constants.ts`:

```typescript
// Line 84: Remove or change
export const helpBaseUrl = '';  // Empty to disable help links
```

### 6. Update Email Templates

Edit all files in `application/src/main/resources/templates/`:

Replace:
- `<title>Thingsboard - ...</title>` → `<title>SignConnect - ...</title>`
- `Thingsboard account` → `SignConnect account`
- `— The Thingsboard` → `— SignConnect Team`
- `by Thingsboard` → `by Lumosoft`

### 7. Update Translations

For each file in `ui-ngx/src/assets/locale/`:

```bash
# Replace all occurrences
sed -i 's/ThingsBoard/SignConnect/g' locale.constant-en_US.json
sed -i 's/Thingsboard/SignConnect/g' locale.constant-en_US.json
```

## Color Palette Guide

### Generating a Color Palette

From your primary brand color, generate variations:

```
Primary:        #305680 (your brand color)
Secondary:      Lighter shade (+20% lightness)
Accent:         Much lighter (+40% lightness)
Dark Primary:   For dark mode (adjust for contrast)
Light Primary:  Variation for hover states
```

### Updating Material Theme

If extensive color changes are needed, also update `ui-ngx/src/theme.scss`:

```scss
$tb-mat-indigo: (
  50: #e8eaf6,
  100: #c5cae9,
  // ... define full palette
  contrast: (...)
);
```

## Verification

### Verify No ThingsBoard Text

```bash
# Search for remaining ThingsBoard references
grep -r "ThingsBoard" ui-ngx/src/ --include="*.html" | grep -v ".spec."
grep -r "ThingsBoard" ui-ngx/src/assets/locale/
```

### Verify Colors Changed

```bash
# Search for old brand color
grep -r "#305680" ui-ngx/src/
```

### Visual Verification Checklist

- [ ] Login page shows correct logo
- [ ] Page title shows correct name
- [ ] Favicon displays correctly
- [ ] Footer shows correct copyright
- [ ] Primary color matches brand
- [ ] Email templates show correct branding

## Revert Branding

To restore original ThingsBoard branding:

```bash
./branding/scripts/revert-branding.sh
```

This restores files from `branding/originals/`.

## Build After Branding

```bash
# Full build
./build.sh

# UI only (faster for testing)
cd ui-ngx && yarn build:prod
```

## Common Issues

### Logo Not Updating

- Clear browser cache
- Clear Angular build cache: `cd ui-ngx && rm -rf .angular/`
- Rebuild: `yarn build:prod`

### Colors Not Changing

- Check SCSS variable usage (some components have hardcoded colors)
- Search for hardcoded `#305680` and replace

### Translations Missing

- Some strings may have different casing (`ThingsBoard` vs `Thingsboard`)
- Run multiple sed patterns:
  ```bash
  sed -i 's/ThingsBoard/SignConnect/g' file.json
  sed -i 's/Thingsboard/SignConnect/g' file.json
  sed -i 's/THINGSBOARD/SIGNCONNECT/g' file.json
  ```

## Related Documentation

- See `docs/WHITE-LABEL-ANALYSIS.md` for complete branding audit
- See `branding/README.md` for branding infrastructure
- See `.claude/skills/build.md` for build instructions
