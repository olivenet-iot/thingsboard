#!/bin/bash

# =============================================================================
# SignConnect Deployment Script
# =============================================================================
# Complete deployment: Branding → Build → Docker Setup → Start
#
# Usage:
#   ./deploy.sh [OPTIONS]
#
# Options:
#   --fresh         Fresh install (wipes existing data)
#   --skip-build    Skip Maven build
#   --skip-branding Skip branding (use original ThingsBoard)
#   --demo          Load demo data (default)
#   --no-demo       Don't load demo data
#   --help          Show this help
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_ROOT/docker"
BRANDING_DIR="$PROJECT_ROOT/branding"

# Default options
FRESH_INSTALL=false
SKIP_BUILD=false
SKIP_BRANDING=false
LOAD_DEMO=true

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --fresh) FRESH_INSTALL=true; shift ;;
        --skip-build) SKIP_BUILD=true; shift ;;
        --skip-branding) SKIP_BRANDING=true; shift ;;
        --demo) LOAD_DEMO=true; shift ;;
        --no-demo) LOAD_DEMO=false; shift ;;
        --help) head -20 "$0" | tail -18; exit 0 ;;
        *) echo -e "${RED}Unknown option: $1${NC}"; exit 1 ;;
    esac
done

# Logging
log() { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING:${NC} $1"; }
log_error() { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $1"; }
log_section() { echo -e "\n${BLUE}=== $1 ===${NC}"; }

# =============================================================================
# STEP 1: Prerequisites Check
# =============================================================================
log_section "Step 1: Checking Prerequisites"

check_cmd() {
    if ! command -v $1 &> /dev/null; then
        log_error "$1 is not installed"
        return 1
    fi
    return 0
}

PREREQ_OK=true

# Java 17+
if check_cmd java; then
    JAVA_VER=$(java -version 2>&1 | head -n 1 | cut -d'"' -f2 | cut -d'.' -f1)
    [[ "$JAVA_VER" -ge 17 ]] && log "Java $JAVA_VER ✓" || { log_error "Java 17+ required"; PREREQ_OK=false; }
else
    PREREQ_OK=false
fi

# Maven
check_cmd mvn && log "Maven ✓" || PREREQ_OK=false

# Docker
check_cmd docker && log "Docker ✓" || PREREQ_OK=false

# Docker Compose
docker compose version &>/dev/null && log "Docker Compose ✓" || { log_error "Docker Compose V2 required"; PREREQ_OK=false; }

# Memory check
TOTAL_MEM=$(free -g 2>/dev/null | awk '/^Mem:/{print $2}' || echo "0")
[[ "$TOTAL_MEM" -ge 8 ]] && log "Memory: ${TOTAL_MEM}GB ✓" || log_warn "Memory: ${TOTAL_MEM}GB (8GB+ recommended)"

[[ "$PREREQ_OK" == false ]] && { log_error "Prerequisites check failed"; exit 1; }

# =============================================================================
# STEP 2: Apply Branding
# =============================================================================
if [[ "$SKIP_BRANDING" == false ]]; then
    log_section "Step 2: Applying Branding"

    if [[ -f "$BRANDING_DIR/scripts/apply-branding.sh" ]]; then
        chmod +x "$BRANDING_DIR/scripts/apply-branding.sh"
        "$BRANDING_DIR/scripts/apply-branding.sh"
    else
        log_warn "Branding script not found, skipping"
    fi
else
    log_section "Step 2: Skipping Branding"
fi

# =============================================================================
# STEP 3: Build Project
# =============================================================================
if [[ "$SKIP_BUILD" == false ]]; then
    log_section "Step 3: Building Project"

    cd "$PROJECT_ROOT"
    export MAVEN_OPTS="-Xmx4g"

    log "Building ThingsBoard (this takes 10-15 minutes)..."

    if mvn clean install -DskipTests -Dlicense.skip=true -Ddockerfile.skip=false 2>&1 | tee /tmp/signconnect-build.log | grep -E '^\[INFO\] (Building |BUILD)'; then
        log "Build successful ✓"
    else
        log_error "Build failed. See /tmp/signconnect-build.log"
        exit 1
    fi
else
    log_section "Step 3: Skipping Build"
fi

# =============================================================================
# STEP 4: Configure Docker Environment
# =============================================================================
log_section "Step 4: Configuring Docker Environment"

cd "$DOCKER_DIR"

# Create .env file
cat > .env << 'ENVFILE'
# SignConnect Docker Environment
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

JAVA_OPTS=-Xmx2048M -Xms2048M -Xss384k -XX:+AlwaysPreTouch
ENVFILE

log "Docker environment configured ✓"

# =============================================================================
# STEP 5: Create Log Folders
# =============================================================================
log_section "Step 5: Creating Log Folders"

./docker-create-log-folders.sh
log "Log folders created ✓"

# =============================================================================
# STEP 6: Fresh Install (if requested)
# =============================================================================
if [[ "$FRESH_INSTALL" == true ]]; then
    log_section "Step 6: Fresh Install - Removing Existing Data"

    ./docker-stop-services.sh 2>/dev/null || true
    ./docker-remove-services.sh 2>/dev/null || true

    rm -rf tb-node/postgres tb-node/valkey-data tb-node/kafka 2>/dev/null || true
    log "Existing data removed ✓"
fi

# =============================================================================
# STEP 7: Initialize Database
# =============================================================================
log_section "Step 7: Initializing Database"

if [[ -d "tb-node/postgres" ]] && [[ -n "$(ls -A tb-node/postgres 2>/dev/null)" ]]; then
    log "Database already initialized, skipping..."
else
    log "Installing database schema..."

    if [[ "$LOAD_DEMO" == true ]]; then
        ./docker-install-tb.sh --loadDemo
    else
        ./docker-install-tb.sh
    fi
    log "Database initialized ✓"
fi

# =============================================================================
# STEP 8: Start Services
# =============================================================================
log_section "Step 8: Starting Services"

./docker-start-services.sh
log "Services starting..."

# =============================================================================
# STEP 9: Wait for Services
# =============================================================================
log_section "Step 9: Waiting for Services (up to 5 minutes)"

MAX_WAIT=300
ELAPSED=0

while [[ $ELAPSED -lt $MAX_WAIT ]]; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/noauth/login 2>/dev/null || echo "000")

    if [[ "$HTTP_CODE" == "401" ]] || [[ "$HTTP_CODE" == "200" ]]; then
        log "API is ready ✓"
        break
    fi

    log "Waiting... (${ELAPSED}s)"
    sleep 15
    ELAPSED=$((ELAPSED + 15))
done

if [[ $ELAPSED -ge $MAX_WAIT ]]; then
    log_warn "Timeout waiting for services. Check logs: docker compose logs -f tb-core1"
fi

# =============================================================================
# COMPLETE
# =============================================================================
log_section "Deployment Complete!"

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  SignConnect is now running!                               ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  URL: http://${SERVER_IP}${NC}"
echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}║  Credentials:                                              ║${NC}"
echo -e "${GREEN}║    System Admin:  sysadmin@thingsboard.org / sysadmin      ║${NC}"
if [[ "$LOAD_DEMO" == true ]]; then
echo -e "${GREEN}║    Tenant Admin:  tenant@thingsboard.org / tenant          ║${NC}"
echo -e "${GREEN}║    Customer:      customer@thingsboard.org / customer      ║${NC}"
fi
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Useful commands:"
echo "  Logs:   cd $DOCKER_DIR && docker compose logs -f tb-core1"
echo "  Stop:   cd $DOCKER_DIR && ./docker-stop-services.sh"
echo "  Start:  cd $DOCKER_DIR && ./docker-start-services.sh"
