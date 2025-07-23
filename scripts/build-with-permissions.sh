#!/bin/bash

# Build Scout with proper microphone permissions

set -e

echo "Building Scout..."

# Run the normal Tauri build for Apple Silicon
pnpm tauri build --target aarch64-apple-darwin

# Find the Info.plist files
BUNDLE_PATH="src-tauri/target/release/bundle"
APP_PLIST="$BUNDLE_PATH/macos/Scout.app/Contents/Info.plist"
DMG_APP_PLIST="$BUNDLE_PATH/dmg/Scout.app/Contents/Info.plist"

# Add microphone permission to the main app
if [ -f "$APP_PLIST" ]; then
    echo "Adding microphone permission to main app..."
    ./scripts/add-microphone-permission.sh "$APP_PLIST"
fi

# Add microphone permission to the DMG app
if [ -f "$DMG_APP_PLIST" ]; then
    echo "Adding microphone permission to DMG app..."
    ./scripts/add-microphone-permission.sh "$DMG_APP_PLIST"
fi

# Re-sign the app if needed (macOS will require this after modifying Info.plist)
if [ -d "$BUNDLE_PATH/macos/Scout.app" ]; then
    echo "Re-signing app..."
    codesign --force --deep --sign - "$BUNDLE_PATH/macos/Scout.app"
fi

echo "Build complete! The app now has microphone permissions."
echo "DMG files are located in: $BUNDLE_PATH/macos/"
echo "Look for files like: rw.XXXXX.Scout_0.3.0_aarch64.dmg"
echo ""
echo "Most recent DMG:"
ls -t $BUNDLE_PATH/macos/*.dmg 2>/dev/null | head -1