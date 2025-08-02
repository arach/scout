#!/bin/bash

# Test script for the simplified recording workflow
set -e

echo "============================================"
echo "Testing Scout Simplified Recording Workflow"
echo "============================================"

# Function to enable simplified workflow
enable_simplified() {
    echo "Enabling simplified workflow..."
    # Get settings file path
    SETTINGS_FILE="$HOME/Library/Application Support/com.neuronic.scout/settings.json"
    
    if [ -f "$SETTINGS_FILE" ]; then
        # Use jq to update the setting if available, otherwise use sed
        if command -v jq &> /dev/null; then
            jq '.processing.use_simplified_workflow = true' "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
        else
            # Simple sed replacement (less robust but works for basic cases)
            sed -i.bak 's/"use_simplified_workflow": false/"use_simplified_workflow": true/g' "$SETTINGS_FILE"
        fi
        echo "✅ Simplified workflow enabled in settings"
    else
        echo "⚠️  Settings file not found. Will use default settings."
        # Create settings directory if it doesn't exist
        mkdir -p "$(dirname "$SETTINGS_FILE")"
        # Create a minimal settings file with simplified workflow enabled
        cat > "$SETTINGS_FILE" << EOF
{
  "processing": {
    "use_simplified_workflow": true
  }
}
EOF
        echo "✅ Created settings file with simplified workflow enabled"
    fi
}

# Function to check logs for simplified workflow
check_logs() {
    LOG_FILE="$HOME/Library/Logs/com.neuronic.scout/scout.log"
    if [ -f "$LOG_FILE" ]; then
        echo ""
        echo "Recent log entries mentioning simplified workflow:"
        echo "---------------------------------------------------"
        tail -n 100 "$LOG_FILE" | grep -i "simplified" || echo "No simplified workflow entries found"
        echo ""
    fi
}

# Kill any existing Scout instances
echo "Stopping any existing Scout instances..."
pkill -f "Scout" 2>/dev/null || true
sleep 1

# Enable simplified workflow
enable_simplified

# Build the app
echo ""
echo "Building Scout with debug mode..."
cd "$(dirname "$0")"
pnpm tauri build --debug

# Launch the app
echo ""
echo "Launching Scout..."
APP_PATH="./src-tauri/target/debug/bundle/macos/Scout.app"
open "$APP_PATH"

echo ""
echo "Scout is now running with the simplified workflow enabled."
echo ""
echo "TEST INSTRUCTIONS:"
echo "1. Open Scout (should be in your menu bar)"
echo "2. Click 'Start Recording' or use keyboard shortcut"
echo "3. Speak some test phrases:"
echo "   - 'Testing the simplified recording workflow'"
echo "   - 'This should write to a single WAV file'"
echo "   - 'The audio quality should be perfect'"
echo "4. Stop the recording"
echo "5. Check the transcription results"
echo ""
echo "WHAT TO VERIFY:"
echo "✓ Recording starts within 100ms"
echo "✓ Audio is captured correctly (no chipmunk effect)"
echo "✓ Single WAV file is created (not ring buffers)"
echo "✓ Transcription completes successfully"
echo "✓ No audio dropouts or quality issues"
echo ""
echo "Log file location: $HOME/Library/Logs/com.neuronic.scout/scout.log"
echo "Recordings location: $HOME/Library/Application Support/com.neuronic.scout/recordings/"
echo ""

# Wait a moment for the app to start
sleep 3

# Check initial logs
check_logs

echo "To monitor logs in real-time, run:"
echo "tail -f '$HOME/Library/Logs/com.neuronic.scout/scout.log' | grep -i simplified"