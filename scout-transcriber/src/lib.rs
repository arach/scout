//! Scout Transcriber - A standalone transcription service
//! 
//! This crate provides a high-performance, standalone transcription service that uses
//! Python workers for audio transcription. It features:
//! 
//! - Sled-based message queues for reliable audio/transcript handling
//! - MessagePack serialization for efficient data transfer
//! - Python subprocess management with automatic restarts
//! - UUID-based message correlation
//! - Health monitoring and statistics
//! 
//! # Example
//! 
//! ```rust
//! use scout_transcriber::{
//!     protocol::{AudioChunk, Transcript},
//!     queue::{Queue, SledQueue},
//!     worker::{PythonWorker, WorkerConfig},
//! };
//! use std::time::Duration;
//! 
//! #[tokio::main]
//! async fn main() -> anyhow::Result<()> {
//!     // Create input and output queues
//!     let input_queue = SledQueue::<AudioChunk>::new_temp()?;
//!     let output_queue = SledQueue::<Transcript>::new_temp()?;
//!     
//!     // Create and start a worker
//!     let config = WorkerConfig::default();
//!     let worker = PythonWorker::new(config);
//!     worker.start().await?;
//!     
//!     // Push audio data for transcription
//!     let audio_chunk = AudioChunk::new(vec![0.1, 0.2, 0.3], 16000, 1);
//!     worker.transcribe(audio_chunk).await?;
//!     
//!     // Worker processes audio and produces transcripts
//!     // (In practice, you'd poll the output queue for results)
//!     
//!     worker.stop().await?;
//!     Ok(())
//! }
//! ```

pub mod protocol;
pub mod queue;
pub mod tracker;
pub mod worker;

// Re-export commonly used types for convenience
pub use protocol::{AudioChunk, Transcript, TranscriptionError, HealthStatus, TranscriptMetadata};
pub use queue::{Queue, SledQueue, IndexedSledQueue, QueueStats};
pub use worker::{PythonWorker, WorkerConfig, WorkerPool, WorkerStats};

// Error types
use thiserror::Error;

