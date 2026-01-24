#!/bin/bash

# =============================================================================
# revert-branding.sh - Restore original ThingsBoard files
# =============================================================================
# This script restores the original ThingsBoard files from backups.
# Use this before merging upstream updates.
#
# Usage:
#   ./revert-branding.sh [OPTIONS]
#
# Options:
#   --dry-run    Show what would be restored without making changes
#   --git        Also restore files using git checkout
#   --help       Show this help message
#
# Version: 2.0
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$BRANDING_DIR")"

# Load configuration
source "$BRANDING_DIR/config.env"

DRY_RUN=false
USE_GIT=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --git)
            USE_GIT=true
            shift
            ;;
        --help)
            head -17 "$0" | tail -15
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

BACKUP_PATH="$BRANDING_DIR/$BACKUP_DIR"

if [[ ! -d "$BACKUP_PATH" ]] || [[ -z "$(ls -A "$BACKUP_PATH" 2>/dev/null)" ]]; then
    log "ERROR: No backups found in $BACKUP_PATH"
    log "Run apply-branding.sh first to create backups."
    exit 1
fi

log "============================================"
log "Reverting branding to original ThingsBoard"
log "============================================"

# Define restore mappings
UI_SRC="$PROJECT_ROOT/ui-ngx/src"
TEMPLATES="$PROJECT_ROOT/application/src/main/resources/templates"
APP_RESOURCES="$PROJECT_ROOT/application/src/main/resources"

declare -A RESTORE_MAP=(
    ["logo_title_white.svg"]="$UI_SRC/assets/logo_title_white.svg"
    ["logo_white.svg"]="$UI_SRC/assets/logo_white.svg"
    ["thingsboard.ico"]="$UI_SRC/thingsboard.ico"
    ["index.html"]="$UI_SRC/index.html"
    ["constants.scss"]="$UI_SRC/scss/constants.scss"
    ["theme.scss"]="$UI_SRC/theme.scss"
    ["styles.scss"]="$UI_SRC/styles.scss"
    ["footer.component.html"]="$UI_SRC/app/shared/components/footer.component.html"
    ["constants.ts"]="$UI_SRC/app/shared/models/constants.ts"
    ["environment.ts"]="$UI_SRC/environments/environment.ts"
    ["environment.prod.ts"]="$UI_SRC/environments/environment.prod.ts"
    ["app.component.ts"]="$UI_SRC/app/app.component.ts"
    ["dashboard-page.component.html"]="$UI_SRC/app/modules/home/components/dashboard-page/dashboard-page.component.html"
    ["home.component.html"]="$UI_SRC/app/modules/home/home.component.html"
    ["github-badge.component.html"]="$UI_SRC/app/modules/home/components/github-badge/github-badge.component.html"
    ["thingsboard.yml"]="$APP_RESOURCES/thingsboard.yml"
)

# Restore UI files from backup
log ""
log "Restoring files from backup..."
for backup_file in "${!RESTORE_MAP[@]}"; do
    src="$BACKUP_PATH/$backup_file"
    dest="${RESTORE_MAP[$backup_file]}"

    if [[ -f "$src" ]]; then
        if $DRY_RUN; then
            echo "[DRY-RUN] Would restore: $backup_file"
        else
            cp "$src" "$dest"
            log "Restored: $backup_file"
        fi
    fi
done

# Restore email templates
log ""
log "Restoring email templates..."
for backup_template in "$BACKUP_PATH"/*.ftl; do
    if [[ -f "$backup_template" ]]; then
        filename=$(basename "$backup_template")
        dest="$TEMPLATES/$filename"

        if $DRY_RUN; then
            echo "[DRY-RUN] Would restore: $filename"
        else
            cp "$backup_template" "$dest"
            log "Restored: $filename"
        fi
    fi
done

# Restore translation backups if they exist
if [[ -d "$BACKUP_PATH/locale" ]]; then
    log ""
    log "Restoring translation files..."
    for locale_backup in "$BACKUP_PATH/locale"/*.json; do
        if [[ -f "$locale_backup" ]]; then
            filename=$(basename "$locale_backup")
            dest="$UI_SRC/assets/locale/$filename"

            if $DRY_RUN; then
                echo "[DRY-RUN] Would restore: locale/$filename"
            else
                cp "$locale_backup" "$dest"
                log "Restored: locale/$filename"
            fi
        fi
    done
fi

# Use git to restore files that weren't backed up
if $USE_GIT; then
    log ""
    log "Restoring additional files from git..."

    if ! $DRY_RUN; then
        cd "$PROJECT_ROOT"

        # Restore translation files
        git checkout -- ui-ngx/src/assets/locale/ 2>/dev/null || log "Warning: Could not restore locale files from git"

        # Restore any hardcoded color changes in source files
        git checkout -- ui-ngx/src/app/ 2>/dev/null || log "Warning: Could not restore app files from git"

        # Restore asset files (SVGs, JSONs with hardcoded colors)
        git checkout -- ui-ngx/src/assets/*.svg 2>/dev/null || true
        git checkout -- ui-ngx/src/assets/*.json 2>/dev/null || true
        git checkout -- ui-ngx/src/assets/dashboard/ 2>/dev/null || true
        git checkout -- ui-ngx/src/assets/widget/ 2>/dev/null || true
        git checkout -- ui-ngx/src/assets/home/ 2>/dev/null || true

        log "Git restore completed"
    else
        echo "[DRY-RUN] Would run git checkout on modified files"
    fi
else
    log ""
    log "Note: Use --git flag to also restore files from git repository"
fi

# Remove injected CSS if backup doesn't exist
if [[ ! -f "$BACKUP_PATH/styles.scss" ]]; then
    log ""
    log "Removing injected CSS fixes from styles.scss..."
    STYLES_FILE="$UI_SRC/styles.scss"
    MARKER_START="SignConnect Branding CSS Fixes"
    MARKER_END="END SignConnect Branding CSS Fixes"

    if grep -q "$MARKER_START" "$STYLES_FILE" 2>/dev/null; then
        if $DRY_RUN; then
            echo "[DRY-RUN] Would remove injected CSS from styles.scss"
        else
            sed -i "/$MARKER_START/,/$MARKER_END/d" "$STYLES_FILE"
            log "Removed injected CSS from styles.scss"
        fi
    fi
fi

log ""
log "============================================"
if $DRY_RUN; then
    log "DRY RUN COMPLETE - No changes were made"
else
    log "Branding reverted successfully!"
    log ""
    log "If hardcoded colors were replaced, also run:"
    log "  ./revert-branding.sh --git"
    log "Or manually:"
    log "  git checkout -- ui-ngx/src/assets/"
    log "  git checkout -- ui-ngx/src/app/"
fi
log "============================================"
