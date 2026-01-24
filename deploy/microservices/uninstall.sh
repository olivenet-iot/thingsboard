#!/bin/bash

# =============================================================================
# SignConnect Uninstall Script
# =============================================================================
# Cleanly removes SignConnect installation.
#
# Usage:
#   ./uninstall.sh [OPTIONS]
#
# Options:
#   --keep-data       Preserve database volumes (can reinstall later)
#   --keep-images     Keep Docker images (faster reinstall)
#   --revert-branding Restore original ThingsBoard files
#   --yes             Skip confirmation prompts
#   --help            Show this help
#
# This script will:
#   1. Stop all Docker containers
#   2. Remove containers
#   3. Remove volumes (unless --keep-data)
#   4. Remove Docker images (unless --keep-images)
#   5. Optionally revert branding changes
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Logging functions
log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
log_error()   { echo -e "${RED}[✗]${NC} $1"; }
log_section() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_ROOT/docker"
BRANDING_DIR="$PROJECT_ROOT/branding"

# Default options
KEEP_DATA=false
KEEP_IMAGES=false
REVERT_BRANDING=false
SKIP_CONFIRM=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --keep-data) KEEP_DATA=true; shift ;;
        --keep-images) KEEP_IMAGES=true; shift ;;
        --revert-branding) REVERT_BRANDING=true; shift ;;
        --yes|-y) SKIP_CONFIRM=true; shift ;;
        --help) head -24 "$0" | tail -22; exit 0 ;;
        *) log_error "Unknown option: $1"; exit 1 ;;
    esac
done

# =============================================================================
# Header
# =============================================================================

echo ""
echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║           SignConnect Uninstall                            ║${NC}"
echo -e "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# =============================================================================
# Show what will be done
# =============================================================================

log_section "Actions to perform"

echo ""
echo "  1. Stop Docker containers"
echo "  2. Remove Docker containers"

if [[ "$KEEP_DATA" == true ]]; then
    echo "  3. [SKIP] Keep database volumes"
else
    echo -e "  3. ${RED}Remove database volumes (ALL DATA WILL BE LOST)${NC}"
fi

if [[ "$KEEP_IMAGES" == true ]]; then
    echo "  4. [SKIP] Keep Docker images"
else
    echo "  4. Remove Docker images"
fi

if [[ "$REVERT_BRANDING" == true ]]; then
    echo "  5. Revert branding to original ThingsBoard"
else
    echo "  5. [SKIP] Keep branding changes"
fi

echo ""

# =============================================================================
# Confirmation
# =============================================================================

if [[ "$SKIP_CONFIRM" == false ]]; then
    if [[ "$KEEP_DATA" == false ]]; then
        echo -e "${RED}${BOLD}WARNING: This will permanently delete all data including:${NC}"
        echo "  - All devices and their telemetry"
        echo "  - All dashboards and widgets"
        echo "  - All users and customers"
        echo "  - All settings and configurations"
        echo ""
    fi

    read -p "Are you sure you want to continue? [y/N] " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Uninstall cancelled"
        exit 0
    fi
fi

# =============================================================================
# Step 1: Stop containers
# =============================================================================
log_section "Stopping Containers"

cd "$DOCKER_DIR"

if [[ -x "./docker-stop-services.sh" ]]; then
    ./docker-stop-services.sh 2>/dev/null || true
    log_success "Services stopped"
else
    docker compose down 2>/dev/null || true
    log_success "Containers stopped"
fi

# =============================================================================
# Step 2: Remove containers
# =============================================================================
log_section "Removing Containers"

# Get list of related containers
CONTAINERS=$(docker ps -a --filter "name=docker-" --format "{{.Names}}" 2>/dev/null || true)

if [[ -n "$CONTAINERS" ]]; then
    echo "$CONTAINERS" | while read container; do
        docker rm -f "$container" 2>/dev/null || true
        log_info "Removed: $container"
    done
    log_success "Containers removed"
else
    log_info "No containers to remove"
fi

# =============================================================================
# Step 3: Remove volumes (unless --keep-data)
# =============================================================================
log_section "Handling Data Volumes"

