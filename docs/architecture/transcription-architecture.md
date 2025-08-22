# Scout Transcription Architecture

This document provides a comprehensive overview of Scout's dual-mode transcription system, supporting both integrated (built-in) and advanced (external service) transcription capabilities.

## Overview

Scout offers two transcription modes, each with distinct strategies:

### Transcription Modes

1. **Integrated Mode** - Built-in whisper.cpp for simple, out-of-the-box transcription
   - No additional setup required
   - Models embedded in the application
   - Suitable for most use cases

2. **Advanced Mode** - External transcriber service for enhanced capabilities
   - Supports multiple AI models (Whisper, Parakeet MLX, Hugging Face)
   - Distributed processing with worker pools
   - Better performance on Apple Silicon
   - Requires separate service installation

### Recording Strategies

Within each mode, Scout uses two recording strategies:

1. **Ring Buffer Strategy** - Real-time chunked transcription for live dictation
2. **Processing Queue Strategy** - Single-pass transcription for file uploads and batch processing

Both strategies feed into a unified post-processing pipeline that handles filtering, clipboard operations, and performance metrics.

## Recording Strategies

### 1. Ring Buffer Strategy (`ring_buffer`)

**Best for:** Live dictation, long recordings, real-time user feedback

**How it works:**
```
Audio Input → Ring Buffer (5s chunks) → Transcribe chunks in parallel → Combine results
```

**Key Components:**
- `RingBufferRecorder` - Circular audio buffer with configurable size
- `RingBufferTranscriptionStrategy` - Manages chunk processing
- `TranscriptionContext` - Coordinates strategy selection and execution

**Advantages:**
- ⚡ **Low perceived latency** - Users see results as they speak
- 🔄 **Parallel processing** - Multiple chunks transcribed simultaneously  
- 📱 **Better UX for long recordings** - Doesn't lock up the UI
- 🎯 **Memory efficient** - Only keeps recent audio in memory

**Trade-offs:**
- 🔧 **More complex** - Chunk coordination and stitching
- 🎛️ **Potential chunk boundaries** - May split words across chunks

**Configuration:**
- Chunk size: 5 seconds (configurable)
- Buffer size: 14.4M samples (5 minutes at 48kHz)
- Triggered automatically for recordings > 5 seconds

### 2. Processing Queue Strategy (`processing_queue`)

**Best for:** File uploads, batch processing, short recordings

**How it works:**
```
Audio File → Queue → Single transcription pass → Result
```

**Key Components:**
- `ProcessingQueue` - Manages job queue with retry logic
- `AudioConverter` - Handles format conversion (CAF → WAV)
- File-based processing with temporary file management

**Advantages:**
- 🎯 **Simple and reliable** - Single transcription pass
- 📁 **File format flexibility** - Supports various input formats
- 🔄 **Retry logic** - Handles failures gracefully
- 📊 **Complete metadata** - Full file information available

**Trade-offs:**
- ⏱️ **Higher perceived latency** - Must wait for complete transcription
- 💾 **Memory usage** - Loads entire file for processing
- 🚫 **No real-time feedback** - Results only available after completion

## Strategy Selection

**Automatic selection logic:**
```rust
if recording_duration > 5s && chunking_enabled {
    use ring_buffer_strategy
} else {
    use processing_queue_strategy  
}
```

**Manual override available** via `TranscriptionContext::force_strategy()`

## Post-Processing Pipeline

After transcription completes, all strategies feed into a unified post-processing pipeline:

### 1. Post-Processing Hooks (`PostProcessingHooks`)

**Location:** `src/post_processing.rs`

**Responsibilities:**
- Content filtering (profanity/hallucination detection)
- Auto-copy to clipboard
- Auto-paste functionality
- Performance metrics coordination

**Data flow:**
```
Transcript → Profanity Filter → Clipboard Operations → Performance Metrics → Database
```

### 2. Profanity Filter (`ProfanityFilter`)

**Location:** `src/profanity_filter.rs`

**Features:**
- **Hallucination detection** - Identifies Whisper AI artifacts
- **Context analysis** - Preserves intentional profanity
- **Pattern matching** - Detects repetitive nonsense phrases
- **Configurable filtering** - Normal vs aggressive modes

**Output:**
- Filtered transcript (for auto-paste/storage)
- Original transcript (preserved in metadata)
- Analysis logs (for transparency)

### 3. Performance Metrics Service (`PerformanceMetricsService`)

**Location:** `src/performance_metrics_service.rs`

**Tracks:**
- 📊 **Transcription speed** (e.g., "2.5x real-time")
- ⏱️ **User-perceived latency**
- 🏗️ **Strategy used** (ring_buffer vs processing_queue)
- 📁 **File metadata** (size, format, model)
- 🧩 **Chunks processed** (for ring buffer)

**Analysis:**
- Performance warnings for slow transcription
- Strategy recommendations based on recording characteristics
- Model performance comparisons

