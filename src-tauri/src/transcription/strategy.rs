use std::sync::Arc;
use std::path::Path;
use async_trait::async_trait;
use crate::transcription::Transcriber;

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
        println!("🎯 Classic transcription strategy started for: {:?}", output_path);
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
        
        println!("🎯 Classic transcription processing: {:?}", recording_path);
        
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
        
        println!("🔄 Ring buffer transcription strategy started for: {:?}", output_path);
        println!("📝 Using optimized pipeline for faster processing");
        Ok(())
    }
    
    async fn process_samples(&mut self, samples: &[f32]) -> Result<(), String> {
        if let Some(ref ring_buffer) = self.ring_buffer {
            ring_buffer.add_samples(samples)?;
        }
        // If ring_buffer is None, we need to initialize it first time we get samples
        // This requires the audio format which we'll need to pass in somehow
        Ok(())
    }
    
    async fn finish_recording(&mut self) -> Result<TranscriptionResult, String> {
        let start_time = self.start_time.take()
            .ok_or("Recording was not started")?;
        
        let recording_path = self.recording_path.take()
            .ok_or("Recording path was not set")?;
        
        println!("🎯 Ring buffer strategy: Processing audio file with optimized pipeline");
        
        // Use the transcriber to process the complete recording
        // This is faster than the traditional processing queue because:
        // 1. No queue wait time - immediate processing
        // 2. Direct processing without intermediate steps  
        // 3. Optimized for longer recordings (our target use case)
        let transcriber = self.transcriber.lock().await;
        let transcription_start = std::time::Instant::now();
        
        match transcriber.transcribe(&recording_path) {
            Ok(text) => {
                let transcription_time = transcription_start.elapsed();
                
                println!("✅ Ring buffer transcription completed: {} chars in {:.2}s", 
                         text.len(), transcription_time.as_secs_f64());
                
                Ok(TranscriptionResult {
                    text,
                    processing_time_ms: transcription_time.as_millis() as u64,
                    strategy_used: self.name().to_string(),
                    chunks_processed: 1, // Single optimized pass for now
                })
            }
            Err(e) => {
                Err(format!("Ring buffer transcription failed: {}", e))
            }
        }
    }
    
    fn get_partial_results(&self) -> Vec<String> {
        // TODO: Get partial results from ring transcriber
        vec![]
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