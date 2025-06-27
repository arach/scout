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

/// Manages transcription strategy selection and execution
pub struct TranscriptionContext {
    transcriber: Arc<Mutex<Transcriber>>,
    temp_dir: PathBuf,
    config: TranscriptionConfig,
    current_strategy: Option<Box<dyn TranscriptionStrategy>>,
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
            
            println!("✅ Transcription completed using '{}' strategy in {}ms", 
                     result.strategy_used, result.processing_time_ms);
            
            if result.chunks_processed > 1 {
                println!("📊 Processed {} chunks", result.chunks_processed);
            }
            
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