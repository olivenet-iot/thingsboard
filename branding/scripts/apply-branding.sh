#!/bin/bash

# =============================================================================
# apply-branding.sh - Apply custom branding to ThingsBoard
# =============================================================================
# This script modifies ThingsBoard source files to apply custom branding.
# It should be run BEFORE building the project.
#
# Usage:
#   ./apply-branding.sh [OPTIONS]
#
# Options:
#   --dry-run    Show what would be changed without making changes
#   --verbose    Enable verbose output
#   --no-backup  Skip creating backups
#   --help       Show this help message
# =============================================================================

set -e

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$BRANDING_DIR")"

# Load configuration
CONFIG_FILE="$BRANDING_DIR/config.env"
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "ERROR: Configuration file not found: $CONFIG_FILE"
    exit 1
fi
source "$CONFIG_FILE"

# Parse arguments
DRY_RUN=false
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
    if [[ "$VERBOSE" == "true" ]]; then
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
    local filename=$(basename "$src")
    local dest="$BRANDING_DIR/$BACKUP_DIR/$filename"

    if [[ -f "$src" ]] && [[ ! -f "$dest" ]]; then
        log_action "Backup $src"
        if ! $DRY_RUN; then
            mkdir -p "$(dirname "$dest")"
            cp "$src" "$dest"
        fi
    fi
}

# File modification function using sed
modify_file() {
    local file="$1"
    local pattern="$2"
    local replacement="$3"

    if [[ ! -f "$file" ]]; then
        log "WARNING: File not found: $file"
        return 1
    fi

    log_verbose "Modify $file: s/$pattern/$replacement/"
    if ! $DRY_RUN; then
        sed -i "s|$pattern|$replacement|g" "$file"
    fi
}

# Copy asset function
copy_asset() {
    local src="$1"
    local dest="$2"

    if [[ -f "$src" ]]; then
        log_action "Copy asset: $(basename "$src")"
        if ! $DRY_RUN; then
            cp "$src" "$dest"
        fi
    else
        log_verbose "Asset not found (skipping): $src"
    fi
}

# =============================================================================
# MAIN BRANDING LOGIC
# =============================================================================

log "============================================"
log "SignConnect Branding Script"
log "============================================"
log "Brand: $BRAND_NAME by $BRAND_COMPANY"
log "Primary Color: #$PRIMARY_COLOR"
log "Secondary Color: #$SECONDARY_COLOR"
if $DRY_RUN; then
    log "MODE: DRY RUN - No changes will be made"
fi
log "============================================"

# Define paths
UI_SRC="$PROJECT_ROOT/ui-ngx/src"
ASSETS="$UI_SRC/assets"
SCSS="$UI_SRC/scss"
TEMPLATES="$PROJECT_ROOT/application/src/main/resources/templates"
LOCALE="$ASSETS/locale"

# Verify paths exist
if [[ ! -d "$UI_SRC" ]]; then
    log "ERROR: UI source directory not found: $UI_SRC"
    log "Make sure you're running this from the ThingsBoard project root"
    exit 1
fi

# =============================================================================
# 1. BACKUP ORIGINAL FILES
# =============================================================================

if ! $NO_BACKUP && [[ "$CREATE_BACKUP" == "true" ]]; then
    log "Creating backups..."

    backup_file "$ASSETS/logo_title_white.svg"
    backup_file "$ASSETS/logo_white.svg"
    backup_file "$UI_SRC/thingsboard.ico"
    backup_file "$UI_SRC/index.html"
    backup_file "$SCSS/constants.scss"
    backup_file "$UI_SRC/app/shared/components/footer.component.html"
    backup_file "$UI_SRC/app/shared/models/constants.ts"
    backup_file "$UI_SRC/environments/environment.ts"
    backup_file "$UI_SRC/environments/environment.prod.ts"
    backup_file "$UI_SRC/app/app.component.ts"
    backup_file "$UI_SRC/app/modules/home/components/dashboard-page/dashboard-page.component.html"

    # Backup email templates
    for template in "$TEMPLATES"/*.ftl; do
        [[ -f "$template" ]] && backup_file "$template"
    done

    # Create manifest
    if ! $DRY_RUN && [[ -d "$BRANDING_DIR/$BACKUP_DIR" ]]; then
        {
            echo "# Branding backup manifest"
            echo "# Created: $(date)"
            echo "# ThingsBoard Version: $(grep -m1 '<version>' "$PROJECT_ROOT/pom.xml" 2>/dev/null | sed 's/.*<version>\(.*\)<\/version>.*/\1/' || echo 'unknown')"
        } > "$BRANDING_DIR/$BACKUP_DIR/.manifest"
    fi
