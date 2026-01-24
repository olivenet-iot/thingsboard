#!/bin/bash

# =============================================================================
# SignConnect One-Click Installation Script
# =============================================================================
# Deploys SignConnect from zero to running in a single command.
#
# Usage:
#   ./install.sh [OPTIONS]
#
# Options:
#   --demo            Load demo data (recommended for first install)
#   --skip-branding   Skip branding application
#   --skip-build      Skip Maven build (use existing images)
#   --rebuild         Force rebuild Docker images
#   --clean           Remove existing data before install
#   --dry-run         Show what would be done without doing it
#   --help            Show this help
#
# Environment Variables:
#   TB_MEMORY=4096        JVM heap size in MB (default: 2048)
#   TB_PORT=8080          HTTP port (default: 8080)
#   POSTGRES_PASSWORD     Database password (auto-generated if unset)
#
# Prerequisites:
#   Run ./setup.sh first to install required packages
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

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_ROOT/docker"
BRANDING_DIR="$PROJECT_ROOT/branding"

# Default options
LOAD_DEMO=false
SKIP_BRANDING=false
SKIP_BUILD=false
FORCE_REBUILD=false
CLEAN_INSTALL=false
DRY_RUN=false

# Environment defaults
TB_MEMORY=${TB_MEMORY:-2048}
TB_PORT=${TB_PORT:-8080}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --demo) LOAD_DEMO=true; shift ;;
        --skip-branding) SKIP_BRANDING=true; shift ;;
        --skip-build) SKIP_BUILD=true; shift ;;
        --rebuild) FORCE_REBUILD=true; shift ;;
        --clean) CLEAN_INSTALL=true; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        --help) head -27 "$0" | tail -25; exit 0 ;;
        *) log_error "Unknown option: $1"; exit 1 ;;
    esac
done

# =============================================================================
# Progress Display
# =============================================================================

TOTAL_STEPS=8
CURRENT_STEP=0

step() {
    ((CURRENT_STEP++))
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}[$CURRENT_STEP/$TOTAL_STEPS] $1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Spinner for long operations
spinner() {
    local pid=$1
    local msg=$2
    local spin='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    local i=0

    while kill -0 $pid 2>/dev/null; do
        printf "\r${spin:$i:1} $msg"
        i=$(( (i + 1) % 10 ))
        sleep 0.1
    done
    printf "\r"
}

# Progress bar
show_progress() {
    local current=$1
    local total=$2
    local desc=$3
    local pct=$((current * 100 / total))
    local filled=$((pct * 40 / 100))
    local empty=$((40 - filled))

    printf "\r["
    printf "%${filled}s" | tr ' ' '#'
    printf "%${empty}s" | tr ' ' '-'
    printf "] %3d%% %s" "$pct" "$desc"
}

# =============================================================================
# Helper Functions
# =============================================================================

wait_for_postgres() {
    local max_attempts=30
    local attempt=0

    log_info "Waiting for PostgreSQL to be ready..."

    while [ $attempt -lt $max_attempts ]; do
        if docker compose exec -T postgres pg_isready -U postgres &>/dev/null; then
            log_success "PostgreSQL is ready"
            return 0
        fi
        ((attempt++))
        show_progress $attempt $max_attempts "PostgreSQL starting..."
        sleep 2
    done

    echo ""
    log_error "PostgreSQL failed to start within timeout"
    return 1
}

