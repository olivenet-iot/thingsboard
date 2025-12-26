#!/bin/bash

# revert-branding.sh - Restore original ThingsBoard branding from backups
#
# Usage:
#   ./revert-branding.sh [OPTIONS]
#
# Options:
#   --dry-run    Show what would be restored without making changes
#   --verbose    Enable verbose output
#   --help       Show this help message

set -e

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$BRANDING_DIR")"

# Load configuration
CONFIG_FILE="$BRANDING_DIR/config.env"
if [[ -f "$CONFIG_FILE" ]]; then
    source "$CONFIG_FILE"
fi

# Defaults
BACKUP_DIR="${BACKUP_DIR:-originals}"

# Parse arguments
DRY_RUN=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --verbose)
            VERBOSE=true
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

# Logging functions
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log_verbose() {
    if $VERBOSE; then
        log "$1"
    fi
}

log_action() {
    if $DRY_RUN; then
        echo "[DRY-RUN] Would: $1"
    else
        log "$1"
    fi
}

# Restore function
restore_file() {
    local backup="$1"
    local target="$2"

    if [[ -f "$backup" ]]; then
        log_action "Restore $backup -> $target"
        if ! $DRY_RUN; then
            cp "$backup" "$target"
        fi
        return 0
    else
        log_verbose "No backup found: $backup"
        return 1
    fi
}

# ============================================
# MAIN REVERT LOGIC
# ============================================

log "Starting branding revert..."
if $DRY_RUN; then
    log "DRY RUN MODE - No changes will be made"
fi

# Define paths
BACKUP_PATH="$BRANDING_DIR/$BACKUP_DIR"
UI_SRC="$PROJECT_ROOT/ui-ngx/src"
ASSETS="$UI_SRC/assets"
SCSS="$UI_SRC/scss"
TEMPLATES="$PROJECT_ROOT/application/src/main/resources/templates"

# Check backup directory exists
if [[ ! -d "$BACKUP_PATH" ]]; then
    log "ERROR: Backup directory not found: $BACKUP_PATH"
    log "No backups to restore. Run apply-branding.sh first to create backups."
    exit 1
fi

# Check for backup manifest
if [[ -f "$BACKUP_PATH/.manifest" ]]; then
    log "Found backup manifest:"
    cat "$BACKUP_PATH/.manifest" | head -3
fi

# Count available backups
BACKUP_COUNT=$(find "$BACKUP_PATH" -type f ! -name '.manifest' ! -name '.gitkeep' | wc -l)
if [[ $BACKUP_COUNT -eq 0 ]]; then
    log "ERROR: No backup files found in $BACKUP_PATH"
    log "Cannot revert without backups."
    exit 1
fi
log "Found $BACKUP_COUNT backup files"

# ============================================
# 1. RESTORE LOGO ASSETS
# ============================================

log "Restoring logo assets..."

restore_file "$BACKUP_PATH/logo_title_white.svg" "$ASSETS/logo_title_white.svg"
restore_file "$BACKUP_PATH/logo_white.svg" "$ASSETS/logo_white.svg"
restore_file "$BACKUP_PATH/thingsboard.ico" "$UI_SRC/thingsboard.ico"

# ============================================
# 2. RESTORE UI FILES
# ============================================

log "Restoring UI files..."

restore_file "$BACKUP_PATH/index.html" "$UI_SRC/index.html"
restore_file "$BACKUP_PATH/constants.scss" "$SCSS/constants.scss"
restore_file "$BACKUP_PATH/footer.component.html" "$UI_SRC/app/shared/components/footer.component.html"
restore_file "$BACKUP_PATH/constants.ts" "$UI_SRC/app/shared/models/constants.ts"

# ============================================
# 3. RESTORE EMAIL TEMPLATES
# ============================================

log "Restoring email templates..."

for template in "$BACKUP_PATH"/*.ftl; do
    if [[ -f "$template" ]]; then
        target_name=$(basename "$template")
        restore_file "$template" "$TEMPLATES/$target_name"
    fi
done

# ============================================
# 4. RESTORE TRANSLATION FILES
# ============================================

log "Checking for translation backups..."

# Note: We typically don't back up all 27 translation files
# If they exist in backup, restore them
for locale in "$BACKUP_PATH"/locale.constant-*.json; do
    if [[ -f "$locale" ]]; then
        target_name=$(basename "$locale")
        restore_file "$locale" "$UI_SRC/assets/locale/$target_name"
    fi
done

# If no locale backups, use git to restore
if ! ls "$BACKUP_PATH"/locale.constant-*.json 1> /dev/null 2>&1; then
    log "No locale backups found. To fully restore translations:"
    log "  git checkout -- ui-ngx/src/assets/locale/"
fi

# ============================================
# DONE
# ============================================

if $DRY_RUN; then
    log "DRY RUN COMPLETE - No changes were made"
    log "Run without --dry-run to apply changes"
else
    log "Branding reverted successfully!"
    log ""
    log "Files restored to original ThingsBoard branding."
    log ""
    log "For complete translation revert, run:"
    log "  git checkout -- ui-ngx/src/assets/locale/"
    log ""
    log "Next steps:"
    log "  1. Review changes: git diff"
    log "  2. Commit if preparing for upgrade: git add -A && git commit -m 'Revert branding'"
fi
