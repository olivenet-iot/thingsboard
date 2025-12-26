#!/bin/bash

# upgrade.sh - Upgrade ThingsBoard from upstream while preserving branding
#
# Usage:
#   ./upgrade.sh VERSION [OPTIONS]
#
# Arguments:
#   VERSION     Target version (e.g., v4.3.0, release-4.3, master)
#
# Options:
#   --dry-run   Show what would be done without making changes
#   --no-build  Skip building after upgrade
#   --help      Show this help message
#
# Examples:
#   ./upgrade.sh v4.3.0           # Upgrade to specific tag
#   ./upgrade.sh release-4.3      # Upgrade to release branch
#   ./upgrade.sh master           # Upgrade to latest master

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
VERSION=""
DRY_RUN=false
NO_BUILD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --no-build)
            NO_BUILD=true
            shift
            ;;
        --help)
            head -20 "$0" | tail -18
            exit 0
            ;;
        -*)
            echo "Unknown option: $1"
            exit 1
            ;;
        *)
            VERSION="$1"
            shift
            ;;
    esac
done

if [[ -z "$VERSION" ]]; then
    echo "ERROR: Version required"
    echo "Usage: $0 VERSION [OPTIONS]"
    echo "Example: $0 v4.3.0"
    exit 1
fi

# Logging functions
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

run_cmd() {
    if $DRY_RUN; then
        echo "[DRY-RUN] $*"
    else
        log "Running: $*"
        "$@"
    fi
}

# ============================================
# PRE-UPGRADE CHECKS
# ============================================

log "ThingsBoard Upgrade Script"
log "Target version: $VERSION"
log ""

cd "$PROJECT_ROOT"

# Check git status
if [[ -n "$(git status --porcelain)" ]]; then
    log "WARNING: Uncommitted changes detected"
    git status --short
    echo ""
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log "Aborted. Please commit or stash changes first."
        exit 1
    fi
fi

# Check upstream remote
if ! git remote | grep -q "upstream"; then
    log "Adding upstream remote..."
    run_cmd git remote add upstream https://github.com/thingsboard/thingsboard.git
fi

# Get current version
CURRENT_VERSION=$(grep '<version>' pom.xml | head -1 | sed 's/.*<version>\(.*\)<\/version>.*/\1/')
log "Current version: $CURRENT_VERSION"

# ============================================
# STEP 1: REVERT BRANDING
# ============================================

log ""
log "Step 1: Reverting branding..."

if $DRY_RUN; then
    echo "[DRY-RUN] Would run: $SCRIPT_DIR/revert-branding.sh"
else
    "$SCRIPT_DIR/revert-branding.sh"

    # Commit the revert
    if [[ -n "$(git status --porcelain)" ]]; then
        git add -A
        git commit -m "chore: revert branding for upgrade to $VERSION"
    fi
fi

# ============================================
# STEP 2: FETCH UPSTREAM
# ============================================

log ""
log "Step 2: Fetching upstream..."

run_cmd git fetch upstream --tags

# ============================================
# STEP 3: MERGE UPSTREAM
# ============================================

log ""
log "Step 3: Merging $VERSION..."

# Determine merge target
MERGE_TARGET="$VERSION"
if [[ "$VERSION" != v* ]] && [[ "$VERSION" != "master" ]]; then
    MERGE_TARGET="upstream/$VERSION"
fi

if $DRY_RUN; then
    echo "[DRY-RUN] Would merge: $MERGE_TARGET"

    # Show what would be merged
    log "Changes to be merged:"
    git log --oneline HEAD.."$MERGE_TARGET" 2>/dev/null | head -10 || true
else
    log "Merging $MERGE_TARGET..."

    if ! git merge "$MERGE_TARGET" --no-edit; then
        log ""
        log "MERGE CONFLICTS DETECTED"
        log ""
        log "Please resolve conflicts manually:"
        log "  1. Edit conflicted files"
        log "  2. git add <resolved-files>"
        log "  3. git commit"
        log "  4. Re-run this script with --no-build to continue"
        log ""
        log "Conflicts:"
        git status --short | grep "^UU"
        exit 1
    fi
fi

# ============================================
# STEP 4: REAPPLY BRANDING
# ============================================

log ""
log "Step 4: Reapplying branding..."

if $DRY_RUN; then
    echo "[DRY-RUN] Would run: $SCRIPT_DIR/apply-branding.sh"
else
    "$SCRIPT_DIR/apply-branding.sh"

    # Commit branding
    if [[ -n "$(git status --porcelain)" ]]; then
        git add -A
        git commit -m "chore: reapply ${BRAND_NAME:-SignConnect} branding after upgrade to $VERSION"
    fi
fi

# ============================================
# STEP 5: BUILD
# ============================================

if ! $NO_BUILD; then
    log ""
    log "Step 5: Building..."

    if $DRY_RUN; then
        echo "[DRY-RUN] Would run: ./build.sh"
    else
        cd "$PROJECT_ROOT"
        ./build.sh
    fi
else
    log ""
    log "Step 5: Skipping build (--no-build specified)"
fi

# ============================================
# STEP 6: VERIFY
# ============================================

log ""
log "Step 6: Verifying branding..."

if $DRY_RUN; then
    echo "[DRY-RUN] Would run: $SCRIPT_DIR/verify-branding.sh"
else
    "$SCRIPT_DIR/verify-branding.sh" || true
fi

# ============================================
# DONE
# ============================================

log ""
log "============================================"
if $DRY_RUN; then
    log "DRY RUN COMPLETE"
    log "Run without --dry-run to perform upgrade"
else
    log "UPGRADE COMPLETE"
    log ""
    log "Upgraded from $CURRENT_VERSION to $VERSION"
    log ""
    log "Next steps:"
    log "  1. Test the application thoroughly"
    log "  2. Push changes: git push origin master"
    log "  3. Tag release: git tag -a ${BRAND_NAME:-signconnect}-$VERSION -m 'Upgrade to $VERSION'"
    log "  4. Build Docker images: $SCRIPT_DIR/build-image.sh --tag $VERSION"
fi
log "============================================"
