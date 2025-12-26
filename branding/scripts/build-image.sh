#!/bin/bash

# build-image.sh - Build branded Docker images
#
# Usage:
#   ./build-image.sh [OPTIONS] [SERVICE]
#
# Services:
#   all         Build all images (default)
#   tb-node     ThingsBoard core service
#   web-ui      Web UI service
#   mqtt        MQTT transport
#   http        HTTP transport
#   coap        CoAP transport
#
# Options:
#   --tag TAG       Docker image tag (default: latest)
#   --push          Push images to registry after build
#   --no-cache      Build without Docker cache
#   --dry-run       Show commands without executing
#   --help          Show this help message

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

# Defaults
TAG="${DOCKER_TAG:-latest}"
REGISTRY="${DOCKER_REGISTRY:-}"
REPO="${DOCKER_REPO:-signconnect}"
SERVICE="all"
PUSH=false
NO_CACHE=false
DRY_RUN=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --tag)
            TAG="$2"
            shift 2
            ;;
        --push)
            PUSH=true
            shift
            ;;
        --no-cache)
            NO_CACHE=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help)
            head -25 "$0" | tail -23
            exit 0
            ;;
        *)
            SERVICE="$1"
            shift
            ;;
    esac
done

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

# Build image name
get_image_name() {
    local service="$1"
    if [[ -n "$REGISTRY" ]]; then
        echo "$REGISTRY/$REPO/$service:$TAG"
    else
        echo "$REPO/$service:$TAG"
    fi
}

# Build a single service
build_service() {
    local service="$1"
    local image_name=$(get_image_name "$service")

    log "Building $service -> $image_name"

    # Determine Maven module path
    case $service in
        tb-node)
            MODULE="msa/tb-node"
            ;;
        web-ui)
            MODULE="msa/web-ui"
            ;;
        mqtt)
            MODULE="msa/transport/mqtt"
            ;;
        http)
            MODULE="msa/transport/http"
            ;;
        coap)
            MODULE="msa/transport/coap"
            ;;
        lwm2m)
            MODULE="msa/transport/lwm2m"
            ;;
        snmp)
            MODULE="msa/transport/snmp"
            ;;
        *)
            log "ERROR: Unknown service: $service"
            exit 1
            ;;
    esac

    # Build with Maven
    cd "$PROJECT_ROOT"

    MAVEN_OPTS="-Xmx4g"
    CACHE_OPT=""
    if $NO_CACHE; then
        CACHE_OPT="-Ddockerfile.cache=false"
    fi

    run_cmd mvn clean install -DskipTests -pl "$MODULE" -am \
        -Ddockerfile.skip=false \
        -Ddocker.repo="$REPO" \
        $CACHE_OPT

    # Tag with full image name
    local default_image="thingsboard/$service:latest"
    if docker image inspect "$default_image" >/dev/null 2>&1; then
        run_cmd docker tag "$default_image" "$image_name"
        log "Tagged: $image_name"
    fi

    # Push if requested
    if $PUSH; then
        run_cmd docker push "$image_name"
        log "Pushed: $image_name"
    fi
}

# ============================================
# MAIN BUILD LOGIC
# ============================================

log "Starting Docker image build..."
log "Repository: $REPO"
log "Tag: $TAG"
if [[ -n "$REGISTRY" ]]; then
    log "Registry: $REGISTRY"
fi
if $DRY_RUN; then
    log "DRY RUN MODE - No commands will be executed"
fi

# Verify branding is applied
if ! grep -q "$BRAND_NAME" "$PROJECT_ROOT/ui-ngx/src/index.html" 2>/dev/null; then
    log "WARNING: Branding may not be applied. Run apply-branding.sh first."
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Build services
case $SERVICE in
    all)
        log "Building all services..."
        for svc in tb-node web-ui mqtt http; do
            build_service "$svc"
        done
        ;;
    *)
        build_service "$SERVICE"
        ;;
esac

# ============================================
# DONE
# ============================================

log "Build complete!"

if ! $DRY_RUN; then
    log ""
    log "Built images:"
    for svc in tb-node web-ui mqtt http; do
        if [[ "$SERVICE" == "all" ]] || [[ "$SERVICE" == "$svc" ]]; then
            echo "  - $(get_image_name "$svc")"
        fi
    done

    if ! $PUSH; then
        log ""
        log "To push images, run with --push flag"
    fi
fi
