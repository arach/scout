/// # Transcription Strategies Overview
/// 
/// Scout supports multiple recording and transcription strategies, each with different
/// trade-offs between performance, reliability, and complexity.
/// 
/// ## Available Strategies
/// 
/// ### 🟢 Streaming Strategy (RECOMMENDED - WORKING)
/// - **Files**: `transcription/native_streaming_strategy.rs`, `audio/streaming_recorder_16khz.rs`, `transcription/streaming_transcriber.rs`
/// - **Status**: ✅ Working reliably
/// - **Approach**: Records at 16kHz, processes chunks in background during recording
/// - **Performance**: Fast transcription with minimal delay after recording ends
/// - **Use**: Default for most recordings
/// 
/// ### 🟡 Classic Strategy (SIMPLE - RELIABLE)
/// - **Files**: `transcription/strategy.rs::ClassicTranscriptionStrategy`, `audio/recorder.rs`
/// - **Status**: ⚠️ Audio recorder has known bugs, strategy logic is sound
/// - **Approach**: Record complete file, then transcribe when recording ends
/// - **Performance**: Slowest but most predictable
/// - **Use**: Fallback when other strategies fail
/// 
/// ### 🔴 Progressive Strategy (COMPLEX - PROBLEMATIC)
/// - **Files**: `transcription/strategy.rs::ProgressiveTranscriptionStrategy`
/// - **Status**: ❌ "Kind of does not work" - has reliability issues
/// - **Approach**: Background chunk processing during recording with quality sweep
/// - **Performance**: Should be fast but unreliable in practice
/// - **Use**: Currently disabled, needs investigation
/// 
/// ### 🔴 Ring Buffer Strategy (OVERCOMPLICATED)
/// - **Files**: `transcription/strategy.rs::RingBufferTranscriptionStrategy`, `audio/ring_buffer_recorder.rs`
/// - **Status**: ❌ "So many contraptions" - overly complex
/// - **Approach**: Ring buffer with file-based monitoring
/// - **Performance**: Theoretical benefits but practical complexity issues
/// - **Use**: Consider for deprecation
/// 
/// ## Strategy Selection Logic
/// 
/// The `TranscriptionStrategySelector` in `transcription/strategy.rs` chooses strategies based on:
/// - Recording duration estimates
/// - Available models and compute resources
/// - User preferences and settings
/// - Strategy reliability and availability
/// 
/// Currently defaults to **Streaming Strategy** for most use cases.
/// 
/// ## Maintenance Notes
/// 
/// - **Keep**: Streaming strategy - it works well
/// - **Fix**: Classic strategy recorder bugs for reliable fallback
/// - **Investigate**: Progressive strategy issues or consider removal
/// - **Consider removing**: Ring buffer strategy due to complexity
/// 
/// ## File Organization
/// 
/// While strategies span multiple files and directories, the core implementations are:
/// - Strategy logic: `transcription/strategy.rs` and `transcription/native_streaming_strategy.rs`
/// - Audio recording: `audio/` directory with various recorder implementations
/// - Supporting components: `transcription/` directory with transcribers and utilities

// Re-export main strategy components for easy access
pub use crate::transcription::strategy::{
    ClassicTranscriptionStrategy,
    RingBufferTranscriptionStrategy, 
    ProgressiveTranscriptionStrategy,
    TranscriptionStrategySelector,
    TranscriptionStrategy,
    TranscriptionResult,
    TranscriptionConfig,
};

pub use crate::transcription::native_streaming_strategy::{
    NativeStreamingTranscriptionStrategy,
    PerformanceTarget,
};

pub use crate::audio::{
    AudioRecorder,                    // Classic strategy (buggy)
    streaming_recorder_16khz::StreamingAudioRecorder16kHz,  // Streaming strategy (working)
    ring_buffer_recorder::RingBufferRecorder,              // Ring buffer strategy
};

pub use crate::transcription::{
    streaming_transcriber::StreamingTranscriber,
    file_based_ring_buffer_transcriber::FileBasedRingBufferTranscriber,
    Transcriber,
};