# Scout v0.4.0 Release Notes

## 🎉 Major Release: VSCode-Inspired UI & Push-to-Talk

Scout 0.4.0 brings a complete UI overhaul inspired by VSCode's design language, along with powerful new features for better voice transcription control.

### ✨ Key Features

**🎙️ Push-to-Talk Recording**
- Hold a global hotkey to record only while pressed
- Perfect for quick voice notes without manual start/stop
- Configurable hotkey (default: Cmd+Space on macOS)

**🎨 VSCode-Inspired Interface**
- Modern, clean design with dark theme
- Collapsible settings sections for better organization
- Real-time audio level visualization
- Improved typography and spacing

**🔊 Voice Activity Detection (VAD)**
- Automatically detects when you're speaking
- Reduces silent periods in recordings
- Improves transcription accuracy

**⚡ Performance Improvements**
- <300ms transcription latency with ring buffer architecture
- Memory usage optimized to <215MB
- CoreML support for Apple Silicon Macs

### 🛠️ Technical Improvements

- **TypeScript**: Enhanced type safety throughout the codebase
- **Testing**: Comprehensive test coverage with Vitest
- **Linting**: ESLint configuration for consistent code quality
- **Documentation**: Reorganized docs with better structure

### 🐛 Bug Fixes

- Fixed test import paths
- Resolved 47 Rust clippy warnings
- Corrected TypeScript compilation errors
- Improved error handling throughout

### 📦 Installation

Download the DMG file for macOS (Apple Silicon or Intel):
- `Scout_0.4.0_aarch64.dmg` - For Apple Silicon Macs (M1/M2/M3)
- `Scout_0.4.0_x86_64.dmg` - For Intel Macs

**Note**: First-time users need to download Whisper models:
```bash
./scripts/download-models.sh
```

### 🔐 Security Note

We're tracking a medium-severity RSA vulnerability (RUSTSEC-2023-0071) in our dependencies. This will be addressed in a future update.

### 🚀 What's Next

- Universal binary support for macOS
- Windows and Linux builds
- Cloud sync for transcripts
- More Whisper model options
- Plugin system for custom workflows

### 🙏 Acknowledgments

Thank you to all contributors and testers who helped make this release possible!

---

**Full Changelog**: [v0.3.0...v0.4.0](https://github.com/yourusername/scout/compare/v0.3.0...v0.4.0)