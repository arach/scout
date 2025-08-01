# Changelog

All notable changes to Scout will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2025-01-08

### ✨ New Features
- Push-to-talk recording with global hotkey support
- Voice Activity Detection (VAD) for automatic recording
- VSCode-inspired UI theme with improved aesthetics
- Real-time audio level monitoring in UI
- Transcription overlay for macOS
- Settings panel with collapsible sections
- Model manager for Whisper model downloads
- LLM post-processing settings (infrastructure ready)

### 🎨 Improvements
- Complete UI overhaul with VSCode-inspired design
- Improved TypeScript type safety throughout codebase
- Better error handling and user feedback
- Enhanced performance with optimized React components
- Organized documentation structure with better naming conventions
- Added ESLint configuration for code consistency
- Cleaned up unused code and dependencies

### 🐛 Bug Fixes
- Fixed test imports and TypeScript compilation errors
- Resolved unused variable warnings in test files
- Corrected URL global assignment in test setup
- Fixed clippy warnings in Rust backend (47 issues resolved)

### 🔧 Technical Changes
- Upgraded to Tauri v2 with improved window management
- Implemented ring buffer transcription for <300ms latency
- Added CoreML support for Apple Silicon optimization
- Restructured documentation with new folder organization
- Added comprehensive test coverage for components
- Improved build scripts with proper error handling

### 📝 Documentation
- Reorganized docs folder with subdirectories for better navigation
- Renamed documentation files from ALL_CAPS to lowercase-with-hyphens
- Added comprehensive architecture documentation
- Created performance analysis and optimization guides
- Archived outdated documentation for reference

### 🔐 Security
- Tracked RSA vulnerability (RUSTSEC-2023-0071) in SECURITY.md
- Improved security best practices in code

### 🚀 Performance
- Memory usage target: <215MB
- Latency target: <300ms for transcription
- Optimized audio processing pipeline
- Efficient state management with React hooks

### 📦 Dependencies
- Updated to latest Tauri v2
- Added ESLint and TypeScript ESLint plugins
- Integrated whisper-rs with CoreML support
- Updated React to v18.3.1

### 🏗️ Infrastructure
- Added lint and typecheck npm scripts
- Improved build process for universal macOS binaries
- Enhanced development workflow with proper tooling
- Set up test infrastructure with Vitest

## [0.3.0] - Previous Release
- Initial Tauri v2 migration
- Basic recording functionality
- SQLite database integration

## [0.2.0] - Previous Release
- Improved UI design
- Enhanced audio processing

## [0.1.0] - Initial Release
- Basic audio recording
- Whisper transcription
- Simple UI