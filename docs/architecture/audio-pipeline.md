# Scout Audio Pipeline Architecture

This document provides a comprehensive overview of Scout's audio capture and processing pipeline, from microphone input to the transcription engine.

## Overview

Scout's audio pipeline is optimized for speech transcription with minimal file sizes and maximum efficiency. As of v0.3.0, the pipeline uses 16kHz mono recording when supported by the device, reducing file sizes by ~12x while maintaining perfect quality for speech transcription.

### Key Optimizations (v0.3.0+)
- **Direct 16kHz mono capture**: No post-processing needed
- **12x smaller files**: 750KB vs 9MB for 25 seconds
- **66% less memory**: Ring buffer reduced to 19.2MB
- **Lower CPU usage**: No real-time conversion needed
- **Fallback support**: Gracefully handles devices without 16kHz mono

## Audio Pipeline Flow

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Microphone │    │    cpal     │    │   Audio     │    │    Ring     │
│    Input    │───▶│   Stream    │───▶│  Recorder   │───▶│   Buffer    │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                         │                    │                    │
                         ▼                    ▼                    ▼
                   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
                   │   Device    │    │Stereo→Mono  │    │  Whisper    │
                   │   Config    │    │ Conversion  │    │   Engine    │
                   └─────────────┘    └─────────────┘    └─────────────┘
```

## Components

### 1. Audio Capture Layer (`cpal`)

**Purpose:** Cross-platform audio device access and stream management

**Key Features:**
- Automatic device enumeration and selection
- Support for multiple sample formats (i16, f32)
- Configurable buffer sizes and sample rates
- Real-time audio callback system

**Configuration:**
```rust
// Optimized speech configuration (as of v0.3.0)
sample_rate: 16000 Hz (when supported, otherwise device default)
channels: 1 (mono for optimal file size)
buffer_size: Default (platform-specific)
```

### 2. AudioRecorder (`src/audio/recorder.rs`)

**Purpose:** High-level audio recording interface with format handling

**Key Responsibilities:**
- Device management and configuration
- Stream lifecycle (start/stop/pause)
- Automatic stereo-to-mono conversion
- Sample format normalization
- Real-time audio level monitoring

**Audio Flow:**
1. **Input Stream Creation** (`build_input_stream`)
   - Detects device capabilities
   - Configures optimal format
   - Sets up audio callback

2. **Sample Processing** (in callback)
   ```rust
   // Direct mono recording when device supports it
   // No conversion needed - already optimized at capture
   // Falls back to device native format if needed
   ```

3. **Output Distribution**
   - WAV file writer (optional)
   - Ring buffer for real-time processing
   - Audio level meter updates

### 3. Ring Buffer System

**Purpose:** Circular buffer for continuous audio capture without memory growth

**Architecture:**
```
┌─────────────────────────────────────┐
│         Ring Buffer (5 min)         │
│  ┌───┬───┬───┬───┬───┬───┬───┐    │
│  │ 5s│ 5s│ 5s│ 5s│ 5s│...│   │    │
│  └───┴───┴───┴───┴───┴───┴───┘    │
│         ↑ write pointer             │
└─────────────────────────────────────┘
```

**Key Features:**
- Fixed-size buffer (5 minutes @ 16kHz mono = ~19.2MB)
- Lock-free write operations
- Chunk-based reading for transcription
- Automatic old data overwriting
- 66% memory reduction with optimized format

### 4. Voice Activity Detection (VAD)

**Status:** Not implemented (planned feature)

**Current State:**
- Manual recording control only (push-to-talk)
- Metadata structure prepared for VAD (`vad_enabled` field)
- No threshold-based detection implemented

**Planned Implementation:**
- Energy-based detection (RMS threshold)
- Configurable sensitivity
- Silence padding for natural speech boundaries
- WebRTC VAD integration

### 5. Audio Format Conversion

**Purpose:** Ensure compatibility with Whisper transcription engine

**Conversion Pipeline:**
```
Input Format → Normalize to f32 → Resample to 16kHz → Mono conversion → Whisper
```

**Key Operations:**
- Sample rate conversion (48kHz → 16kHz)
- Bit depth normalization
- Channel downmixing
- Format validation

## Audio Quality Considerations

### Sample Rate Strategy
- **Recording:** 16kHz mono (when device supports it)
- **Fallback:** Device default rate if 16kHz not supported
- **Transcription:** 16kHz (Whisper native rate)
- **Rationale:** Direct 16kHz recording reduces file size by ~12x without quality loss for speech

### Channel Configuration
- **Preferred:** Direct mono recording (optimal for speech)
- **Fallback:** Device native channels if mono not supported
- **File Size:** Mono reduces storage by 50% vs stereo
- **Quality:** No loss for speech transcription use case

### Buffer Sizes
- **Low Latency:** Small buffers (256-512 samples)
- **Stability:** Larger buffers (1024-2048 samples)
- **Trade-off:** Latency vs dropout prevention

## Performance Characteristics

### Latency Breakdown
```
Microphone → cpal buffer:      ~10-20ms
cpal → AudioRecorder:          <1ms
AudioRecorder → Ring Buffer:   <1ms
Ring Buffer → Chunk ready:     ~5s (configurable)
Total audio pipeline latency:  ~10-20ms + chunk time
```

### Memory Usage
- Ring Buffer: ~19.2MB (5 min @ 16kHz mono)
- Audio processing buffers: ~1-2MB
- Device stream overhead: ~1MB
- Total: ~22MB baseline (66% reduction from 48kHz)

### CPU Usage
- Audio callback: <1% (typical)
- No conversion needed (direct mono capture)
- Ring buffer operations: <0.5%
- Total: <1% during recording (optimized)

## Error Handling

### Device Failures
- Automatic fallback to default device
- Graceful handling of device disconnection
- Clear error messages for permissions

### Format Mismatches
- Automatic format negotiation
- Sample rate conversion when needed
- Channel configuration flexibility

### Buffer Overruns
- Ring buffer prevents memory growth
- Old data automatically discarded
- No recording interruption

## Platform-Specific Considerations

### macOS
- CoreAudio backend via cpal
- Automatic aggregate device handling
- Permissions: Microphone access required

### Windows
- WASAPI backend (low latency)
- Automatic format conversion
- Exclusive mode support (future)

### Linux
- ALSA/PulseAudio backends
- Jack support (future)
- Flexible device selection

## Integration with Transcription

The audio pipeline feeds directly into the transcription system:

1. **Ring Buffer Strategy** - For live recordings
   - 5-second chunks extracted from ring buffer
   - Parallel transcription of chunks
   - See [TRANSCRIPTION_ARCHITECTURE.md](./TRANSCRIPTION_ARCHITECTURE.md)

2. **File Processing** - For uploads
   - Direct file reading
   - Format conversion as needed
   - Single-pass transcription

## Configuration Options

### User Settings
```json
{
  "audio": {
    "input_device": "default",
    "vad_enabled": false,
    "vad_threshold": 0.01,
    "min_recording_duration_ms": 500
  }
}
```

### Developer Settings
```rust
// In AudioRecorder (v0.3.0+)
const RING_BUFFER_SECONDS: f32 = 300.0;  // 5 minutes
const OPTIMAL_SAMPLE_RATE: u32 = 16000;  // Direct capture at Whisper rate
const OPTIMAL_CHANNELS: u16 = 1;         // Mono for speech
const BITS_PER_SAMPLE: u16 = 16;         // 16-bit PCM

