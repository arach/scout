#!/bin/bash

# Scout DMG Creator Script
# Creates a beautiful DMG installer for Scout

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Creating DMG for Scout v0.5.0...${NC}"

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/.."

# Configuration
APP_NAME="Scout"
VERSION="0.5.0"
DMG_NAME="${APP_NAME}_${VERSION}_Installer"
APP_PATH="$PROJECT_ROOT/src-tauri/target/release/bundle/macos/${APP_NAME}.app"
DMG_PATH="$PROJECT_ROOT/src-tauri/target/release/bundle/dmg"
FINAL_DMG="$DMG_PATH/${DMG_NAME}.dmg"

# Check if app exists
if [ ! -d "$APP_PATH" ]; then
    echo -e "${RED}Error: ${APP_NAME}.app not found at $APP_PATH${NC}"
    echo "Please run 'pnpm tauri build' first"
    exit 1
fi

# Create DMG directory if it doesn't exist
mkdir -p "$DMG_PATH"

# Remove old DMG if it exists
if [ -f "$FINAL_DMG" ]; then
    echo "Removing old DMG..."
    rm "$FINAL_DMG"
fi

echo -e "${GREEN}Creating DMG with custom background and layout...${NC}"

# Create DMG with create-dmg
create-dmg \
  --volname "${APP_NAME} ${VERSION}" \
  --window-pos 200 120 \
  --window-size 600 400 \
  --icon-size 100 \
  --icon "${APP_NAME}.app" 150 185 \
  --hide-extension "${APP_NAME}.app" \
  --app-drop-link 450 185 \
  --no-internet-enable \
  "$FINAL_DMG" \
  "$APP_PATH"

# Check if DMG was created successfully
if [ -f "$FINAL_DMG" ]; then
    # Get file size
    SIZE=$(du -h "$FINAL_DMG" | cut -f1)
    echo -e "${GREEN}✨ DMG created successfully!${NC}"
    echo -e "${BLUE}Location: $FINAL_DMG${NC}"
    echo -e "${BLUE}Size: $SIZE${NC}"
    
    # Open in Finder
    open -R "$FINAL_DMG"
else
    echo -e "${RED}Error: Failed to create DMG${NC}"
    exit 1
fi

echo -e "${GREEN}Done! The DMG is ready for distribution.${NC}"