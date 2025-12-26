#!/bin/bash

# verify-branding.sh - Verify branding was applied correctly
#
# Usage:
#   ./verify-branding.sh [OPTIONS]
#
# Options:
#   --verbose    Show all checks, not just failures
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

# Parse arguments
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            head -13 "$0" | tail -11
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Define paths
UI_SRC="$PROJECT_ROOT/ui-ngx/src"
ASSETS="$UI_SRC/assets"
SCSS="$UI_SRC/scss"
TEMPLATES="$PROJECT_ROOT/application/src/main/resources/templates"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASS=0
FAIL=0
WARN=0

# Check functions
check_pass() {
    ((PASS++))
    if $VERBOSE; then
        echo -e "${GREEN}✓${NC} $1"
    fi
}

check_fail() {
    ((FAIL++))
    echo -e "${RED}✗${NC} $1"
}

check_warn() {
    ((WARN++))
    echo -e "${YELLOW}!${NC} $1"
}

check_file_exists() {
    local file="$1"
    local name="$2"

    if [[ -f "$file" ]]; then
        check_pass "$name exists"
        return 0
    else
        check_fail "$name missing: $file"
        return 1
    fi
}

check_file_contains() {
    local file="$1"
    local pattern="$2"
    local name="$3"

    if grep -q "$pattern" "$file" 2>/dev/null; then
        check_pass "$name: found '$pattern'"
        return 0
    else
        check_fail "$name: missing '$pattern'"
        return 1
    fi
}

check_file_not_contains() {
    local file="$1"
    local pattern="$2"
    local name="$3"

    if ! grep -q "$pattern" "$file" 2>/dev/null; then
        check_pass "$name: no '$pattern'"
        return 0
    else
        check_fail "$name: still contains '$pattern'"
        return 1
    fi
}

# ============================================
# VERIFICATION CHECKS
# ============================================

echo "Verifying ThingsBoard branding..."
echo "Expected brand: $BRAND_NAME"
echo ""

# ============================================
# 1. LOGO FILES
# ============================================

echo "Checking logo files..."

check_file_exists "$ASSETS/logo_title_white.svg" "Main logo"
check_file_exists "$ASSETS/logo_white.svg" "Icon logo"
check_file_exists "$UI_SRC/thingsboard.ico" "Favicon"

# Check if logos are different from original (by size or content)
BRAND_LOGO="$BRANDING_DIR/assets/logo_title_white.svg"
if [[ -f "$BRAND_LOGO" ]] && [[ -f "$ASSETS/logo_title_white.svg" ]]; then
    if cmp -s "$BRAND_LOGO" "$ASSETS/logo_title_white.svg"; then
        check_pass "Main logo matches brand asset"
    else
        check_warn "Main logo differs from brand asset"
    fi
fi

# ============================================
# 2. PAGE TITLE
# ============================================

echo ""
echo "Checking page title..."

INDEX_FILE="$UI_SRC/index.html"
check_file_contains "$INDEX_FILE" "<title>$BRAND_NAME</title>" "Page title"
check_file_not_contains "$INDEX_FILE" "<title>ThingsBoard</title>" "No ThingsBoard title"

# ============================================
# 3. COLOR VARIABLES
# ============================================

echo ""
echo "Checking color variables..."

CONSTANTS_FILE="$SCSS/constants.scss"
if [[ -n "$PRIMARY_COLOR" ]]; then
    check_file_contains "$CONSTANTS_FILE" "#$PRIMARY_COLOR" "Primary color"
fi
if [[ -n "$SECONDARY_COLOR" ]]; then
    check_file_contains "$CONSTANTS_FILE" "#$SECONDARY_COLOR" "Secondary color"
fi

# Check original color is replaced
check_file_not_contains "$CONSTANTS_FILE" "305680" "No original primary color"

# ============================================
# 4. FOOTER
# ============================================

echo ""
echo "Checking footer..."

FOOTER_FILE="$UI_SRC/app/shared/components/footer.component.html"
if [[ -n "$COPYRIGHT_HOLDER" ]]; then
    check_file_contains "$FOOTER_FILE" "$COPYRIGHT_HOLDER" "Copyright holder"
fi
check_file_not_contains "$FOOTER_FILE" "ThingsBoard Authors" "No ThingsBoard Authors"

