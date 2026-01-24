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
#
# Version: 2.0 - Comprehensive branding with theme and hardcoded color support
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

# Default values for original ThingsBoard colors (for replacement)
ORIGINAL_PRIMARY_COLOR="${ORIGINAL_PRIMARY_COLOR:-305680}"
ORIGINAL_SECONDARY_COLOR="${ORIGINAL_SECONDARY_COLOR:-527dad}"
ORIGINAL_ACCENT_COLOR="${ORIGINAL_ACCENT_COLOR:-a7c1de}"
ORIGINAL_DARK_PRIMARY_COLOR="${ORIGINAL_DARK_PRIMARY_COLOR:-9fa8da}"
ORIGINAL_LIGHT_PRIMARY_COLOR="${ORIGINAL_LIGHT_PRIMARY_COLOR:-7986cb}"
ORIGINAL_LINK_COLOR="${ORIGINAL_LINK_COLOR:-106cc8}"

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

log_section() {
    log ""
    log "============================================"
    log "$1"
    log "============================================"
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

# Replace color in multiple files (for hardcoded colors)
replace_color_globally() {
    local old_color="$1"
    local new_color="$2"
    local search_path="$3"
    local file_pattern="${4:-*}"

    if [[ -z "$old_color" ]] || [[ -z "$new_color" ]]; then
        return 0
    fi

    log_verbose "Replacing #$old_color with #$new_color in $search_path"

    if ! $DRY_RUN; then
        # Find and replace in TypeScript, SCSS, HTML, JSON files
        find "$search_path" \( -name "*.ts" -o -name "*.scss" -o -name "*.html" -o -name "*.json" -o -name "*.svg" \) \
            -type f -exec sed -i "s|#${old_color}|#${new_color}|gi" {} \;
    fi
}

# =============================================================================
# MAIN BRANDING LOGIC
# =============================================================================

log "============================================"
log "SignConnect Branding Script v2.0"
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
APP_RESOURCES="$PROJECT_ROOT/application/src/main/resources"

# Verify paths exist
if [[ ! -d "$UI_SRC" ]]; then
    log "ERROR: UI source directory not found: $UI_SRC"
    log "Make sure you're running this from the ThingsBoard project root"
    exit 1
fi

# =============================================================================
# 1. BACKUP ORIGINAL FILES
# =============================================================================

log_section "1. Creating Backups"

if ! $NO_BACKUP && [[ "$CREATE_BACKUP" == "true" ]]; then
    log "Creating backups..."

    # Core files
    backup_file "$ASSETS/logo_title_white.svg"
    backup_file "$ASSETS/logo_white.svg"
    backup_file "$UI_SRC/thingsboard.ico"
    backup_file "$UI_SRC/index.html"
    backup_file "$SCSS/constants.scss"
    backup_file "$UI_SRC/theme.scss"
    backup_file "$UI_SRC/styles.scss"
    backup_file "$UI_SRC/app/shared/components/footer.component.html"
    backup_file "$UI_SRC/app/shared/models/constants.ts"
    backup_file "$UI_SRC/environments/environment.ts"
    backup_file "$UI_SRC/environments/environment.prod.ts"
    backup_file "$UI_SRC/app/app.component.ts"
    backup_file "$UI_SRC/app/modules/home/components/dashboard-page/dashboard-page.component.html"
    backup_file "$UI_SRC/app/modules/home/home.component.html"
    backup_file "$UI_SRC/app/modules/home/components/github-badge/github-badge.component.html"

    # Backend config
    backup_file "$APP_RESOURCES/thingsboard.yml"

    # Backup email templates
    for template in "$TEMPLATES"/*.ftl; do
        [[ -f "$template" ]] && backup_file "$template"
    done

    # Backup translation files
    if [[ "$BACKUP_TRANSLATIONS" == "true" ]]; then
        mkdir -p "$BRANDING_DIR/$BACKUP_DIR/locale"
        for locale_file in "$LOCALE"/locale.constant-*.json; do
            if [[ -f "$locale_file" ]]; then
                filename=$(basename "$locale_file")
                if [[ ! -f "$BRANDING_DIR/$BACKUP_DIR/locale/$filename" ]]; then
                    cp "$locale_file" "$BRANDING_DIR/$BACKUP_DIR/locale/"
                fi
            fi
        done
    fi

    # Create manifest
    if ! $DRY_RUN && [[ -d "$BRANDING_DIR/$BACKUP_DIR" ]]; then
        {
            echo "# Branding backup manifest"
            echo "# Created: $(date)"
            echo "# ThingsBoard Version: $(grep -m1 '<version>' "$PROJECT_ROOT/pom.xml" 2>/dev/null | sed 's/.*<version>\(.*\)<\/version>.*/\1/' || echo 'unknown')"
            echo "# Script Version: 2.0"
        } > "$BRANDING_DIR/$BACKUP_DIR/.manifest"
    fi
