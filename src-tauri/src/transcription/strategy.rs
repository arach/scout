use std::sync::Arc;
use std::path::Path;
use async_trait::async_trait;
use crate::transcription::Transcriber;
use crate::logger::{info, debug, warn, error, Component};

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
}

impl Default for TranscriptionConfig {
    fn default() -> Self {
        Self {
            enable_chunking: true,
            chunking_threshold_secs: 10,
            chunk_duration_secs: 10,
            force_strategy: None,
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
        }
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
        
        // Initialize ring buffer recorder with 5-minute capacity
        // Match the audio recorder's configuration (mono, 48kHz)
        let spec = hound::WavSpec {
            channels: 1,     // Mono recording to match AudioRecorder
            sample_rate: 48000, // 48kHz sample rate
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
        let monitor = crate::ring_buffer_monitor::RingBufferMonitor::new(ring_buffer.clone());
        let (monitor_handle, stop_sender) = monitor.start_monitoring(
            ring_transcriber,
        ).await;
        
        self.ring_buffer = Some(ring_buffer);
        self.ring_transcriber = None; // Monitor owns the transcriber
        self.monitor_handle = Some((monitor_handle, stop_sender));
        
        println!("✅ Ring buffer components initialized - ready for 5-second interval processing");
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
        
        println!("🎯 Finishing ring buffer transcription with real-time chunks");
        let transcription_start = std::time::Instant::now();
        
        // Stop the monitor and collect results
        let mut final_chunks = Vec::new();
        let mut chunks_processed = 0;
        
        if let Some((monitor_handle, stop_sender)) = self.monitor_handle.take() {
            println!("🛑 Stopping ring buffer monitor...");
            
            // Signal monitor to stop
            let _ = stop_sender.send(()).await;
            
            // Wait for monitor to finish
            match monitor_handle.await {
                Ok(monitor) => {
                    println!("📊 Monitor stopped, collecting chunk results");
                    
                    // Collect all transcribed chunks
                    match monitor.recording_complete().await {
                        Ok(chunk_results) => {
                            final_chunks = chunk_results;
                            chunks_processed = final_chunks.len();
                            println!("✅ Collected {} transcribed chunks from ring buffer", chunks_processed);
                        }
                        Err(e) => {
                            println!("⚠️ Error collecting chunk results: {}", e);
                            // Continue with fallback instead of failing
                        }
                    }
                }
                Err(e) => {
                    println!("⚠️ Error stopping monitor: {}", e);
                }
            }
        } else {
            println!("⚠️ No monitor handle found - this should not happen");
        }
        
        // Finalize the main recording file
        if let Some(ref ring_buffer) = self.ring_buffer {
            println!("💾 Finalizing main recording file");
            if let Err(e) = ring_buffer.finalize_recording() {
                println!("⚠️ Error finalizing recording: {}", e);
            }
        }
        
        let transcription_time = transcription_start.elapsed();
        
        println!("🔍 Ring buffer processing complete - {} chunks collected", chunks_processed);
        
        // Combine all chunk transcriptions
        let combined_text = if final_chunks.is_empty() {
            // If no chunks were collected from the monitor, try fallback
            println!("📝 No chunks collected from ring buffer - checking if fallback is needed");
            
            // Check if the recording was too short for chunking
            let total_recording_time = transcription_start.elapsed();
            if total_recording_time < std::time::Duration::from_secs(5) {
                println!("⏱️ Recording was too short for chunking ({:.1}s) - using full file transcription", 
                         total_recording_time.as_secs_f64());
            }
            
            // Wait for file to be fully written by the AudioRecorder
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            
            // Check if file exists and has content
            if !recording_path.exists() {
                println!("⚠️ Recording file does not exist at: {:?}", recording_path);
                return Err("Recording file does not exist for fallback transcription".to_string());
            }
            
            let file_size = std::fs::metadata(&recording_path)
                .map_err(|e| format!("Failed to read file metadata: {}", e))?
                .len();
                
            if file_size < 1000 { // Less than 1KB is likely empty
                return Err(format!("Audio file too small for transcription ({} bytes)", file_size));
            }
            
            println!("📁 Fallback: Processing {} byte audio file", file_size);
            
            let transcriber = self.transcriber.lock().await;
            match transcriber.transcribe(&recording_path) {
                Ok(text) => {
                    println!("✅ Fallback transcription successful: {} chars", text.len());
                    text
                },
                Err(e) => return Err(format!("Fallback transcription failed: {}", e)),
            }
        } else {
            // Join all chunk results with spaces
            println!("🔗 Joining {} chunks into final transcript", final_chunks.len());
            let combined = final_chunks.join(" ");
            println!("📝 Combined transcript: {} chars", combined.len());
            println!("📝 First 100 chars: {}", combined.chars().take(100).collect::<String>());
            combined
        };
        
        println!("✅ Ring buffer transcription completed: {} chars from {} chunks in {:.2}s", 
                 combined_text.len(), chunks_processed, transcription_time.as_secs_f64());
        
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

/// Strategy selector that chooses the best transcription approach
pub struct TranscriptionStrategySelector;

impl TranscriptionStrategySelector {
    /// Select the best strategy based on recording characteristics and config
    pub fn select_strategy(
        duration_estimate: Option<std::time::Duration>,
        config: &TranscriptionConfig,
        transcriber: Arc<tokio::sync::Mutex<Transcriber>>,
        temp_dir: std::path::PathBuf,
    ) -> Box<dyn TranscriptionStrategy> {
        // Check for forced strategy first
        if let Some(ref forced) = config.force_strategy {
            match forced.as_str() {
                "classic" => {
                    println!("🎯 Using forced classic strategy");
                    return Box::new(ClassicTranscriptionStrategy::new(transcriber));
                }
                "ring_buffer" => {
                    println!("🔄 Using forced ring buffer strategy");
                    return Box::new(RingBufferTranscriptionStrategy::new(transcriber, temp_dir));
                }
                _ => {
                    println!("⚠️  Unknown forced strategy '{}', falling back to auto-selection", forced);
                }
            }
        }
        
        // Auto-select based on characteristics
        let ring_buffer_strategy = RingBufferTranscriptionStrategy::new(transcriber.clone(), temp_dir);
        let classic_strategy = ClassicTranscriptionStrategy::new(transcriber);
        
        println!("🔍 Strategy selection debug:");
        println!("  Duration estimate: {:?}", duration_estimate);
        println!("  Enable chunking: {}", config.enable_chunking);
        println!("  Threshold: {}s", config.chunking_threshold_secs);
        
        let can_handle_ring = ring_buffer_strategy.can_handle(duration_estimate, config);
        println!("  Ring buffer can handle: {}", can_handle_ring);
        
        if can_handle_ring {
            println!("🔄 Auto-selected ring buffer strategy");
            Box::new(ring_buffer_strategy)
        } else {
            println!("🎯 Auto-selected classic strategy");
            Box::new(classic_strategy)
        }
    }
}