# Scout v0.2.0 Release Notes

## 🚀 Major Features

### Progressive Transcription (Sub-300ms Latency)
- **Instant feedback**: See your words appear as you speak using the Tiny model
- **Background refinement**: Medium model improves accuracy in the background
- **Zero wait time**: Transcript is ready immediately when you stop recording
- **85-94% latency reduction** compared to v0.1.0

### Smart Model Selection
- Progressive strategy automatically activates when both Tiny and Medium models are available
- Falls back gracefully to single-model operation if only one model is present
- Configurable via settings for users who want to force specific strategies

## ⚡ Performance Improvements

- **Latency**: Reduced from 2-5 seconds to <300ms for transcript delivery
- **CPU Usage**: Spreads processing load during recording instead of spike after
- **Memory**: Consistent 215MB usage with both models loaded
- **Chunk Processing**: Optimized 10-second refinement chunks based on benchmarks

## 🎨 UI/UX Enhancements

### New Developer Blog
- Sophisticated typography with modern, thin fonts
- Improved code block readability
- Technical deep dives on building Scout
- Future roadmap with Whisper model exploration

### Recording Experience
- Real-time waveform visualization during recording
- Progressive transcript updates visible in UI
- Smoother transitions between recording states

## 🔧 Technical Improvements

- Multi-model caching system supporting concurrent model usage
- Enhanced ring buffer implementation with sample extraction methods
- Background task cancellation for immediate response on recording stop
- Comprehensive benchmark suite for performance testing

## 🐛 Bug Fixes

- Fixed TRANSCRIBER_CACHE only supporting single model (was overwriting models)
- Resolved borrow checker issues with temp_dir handling
- Fixed async/await mismatches in strategy selection
- Corrected missing imports and method implementations

## 📦 Dependencies

- Updated to support multiple Whisper models simultaneously
- Enhanced Tauri event system for progressive updates

## 🔮 Coming Soon

Scout's progressive architecture opens up exciting possibilities:
- **Base model** (74MB) for better accuracy/speed ratio
- **Small model** (244MB) as middle ground option
- **Large-v3** (3.1GB) for maximum accuracy when needed
- Three-tier processing and adaptive model selection
- Context-aware pipelines for different use cases

## 📥 Installation

Download the latest release for your platform:
- macOS: Universal binary supports both Intel and Apple Silicon
- Windows: 64-bit installer
- Linux: AppImage and .deb packages

## 🙏 Acknowledgments

Thanks to all contributors and testers who helped make Scout faster and more responsive!