if [[ "$KEEP_DATA" == true ]]; then
    log_info "Keeping data volumes as requested"
else
    log_warning "Removing data volumes..."

    # Remove docker compose volumes
    docker compose down -v 2>/dev/null || true

    # Remove data directories
    DATA_DIRS=(
        "tb-node/postgres"
        "tb-node/valkey-data"
        "tb-node/kafka"
        "tb-node/log"
    )

    for dir in "${DATA_DIRS[@]}"; do
        if [[ -d "$dir" ]]; then
            rm -rf "$dir"
            log_info "Removed: $dir"
        fi
    done

    # Remove docker volumes with tb- or thingsboard prefix
    VOLUMES=$(docker volume ls --filter "name=docker_" -q 2>/dev/null || true)
    if [[ -n "$VOLUMES" ]]; then
        echo "$VOLUMES" | while read vol; do
            docker volume rm "$vol" 2>/dev/null || true
            log_info "Removed volume: $vol"
        done
    fi

    log_success "Data volumes removed"
fi

# =============================================================================
# Step 4: Remove images (unless --keep-images)
# =============================================================================
log_section "Handling Docker Images"

if [[ "$KEEP_IMAGES" == true ]]; then
    log_info "Keeping Docker images as requested"
else
    log_info "Removing SignConnect/ThingsBoard Docker images..."

    # Remove thingsboard images
    IMAGES=$(docker images --filter "reference=thingsboard/*" -q 2>/dev/null || true)
    if [[ -n "$IMAGES" ]]; then
        echo "$IMAGES" | sort -u | while read img; do
            docker rmi -f "$img" 2>/dev/null || true
        done
        log_info "Removed ThingsBoard images"
    fi

    # Also remove locally built images
    LOCAL_IMAGES=$(docker images --filter "reference=*tb-*" -q 2>/dev/null || true)
    if [[ -n "$LOCAL_IMAGES" ]]; then
        echo "$LOCAL_IMAGES" | sort -u | while read img; do
            docker rmi -f "$img" 2>/dev/null || true
        done
        log_info "Removed local images"
    fi

    log_success "Docker images removed"
fi

# =============================================================================
# Step 5: Revert branding (if requested)
# =============================================================================
log_section "Handling Branding"

if [[ "$REVERT_BRANDING" == true ]]; then
    if [[ -x "$BRANDING_DIR/scripts/revert-branding.sh" ]]; then
        log_info "Reverting branding changes..."
        "$BRANDING_DIR/scripts/revert-branding.sh"
        log_success "Branding reverted to original ThingsBoard"
    else
        log_warning "Revert script not found at $BRANDING_DIR/scripts/revert-branding.sh"
    fi
else
    log_info "Branding changes left in place"
fi

# =============================================================================
# Step 6: Remove generated files
# =============================================================================
log_section "Cleaning Generated Files"

# Remove .env file
if [[ -f "$DOCKER_DIR/.env" ]]; then
    rm -f "$DOCKER_DIR/.env"
    log_info "Removed: .env"
fi

# Remove build logs
rm -f /tmp/signconnect-build.log 2>/dev/null || true

log_success "Generated files cleaned"

# =============================================================================
# Summary
# =============================================================================
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}║   ✓ SignConnect Uninstall Complete                         ║${NC}"
echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════════════╣${NC}"

if [[ "$KEEP_DATA" == true ]]; then
echo -e "${GREEN}║   Data preserved - can reinstall with existing data        ║${NC}"
else
echo -e "${GREEN}║   All data has been removed                                ║${NC}"
fi

if [[ "$KEEP_IMAGES" == true ]]; then
echo -e "${GREEN}║   Docker images preserved for faster reinstall             ║${NC}"
fi

echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}║   To reinstall: ./deploy/install.sh --demo                 ║${NC}"
echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Warn about stale processes
if pgrep -f "thingsboard" &>/dev/null; then
    log_warning "Some ThingsBoard processes may still be running"
    log_info "Run: pkill -f thingsboard"
fi
