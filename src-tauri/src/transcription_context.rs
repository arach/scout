use std::sync::Arc;
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;
use crate::transcription::{
    Transcriber, 
    TranscriptionStrategy, 
    TranscriptionConfig, 
    TranscriptionResult, 
    TranscriptionStrategySelector
};
use crate::db::Database;
use crate::performance_logger::PerformanceLogger;

/// Manages transcription strategy selection and execution
pub struct TranscriptionContext {
    transcriber: Arc<Mutex<Transcriber>>,
    temp_dir: PathBuf,
    config: TranscriptionConfig,
    current_strategy: Option<Box<dyn TranscriptionStrategy>>,
    performance_logger: Option<PerformanceLogger>,
    recording_start_time: Option<std::time::Instant>,
}

impl TranscriptionContext {
    pub fn new(
        transcriber: Arc<Mutex<Transcriber>>,
        temp_dir: PathBuf,
        config: Option<TranscriptionConfig>,
    ) -> Self {
        Self {
            transcriber,
            temp_dir,
            config: config.unwrap_or_default(),
            current_strategy: None,
            performance_logger: None,
            recording_start_time: None,
        }
    }
    
    /// Create a new TranscriptionContext from database and models directory
    pub fn new_from_db(
        database: Arc<Database>,
        models_dir: PathBuf,
    ) -> Self {
        let transcriber = Arc::new(Mutex::new(
            Transcriber::new(&models_dir)
                .unwrap_or_else(|_| panic!("Failed to create transcriber"))
        ));
        
        let performance_logger = PerformanceLogger::new(database);
        
        Self {
            transcriber,
            temp_dir: models_dir,
            config: TranscriptionConfig::default(),
            current_strategy: None,
            performance_logger: Some(performance_logger),
            recording_start_time: None,
        }
    }
    
    /// Update transcription configuration
    pub fn update_config(&mut self, config: TranscriptionConfig) {
        self.config = config;
    }
    
    /// Start a new recording with automatic strategy selection
    pub async fn start_recording(
        &mut self,
        output_path: &Path,
        duration_estimate: Option<std::time::Duration>,
    ) -> Result<(), String> {
        // Record start time for performance tracking
        self.recording_start_time = Some(std::time::Instant::now());
        
        // Select the appropriate strategy
        let mut strategy = TranscriptionStrategySelector::select_strategy(
            duration_estimate,
            &self.config,
            self.transcriber.clone(),
            self.temp_dir.clone(),
        );
        
        // Start recording with the selected strategy
        strategy.start_recording(output_path, &self.config).await?;
        
        println!("🎙️  Started recording with '{}' strategy", strategy.name());
        
        self.current_strategy = Some(strategy);
        Ok(())
    }
    
    /// Process audio samples during recording (for real-time strategies)
    pub async fn process_samples(&mut self, samples: &[f32]) -> Result<(), String> {
        if let Some(ref mut strategy) = self.current_strategy {
            strategy.process_samples(samples).await?;
        }
        Ok(())
    }
    
    /// Get partial results if available
    pub fn get_partial_results(&self) -> Vec<String> {
        if let Some(ref strategy) = self.current_strategy {
            strategy.get_partial_results()
        } else {
            vec![]
        }
    }
    
    /// Finish recording and get final transcription result
    pub async fn finish_recording(&mut self) -> Result<TranscriptionResult, String> {
        if let Some(mut strategy) = self.current_strategy.take() {
            let result = strategy.finish_recording().await?;
            
            // Log performance metrics if available
            if let (Some(performance_logger), Some(start_time)) = (&self.performance_logger, self.recording_start_time) {
                let recording_duration = start_time.elapsed();
                
                // Log comprehensive performance data
                let _ = performance_logger.log_transcription_performance(
                    None, // transcript_id - will be set later
                    recording_duration,
                    &result,
                    None, // audio_file_size - could be added later
                    Some("wav"), // audio_format
                    None, // user_perceived_latency - could be calculated
                    None, // processing_queue_time
                    Some("ggml-tiny.en.bin"), // model_used - could get from config
                ).await;
            }
            
            println!("✅ Transcription completed using '{}' strategy in {}ms", 
                     result.strategy_used, result.processing_time_ms);
            
            if result.chunks_processed > 1 {
                println!("📊 Processed {} chunks", result.chunks_processed);
            }
            
            // Reset start time
            self.recording_start_time = None;
            
            Ok(result)
        } else {
            Err("No active recording to finish".to_string())
        }
    }
    
    /// Check if a recording is currently active
    pub fn is_recording_active(&self) -> bool {
        self.current_strategy.is_some()
    }
    
    /// Get the name of the currently active strategy
    pub fn current_strategy_name(&self) -> Option<String> {
        self.current_strategy.as_ref().map(|s| s.name().to_string())
    }
    
    /// Force a specific strategy for testing
    pub fn force_strategy(&mut self, strategy_name: &str) {
        self.config.force_strategy = Some(strategy_name.to_string());
    }
    
    /// Enable or disable chunking
    pub fn set_chunking_enabled(&mut self, enabled: bool) {
        self.config.enable_chunking = enabled;
    }
    
    /// Set chunking threshold
    pub fn set_chunking_threshold(&mut self, threshold_secs: u64) {
        self.config.chunking_threshold_secs = threshold_secs;
    }
    
    /// Get current configuration
    pub fn get_config(&self) -> &TranscriptionConfig {
        &self.config
    }
    
    /// Create a context for testing with specific settings
    pub fn for_testing(
        transcriber: Arc<Mutex<Transcriber>>,
        temp_dir: PathBuf,
        force_strategy: Option<&str>,
    ) -> Self {
        let mut config = TranscriptionConfig::default();
        config.force_strategy = force_strategy.map(|s| s.to_string());
        
        Self::new(transcriber, temp_dir, Some(config))
    }
}