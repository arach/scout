# Changelog

All notable changes to Scout will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-30

### 🎉 Initial Release

Scout is a privacy-focused, cross-platform voice transcription application that processes everything locally on your device.

### ✨ Features

- **Push-to-Talk Recording**: Global hotkey (Cmd+Shift+Space) for instant recording
- **Real-Time Transcription**: Low-latency voice-to-text using Whisper models
- **Voice Activity Detection (VAD)**: Automatic silence detection and trimming
- **File Upload Support**: Drag & drop audio files for batch transcription
- **Model Management**: Download and switch between Whisper models (tiny to large-v3)
- **Native macOS Overlay**: Minimal recording indicator with customizable position
- **Transcript Database**: SQLite-based local storage with search capabilities
- **Export Options**: Download transcripts as JSON, Text, or Markdown
- **VSCode-Inspired UI**: Clean, dark theme interface
- **Auto Copy/Paste**: Automatically copy transcription to clipboard
- **Success Sound**: Audio feedback when transcription completes
- **Background Processing**: Queue system for file uploads
- **Comprehensive Settings**: Customize hotkeys, models, and behavior

### 🚀 Performance

- Sub-300ms transcription latency
- Memory usage under 215MB
- Optimized with CoreML support on macOS
- Ring buffer strategy for real-time processing
- Efficient chunk-based transcription

### 🔒 Privacy

- 100% local processing - no cloud dependencies
- No telemetry or tracking
- All data stored locally in SQLite database
- No internet required after model download

### 🛠 Technical Details

- Built with Tauri v2, React, and Rust
- Cross-platform audio with cpal
- Whisper integration via whisper-rs
- TypeScript frontend with Vite
- Structured logging system
- Comprehensive error handling

### 📋 System Requirements

- **macOS**: 11.0+ (Apple Silicon and Intel)
- **Windows**: 10+ (coming soon)
- **Linux**: Ubuntu 20.04+ (coming soon)
- **Memory**: 4GB RAM minimum
- **Storage**: 500MB-5GB depending on models

### 🐛 Known Issues

- Windows and Linux builds are still in development
- Large model downloads may take time on first use
- Some audio formats may require conversion

[0.1.0]: https://github.com/yourusername/scout/releases/tag/v0.1.0