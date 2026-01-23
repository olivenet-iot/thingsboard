#!/bin/bash

# =============================================================================
# SignConnect Upgrade Script
# =============================================================================
# Upgrades ThingsBoard from upstream while preserving customizations
#
# Usage:
#   ./upgrade.sh <VERSION>
#   ./upgrade.sh v4.4.0
#   ./upgrade.sh master
#
# Options:
#   --dry-run    Show what would happen without making changes
#   --help       Show this help
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_ROOT/docker"

UPSTREAM_REPO="https://github.com/thingsboard/thingsboard.git"
UPSTREAM_REMOTE="upstream"

DRY_RUN=false
VERSION=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help)
            head -18 "$0" | tail -16
            exit 0
            ;;
        *)
            if [[ -z "$VERSION" ]]; then
                VERSION="$1"
            else
                echo -e "${RED}Unknown option: $1${NC}"
                exit 1
            fi
            shift
            ;;
    esac
done

if [[ -z "$VERSION" ]]; then
    echo -e "${RED}ERROR: Version required${NC}"
    echo "Usage: ./upgrade.sh <VERSION>"
    echo "Example: ./upgrade.sh v4.4.0"
    exit 1
fi

log() { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_section() { echo -e "\n${BLUE}=== $1 ===${NC}"; }

cd "$PROJECT_ROOT"

# =============================================================================
# PRE-FLIGHT CHECKS
# =============================================================================
log_section "Pre-flight Checks"

# Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
    log_error "You have uncommitted changes. Please commit or stash them first."
    git status --short
    exit 1
fi

log "Working directory clean ✓"

# Get current version
CURRENT_VERSION=$(grep -m1 '<version>' pom.xml | sed 's/.*<version>\(.*\)<\/version>.*/\1/' || echo "unknown")
log "Current version: $CURRENT_VERSION"
log "Target version: $VERSION"

# =============================================================================
# STEP 1: Setup Upstream Remote
# =============================================================================
log_section "Step 1: Setting up Upstream Remote"

if git remote | grep -q "^${UPSTREAM_REMOTE}$"; then
    log "Upstream remote already exists ✓"
else
    log "Adding upstream remote..."
    if ! $DRY_RUN; then
        git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_REPO"
    fi
fi

# =============================================================================
# STEP 2: Fetch Upstream
# =============================================================================
log_section "Step 2: Fetching Upstream"

if ! $DRY_RUN; then
    git fetch "$UPSTREAM_REMOTE" --tags
fi
log "Upstream fetched ✓"

# Verify version exists
if ! $DRY_RUN; then
    if ! git rev-parse "$UPSTREAM_REMOTE/$VERSION" &>/dev/null && ! git rev-parse "$VERSION" &>/dev/null; then
        log_error "Version '$VERSION' not found in upstream"
        echo "Available tags:"
        git tag -l 'v4.*' | tail -10
        exit 1
    fi
fi
log "Version $VERSION found ✓"

# =============================================================================
# STEP 3: Create Backup Branch
# =============================================================================
log_section "Step 3: Creating Backup Branch"

BACKUP_BRANCH="backup-before-${VERSION}-$(date +%Y%m%d%H%M%S)"

if ! $DRY_RUN; then
    git branch "$BACKUP_BRANCH"
fi
log "Backup branch created: $BACKUP_BRANCH"

# =============================================================================
# STEP 4: Merge Upstream
# =============================================================================
log_section "Step 4: Merging Upstream $VERSION"

if $DRY_RUN; then
    log "[DRY-RUN] Would merge $UPSTREAM_REMOTE/$VERSION"
else
    # Try to merge
    if git merge "$UPSTREAM_REMOTE/$VERSION" -m "Merge upstream $VERSION"; then
        log "Merge successful ✓"
    else
        log_error "Merge conflict detected!"
        echo ""
        echo "Conflicting files:"
        git diff --name-only --diff-filter=U
        echo ""
        echo "To resolve:"
        echo "  1. Fix conflicts in the files listed above"
        echo "  2. Run: git add <fixed-files>"
        echo "  3. Run: git commit"
        echo "  4. Re-run this script with --skip-merge (TODO)"
        echo ""
        echo "To abort:"
        echo "  git merge --abort"
        echo "  git checkout $BACKUP_BRANCH"
        exit 1
    fi
fi

# =============================================================================
# STEP 5: Push Changes
# =============================================================================
log_section "Step 5: Pushing Changes"

if $DRY_RUN; then
    log "[DRY-RUN] Would push to origin"
else
    read -p "Push changes to origin? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git push origin master
        git push origin "$BACKUP_BRANCH"
        log "Changes pushed ✓"
    else
        log_warn "Changes not pushed. Run 'git push origin master' when ready."
    fi
fi

# =============================================================================
# STEP 6: Deploy Instructions
# =============================================================================
log_section "Upgrade Complete!"

NEW_VERSION=$(grep -m1 '<version>' pom.xml | sed 's/.*<version>\(.*\)<\/version>.*/\1/' || echo "unknown")

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Upgrade Summary                                           ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Previous: $CURRENT_VERSION${NC}"
echo -e "${GREEN}║  Current:  $NEW_VERSION${NC}"
echo -e "${GREEN}║  Backup:   $BACKUP_BRANCH${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Next steps on the server:"
echo ""
echo "  1. Pull the changes:"
echo "     cd /opt/thingsboard && git pull origin master"
echo ""
echo "  2. Run deployment (applies branding + builds + deploys):"
echo "     ./deploy/deploy.sh"
echo ""
echo "  3. If database migration needed:"
echo "     cd docker"
echo "     ./docker-upgrade-tb.sh --fromVersion=$CURRENT_VERSION"
echo ""
echo "To rollback if something goes wrong:"
echo "  git checkout $BACKUP_BRANCH"
echo "  git branch -D master"
echo "  git checkout -b master"
echo "  git push origin master --force"
