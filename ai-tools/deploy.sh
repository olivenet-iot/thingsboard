#!/bin/bash
set -euo pipefail

REPO_DIR="/home/ubuntu/thingsboard"
SERVICE_DIR="$REPO_DIR/ai-tools"
SERVICE_NAME="signconnect-ai"

echo "=== Deploying $SERVICE_NAME ==="

cd "$REPO_DIR"
git pull --ff-only

cd "$SERVICE_DIR"
pip install -q -r requirements.txt

# Ensure env file exists
if [ ! -f /etc/signconnect-ai/env ]; then
    echo "WARNING: /etc/signconnect-ai/env not found."
    echo "  Create it with: sudo mkdir -p /etc/signconnect-ai"
    echo "  sudo cp $SERVICE_DIR/.env /etc/signconnect-ai/env"
    echo "  sudo chown ubuntu:ubuntu /etc/signconnect-ai/env"
    echo "  sudo chmod 600 /etc/signconnect-ai/env"
    exit 1
fi

# Install/update service file
sudo cp "$SERVICE_DIR/deploy/signconnect-ai.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

sleep 2
systemctl status "$SERVICE_NAME" --no-pager

echo "=== Deploy complete ==="
echo "  Logs:    journalctl -u $SERVICE_NAME -f"
echo "  Status:  systemctl status $SERVICE_NAME"
echo "  Restart: sudo systemctl restart $SERVICE_NAME"
