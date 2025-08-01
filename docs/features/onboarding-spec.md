# Scout Onboarding Experience Specification

## Overview
A streamlined first-run experience that guides users through essential setup while downloading the required speech recognition model in the background. The onboarding flow ensures users can start using Scout immediately after completion.

## Goals
- Minimize time to first successful transcription
- Transparently communicate what Scout needs and why
- Download required models while users complete other setup steps
- Ensure all permissions are granted before first use
- Educate users on basic functionality

## Technical Requirements
- Detect first run by checking if `~/Library/Application Support/com.scout.app/models/ggml-tiny.en.bin` exists
- Download only the Tiny model (39MB) for fast onboarding
- Show download progress throughout the flow
- Store completion state to skip on subsequent launches

## User Flow

### 1. Model Download Consent
**Trigger**: App launch with no models detected

**UI Elements**:
- App icon/logo
- Clear heading: "Scout needs a speech recognition model"
- Information box:
  ```
  • File: ggml-tiny.en.bin (39 MB)
  • Source: https://huggingface.co/ggerganov/whisper.cpp
  • ✓ All processing happens locally on your Mac
  • ✓ Your audio never leaves your device
  ```
- Primary button: "Download & Continue"
- Secondary link: "Learn more about Whisper"

**Behavior**:
- Clicking "Download & Continue" immediately starts download in background
- Progress indicator appears in corner of subsequent screens
- Flow continues without waiting for download completion

### 2. Microphone Permission
**UI Elements**:
- Icon: Microphone symbol
- Heading: "Scout needs microphone access"
- Description: "To transcribe your speech, Scout needs permission to use your microphone."
- Current status indicator:
  - ⏳ "Waiting for permission..." (default)
  - ✅ "Permission granted!" (after approval)
  - ❌ "Permission denied - Scout won't work without microphone access"
- Primary button: "Grant Permission" → "Continue" (after granted)
- If denied: "Open System Preferences" button

**Behavior**:
- "Grant Permission" triggers macOS permission dialog
- Poll permission status every 500ms
- Auto-advance to next screen 1 second after permission granted
- If denied, show instructions to enable in System Preferences

### 3. Keyboard Shortcuts
**UI Elements**:
- Heading: "Set up your recording shortcuts"
- Current shortcuts display:
  ```
  Push-to-Talk:     [Cmd+Shift+Space]     [Change]
  Toggle Recording:  [Cmd+Shift+R]         [Change]
  ```
- Visual hint showing push-to-talk gesture
- Checkbox: "□ Show recording indicator in menu bar"
- Primary button: "Continue"
- Secondary: "Skip for now"

**Behavior**:
- Display current shortcuts from settings
- "Change" opens shortcut recorder
- Validate shortcuts don't conflict with system shortcuts
- Save immediately on change

### 4. Quick Tour
**UI Elements**:
- Heading: "You're almost ready!"
- Carousel/steps showing:
  1. **Push-to-Talk**: "Hold [shortcut] while speaking for instant transcription"
  2. **Toggle Mode**: "Press [shortcut] to start/stop longer recordings"
  3. **Transcription Area**: "Your text appears here in real-time"
  4. **Search & Export**: "Find past transcriptions and export them"
- Download status:
  - If complete: ✅ "Model downloaded successfully!"
  - If in progress: "Downloading model... 78% complete"
- Primary button: 
  - "Finish Setup" (if download complete)
  - "Waiting for download..." (disabled if not complete)

**Behavior**:
- Auto-advance through tour slides every 5 seconds
- Allow manual navigation with dots/arrows
- Poll download status every second
- Enable "Finish Setup" only when download is 100% complete
- If download fails, show retry option

## Implementation Details

### Backend (Rust/Tauri)

**New Commands**:
```rust
#[tauri::command]
async fn check_first_run() -> Result<bool, String>

#[tauri::command]
async fn download_model(
    model_name: &str,
    progress_callback: Channel<DownloadProgress>
) -> Result<(), String>

#[tauri::command]
async fn check_microphone_permission() -> Result<PermissionStatus, String>

#[tauri::command]
async fn request_microphone_permission() -> Result<PermissionStatus, String>

#[tauri::command]
async fn mark_onboarding_complete() -> Result<(), String>
```

**Types**:
```rust
struct DownloadProgress {
    bytes_downloaded: u64,
    total_bytes: u64,
    percentage: f32,
}

enum PermissionStatus {
    Granted,
    Denied,
    NotDetermined,
}
```

### Frontend (React/TypeScript)

**Components**:
```typescript
<OnboardingFlow />
  <ModelDownloadStep />
  <MicrophonePermissionStep />
  <KeyboardShortcutsStep />
  <QuickTourStep />

<DownloadProgressIndicator />  // Persistent across all steps
```

**State Management**:
```typescript
interface OnboardingState {
  currentStep: number;
  downloadProgress: number;
  downloadStatus: 'idle' | 'downloading' | 'complete' | 'error';
  micPermission: 'granted' | 'denied' | 'not-determined';
  shortcutsConfigured: boolean;
}
```

## Error Handling

### Download Failures
- Show clear error message with specific issue
- Provide "Retry Download" button
- Offer alternative: "Download manually" with instructions
- Allow continuing without model (app won't function)

### Permission Denied
- Explain why Scout needs microphone access
- Provide step-by-step instructions with screenshots
- Deep link to System Preferences if possible
- Cannot continue without permission

### Network Issues
- Detect offline state before attempting download
- Show "Check your internet connection" message
- Allow retry when connection restored

## Design Considerations

### Visual Design
- Match Scout's VSCode-inspired dark theme
- Use consistent spacing and typography
- Progress indicators should be subtle but visible
- Smooth transitions between steps
- Icon animations for engagement (mic pulse, download progress)

### Accessibility
- Full keyboard navigation support
- Screen reader announcements for status changes
- High contrast mode support
- Clear focus indicators
- Descriptive button labels

### Performance
- Lazy load onboarding components
- Stream download directly to disk (no memory buffering)
- Compress images used in tour
- Minimal CPU usage during download

## Success Metrics
- Time from launch to first successful transcription
- Onboarding completion rate
- Download success rate
- Permission grant rate
- User engagement with shortcuts customization

## Future Enhancements
- Multiple model selection (Small, Medium, Large)
- Language selection and model download
- Cloud model option for low-storage devices
- Onboarding skip for advanced users
- Interactive transcription test in tour