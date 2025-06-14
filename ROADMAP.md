# Scout Development Roadmap

## Next Features to Implement

### 1. Recording Overlay Indicator
**Priority:** High  
**Description:** Display a small, unobtrusive overlay indicator when recording is active, eliminating the need to open the main window to check recording status.

**Requirements:**
- Small floating window/widget that appears during recording
- Shows recording status (active/inactive)
- Displays recording duration
- Minimal UI that doesn't interfere with user's work
- Should appear near the screen edge or corner
- Click-through or easily dismissible

**Technical Considerations:**
- Use Tauri's window API to create a frameless, always-on-top window
- Position management to avoid blocking important UI elements
- Smooth animations for show/hide transitions

---

### 2. Push-to-Talk Mode
**Priority:** High  
**Description:** Alternative recording mode where recording occurs only while a key combination is held down, with automatic transcription on release.

**Requirements:**
- Global shortcut that starts recording on key down
- Stops recording and triggers transcription on key up
- Different from toggle mode - no manual stop required
- Configurable key combination in settings
- Visual/audio feedback for recording state

**Technical Considerations:**
- Modify global shortcut handler to support key down/up events
- Implement automatic transcription trigger on key release
- Add setting to switch between toggle and push-to-talk modes
- Handle edge cases (app switching while key held, etc.)

---

### 3. Automatic Copy & Paste
**Priority:** Medium  
**Description:** Options to automatically copy transcribed text to clipboard and/or paste into the active application.

**Requirements:**
- **Auto-copy:** Automatically copy transcribed text to clipboard after transcription
- **Auto-paste:** Automatically paste transcribed text into the active application
- Both features should be independently configurable in settings
- Visual confirmation when text is copied/pasted
- Safety checks to prevent unwanted paste operations

**Technical Considerations:**
- Use system clipboard APIs
- Implement safe paste mechanism (simulate keyboard input)
- Add confirmation/undo options for auto-paste
- Consider paste formatting options (plain text vs. formatted)

---

### 4. Context Capture
**Priority:** Medium  
**Description:** Capture and store metadata about the active application during recording to provide context for transcriptions.

**Requirements:**
- Detect currently active application during recording
- Store application name and window title as metadata
- Display context information with transcripts
- Make context searchable/filterable
- Privacy-conscious (allow disabling this feature)

**Technical Considerations:**
- Use system APIs to get active window information
- Store metadata in database with transcripts
- Update database schema to include context fields
- Add UI elements to display/filter by context

---

## Implementation Order

1. **Recording Overlay** - Most immediate visual feedback improvement
2. **Push-to-Talk** - Core functionality enhancement
3. **Context Capture** - Adds valuable metadata
4. **Auto Copy/Paste** - Workflow automation features

## Future Considerations

- Customizable overlay appearance/position
- Multiple recording modes (continuous, voice-activated, push-to-talk)
- Rich context capture (URL from browser, document path, etc.)
- Smart paste with formatting detection
- Keyboard shortcuts for quick actions on last transcription