wait_for_ready() {
    local url=$1
    local max_attempts=60
    local attempt=0

    log_info "Waiting for services to be ready..."

    while [ $attempt -lt $max_attempts ]; do
        local http_code=$(curl -sf -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")

        if [[ "$http_code" == "200" ]] || [[ "$http_code" == "401" ]]; then
            echo ""
            log_success "Services are ready!"
            return 0
        fi

        ((attempt++))
        show_progress $attempt $max_attempts "Services starting... (HTTP: $http_code)"
        sleep 5
    done

    echo ""
    log_warning "Services did not respond within timeout"
    log_info "Check logs: cd $DOCKER_DIR && docker compose logs -f tb-core1"
    return 1
}

check_port() {
    local port=$1
    if netstat -tuln 2>/dev/null | grep -q ":$port " || ss -tuln 2>/dev/null | grep -q ":$port "; then
        return 1
    fi
    return 0
}

generate_password() {
    openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 16
}

# =============================================================================
# Main Installation
# =============================================================================

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║           SignConnect One-Click Installation               ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Show configuration
log_info "Configuration:"
echo "  Demo data:      $LOAD_DEMO"
echo "  Skip branding:  $SKIP_BRANDING"
echo "  Skip build:     $SKIP_BUILD"
echo "  Clean install:  $CLEAN_INSTALL"
echo "  JVM Memory:     ${TB_MEMORY}MB"
echo "  HTTP Port:      $TB_PORT"

if [[ "$DRY_RUN" == true ]]; then
    log_warning "DRY RUN MODE - No changes will be made"
fi

echo ""

# =============================================================================
# Step 1: Check Prerequisites
# =============================================================================
step "Checking Prerequisites"

if [[ -x "$SCRIPT_DIR/setup.sh" ]]; then
    if ! "$SCRIPT_DIR/setup.sh" --check; then
        log_error "Prerequisites check failed!"
        log_info "Run: ./deploy/setup.sh"
        exit 1
    fi
else
    # Fallback manual checks
    PREREQ_OK=true

    command -v java &>/dev/null || { log_error "Java not found"; PREREQ_OK=false; }
    command -v mvn &>/dev/null || { log_error "Maven not found"; PREREQ_OK=false; }
    command -v docker &>/dev/null || { log_error "Docker not found"; PREREQ_OK=false; }
    docker compose version &>/dev/null || { log_error "Docker Compose not found"; PREREQ_OK=false; }

    if [[ "$PREREQ_OK" == false ]]; then
        log_error "Prerequisites check failed!"
        exit 1
    fi
fi

# Check Docker permissions
if ! docker ps &>/dev/null; then
    log_error "Cannot connect to Docker. Either:"
    log_info "  1. Docker is not running: sudo systemctl start docker"
    log_info "  2. User not in docker group: sudo usermod -aG docker \$USER && newgrp docker"
    exit 1
fi

# Check port availability
if ! check_port $TB_PORT; then
    log_warning "Port $TB_PORT is already in use"
    log_info "Set TB_PORT environment variable to use a different port"
fi

# Check disk space
FREE_DISK=$(df -BG "$PROJECT_ROOT" 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'G')
if [[ "$FREE_DISK" -lt 20 ]]; then
    log_warning "Only ${FREE_DISK}GB disk space free. 20GB+ recommended."
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo ""
    [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
fi

log_success "All prerequisites satisfied"

if [[ "$DRY_RUN" == true ]]; then
    log_info "[DRY RUN] Would continue with installation"
    exit 0
fi

# =============================================================================
# Step 2: Clean Previous Installation (if requested)
# =============================================================================
if [[ "$CLEAN_INSTALL" == true ]]; then
    step "Cleaning Previous Installation"

    cd "$DOCKER_DIR"

    log_info "Stopping services..."
    ./docker-stop-services.sh 2>/dev/null || true

    log_info "Removing containers..."
    docker compose down -v 2>/dev/null || true

    log_info "Removing data directories..."
    rm -rf tb-node/postgres tb-node/valkey-data tb-node/kafka 2>/dev/null || true

    log_success "Previous installation cleaned"
else
    step "Checking Existing Installation"
    log_info "Keeping existing data (use --clean to remove)"
fi

# =============================================================================
# Step 3: Apply Branding
# =============================================================================
if [[ "$SKIP_BRANDING" == false ]]; then
    step "Applying Branding"

    if [[ -f "$BRANDING_DIR/scripts/apply-branding.sh" ]]; then
        chmod +x "$BRANDING_DIR/scripts/apply-branding.sh"
        "$BRANDING_DIR/scripts/apply-branding.sh"
        log_success "Branding applied"
    else
        log_warning "Branding script not found, skipping"
    fi
else
    step "Skipping Branding"
    log_info "Using original ThingsBoard branding"
fi

# =============================================================================
# Step 4: Build Project
# =============================================================================
if [[ "$SKIP_BUILD" == false ]]; then
    step "Building Project"

    cd "$PROJECT_ROOT"
    export MAVEN_OPTS="-Xmx4g"

    log_info "Starting Maven build..."
    log_info "This may take 15-20 minutes on first build..."
    log_info "Build log: /tmp/signconnect-build.log"

    BUILD_OPTS="-DskipTests -Dlicense.skip=true"

    if [[ "$FORCE_REBUILD" == true ]]; then
        BUILD_OPTS="$BUILD_OPTS -Ddockerfile.skip=false"
    fi

    # Run build with progress indication
    if mvn clean install $BUILD_OPTS 2>&1 | tee /tmp/signconnect-build.log | grep -E '^\[INFO\] (Building |------|BUILD)'; then
        log_success "Build completed successfully"
    else
        log_error "Build failed!"
        log_info "Check log: cat /tmp/signconnect-build.log"
        exit 1
    fi
else
    step "Skipping Build"
    log_info "Using existing build"
fi

# =============================================================================
# Step 5: Configure Docker Environment
# =============================================================================
step "Configuring Docker Environment"

cd "$DOCKER_DIR"

# Generate password if not set
if [[ -z "$POSTGRES_PASSWORD" ]]; then
    POSTGRES_PASSWORD=$(generate_password)
    log_info "Generated PostgreSQL password"
fi

# Create .env file
cat > .env << ENVFILE
# SignConnect Docker Environment
# Generated by install.sh on $(date)

TB_QUEUE_TYPE=kafka
CACHE=valkey
DATABASE=postgres

DOCKER_REPO=thingsboard
JS_EXECUTOR_DOCKER_NAME=tb-js-executor
TB_NODE_DOCKER_NAME=tb-node
WEB_UI_DOCKER_NAME=tb-web-ui
MQTT_TRANSPORT_DOCKER_NAME=tb-mqtt-transport
HTTP_TRANSPORT_DOCKER_NAME=tb-http-transport
COAP_TRANSPORT_DOCKER_NAME=tb-coap-transport
LWM2M_TRANSPORT_DOCKER_NAME=tb-lwm2m-transport
SNMP_TRANSPORT_DOCKER_NAME=tb-snmp-transport
TB_VC_EXECUTOR_DOCKER_NAME=tb-vc-executor
EDQS_DOCKER_NAME=tb-edqs
EDQS_ENABLED=false

TB_VERSION=latest
LOAD_BALANCER_NAME=haproxy-certbot
MONITORING_ENABLED=false

# Performance settings
JAVA_OPTS=-Xmx${TB_MEMORY}M -Xms${TB_MEMORY}M -Xss384k -XX:+AlwaysPreTouch

# Database
SPRING_DATASOURCE_PASSWORD=${POSTGRES_PASSWORD}
ENVFILE

log_success "Docker environment configured"

# =============================================================================
# Step 6: Create Log Folders
# =============================================================================
step "Creating Log Folders"

if [[ -x "./docker-create-log-folders.sh" ]]; then
    ./docker-create-log-folders.sh
    log_success "Log folders created"
else
    log_warning "Log folder script not found, creating manually..."
    mkdir -p tb-node/log 2>/dev/null || true
fi

# =============================================================================
# Step 7: Initialize Database
# =============================================================================
step "Initializing Database"

# Check if database already exists
if [[ -d "tb-node/postgres" ]] && [[ -n "$(ls -A tb-node/postgres 2>/dev/null)" ]]; then
    log_info "Database already initialized"
    log_info "Use --clean to reinitialize"
else
    log_info "Starting PostgreSQL..."

    # Start only postgres first
    docker compose up -d postgres

    wait_for_postgres

    log_info "Running database initialization..."

    if [[ "$LOAD_DEMO" == true ]]; then
        log_info "Loading demo data..."
        ./docker-install-tb.sh --loadDemo
    else
        ./docker-install-tb.sh
    fi

    log_success "Database initialized"
fi

# =============================================================================
# Step 8: Start Services
# =============================================================================
step "Starting SignConnect Services"

log_info "Starting all services..."
./docker-start-services.sh

# Wait for services to be ready
wait_for_ready "http://localhost:$TB_PORT/api/noauth/login"

# =============================================================================
# Complete!
# =============================================================================

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}║   ✓ SignConnect Installation Complete!                     ║${NC}"
echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}║   URL: http://${SERVER_IP}:${TB_PORT}${NC}"
echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}║   Default Credentials:                                     ║${NC}"
echo -e "${GREEN}║     System Admin:  sysadmin@thingsboard.org / sysadmin     ║${NC}"
if [[ "$LOAD_DEMO" == true ]]; then
echo -e "${GREEN}║     Tenant Admin:  tenant@thingsboard.org / tenant         ║${NC}"
echo -e "${GREEN}║     Customer:      customer@thingsboard.org / customer     ║${NC}"
fi
echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Useful commands:"
echo "  Status:     cd $DOCKER_DIR && docker compose ps"
echo "  Logs:       cd $DOCKER_DIR && docker compose logs -f tb-core1"
echo "  Stop:       cd $DOCKER_DIR && ./docker-stop-services.sh"
echo "  Start:      cd $DOCKER_DIR && ./docker-start-services.sh"
echo "  Uninstall:  ./deploy/uninstall.sh"
echo ""
