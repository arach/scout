#!/bin/bash

# Fix Scout Application Support Directory
# This script fixes the filesystem issues in Finder by:
# 1. Setting proper macOS directory permissions (700 - owner only)
# 2. Cleaning up legacy scout directory
# 3. Migrating any legacy data if needed

set -e

SCOUT_DIR="$HOME/Library/Application Support/com.jdi.scout"
OLD_SCOUT_DIR="$HOME/Library/Application Support/com.scout.app"
LEGACY_SCOUT_DIR="$HOME/Library/Application Support/scout"

echo "🔧 Fixing Scout Application Support directory..."

# Fix permissions on the main Scout directory and its contents
if [ -d "$SCOUT_DIR" ]; then
    echo "📁 Setting secure permissions (700) on $SCOUT_DIR and subdirectories"
    
    # Set secure permissions on main directory
    chmod 700 "$SCOUT_DIR"
    
    # Set secure permissions on all subdirectories (700 for directories)
    find "$SCOUT_DIR" -type d -exec chmod 700 {} \;
    
    # Set secure permissions on all files (600 for files - owner read/write only)
    find "$SCOUT_DIR" -type f -exec chmod 600 {} \;
    
    echo "✅ Fixed permissions on Scout app directory and all contents"
else
    echo "ℹ️  Scout app directory doesn't exist yet - will be created with proper permissions on next run"
fi

# Handle old com.scout.app directory (migrate to com.jdi.scout)
if [ -d "$OLD_SCOUT_DIR" ]; then
    echo "🗂️  Found old Scout directory at $OLD_SCOUT_DIR"
    echo "📦 Migrating data to new directory structure..."
    
    # Create new directory structure
    mkdir -p "$SCOUT_DIR"
    
    # Migrate all data from old to new location
    if [ "$(ls -A "$OLD_SCOUT_DIR" 2>/dev/null)" ]; then
        cp -r "$OLD_SCOUT_DIR/"* "$SCOUT_DIR/" 2>/dev/null || true
        echo "✅ Data migrated to new location"
    fi
    
    echo "🗑️  Removing old Scout directory..."
    rm -rf "$OLD_SCOUT_DIR"
    echo "✅ Old directory removed"
fi

# Handle legacy scout directory
if [ -d "$LEGACY_SCOUT_DIR" ]; then
    echo "🗂️  Found legacy scout directory at $LEGACY_SCOUT_DIR"
    
    # Check if it contains models that need to be migrated
    if [ -d "$LEGACY_SCOUT_DIR/models" ] && [ "$(ls -A "$LEGACY_SCOUT_DIR/models" 2>/dev/null)" ]; then
        echo "📦 Migrating models from legacy directory..."
        
        # Create models directory in new location if it doesn't exist
        mkdir -p "$SCOUT_DIR/models"
        
        # Copy models (don't overwrite if they already exist in new location)
        cp -rn "$LEGACY_SCOUT_DIR/models/"* "$SCOUT_DIR/models/" 2>/dev/null || true
        echo "✅ Models migrated to new location"
    fi
    
    echo "🗑️  Removing legacy scout directory..."
    rm -rf "$LEGACY_SCOUT_DIR"
    echo "✅ Legacy directory removed"
else
    echo "ℹ️  No legacy scout directory found"
fi

echo "🎉 Scout Application Support directory has been fixed!"
echo "   The directory now uses proper macOS security conventions."
echo "   This should resolve any weird/broken filesystem experience in Finder."