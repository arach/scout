#!/bin/bash

# Reset Scout to simulate new user experience

echo "🧹 Resetting Scout for new user simulation..."

# Clear the models directory
MODELS_DIR="$HOME/Library/Application Support/com.scout.app/models"
if [ -d "$MODELS_DIR" ]; then
    echo "📦 Removing downloaded models from: $MODELS_DIR"
    rm -rf "$MODELS_DIR"/*.bin
else
    echo "📦 Models directory not found, skipping..."
fi

# Clear Chrome/Electron localStorage for Scout
# This removes the onboarding completion flag
echo "🗑️  Clearing localStorage..."

# For development (localhost)
rm -rf "$HOME/Library/Application Support/scout/Local Storage"
rm -rf "$HOME/Library/Application Support/com.scout.app/Local Storage"

echo "✅ Reset complete! Scout will now show onboarding on next launch."
echo ""
echo "To test:"
echo "1. Run 'pnpm tauri dev'"
echo "2. You should see the onboarding flow"