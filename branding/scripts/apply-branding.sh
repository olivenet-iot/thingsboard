#!/bin/bash

# apply-branding.sh - Apply custom branding to ThingsBoard
#
# Usage:
#   ./apply-branding.sh [OPTIONS]
#
# Options:
#   --dry-run    Show what would be changed without making changes
#   --verbose    Enable verbose output
#   --no-backup  Skip creating backups (not recommended)
#   --help       Show this help message

set -e

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$BRANDING_DIR")"

# Load configuration
CONFIG_FILE="$BRANDING_DIR/config.env"
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "ERROR: Configuration file not found: $CONFIG_FILE"
    echo "Please copy config.env.example to config.env and customize it."
    exit 1
fi
source "$CONFIG_FILE"

# Parse arguments
DRY_RUN=false
VERBOSE=false
NO_BACKUP=false

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
        --no-backup)
            NO_BACKUP=true
            shift
            ;;
        --help)
            head -20 "$0" | tail -18
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

# Backup function
backup_file() {
    local src="$1"
    local dest="$BRANDING_DIR/$BACKUP_DIR/$(basename "$src")"

    if [[ -f "$src" ]] && [[ ! -f "$dest" ]]; then
        log_action "Backup $src -> $dest"
        if ! $DRY_RUN; then
            mkdir -p "$(dirname "$dest")"
            cp "$src" "$dest"
        fi
    fi
}

# File modification function
modify_file() {
    local file="$1"
    local pattern="$2"
    local replacement="$3"

    if [[ ! -f "$file" ]]; then
        log "WARNING: File not found: $file"
        return 1
    fi

    log_action "Modify $file: s/$pattern/$replacement/"
    if ! $DRY_RUN; then
        sed -i "s|$pattern|$replacement|g" "$file"
    fi
}

# Copy asset function
copy_asset() {
    local src="$1"
    local dest="$2"

    if [[ -f "$src" ]]; then
        log_action "Copy $src -> $dest"
        if ! $DRY_RUN; then
            cp "$src" "$dest"
        fi
    else
        log "WARNING: Asset not found: $src"
    fi
}

# ============================================
# MAIN BRANDING LOGIC
# ============================================

log "Starting branding application..."
log "Brand: $BRAND_NAME by $BRAND_COMPANY"
if $DRY_RUN; then
    log "DRY RUN MODE - No changes will be made"
fi

# Define paths
UI_SRC="$PROJECT_ROOT/ui-ngx/src"
ASSETS="$UI_SRC/assets"
SCSS="$UI_SRC/scss"
TEMPLATES="$PROJECT_ROOT/application/src/main/resources/templates"
LOCALE="$ASSETS/locale"

# ============================================
# 1. BACKUP ORIGINAL FILES
# ============================================

if ! $NO_BACKUP && [[ "$CREATE_BACKUP" != "false" ]]; then
    log "Creating backups..."

    backup_file "$ASSETS/logo_title_white.svg"
    backup_file "$ASSETS/logo_white.svg"
    backup_file "$UI_SRC/thingsboard.ico"
    backup_file "$UI_SRC/index.html"
    backup_file "$SCSS/constants.scss"
    backup_file "$UI_SRC/app/shared/components/footer.component.html"
    backup_file "$UI_SRC/app/shared/models/constants.ts"

    # Backup email templates
    for template in "$TEMPLATES"/*.ftl; do
        backup_file "$template"
    done

    # Create manifest
    if ! $DRY_RUN; then
        echo "# Branding backup manifest" > "$BRANDING_DIR/$BACKUP_DIR/.manifest"
        echo "# Created: $(date)" >> "$BRANDING_DIR/$BACKUP_DIR/.manifest"
        echo "# Version: $(grep '<version>' "$PROJECT_ROOT/pom.xml" | head -1 | sed 's/.*<version>\(.*\)<\/version>.*/\1/')" >> "$BRANDING_DIR/$BACKUP_DIR/.manifest"
        ls -la "$BRANDING_DIR/$BACKUP_DIR/" >> "$BRANDING_DIR/$BACKUP_DIR/.manifest"
    fi
fi

# ============================================
# 2. COPY LOGO ASSETS
# ============================================

log "Copying brand assets..."

BRAND_ASSETS="$BRANDING_DIR/assets"

copy_asset "$BRAND_ASSETS/logo_title_white.svg" "$ASSETS/logo_title_white.svg"
copy_asset "$BRAND_ASSETS/logo_white.svg" "$ASSETS/logo_white.svg"
copy_asset "$BRAND_ASSETS/favicon.ico" "$UI_SRC/thingsboard.ico"

# ============================================
# 3. UPDATE PAGE TITLE
# ============================================

log "Updating page title..."

INDEX_FILE="$UI_SRC/index.html"
modify_file "$INDEX_FILE" "<title>ThingsBoard</title>" "<title>$BRAND_NAME</title>"
modify_file "$INDEX_FILE" "<title>Thingsboard</title>" "<title>$BRAND_NAME</title>"

# Update loading spinner color if specified
if [[ -n "$LOADING_SPINNER_COLOR" ]]; then
    modify_file "$INDEX_FILE" "background-color: rgb(43,160,199)" "background-color: rgb($LOADING_SPINNER_COLOR)"
fi

# ============================================
# 4. UPDATE COLOR VARIABLES
# ============================================

log "Updating color variables..."

