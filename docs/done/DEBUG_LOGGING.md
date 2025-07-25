# Debug Logging Guide for Scout

## Where to Find the Logs

### Frontend Logs (JavaScript Console)

Since Scout has two windows (main and overlay), there are two separate console outputs:

1. **Main Window Console**: 
   - Open DevTools in the main Scout window
   - This shows logs from the main app

2. **Overlay Window Console** (where our new logs appear):
   - The overlay window is separate and has its own console
   - To open it, you need to right-click on the overlay bar when it's visible
   - Or use the Tauri DevTools if available

### Backend Logs (Terminal)

All Rust logs appear in the terminal where you run `pnpm tauri dev`:
- Look for logs with emojis like 📊, 🎙️, ⏹️, ✅

## Expected Log Output

### When Starting Recording:
```
Backend (Terminal):
═══════════════════════════════════════
🎙️  BACKEND: Starting recording session
═══════════════════════════════════════

Frontend (Overlay Console):
═══════════════════════════════════════
🎙️  RECORDING SESSION STARTED
═══════════════════════════════════════
📦 Overlay: minimized → expanded
🔴 Recording: active
⏱️  Timer: started
📅 Time: 10:30:45 AM
```

### During Recording (every second):
```
Backend:
📊 Backend Audio: 🔈 quiet | Level: 0.234 | Duration: 1s

Frontend:
📊 Audio Level: 0.23 (quiet)
🎵 Volume snapshot: [██ ████ ███ █████ ██] (raw: 0.234)
```

### When Stopping:
```
Backend:
═══════════════════════════════════════
⏹️  BACKEND: Stopping recording session
═══════════════════════════════════════

Frontend:
═══════════════════════════════════════
⏹️  RECORDING STOPPED
═══════════════════════════════════════
📦 Overlay: expanded → minimized
⚙️  State: recording → processing
```

### Processing Complete:
```
Frontend:
═══════════════════════════════════════
✅ TRANSCRIPTION COMPLETE
═══════════════════════════════════════
📄 Transcript: Hello world, this is a test recording...
🔄 Returning to idle state
```

## Troubleshooting

If you don't see the logs:

1. **Check the right console**: The overlay window console is separate from the main window
2. **Enable DevTools**: You may need to enable developer tools in Tauri
3. **Check log levels**: Ensure console logging isn't filtered
4. **Force refresh**: Try Cmd+R in the overlay window if it's stuck

## Quick Test

To verify logging is working:
1. Start recording (Cmd+Shift+Space)
2. Check terminal for backend logs
3. Check overlay window console for frontend logs
4. Stop recording
5. Verify all state transitions are logged