else
    log "Skipping backups (disabled)"
fi

# =============================================================================
# 2. COPY LOGO ASSETS
# =============================================================================

log_section "2. Copying Brand Assets"

BRAND_ASSETS="$BRANDING_DIR/assets"

copy_asset "$BRAND_ASSETS/logo_title_white.svg" "$ASSETS/logo_title_white.svg"
copy_asset "$BRAND_ASSETS/logo_white.svg" "$ASSETS/logo_white.svg"
copy_asset "$BRAND_ASSETS/favicon.ico" "$UI_SRC/thingsboard.ico"

# =============================================================================
# 3. UPDATE PAGE TITLE (index.html)
# =============================================================================

log_section "3. Updating Page Title"

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

log_section "4. Updating SCSS Color Variables"

CONSTANTS_FILE="$SCSS/constants.scss"

[[ -n "$PRIMARY_COLOR" ]] && modify_file "$CONSTANTS_FILE" '\$tb-primary-color: #305680' "\$tb-primary-color: #$PRIMARY_COLOR"
[[ -n "$SECONDARY_COLOR" ]] && modify_file "$CONSTANTS_FILE" '\$tb-secondary-color: #527dad' "\$tb-secondary-color: #$SECONDARY_COLOR"
[[ -n "$ACCENT_COLOR" ]] && modify_file "$CONSTANTS_FILE" '\$tb-hue3-color: #a7c1de' "\$tb-hue3-color: #$ACCENT_COLOR"
[[ -n "$DARK_PRIMARY_COLOR" ]] && modify_file "$CONSTANTS_FILE" '\$tb-dark-primary-color: #9fa8da' "\$tb-dark-primary-color: #$DARK_PRIMARY_COLOR"
[[ -n "$LIGHT_PRIMARY_COLOR" ]] && modify_file "$CONSTANTS_FILE" '\$tb-primary-color-light: #7986cb' "\$tb-primary-color-light: #$LIGHT_PRIMARY_COLOR"

# =============================================================================
# 5. UPDATE LINK COLOR (styles.scss)
# =============================================================================

log_section "5. Updating Link Colors"

STYLES_FILE="$UI_SRC/styles.scss"
if [[ -n "$LINK_COLOR" ]]; then
    modify_file "$STYLES_FILE" "color: #106cc8" "color: #$LINK_COLOR"
    modify_file "$STYLES_FILE" "border-bottom: 1px solid #4054b2" "border-bottom: 1px solid #$LINK_COLOR"
fi

# =============================================================================
# 6. REPLACE HARDCODED COLORS
# =============================================================================

log_section "6. Replacing Hardcoded Colors"

if [[ "$REPLACE_HARDCODED_COLORS" == "true" ]]; then
    log "Replacing hardcoded #$ORIGINAL_PRIMARY_COLOR with #$PRIMARY_COLOR..."

    # Replace in UI source files (excluding node_modules and dist)
    if ! $DRY_RUN && [[ -n "$PRIMARY_COLOR" ]]; then
        # TypeScript files
        find "$UI_SRC/app" -name "*.ts" -type f -exec sed -i "s|#${ORIGINAL_PRIMARY_COLOR}|#${PRIMARY_COLOR}|gi" {} \;
        # SCSS files
        find "$UI_SRC/app" -name "*.scss" -type f -exec sed -i "s|#${ORIGINAL_PRIMARY_COLOR}|#${PRIMARY_COLOR}|gi" {} \;
        # HTML files
        find "$UI_SRC/app" -name "*.html" -type f -exec sed -i "s|#${ORIGINAL_PRIMARY_COLOR}|#${PRIMARY_COLOR}|gi" {} \;
        # Asset JSON files (dashboards, widgets)
        find "$ASSETS" -name "*.json" -type f -exec sed -i "s|#${ORIGINAL_PRIMARY_COLOR}|#${PRIMARY_COLOR}|gi" {} \;
        # Asset SVG files
        find "$ASSETS" -name "*.svg" -type f -exec sed -i "s|#${ORIGINAL_PRIMARY_COLOR}|#${PRIMARY_COLOR}|gi" {} \;

        log "Replaced hardcoded colors in UI source files"
    fi
