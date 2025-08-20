use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::process::{Child, Command};
use tokio::sync::RwLock;
use tokio::time::{interval, sleep};
use uuid::Uuid;

// Import types from scout-transcriber (would be a dependency in real usage)
// For now, we'll duplicate the essential types

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioChunk {
    pub id: Uuid,
    pub audio: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u8,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transcript {
    pub id: Uuid,
    pub text: String,
    pub confidence: f32,
    pub timestamp: u64,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionError {
    pub id: Uuid,
    pub message: String,
    pub error_code: String,
    pub timestamp: u64,
}

/// Configuration for the external transcription service
#[derive(Debug, Clone)]
pub struct ExternalServiceConfig {
    /// Path to the scout-transcriber binary
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
    pub poll_interval: Duration,
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
            binary_path: PathBuf::from("scout-transcriber"),
            input_queue: PathBuf::from("/tmp/transcriber/input"),
            output_queue: PathBuf::from("/tmp/transcriber/output"),
            workers: 2,
            managed: true,
            poll_interval: Duration::from_millis(100),
            use_zeromq: true,  // Default to ZeroMQ mode
            zmq_push_port: 5555,
            zmq_pull_port: 5556,
            zmq_control_port: 5557,
        }
    }
}

/// Client for the external transcription service
pub struct ExternalTranscriber {
    config: ExternalServiceConfig,
    service_process: Arc<RwLock<Option<Child>>>,
    input_queue: Arc<sled::Db>,
    output_queue: Arc<sled::Db>,
}

impl ExternalTranscriber {
    /// Create a new external transcriber client
    pub async fn new(config: ExternalServiceConfig) -> Result<Self> {
        // Create queue directories if they don't exist
        if let Some(parent) = config.input_queue.parent() {
            tokio::fs::create_dir_all(parent).await
                .context("Failed to create input queue directory")?;
        }
        if let Some(parent) = config.output_queue.parent() {
            tokio::fs::create_dir_all(parent).await
                .context("Failed to create output queue directory")?;
        }

        // Open Sled databases for the queues
        let input_queue = sled::open(&config.input_queue)
            .context("Failed to open input queue")?;
        let output_queue = sled::open(&config.output_queue)
            .context("Failed to open output queue")?;

        let transcriber = Self {
            config,
            service_process: Arc::new(RwLock::new(None)),
            input_queue: Arc::new(input_queue),
            output_queue: Arc::new(output_queue),
        };

        // Start the service if managed
        if transcriber.config.managed {
            transcriber.start_service().await?;
        }

        Ok(transcriber)
    }

    /// Start the external transcription service
    pub async fn start_service(&self) -> Result<()> {
        let mut process_guard = self.service_process.write().await;
        
        if process_guard.is_some() {
            log::warn!("Service is already running");
            return Ok(());
        }

        log::info!("Starting external transcription service");

        let child = Command::new(&self.config.binary_path)
            .arg("--input-queue")
            .arg(&self.config.input_queue)
            .arg("--output-queue")
            .arg(&self.config.output_queue)
            .arg("--workers")
            .arg(self.config.workers.to_string())
            .arg("--log-level")
            .arg("info")
            .spawn()
            .context("Failed to spawn transcription service")?;

        log::info!("Transcription service started with PID: {:?}", child.id());
        *process_guard = Some(child);

        // Wait a bit for the service to initialize
        sleep(Duration::from_millis(500)).await;

        Ok(())
    }

    /// Stop the external transcription service
    pub async fn stop_service(&self) -> Result<()> {
        let mut process_guard = self.service_process.write().await;
        
        if let Some(mut child) = process_guard.take() {
            log::info!("Stopping external transcription service");
            
            // Try graceful shutdown first
            if let Err(e) = child.kill().await {
                log::error!("Failed to kill service process: {}", e);
            }
            
            log::info!("Transcription service stopped");
        }

        Ok(())
    }

    /// Submit audio for transcription
    pub async fn transcribe(&self, audio: Vec<f32>, sample_rate: u32) -> Result<Uuid> {
        let chunk = AudioChunk {
            id: Uuid::new_v4(),
            audio,
            sample_rate,
            channels: 1,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        };

        // Serialize the chunk
        let data = rmp_serde::to_vec(&chunk)
            .context("Failed to serialize audio chunk")?;

        // Generate a unique key for this chunk
        let key = format!("{:016x}_{}", chunk.timestamp, chunk.id);

        // Push to input queue
        self.input_queue
            .insert(key.as_bytes(), data)
            .context("Failed to insert into input queue")?;

        log::debug!("Submitted audio chunk {} for transcription", chunk.id);

        Ok(chunk.id)
    }

    /// Poll for transcription results
    pub async fn poll_result(&self, id: Uuid) -> Result<Option<Result<Transcript, TranscriptionError>>> {
        // Scan output queue for results with matching ID
        for item in self.output_queue.iter() {
            let (key, value) = item.context("Failed to read from output queue")?;
            
            // Try to deserialize as Result<Transcript, TranscriptionError>
            if let Ok(result) = rmp_serde::from_slice::<Result<Transcript, TranscriptionError>>(&value) {
                match &result {
                    Ok(transcript) if transcript.id == id => {
                        // Remove from queue
                        self.output_queue.remove(&key)
                            .context("Failed to remove from output queue")?;
                        return Ok(Some(Ok(transcript.clone())));
                    }
                    Err(error) if error.id == id => {
                        // Remove from queue
                        self.output_queue.remove(&key)
                            .context("Failed to remove from output queue")?;
                        return Ok(Some(Err(error.clone())));
                    }
                    _ => continue,
                }
            }
        }

        Ok(None)
    }

