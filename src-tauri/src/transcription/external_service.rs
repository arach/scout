// This module provides integration with the external Scout Transcriber service
// The actual service runs as a separate process and communicates via ZeroMQ
// Full integration will be implemented when needed

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Configuration for the external transcription service
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalServiceConfig {
    /// Path to the transcriber binary
    pub binary_path: PathBuf,
    /// Input queue directory (for Sled mode)
    pub input_queue: PathBuf,
    /// Output queue directory (for Sled mode)
    pub output_queue: PathBuf,
    /// Number of worker processes
    pub workers: usize,
    /// Whether to manage the service process
    pub managed: bool,
    /// Poll interval for checking results
    pub poll_interval: std::time::Duration,
    /// Use ZeroMQ mode instead of Sled
    pub use_zeromq: bool,
    /// ZeroMQ push endpoint (audio input)
    pub zmq_push_port: u16,
    /// ZeroMQ pull endpoint (transcripts output)
    pub zmq_pull_port: u16,
    /// ZeroMQ control endpoint (status updates)
    pub zmq_control_port: u16,
}

impl Default for ExternalServiceConfig {
    fn default() -> Self {
        Self {
            binary_path: PathBuf::from("transcriber"),
            input_queue: PathBuf::from("/tmp/transcriber/input"),
            output_queue: PathBuf::from("/tmp/transcriber/output"),
            workers: 2,
            managed: true,
            poll_interval: std::time::Duration::from_millis(100),
            use_zeromq: true,  // Default to ZeroMQ mode
            zmq_push_port: 5555,
            zmq_pull_port: 5556,
            zmq_control_port: 5557,
        }
    }
}

// Placeholder for future full integration
// The actual communication with the external service is handled through
// the Tauri commands in src/commands/transcription.rs