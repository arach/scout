use std::sync::Arc;
use std::path::Path;
use async_trait::async_trait;
use crate::transcription::Transcriber;
use crate::logger::{info, debug, warn, Component};
use tauri::Emitter;

/// Result of transcription containing the text and metadata
#[derive(Debug, Clone)]
pub struct TranscriptionResult {
    pub text: String,
    pub processing_time_ms: u64,
    pub strategy_used: String,
    pub chunks_processed: usize,
}

/// Configuration for selecting transcription strategy
#[derive(Debug, Clone)]
pub struct TranscriptionConfig {
    /// Enable chunked transcription for long recordings
    pub enable_chunking: bool,
    /// Minimum duration before chunking kicks in
    pub chunking_threshold_secs: u64,
    /// Duration of each chunk in seconds
    pub chunk_duration_secs: u64,
    /// Force a specific strategy (for testing)
    pub force_strategy: Option<String>,
    /// Duration of refinement chunks in seconds (for progressive strategy)
    pub refinement_chunk_secs: Option<u64>,
}

impl Default for TranscriptionConfig {
    fn default() -> Self {
        Self {
            enable_chunking: true,
            chunking_threshold_secs: 10,
            chunk_duration_secs: 10,
            force_strategy: None,
            refinement_chunk_secs: Some(10), // Engineering decision: 10s optimal balance
        }
    }
}

/// Trait defining different transcription strategies
#[async_trait]
pub trait TranscriptionStrategy: Send + Sync {
    /// Name of this strategy for logging/debugging
    fn name(&self) -> &str;
    
    /// Check if this strategy can handle the given recording characteristics
    fn can_handle(&self, duration_estimate: Option<std::time::Duration>, config: &TranscriptionConfig) -> bool;
    
    /// Start processing a recording with this strategy
    async fn start_recording(&mut self, output_path: &Path, config: &TranscriptionConfig) -> Result<(), String>;
    
    /// Process audio samples during recording (for real-time strategies)
    async fn process_samples(&mut self, samples: &[f32]) -> Result<(), String>;
    
    /// Finish recording and get final transcription result
    async fn finish_recording(&mut self) -> Result<TranscriptionResult, String>;
    
    /// Get intermediate results if available (for chunked strategies)
    fn get_partial_results(&self) -> Vec<String>;
    
    /// Get ring buffer if this strategy uses one (for ring buffer strategies)
    fn get_ring_buffer(&self) -> Option<Arc<crate::audio::ring_buffer_recorder::RingBufferRecorder>> {
        None
    }
}

/// Classic transcription strategy - transcribe entire file after recording completes
pub struct ClassicTranscriptionStrategy {
    transcriber: Arc<tokio::sync::Mutex<Transcriber>>,
    recording_path: Option<std::path::PathBuf>,
    start_time: Option<std::time::Instant>,
}

impl ClassicTranscriptionStrategy {
    pub fn new(transcriber: Arc<tokio::sync::Mutex<Transcriber>>) -> Self {
        Self {
            transcriber,
            recording_path: None,
            start_time: None,
        }
    }
}

#[async_trait]
impl TranscriptionStrategy for ClassicTranscriptionStrategy {
    fn name(&self) -> &str {
        "classic"
    }
    
    fn can_handle(&self, _duration_estimate: Option<std::time::Duration>, _config: &TranscriptionConfig) -> bool {
        true // Classic strategy can handle any recording
    }
    
    async fn start_recording(&mut self, output_path: &Path, _config: &TranscriptionConfig) -> Result<(), String> {
        self.recording_path = Some(output_path.to_path_buf());
        self.start_time = Some(std::time::Instant::now());
        info(Component::Transcription, &format!("Classic transcription strategy started for: {:?}", output_path));
        Ok(())
    }
    
    async fn process_samples(&mut self, _samples: &[f32]) -> Result<(), String> {
        // Classic strategy doesn't process samples during recording
        Ok(())
    }
    
