#!/bin/bash

# Completely reset Scout to factory state - ACTUAL new user experience

echo "⚠️  WARNING: This will completely reset Scout to factory state!"
echo "This includes all settings, transcripts, and downloaded models."
echo ""
read -p "Are you sure you want to continue? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 1
fi

echo ""
echo "🔥 Performing complete Scout reset..."

# 1. Remove entire app data directory (includes database, models, settings)
APP_DATA="$HOME/Library/Application Support/com.scout.app"
if [ -d "$APP_DATA" ]; then
    echo "📦 Removing app data: $APP_DATA"
    rm -rf "$APP_DATA"
fi

# 2. Remove development app data
DEV_DATA="$HOME/Library/Application Support/scout"
if [ -d "$DEV_DATA" ]; then
    echo "🔧 Removing dev data: $DEV_DATA"
    rm -rf "$DEV_DATA"
fi

# 3. Remove any localStorage/WebKit data
WEBKIT_DATA="$HOME/Library/WebKit/com.scout.app"
if [ -d "$WEBKIT_DATA" ]; then
    echo "🌐 Removing WebKit data: $WEBKIT_DATA"
    rm -rf "$WEBKIT_DATA"
fi

# 4. Remove preferences
PREFS="$HOME/Library/Preferences/com.scout.app.plist"
if [ -f "$PREFS" ]; then
    echo "⚙️  Removing preferences: $PREFS"
    rm -f "$PREFS"
fi

# 5. Remove any caches
CACHES="$HOME/Library/Caches/com.scout.app"
if [ -d "$CACHES" ]; then
    echo "🗑️  Removing caches: $CACHES"
    rm -rf "$CACHES"
fi

# 6. Remove logs
LOGS="$HOME/Library/Logs/com.scout.app"
if [ -d "$LOGS" ]; then
    echo "📝 Removing logs: $LOGS"
    rm -rf "$LOGS"
fi

echo ""
echo "✅ Complete reset done! Scout is now in factory state."
echo ""
echo "Next steps:"
echo "1. Run 'pnpm tauri dev' or open the installed app"
echo "2. You'll see the onboarding flow"
echo "3. All data has been removed - you're truly a new user"