# Scout Development Roadmap

## Next Features to Implement

### 1. Automatic Copy & Paste
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

### 2. Context Capture
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

4. **Auto Copy/Paste** - Workflow automation features
3. **Context Capture** - Adds valuable metadata

## Future Considerations

- Customizable overlay appearance/position
- Ability to add custom models
- Ability to map to prominent models via APIs w/ token 
- Multiple recording modes (continuous, voice-activated, push-to-talk)
- Rich context capture (URL from browser, document path, etc.)
- Smart paste with formatting detection
- Keyboard shortcuts for quick actions on last transcription