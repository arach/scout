#!/bin/bash

# Temporarily move Scout data to test onboarding, then restore it

SCOUT_DIR="$HOME/Library/Application Support/com.jdi.scout"
TEMP_DIR="$HOME/Library/Application Support/com.jdi.scout.backup"

case "${1:-toggle}" in
    "hide")
        if [ -d "$SCOUT_DIR" ]; then
            echo "📦 Moving Scout data to temporary location..."
            mv "$SCOUT_DIR" "$TEMP_DIR"
            echo "✅ Ready to test onboarding!"
        else
            echo "❌ No Scout data found to hide"
        fi
        ;;
    
    "restore")
        if [ -d "$TEMP_DIR" ]; then
            echo "📦 Restoring Scout data..."
            rm -rf "$SCOUT_DIR" 2>/dev/null  # Remove any new data created during testing
            mv "$TEMP_DIR" "$SCOUT_DIR"
            echo "✅ Scout data restored!"
        else
            echo "❌ No backup found to restore"
        fi
        ;;
    
    "toggle")
        if [ -d "$TEMP_DIR" ]; then
            # Backup exists, so restore
            echo "📦 Restoring Scout data..."
            rm -rf "$SCOUT_DIR" 2>/dev/null
            mv "$TEMP_DIR" "$SCOUT_DIR"
            echo "✅ Scout data restored!"
        elif [ -d "$SCOUT_DIR" ]; then
            # Scout dir exists, so hide it
            echo "📦 Moving Scout data to temporary location..."
            mv "$SCOUT_DIR" "$TEMP_DIR"
            echo "✅ Ready to test onboarding!"
        else
            echo "❌ No Scout data found"
        fi
        ;;
    
    *)
        echo "Usage: $0 [hide|restore|toggle]"
        echo "  hide    - Move Scout data to backup (show onboarding)"
        echo "  restore - Restore Scout data from backup"
        echo "  toggle  - Toggle between states (default)"
        ;;
esac