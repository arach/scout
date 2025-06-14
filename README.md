# Scout - Cross-Platform Local-First Dictation App

Scout is a privacy-focused, cross-platform voice transcription application built with Tauri v2, React/TypeScript, and Rust. It provides real-time voice-to-text transcription optimized for agentic use cases.

## Features

- **Local-First Processing**: All audio processing and transcription happens locally on your device
- **Cross-Platform**: Works on macOS, Windows, and Linux (iOS support planned)
- **Real-Time Transcription**: Low-latency voice-to-text conversion
- **Privacy-Focused**: No cloud dependencies or telemetry
- **Push-to-Talk Interface**: Simple recording interface with visual feedback
- **Transcript Management**: Save, search, and manage your transcriptions locally
- **SQLite Database**: All transcripts are stored in a local SQLite database

## Architecture

- **Frontend**: React with TypeScript
- **Backend**: Rust with Tauri v2
- **Audio Processing**: Custom audio recorder with cpal
- **Transcription**: whisper.cpp integration (implementation in progress)
- **Database**: SQLite with sqlx

## Project Structure

```
scout/
├── src/                    # React frontend
│   ├── components/         # React components
│   ├── hooks/              # Custom React hooks
│   ├── lib/                # Utilities and helpers
│   └── types/              # TypeScript type definitions
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── audio/          # Audio recording modules
│   │   ├── transcription/  # Transcription engine
│   │   └── db/             # Database layer
│   └── Cargo.toml          # Rust dependencies
├── package.json            # Node.js dependencies
└── README.md               # This file
```

## Prerequisites

- Node.js (v16 or later)
- Rust (latest stable)
- CMake (for building whisper.cpp)
- macOS, Windows, or Linux

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd scout
```

2. Install dependencies:
```bash
npm install
```

3. Run in development mode:
```bash
npm run tauri dev
```

## Building

To build for production:

```bash
npm run tauri build
```

This will create platform-specific binaries in `src-tauri/target/release/bundle/`.

## Usage

1. Launch the application
2. Click the "Start Recording" button to begin recording
3. Speak clearly into your microphone
4. Click "Stop Recording" to end the recording
5. The transcript will appear automatically
6. Use the search feature to find previous transcripts

## Current Status

The following features are implemented:
- ✅ Tauri v2 project setup with React/TypeScript
- ✅ Audio recording with cpal
- ✅ SQLite database for transcript storage
- ✅ Basic UI with recording controls
- ✅ Real-time recording indicator
- ✅ Transcript display and search

Features in progress:
- 🚧 whisper.cpp integration for actual transcription
- 🚧 Global hotkey support (Cmd+Shift+Space)
- 🚧 Voice Activity Detection (VAD)
- 🚧 Performance optimizations

## Development

### Running Tests

```bash
# Frontend tests
npm test

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