CONSTANTS_FILE="$SCSS/constants.scss"
if [[ -n "$PRIMARY_COLOR" ]]; then
    modify_file "$CONSTANTS_FILE" '\$tb-primary-color: #305680' "\$tb-primary-color: #$PRIMARY_COLOR"
fi
if [[ -n "$SECONDARY_COLOR" ]]; then
    modify_file "$CONSTANTS_FILE" '\$tb-secondary-color: #527dad' "\$tb-secondary-color: #$SECONDARY_COLOR"
fi
if [[ -n "$ACCENT_COLOR" ]]; then
    modify_file "$CONSTANTS_FILE" '\$tb-hue3-color: #a7c1de' "\$tb-hue3-color: #$ACCENT_COLOR"
fi
if [[ -n "$DARK_PRIMARY_COLOR" ]]; then
    modify_file "$CONSTANTS_FILE" '\$tb-dark-primary-color: #9fa8da' "\$tb-dark-primary-color: #$DARK_PRIMARY_COLOR"
fi
if [[ -n "$LIGHT_PRIMARY_COLOR" ]]; then
    modify_file "$CONSTANTS_FILE" '\$tb-primary-color-light: #7986cb' "\$tb-primary-color-light: #$LIGHT_PRIMARY_COLOR"
fi

# ============================================
# 5. UPDATE FOOTER
# ============================================

log "Updating footer..."

FOOTER_FILE="$UI_SRC/app/shared/components/footer.component.html"
if [[ -n "$COPYRIGHT_HOLDER" ]]; then
    modify_file "$FOOTER_FILE" "The ThingsBoard Authors" "$COPYRIGHT_HOLDER"
fi

# ============================================
# 6. UPDATE/REMOVE HELP URLS
# ============================================

log "Updating help URLs..."

HELP_FILE="$UI_SRC/app/shared/models/constants.ts"
if [[ "$REMOVE_HELP_LINKS" == "true" ]] || [[ -z "$DOCS_URL" ]]; then
    modify_file "$HELP_FILE" "export const helpBaseUrl = 'https://thingsboard.io'" "export const helpBaseUrl = ''"
elif [[ -n "$DOCS_URL" ]]; then
    modify_file "$HELP_FILE" "https://thingsboard.io" "$DOCS_URL"
fi

# ============================================
# 7. UPDATE EMAIL TEMPLATES
# ============================================

log "Updating email templates..."

for template in "$TEMPLATES"/*.ftl; do
    if [[ -f "$template" ]]; then
        log_verbose "Processing template: $(basename "$template")"

        # Update title
        modify_file "$template" "<title>Thingsboard" "<title>$BRAND_NAME"

        # Update headings
        modify_file "$template" "your Thingsboard account" "your $BRAND_NAME account"
        modify_file "$template" "Your ThingsBoard account" "Your $BRAND_NAME account"

        # Update signature
        if [[ -n "$EMAIL_SIGNATURE" ]]; then
            modify_file "$template" "— The Thingsboard" "$EMAIL_SIGNATURE"
            modify_file "$template" "— The ThingsBoard" "$EMAIL_SIGNATURE"
        fi

        # Update footer
        if [[ -n "$EMAIL_FOOTER" ]]; then
            modify_file "$template" "by Thingsboard" "$EMAIL_FOOTER"
            modify_file "$template" "by ThingsBoard" "$EMAIL_FOOTER"
        fi
    fi
done

# ============================================
# 8. UPDATE TRANSLATIONS
# ============================================

if [[ "$UPDATE_ALL_TRANSLATIONS" == "true" ]]; then
    log "Updating translation files..."

    for locale_file in "$LOCALE"/locale.constant-*.json; do
        if [[ -f "$locale_file" ]]; then
            log_verbose "Processing: $(basename "$locale_file")"

            if ! $DRY_RUN; then
                # Replace ThingsBoard -> BRAND_NAME (case-sensitive)
                sed -i "s/ThingsBoard/$BRAND_NAME/g" "$locale_file"
                sed -i "s/Thingsboard/$BRAND_NAME/g" "$locale_file"
            else
                log_action "Update translations in $(basename "$locale_file")"
            fi
        fi
    done
else
    log "Updating English translation file only..."

    EN_LOCALE="$LOCALE/locale.constant-en_US.json"
    if [[ -f "$EN_LOCALE" ]]; then
        if ! $DRY_RUN; then
            sed -i "s/ThingsBoard/$BRAND_NAME/g" "$EN_LOCALE"
            sed -i "s/Thingsboard/$BRAND_NAME/g" "$EN_LOCALE"
        else
            log_action "Update translations in locale.constant-en_US.json"
        fi
    fi
fi

# ============================================
# 9. UPDATE CONSOLE LOG
# ============================================

log "Updating console log..."

APP_COMPONENT="$UI_SRC/app/app.component.ts"
modify_file "$APP_COMPONENT" "ThingsBoard Version" "$BRAND_NAME Version"

# ============================================
# DONE
# ============================================

if $DRY_RUN; then
    log "DRY RUN COMPLETE - No changes were made"
    log "Run without --dry-run to apply changes"
else
    log "Branding applied successfully!"
    log ""
    log "Next steps:"
    log "  1. Review changes: git diff"
    log "  2. Build project: ./build.sh"
    log "  3. Verify branding: ./branding/scripts/verify-branding.sh"
fi
