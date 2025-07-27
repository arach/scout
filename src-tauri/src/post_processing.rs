use std::sync::Arc;
use tokio::time::{sleep, Duration};
use crate::settings::SettingsManager;
use crate::profanity_filter::ProfanityFilter;
use crate::performance_metrics_service::{PerformanceMetricsService, TranscriptionPerformanceData};
use crate::db::Database;
use crate::logger::{info, error, debug, Component};
use crate::llm::{CandleEngine, LLMEngine, GenerationOptions, ModelManager, PromptManager};
use crate::llm::pipeline::LLMPipeline;
use crate::dictionary_processor::DictionaryProcessor;
use std::path::PathBuf;

/// Post-processing hooks that run after successful transcription
pub struct PostProcessingHooks {
    settings: Arc<tokio::sync::Mutex<SettingsManager>>,
    performance_service: PerformanceMetricsService,
    database: Arc<Database>,
    llm_pipeline: Option<Arc<LLMPipeline>>,
    models_dir: PathBuf,
}

impl PostProcessingHooks {
    pub fn new(settings: Arc<tokio::sync::Mutex<SettingsManager>>, database: Arc<Database>) -> Self {
        // TODO: Get models_dir from app state
        let models_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("scout")
            .join("models")
            .join("llm");
            
        Self { 
            settings: settings.clone(),
            performance_service: PerformanceMetricsService::new(database.clone()),
            database,
            llm_pipeline: None,
            models_dir,
        }
    }

    /// Execute all post-processing hooks for a completed transcription
    /// Returns (filtered_transcript, original_transcript, analysis_logs)
    pub async fn execute_hooks(&self, transcript: &str, source: &str, recording_duration_ms: Option<i32>, transcript_id: Option<i64>) -> (String, String, Vec<String>) {
        info(Component::Processing, &format!("🎯 {} transcription successful - executing post-processing hooks", source));
        
        let original_transcript = transcript.to_string();
        
        // Execute dictionary replacements first (before other processing)
        let dictionary_processor = DictionaryProcessor::new(self.database.clone());
        let (dict_processed_transcript, dict_matches) = match dictionary_processor.process_transcript(transcript, transcript_id).await {
            Ok((processed, matches)) => {
                if !matches.is_empty() {
                    info(Component::Processing, &format!("📖 Dictionary processing: {} replacements made", matches.len()));
                }
                (processed, matches)
            }
            Err(e) => {
                error(Component::Processing, &format!("❌ Dictionary processing failed: {}", e));
                (transcript.to_string(), vec![])
            }
        };
        
        // Execute profanity filtering on dictionary-processed transcript
        let (filtered_transcript, analysis_logs) = self.execute_profanity_filter(&dict_processed_transcript, recording_duration_ms).await;
        
        // Execute auto-copy/paste hooks with filtered transcript
        self.execute_clipboard_hooks(&filtered_transcript).await;
        
        // Execute LLM processing if enabled
        // Note: This is async and non-blocking - results will be stored in database
        if let Some(transcript_id) = transcript_id {
            self.execute_llm_processing(&filtered_transcript, transcript_id).await;
        }
        
        (filtered_transcript, original_transcript, analysis_logs)
    }

    /// Execute profanity filtering on the transcript
    async fn execute_profanity_filter(&self, transcript: &str, recording_duration_ms: Option<i32>) -> (String, Vec<String>) {
        let settings_guard = self.settings.lock().await;
        let profanity_filter_enabled = settings_guard.get().ui.profanity_filter_enabled;
        let profanity_filter_aggressive = settings_guard.get().ui.profanity_filter_aggressive;
        drop(settings_guard);
        
        if !profanity_filter_enabled {
            info(Component::Processing, "🔍 Profanity filter is disabled");
            return (transcript.to_string(), vec![]);
        }
        
        info(Component::Processing, &format!("🔍 Profanity filter enabled (aggressive: {}) - scanning transcript", profanity_filter_aggressive));
        
        let filter = ProfanityFilter::new();
        let result = filter.filter_transcript(transcript, recording_duration_ms);
        
        if result.profanity_detected {
            if result.likely_hallucination {
                info(Component::Processing, &format!("🚫 Filtered likely hallucination: {} items removed", result.flagged_words.len()));
                // Keep detailed comparison in debug logs only
                debug(Component::Processing, &format!(
                    "Profanity filter details - Original: '{}' → Filtered: '{}' | Flagged: {:?}",
                    transcript, result.filtered_text, result.flagged_words
                ));
            } else {
                info(Component::Processing, &format!("✅ Preserved intentional profanity: {} items detected", result.flagged_words.len()));
                if profanity_filter_aggressive {
                    info(Component::Processing, "🚫 Aggressive filtering enabled - filtering anyway");
                    return (result.filtered_text, result.analysis_logs);
                }
            }
        } else {
            info(Component::Processing, "✅ No profanity detected in transcript");
        }
        
        (result.filtered_text, result.analysis_logs)
    }