else
    log "Skipping hardcoded color replacement (disabled)"
fi

# =============================================================================
# 7. UPDATE FOOTER COPYRIGHT
# =============================================================================

log_section "7. Updating Footer"

FOOTER_FILE="$UI_SRC/app/shared/components/footer.component.html"
[[ -n "$COPYRIGHT_HOLDER" ]] && modify_file "$FOOTER_FILE" "The ThingsBoard Authors" "$COPYRIGHT_HOLDER"

# =============================================================================
# 8. UPDATE/REMOVE HELP URLS
# =============================================================================

log_section "8. Updating Help URLs"

HELP_FILE="$UI_SRC/app/shared/models/constants.ts"
if [[ "$REMOVE_HELP_LINKS" == "true" ]] || [[ -z "$DOCS_URL" ]]; then
    modify_file "$HELP_FILE" "export const helpBaseUrl = 'https://thingsboard.io'" "export const helpBaseUrl = ''"
elif [[ -n "$DOCS_URL" ]]; then
    modify_file "$HELP_FILE" "https://thingsboard.io" "$DOCS_URL"
fi

# =============================================================================
# 9. HIDE GITHUB BADGE
# =============================================================================

log_section "9. Handling GitHub Badge"

if [[ "$HIDE_GITHUB_BADGE" == "true" ]]; then
    log "Hiding GitHub badge..."

    HOME_COMPONENT="$UI_SRC/app/modules/home/home.component.html"
    if [[ -f "$HOME_COMPONENT" ]] && ! $DRY_RUN; then
        # Comment out the github-badge component
        sed -i 's|<tb-github-badge|<!-- <tb-github-badge|g' "$HOME_COMPONENT"
        sed -i 's|></tb-github-badge>|></tb-github-badge> -->|g' "$HOME_COMPONENT"
    fi
else
    log "Keeping GitHub badge (disabled)"
fi

# =============================================================================
# 10. UPDATE EMAIL TEMPLATES
# =============================================================================

log_section "10. Updating Email Templates"

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
# 11. UPDATE TRANSLATIONS
# =============================================================================

log_section "11. Updating Translations"

if [[ "$UPDATE_ALL_TRANSLATIONS" == "true" ]]; then
    for locale_file in "$LOCALE"/locale.constant-*.json; do
        if [[ -f "$locale_file" ]]; then
            log_verbose "Processing: $(basename "$locale_file")"
            if ! $DRY_RUN; then
                sed -i "s/ThingsBoard/$BRAND_NAME/g" "$locale_file"
                sed -i "s/Thingsboard/$BRAND_NAME/g" "$locale_file"

                # Fix "powered by" text to be more natural
                if [[ "$FIX_POWERED_BY_TEXT" == "true" ]]; then
                    sed -i "s/powered by $BRAND_NAME/by $BRAND_NAME/g" "$locale_file"
                fi
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
# 12. UPDATE CONSOLE LOG
# =============================================================================

log_section "12. Updating Console Log"

APP_COMPONENT="$UI_SRC/app/app.component.ts"
modify_file "$APP_COMPONENT" "ThingsBoard Version" "$BRAND_NAME Version"

# =============================================================================
# 13. UPDATE APP TITLE (environment files)
# =============================================================================

log_section "13. Updating App Title"

ENV_FILE="$UI_SRC/environments/environment.ts"
ENV_PROD_FILE="$UI_SRC/environments/environment.prod.ts"

modify_file "$ENV_FILE" "appTitle: 'ThingsBoard'" "appTitle: '$BRAND_NAME'"
modify_file "$ENV_PROD_FILE" "appTitle: 'ThingsBoard'" "appTitle: '$BRAND_NAME'"

# =============================================================================
# 14. REMOVE "POWERED BY" FOOTER (if configured)
# =============================================================================

log_section "14. Handling Powered By Footer"

