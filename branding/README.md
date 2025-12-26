# Branding Infrastructure

This directory contains the white-labeling infrastructure for converting ThingsBoard to SignConnect.

## Directory Structure

```
branding/
├── README.md           # This file
├── config.env          # Brand configuration (colors, names)
├── assets/             # Custom brand assets (logos, favicons)
│   └── README.md       # Asset specifications
├── originals/          # Backup of original ThingsBoard files
│   └── .gitkeep        # Stores backups (not committed)
├── patches/            # Optional: Patch files for upgrades
│   └── README.md       # How patches work
└── scripts/
    ├── apply-branding.sh    # Apply custom branding
    ├── revert-branding.sh   # Restore original branding
    ├── build-image.sh       # Build Docker images
    ├── verify-branding.sh   # Verify branding applied
    └── upgrade.sh           # Upgrade helper
```

## Quick Start

### 1. Configure Branding

Edit `config.env` with your brand values:

```bash
cp config.env.example config.env
nano config.env
```

### 2. Add Brand Assets

Place your assets in `assets/`:

- `logo_title_white.svg` - Main logo with text
- `logo_white.svg` - Icon only
- `favicon.ico` - Browser tab icon

### 3. Apply Branding

```bash
./scripts/apply-branding.sh
```

### 4. Build

```bash
cd .. && ./build.sh
```

## Scripts

### apply-branding.sh

Applies custom branding to ThingsBoard files.

```bash
# Apply branding
./scripts/apply-branding.sh

# Dry run (show what would change)
./scripts/apply-branding.sh --dry-run

# Verbose output
./scripts/apply-branding.sh --verbose
```

**What it does:**
1. Backs up original files to `originals/`
2. Copies brand assets (logos, favicon)
3. Updates page title in index.html
4. Updates color variables in SCSS
5. Updates copyright in footer
6. Updates email templates
7. Updates translation files

### revert-branding.sh

Restores original ThingsBoard branding from backups.

```bash
# Revert all branding
./scripts/revert-branding.sh

# Dry run
./scripts/revert-branding.sh --dry-run
```

**Use cases:**
- Before merging upstream updates
- Troubleshooting branding issues
- Comparing with original

### verify-branding.sh

Verifies branding was applied correctly.

```bash
./scripts/verify-branding.sh
```

**Checks:**
- Logo files exist and are different from original
- Page title contains brand name
- Colors are updated
- Footer shows correct copyright
- No "ThingsBoard" visible in UI files

### build-image.sh

Builds branded Docker images.

```bash
# Build all images
./scripts/build-image.sh

# Build specific image
./scripts/build-image.sh web-ui

# With custom tag
./scripts/build-image.sh --tag v1.0.0
```

### upgrade.sh

Helps upgrade from upstream ThingsBoard.

```bash
# Upgrade to specific version
./scripts/upgrade.sh v4.3.0

# Upgrade to latest master
./scripts/upgrade.sh master
```

## Configuration

### config.env

```bash
# Brand Identity
BRAND_NAME="SignConnect"
BRAND_COMPANY="Lumosoft"
BRAND_DOMAIN="signconnect.io"

# Colors (hex without #)
PRIMARY_COLOR="305680"       # Main brand color
SECONDARY_COLOR="527dad"     # Secondary shade
ACCENT_COLOR="a7c1de"        # Light accent
DARK_PRIMARY_COLOR="9fa8da"  # Dark mode primary
LIGHT_PRIMARY_COLOR="7986cb" # Hover states

# Copyright
COPYRIGHT_HOLDER="Lumosoft"
COPYRIGHT_TEXT="Copyright © {year} Lumosoft"

# Documentation (empty to disable help links)
DOCS_URL=""

# Docker
DOCKER_REGISTRY="your-registry.com"
DOCKER_REPO="signconnect"
```

## Assets

See `assets/README.md` for detailed specifications.

Required files:
- `logo_title_white.svg` - 1543x320px, white on transparent
- `logo_white.svg` - Square, ~100x100px, white on transparent
- `favicon.ico` - Multi-size ICO (16, 32, 48, 64px)

## Backup System

### How Backups Work

When `apply-branding.sh` runs for the first time:
1. Original files are copied to `originals/`
2. Backup manifest is created at `originals/.manifest`
3. Original files are then modified

### Backup Files (in originals/)

```
originals/
├── .manifest                    # List of backed up files
├── logo_title_white.svg         # Original ThingsBoard logo
├── logo_white.svg               # Original icon
├── thingsboard.ico              # Original favicon
├── index.html                   # Original HTML
├── constants.scss               # Original colors
├── footer.component.html        # Original footer
└── templates/                   # Original email templates
    ├── activation.ftl
    └── ...
```

### Restoring from Backup

```bash
# Full restore
./scripts/revert-branding.sh

# Manual restore (single file)
cp originals/index.html ../ui-ngx/src/index.html
```

## Upgrade Workflow

When upgrading to new ThingsBoard version:

1. **Revert branding** - Clean slate for merge
   ```bash
   ./scripts/revert-branding.sh
   git add -A && git commit -m "Revert branding for upgrade"
   ```

2. **Merge upstream** - Get new version
   ```bash
   git fetch upstream
   git merge v4.4.0
   ```

3. **Resolve conflicts** - Accept upstream for branding files

4. **Reapply branding** - Apply your customizations
   ```bash
   ./scripts/apply-branding.sh
   git add -A && git commit -m "Reapply branding"
   ```

5. **Build and test**
   ```bash
   cd .. && ./build.sh
   ```

## Troubleshooting

### Branding Not Showing

1. Clear browser cache
2. Clear Angular build cache:
   ```bash
   cd ../ui-ngx && rm -rf .angular/
   ```
3. Rebuild UI:
   ```bash
   yarn build:prod
   ```

### Colors Not Changing

Some components have hardcoded colors. Search and replace:
```bash
grep -r "#305680" ../ui-ngx/src/
```

### Script Permission Denied

```bash
chmod +x scripts/*.sh
```

### Missing Backup

If `originals/` is empty, get files from git:
```bash
git checkout HEAD~1 -- ui-ngx/src/assets/logo_title_white.svg
# Move to originals/
```

## Best Practices

1. **Always dry-run first**: Use `--dry-run` before applying changes
2. **Commit before branding**: Have a clean git state
3. **Test incrementally**: Apply, build, test before committing
4. **Keep originals**: Don't delete the originals/ directory
5. **Version your config**: Keep config.env in version control (without secrets)

## Related Documentation

- `../CLAUDE.md` - Project overview
- `../docs/WHITE-LABEL-ANALYSIS.md` - Complete branding audit
- `../.claude/skills/white-label.md` - White-label skill guide
- `../.claude/skills/upgrade.md` - Upgrade procedures