    /// Handle auto-copy and auto-paste functionality
    async fn execute_clipboard_hooks(&self, transcript: &str) {
        let settings_guard = self.settings.lock().await;
        let auto_copy = settings_guard.get().ui.auto_copy;
        let auto_paste = settings_guard.get().ui.auto_paste;
        drop(settings_guard);
        
        info(Component::Processing, &format!("📋 Clipboard Settings - Auto-copy: {}, Auto-paste: {}", auto_copy, auto_paste));
        
        if auto_copy {
            info(Component::Processing, "📋 Auto-copy is enabled, copying transcript to clipboard");
            match crate::clipboard::copy_to_clipboard(transcript) {
                Ok(()) => {
                    info(Component::Processing, "✅ Auto-copy completed successfully");
                }
                Err(e) => {
                    error(Component::Processing, &format!("❌ Auto-copy failed: {}", e));
                }
            }
        } else {
            info(Component::Processing, "📋 Auto-copy is disabled");
        }
        
        if auto_paste {
            info(Component::Processing, "🖱️ Auto-paste is enabled, attempting to paste transcript");
            
            // Ensure transcript is not empty
            if transcript.trim().is_empty() {
                error(Component::Processing, "❌ Cannot auto-paste empty transcript");
            } else {
                info(Component::Processing, &format!("📝 Transcript ready for pasting: '{}' ({} characters)", transcript.trim(), transcript.len()));
                
                // Copy to clipboard first (required for paste)
                let copy_result = if !auto_copy {
                    info(Component::Processing, "📋 Auto-copy was disabled, copying transcript for auto-paste");
                    crate::clipboard::copy_to_clipboard(transcript)
                } else {
                    info(Component::Processing, "📋 Auto-copy already completed, proceeding with paste");
                    Ok(()) // Auto-copy already happened
                };
                
                match copy_result {
                    Ok(()) => {
                        // Longer delay to ensure clipboard is ready and system is responsive
                        info(Component::Processing, "⏱️ Waiting 500ms for clipboard to be ready...");
                        sleep(Duration::from_millis(500)).await;
                        
                        // Attempt to paste with retry logic
                        let mut paste_attempts = 0;
                        let max_attempts = 3;
                        
                        info(Component::Processing, &format!("🔄 Starting paste retry loop (max {} attempts)", max_attempts));
                        
                        while paste_attempts < max_attempts {
                            paste_attempts += 1;
                            info(Component::Processing, &format!("🖱️ Paste attempt {} of {}", paste_attempts, max_attempts));
                            
                            match crate::clipboard::simulate_paste() {
                                Ok(()) => {
                                    info(Component::Processing, "✅ Auto-paste completed successfully");
                                    break;
                                }
                                Err(e) => {
                                    if paste_attempts < max_attempts {
                                        error(Component::Processing, &format!("❌ Paste attempt {} failed: {}, retrying in 200ms...", paste_attempts, e));
                                        sleep(Duration::from_millis(200)).await;
                                    } else {
                                        error(Component::Processing, &format!("❌ Auto-paste failed after {} attempts: {}", max_attempts, e));
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error(Component::Processing, &format!("❌ Failed to copy transcript for auto-paste: {}", e));
                    }
                }
            }
        } else {
            info(Component::Processing, "🖱️ Auto-paste is disabled");
        }
    }

    /// Save performance metrics for a completed transcription
    pub async fn save_performance_metrics(
        &self, 
        transcript_id: i64,
        performance_data: TranscriptionPerformanceData
    ) -> Result<i64, String> {
        // Log performance analysis
        self.performance_service.log_performance_analysis(&performance_data);
        
        // Save to database
        self.performance_service.save_transcription_metrics(transcript_id, performance_data).await
    }
    
    /// Execute LLM processing on the transcript
    pub async fn execute_llm_processing(&self, transcript: &str, transcript_id: i64) {
        let settings_guard = self.settings.lock().await;
        let llm_enabled = settings_guard.get().llm.enabled;
        let model_id = settings_guard.get().llm.model_id.clone();
        let enabled_prompts = settings_guard.get().llm.enabled_prompts.clone();
        let temperature = settings_guard.get().llm.temperature;
        let max_tokens = settings_guard.get().llm.max_tokens;
        drop(settings_guard);
        
        if !llm_enabled {
            debug(Component::Processing, "🤖 LLM processing is disabled");
            return;
        }
        
        info(Component::Processing, &format!("🤖 LLM processing enabled with model: {}", model_id));
        
        // Initialize LLM pipeline if not already done
        if self.llm_pipeline.is_none() {
            match self.initialize_llm_pipeline(&model_id).await {
                Ok(_pipeline) => {
                    // This is a bit hacky, but we need to work around the immutable self
                    // In production, you'd want to use interior mutability pattern
                    info(Component::Processing, "✅ LLM pipeline initialized successfully");
                    // For now, we'll create a new pipeline each time
                },
                Err(e) => {
                    error(Component::Processing, &format!("❌ Failed to initialize LLM pipeline: {}", e));
                    return;
                }
            }
        }
        
        // Create a new pipeline for this processing
        // TODO: Cache the pipeline properly
        match self.initialize_llm_pipeline(&model_id).await {
            Ok(pipeline) => {
                let prompt_manager = PromptManager::new();
                let templates: Vec<_> = enabled_prompts.iter()
                    .filter_map(|id| prompt_manager.get_template(id))
                    .collect();
                
                if templates.is_empty() {
                    info(Component::Processing, "No enabled LLM prompts found");
                    return;
                }
                
                info(Component::Processing, &format!("Processing transcript with {} prompts", templates.len()));
                
                let options = GenerationOptions {
                    temperature,
                    max_tokens: max_tokens as usize,
                    ..Default::default()
                };
                
                // Process transcript with LLM
                match pipeline.process_transcript(transcript_id, transcript, &templates, options).await {
                    Ok(outputs) => {
                        info(Component::Processing, &format!("✅ LLM processing completed with {} outputs", outputs.len()));
                        
                        // Save outputs to database
                        for output in outputs {
                            if let Err(e) = self.database.save_llm_output(
                                output.transcript_id,
                                &output.prompt_id,
                                &output.prompt_name,
                                &templates.iter().find(|t| t.id == output.prompt_id)
                                    .map(|t| t.template.as_str()).unwrap_or(""),
                                &output.input_text,
                                &output.output_text,
                                &output.model_used,
                                output.processing_time_ms as i32,
                                self.settings.lock().await.get().llm.temperature,
                                self.settings.lock().await.get().llm.max_tokens as i32,
                                None,
                            ).await {
                                error(Component::Processing, &format!("Failed to save LLM output: {}", e));
                            }
                        }
                    }
                    Err(e) => {
                        error(Component::Processing, &format!("❌ LLM processing failed: {}", e));
                    }
                }
            }
            Err(e) => {
                error(Component::Processing, &format!("❌ Failed to create LLM pipeline: {}", e));
            }
        }
    }
    
    async fn initialize_llm_pipeline(&self, model_id: &str) -> Result<LLMPipeline, String> {
        info(Component::Processing, "Initializing LLM pipeline...");
        
        let model_manager = ModelManager::new(self.models_dir.clone());
        
        // Check if model is downloaded
        if let Some(model_path) = model_manager.get_model_path(model_id) {
            // Create Candle engine
            let mut engine = CandleEngine::new()
                .map_err(|e| format!("Failed to create Candle engine: {}", e))?;
            
            // Load model
            engine.load_model(&model_path).await
                .map_err(|e| format!("Failed to load model: {}", e))?;
            
            Ok(LLMPipeline::new(Box::new(engine)))
        } else {
            // Model not downloaded
            let models = model_manager.list_models(model_id);
            if let Some(model) = models.iter().find(|m| m.id == model_id) {
                info(Component::Processing, &format!("Model {} not downloaded, downloading now...", model_id));
                
                // Download model
                model_manager.download_model(model).await
                    .map_err(|e| format!("Failed to download model: {}", e))?;
                
                // Try again after download
                if let Some(model_path) = model_manager.get_model_path(model_id) {
                    let mut engine = CandleEngine::new()
                        .map_err(|e| format!("Failed to create Candle engine: {}", e))?;
                    
                    engine.load_model(&model_path).await
                        .map_err(|e| format!("Failed to load model: {}", e))?;
                    
                    Ok(LLMPipeline::new(Box::new(engine)))
                } else {
                    Err("Model download succeeded but model path not found".to_string())
                }
            } else {
                Err(format!("Model {} not found", model_id))
            }
        }
    }
}