    async fn finish_recording(&mut self) -> Result<TranscriptionResult, String> {
        let start_time = self.start_time.take()
            .ok_or("Recording was not started")?;
        
        let recording_path = self.recording_path.take()
            .ok_or("Recording path not set")?;
        
        info(Component::Transcription, &format!("Classic transcription processing: {:?}", recording_path));
        
        let transcriber = self.transcriber.lock().await;
        let text = transcriber.transcribe_file(&recording_path)
            .map_err(|e| format!("Classic transcription failed: {}", e))?;
        
        let processing_time = start_time.elapsed();
        
        Ok(TranscriptionResult {
            text,
            processing_time_ms: processing_time.as_millis() as u64,
            strategy_used: self.name().to_string(),
            chunks_processed: 1,
        })
    }
    
    fn get_partial_results(&self) -> Vec<String> {
        vec![] // Classic strategy doesn't provide partial results
    }
}

/// Ring buffer transcription strategy - process chunks in real-time during recording
pub struct RingBufferTranscriptionStrategy {
    transcriber: Arc<tokio::sync::Mutex<Transcriber>>,
    ring_buffer: Option<Arc<crate::audio::ring_buffer_recorder::RingBufferRecorder>>,
    ring_transcriber: Option<crate::transcription::ring_buffer_transcriber::RingBufferTranscriber>,
    monitor_handle: Option<(tokio::task::JoinHandle<crate::ring_buffer_monitor::RingBufferMonitor>, tokio::sync::mpsc::Sender<()>)>,
    temp_dir: std::path::PathBuf,
    start_time: Option<std::time::Instant>,
    config: Option<TranscriptionConfig>,
    recording_path: Option<std::path::PathBuf>,
    app_handle: Option<tauri::AppHandle>,
}

impl RingBufferTranscriptionStrategy {
    pub fn new(transcriber: Arc<tokio::sync::Mutex<Transcriber>>, temp_dir: std::path::PathBuf) -> Self {
        Self {
            transcriber,
            ring_buffer: None,
            ring_transcriber: None,
            monitor_handle: None,
            temp_dir,
            start_time: None,
            config: None,
            recording_path: None,
            app_handle: None,
        }
    }
    
    pub fn with_app_handle(mut self, app_handle: tauri::AppHandle) -> Self {
        self.app_handle = Some(app_handle);
        self
    }
    
    pub fn get_ring_buffer(&self) -> Option<Arc<crate::audio::ring_buffer_recorder::RingBufferRecorder>> {
        self.ring_buffer.clone()
    }
}

#[async_trait]
impl TranscriptionStrategy for RingBufferTranscriptionStrategy {
    fn name(&self) -> &str {
        "ring_buffer"
    }
    
    fn can_handle(&self, duration_estimate: Option<std::time::Duration>, config: &TranscriptionConfig) -> bool {
        if !config.enable_chunking {
            return false;
        }
        
        // Ring buffer strategy is beneficial for longer recordings
        if let Some(duration) = duration_estimate {
            duration.as_secs() > config.chunking_threshold_secs
        } else {
            true // We don't know duration yet, so we can handle it
        }
    }
    
