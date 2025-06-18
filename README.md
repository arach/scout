# Scout - Cross-Platform Local-First Dictation App

Scout is a privacy-focused, cross-platform voice transcription application built with Tauri v2, React/TypeScript, and Rust. It provides real-time voice-to-text transcription with advanced model management and file upload capabilities.

![Scout Application](screenshot.png)

## Features

- **Local-First Processing**: All audio processing and transcription happens locally on your device
- **Cross-Platform**: Works on macOS, Windows, and Linux (iOS support planned)  
- **Real-Time Transcription**: Low-latency voice-to-text conversion using Whisper models
- **File Upload Support**: Drag & drop or upload audio files for transcription
- **Model Management**: Download and switch between different Whisper models (tiny, base, small, medium, large)
- **Smart Model Selection**: Automatic model downloads and intelligent fallback handling
- **Privacy-Focused**: No cloud dependencies or telemetry
- **Push-to-Talk Interface**: Recording with global hotkeys (Cmd+Shift+Space)
- **Native macOS Overlay**: Minimal recording indicator with position customization
- **Transcript Management**: Save, search, export, and manage your transcriptions locally
- **Settings System**: Comprehensive settings with hotkey customization and model selection
- **Audio Format Support**: Handles various audio formats with automatic conversion
- **Background Processing**: Queued processing system for file uploads

## Architecture

- **Frontend**: React with TypeScript + Vite
- **Backend**: Rust with Tauri v2
- **Audio Processing**: cpal (Cross-platform Audio Library) with Voice Activity Detection
- **Transcription**: whisper-rs with CoreML support for optimized performance
- **Database**: SQLite with sqlx for local transcript storage
- **Settings**: JSON-based configuration system
- **File Processing**: Background queue system with audio format conversion

## Project Structure

```
scout/
├── src/                    # React frontend
│   ├── components/         # React components (ModelManager, Overlay, etc.)
│   ├── hooks/              # Custom React hooks  
│   ├── lib/                # Utilities and helpers
│   └── types/              # TypeScript type definitions
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── audio/          # Audio recording and conversion
│   │   ├── transcription/  # Whisper transcription engine
│   │   ├── db/             # SQLite database layer
│   │   ├── models/         # Model management and downloads
│   │   ├── settings/       # Settings system
│   │   ├── processing_queue/ # Background file processing
│   │   └── macos/          # macOS-specific overlay implementation
│   └── Cargo.toml          # Rust dependencies
├── models/                 # Downloaded Whisper model files
├── scripts/                # Setup and utility scripts
├── package.json            # Node.js dependencies
└── README.md               # This file
```

## Prerequisites

- Node.js (v16 or later)
- pnpm (v8 or later) - Install with `npm install -g pnpm`
- Rust (latest stable)
- CMake (for building whisper.cpp)
- macOS, Windows, or Linux

## Installation

1. Clone the repository:
```bash
git clone https://github.com/arach/scout.git
cd scout
```

2. Install dependencies:
```bash
pnpm install
```

3. Download Whisper models:
```bash
./scripts/download-models.sh
```

4. Run in development mode:
```bash
pnpm tauri dev
```

## Building

To build for production:

```bash
pnpm tauri build
```

This will create platform-specific binaries in `src-tauri/target/release/bundle/`.

## Usage

### Live Recording
1. Launch the application
2. Click the "Start Recording" button or use the global hotkey (Cmd+Shift+Space)
3. Speak clearly into your microphone
4. The native overlay shows recording status
5. Click "Stop Recording" or press the hotkey again to end recording
6. The transcript will appear automatically after processing

### File Upload
1. Drag and drop audio files onto the recording area, or
2. Click "Upload Audio File" to select files
3. Supported formats: WAV, MP3, M4A, FLAC, and more
4. Files are processed in the background queue
5. View progress and results in the transcript list

### Model Management
1. Open Settings to access the Model Manager
2. Download different Whisper models based on your needs:
   - **Tiny (39MB)**: Fastest, basic accuracy
   - **Base (74MB)**: Good balance of speed and accuracy  
   - **Small (244MB)**: Better accuracy, slower processing
   - **Medium (769MB)**: High accuracy
   - **Large (1550MB)**: Best accuracy, slowest
3. Switch between models by clicking "Use This Model"
4. The active model is shown with a green "Active" badge

### Settings & Customization
- **Global Hotkeys**: Customize the recording shortcut
- **Overlay Position**: Move the recording indicator to different screen positions
- **Model Selection**: Choose which Whisper model to use for transcription
- **Voice Activity Detection**: Enable/disable automatic silence detection

## Current Status

### ✅ Completed Features
- **Core Application**: Tauri v2 project with React/TypeScript frontend
- **Audio Recording**: High-quality recording with cpal and Voice Activity Detection
- **Transcription**: Full whisper-rs integration with CoreML optimization
- **Model Management**: Download, switch, and manage multiple Whisper models
- **File Upload**: Drag & drop support with automatic audio format conversion
- **Settings System**: JSON-based configuration with hotkey customization
- **Database**: SQLite storage with full transcript management
- **Native Overlay**: macOS-specific recording indicator with positioning
- **Background Processing**: Queued file processing system
- **Search & Export**: Full-text search and export in multiple formats
- **Global Hotkeys**: Customizable shortcuts for hands-free operation
- **UI/UX**: VSCode-inspired theme with responsive design

### 🚧 In Progress
- iOS/mobile platform support
- Advanced VAD tuning and noise reduction
- Real-time streaming transcription
- Cloud sync options (optional)
- Plugin system for custom workflows

### 🎯 Planned Features
- Multiple language support beyond English
- Custom model training utilities
- Team collaboration features
- API endpoint for external integrations

## Development

### Essential Commands

```bash
# Development
pnpm dev              # Start Vite dev server  
pnpm tauri dev        # Run full app in development mode

# Build
pnpm build            # TypeScript + Vite build
pnpm tauri build      # Build production binaries

# Setup
./scripts/download-models.sh  # Download Whisper models (required)

# Testing
cd src-tauri && cargo test    # Run Rust tests
```

### Running Tests

```bash
# Frontend tests
pnpm test

# Rust tests  
cd src-tauri
cargo test
```

### Code Style

- Frontend: ESLint and Prettier
- Backend: rustfmt and clippy

## Performance Targets

- User-perceived latency: <300ms
- Memory usage: <215MB for base model
- Processing efficiency: 0.1-0.5 RTF for small models

## Security Considerations

- All processing is done locally
- No network requests for transcription
- Audio files are stored temporarily and deleted after processing
- Database is stored in the app's local data directory

## License

[License information to be added]

## Contributing

[Contributing guidelines to be added]