// File size calculation:
// 16kHz * 1 channel * 2 bytes = 32KB/s (vs 384KB/s for 48kHz stereo 32-bit)
```

## Future Enhancements

### Planned Improvements
1. **Hardware Acceleration**
   - CoreAudio optimizations (macOS)
   - WASAPI exclusive mode (Windows)
   - GPU-based resampling

2. **Advanced VAD**
   - WebRTC VAD integration
   - ML-based speech detection
   - Speaker diarization

3. **Multi-Channel Support**
   - Preserve stereo for music transcription
   - Multi-microphone arrays
   - Spatial audio processing

4. **Streaming Pipeline**
   - WebSocket audio streaming
   - Real-time transcription feedback
   - Cloud processing option

## Debugging & Monitoring

### Debug Logging
```rust
// Enable with RUST_LOG=scout=debug
[DEBUG] AudioRecorder: Device "MacBook Pro Microphone" selected
[DEBUG] AudioRecorder: Format - 48000Hz, 2 channels, F32
[DEBUG] AudioRecorder: Converting stereo to mono in callback
[DEBUG] RingBuffer: Writing 2400 samples
```

### Performance Metrics
- Audio callback timing
- Buffer fill levels
- Dropout detection
- Format conversion overhead

### Health Checks
- Device availability
- Permission status
- Buffer health
- Stream stability

---

*This audio pipeline architecture ensures high-quality, low-latency audio capture while maintaining compatibility with Scout's real-time transcription requirements.*