#!/bin/bash

# Scout Release Builder
# Usage: ./scripts/release.sh <version>
# Example: ./scripts/release.sh 0.5.0

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check for version argument
if [ -z "$1" ]; then
    echo -e "${RED}Error: Version number required${NC}"
    echo "Usage: $0 <version>"
    echo "Example: $0 0.5.0"
    exit 1
fi

VERSION="$1"
APP_NAME="Scout"

echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Scout Release Builder v${VERSION}${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/.."
cd "$PROJECT_ROOT"

# Step 1: Update version numbers
echo -e "\n${YELLOW}[1/7] Updating version numbers to ${VERSION}...${NC}"

# Update package.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" package.json
echo "✓ Updated package.json"

# Update Cargo.toml
sed -i '' "s/^version = \".*\"/version = \"${VERSION}\"/" src-tauri/Cargo.toml
echo "✓ Updated Cargo.toml"

# Update tauri.conf.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" src-tauri/tauri.conf.json
echo "✓ Updated tauri.conf.json"

# Step 2: Clean previous builds
echo -e "\n${YELLOW}[2/7] Cleaning previous builds...${NC}"
rm -rf dist/
rm -rf src-tauri/target/release/bundle/
echo "✓ Cleaned build directories"

# Step 3: Build frontend
echo -e "\n${YELLOW}[3/7] Building frontend...${NC}"
pnpm build
echo "✓ Frontend built successfully"

# Step 4: Build Tauri app (universal binary for macOS)
echo -e "\n${YELLOW}[4/7] Building universal macOS binary...${NC}"
echo "This may take several minutes..."

# Determine architecture and set build target
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    echo "Building for Apple Silicon..."
    BUILD_TARGET="aarch64-apple-darwin"
    pnpm tauri build --target $BUILD_TARGET
elif [ "$ARCH" = "x86_64" ]; then
    echo "Building for Intel..."
    BUILD_TARGET="x86_64-apple-darwin"
    pnpm tauri build --target $BUILD_TARGET
else
    echo "Building universal binary..."
    BUILD_TARGET="universal-apple-darwin"
    pnpm tauri build --target $BUILD_TARGET
fi

echo "✓ App built successfully"

# Step 5: Sign the app (if certificates are available)
echo -e "\n${YELLOW}[5/7] Checking code signing...${NC}"

# Find the app bundle in the correct architecture folder
if [ -d "src-tauri/target/${BUILD_TARGET}/release/bundle/macos/${APP_NAME}.app" ]; then
    APP_PATH="src-tauri/target/${BUILD_TARGET}/release/bundle/macos/${APP_NAME}.app"
elif [ -d "src-tauri/target/release/bundle/macos/${APP_NAME}.app" ]; then
    APP_PATH="src-tauri/target/release/bundle/macos/${APP_NAME}.app"
else
    # Try to find it
    APP_PATH=$(find src-tauri/target -name "${APP_NAME}.app" -type d | head -n 1)
fi

if [ -d "$APP_PATH" ]; then
    # Check if app is already signed
    if codesign -dv "$APP_PATH" 2>&1 | grep -q "Signature"; then
        echo "✓ App is already signed"
    else
        echo "⚠ App is not signed (this is okay for local builds)"
    fi
else
    echo -e "${RED}Error: App bundle not found at $APP_PATH${NC}"
    exit 1
fi

# Step 6: Create DMG
echo -e "\n${YELLOW}[6/7] Creating DMG installer...${NC}"

DMG_DIR="src-tauri/target/release/bundle/dmg"
DMG_NAME="${APP_NAME}-${VERSION}-macOS"
FINAL_DMG="$DMG_DIR/${DMG_NAME}.dmg"

# Create DMG directory
mkdir -p "$DMG_DIR"

# Remove old DMG if exists
[ -f "$FINAL_DMG" ] && rm "$FINAL_DMG"

# Create DMG with nice appearance
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

if [ -f "$FINAL_DMG" ]; then
    echo "✓ DMG created successfully"
else
    echo -e "${RED}Error: Failed to create DMG${NC}"
    exit 1
fi

# Step 7: Create release artifacts
echo -e "\n${YELLOW}[7/7] Preparing release artifacts...${NC}"

RELEASE_DIR="releases/v${VERSION}"
mkdir -p "$RELEASE_DIR"

# Copy DMG to release directory
cp "$FINAL_DMG" "$RELEASE_DIR/"
echo "✓ Copied DMG to release directory"

# Create checksums
cd "$RELEASE_DIR"
shasum -a 256 "${DMG_NAME}.dmg" > "${DMG_NAME}.dmg.sha256"
echo "✓ Generated SHA256 checksum"

# Create release notes template
cat > "RELEASE_NOTES.md" << EOF
# Scout v${VERSION}

## What's New
- 

## Improvements
- 

## Bug Fixes
- 

## Download
- [Scout-${VERSION}-macOS.dmg](Scout-${VERSION}-macOS.dmg)

### Verification
\`\`\`bash
shasum -a 256 Scout-${VERSION}-macOS.dmg
\`\`\`

Expected: \`$(cat "${DMG_NAME}.dmg.sha256")\`

## System Requirements
- macOS 10.15 or later
- Microphone access permission

## Installation
1. Download the DMG file
2. Open the DMG
3. Drag Scout to Applications
4. Launch Scout from Applications
5. Grant microphone permissions when prompted
EOF

echo "✓ Created release notes template"

# Step 8: Prepare for website distribution
echo -e "\n${YELLOW}[8/8] Preparing website distribution files...${NC}"

# Create a zip of the .app for direct download
APP_DIR=$(dirname "$APP_PATH")
cd "$APP_DIR"
zip -r "$PROJECT_ROOT/$RELEASE_DIR/${APP_NAME}-${VERSION}-macOS.app.zip" "${APP_NAME}.app" -q
cd "$PROJECT_ROOT/$RELEASE_DIR"
shasum -a 256 "${APP_NAME}-${VERSION}-macOS.app.zip" > "${APP_NAME}-${VERSION}-macOS.app.zip.sha256"
echo "✓ Created app.zip for direct download"

# Create update JSON for auto-updater (if using Tauri updater)
cat > "latest-mac.json" << EOF
{
  "version": "${VERSION}",
  "pub_date": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "platforms": {
    "darwin-aarch64": {
      "url": "https://scout.arach.io/downloads/${APP_NAME}-${VERSION}-macOS.dmg",
      "signature": "",
      "size": $(stat -f%z "${DMG_NAME}.dmg" 2>/dev/null || stat -c%s "${DMG_NAME}.dmg" 2>/dev/null || echo 0)
    },
    "darwin-x86_64": {
      "url": "https://scout.arach.io/downloads/${APP_NAME}-${VERSION}-macOS.dmg",
      "signature": "",
      "size": $(stat -f%z "${DMG_NAME}.dmg" 2>/dev/null || stat -c%s "${DMG_NAME}.dmg" 2>/dev/null || echo 0)
    }
  }
}
EOF
echo "✓ Created update manifest"

# Create website download page snippet
cat > "website-snippet.html" << EOF
<!-- Scout v${VERSION} Download Section -->
<div class="download-section">
  <h2>Download Scout v${VERSION}</h2>
  
  <div class="download-cards">
    <!-- DMG Installer (Recommended) -->
    <div class="download-card">
      <h3>📦 DMG Installer</h3>
      <p>Recommended for most users</p>
      <a href="/downloads/${APP_NAME}-${VERSION}-macOS.dmg" 
         class="download-btn primary"
         data-size="${DMG_SIZE}">
        Download DMG (${DMG_SIZE})
      </a>
      <details>
        <summary>SHA256 Checksum</summary>
        <code>$(cat "${DMG_NAME}.dmg.sha256" | cut -d' ' -f1)</code>
      </details>
    </div>
    
    <!-- Direct App Download -->
    <div class="download-card">
      <h3>🚀 Direct App</h3>
      <p>For advanced users</p>
      <a href="/downloads/${APP_NAME}-${VERSION}-macOS.app.zip" 
         class="download-btn secondary"
         data-size="$(du -h "${APP_NAME}-${VERSION}-macOS.app.zip" | cut -f1)">
        Download App.zip
      </a>
      <details>
        <summary>SHA256 Checksum</summary>
        <code>$(cat "${APP_NAME}-${VERSION}-macOS.app.zip.sha256" | cut -d' ' -f1)</code>
      </details>
    </div>
  </div>
  
  <div class="system-requirements">
    <h3>System Requirements</h3>
    <ul>
      <li>macOS 10.15 (Catalina) or later</li>
      <li>Apple Silicon or Intel processor</li>
      <li>Microphone access permission</li>
    </ul>
  </div>
  
  <div class="release-date">
    Released: $(date +"%B %d, %Y")
  </div>
</div>
EOF
echo "✓ Created website HTML snippet"

# Get file sizes
DMG_SIZE=$(du -h "${DMG_NAME}.dmg" | cut -f1)
APP_SIZE=$(du -h "${APP_NAME}-${VERSION}-macOS.app.zip" | cut -f1)

# Print summary
echo -e "\n${GREEN}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Release Build Complete! 🎉${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo
echo -e "${BLUE}Version:${NC} ${VERSION}"
echo -e "${BLUE}DMG Size:${NC} ${DMG_SIZE}"
echo -e "${BLUE}App.zip Size:${NC} ${APP_SIZE}"
echo -e "${BLUE}Location:${NC} $(pwd)"
echo
echo -e "${BLUE}Files created:${NC}"
echo "  • ${DMG_NAME}.dmg (installer)"
echo "  • ${APP_NAME}-${VERSION}-macOS.app.zip (direct download)"
echo "  • latest-mac.json (auto-updater manifest)"
echo "  • website-snippet.html (for scout.arach.io)"
echo "  • RELEASE_NOTES.md"
echo "  • SHA256 checksums for all artifacts"
echo
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Edit RELEASE_NOTES.md with actual changes"
echo "2. Create GitHub release:"
echo -e "${GREEN}   gh release create v${VERSION} \\
     --title \"Scout v${VERSION}\" \\
     --notes-file releases/v${VERSION}/RELEASE_NOTES.md \\
     releases/v${VERSION}/${DMG_NAME}.dmg \\
     releases/v${VERSION}/${APP_NAME}-${VERSION}-macOS.app.zip${NC}"
echo
echo "3. Upload to website:"
echo "   • Copy .dmg and .app.zip to scout.arach.io/downloads/"
echo "   • Update download page with website-snippet.html"
echo "   • Update latest-mac.json for auto-updater"
echo
echo -e "${BLUE}Opening release directory...${NC}"
open .

cd "$PROJECT_ROOT"