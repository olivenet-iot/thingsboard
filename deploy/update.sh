#!/bin/bash

# =============================================================================
# SignConnect Quick Update Script
# =============================================================================
# Pulls latest code, applies branding, rebuilds UI, restarts containers
#
# Usage:
#   ./update.sh [OPTIONS]
#
# Options:
#   --full          Full rebuild (not just UI)
#   --restart-only  Only restart containers
#   --help          Show this help
# =============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_ROOT/docker"
BRANDING_DIR="$PROJECT_ROOT/branding"

FULL_BUILD=false
RESTART_ONLY=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --full) FULL_BUILD=true; shift ;;
        --restart-only) RESTART_ONLY=true; shift ;;
        --help) head -16 "$0" | tail -14; exit 0 ;;
        *) echo -e "${RED}Unknown option: $1${NC}"; exit 1 ;;
    esac
done

log() { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
log_section() { echo -e "\n${BLUE}=== $1 ===${NC}"; }

# Step 1: Pull latest code
log_section "Pulling Latest Code"
cd "$PROJECT_ROOT"
git pull origin master
log "Code updated ✓"

if [[ "$RESTART_ONLY" == false ]]; then
    # Step 2: Apply branding
    log_section "Applying Branding"
    if [[ -f "$BRANDING_DIR/scripts/apply-branding.sh" ]]; then
        "$BRANDING_DIR/scripts/apply-branding.sh"
    fi

    # Step 3: Build
    log_section "Building"
    if [[ "$FULL_BUILD" == true ]]; then
        log "Full build..."
        mvn clean install -DskipTests -Dlicense.skip=true -Ppackaging -Ddockerfile.skip=false
    else
        log "UI build only..."
        mvn clean install -DskipTests -Dlicense.skip=true -Ppackaging -pl ui-ngx,msa/web-ui
    fi
    log "Build complete ✓"
fi

# Step 4: Restart
log_section "Restarting Services"
cd "$DOCKER_DIR"

if [[ "$FULL_BUILD" == true ]] || [[ "$RESTART_ONLY" == true ]]; then
    ./docker-stop-services.sh
    ./docker-start-services.sh
else
    # Quick restart for UI only
    docker compose restart tb-web-ui1 tb-web-ui2 2>/dev/null || \
    docker compose -f docker-compose.yml -f docker-compose.postgres.yml -f docker-compose.kafka.yml -f docker-compose.valkey.yml \
        up -d --force-recreate tb-web-ui1 tb-web-ui2
fi

log "Services restarted ✓"

# Wait briefly
sleep 5

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
echo ""
echo -e "${GREEN}Update complete!${NC}"
echo "URL: http://${SERVER_IP}"
