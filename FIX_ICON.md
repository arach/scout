# Fixing Scout Icon for Finder/DMG

## Current Issue
- Icon shows correctly in Alt+Tab
- Icon doesn't show properly in Finder or DMG preview

## Solution Applied
1. Created new DMG with emoji icon as volume icon:
   - `Scout-v0.2.0-emoji.dmg` (7MB)
   - Uses `emojiIcon.icns` for better visibility

## For Future Builds

### Option 1: Use Emoji Icon
Already updated in `tauri.conf.json`:
```json
"icon": [
  "icons/32x32.png",
  "icons/128x128.png", 
  "icons/128x128@2x.png",
  "icons/emojiIcon.icns",  // Changed from icon.icns
  "icons/icon.ico"
]
```

### Option 2: Create New Icon
If you want a custom icon:
1. Design new icon (512x512 minimum)
2. Use Icon Composer or `iconutil`:
   ```bash
   # Create iconset folder
   mkdir Scout.iconset
   
   # Add different sizes (16, 32, 128, 256, 512)
   cp icon_512x512.png Scout.iconset/icon_512x512.png
   cp icon_512x512@2x.png Scout.iconset/icon_512x512@2x.png
   # ... etc
   
   # Convert to icns
   iconutil -c icns Scout.iconset
   ```

### Option 3: Fix Existing Icon
The current `icon.icns` might be missing some resolutions. Check with:
```bash
iconutil -c iconset src-tauri/icons/icon.icns -o temp.iconset
ls temp.iconset/
```

## DMG Creation Commands

### With Emoji Icon (Recommended)
```bash
create-dmg \
  --volname "Scout v0.2.0" \
  --volicon "src-tauri/icons/emojiIcon.icns" \
  --window-size 600 400 \
  --icon-size 100 \
  --icon "Scout.app" 175 200 \
  --hide-extension "Scout.app" \
  --app-drop-link 425 200 \
  --no-internet-enable \
  "Scout-v0.2.0.dmg" \
  "/path/to/Scout.app"
```

## Notes
- The `--volicon` flag sets the DMG volume icon
- The emoji icon is 555KB vs 128KB for the regular icon
- Emoji icon has better visibility in Finder