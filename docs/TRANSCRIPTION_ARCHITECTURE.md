# Scout Transcription Architecture

This document outlines the two recording strategies and processing pipeline components in Scout's transcription system.

## Overview

Scout uses two distinct transcription strategies optimized for different use cases:

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

### Model Selection
- **tiny.en** - Fastest, lower accuracy (~77MB)
- **base.en** - Balanced performance
- **medium.en** - Higher accuracy, slower (~1.5GB)

## Future Enhancements

### Potential Improvements
1. **Hybrid Strategy** - Start with ring buffer, fall back to single-pass
2. **Adaptive Chunk Sizing** - Adjust based on speech patterns
3. **Model Auto-Selection** - Choose model based on performance requirements
4. **Streaming Transcription** - Real-time partial results
5. **Multi-Language Support** - Language detection and switching

### Monitoring & Observability
1. **Performance Dashboard** - Real-time metrics visualization
2. **Strategy Analytics** - Usage patterns and optimization opportunities  
3. **Error Tracking** - Failure modes and recovery patterns
4. **Model Comparison** - A/B testing different Whisper models

---

*This architecture supports Scout's goal of sub-300ms latency with local-first privacy while maintaining high transcription accuracy across diverse use cases.*