    /// Wait for a transcription result with timeout
    pub async fn wait_for_result(
        &self, 
        id: Uuid, 
        timeout: Duration
    ) -> Result<Result<Transcript, TranscriptionError>> {
        let start = tokio::time::Instant::now();
        let mut poll_interval = interval(self.config.poll_interval);

        loop {
            poll_interval.tick().await;

            if let Some(result) = self.poll_result(id).await? {
                return Ok(result);
            }

            if start.elapsed() > timeout {
                return Err(anyhow::anyhow!("Timeout waiting for transcription result"));
            }
        }
    }

    /// Transcribe and wait for result (convenience method)
    pub async fn transcribe_sync(
        &self,
        audio: Vec<f32>,
        sample_rate: u32,
        timeout: Duration,
    ) -> Result<String> {
        let id = self.transcribe(audio, sample_rate).await?;
        
        match self.wait_for_result(id, timeout).await? {
            Ok(transcript) => Ok(transcript.text),
            Err(error) => Err(anyhow::anyhow!("Transcription failed: {}", error.message)),
        }
    }

    /// Get queue statistics
    pub async fn get_stats(&self) -> Result<QueueStats> {
        let input_len = self.input_queue.len();
        let output_len = self.output_queue.len();

        Ok(QueueStats {
            input_queue_size: input_len,
            output_queue_size: output_len,
        })
    }

    /// Clear all queues
    pub async fn clear_queues(&self) -> Result<()> {
        self.input_queue.clear()
            .context("Failed to clear input queue")?;
        self.output_queue.clear()
            .context("Failed to clear output queue")?;
        
        log::info!("Cleared all transcription queues");
        Ok(())
    }
}

impl Drop for ExternalTranscriber {
    fn drop(&mut self) {
        // If managed, stop the service when dropping
        if self.config.managed {
            let service_process = self.service_process.clone();
            tokio::spawn(async move {
                if let Some(mut child) = service_process.write().await.take() {
                    let _ = child.kill().await;
                }
            });
        }
    }
}

/// Queue statistics
#[derive(Debug, Clone, Serialize)]
pub struct QueueStats {
    pub input_queue_size: usize,
    pub output_queue_size: usize,
}

/// Backend implementation for the transcription strategy pattern
pub struct ExternalTranscriberBackend {
    client: Arc<ExternalTranscriber>,
}

impl ExternalTranscriberBackend {
    pub async fn new(config: ExternalServiceConfig) -> Result<Self> {
        let client = ExternalTranscriber::new(config).await?;
        Ok(Self {
            client: Arc::new(client),
        })
    }

    pub async fn transcribe(&self, audio_path: &Path) -> Result<String> {
        // Load audio from file
        let audio_data = load_audio_file(audio_path)?;
        
        // Transcribe using the external service
        self.client
            .transcribe_sync(audio_data.samples, audio_data.sample_rate, Duration::from_secs(30))
            .await
    }
}

/// Helper to load audio files
struct AudioData {
    samples: Vec<f32>,
    sample_rate: u32,
}

fn load_audio_file(path: &Path) -> Result<AudioData> {
    use hound::WavReader;
    
    let mut reader = WavReader::open(path)
        .context("Failed to open audio file")?;
    
    let spec = reader.spec();
    let sample_rate = spec.sample_rate;
    
    // Convert to f32 samples
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => {
            reader.samples::<f32>()
                .collect::<Result<Vec<_>, _>>()
                .context("Failed to read float samples")?
        }
        hound::SampleFormat::Int => {
            let max_val = (1 << (spec.bits_per_sample - 1)) as f32;
            reader.samples::<i32>()
                .map(|s| s.map(|v| v as f32 / max_val))
                .collect::<Result<Vec<_>, _>>()
                .context("Failed to read int samples")?
        }
    };
    
    Ok(AudioData {
        samples,
        sample_rate,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_external_transcriber_creation() {
        let temp_dir = TempDir::new().unwrap();
        
        let config = ExternalServiceConfig {
            binary_path: PathBuf::from("echo"), // Use echo as a dummy binary
            input_queue: temp_dir.path().join("input"),
            output_queue: temp_dir.path().join("output"),
            workers: 1,
            managed: false, // Don't actually start the service
            poll_interval: Duration::from_millis(50),
        };

        let transcriber = ExternalTranscriber::new(config).await.unwrap();
        let stats = transcriber.get_stats().await.unwrap();
        
        assert_eq!(stats.input_queue_size, 0);
        assert_eq!(stats.output_queue_size, 0);
    }

    #[tokio::test]
    async fn test_audio_chunk_submission() {
        let temp_dir = TempDir::new().unwrap();
        
        let config = ExternalServiceConfig {
            binary_path: PathBuf::from("echo"),
            input_queue: temp_dir.path().join("input"),
            output_queue: temp_dir.path().join("output"),
            workers: 1,
            managed: false,
            poll_interval: Duration::from_millis(50),
        };

        let transcriber = ExternalTranscriber::new(config).await.unwrap();
        
        // Submit some audio
        let audio = vec![0.1, 0.2, 0.3, 0.4, 0.5];
        let id = transcriber.transcribe(audio, 16000).await.unwrap();
        
        assert!(!id.is_nil());
        
        // Check queue size
        let stats = transcriber.get_stats().await.unwrap();
        assert_eq!(stats.input_queue_size, 1);
    }
}