## Data Flow Diagrams

### Ring Buffer Strategy Flow
```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Microphone│    │ Ring Buffer │    │   Chunk 1   │
│    Input    │───▶│  Recorder   │───▶│Transcription│
└─────────────┘    └─────────────┘    └─────────────┘
                         │                    │
                         ▼                    ▼
                   ┌─────────────┐    ┌─────────────┐
                   │   Chunk 2   │    │   Combine   │
                   │Transcription│───▶│   Results   │
                   └─────────────┘    └─────────────┘
                                             │
                                             ▼
                                    ┌─────────────┐
                                    │Post Process │
                                    │   Pipeline  │
                                    └─────────────┘
```

### Processing Queue Strategy Flow
```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Audio File │    │ Conversion  │    │   Queue     │
│   Upload    │───▶│   (if req'd)│───▶│  Manager    │
└─────────────┘    └─────────────┘    └─────────────┘
                                             │
                                             ▼
                                    ┌─────────────┐
                                    │Single-Pass  │
                                    │Transcription│
                                    └─────────────┘
                                             │
                                             ▼
                                    ┌─────────────┐
                                    │Post Process │
                                    │   Pipeline  │
                                    └─────────────┘
```

### Post-Processing Pipeline
```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Raw        │    │ Profanity   │    │  Filtered   │
│ Transcript  │───▶│   Filter    │───▶│ Transcript  │
└─────────────┘    └─────────────┘    └─────────────┘
                                             │
                                             ▼
                                    ┌─────────────┐
                                    │  Clipboard  │
                                    │ Operations  │
                                    └─────────────┘
                                             │
                                             ▼
                                    ┌─────────────┐
                                    │Performance  │
                                    │  Metrics    │
                                    └─────────────┘
                                             │
                                             ▼
                                    ┌─────────────┐
                                    │  Database   │
                                    │   Storage   │
                                    └─────────────┘
```

## Database Schema

### Transcripts Table
```sql
CREATE TABLE transcripts (
    id INTEGER PRIMARY KEY,
    text TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,  -- JSON with original_transcript, filter_analysis, etc.
    audio_path TEXT,
    file_size INTEGER
);
```

### Performance Metrics Table
```sql
CREATE TABLE performance_metrics (
    id INTEGER PRIMARY KEY,
    transcript_id INTEGER,
    recording_duration_ms INTEGER NOT NULL,
    transcription_time_ms INTEGER NOT NULL,
    user_perceived_latency_ms INTEGER,
    processing_queue_time_ms INTEGER,
    model_used TEXT,
    transcription_strategy TEXT,
    audio_file_size_bytes INTEGER,
    audio_format TEXT,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,  -- JSON with strategy-specific data
    FOREIGN KEY (transcript_id) REFERENCES transcripts (id)
);
```

## Key Files & Modules

### Core Strategy Files
- `src/recording_workflow.rs` - Orchestrates recording and strategy selection
- `src/transcription_context.rs` - Strategy management and coordination
- `src/transcription/strategy.rs` - Strategy trait definitions
- `src/processing_queue.rs` - File-based processing queue

### Ring Buffer Components
- `src/audio/ring_buffer_recorder.rs` - Circular audio buffer
- `src/ring_buffer_monitor.rs` - Monitors buffer state
- `src/transcription/ring_buffer_transcriber.rs` - Chunk processing

### Post-Processing
- `src/post_processing.rs` - Unified post-processing hooks
- `src/profanity_filter.rs` - Content filtering and analysis
- `src/performance_metrics_service.rs` - Performance tracking
- `src/clipboard.rs` - Auto-copy/paste functionality

### Database & Storage
- `src/db/mod.rs` - Database operations
- `migrations/` - Schema evolution

## Performance Characteristics

### Ring Buffer Strategy
- **Latency:** 200-500ms for first results
- **Memory:** ~150MB for 5-minute buffer
- **CPU:** Parallel chunk processing (higher initial load)
- **UX:** Excellent for long dictation sessions

### Processing Queue Strategy  
- **Latency:** 1-5s depending on file size and model
- **Memory:** 50-200MB depending on file size
- **CPU:** Single burst, then idle
- **UX:** Better for short recordings or file uploads

## Configuration

### Settings (`settings.json`)
```json
{
  "transcription": {
    "mode": "integrated",  // "integrated" (Whisper) or "advanced" (External)
    "model": "tiny.en",
    "language": "en",
    "external": {
      "enabled": false,
      "host": "127.0.0.1",
      "port": 5556,
      "workers": 2
    }
  },
  "audio": {
    "vad_enabled": false,
    "min_recording_duration_ms": 500
  },
  "ui": {
    "auto_copy": true,
    "auto_paste": true,
    "profanity_filter_enabled": true,
    "profanity_filter_aggressive": false
  },
  "processing": {
    "max_queue_size": 100,
    "max_retries": 30
  }
}
```

