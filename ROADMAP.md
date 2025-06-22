# Scout Development Roadmap

## Recently Completed

### ✅ Automatic Copy & Paste
**Priority:** Medium  
**Status:** Completed  
**Description:** Options to automatically copy transcribed text to clipboard and/or paste into the active application.

**Implemented Features:**
- **Auto-copy:** Automatically copy transcribed text to clipboard after transcription
- **Auto-paste:** Automatically paste transcribed text into the active application  
- Both features independently configurable in settings
- Safe paste mechanism using AppleScript on macOS
- Settings UI toggles for both features

**Technical Implementation:**
- Created `clipboard.rs` module with arboard crate integration
- Added auto_copy and auto_paste fields to UISettings
- Integrated clipboard operations into processing queue
- Platform-specific paste simulation for macOS

### ✅ Dual Recording Modes
**Priority:** High  
**Status:** Completed  
**Description:** Support for both toggle recording and push-to-talk recording with separate shortcuts.

**Implemented Features:**
- **Toggle Mode:** Start/stop recording with same shortcut (existing behavior)
- **Push-to-Talk Mode:** Hold shortcut to record, auto-stops on release or after 10s timeout
- Independent shortcut configuration for each mode
- Enhanced debouncing and race condition protection
- Both modes work simultaneously with separate shortcuts

**Technical Implementation:**
- Dual shortcut registration in Tauri global shortcuts
- Separate event handling for toggle vs push-to-talk
- Race condition protection with isStartingRecording flag
- Enhanced debouncing (300ms toggle, 500ms push-to-talk)

---

## Next Features to Implement

### 1. Context Capture
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

1. **Context Capture** - Adds valuable metadata for transcripts

## Future Considerations

- Customizable overlay appearance/position
- Ability to add custom models
- Ability to map to prominent models via APIs w/ token 
- Multiple recording modes (continuous, voice-activated, push-to-talk)
- Rich context capture (URL from browser, document path, etc.)
- Smart paste with formatting detection
- Keyboard shortcuts for quick actions on last transcription

---

## Roadmap Management Commands

This roadmap can be managed using Claude Code's `/roadmap` command:

### Available Commands

#### Show roadmap sections
- `/roadmap show` - Display entire roadmap
- `/roadmap show completed` - Show completed features only  
- `/roadmap show planned` - Show planned features
- `/roadmap show high-priority` - Show high priority items

#### Add new items
- `/roadmap add "Feature Name"` - Add new feature to planned section
- `/roadmap add "Feature Name" --priority high` - Add with specific priority

#### Update status  
- `/roadmap complete "Feature Name"` - Mark feature as completed
- `/roadmap start "Feature Name"` - Move to in-progress
- `/roadmap plan "Feature Name"` - Move back to planned

#### Analytics
- `/roadmap analyze` - Show roadmap analytics and progress
- `/roadmap timeline` - Estimate timeline for remaining work

### Usage Examples

```bash
# Show all high priority features
/roadmap show high-priority

# Mark a feature as completed
/roadmap complete "Context Capture"

# Add a new planned feature
/roadmap add "Custom Model Integration" --priority high

# Get roadmap analytics
/roadmap analyze
```

### Command Implementation

When using these commands, Claude Code will:

1. **Parse** the current ROADMAP.md structure
2. **Extract** features, priorities, and status information
3. **Perform** the requested action (show, add, update, analyze)
4. **Update** the ROADMAP.md file if changes were made
5. **Display** formatted output with progress and next steps

This provides a streamlined interface for roadmap management while maintaining the markdown format for version control and collaboration.