use async_trait::async_trait;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use crate::audio::WhisperAudioConverter;
use crate::logger::{debug, info, warn, Component};
use crate::settings::ExternalServiceConfig;
use crate::transcription::strategy::{TranscriptionConfig, TranscriptionResult, TranscriptionStrategy};

/// Strategy that delegates transcription to the external service via ZeroMQ
pub struct ExternalServiceStrategy {
    config: ExternalServiceConfig,
    recording_path: Option<PathBuf>,
    start_time: Option<std::time::Instant>,
}

impl ExternalServiceStrategy {
    pub fn new(config: ExternalServiceConfig) -> Self {
        Self {
            config,
            recording_path: None,
            start_time: None,
        }
    }
}

#[async_trait]
impl TranscriptionStrategy for ExternalServiceStrategy {
    fn name(&self) -> &str {
        "ExternalService"
    }

    fn can_handle(
        &self,
        _duration_estimate: Option<Duration>,
        _config: &TranscriptionConfig,
    ) -> bool {
        // Can handle any recording when external service is enabled
        self.config.enabled
    }

    async fn start_recording(
        &mut self,
        output_path: &Path,
        _config: &TranscriptionConfig,
    ) -> Result<(), String> {
        info(Component::Transcription, &format!(
            "External Service strategy started for: {:?}",
            output_path
        ));
        
        self.recording_path = Some(output_path.to_path_buf());
        self.start_time = Some(std::time::Instant::now());
        
        Ok(())
    }

    async fn process_samples(&mut self, _samples: &[f32]) -> Result<(), String> {
        // External service reads from WAV file after recording completes
        Ok(())
    }

    async fn finish_recording(&mut self) -> Result<TranscriptionResult, String> {
        let processing_start = std::time::Instant::now();
        
        let recording_path = self.recording_path
            .as_ref()
            .ok_or("No recording path set")?;

        // Verify the file exists
        if !recording_path.exists() {
            return Err(format!("Recording file not found: {:?}", recording_path));
        }

        // Get file metadata for validation
        let metadata = std::fs::metadata(recording_path)
            .map_err(|e| format!("Failed to read file metadata: {}", e))?;
        
        if metadata.len() == 0 {
            return Err("Recording file is empty".to_string());
        }

        info(Component::Transcription, &format!(
            "Sending file path {:?} ({} bytes) to external service via ZeroMQ",
            recording_path.file_name().unwrap_or_default(),
            metadata.len()
        ));

        // Initialize ZeroMQ context
        let ctx = zmq::Context::new();
        
        // Create sockets
        let push_socket = ctx.socket(zmq::PUSH)
            .map_err(|e| format!("Failed to create push socket: {}", e))?;
        let pull_socket = ctx.socket(zmq::PULL)
            .map_err(|e| format!("Failed to create pull socket: {}", e))?;
        
        // Set timeouts
        push_socket.set_sndtimeo(5000)
            .map_err(|e| format!("Failed to set send timeout: {}", e))?;
        pull_socket.set_rcvtimeo(30000)  // 30 seconds for transcription
            .map_err(|e| format!("Failed to set receive timeout: {}", e))?;
        
        // Connect to service
        let push_endpoint = format!("tcp://127.0.0.1:{}", self.config.zmq_push_port);
        let pull_endpoint = format!("tcp://127.0.0.1:{}", self.config.zmq_pull_port);
        
        push_socket.connect(&push_endpoint)
            .map_err(|e| format!("Failed to connect to push endpoint: {}", e))?;
        pull_socket.connect(&pull_endpoint)
            .map_err(|e| format!("Failed to connect to pull endpoint: {}", e))?;
        
        // Prepare the message
        let chunk_id = Uuid::new_v4();
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("Time error: {}", e))?
            .as_secs_f64();
        
        // Determine whether to use file paths or audio data
        let use_file_paths = self.config.use_file_paths.unwrap_or(true);
        
        let audio_chunk = if use_file_paths {
            // Send file path (more efficient for local processing)
            let path_str = recording_path.to_str()
                .ok_or("Failed to convert path to string")?;
            
            info(Component::Transcription, "Using FILE mode for external service");
            
            json!({
                "id": chunk_id.as_bytes().to_vec(),
                "audio_data_type": "FILE",
                "file_path": path_str,
                "sample_rate": 16000,  // Scout always records at 16kHz
                "timestamp": timestamp,
            })
        } else {
            // Send audio data (for remote processing or when file access isn't available)
            info(Component::Transcription, "Using AUDIO_BUFFER mode for external service");
            
            // Read and convert WAV file to samples
            let samples = match WhisperAudioConverter::convert_wav_file_for_whisper(recording_path) {
                Ok(s) => s,
                Err(e) => {
                    warn(Component::Transcription, &format!(
                        "Failed to read WAV file: {}",
                        e
                    ));
                    return Err(format!("Failed to read audio file: {}", e));
                }
            };
            
            if samples.is_empty() {
                return Err("No audio data in recording".to_string());
            }
            
            json!({
                "id": chunk_id.as_bytes().to_vec(),
                "audio_data_type": "AUDIO_BUFFER",
                "audio": samples,
                "sample_rate": 16000,
                "timestamp": timestamp,
            })
        };
        
        let queue_item = json!({
            "data": audio_chunk,
            "priority": 0,
            "timestamp": timestamp,
        });
        
        // Serialize to MessagePack
        let message = rmp_serde::to_vec(&queue_item)
            .map_err(|e| format!("Failed to serialize message: {}", e))?;
        
        // Send to transcriber
        push_socket.send(&message, 0)
            .map_err(|e| format!("Failed to send audio to external service: {}", e))?;
        
        debug(Component::Transcription, &format!(
            "Sent audio chunk {} to external service, waiting for result...",
            chunk_id
        ));
        
        // Wait for result
        match pull_socket.recv_msg(0) {
            Ok(msg) => {
                let result: serde_json::Value = rmp_serde::from_slice(&msg)
                    .map_err(|e| format!("Failed to deserialize response: {}", e))?;
                
                if let Some(ok_value) = result.get("Ok") {
                    let text = ok_value.get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    
                    let processing_time_ms = processing_start.elapsed().as_millis() as u64;
                    
                    info(Component::Transcription, &format!(
                        "External service transcription completed in {}ms",
                        processing_time_ms
                    ));
                    
                    Ok(TranscriptionResult {
                        text,
                        processing_time_ms,
                        strategy_used: "ExternalService".to_string(),
                        chunks_processed: 1,
                    })
                } else if let Some(err_value) = result.get("Err") {
                    Err(format!("External service error: {:?}", err_value))
                } else {
                    Err(format!("Unknown response format from external service"))
                }
            }
            Err(e) => {
                if e == zmq::Error::EAGAIN {
                    Err("Timeout waiting for transcription from external service".to_string())
                } else {
                    Err(format!("Failed to receive transcription: {}", e))
                }
            }
        }
    }

    fn get_partial_results(&self) -> Vec<String> {
        Vec::new()  // External service doesn't provide partial results yet
    }
}