    async fn start_recording(&mut self, output_path: &Path, config: &TranscriptionConfig) -> Result<(), String> {
        self.start_time = Some(std::time::Instant::now());
        self.config = Some(config.clone());
        self.recording_path = Some(output_path.to_path_buf());
        
        info(Component::RingBuffer, &format!("Ring buffer transcription strategy started for: {:?}", output_path));
        info(Component::RingBuffer, "Initializing ring buffer components for real-time processing");
        
        // Get actual device sample rate from app state instead of hardcoding 48000
        let device_sample_rate = crate::get_current_device_sample_rate().unwrap_or(48000);
        info(Component::RingBuffer, &format!("Using device sample rate: {} Hz", device_sample_rate));
        
        // Initialize ring buffer recorder with 5-minute capacity
        // Match the audio recorder's configuration (mono, actual device sample rate)
        let spec = hound::WavSpec {
            channels: 1,     // Mono recording to match AudioRecorder
            sample_rate: device_sample_rate, // Use actual device sample rate
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        
        let ring_buffer = Arc::new(crate::audio::ring_buffer_recorder::RingBufferRecorder::new(
            spec,
            output_path,
        )?);
        
        // Initialize ring buffer transcriber
        let ring_transcriber = crate::transcription::ring_buffer_transcriber::RingBufferTranscriber::new(
            ring_buffer.clone(),
            self.transcriber.clone(),
            self.temp_dir.clone(),
        );
        
        // Initialize and start monitor
        let mut monitor = crate::ring_buffer_monitor::RingBufferMonitor::new(ring_buffer.clone());
        if let Some(ref app_handle) = self.app_handle {
            monitor = monitor.with_app_handle(app_handle.clone());
        }
        let (monitor_handle, stop_sender) = monitor.start_monitoring(
            ring_transcriber,
        ).await;
        
        self.ring_buffer = Some(ring_buffer);
        self.ring_transcriber = None; // Monitor owns the transcriber
        self.monitor_handle = Some((monitor_handle, stop_sender));
        
        info(Component::RingBuffer, "Ring buffer components initialized - ready for 5-second interval processing");
        Ok(())
    }
    
    async fn process_samples(&mut self, samples: &[f32]) -> Result<(), String> {
        if let Some(ref ring_buffer) = self.ring_buffer {
            // Feed audio samples to ring buffer for real-time processing
            ring_buffer.add_samples(samples)?;
        } else {
            return Err("Ring buffer not initialized - this should not happen".to_string());
        }
        Ok(())
    }
    
    async fn finish_recording(&mut self) -> Result<TranscriptionResult, String> {
        let _recording_start_time = self.start_time.take()
            .ok_or("Recording was not started")?;
        
        let recording_path = self.recording_path.take()
            .ok_or("Recording path was not set")?;
        
        info(Component::RingBuffer, "Finishing ring buffer transcription with real-time chunks");
        let transcription_start = std::time::Instant::now();
        
        // Stop the monitor and collect results
        let mut final_chunks = Vec::new();
        let mut chunks_processed = 0;
        
        if let Some((monitor_handle, stop_sender)) = self.monitor_handle.take() {
            debug(Component::RingBuffer, "Stopping ring buffer monitor...");
            
            // Signal monitor to stop
            let _ = stop_sender.send(()).await;
            
            // Wait for monitor to finish
            match monitor_handle.await {
                Ok(monitor) => {
                    info(Component::RingBuffer, "Monitor stopped, collecting chunk results");
                    
                    // Collect all transcribed chunks
                    match monitor.recording_complete().await {
                        Ok(chunk_results) => {
                            final_chunks = chunk_results;
                            chunks_processed = final_chunks.len();
                            info(Component::RingBuffer, &format!("Collected {} transcribed chunks from ring buffer", chunks_processed));
                        }
                        Err(e) => {
                            warn(Component::RingBuffer, &format!("Error collecting chunk results: {}", e));
                            // Continue with fallback instead of failing
                        }
                    }
                }
                Err(e) => {
                    warn(Component::RingBuffer, &format!("Error stopping monitor: {}", e));
                }
            }
        } else {
            warn(Component::RingBuffer, "No monitor handle found - this should not happen");
        }
        
        // Finalize the main recording file
        if let Some(ref ring_buffer) = self.ring_buffer {
            debug(Component::RingBuffer, "Finalizing main recording file");
            if let Err(e) = ring_buffer.finalize_recording() {
                warn(Component::RingBuffer, &format!("Error finalizing recording: {}", e));
            }
        }
        
        // Calculate actual transcription time from recording start
        let transcription_time = if chunks_processed > 0 && self.start_time.is_some() {
            // For ring buffer, chunks were processed during recording
            // Use a more realistic estimate based on chunks processed
            // Average ~125ms per chunk based on backend logs
            std::time::Duration::from_millis((chunks_processed as u64) * 125)
        } else {
            transcription_start.elapsed() // Fallback to collection time
        };
        
        info(Component::RingBuffer, &format!("Ring buffer processing complete - {} chunks collected", chunks_processed));
        
        // Combine all chunk transcriptions
        let combined_text = if final_chunks.is_empty() {
            // If no chunks were collected from the monitor, try fallback
            debug(Component::RingBuffer, "No chunks collected from ring buffer - checking if fallback is needed");
            
            // Check if the recording was too short for chunking
            let total_recording_time = transcription_start.elapsed();
            if total_recording_time < std::time::Duration::from_secs(5) {
                info(Component::RingBuffer, &format!("Recording was too short for chunking ({:.1}s) - using full file transcription", 
                         total_recording_time.as_secs_f64()));
            }
            
            // Note: Removed 500ms sleep that was causing 9-10s transcription delays
            // The file should already be written by the time we get here
            
            // Check if file exists and has content
            if !recording_path.exists() {
                warn(Component::RingBuffer, &format!("Recording file does not exist at: {:?}", recording_path));
                return Err("Recording file does not exist for fallback transcription".to_string());
            }
            
            let file_size = std::fs::metadata(&recording_path)
                .map_err(|e| format!("Failed to read file metadata: {}", e))?
                .len();
                
            if file_size < 1000 { // Less than 1KB is likely empty
                return Err(format!("Audio file too small for transcription ({} bytes)", file_size));
            }
            
            info(Component::RingBuffer, &format!("Fallback: Processing {} byte audio file", file_size));
            
            let transcriber = self.transcriber.lock().await;
            match transcriber.transcribe(&recording_path) {
                Ok(text) => {
                    info(Component::RingBuffer, &format!("Fallback transcription successful: {} chars", text.len()));
                    text
                },
                Err(e) => return Err(format!("Fallback transcription failed: {}", e)),
            }
        } else {
            // Join all chunk results with spaces
            debug(Component::RingBuffer, &format!("Joining {} chunks into final transcript", final_chunks.len()));
            let combined = final_chunks.join(" ");
            debug(Component::RingBuffer, &format!("Combined transcript: {} chars", combined.len()));
            debug(Component::RingBuffer, &format!("First 100 chars: {}", combined.chars().take(100).collect::<String>()));
            combined
        };
        
        info(Component::RingBuffer, &format!("Ring buffer transcription completed: {} chars from {} chunks in {:.2}s", 
                 combined_text.len(), chunks_processed, transcription_time.as_secs_f64()));
        
        Ok(TranscriptionResult {
            text: combined_text,
            processing_time_ms: transcription_time.as_millis() as u64,
            strategy_used: self.name().to_string(),
            chunks_processed: chunks_processed,
        })
    }
    
    fn get_partial_results(&self) -> Vec<String> {
        // TODO: Get partial results from ring transcriber
        vec![]
    }
    
    fn get_ring_buffer(&self) -> Option<Arc<crate::audio::ring_buffer_recorder::RingBufferRecorder>> {
        self.ring_buffer.clone()
    }
}

/// Progressive transcription strategy - uses Tiny model for real-time feedback, then refines with Medium model
pub struct ProgressiveTranscriptionStrategy {
    tiny_transcriber: Arc<tokio::sync::Mutex<Transcriber>>,
    medium_transcriber: Arc<tokio::sync::Mutex<Transcriber>>,
    ring_buffer: Option<Arc<crate::audio::ring_buffer_recorder::RingBufferRecorder>>,
    ring_transcriber: Option<crate::transcription::ring_buffer_transcriber::RingBufferTranscriber>,
    monitor_handle: Option<(tokio::task::JoinHandle<crate::ring_buffer_monitor::RingBufferMonitor>, tokio::sync::mpsc::Sender<()>)>,
    refinement_handle: Option<tokio::task::JoinHandle<()>>,
    temp_dir: std::path::PathBuf,
    start_time: Option<std::time::Instant>,
    config: Option<TranscriptionConfig>,
    recording_path: Option<std::path::PathBuf>,
    app_handle: Option<tauri::AppHandle>,
    /// Stores the Tiny model transcriptions for merging
    tiny_chunks: Arc<tokio::sync::Mutex<Vec<(std::ops::Range<usize>, String)>>>,
    /// Stores the refined Medium model transcriptions
    refined_chunks: Arc<tokio::sync::Mutex<Vec<(std::ops::Range<usize>, String)>>>,
}

impl ProgressiveTranscriptionStrategy {
    pub async fn new(
        models_dir: &Path,
        temp_dir: std::path::PathBuf,
    ) -> Result<Self, String> {
        info(Component::Transcription, "Creating ProgressiveTranscriptionStrategy");
        
        // Load Tiny model for real-time transcription
        let tiny_path = models_dir.join("ggml-tiny.en.bin");
        info(Component::Transcription, &format!("Loading Tiny model from: {:?}", tiny_path));
        if !tiny_path.exists() {
            return Err(format!("Tiny model not found at: {:?}", tiny_path));
        }
        let tiny_transcriber = Transcriber::get_or_create_cached(&tiny_path).await?;
        info(Component::Transcription, "Tiny model loaded successfully");
        
        // Load Medium model for refinement
        let medium_path = models_dir.join("ggml-medium.en.bin");
        info(Component::Transcription, &format!("Loading Medium model from: {:?}", medium_path));
        if !medium_path.exists() {
            return Err(format!("Medium model not found at: {:?}", medium_path));
        }
        let medium_transcriber = Transcriber::get_or_create_cached(&medium_path).await?;
        info(Component::Transcription, "Medium model loaded successfully");
        
        info(Component::Transcription, "Progressive transcription strategy initialized with Tiny + Medium models");
        
        Ok(Self {
            tiny_transcriber,
            medium_transcriber,
            ring_buffer: None,
            ring_transcriber: None,
            monitor_handle: None,
            refinement_handle: None,
            temp_dir,
            start_time: None,
            config: None,
            recording_path: None,
            app_handle: None,
            tiny_chunks: Arc::new(tokio::sync::Mutex::new(Vec::new())),
            refined_chunks: Arc::new(tokio::sync::Mutex::new(Vec::new())),
        })
    }
    