# ============================================
# 5. HELP URLS
# ============================================

echo ""
echo "Checking help URLs..."

HELP_FILE="$UI_SRC/app/shared/models/constants.ts"
if [[ "$REMOVE_HELP_LINKS" == "true" ]]; then
    check_file_contains "$HELP_FILE" "helpBaseUrl = ''" "Help URLs disabled"
fi

# ============================================
# 6. EMAIL TEMPLATES
# ============================================

echo ""
echo "Checking email templates..."

TEMPLATE_COUNT=$(find "$TEMPLATES" -name "*.ftl" | wc -l)
if [[ $TEMPLATE_COUNT -gt 0 ]]; then
    BRANDED_COUNT=0
    for template in "$TEMPLATES"/*.ftl; do
        if grep -q "$BRAND_NAME" "$template" 2>/dev/null; then
            ((BRANDED_COUNT++))
        fi
    done

    if [[ $BRANDED_COUNT -eq $TEMPLATE_COUNT ]]; then
        check_pass "All $TEMPLATE_COUNT email templates branded"
    elif [[ $BRANDED_COUNT -gt 0 ]]; then
        check_warn "$BRANDED_COUNT of $TEMPLATE_COUNT email templates branded"
    else
        check_fail "No email templates branded"
    fi
fi

# Check for remaining ThingsBoard references in templates
TB_REFS=$(grep -l "Thingsboard\|ThingsBoard" "$TEMPLATES"/*.ftl 2>/dev/null | wc -l)
if [[ $TB_REFS -gt 0 ]]; then
    check_warn "$TB_REFS templates still contain ThingsBoard references"
fi

# ============================================
# 7. TRANSLATIONS
# ============================================

echo ""
echo "Checking translations..."

LOCALE_DIR="$ASSETS/locale"
LOCALE_COUNT=$(find "$LOCALE_DIR" -name "locale.constant-*.json" | wc -l)

# Check English translation
EN_LOCALE="$LOCALE_DIR/locale.constant-en_US.json"
if [[ -f "$EN_LOCALE" ]]; then
    if grep -q "\"$BRAND_NAME\"" "$EN_LOCALE"; then
        check_pass "English translation branded"
    else
        check_warn "English translation may not be branded"
    fi

    # Check for remaining ThingsBoard
    TB_COUNT=$(grep -c "ThingsBoard\|Thingsboard" "$EN_LOCALE" 2>/dev/null || echo "0")
    if [[ $TB_COUNT -gt 0 ]]; then
        check_warn "$TB_COUNT ThingsBoard references in English locale"
    else
        check_pass "No ThingsBoard in English locale"
    fi
fi

# ============================================
# 8. SCAN FOR REMAINING THINGSBOARD TEXT
# ============================================

echo ""
echo "Scanning for remaining ThingsBoard references..."

# Only check HTML and visible TypeScript strings
TB_IN_HTML=$(grep -r "ThingsBoard\|Thingsboard" "$UI_SRC" --include="*.html" 2>/dev/null | grep -v ".spec." | wc -l)
if [[ $TB_IN_HTML -gt 0 ]]; then
    check_warn "$TB_IN_HTML ThingsBoard references in HTML files"
    if $VERBOSE; then
        grep -r "ThingsBoard\|Thingsboard" "$UI_SRC" --include="*.html" | grep -v ".spec." | head -5
    fi
else
    check_pass "No ThingsBoard in HTML files"
fi

# ============================================
# SUMMARY
# ============================================

echo ""
echo "============================================"
echo "VERIFICATION SUMMARY"
echo "============================================"
echo -e "Passed: ${GREEN}$PASS${NC}"
echo -e "Failed: ${RED}$FAIL${NC}"
echo -e "Warnings: ${YELLOW}$WARN${NC}"
echo ""

if [[ $FAIL -gt 0 ]]; then
    echo -e "${RED}Branding verification FAILED${NC}"
    echo "Please run apply-branding.sh and try again."
    exit 1
elif [[ $WARN -gt 0 ]]; then
    echo -e "${YELLOW}Branding applied with warnings${NC}"
    echo "Review warnings above for potential issues."
    exit 0
else
    echo -e "${GREEN}Branding verification PASSED${NC}"
    exit 0
fi
