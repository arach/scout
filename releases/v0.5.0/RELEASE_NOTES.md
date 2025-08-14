# Scout v0.5.0

## ✨ New Features
- Added logs viewer in settings for debugging and troubleshooting
- Added toggle for UI sounds (transitions, settings saves) separate from recording sounds
- Improved settings UI with resizable sidebar navigation

## 🎨 Improvements
- Fixed gear icon contrast in recording view for better visibility
- Improved keyboard shortcut keys readability in dark theme with gradient backgrounds
- Enhanced visual styling for keyboard keys with better typography and shadows
- Made settings gear icon more subtle with transparent background

## 🐛 Bug Fixes
- Fixed keyboard monitor verbose logging that was printing every keypress
- Fixed CSS specificity issues with position selector buttons
- Removed redundant re-download button from model cards

## 🔧 Technical Changes
- Version bump to 0.5.0 across all configuration files
- Added .claude/settings.local.json to .gitignore
- Cleaned up old SettingsView component by migrating to SettingsViewV2
- Removed verbose keyboard event logging in Swift keyboard monitor

## Download
- **DMG Installer (Recommended)**: Scout-0.5.0-macOS.dmg
- **Direct App**: Scout-0.5.0-macOS.app.zip

### System Requirements
- macOS 10.15 (Catalina) or later
- Apple Silicon or Intel processor
- Microphone access permission