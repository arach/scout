#!/bin/bash

echo "🔨 Building Scout v0.2.0 Release..."

# Ensure we're in the right directory
cd /Users/arach/dev/scout

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf src-tauri/target/release/bundle

# Build the app
echo "Building Scout..."
pnpm tauri build

# Check if build succeeded
if [ -f "src-tauri/target/release/bundle/macos/Scout.app/Contents/MacOS/scout" ]; then
    echo "✅ Build successful!"
    
    # Create DMG with fixed icon
    echo "Creating DMG..."
    create-dmg \
      --volname "Scout v0.2.0" \
      --volicon "Scout_fixed.icns" \
      --window-size 600 400 \
      --icon-size 100 \
      --icon "Scout.app" 175 200 \
      --hide-extension "Scout.app" \
      --app-drop-link 425 200 \
      --no-internet-enable \
      "Scout-v0.2.0.dmg" \
      "src-tauri/target/release/bundle/macos/Scout.app"
    
    echo "✅ Scout-v0.2.0.dmg created!"
    echo ""
    echo "📦 Release files:"
    echo "- App: src-tauri/target/release/bundle/macos/Scout.app"
    echo "- DMG: Scout-v0.2.0.dmg"
else
    echo "❌ Build failed!"
    exit 1
fi