    pub fn with_app_handle(mut self, app_handle: tauri::AppHandle) -> Self {
        self.app_handle = Some(app_handle);
        self
    }
    
    /// Start the background refinement task that processes chunks with Medium model
    fn start_refinement_task(
        &mut self,
        ring_buffer: Arc<crate::audio::ring_buffer_recorder::RingBufferRecorder>,
        recording_path: std::path::PathBuf,
    ) {
        let medium_transcriber = self.medium_transcriber.clone();
        let temp_dir = self.temp_dir.clone();
        let refined_chunks = self.refined_chunks.clone();
        let app_handle = self.app_handle.clone();
        
        // Get chunk size from config or use 15 seconds as default
        let chunk_seconds = self.config.as_ref()
            .and_then(|c| c.refinement_chunk_secs)
            .unwrap_or(15);
        
        let handle = tokio::spawn(async move {
            info(Component::Transcription, &format!("Starting background refinement task ({}-second chunks with Medium model)", chunk_seconds));
            let mut last_processed_samples = 0;
            let device_sample_rate = ring_buffer.get_spec().sample_rate as usize;
            let chunk_samples = device_sample_rate * chunk_seconds as usize; // chunk_seconds at actual device sample rate
            
            loop {
                // Check if recording is finalized first - exit immediately if so
                if ring_buffer.is_finalized() {
                    info(Component::Transcription, "Recording finalized, stopping refinement task to minimize latency");
                    break;
                }
                
                // Wait a bit before checking for new data
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                
                // Check if we have enough new samples for a chunk
                let current_samples = ring_buffer.get_total_samples();
                if current_samples < last_processed_samples + chunk_samples {
                    // Check if recording is complete
                    if ring_buffer.is_finalized() && current_samples > last_processed_samples {
                        // Process final chunk even if less than 30 seconds
                        let chunk_range = last_processed_samples..current_samples;
                        if let Ok(samples) = ring_buffer.get_samples_range(chunk_range.clone()) {
                            info(Component::Transcription, &format!(
                                "Processing final refinement chunk: {} samples ({:.1}s)",
                                samples.len(),
                                samples.len() as f32 / device_sample_rate as f32
                            ));
                            
                            // Save chunk to temporary file
                            let chunk_path = temp_dir.join(format!("refinement_final_{}.wav", last_processed_samples));
                            if let Err(e) = crate::audio::ring_buffer_recorder::save_samples_to_wav(&samples, &chunk_path, ring_buffer.get_spec()) {
                                warn(Component::Transcription, &format!("Failed to save refinement chunk: {}", e));
                            } else {
                                // Transcribe with Medium model
                                let transcriber = medium_transcriber.lock().await;
                                match transcriber.transcribe_file(&chunk_path) {
                                    Ok(text) => {
                                        info(Component::Transcription, &format!("Refined chunk transcription: {} chars", text.len()));
                                        refined_chunks.lock().await.push((chunk_range, text.clone()));
                                        
                                        // Emit refinement event
                                        if let Some(ref app) = app_handle {
                                            let _ = app.emit("transcript-refined", serde_json::json!({
                                                "chunk_start": last_processed_samples,
                                                "chunk_end": current_samples,
                                                "text": text
                                            }));
                                        }
                                    }
                                    Err(e) => {
                                        warn(Component::Transcription, &format!("Failed to transcribe refinement chunk: {}", e));
                                    }
                                }
                                
                                // Clean up temp file
                                let _ = tokio::fs::remove_file(&chunk_path).await;
                            }
                        }
                        break; // Recording is complete
                    }
                    continue; // Not enough samples yet
                }
                
                // Process a chunk
                let chunk_end = last_processed_samples + chunk_samples;
                let chunk_range = last_processed_samples..chunk_end;
                
                if let Ok(samples) = ring_buffer.get_samples_range(chunk_range.clone()) {
                    info(Component::Transcription, &format!(
                        "Processing refinement chunk: {} samples (30s) starting at sample {}",
                        samples.len(), last_processed_samples
                    ));
                    
                    // Save chunk to temporary file
                    let chunk_path = temp_dir.join(format!("refinement_{}_{}.wav", last_processed_samples, chunk_end));
                    if let Err(e) = crate::audio::ring_buffer_recorder::save_samples_to_wav(&samples, &chunk_path, ring_buffer.get_spec()) {
                        warn(Component::Transcription, &format!("Failed to save refinement chunk: {}", e));
                    } else {
                        // Transcribe with Medium model
                        let transcriber = medium_transcriber.lock().await;
                        match transcriber.transcribe_file(&chunk_path) {
                            Ok(text) => {
                                info(Component::Transcription, &format!("Refined 30s chunk transcription: {} chars", text.len()));
                                refined_chunks.lock().await.push((chunk_range, text.clone()));
                                
                                // Emit refinement event
                                if let Some(ref app) = app_handle {
                                    let _ = app.emit("transcript-refined", serde_json::json!({
                                        "chunk_start": last_processed_samples,
                                        "chunk_end": chunk_end,
                                        "text": text
                                    }));
                                }
                            }
                            Err(e) => {
                                warn(Component::Transcription, &format!("Failed to transcribe refinement chunk: {}", e));
                            }
                        }
                        
                        // Clean up temp file
                        let _ = tokio::fs::remove_file(&chunk_path).await;
                    }
                }
                
                last_processed_samples = chunk_end;
            }
            
            info(Component::Transcription, "Background refinement task completed");
        });
        
        self.refinement_handle = Some(handle);
    }
}

#[async_trait]
impl TranscriptionStrategy for ProgressiveTranscriptionStrategy {
    fn name(&self) -> &str {
        "progressive"
    }
    
