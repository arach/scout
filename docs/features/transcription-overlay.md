# Floating Transcription Overlay Feature

## Overview
A floating window that displays real-time transcription text as audio is being processed, allowing users to see and edit transcripts during recording.

## Key Features

### 1. Real-Time Display
- Shows transcription text as it's being generated during recording
- Updates incrementally as new chunks are processed
- Visual indication of processing state

### 2. Editable Text Area
- Users can edit/correct the transcription in real-time
- Corrections are preserved when recording completes
- Text area supports standard editing features (select, copy, cut, paste)

### 3. Window Management
- Floating window similar to the current overlay architecture
- Can be positioned/dragged by the user
- Option to minimize/hide the window
- Persists position between sessions

### 4. User Interactions
- Window appears automatically when recording starts (configurable)
- Can be dismissed/hidden during recording
- "Save edits" vs "Discard edits" options when recording completes
- Keyboard shortcuts for quick actions

### 5. Feedback Loop
- User edits provide valuable data for improving transcription accuracy
- Could log edit patterns to identify common transcription errors
- Potential for future ML training data

## Technical Implementation

### Frontend Components
- New `TranscriptionOverlay` component
- Reuse existing overlay window patterns
- Real-time event handling for transcription updates
- State management for edited vs original text

### Backend Integration
- Subscribe to transcription chunk events
- Handle window lifecycle (show/hide/position)
- Save user edits alongside original transcription
- Track edit metrics for analysis

### Events
- `transcription-chunk`: Partial transcription updates
- `overlay-edit`: User makes an edit
- `overlay-position-changed`: Window moved
- `overlay-visibility-changed`: Show/hide state

## User Settings
- Enable/disable auto-show on recording
- Default window position
- Window opacity/transparency
- Font size for transcription text

## Benefits
1. **Immediate Feedback**: Users see transcription results in real-time
2. **Error Correction**: Fix mistakes before saving final transcript
3. **Quality Improvement**: Edit data helps identify transcription weaknesses
4. **Better UX**: More interactive and engaging recording experience

## Future Enhancements
- Confidence highlighting (show low-confidence words differently)
- Alternative suggestions for uncertain words
- Quick correction shortcuts (e.g., common replacements)
- Integration with LLM post-processing