### Mode Selection and Configuration

#### Integrated Mode (Default)
- **When to use**: Simple dictation needs, no additional setup desired
- **Models**: Whisper tiny, base, small, medium, large
- **Processing**: Single-threaded, sequential
- **Memory**: 50-1500MB depending on model
- **Latency**: 200-500ms for first results

#### Advanced Mode (External Service)
- **When to use**: 
  - Need for faster transcription
  - Want to use specialized models (Parakeet for Apple Silicon)
  - Require parallel processing of multiple recordings
  - Building production applications with high throughput needs
- **Models**: 
  - OpenAI Whisper (all sizes)
  - NVIDIA Parakeet MLX (optimized for M1/M2/M3)
  - Hugging Face models (whisper-large-v3-turbo)
  - Custom fine-tuned models
- **Processing**: Multi-threaded with worker pools
- **Memory**: ~500MB base + 200MB per worker
- **Latency**: <200ms with optimized models
- **Architecture**: Queue-based with ZeroMQ or Sled backend

Mode switching is managed through the Settings UI. See [Settings Management Architecture](./settings-management.md) for implementation details.

### Model Selection
- **tiny.en** - Fastest, lower accuracy (~77MB)
- **base.en** - Balanced performance
- **medium.en** - Higher accuracy, slower (~1.5GB)

## External Service Architecture

When running in Advanced Mode, Scout delegates transcription to an external service:

### Service Components

```
┌─────────────────┐        ┌──────────────────┐        ┌─────────────────┐
│   Scout App     │        │ Service Manager  │        │ Python Workers  │
│                 │        │                  │        │                 │
│ AudioChunk ─────▶        │  Rust Core       │        │ • Whisper      │
│ Transcript ◀─────        │  • Process Mgmt │        │ • Parakeet MLX │
│                 │        │  • Queue Ops    │        │ • HuggingFace  │
└─────────────────┘        └──────────────────┘        └─────────────────┘
       │                            │                          │
       └────────────────────────────┬──────────────────────────┘
                                    │
                          ┌─────────┴─────────┐
                          │   Message Queue   │
                          │ (ZeroMQ or Sled)  │
                          └───────────────────┘
```

### Key Technologies

1. **Message Queues**:
   - **Sled**: Persistent, local queues with ACID guarantees
   - **ZeroMQ**: Distributed messaging for cross-language communication

2. **Serialization**:
   - **MessagePack**: Efficient binary serialization
   - 2-3x smaller than JSON
   - Native support for audio buffers

3. **Process Management**:
   - Automatic worker spawning and monitoring
   - Health checks with exponential backoff
   - Graceful degradation on failures

4. **Python Environment**:
   - **UV**: Modern Python package manager
   - Automatic dependency resolution
   - Isolated environments per model

### Performance Characteristics

| Mode | Model | 30s Audio | RTF* | Memory | Latency |
|------|-------|-----------|------|--------|----------|
| Integrated | Whisper Base | 2.5s | 0.08x | 150MB | 300ms |
| Advanced | Whisper Base | 1.8s | 0.06x | 200MB | 200ms |
| Advanced | Parakeet 0.6B | 0.9s | 0.03x | 1.2GB | 150ms |
| Advanced | HF Large-v3-turbo | 1.2s | 0.04x | 2GB | 180ms |

*RTF = Real-Time Factor (lower is better)

### Installation and Setup

1. **Install the service**:
   ```bash
   # Clone and build
   cd transcriber/
   cargo build --release --features zeromq-queue
   ```

2. **Configure Scout**:
   - Open Settings → Transcription
   - Switch to "Advanced Mode"
   - Configure ports and workers
   - Test connection

3. **Run as a service** (optional):
   ```bash
   # Install as macOS LaunchAgent
   ./install-service.sh
   ```

## Future Enhancements

### Near-term (Q1 2025)
1. **Streaming Transcription** - Real-time partial results via WebSockets
2. **Multi-Language Detection** - Automatic language switching
3. **Custom Model Support** - UI for loading fine-tuned models
4. **GPU Acceleration** - CUDA/Metal performance shaders

### Medium-term (Q2-Q3 2025)
1. **Distributed Processing** - Multi-machine worker pools
2. **Model Caching** - Smart model loading based on usage patterns
3. **Adaptive Quality** - Automatic model selection based on audio quality
4. **Cloud Integration** - Optional cloud processing for heavy workloads

### Long-term
1. **Plugin Architecture** - Third-party transcription providers
2. **Real-time Translation** - Live translation during transcription
3. **Speaker Diarization** - Multi-speaker identification
4. **Emotion Detection** - Sentiment and emotion analysis

---

*This architecture supports Scout's goal of sub-300ms latency with local-first privacy while maintaining high transcription accuracy across diverse use cases.*