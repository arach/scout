# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Scout is a cross-platform local-first dictation application built with:
- Frontend: React 18 + TypeScript + Vite
- Backend: Rust + Tauri v2
- Audio: cpal (Cross-platform Audio Library)
- Transcription: whisper-rs with CoreML support
- Database: SQLite via sqlx

## Essential Commands

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

## Architecture

### Frontend (`/src/`)
- Main entry: `main.tsx`
- Core app: `App.tsx` (VSCode-inspired theme)
- Components in `/components/`
- Custom hooks in `/hooks/`
- Utilities in `/lib/`
- TypeScript types in `/types/`

### Backend (`/src-tauri/`)
Key modules:
- `/audio/` - Audio recording with cpal, includes VAD (Voice Activity Detection)
- `/transcription/` - Whisper integration for speech-to-text  
- `/db/` - SQLite database for transcript storage

State is managed via `AppState` struct containing:
- Audio recorder instance
- Database connection pool
- Directory paths for models and data

### Frontend-Backend Communication
Tauri commands exposed to frontend:
- `start_recording`, `stop_recording`, `is_recording`
- `get_transcripts`, `get_transcript`, `delete_transcript`
- `search_transcripts`

## Current Development Focus

The project is implementing:
- Push-to-talk recording with global shortcuts
- Real-time transcription using Whisper
- VSCode-inspired UI with settings panel
- Voice Activity Detection for automatic recording
- Performance targets: <300ms latency, <215MB memory usage

## Important Notes

- Uses pnpm as package manager
- All processing happens locally for privacy
- Whisper models must be downloaded before running
- System tray integration is implemented
- Audio processing includes automatic silence padding for short recordings