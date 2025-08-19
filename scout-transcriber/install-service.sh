#!/bin/bash
# Install Scout Transcriber as a macOS service

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PLIST_FILE="scout-transcriber.plist"
SERVICE_LABEL="com.scout.transcriber"
INSTALL_PATH="$HOME/Library/LaunchAgents/$SERVICE_LABEL.plist"

echo -e "${BLUE}Scout Transcriber Service Installer${NC}"
echo "===================================="

# Check if already installed
if launchctl list | grep -q "$SERVICE_LABEL"; then
    echo -e "${YELLOW}Service is already installed and running${NC}"
    echo "To reinstall, first run: launchctl unload $INSTALL_PATH"
    exit 1
fi

# Update paths in plist file
echo -e "${YELLOW}Configuring service...${NC}"
CURRENT_DIR=$(pwd)
sed "s|/Users/arach/dev/scout/scout-transcriber|$CURRENT_DIR|g" "$PLIST_FILE" > "$INSTALL_PATH"

# Load the service
echo -e "${YELLOW}Installing service...${NC}"
launchctl load "$INSTALL_PATH"

# Check if loaded
if launchctl list | grep -q "$SERVICE_LABEL"; then
    echo -e "${GREEN}✅ Service installed successfully!${NC}"
    echo ""
    echo "Service Management Commands:"
    echo "  Start:   launchctl start $SERVICE_LABEL"
    echo "  Stop:    launchctl stop $SERVICE_LABEL"
    echo "  Status:  launchctl list | grep scout"
    echo "  Logs:    tail -f /tmp/scout-transcriber.log"
    echo "  Uninstall: launchctl unload $INSTALL_PATH"
else
    echo -e "${RED}❌ Failed to install service${NC}"
    exit 1
fi