#!/bin/bash

# =============================================================================
# SignConnect Standalone Installation Script
# =============================================================================
# Simple single-container deployment - no Kafka, no Zookeeper, no complexity.
#
# Usage:
#   ./install.sh [OPTIONS]
#
# Options:
#   --demo          Load demo data (devices, dashboards)
#   --build         Build custom image with branding (optional)
#   --clean         Remove existing data before install
#   --help          Show this help
#
# Quick start:
#   ./install.sh --demo
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

# Logging
log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
log_error()   { echo -e "${RED}[✗]${NC} $1"; }

# Directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
BRANDING_DIR="$PROJECT_ROOT/branding"

# Defaults
LOAD_DEMO=false
BUILD_IMAGE=false
CLEAN_INSTALL=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --demo) LOAD_DEMO=true; shift ;;
        --build) BUILD_IMAGE=true; shift ;;
        --clean) CLEAN_INSTALL=true; shift ;;
        --help) head -20 "$0" | tail -18; exit 0 ;;
        *) log_error "Unknown option: $1"; exit 1 ;;
    esac
done

# Load environment
if [[ -f "$SCRIPT_DIR/.env" ]]; then
    source "$SCRIPT_DIR/.env"
fi

TB_PORT=${TB_PORT:-8080}
TB_VERSION=${TB_VERSION:-latest}
DOCKER_REPO=${DOCKER_REPO:-thingsboard}

# =============================================================================
# Banner
# =============================================================================
echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       SignConnect Standalone Installation                  ║${NC}"
echo -e "${CYAN}║       Simple. Fast. Single Container.                      ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# =============================================================================
# Step 1: Check Prerequisites
# =============================================================================
echo -e "${BOLD}[1/5] Checking Prerequisites${NC}"

if ! command -v docker &>/dev/null; then
    log_error "Docker not installed. Run: curl -fsSL https://get.docker.com | sh"
    exit 1
fi

if ! docker ps &>/dev/null; then
    log_error "Docker not running or no permission. Try: sudo systemctl start docker"
    exit 1
fi

if ! docker compose version &>/dev/null; then
    log_error "Docker Compose V2 not found"
    exit 1
fi

log_success "Prerequisites OK"

# =============================================================================
# Step 2: Clean Previous Installation (if requested)
# =============================================================================
echo -e "\n${BOLD}[2/5] Preparing Installation${NC}"

cd "$SCRIPT_DIR"

if [[ "$CLEAN_INSTALL" == true ]]; then
    log_info "Cleaning previous installation..."
    docker compose down -v 2>/dev/null || true
    docker volume rm signconnect-data signconnect-logs 2>/dev/null || true
    log_success "Previous data removed"
else
    # Check if already running
    if docker ps --format '{{.Names}}' | grep -q "^signconnect$"; then
        log_warning "SignConnect is already running"
        read -p "Stop and reinstall? [y/N] " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            docker compose down
        else
            log_info "Keeping existing installation"
            exit 0
        fi
    fi
fi

# =============================================================================
# Step 3: Build Custom Image (if requested)
# =============================================================================
echo -e "\n${BOLD}[3/5] Preparing Docker Image${NC}"

if [[ "$BUILD_IMAGE" == true ]]; then
    log_info "Building custom SignConnect image..."

    # Apply branding
    if [[ -f "$BRANDING_DIR/scripts/apply-branding.sh" ]]; then
        log_info "Applying branding..."
        chmod +x "$BRANDING_DIR/scripts/apply-branding.sh"
        "$BRANDING_DIR/scripts/apply-branding.sh"
    fi

    # Build standalone image
    cd "$PROJECT_ROOT"
    log_info "Building (this takes 20-30 minutes on first build)..."
    log_info "Log file: /tmp/signconnect-build.log"

    # Step 1: Build entire project first (creates .deb package)
    # Exclude entire msa module - Docker modules depend on .deb files
    log_info "Step 1/2: Building project (excluding microservices)..."
    if ! mvn clean install -DskipTests -Dlicense.skip=true -pl '!msa' 2>&1 | tee /tmp/signconnect-build.log | \
        grep -E '^\[INFO\] (Building |------|BUILD|SUCCESS|FAILURE)'; then
        log_error "Project build failed. Check /tmp/signconnect-build.log"
        tail -50 /tmp/signconnect-build.log
        exit 1
    fi

    if ! grep -q "BUILD SUCCESS" /tmp/signconnect-build.log; then
        log_error "Project build failed. Check /tmp/signconnect-build.log"
        tail -50 /tmp/signconnect-build.log
        exit 1
    fi

    # Verify .deb file was created
    if ! ls "$PROJECT_ROOT/application/target/"*.deb &>/dev/null; then
        log_error ".deb package not created. Check build log."
        exit 1
    fi
    log_success ".deb package created"

    # Step 2: Build Docker image for standalone (tb-postgres)
    log_info "Step 2/2: Building Docker image..."
    if ! mvn package -DskipTests -Dlicense.skip=true -Ddockerfile.skip=false \
        -pl msa/tb/docker-postgres 2>&1 | tee -a /tmp/signconnect-build.log | \
        grep -E '^\[INFO\] (Building |------|BUILD|SUCCESS|FAILURE|Successfully)'; then
        log_error "Docker build failed. Check /tmp/signconnect-build.log"
        tail -50 /tmp/signconnect-build.log
        exit 1
    fi

    if tail -20 /tmp/signconnect-build.log | grep -q "BUILD FAILURE"; then
        log_error "Docker build failed. Check /tmp/signconnect-build.log"
        tail -50 /tmp/signconnect-build.log
        exit 1
    fi

    log_success "Custom image built"
    DOCKER_REPO="thingsboard"
    TB_VERSION="latest"

    cd "$SCRIPT_DIR"
