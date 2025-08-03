# Whisper-rs Streaming Architecture Specification

## Overview

This document specifies the implementation of native whisper-rs streaming capabilities to replace Scout's current DIY file-based chunking approach. The goal is to leverage whisper-rs's built-in streaming features for lower latency, better performance, and simplified architecture.

## Current State vs Target State

### Current (File-Based) Architecture
```
Audio Hardware → AudioRecorder (48kHz stereo) → WAV File (growing, large)
                                                     ↓
                                WavFileReader → Extract 5s chunks → Whisper → Results
```

**Issues:**
- File I/O overhead for every chunk
- Large file sizes (48kHz stereo = ~384KB/sec, multi-MB for short recordings)
- Potential lag between audio and transcription
- Complex file monitoring and chunk extraction logic
- Limited by filesystem write/read performance
- Unnecessary quality overhead for speech transcription

### Target (Native Streaming) Architecture
```
Audio Hardware → AudioRecorder (16kHz mono) → Audio Stream Buffer
                                                  ↓
                                      whisper-rs streaming → Real-time Results
```

**Benefits:**
- Direct audio stream processing (no file I/O)
- **Dramatically smaller audio footprint** (16kHz mono = ~32KB/sec vs 384KB/sec)
- Lower latency transcription
- Simplified architecture (less custom code)
- Native whisper optimizations and buffering
- Optimal format for speech transcription (16kHz is whisper's native sample rate)

## Technical Specification

### 1. Whisper-rs Streaming API Investigation

**Research Requirements:**
- [ ] Analyze whisper-rs streaming capabilities and API
- [ ] Identify streaming methods vs batch processing methods
- [ ] Document buffer size requirements and optimal chunk sizes
- [ ] Test streaming vs chunking performance characteristics
- [ ] Verify Core ML acceleration compatibility with streaming

**Key Questions:**
1. Does whisper-rs support true streaming or just progressive chunking?
2. What are the minimum/maximum buffer sizes for streaming?
3. How does streaming handle voice activity detection (VAD)?
4. Can streaming emit partial results before completion?
5. Does Core ML acceleration work with streaming mode?

### 2. Audio Stream Pipeline

**Input Source:**
```rust
// Current: AudioRecorder writes to file
AudioRecorder → WAV File → WavFileReader

// Target: AudioRecorder streams to buffer
AudioRecorder → CircularBuffer<f32> → WhisperStream
```

**Buffer Management:**
- **Circular Audio Buffer**: Fixed-size ring buffer for audio samples
- **Overflow Handling**: Drop old samples when buffer is full
- **Sample Rate**: Record directly at 16kHz (whisper's native rate, no resampling needed)
- **Channels**: Record directly in mono (optimal for speech, no conversion needed)
- **File Size Reduction**: ~12x smaller files (16kHz mono vs 48kHz stereo)

### 3. Streaming Strategy Implementation

**New Strategy: `NativeStreamingTranscriptionStrategy`**

```rust
pub struct NativeStreamingTranscriptionStrategy {
    /// Direct interface to whisper-rs streaming
    whisper_stream: Arc<Mutex<WhisperStream>>,
    
    /// Circular buffer for incoming audio samples
    audio_buffer: Arc<Mutex<CircularBuffer<f32>>>,
    
    /// Stream processing configuration
    config: StreamingConfig,
    
    /// Results channel for real-time transcription
    results_tx: mpsc::Sender<TranscriptionResult>,
}

pub struct StreamingConfig {
    /// Buffer size for audio samples (default: 10 seconds for testing)
    buffer_duration_secs: u64,
    
    /// Minimum audio chunk for processing (e.g., 1-3 seconds)
    min_chunk_duration_secs: u64,
    
    /// Maximum silence before finalizing current segment
    silence_timeout_secs: u64,
    
    /// Enable voice activity detection
    vad_enabled: bool,
    
    /// Language model configuration
    language: Option<String>,
    
    /// Audio recording format (optimized for speech)
    sample_rate: u32, // 16000 Hz
    channels: u16,    // 1 (mono)
}
```

### 4. Integration with AudioRecorder

**Sample Callback Modification:**
```rust
// Instead of forwarding to file-based ring buffer
let stream_callback = Arc::new(move |samples: &[f32]| {
    // Audio is already recorded in 16kHz mono - no conversion needed!
    // This dramatically reduces processing overhead
    
    // Push directly to streaming buffer
    if let Ok(mut buffer) = audio_buffer.lock() {
        buffer.push_samples(samples);
    }
    
    // Trigger processing if buffer has enough data
    stream_processor.process_if_ready();
});
```

### 5. Real-time Processing Loop

**Streaming Worker:**
```rust
impl NativeStreamingTranscriptionStrategy {
    async fn start_streaming_worker(&self) -> Result<(), String> {
        let mut interval = tokio::time::interval(Duration::from_millis(100));
        
        loop {
            interval.tick().await;
            
            // Check if we have enough audio for processing
            if self.should_process_chunk().await? {
                let chunk = self.extract_chunk().await?;
                
                // Stream to whisper-rs (non-blocking)
                match self.process_chunk_streaming(chunk).await {
                    Ok(partial_result) => {
                        // Emit partial/incremental results
                        self.emit_partial_result(partial_result).await?;
                    }
                    Err(e) => {
                        warn!(Component::Streaming, "Chunk processing failed: {}", e);
                    }
                }
            }
        }
    }
    
    async fn process_chunk_streaming(&self, chunk: Vec<f32>) -> Result<PartialResult, String> {
        let mut whisper = self.whisper_stream.lock().await;
        
        // Feed audio to whisper stream
        whisper.feed_audio(&chunk)?;
        
        // Get any available results (may be partial)
        if let Some(result) = whisper.try_get_result()? {
            Ok(result)
        } else {
            // No complete result yet, return empty
            Ok(PartialResult::empty())
        }
    }
}
```

### 6. Voice Activity Detection (VAD)

**Integration Strategy:**
- **Option A**: Use whisper-rs built-in VAD (if available)
- **Option B**: Implement lightweight VAD before whisper streaming
- **Option C**: Use external VAD library (e.g., silero-vad)

**VAD Configuration:**
```rust
pub struct VADConfig {
    /// Minimum speech probability threshold (0.0-1.0)
    speech_threshold: f32,
    
    /// Minimum silence duration to trigger segment end
    silence_duration_ms: u64,
    
    /// Pre-speech padding (include audio before speech detected)
    pre_speech_padding_ms: u64,
    
    /// Post-speech padding (include audio after speech ends)
    post_speech_padding_ms: u64,
}
```

### 7. Performance Optimization

**Target Metrics:**
- **Latency**: < 400ms from audio input to partial transcription result
- **Memory**: < 200MB peak usage for streaming buffers  
- **CPU**: < 25% average CPU usage during continuous recording
- **File Size**: ~12x reduction (16kHz mono vs 48kHz stereo)
- **Accuracy**: Maintain or improve upon current file-based accuracy
- **Testing Window**: 10-second default buffer (configurable, practical for development)

**Optimization Strategies:**
1. **Audio Format**: Record directly in 16kHz mono (eliminates resampling/conversion overhead)
2. **Buffer Sizing**: 10-second default window (configurable for different use cases)
3. **Core ML**: Ensure streaming is compatible with Core ML acceleration
4. **Thread Management**: Dedicated thread for audio processing, separate for whisper
5. **Memory Efficiency**: Smaller buffers due to 16kHz mono format
6. **File Storage**: Dramatically reduced disk usage and I/O overhead

### 8. Fallback and Error Handling

**Graceful Degradation:**
```rust
pub enum StreamingFallback {
    /// Fall back to file-based ring buffer strategy
    FileBasedRingBuffer,
    
    /// Fall back to classic strategy (complete file processing)
    Classic,
    
    /// Disable transcription, audio recording only
    AudioOnly,
}
```

**Error Recovery:**
- **Buffer Overflow**: Drop oldest samples, continue streaming
- **Whisper Errors**: Reset whisper stream, maintain audio recording
- **Performance Issues**: Dynamically adjust buffer sizes and processing frequency

### 9. Configuration and Strategy Selection

**Strategy Selection Logic:**
```rust
pub fn select_streaming_strategy(
    config: &TranscriptionConfig,
    available_models: &[String],
    system_capabilities: &SystemCapabilities,
) -> Box<dyn TranscriptionStrategy> {
    
    // Check if whisper-rs supports streaming with available models
    if whisper_rs::supports_streaming() && config.enable_streaming {
        if let Ok(strategy) = NativeStreamingTranscriptionStrategy::new(config) {
            info!("🎯 STRATEGY SELECTION: Native whisper-rs STREAMING strategy");
            info!("📝 Streaming strategy: AudioRecorder → Audio Buffer → whisper-rs stream → Real-time results");
            info!("✅ Native streaming reduces latency and eliminates file I/O overhead");
            return Box::new(strategy);
        }
    }
    
    // Fall back to file-based approach
    info!("🎯 STRATEGY SELECTION: Falling back to file-based Ring Buffer strategy");
    // ... existing fallback logic
}
```

### 10. Testing and Validation

**Test Requirements:**
1. **Latency Tests**: Measure end-to-end latency vs file-based approach
2. **Accuracy Tests**: Compare transcription quality with current system
3. **Performance Tests**: CPU, memory, and battery usage comparisons
4. **Reliability Tests**: Long-running streaming sessions (1+ hours)
5. **Edge Case Tests**: Network issues, model switching, buffer overflows

**Test Scenarios:**
- Continuous speech (podcasts, meetings)
- Fragmented speech (short commands, interruptions)
- Background noise and multiple speakers
- Different languages and accents
- Very short utterances (< 1 second)
- Very long utterances (> 30 seconds)

### 11. Migration Strategy

**Phase 1: Research and Prototyping**
- [ ] Investigate whisper-rs streaming APIs
- [ ] Create proof-of-concept streaming implementation
- [ ] Benchmark streaming vs file-based performance

**Phase 2: Implementation**
- [ ] Implement `NativeStreamingTranscriptionStrategy`
- [ ] Integrate with existing AudioRecorder
- [ ] Add streaming configuration options

**Phase 3: Testing and Refinement**
- [ ] Comprehensive testing suite
- [ ] Performance optimization
- [ ] Error handling and fallbacks

**Phase 4: Deployment**
- [ ] Feature flag for streaming vs file-based
- [ ] Gradual rollout with monitoring
- [ ] Documentation and user guidance

## Success Criteria

**Functional Requirements:**
- [ ] Real-time transcription with < 200ms latency
- [ ] Accuracy equal to or better than current file-based approach
- [ ] Stable operation for extended sessions (2+ hours)
- [ ] Graceful handling of audio interruptions and errors

**Performance Requirements:**
- [ ] < 200MB memory usage for streaming buffers
- [ ] < 25% CPU usage during active transcription  
- [ ] ~12x file size reduction (16kHz mono vs 48kHz stereo)
- [ ] Compatible with Core ML acceleration
- [ ] Battery life impact < 5% vs current implementation
- [ ] 10-second configurable testing window for development efficiency

**Quality Requirements:**
- [ ] Clean fallback to existing strategies when streaming unavailable
- [ ] Comprehensive error handling and recovery
- [ ] Clear logging and debugging capabilities
- [ ] Maintainable and testable codebase

## Future Enhancements

**Potential Extensions:**
1. **Multi-language Streaming**: Dynamic language detection and switching
2. **Speaker Diarization**: Real-time speaker identification in streams
3. **Custom VAD Models**: Integration with advanced voice activity detection
4. **Adaptive Buffering**: Dynamic buffer sizing based on speech patterns
5. **Network Streaming**: Support for remote whisper services

---

*This specification serves as the foundation for implementing native whisper-rs streaming in Scout, replacing the current file-based chunking approach with a more efficient, lower-latency solution.*