fi

# =============================================================================
# 2. COPY LOGO ASSETS
# =============================================================================

log "Copying brand assets..."

BRAND_ASSETS="$BRANDING_DIR/assets"

copy_asset "$BRAND_ASSETS/logo_title_white.svg" "$ASSETS/logo_title_white.svg"
copy_asset "$BRAND_ASSETS/logo_white.svg" "$ASSETS/logo_white.svg"
copy_asset "$BRAND_ASSETS/favicon.ico" "$UI_SRC/thingsboard.ico"

# =============================================================================
# 3. UPDATE PAGE TITLE (index.html)
# =============================================================================

log "Updating page title..."

INDEX_FILE="$UI_SRC/index.html"
modify_file "$INDEX_FILE" "<title>ThingsBoard</title>" "<title>$BRAND_NAME</title>"
modify_file "$INDEX_FILE" "<title>Thingsboard</title>" "<title>$BRAND_NAME</title>"

# Update loading spinner color
if [[ -n "$LOADING_SPINNER_COLOR" ]]; then
    modify_file "$INDEX_FILE" "background-color: rgb(43,160,199)" "background-color: rgb($LOADING_SPINNER_COLOR)"
fi

# =============================================================================
# 4. UPDATE COLOR VARIABLES (constants.scss)
# =============================================================================

log "Updating color variables..."

CONSTANTS_FILE="$SCSS/constants.scss"

[[ -n "$PRIMARY_COLOR" ]] && modify_file "$CONSTANTS_FILE" '\$tb-primary-color: #305680' "\$tb-primary-color: #$PRIMARY_COLOR"
[[ -n "$SECONDARY_COLOR" ]] && modify_file "$CONSTANTS_FILE" '\$tb-secondary-color: #527dad' "\$tb-secondary-color: #$SECONDARY_COLOR"
[[ -n "$ACCENT_COLOR" ]] && modify_file "$CONSTANTS_FILE" '\$tb-hue3-color: #a7c1de' "\$tb-hue3-color: #$ACCENT_COLOR"
[[ -n "$DARK_PRIMARY_COLOR" ]] && modify_file "$CONSTANTS_FILE" '\$tb-dark-primary-color: #9fa8da' "\$tb-dark-primary-color: #$DARK_PRIMARY_COLOR"
[[ -n "$LIGHT_PRIMARY_COLOR" ]] && modify_file "$CONSTANTS_FILE" '\$tb-primary-color-light: #7986cb' "\$tb-primary-color-light: #$LIGHT_PRIMARY_COLOR"

# =============================================================================
# 5. UPDATE FOOTER COPYRIGHT
# =============================================================================

log "Updating footer..."

FOOTER_FILE="$UI_SRC/app/shared/components/footer.component.html"
[[ -n "$COPYRIGHT_HOLDER" ]] && modify_file "$FOOTER_FILE" "The ThingsBoard Authors" "$COPYRIGHT_HOLDER"

# =============================================================================
# 6. UPDATE/REMOVE HELP URLS
# =============================================================================

log "Updating help URLs..."

HELP_FILE="$UI_SRC/app/shared/models/constants.ts"
if [[ "$REMOVE_HELP_LINKS" == "true" ]] || [[ -z "$DOCS_URL" ]]; then
    modify_file "$HELP_FILE" "export const helpBaseUrl = 'https://thingsboard.io'" "export const helpBaseUrl = ''"
