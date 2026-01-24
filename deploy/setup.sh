#!/bin/bash

# =============================================================================
# SignConnect Prerequisites Setup Script
# =============================================================================
# Installs all required dependencies on a fresh Ubuntu 20.04/22.04 server.
#
# Usage:
#   ./setup.sh [OPTIONS]
#
# Options:
#   --check         Only verify versions, do not install anything
#   --force         Reinstall even if already present
#   --help          Show this help
#
# Required packages:
#   - Git, curl, wget, unzip, jq (essentials)
#   - Java 17 (OpenJDK)
#   - Maven 3.6+
#   - Gradle (for .deb packaging)
#   - Node.js 20 LTS
#   - Yarn
#   - Docker Engine
#   - Docker Compose v2
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Logging functions
log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
log_error()   { echo -e "${RED}[✗]${NC} $1"; }
log_section() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default options
CHECK_ONLY=false
FORCE_INSTALL=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --check) CHECK_ONLY=true; shift ;;
        --force) FORCE_INSTALL=true; shift ;;
        --help) head -25 "$0" | tail -23; exit 0 ;;
        *) log_error "Unknown option: $1"; exit 1 ;;
    esac
done

# =============================================================================
# Version Check Functions
# =============================================================================

check_essentials() {
    local all_present=true
    for cmd in git curl wget unzip jq; do
        if command -v $cmd &>/dev/null; then
            log_success "$cmd: $(command -v $cmd)"
        else
            log_error "$cmd: not found"
            all_present=false
        fi
    done
    $all_present
}

check_java() {
    if command -v java &>/dev/null; then
        local version=$(java -version 2>&1 | head -n 1 | cut -d'"' -f2)
        local major=$(echo "$version" | cut -d'.' -f1)
        if [[ "$major" -ge 17 ]]; then
            log_success "Java: $version"
            return 0
        else
            log_warning "Java: $version (need 17+)"
            return 1
        fi
    else
        log_error "Java: not found"
        return 1
    fi
}

check_maven() {
    if command -v mvn &>/dev/null; then
        local version=$(mvn --version 2>/dev/null | head -n 1 | awk '{print $3}')
        local major=$(echo "$version" | cut -d'.' -f1)
        local minor=$(echo "$version" | cut -d'.' -f2)
        if [[ "$major" -ge 3 ]] && [[ "$minor" -ge 6 ]]; then
            log_success "Maven: $version"
            return 0
        else
            log_warning "Maven: $version (need 3.6+)"
            return 1
        fi
    else
        log_error "Maven: not found"
        return 1
    fi
}

check_gradle() {
    if command -v gradle &>/dev/null; then
        local version=$(gradle --version 2>/dev/null | grep "Gradle" | head -n 1 | awk '{print $2}')
        local major=$(echo "$version" | cut -d'.' -f1)
        if [[ "$major" -ge 7 ]]; then
            log_success "Gradle: $version"
            return 0
        else
            log_warning "Gradle: $version (need 7.x+)"
            return 1
        fi
    else
        log_error "Gradle: not found"
        return 1
    fi
}

check_node() {
    if command -v node &>/dev/null; then
        local version=$(node --version 2>/dev/null)
        local major=$(echo "$version" | sed 's/v//' | cut -d'.' -f1)
        if [[ "$major" -ge 20 ]]; then
            log_success "Node.js: $version"
            return 0
        else
            log_warning "Node.js: $version (need v20+)"
            return 1
        fi
    else
        log_error "Node.js: not found"
        return 1
    fi
}

check_yarn() {
    if command -v yarn &>/dev/null; then
        local version=$(yarn --version 2>/dev/null)
        log_success "Yarn: $version"
        return 0
    else
        log_error "Yarn: not found"
        return 1
    fi
}

check_docker() {
    if command -v docker &>/dev/null && docker --version &>/dev/null; then
        local version=$(docker --version 2>/dev/null | awk '{print $3}' | tr -d ',')
        log_success "Docker: $version"

        # Check if user is in docker group
        if groups | grep -q docker; then
            log_success "Docker group: user is member"
        else
            log_warning "Docker group: user is NOT member (run: sudo usermod -aG docker \$USER)"
        fi
        return 0
    else
        log_error "Docker: not found"
        return 1
    fi
}

check_compose() {
    if docker compose version &>/dev/null; then
        local version=$(docker compose version 2>/dev/null | awk '{print $4}')
        log_success "Docker Compose: $version"
        return 0
    else
        log_error "Docker Compose: not found"
        return 1
    fi
}

check_system() {
    log_section "System Requirements"

    # Memory
    local total_mem=$(free -g 2>/dev/null | awk '/^Mem:/{print $2}' || echo "0")
    if [[ "$total_mem" -ge 8 ]]; then
        log_success "Memory: ${total_mem}GB (8GB required)"
    else
        log_warning "Memory: ${total_mem}GB (8GB recommended, may be insufficient)"
    fi

    # Disk space
    local free_disk=$(df -BG . 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'G')
    if [[ "$free_disk" -ge 20 ]]; then
        log_success "Disk space: ${free_disk}GB free (20GB required)"
    else
        log_warning "Disk space: ${free_disk}GB free (20GB recommended)"
    fi

    # OS
    if [[ -f /etc/os-release ]]; then
        source /etc/os-release
        log_success "OS: $PRETTY_NAME"
    fi
}

# =============================================================================
# Installation Functions
# =============================================================================

install_essentials() {
    log_info "Installing essential packages..."
    sudo apt-get update
    sudo apt-get install -y git curl wget unzip jq software-properties-common apt-transport-https ca-certificates gnupg lsb-release
    log_success "Essential packages installed"
}

