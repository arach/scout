#!/bin/bash

# Scout DMG Creator from existing build
# Usage: ./scripts/create-dmg-from-build.sh [version]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Version from argument or default
VERSION="${1:-0.5.0}"
APP_NAME="Scout"

echo -e "${BLUE}Creating DMG for Scout v${VERSION}...${NC}"

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/.."
cd "$PROJECT_ROOT"

# Find the built app
echo "Looking for Scout.app..."
APP_PATH=""

# Check common build locations
for path in \
    "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/${APP_NAME}.app" \
    "src-tauri/target/x86_64-apple-darwin/release/bundle/macos/${APP_NAME}.app" \
    "src-tauri/target/universal-apple-darwin/release/bundle/macos/${APP_NAME}.app" \
    "src-tauri/target/release/bundle/macos/${APP_NAME}.app"
do
    if [ -d "$path" ]; then
        APP_PATH="$path"
        echo "✓ Found app at: $path"
        break
    fi
done

# If not found, search for it
if [ -z "$APP_PATH" ]; then
    echo "Searching for Scout.app..."
    APP_PATH=$(find src-tauri/target -name "${APP_NAME}.app" -type d | head -n 1)
fi

if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
    echo -e "${RED}Error: ${APP_NAME}.app not found!${NC}"
    echo "Please run 'pnpm tauri build' first"
    exit 1
fi

# Create release directory
RELEASE_DIR="releases/v${VERSION}"
mkdir -p "$RELEASE_DIR"

# DMG Configuration
DMG_NAME="${APP_NAME}-${VERSION}-macOS"
FINAL_DMG="$RELEASE_DIR/${DMG_NAME}.dmg"

# Remove old DMG if it exists
if [ -f "$FINAL_DMG" ]; then
    echo "Removing old DMG..."
    rm "$FINAL_DMG"
fi

echo -e "${GREEN}Creating DMG...${NC}"

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
  "$APP_PATH" 2>/dev/null || {
    echo "⚠ Note: DMG creation warnings are normal and can be ignored"
}

# Check if DMG was created successfully
if [ -f "$FINAL_DMG" ]; then
    # Generate checksum
    cd "$RELEASE_DIR"
    shasum -a 256 "${DMG_NAME}.dmg" > "${DMG_NAME}.dmg.sha256"
    
    # Also create app.zip
    echo "Creating app.zip..."
    APP_DIR=$(dirname "$APP_PATH")
    cd "$APP_DIR"
    zip -r "$PROJECT_ROOT/$RELEASE_DIR/${APP_NAME}-${VERSION}-macOS.app.zip" "${APP_NAME}.app" -q
    cd "$PROJECT_ROOT/$RELEASE_DIR"
    shasum -a 256 "${APP_NAME}-${VERSION}-macOS.app.zip" > "${APP_NAME}-${VERSION}-macOS.app.zip.sha256"
    
    # Get file sizes
    DMG_SIZE=$(du -h "${DMG_NAME}.dmg" | cut -f1)
    APP_SIZE=$(du -h "${APP_NAME}-${VERSION}-macOS.app.zip" | cut -f1)
    
    echo -e "\n${GREEN}✨ Release artifacts created successfully!${NC}"
    echo -e "${BLUE}Location: $(pwd)${NC}"
    echo -e "${BLUE}DMG Size: $DMG_SIZE${NC}"
    echo -e "${BLUE}App.zip Size: $APP_SIZE${NC}"
    echo
    echo "Files created:"
    echo "  • ${DMG_NAME}.dmg"
    echo "  • ${DMG_NAME}.dmg.sha256"
    echo "  • ${APP_NAME}-${VERSION}-macOS.app.zip"
    echo "  • ${APP_NAME}-${VERSION}-macOS.app.zip.sha256"
    echo
    echo -e "${YELLOW}Ready for GitHub release:${NC}"
    echo -e "${GREEN}gh release create v${VERSION} \\
  --title \"Scout v${VERSION}\" \\
  --generate-notes \\
  ${DMG_NAME}.dmg \\
  ${APP_NAME}-${VERSION}-macOS.app.zip${NC}"
    
    # Open in Finder
    open .
else
    echo -e "${RED}Error: Failed to create DMG${NC}"
    exit 1
fi

cd "$PROJECT_ROOT"
echo -e "\n${GREEN}Done!${NC}"