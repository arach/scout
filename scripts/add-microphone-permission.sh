#!/bin/bash

# Script to add NSMicrophoneUsageDescription to the Info.plist after build

PLIST_PATH="$1"

if [ -z "$PLIST_PATH" ]; then
    echo "Usage: $0 <path-to-Info.plist>"
    exit 1
fi

if [ ! -f "$PLIST_PATH" ]; then
    echo "Error: Info.plist not found at $PLIST_PATH"
    exit 1
fi

# Check if NSMicrophoneUsageDescription already exists
if /usr/libexec/PlistBuddy -c "Print :NSMicrophoneUsageDescription" "$PLIST_PATH" >/dev/null 2>&1; then
    echo "NSMicrophoneUsageDescription already exists in Info.plist"
else
    echo "Adding NSMicrophoneUsageDescription to Info.plist..."
    /usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string 'Scout needs access to your microphone to record and transcribe audio. All processing happens locally on your device.'" "$PLIST_PATH"
    echo "Successfully added NSMicrophoneUsageDescription"
fi