elif [[ -n "$DOCS_URL" ]]; then
    modify_file "$HELP_FILE" "https://thingsboard.io" "$DOCS_URL"
fi

# =============================================================================
# 7. UPDATE EMAIL TEMPLATES
# =============================================================================

log "Updating email templates..."

for template in "$TEMPLATES"/*.ftl; do
    if [[ -f "$template" ]]; then
        log_verbose "Processing template: $(basename "$template")"

        # Update title
        modify_file "$template" "<title>Thingsboard" "<title>$BRAND_NAME"
        modify_file "$template" "<title>ThingsBoard" "<title>$BRAND_NAME"

        # Update account references
        modify_file "$template" "your Thingsboard account" "your $BRAND_NAME account"
        modify_file "$template" "Your ThingsBoard account" "Your $BRAND_NAME account"
        modify_file "$template" "your ThingsBoard account" "your $BRAND_NAME account"

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

# =============================================================================
# 8. UPDATE TRANSLATIONS
# =============================================================================

log "Updating translations..."

if [[ "$UPDATE_ALL_TRANSLATIONS" == "true" ]]; then
    for locale_file in "$LOCALE"/locale.constant-*.json; do
        if [[ -f "$locale_file" ]]; then
            log_verbose "Processing: $(basename "$locale_file")"
            if ! $DRY_RUN; then
                sed -i "s/ThingsBoard/$BRAND_NAME/g" "$locale_file"
                sed -i "s/Thingsboard/$BRAND_NAME/g" "$locale_file"
            fi
        fi
    done
else
    EN_LOCALE="$LOCALE/locale.constant-en_US.json"
    if [[ -f "$EN_LOCALE" ]] && ! $DRY_RUN; then
        sed -i "s/ThingsBoard/$BRAND_NAME/g" "$EN_LOCALE"
        sed -i "s/Thingsboard/$BRAND_NAME/g" "$EN_LOCALE"
    fi
fi

# =============================================================================
# 9. UPDATE CONSOLE LOG
# =============================================================================

log "Updating console log..."

APP_COMPONENT="$UI_SRC/app/app.component.ts"
modify_file "$APP_COMPONENT" "ThingsBoard Version" "$BRAND_NAME Version"

# =============================================================================
# 10. UPDATE APP TITLE (environment files)
# =============================================================================

log "Updating app title..."

ENV_FILE="$UI_SRC/environments/environment.ts"
ENV_PROD_FILE="$UI_SRC/environments/environment.prod.ts"

modify_file "$ENV_FILE" "appTitle: 'ThingsBoard'" "appTitle: '$BRAND_NAME'"
modify_file "$ENV_PROD_FILE" "appTitle: 'ThingsBoard'" "appTitle: '$BRAND_NAME'"

# =============================================================================
# 11. REMOVE "POWERED BY" FOOTER (if configured)
# =============================================================================

if [[ "$REMOVE_POWERED_BY_FOOTER" == "true" ]]; then
    log "Removing 'Powered by' footer..."

    DASHBOARD_PAGE="$UI_SRC/app/modules/home/components/dashboard-page/dashboard-page.component.html"
    if [[ -f "$DASHBOARD_PAGE" ]] && ! $DRY_RUN; then
        sed -i '/<section \*ngIf="!embedded" data-html2canvas-ignore class="tb-powered-by-footer"/,/<\/section>/d' "$DASHBOARD_PAGE"
    fi
fi

# =============================================================================
# DONE
# =============================================================================

log "============================================"
if $DRY_RUN; then
    log "DRY RUN COMPLETE - No changes were made"
    log "Run without --dry-run to apply changes"
else
    log "Branding applied successfully!"
    log ""
    log "Next steps:"
    log "  1. Build: mvn clean install -DskipTests"
    log "  2. Deploy: docker compose up -d"
fi
log "============================================"
