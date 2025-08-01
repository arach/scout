# Scout Pipeline Overview: Audio to Text

This document provides a high-level overview of Scout's complete audio-to-text pipeline, linking the audio capture system with the transcription engine.

## Complete Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          AUDIO PIPELINE                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  Microphone → cpal → AudioRecorder → Stereo→Mono → Ring Buffer          │
│     48kHz      ↓         ↓              ↓            ↓                  │
│              Device    Levels      (L+R)/2      5min circular           │
└─────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                      FORMAT CONVERSION                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  48kHz f32 mono → Resample → 16kHz f32 mono → Whisper-ready format    │
└─────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                    TRANSCRIPTION PIPELINE                               │
├─────────────────────────────────────────────────────────────────────────┤
│  Strategy Selection → Whisper Model → Transcription → Post-Processing   │
│    Ring Buffer          tiny.en                         Filtering       │
│    or File Queue        base.en                         Clipboard       │
└─────────────────────────────────────────────────────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         OUTPUT & STORAGE                                │
├─────────────────────────────────────────────────────────────────────────┤
│  Transcript → SQLite Database → UI Display → Export (JSON/TXT/MD)       │
└─────────────────────────────────────────────────────────────────────────┘
```

## Key Pipeline Stages

### 1. Audio Capture (10-20ms latency)
- **Input:** System microphone
- **Processing:** Real-time audio stream capture
- **Output:** Raw audio samples (48kHz, stereo/mono)
- **Details:** See [AUDIO_PIPELINE.md](./AUDIO_PIPELINE.md)

### 2. Audio Processing (<1ms latency)
- **Input:** Raw audio samples
- **Processing:** Stereo-to-mono conversion, RMS level calculation (for UI display only)
- **Output:** Mono audio stream + visual level (0.0-1.0)
- **Key Features:** 
  - Automatic channel averaging for balanced audio
  - Real-time audio level monitoring for UI feedback (not VAD)

### 3. Buffering Strategy
- **Ring Buffer:** 5-minute circular buffer for live recording
- **File Queue:** Direct processing for uploaded files
- **Selection:** Automatic based on recording length and source

### 4. Format Conversion (~5ms)
- **Input:** 48kHz mono audio
- **Processing:** High-quality resampling
- **Output:** 16kHz mono audio (Whisper requirement)
- **Algorithm:** Linear interpolation with anti-aliasing

### 5. Transcription (200ms - 5s depending on length)
- **Input:** 16kHz audio chunks or complete files
- **Processing:** Whisper AI model inference
- **Output:** Raw transcript text
- **Details:** See [TRANSCRIPTION_ARCHITECTURE.md](./TRANSCRIPTION_ARCHITECTURE.md)

### 6. Post-Processing (<10ms)
- **Profanity Filtering:** Context-aware content filtering
- **Clipboard Operations:** Auto-copy/paste functionality
- **Performance Metrics:** Latency and quality tracking

### 7. Storage & Display
- **Database:** SQLite with full-text search
- **UI Updates:** Real-time transcript display
- **Export:** Multiple format support

## Latency Breakdown

### Live Recording (Ring Buffer Strategy)
```
Microphone → Buffer:        10-20ms   (hardware/driver)
Buffer → Chunk Ready:       5000ms    (5s chunks)
Chunk → Transcription:      200-500ms (model dependent)
Post-processing:            <10ms
UI Update:                  <16ms     (60fps)
─────────────────────────────────────
Total First Result:         ~5.5s
Subsequent Results:         200-500ms (parallel processing)
```

### Short Recording (Direct Processing)
```
Recording Complete:         0ms       (already in buffer)
Format Conversion:          5ms
Transcription:             200-1000ms (length dependent)
Post-processing:           <10ms
─────────────────────────────────────
Total:                     205-1015ms
```

### File Upload
```
File Read:                 10-50ms    (size dependent)
Format Detection:          <5ms
Conversion (if needed):    50-500ms   (format dependent)
Transcription:            200-5000ms  (length dependent)
─────────────────────────────────────
Total:                    265-5555ms
```

## Quality Metrics

### Audio Quality
- **Recording:** 48kHz/16-bit minimum
- **Noise Floor:** -60dB typical
- **Dynamic Range:** >90dB
- **Channel Separation:** Perfect (mono conversion)

### Transcription Accuracy
- **tiny.en:** ~39% WER (fast, <100ms)
- **base.en:** ~10% WER (balanced, ~200ms)
- **medium.en:** ~5% WER (accurate, ~500ms)

## Resource Usage

### Memory
- Audio Pipeline: ~60MB baseline
- Whisper Model: 77MB (tiny) to 1.5GB (medium)
- Transcription Buffer: ~10MB per minute of audio
- UI & Database: ~50MB

### CPU
- Audio Recording: 1-2%
- Transcription: 20-80% (model dependent)
- UI Updates: 5-10%
- Background: <1%

## Error Recovery

### Pipeline Resilience
1. **Audio Dropouts:** Ring buffer prevents data loss
2. **Device Changes:** Automatic device switching
3. **Transcription Failures:** Retry with fallback models
4. **Memory Pressure:** Old audio data automatically discarded

## Configuration

### Performance Tuning
```json
{
  "audio": {
    "buffer_size_ms": 20,        // Lower = less latency, higher CPU
    "ring_buffer_minutes": 5     // Memory vs history trade-off
  },
  "transcription": {
    "chunk_size_seconds": 5,     // Parallelism vs latency
    "model": "base.en",          // Speed vs accuracy
    "enable_gpu": true           // Platform dependent
  }
}
```

## Platform Optimizations

### macOS
- CoreML acceleration for Whisper
- CoreAudio for low-latency capture
- Metal Performance Shaders (future)

### Windows
- WASAPI for audio capture
- DirectML acceleration (future)
- CUDA support (future)

### Linux
- ALSA/PulseAudio backends
- OpenVINO acceleration (future)

---

*For detailed component documentation:*
- *Audio capture and processing: [AUDIO_PIPELINE.md](./AUDIO_PIPELINE.md)*
- *Transcription strategies: [TRANSCRIPTION_ARCHITECTURE.md](./TRANSCRIPTION_ARCHITECTURE.md)*
- *Performance analysis: [AGENT_REPORT_AUDIO_SYSTEM.md](./AGENT_REPORT_AUDIO_SYSTEM.md)*