# Scout v0.2.0 - Progressive Transcription

## ⚡ Sub-300ms Transcription is Here

No more waiting. No more spinners. Scout now shows your words as you speak them.

### 🎯 Key Features

**Progressive Transcription**
- See text appear instantly using the Tiny model (39MB)
- Background refinement with Medium model (1.5GB) for accuracy
- Smart fallback if only one model is available
- 85-94% reduction in perceived latency

**How It Works**
1. Tiny model processes 5-second chunks in real-time
2. Medium model refines 10-second chunks in background
3. When you stop recording, transcript is ready instantly
4. Zero post-processing delay

### 📊 Performance Improvements

- **Before**: 2-5 seconds wait after recording
- **After**: <300ms to see final transcript
- **CPU**: Better distributed (40-60% during vs 100% spike after)
- **Memory**: Only +5MB for dual-model support

### 💾 Download

**Scout-v0.2.0.dmg** (11MB)
- macOS 11.0 or later
- Universal binary (Intel + Apple Silicon)

### 🚀 Getting Started

1. Download and install Scout-v0.2.0.dmg
2. Download both Tiny and Medium models for progressive transcription:
   ```bash
   ./scripts/download-models.sh
   ```
3. Start dictating with near-zero latency!

### 📝 What's Changed

**New Features**
- Progressive dual-model transcription system
- Engineering blog with technical deep dives
- Smart model detection and fallback
- Real-time transcript updates during recording

**Bug Fixes**
- Fixed model cache supporting only single model
- Resolved async/await mismatches
- Corrected borrow checker issues
- Fixed missing imports

**Full Changelog**: [v0.1.0...v0.2.0](https://github.com/arach/scout/compare/v0.1.0...v0.2.0)

### 🔮 What's Next

We're exploring more model combinations:
- Base (74MB) for better speed/accuracy balance
- Small (244MB) for mid-tier option
- Large-v3 (3.1GB) for maximum accuracy
- Context-aware model selection

### 📖 Learn More

Read about the technical implementation on our [engineering blog](https://arach.github.io/scout/blog/progressive-transcription-300ms).

---

**Note**: Progressive transcription requires both Tiny and Medium models. Scout will automatically fall back to single-model operation if only one is available.