    fn can_handle(&self, _duration_estimate: Option<std::time::Duration>, config: &TranscriptionConfig) -> bool {
        // Progressive strategy is ideal for longer recordings
        config.enable_chunking
    }
    
    async fn start_recording(&mut self, output_path: &Path, config: &TranscriptionConfig) -> Result<(), String> {
        self.start_time = Some(std::time::Instant::now());
        self.config = Some(config.clone());
        self.recording_path = Some(output_path.to_path_buf());
        
        info(Component::Transcription, &format!("Progressive transcription strategy started for: {:?}", output_path));
        info(Component::Transcription, "Using Tiny model for real-time feedback, Medium model for background refinement");
        
        // Get actual device sample rate from app state instead of hardcoding 48000
        let device_sample_rate = crate::get_current_device_sample_rate().unwrap_or(48000);
        info(Component::Transcription, &format!("Using device sample rate: {} Hz", device_sample_rate));
        
        // Initialize ring buffer recorder
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: device_sample_rate,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        
        let ring_buffer = Arc::new(crate::audio::ring_buffer_recorder::RingBufferRecorder::new(
            spec,
            output_path,
        )?);
        
        // Initialize ring buffer transcriber with TINY model for real-time
        let ring_transcriber = crate::transcription::ring_buffer_transcriber::RingBufferTranscriber::new(
            ring_buffer.clone(),
            self.tiny_transcriber.clone(), // Use Tiny model for real-time
            self.temp_dir.clone(),
        );
        
        // Initialize and start monitor
        let mut monitor = crate::ring_buffer_monitor::RingBufferMonitor::new(ring_buffer.clone());
        if let Some(ref app_handle) = self.app_handle {
            monitor = monitor.with_app_handle(app_handle.clone());
        }
        let (monitor_handle, stop_sender) = monitor.start_monitoring(
            ring_transcriber,
        ).await;
        
        // Start background refinement task
        self.start_refinement_task(ring_buffer.clone(), output_path.to_path_buf());
        
        self.ring_buffer = Some(ring_buffer);
        self.ring_transcriber = None; // Monitor owns the transcriber
        self.monitor_handle = Some((monitor_handle, stop_sender));
        
        info(Component::Transcription, "Progressive transcription initialized - Tiny model for real-time, Medium model refining in background");
        Ok(())
    }
    