/// Errors that can occur in the scout-transcriber system
#[derive(Error, Debug)]
pub enum ScoutTranscriberError {
    /// Queue operation failed
    #[error("Queue error: {0}")]
    Queue(#[from] anyhow::Error),
    
    /// Worker management error
    #[error("Worker error: {message}")]
    Worker { message: String },
    
    /// Serialization/deserialization error
    #[error("Serialization error: {0}")]
    Serialization(#[from] rmp_serde::encode::Error),
    
    /// Deserialization error
    #[error("Deserialization error: {0}")]
    Deserialization(#[from] rmp_serde::decode::Error),
    
    /// I/O error
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    
    /// UUID parsing error
    #[error("UUID error: {0}")]
    Uuid(#[from] uuid::Error),
}

/// Result type alias for scout-transcriber operations
pub type Result<T> = std::result::Result<T, ScoutTranscriberError>;

/// Version information
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const NAME: &str = env!("CARGO_PKG_NAME");

/// Default queue paths
pub const DEFAULT_INPUT_QUEUE_PATH: &str = "/tmp/scout-transcriber/input";
pub const DEFAULT_OUTPUT_QUEUE_PATH: &str = "/tmp/scout-transcriber/output";

/// Utility functions for common operations
pub mod utils {
    use crate::protocol::AudioChunk;
    use uuid::Uuid;
    
    /// Create a test audio chunk with the specified duration in seconds
    pub fn create_test_audio_chunk(duration_seconds: f64, sample_rate: u32) -> AudioChunk {
        let samples = (duration_seconds * sample_rate as f64) as usize;
        let audio: Vec<f32> = (0..samples)
            .map(|i| (i as f32 / sample_rate as f32 * 440.0 * 2.0 * std::f32::consts::PI).sin() * 0.1)
            .collect();
        
        AudioChunk::new(audio, sample_rate, 1)
    }
    
    /// Validate audio chunk parameters
    pub fn validate_audio_chunk(chunk: &AudioChunk) -> bool {
        chunk.sample_rate > 0 && 
        chunk.channels > 0 && 
        !chunk.audio.is_empty() &&
        chunk.audio.len() % chunk.channels as usize == 0
    }
    
    /// Calculate audio chunk size in bytes
    pub fn audio_chunk_size_bytes(chunk: &AudioChunk) -> usize {
        std::mem::size_of::<f32>() * chunk.audio.len()
    }
    
    /// Generate a correlation ID for tracking requests
    pub fn generate_correlation_id() -> Uuid {
        Uuid::new_v4()
    }
}

/// High-level client for interacting with the transcription service
pub struct TranscriberClient {
    input_queue: SledQueue<AudioChunk>,
    output_queue: SledQueue<std::result::Result<Transcript, TranscriptionError>>,
}

impl TranscriberClient {
    /// Create a new transcriber client with default queue paths
    pub fn new() -> Result<Self> {
        Self::with_paths(DEFAULT_INPUT_QUEUE_PATH, DEFAULT_OUTPUT_QUEUE_PATH)
    }
    
    /// Create a new transcriber client with custom queue paths
    pub fn with_paths(input_path: &str, output_path: &str) -> Result<Self> {
        let input_queue = SledQueue::new(input_path)?;
        let output_queue = SledQueue::new(output_path)?;
        
        Ok(Self {
            input_queue,
            output_queue,
        })
    }
    
    /// Submit an audio chunk for transcription
    pub async fn transcribe(&self, audio_chunk: AudioChunk) -> Result<()> {
        self.input_queue.push(&audio_chunk).await?;
        Ok(())
    }
    
    /// Poll for transcription results
    pub async fn poll_results(&self) -> Result<Option<std::result::Result<Transcript, TranscriptionError>>> {
        match self.output_queue.pop().await? {
            Some(result) => Ok(Some(result)),
            None => Ok(None),
        }
    }
    
    /// Get queue statistics
    pub async fn get_queue_stats(&self) -> Result<(usize, usize)> {
        let input_len = self.input_queue.len().await?;
        let output_len = self.output_queue.len().await?;
        Ok((input_len, output_len))
    }
    
    /// Clear all queues
    pub async fn clear_queues(&self) -> Result<()> {
        self.input_queue.clear().await?;
        self.output_queue.clear().await?;
        Ok(())
    }
}

impl Default for TranscriberClient {
    fn default() -> Self {
        Self::new().expect("Failed to create default TranscriberClient")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::*;
    
    #[test]
    fn test_version_constants() {
        assert!(!VERSION.is_empty());
        assert_eq!(NAME, "scout-transcriber");
    }
    
    #[test]
    fn test_create_test_audio_chunk() {
        let chunk = create_test_audio_chunk(1.0, 16000);
        assert_eq!(chunk.sample_rate, 16000);
        assert_eq!(chunk.channels, 1);
        assert_eq!(chunk.audio.len(), 16000);
        assert!(validate_audio_chunk(&chunk));
    }
    
    #[test]
    fn test_audio_chunk_validation() {
        let valid_chunk = AudioChunk::new(vec![0.1, 0.2, 0.3], 16000, 1);
        assert!(validate_audio_chunk(&valid_chunk));
        
        let invalid_chunk = AudioChunk {
            id: uuid::Uuid::new_v4(),
            audio: vec![],
            sample_rate: 0,
            channels: 0,
            timestamp: chrono::Utc::now(),
            metadata: None,
        };
        assert!(!validate_audio_chunk(&invalid_chunk));
    }
    
    #[test]
    fn test_audio_chunk_size_calculation() {
        let chunk = AudioChunk::new(vec![0.0; 1000], 16000, 1);
        let size = audio_chunk_size_bytes(&chunk);
        assert_eq!(size, 1000 * std::mem::size_of::<f32>());
    }
    
    #[tokio::test]
    async fn test_transcriber_client_creation() {
        // Test creation should work (using temp queues)
        let result = TranscriberClient::with_paths(
            "/tmp/test-input-scout-transcriber",
            "/tmp/test-output-scout-transcriber"
        );
        assert!(result.is_ok());
    }
}