else
    log_info "Using pre-built image: ${DOCKER_REPO}/tb-postgres:${TB_VERSION}"

    # Pull latest image
    log_info "Pulling image..."
    docker pull "${DOCKER_REPO}/tb-postgres:${TB_VERSION}"
    log_success "Image ready"
fi

# =============================================================================
# Step 4: Initialize Database
# =============================================================================
echo -e "\n${BOLD}[4/5] Initializing Database${NC}"

# Check if data volume exists and has data
if docker volume inspect signconnect-data &>/dev/null; then
    # Volume exists, check if it has data
    DATA_EXISTS=$(docker run --rm -v signconnect-data:/data alpine sh -c "ls -A /data/db 2>/dev/null | wc -l")

    if [[ "$DATA_EXISTS" -gt 0 ]]; then
        log_info "Database already initialized, skipping..."
    else
        log_info "Running database initialization..."

        if [[ "$LOAD_DEMO" == true ]]; then
            docker run --rm -v signconnect-data:/data \
                "${DOCKER_REPO}/tb-postgres:${TB_VERSION}" \
                install-tb.sh --loadDemo
        else
            docker run --rm -v signconnect-data:/data \
                "${DOCKER_REPO}/tb-postgres:${TB_VERSION}" \
                install-tb.sh
        fi

        log_success "Database initialized"
    fi
else
    log_info "Creating data volume and initializing database..."

    if [[ "$LOAD_DEMO" == true ]]; then
        docker run --rm -v signconnect-data:/data \
            "${DOCKER_REPO}/tb-postgres:${TB_VERSION}" \
            install-tb.sh --loadDemo
    else
        docker run --rm -v signconnect-data:/data \
            "${DOCKER_REPO}/tb-postgres:${TB_VERSION}" \
            install-tb.sh
    fi

    log_success "Database initialized"
fi

# =============================================================================
# Step 5: Start SignConnect
# =============================================================================
echo -e "\n${BOLD}[5/5] Starting SignConnect${NC}"

docker compose up -d

log_info "Waiting for services to start..."

# Wait for health check
MAX_WAIT=120
ELAPSED=0

while [[ $ELAPSED -lt $MAX_WAIT ]]; do
    if curl -sf "http://localhost:${TB_PORT}/login" &>/dev/null; then
        break
    fi

    printf "\r  Waiting... (%ds)" "$ELAPSED"
    sleep 5
    ELAPSED=$((ELAPSED + 5))
done

echo ""

if [[ $ELAPSED -ge $MAX_WAIT ]]; then
    log_warning "Services taking longer than expected"
    log_info "Check: docker compose logs -f signconnect"
else
    log_success "SignConnect is running!"
fi

# =============================================================================
# Done!
# =============================================================================
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}║   ✓ SignConnect is Ready!                                  ║${NC}"
echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}║   URL: http://${SERVER_IP}:${TB_PORT}${NC}"
echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}║   Login:                                                   ║${NC}"
echo -e "${GREEN}║     sysadmin@thingsboard.org / sysadmin                    ║${NC}"
if [[ "$LOAD_DEMO" == true ]]; then
echo -e "${GREEN}║     tenant@thingsboard.org / tenant                        ║${NC}"
fi
echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Commands:"
echo "  Logs:    docker compose logs -f signconnect"
echo "  Stop:    docker compose stop"
echo "  Start:   docker compose start"
echo "  Remove:  docker compose down -v"
echo ""
