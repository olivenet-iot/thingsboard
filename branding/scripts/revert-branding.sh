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
#   --help       Show this help message
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$BRANDING_DIR")"

# Load configuration
source "$BRANDING_DIR/config.env"

DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help)
            head -15 "$0" | tail -13
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

declare -A RESTORE_MAP=(
    ["logo_title_white.svg"]="$UI_SRC/assets/logo_title_white.svg"
    ["logo_white.svg"]="$UI_SRC/assets/logo_white.svg"
    ["thingsboard.ico"]="$UI_SRC/thingsboard.ico"
    ["index.html"]="$UI_SRC/index.html"
    ["constants.scss"]="$UI_SRC/scss/constants.scss"
    ["footer.component.html"]="$UI_SRC/app/shared/components/footer.component.html"
    ["constants.ts"]="$UI_SRC/app/shared/models/constants.ts"
    ["environment.ts"]="$UI_SRC/environments/environment.ts"
    ["environment.prod.ts"]="$UI_SRC/environments/environment.prod.ts"
    ["app.component.ts"]="$UI_SRC/app/app.component.ts"
    ["dashboard-page.component.html"]="$UI_SRC/app/modules/home/components/dashboard-page/dashboard-page.component.html"
)

# Restore UI files
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

# Restore translations (reset to original)
log "Note: Translation files need to be restored from git"
log "Run: git checkout -- ui-ngx/src/assets/locale/"

log "============================================"
if $DRY_RUN; then
    log "DRY RUN COMPLETE - No changes were made"
else
    log "Branding reverted successfully!"
    log ""
    log "To fully restore translations, run:"
    log "  git checkout -- ui-ngx/src/assets/locale/"
fi
log "============================================"