if [[ "$REMOVE_POWERED_BY_FOOTER" == "true" ]]; then
    log "Removing 'Powered by' footer..."

    DASHBOARD_PAGE="$UI_SRC/app/modules/home/components/dashboard-page/dashboard-page.component.html"
    if [[ -f "$DASHBOARD_PAGE" ]] && ! $DRY_RUN; then
        sed -i '/<section \*ngIf="!embedded" data-html2canvas-ignore class="tb-powered-by-footer"/,/<\/section>/d' "$DASHBOARD_PAGE"
    fi
fi

# =============================================================================
# 15. UPDATE SWAGGER/API DOCUMENTATION (if configured)
# =============================================================================

log_section "15. Updating API Documentation"

if [[ "$UPDATE_SWAGGER" == "true" ]]; then
    THINGSBOARD_YML="$APP_RESOURCES/thingsboard.yml"
    if [[ -f "$THINGSBOARD_YML" ]]; then
        log "Updating Swagger API documentation..."
        if ! $DRY_RUN; then
            # Update Swagger title
            sed -i "s|ThingsBoard REST API|$BRAND_NAME REST API|g" "$THINGSBOARD_YML"
            sed -i "s|ThingsBoard team|$BRAND_COMPANY team|g" "$THINGSBOARD_YML"
            sed -i "s|ThingsBoard open-source IoT platform|$BRAND_NAME IoT platform|g" "$THINGSBOARD_YML"
        fi
    fi
else
    log "Skipping Swagger update (disabled)"
fi

# =============================================================================
# 16. UPDATE SVG LOGO COLORS (logo_title_white.svg contains text color)
# =============================================================================

log_section "16. Updating Logo SVG Colors"

LOGO_TITLE="$ASSETS/logo_title_white.svg"
if [[ -f "$LOGO_TITLE" ]] && [[ -n "$PRIMARY_COLOR" ]] && ! $DRY_RUN; then
    # The logo_title_white.svg has fill="#305680" for the text
    # We update this to match the new primary color
    sed -i "s|fill=\"#305680\"|fill=\"#$PRIMARY_COLOR\"|gi" "$LOGO_TITLE"
    log "Updated logo text color"
fi

# =============================================================================
# 17. INJECT BRANDING CSS FIXES
# =============================================================================

log_section "17. Injecting CSS Fixes"

BRANDING_CSS="$BRANDING_DIR/assets/branding-fixes.css"
STYLES_FILE="$UI_SRC/styles.scss"
MARKER="SignConnect Branding CSS Fixes"

if [[ -f "$BRANDING_CSS" ]]; then
    # Idempotency check
    if grep -q "$MARKER" "$STYLES_FILE" 2>/dev/null; then
        log "CSS fixes already injected (skipping)"
    else
        log "Injecting branding CSS fixes..."
        if ! $DRY_RUN; then
            # Read CSS and replace color placeholder with config value
            BRANDING_CSS_CONTENT=$(cat "$BRANDING_CSS")
            if [[ -n "$SECONDARY_COLOR" ]]; then
                BRANDING_CSS_CONTENT=$(echo "$BRANDING_CSS_CONTENT" | sed "s/#f9b11d/#$SECONDARY_COLOR/g")
            fi

            # Append to styles.scss
            echo "" >> "$STYLES_FILE"
            echo "$BRANDING_CSS_CONTENT" >> "$STYLES_FILE"

            log "CSS fixes injected successfully"
        fi
    fi
else
    log "WARNING: Branding CSS file not found: $BRANDING_CSS"
fi

# =============================================================================
# DONE
# =============================================================================

log ""
log "============================================"
if $DRY_RUN; then
    log "DRY RUN COMPLETE - No changes were made"
    log "Run without --dry-run to apply changes"
else
    log "Branding applied successfully!"
    log ""
    log "Summary of changes:"
    log "  - Page title: $BRAND_NAME"
    log "  - Primary color: #$PRIMARY_COLOR"
    log "  - Secondary color: #$SECONDARY_COLOR"
    log "  - Logo assets copied"
    [[ "$REPLACE_HARDCODED_COLORS" == "true" ]] && log "  - Hardcoded colors replaced"
    [[ "$HIDE_GITHUB_BADGE" == "true" ]] && log "  - GitHub badge hidden"
    [[ "$UPDATE_SWAGGER" == "true" ]] && log "  - Swagger API rebranded"
    log ""
    log "Next steps:"
    log "  1. Build: mvn clean install -DskipTests -Dlicense.skip=true"
    log "  2. Deploy: docker compose up -d"
fi
log "============================================"