install_java() {
    log_info "Installing Java 17 (OpenJDK)..."
    sudo apt-get install -y openjdk-17-jdk

    # Set JAVA_HOME
    JAVA_HOME=$(dirname $(dirname $(readlink -f $(which java))))
    if ! grep -q "JAVA_HOME" /etc/environment 2>/dev/null; then
        echo "JAVA_HOME=$JAVA_HOME" | sudo tee -a /etc/environment >/dev/null
    fi
    export JAVA_HOME

    log_success "Java 17 installed"
}

install_maven() {
    log_info "Installing Maven..."
    sudo apt-get install -y maven
    log_success "Maven installed"
}

install_gradle() {
    log_info "Installing Gradle 8.6..."

    local GRADLE_VERSION="8.6"
    local GRADLE_HOME="/opt/gradle/gradle-${GRADLE_VERSION}"

    # Remove old apt gradle if exists
    sudo apt-get remove -y gradle 2>/dev/null || true

    # Download and extract
    wget -q "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" -O /tmp/gradle.zip
    sudo mkdir -p /opt/gradle
    sudo unzip -q -o /tmp/gradle.zip -d /opt/gradle
    rm /tmp/gradle.zip

    # Create symlink
    sudo ln -sf "${GRADLE_HOME}/bin/gradle" /usr/local/bin/gradle

    log_success "Gradle ${GRADLE_VERSION} installed"
}

install_nodejs() {
    log_info "Installing Node.js 20 LTS..."

    # Remove old nodejs if exists
    sudo apt-get remove -y nodejs npm 2>/dev/null || true

    # Add NodeSource repository
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs

    log_success "Node.js 20 installed"
}

install_yarn() {
    log_info "Installing Yarn..."
    sudo npm install -g yarn
    log_success "Yarn installed"
}

install_docker() {
    log_info "Installing Docker..."

    # Remove old versions
    sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

    # Add Docker's official GPG key
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null || true
    sudo chmod a+r /etc/apt/keyrings/docker.gpg

    # Add the repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Add user to docker group
    sudo usermod -aG docker $USER

    # Start Docker
    sudo systemctl enable docker
    sudo systemctl start docker

    log_success "Docker installed"
    log_warning "You may need to log out and back in for docker group to take effect"
    log_info "Or run: newgrp docker"
}

# =============================================================================
# Main Logic
# =============================================================================

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         SignConnect Prerequisites Setup                    ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"

check_system

# Check all prerequisites
log_section "Checking Prerequisites"

ALL_OK=true

check_essentials || ALL_OK=false
check_java || ALL_OK=false
check_maven || ALL_OK=false
check_gradle || ALL_OK=false
check_node || ALL_OK=false
check_yarn || ALL_OK=false
check_docker || ALL_OK=false
check_compose || ALL_OK=false

# If check only mode, exit now
if [[ "$CHECK_ONLY" == true ]]; then
    echo ""
    if [[ "$ALL_OK" == true ]]; then
        log_success "All prerequisites are satisfied!"
        exit 0
    else
        log_error "Some prerequisites are missing"
        exit 1
    fi
fi

# If all OK and not forcing, exit
if [[ "$ALL_OK" == true ]] && [[ "$FORCE_INSTALL" == false ]]; then
    echo ""
    log_success "All prerequisites are already installed!"
    log_info "Use --force to reinstall anyway"
    exit 0
fi

# Install missing prerequisites
log_section "Installing Prerequisites"

echo ""
log_info "This script will install missing packages using apt and npm."
log_info "You may be prompted for sudo password."
echo ""
read -p "Continue? [y/N] " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_warning "Aborted by user"
    exit 1
fi

# Install each component if missing or forced
if ! check_essentials &>/dev/null || [[ "$FORCE_INSTALL" == true ]]; then
    install_essentials
fi

if ! check_java &>/dev/null || [[ "$FORCE_INSTALL" == true ]]; then
    install_java
fi

if ! check_maven &>/dev/null || [[ "$FORCE_INSTALL" == true ]]; then
    install_maven
fi

if ! check_gradle &>/dev/null || [[ "$FORCE_INSTALL" == true ]]; then
    install_gradle
fi

if ! check_node &>/dev/null || [[ "$FORCE_INSTALL" == true ]]; then
    install_nodejs
fi

if ! check_yarn &>/dev/null || [[ "$FORCE_INSTALL" == true ]]; then
    install_yarn
fi

if ! check_docker &>/dev/null || ! check_compose &>/dev/null || [[ "$FORCE_INSTALL" == true ]]; then
    install_docker
fi

# Final verification
log_section "Final Verification"

FINAL_OK=true
check_essentials || FINAL_OK=false
check_java || FINAL_OK=false
check_maven || FINAL_OK=false
check_gradle || FINAL_OK=false
check_node || FINAL_OK=false
check_yarn || FINAL_OK=false
check_docker || FINAL_OK=false
check_compose || FINAL_OK=false

echo ""
if [[ "$FINAL_OK" == true ]]; then
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  All prerequisites installed successfully!                 ║${NC}"
    echo -e "${GREEN}╠════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║  IMPORTANT: Log out and back in for docker group to work.  ║${NC}"
    echo -e "${GREEN}║  Or run: newgrp docker                                     ║${NC}"
    echo -e "${GREEN}║                                                            ║${NC}"
    echo -e "${GREEN}║  Next step: ./deploy/install.sh --demo                     ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    exit 0
else
    log_error "Some installations failed. Check the output above."
    exit 1
fi