    async fn process_samples(&mut self, samples: &[f32]) -> Result<(), String> {
        if let Some(ref ring_buffer) = self.ring_buffer {
            ring_buffer.add_samples(samples)?;
        } else {
            return Err("Ring buffer not initialized".to_string());
        }
        Ok(())
    }
    
    async fn finish_recording(&mut self) -> Result<TranscriptionResult, String> {
        let _recording_start_time = self.start_time.take()
            .ok_or("Recording was not started")?;
        
        let recording_path = self.recording_path.take()
            .ok_or("Recording path was not set")?;
        
        info(Component::Transcription, "Finishing progressive transcription");
        let transcription_start = std::time::Instant::now();
        
        // Stop the real-time monitor and collect Tiny model results
        let mut tiny_chunks = Vec::new();
        let mut chunks_processed = 0;
        
        if let Some((monitor_handle, stop_sender)) = self.monitor_handle.take() {
            debug(Component::Transcription, "Stopping real-time monitor...");
            
            // Signal monitor to stop
            let _ = stop_sender.send(()).await;
            
            // Wait for monitor to finish
            match monitor_handle.await {
                Ok(monitor) => {
                    info(Component::Transcription, "Monitor stopped, collecting Tiny model chunks");
                    
                    match monitor.recording_complete().await {
                        Ok(chunk_results) => {
                            tiny_chunks = chunk_results;
                            chunks_processed = tiny_chunks.len();
                            info(Component::Transcription, &format!("Collected {} Tiny model chunks", chunks_processed));
                        }
                        Err(e) => {
                            warn(Component::Transcription, &format!("Error collecting chunk results: {}", e));
                        }
                    }
                }
                Err(e) => {
                    warn(Component::Transcription, &format!("Error stopping monitor: {}", e));
                }
            }
        }
        
        // Finalize the main recording file
        if let Some(ref ring_buffer) = self.ring_buffer {
            debug(Component::Transcription, "Finalizing main recording file");
            if let Err(e) = ring_buffer.finalize_recording() {
                warn(Component::Transcription, &format!("Error finalizing recording: {}", e));
            }
        }
        
        // Cancel refinement task immediately to minimize latency
        if let Some(handle) = self.refinement_handle.take() {
            info(Component::Transcription, "Canceling background refinement to minimize latency");
            handle.abort(); // Cancel the task immediately
        }
        
        // Get all refined chunks
        let refined = self.refined_chunks.lock().await;
        let refined_count = refined.len();
        
        info(Component::Transcription, &format!(
            "Progressive transcription complete: {} Tiny chunks, {} Medium refinements", 
            chunks_processed, refined_count
        ));
        
        // For now, just return the Tiny model results
        // TODO: Implement smart merging of Tiny and Medium results
        let combined_text = tiny_chunks.join(" ");
        
        let transcription_time = transcription_start.elapsed();
        
        Ok(TranscriptionResult {
            text: combined_text,
            processing_time_ms: transcription_time.as_millis() as u64,
            strategy_used: self.name().to_string(),
            chunks_processed,
        })
    }
    
