# Active Application Detection Implementation

This document describes the implementation of active application detection for Scout on macOS.

## Overview

Scout now captures which application is currently active when a recording starts and stores this information in the transcript metadata. This allows users to see the context in which each recording was made.

## Implementation Details

### 1. Swift Component (`src/macos/active_app_detector.swift`)
- Uses `NSWorkspace.shared.frontmostApplication` to get the active application
- Captures:
  - Application name (localized)
  - Bundle identifier
  - Path to application bundle
  - Process ID

### 2. Objective-C Bridge (`src/macos/app_context_bridge.m`)
- Provides C-compatible functions to interface between Swift and Rust
- Handles memory management for string transfers
- Functions:
  - `get_active_app_name()` - Returns the active app name
  - `get_active_app_bundle_id()` - Returns the bundle ID
  - `free_app_string()` - Frees allocated strings

### 3. Rust Module (`src/macos/app_context.rs`)
- Defines the `AppContext` struct with app information
- Provides `get_active_app_context()` function
- Handles platform-specific compilation (returns None on non-macOS)

### 4. Integration Points

#### Recording Workflow (`src/recording_workflow.rs`)
- Captures app context when recording starts
- Stores context in the `ActiveRecording` struct
- Includes context in transcript metadata when saving

#### Processing Queue (`src/processing_queue.rs`)
- Updated `ProcessingJob` struct to include app context
- Preserves context through the processing pipeline
- Adds context to metadata when saving transcripts

### 5. Database Storage
App context is stored in the transcript metadata as JSON:
```json
{
  "model_used": "whisper-model",
  "processing_type": "ring_buffer",
  "app_context": {
    "name": "Visual Studio Code",
    "bundle_id": "com.microsoft.VSCode"
  }
}
```

## Testing

To test the feature:

1. Start Scout in development mode
2. Switch to different applications (e.g., VSCode, Chrome, Terminal)
3. Start a recording while in that application
4. Stop the recording
5. Check the console logs for: "Recording started in app: <AppName> (<BundleID>)"
6. Verify the transcript metadata contains the app_context field

## API Access

The app context can be accessed via the Tauri command:
```javascript
// Get a specific transcript with metadata
const transcript = await invoke('get_transcript', { transcriptId: 123 });
if (transcript.metadata) {
  const metadata = JSON.parse(transcript.metadata);
  if (metadata.app_context) {
    console.log(`Recorded in: ${metadata.app_context.name}`);
  }
}
```

## Privacy Considerations

- Only captures the active application name and bundle ID
- Does not capture window titles or content
- Information is stored locally in the user's database
- No tracking of application usage over time

## Future Enhancements

1. Add UI to display app context in transcript list
2. Add filtering/search by application
3. Support for Windows and Linux platforms
4. Option to disable app context capture in settings
5. Capture additional context (e.g., active document name with user permission)