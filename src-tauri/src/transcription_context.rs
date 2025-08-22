use crate::db::Database;
use crate::logger::{debug, error, info, warn, Component};
use crate::model_state::ModelStateManager;
use crate::performance_logger::PerformanceLogger;
use crate::transcription::{
    Transcriber, TranscriptionConfig, TranscriptionResult, TranscriptionStrategy,
    TranscriptionStrategySelector,
};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Manages transcription strategy selection and execution
pub struct TranscriptionContext {
    transcriber: Arc<Mutex<Transcriber>>,
    temp_dir: PathBuf,
    config: TranscriptionConfig,
    current_strategy: Option<Box<dyn TranscriptionStrategy>>,
    performance_logger: Option<PerformanceLogger>,
    recording_start_time: Option<std::time::Instant>,
    model_name: String,
    app_handle: Option<tauri::AppHandle>,
    model_state_manager: Option<Arc<ModelStateManager>>,
    external_service_config: Option<crate::settings::ExternalServiceConfig>,
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
            model_name: "unknown".to_string(),
            app_handle: None,
            model_state_manager: None,
            external_service_config: None,
        }
    }

    pub fn with_app_handle(mut self, app_handle: tauri::AppHandle) -> Self {
        self.app_handle = Some(app_handle);
        self
    }

    /// Create a new TranscriptionContext from database and models directory with Core ML readiness check
    pub async fn new_from_db_with_readiness(
        database: Arc<Database>,
        models_dir: PathBuf,
        settings: &crate::settings::AppSettings,
        model_state_manager: Option<Arc<ModelStateManager>>,
    ) -> Result<Self, String> {
        // Get the active model path from settings
        let model_path = crate::models::WhisperModel::get_active_model_path(&models_dir, settings);

        // Verify the model exists
        if !model_path.exists() {
            warn(
                Component::Transcription,
                &format!(
                    "Active model not found: {:?}, falling back to any available model",
                    model_path
                ),
            );
            // Fall back to finding any available model
            let model_path = Self::find_model_file(&models_dir)?;
            let model_name = model_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unknown")
                .to_string();
            info(
                Component::Transcription,
                &format!("Using fallback model file: {:?}", model_path),
            );

            let transcriber = match Transcriber::get_or_create_cached_with_readiness(
                &model_path,
                model_state_manager.clone(),
            )
            .await
            {
                Ok(t) => t,
                Err(e) => {
                    warn(
                        Component::Transcription,
                        &format!("Failed to create transcriber: {}", e),
                    );
                    return Err(format!("Failed to create transcriber: {}", e));
                }
            };

            let performance_logger = PerformanceLogger::new(database);

            Ok(Self {
                transcriber,
                temp_dir: models_dir,
                config: TranscriptionConfig::default(),
                current_strategy: None,
                performance_logger: Some(performance_logger),
                recording_start_time: None,
                model_name,
                app_handle: None,
                model_state_manager,
                external_service_config: Some(settings.external_service.clone()),
            })
        } else {
            let model_name = model_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unknown")
                .to_string();
            info(
                Component::Transcription,
                &format!(
                    "Using model file: {:?} (from settings: {})",
                    model_path, settings.models.active_model_id
                ),
            );

            // Warn if using a slow model - CRITICAL for user experience
            if settings.models.active_model_id.contains("medium")
                || settings.models.active_model_id.contains("large")
            {
                error(
                    Component::Transcription,
                    &format!(
                        "🚨 CRITICAL: {} model is TOO SLOW for real-time use!",
                        settings.models.active_model_id
                    ),
                );
                error(
                    Component::Transcription,
                    "Expected: <2s delay | Actual: 2+ MINUTE delay for 10s audio",
                );
                warn(
                    Component::Transcription,
                    "STRONGLY RECOMMENDED: Switch to 'tiny.en' or 'base.en' model immediately",
                );
                
                // Log expected performance
                if settings.models.active_model_id.contains("large-v3-turbo") {
                    error(
                        Component::Transcription,
                        "large-v3-turbo: 15-20x SLOWER than real-time (2+ min for 10s audio)",
                    );
                } else if settings.models.active_model_id.contains("large") {
                    error(
                        Component::Transcription,
                        "large models: 2-3x slower than real-time (20-30s for 10s audio)",
                    );
                } else if settings.models.active_model_id.contains("medium") {
                    warn(
                        Component::Transcription,
                        "medium models: ~1x real-time (10s for 10s audio) - borderline slow",
                    );
                }
            }

            let transcriber = match Transcriber::get_or_create_cached_with_readiness(
                &model_path,
                model_state_manager.clone(),
            )
            .await
            {
                Ok(t) => t,
                Err(e) => {
                    warn(
                        Component::Transcription,
                        &format!("Failed to create transcriber: {}", e),
                    );
                    return Err(format!("Failed to create transcriber: {}", e));
                }
            };

            let performance_logger = PerformanceLogger::new(database);

            Ok(Self {
                transcriber,
                temp_dir: models_dir,
                config: TranscriptionConfig::default(),
                current_strategy: None,
                performance_logger: Some(performance_logger),
                recording_start_time: None,
                model_name,
                app_handle: None,
                model_state_manager,
                external_service_config: Some(settings.external_service.clone()),
            })
        }
    }

    /// Create a new TranscriptionContext from database and models directory
    pub async fn new_from_db(
        database: Arc<Database>,
        models_dir: PathBuf,
        settings: &crate::settings::AppSettings,
    ) -> Result<Self, String> {
        // Get the active model path from settings
        let model_path = crate::models::WhisperModel::get_active_model_path(&models_dir, settings);

        // Verify the model exists
        if !model_path.exists() {
            warn(
                Component::Transcription,
                &format!(
                    "Active model not found: {:?}, falling back to any available model",
                    model_path
                ),
            );
            // Fall back to finding any available model
            let model_path = Self::find_model_file(&models_dir)?;
            let model_name = model_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unknown")
                .to_string();
            info(
                Component::Transcription,
                &format!("Using fallback model file: {:?}", model_path),
            );

            let transcriber = match Transcriber::get_or_create_cached(&model_path).await {
                Ok(t) => t,
                Err(e) => {
                    warn(
                        Component::Transcription,
                        &format!("Failed to create transcriber: {}", e),
                    );
                    return Err(format!("Failed to create transcriber: {}", e));
                }
            };

            let performance_logger = PerformanceLogger::new(database);

            Ok(Self {
                transcriber,
                temp_dir: models_dir,
                config: TranscriptionConfig::default(),
                current_strategy: None,
                performance_logger: Some(performance_logger),
                recording_start_time: None,
                model_name,
                app_handle: None,
                model_state_manager: None,
                external_service_config: Some(settings.external_service.clone()),
            })
        } else {
            let model_name = model_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unknown")
                .to_string();
            info(
                Component::Transcription,
                &format!(
                    "Using model file: {:?} (from settings: {})",
                    model_path, settings.models.active_model_id
                ),
            );

            // Warn if using a slow model
            if settings.models.active_model_id.contains("medium")
                || settings.models.active_model_id.contains("large")
            {
                warn(Component::Transcription, &format!(
                    "WARNING: Using {} model which is SLOW (~1x realtime). Consider switching to 'tiny.en' (10x realtime) or 'base.en' (5x realtime) for better performance.",
                    settings.models.active_model_id
                ));
            }

            let transcriber = match Transcriber::get_or_create_cached(&model_path).await {
                Ok(t) => t,
                Err(e) => {
                    warn(
                        Component::Transcription,
                        &format!("Failed to create transcriber: {}", e),
                    );
                    return Err(format!("Failed to create transcriber: {}", e));
                }
            };

            let performance_logger = PerformanceLogger::new(database);

            Ok(Self {
                transcriber,
                temp_dir: models_dir,
                config: TranscriptionConfig::default(),
                current_strategy: None,
                performance_logger: Some(performance_logger),
                recording_start_time: None,
                model_name,
                app_handle: None,
                model_state_manager: None,
                external_service_config: Some(settings.external_service.clone()),
            })
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
            self.app_handle.clone(),
            self.model_state_manager.clone(),
            self.external_service_config.clone(),
        )
        .await;

        // Start recording with the selected strategy
        strategy.start_recording(output_path, &self.config).await?;

        info(
            Component::Transcription,
            &format!("Started recording with '{}' strategy", strategy.name()),
        );

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
            if let (Some(performance_logger), Some(start_time)) =
                (&self.performance_logger, self.recording_start_time)
            {
                let recording_duration = start_time.elapsed();

                // Log comprehensive performance data
                let _ = performance_logger
                    .log_transcription_performance(
                        None, // transcript_id - will be set later
                        recording_duration,
                        &result,
                        None,                   // audio_file_size - could be added later
                        Some("wav"),            // audio_format
                        None,                   // user_perceived_latency - could be calculated
                        None,                   // processing_queue_time
                        Some(&self.model_name), // model_used
                    )
                    .await;
            }

            info(
                Component::Transcription,
                &format!(
                    "Transcription completed using '{}' strategy with '{}' model in {}ms",
                    result.strategy_used, self.model_name, result.processing_time_ms
                ),
            );

            if result.chunks_processed > 1 {
                debug(
                    Component::Transcription,
                    &format!("Processed {} chunks", result.chunks_processed),
                );
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

    /// Get the name of the model being used
    pub fn get_model_name(&self) -> &str {
        &self.model_name
    }

    pub fn get_ring_buffer(
        &self,
    ) -> Option<std::sync::Arc<crate::audio::ring_buffer_recorder::RingBufferRecorder>> {
        if let Some(strategy) = &self.current_strategy {
            strategy.get_ring_buffer()
        } else {
            None
        }
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

        let mut ctx = Self::new(transcriber, temp_dir, Some(config));
        ctx.model_state_manager = None;
        ctx.external_service_config = None;
        ctx
    }

    /// Find the best available model file in the models directory
    fn find_model_file(models_dir: &Path) -> Result<PathBuf, String> {
        // Preferred model order (fastest to slowest, smallest to largest)
        let preferred_models = [
            "ggml-tiny.en.bin",
            "ggml-base.en.bin",
            "ggml-small.en.bin",
            "ggml-medium.en.bin",
            "ggml-large.bin",
        ];

        for model_name in &preferred_models {
            let model_path = models_dir.join(model_name);
            if model_path.exists() {
                debug(
                    Component::Transcription,
                    &format!("Found model: {}", model_name),
                );
                return Ok(model_path);
            }
        }

        // If no preferred models found, look for any .bin file
        if let Ok(entries) = std::fs::read_dir(models_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("bin") {
                    debug(
                        Component::Transcription,
                        &format!("Found fallback model: {:?}", path.file_name()),
                    );
                    return Ok(path);
                }
            }
        }

        Err(format!(
            "No whisper model files found in {:?}. Please download models first.",
            models_dir
        ))
    }
}