    fn get_partial_results(&self) -> Vec<String> {
        vec![] // TODO: Implement if needed
    }
    
    fn get_ring_buffer(&self) -> Option<Arc<crate::audio::ring_buffer_recorder::RingBufferRecorder>> {
        self.ring_buffer.clone()
    }
}

/// Strategy selector that chooses the best transcription approach
pub struct TranscriptionStrategySelector;

impl TranscriptionStrategySelector {
    /// Select the best strategy based on recording characteristics and config
    pub async fn select_strategy(
        duration_estimate: Option<std::time::Duration>,
        config: &TranscriptionConfig,
        transcriber: Arc<tokio::sync::Mutex<Transcriber>>,
        temp_dir: std::path::PathBuf,
        app_handle: Option<tauri::AppHandle>,
    ) -> Box<dyn TranscriptionStrategy> {
        // Check for forced strategy first
        if let Some(ref forced) = config.force_strategy {
            match forced.as_str() {
                "classic" => {
                    info(Component::Transcription, "Using forced classic strategy");
                    return Box::new(ClassicTranscriptionStrategy::new(transcriber));
                }
                "ring_buffer" => {
                    info(Component::Transcription, "Using forced ring buffer strategy");
                    let mut strategy = RingBufferTranscriptionStrategy::new(transcriber, temp_dir);
                    if let Some(app_handle) = app_handle {
                        strategy = strategy.with_app_handle(app_handle);
                    }
                    return Box::new(strategy);
                }
                "progressive" => {
                    info(Component::Transcription, "Using forced progressive strategy");
                    // temp_dir is already the models directory
                    let models_dir = &temp_dir;
                    match ProgressiveTranscriptionStrategy::new(models_dir, temp_dir.clone()).await {
                        Ok(mut strategy) => {
                            if let Some(app_handle) = app_handle {
                                strategy = strategy.with_app_handle(app_handle);
                            }
                            return Box::new(strategy);
                        }
                        Err(e) => {
                            warn(Component::Transcription, &format!("Failed to create progressive strategy: {}, falling back", e));
                        }
                    }
                }
                _ => {
                    warn(Component::Transcription, &format!("Unknown forced strategy '{}', falling back to auto-selection", forced));
                }
            }
        }
        
        // Auto-select based on characteristics
        debug(Component::Transcription, "Strategy selection debug:");
        debug(Component::Transcription, &format!("  Duration estimate: {:?}", duration_estimate));
        debug(Component::Transcription, &format!("  Enable chunking: {}", config.enable_chunking));
        debug(Component::Transcription, &format!("  Threshold: {}s", config.chunking_threshold_secs));
        
        // Try progressive strategy first if chunking is enabled AND both models exist
        if config.enable_chunking {
            info(Component::Transcription, "Chunking enabled, checking model availability for progressive strategy");
            // temp_dir is already the models directory
            let models_dir = &temp_dir;
            info(Component::Transcription, &format!("Models directory: {:?}", models_dir));
            
            // Check if both required models exist
            let tiny_path = models_dir.join("ggml-tiny.en.bin");
            let medium_path = models_dir.join("ggml-medium.en.bin");
            let tiny_exists = tiny_path.exists();
            let medium_exists = medium_path.exists();
            
            info(Component::Transcription, &format!("Tiny model exists: {}", tiny_exists));
            info(Component::Transcription, &format!("Medium model exists: {}", medium_exists));
            
            // Only attempt progressive strategy if BOTH models are available
            if tiny_exists && medium_exists {
                match ProgressiveTranscriptionStrategy::new(models_dir, temp_dir.clone()).await {
                    Ok(mut strategy) => {
                        if let Some(ref app_handle) = app_handle {
                            strategy = strategy.with_app_handle(app_handle.clone());
                        }
                        info(Component::Transcription, "Auto-selected progressive strategy (Tiny + Medium)");
                        return Box::new(strategy);
                    }
                    Err(e) => {
                        warn(Component::Transcription, &format!("Failed to create progressive strategy: {}, trying ring buffer", e));
                    }
                }
            } else {
                info(Component::Transcription, "Progressive strategy requires both Tiny and Medium models, falling back to ring buffer");
            }
        } else {
            info(Component::Transcription, "Chunking disabled, skipping progressive strategy");
        }
        
        // Fall back to ring buffer strategy
        let mut ring_buffer_strategy = RingBufferTranscriptionStrategy::new(transcriber.clone(), temp_dir.clone());
        if let Some(ref app_handle) = app_handle {
            ring_buffer_strategy = ring_buffer_strategy.with_app_handle(app_handle.clone());
        }
        let classic_strategy = ClassicTranscriptionStrategy::new(transcriber);
        
        let can_handle_ring = ring_buffer_strategy.can_handle(duration_estimate, config);
        debug(Component::Transcription, &format!("  Ring buffer can handle: {}", can_handle_ring));
        
        if can_handle_ring {
            info(Component::Transcription, "Auto-selected ring buffer strategy");
            Box::new(ring_buffer_strategy)
        } else {
            info(Component::Transcription, "Auto-selected classic strategy");
            Box::new(classic_strategy)
        }
    }
}