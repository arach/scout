use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Audio chunk message sent for transcription
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioChunk {
    /// Unique identifier for this chunk
    pub id: Uuid,
    /// Raw audio data as f32 samples
    pub audio: Vec<f32>,
    /// Sample rate (e.g., 16000)
    pub sample_rate: u32,
    /// Number of channels (typically 1 for mono)
    pub channels: u16,
    /// Timestamp when the chunk was created
    pub timestamp: DateTime<Utc>,
    /// Optional metadata for the audio chunk
    pub metadata: Option<HashMap<String, String>>,
}

impl AudioChunk {
    /// Create a new audio chunk with the given parameters
    pub fn new(
        audio: Vec<f32>,
        sample_rate: u32,
        channels: u16,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            audio,
            sample_rate,
            channels,
            timestamp: Utc::now(),
            metadata: None,
        }
    }

    /// Create a new audio chunk with metadata
    pub fn with_metadata(
        audio: Vec<f32>,
        sample_rate: u32,
        channels: u16,
        metadata: HashMap<String, String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            audio,
            sample_rate,
            channels,
            timestamp: Utc::now(),
            metadata: Some(metadata),
        }
    }

    /// Get the duration of this audio chunk in seconds
    pub fn duration(&self) -> f64 {
        (self.audio.len() / self.channels as usize) as f64 / self.sample_rate as f64
    }

    /// Serialize this audio chunk to MessagePack format
    pub fn to_bytes(&self) -> Result<Vec<u8>, rmp_serde::encode::Error> {
        rmp_serde::to_vec(self)
    }

    /// Deserialize from MessagePack format
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, rmp_serde::decode::Error> {
        rmp_serde::from_slice(bytes)
    }
}

/// Transcript result returned from transcription
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transcript {
    /// Unique identifier matching the original AudioChunk
    pub id: Uuid,
    /// Transcribed text
    pub text: String,
    /// Confidence score (0.0 to 1.0)
    pub confidence: f32,
    /// Timestamp when transcription was completed
    pub timestamp: DateTime<Utc>,
    /// Optional metadata about the transcription
    pub metadata: Option<TranscriptMetadata>,
}

/// Metadata associated with a transcript
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranscriptMetadata {
    /// Language detected (ISO 639-1 code)
    pub language: Option<String>,
    /// Processing time in milliseconds
    pub processing_time_ms: Option<u64>,
    /// Model used for transcription
    pub model: Option<String>,
    /// Additional key-value metadata
    pub extra: Option<HashMap<String, String>>,
}

impl Transcript {
    /// Create a new transcript with the given parameters
    pub fn new(
        id: Uuid,
        text: String,
        confidence: f32,
    ) -> Self {
        Self {
            id,
            text,
            confidence,
            timestamp: Utc::now(),
            metadata: None,
        }
    }

    /// Create a new transcript with metadata
    pub fn with_metadata(
        id: Uuid,
        text: String,
        confidence: f32,
        metadata: TranscriptMetadata,
    ) -> Self {
        Self {
            id,
            text,
            confidence,
            timestamp: Utc::now(),
            metadata: Some(metadata),
        }
    }

    /// Serialize this transcript to MessagePack format
    pub fn to_bytes(&self) -> Result<Vec<u8>, rmp_serde::encode::Error> {
        rmp_serde::to_vec(self)
    }

    /// Deserialize from MessagePack format
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, rmp_serde::decode::Error> {
        rmp_serde::from_slice(bytes)
    }
}

/// Error types that can occur in the transcription pipeline
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionError {
    /// Unique identifier matching the original AudioChunk
    pub id: Uuid,
    /// Error message
    pub message: String,
    /// Error code for programmatic handling
    pub code: String,
    /// Timestamp when error occurred
    pub timestamp: DateTime<Utc>,
}

impl TranscriptionError {
    /// Create a new transcription error
    pub fn new(id: Uuid, message: String, code: String) -> Self {
        Self {
            id,
            message,
            code,
            timestamp: Utc::now(),
        }
    }

    /// Serialize this error to MessagePack format
    pub fn to_bytes(&self) -> Result<Vec<u8>, rmp_serde::encode::Error> {
        rmp_serde::to_vec(self)
    }

    /// Deserialize from MessagePack format
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, rmp_serde::decode::Error> {
        rmp_serde::from_slice(bytes)
    }
}

/// Worker health status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    /// Worker identifier
    pub worker_id: String,
    /// Whether the worker is healthy
    pub healthy: bool,
    /// Last heartbeat timestamp
    pub last_heartbeat: DateTime<Utc>,
    /// Additional status information
    pub info: Option<HashMap<String, String>>,
}

impl HealthStatus {
    /// Create a new health status
    pub fn new(worker_id: String, healthy: bool) -> Self {
        Self {
            worker_id,
            healthy,
            last_heartbeat: Utc::now(),
            info: None,
        }
    }

    /// Serialize this health status to MessagePack format
    pub fn to_bytes(&self) -> Result<Vec<u8>, rmp_serde::encode::Error> {
        rmp_serde::to_vec(self)
    }

    /// Deserialize from MessagePack format
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, rmp_serde::decode::Error> {
        rmp_serde::from_slice(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_audio_chunk_serialization() {
        let audio = vec![0.1, 0.2, 0.3, 0.4];
        let chunk = AudioChunk::new(audio.clone(), 16000, 1);
        
        let bytes = chunk.to_bytes().unwrap();
        let deserialized = AudioChunk::from_bytes(&bytes).unwrap();
        
        assert_eq!(chunk.audio, deserialized.audio);
        assert_eq!(chunk.sample_rate, deserialized.sample_rate);
        assert_eq!(chunk.channels, deserialized.channels);
    }

    #[test]
    fn test_transcript_serialization() {
        let id = Uuid::new_v4();
        let transcript = Transcript::new(id, "Hello world".to_string(), 0.95);
        
        let bytes = transcript.to_bytes().unwrap();
        let deserialized = Transcript::from_bytes(&bytes).unwrap();
        
        assert_eq!(transcript.id, deserialized.id);
        assert_eq!(transcript.text, deserialized.text);
        assert_eq!(transcript.confidence, deserialized.confidence);
    }

    #[test]
    fn test_audio_chunk_duration() {
        let audio = vec![0.0; 16000]; // 1 second at 16kHz
        let chunk = AudioChunk::new(audio, 16000, 1);
        
        assert_eq!(chunk.duration(), 1.0);
    }

    #[test]
    fn test_audio_chunk_with_metadata() {
        let mut metadata = HashMap::new();
        metadata.insert("source".to_string(), "microphone".to_string());
        
        let audio = vec![0.1, 0.2];
        let chunk = AudioChunk::with_metadata(audio, 16000, 1, metadata.clone());
        
        assert_eq!(chunk.metadata, Some(metadata));
    }

    #[test]
    fn test_transcript_with_metadata() {
        let id = Uuid::new_v4();
        let metadata = TranscriptMetadata {
            language: Some("en".to_string()),
            processing_time_ms: Some(250),
            model: Some("whisper-base".to_string()),
            extra: None,
        };
        
        let transcript = Transcript::with_metadata(
            id,
            "Hello world".to_string(),
            0.95,
            metadata.clone()
        );
        
        assert_eq!(transcript.metadata, Some(metadata));
    }
}