use crate::audio::WhisperAudioConverter;
use crate::logger::{info, warn, Component};
use crate::model_state::ModelStateManager;
use once_cell::sync::Lazy;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub mod ring_buffer_transcriber;
pub mod strategy;

pub use strategy::{
    TranscriptionConfig, TranscriptionResult, TranscriptionStrategy, TranscriptionStrategySelector,
};

// Global cache for transcriber instances to avoid CoreML reinitialization
// Changed from single instance to HashMap to support multiple models
static TRANSCRIBER_CACHE: Lazy<
    Arc<Mutex<std::collections::HashMap<PathBuf, Arc<Mutex<Transcriber>>>>>,
> = Lazy::new(|| Arc::new(Mutex::new(std::collections::HashMap::new())));

// Global mutex to serialize CoreML state creation and prevent concurrent initialization deadlocks
static COREML_INIT_LOCK: Lazy<std::sync::Mutex<()>> = Lazy::new(|| std::sync::Mutex::new(()));

pub struct Transcriber {
    context: WhisperContext,
}

impl Transcriber {
    /// Get or create a cached transcriber instance with Core ML readiness check
    pub async fn get_or_create_cached_with_readiness(
        model_path: &Path,
        model_state_manager: Option<Arc<ModelStateManager>>,
    ) -> Result<Arc<Mutex<Self>>, String> {
        // Extract model ID from path
        let model_id = model_path
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| s.strip_prefix("ggml-"))
            .unwrap_or("");

        // Check if Core ML is ready
        let use_coreml = if let Some(manager) = &model_state_manager {
            manager.should_use_coreml(model_id).await
        } else {
            true // Default behavior if no manager
        };

        if !use_coreml {
            info(
                Component::Transcription,
                &format!("Core ML not ready for {}, using CPU-only mode", model_id),
            );
        }

        let mut cache = TRANSCRIBER_CACHE.lock().await;

        // Create a cache key that includes Core ML readiness
        let cache_key = if use_coreml {
            model_path.to_path_buf()
        } else {
            // Use a different cache key for CPU-only mode
            model_path
                .parent()
                .map(|p| {
                    p.join(format!(
                        "{}_cpu_only",
                        model_path.file_name().unwrap_or_default().to_string_lossy()
                    ))
                })
                .unwrap_or_else(|| model_path.to_path_buf())
        };

        // Check if we have a cached transcriber for this configuration
        if let Some(cached_transcriber) = cache.get(&cache_key) {
            info(
                Component::Transcription,
                &format!(
                    "Reusing cached transcriber instance for {:?} (Core ML: {})",
                    model_path, use_coreml
                ),
            );
            return Ok(cached_transcriber.clone());
        }

        // Create new transcriber
        info(
            Component::Transcription,
            &format!(
                "Creating new transcriber for model: {:?} (Core ML enabled: {})",
                model_path, use_coreml
            ),
        );

        let transcriber = if use_coreml {
            Self::new(model_path)?
        } else {
            Self::new_cpu_only(model_path)?
        };

        let transcriber_arc = Arc::new(Mutex::new(transcriber));

        // Update cache
        cache.insert(cache_key, transcriber_arc.clone());
        info(
            Component::Transcription,
            &format!(
                "Cached transcriber for {:?}. Total cached models: {}",
                model_path,
                cache.len()
            ),
        );

        Ok(transcriber_arc)
    }

    /// Get or create a cached transcriber instance to avoid CoreML reinitialization
    pub async fn get_or_create_cached(model_path: &Path) -> Result<Arc<Mutex<Self>>, String> {
        let mut cache = TRANSCRIBER_CACHE.lock().await;

        // Check if we have a cached transcriber for this model
        if let Some(cached_transcriber) = cache.get(model_path) {
            info(
                Component::Transcription,
                &format!("Reusing cached transcriber instance for {:?}", model_path),
            );
            return Ok(cached_transcriber.clone());
        }

        // Create new transcriber
        info(
            Component::Transcription,
            &format!("Creating new transcriber for model: {:?}", model_path),
        );
        let transcriber = Self::new(model_path)?;
        let transcriber_arc = Arc::new(Mutex::new(transcriber));

        // Update cache
        cache.insert(model_path.to_path_buf(), transcriber_arc.clone());
        info(
            Component::Transcription,
            &format!(
                "Cached transcriber for {:?}. Total cached models: {}",
                model_path,
                cache.len()
            ),
        );

        Ok(transcriber_arc)
    }

    pub fn new(model_path: &Path) -> Result<Self, String> {
        let model_path_str = model_path.to_str().ok_or("Invalid model path")?;

        // Check if Core ML model exists alongside GGML model
        let model_stem = model_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        let coreml_path = model_path
            .parent()
            .map(|p| p.join(format!("{}-encoder.mlmodelc", model_stem)))
            .unwrap_or_default();

        let has_coreml = coreml_path.exists();

        info(
            Component::Transcription,
            &format!(
                "Initializing model: {} (Core ML available: {})",
                model_path.file_name().unwrap_or_default().to_string_lossy(),
                has_coreml
            ),
        );

        // Try Core ML first (faster, more efficient on macOS)
        let context = match WhisperContext::new_with_params(
            model_path_str,
            WhisperContextParameters::default(), // Uses Core ML on macOS if available
        ) {
            Ok(ctx) => {
                if has_coreml {
                    info(
                        Component::Transcription,
                        "✅ Core ML acceleration enabled - using Apple Neural Engine",
                    );
                    info(
                        Component::Transcription,
                        "Expected performance: 3x+ faster encoder, 1.5-2x overall speedup",
                    );
                } else {
                    info(
                        Component::Transcription,
                        "⚠️ Core ML model not found - using CPU mode",
                    );
                    info(
                        Component::Transcription,
                        &format!("To enable Core ML, download: {}", coreml_path.display()),
                    );
                }
                ctx
            }
            Err(core_ml_error) => {
                warn(
                    Component::Transcription,
                    &format!(
                        "Core ML initialization failed: {}, falling back to CPU mode",
                        core_ml_error
                    ),
                );

                // Fallback to CPU-only mode
                let mut params = WhisperContextParameters::default();
                params.use_gpu(false);

                WhisperContext::new_with_params(model_path_str, params).map_err(|cpu_error| {
                    format!(
                        "Both Core ML and CPU initialization failed. Core ML: {}. CPU: {}",
                        core_ml_error, cpu_error
                    )
                })?
            }
        };

        Ok(Self { context })
    }

    pub fn new_cpu_only(model_path: &Path) -> Result<Self, String> {
        let model_path_str = model_path.to_str().ok_or("Invalid model path")?;

        info(
            Component::Transcription,
            &format!(
                "Initializing model in CPU-only mode: {}",
                model_path.file_name().unwrap_or_default().to_string_lossy()
            ),
        );

        // Force CPU-only mode
        let mut params = WhisperContextParameters::default();
        params.use_gpu(false);

        let context = WhisperContext::new_with_params(model_path_str, params)
            .map_err(|e| format!("Failed to initialize CPU-only model: {}", e))?;

        info(
            Component::Transcription,
            "Model initialized in CPU-only mode",
        );

        Ok(Self { context })
    }

    pub fn transcribe_file(&self, audio_path: &Path) -> Result<String, String> {
        self.transcribe(audio_path)
    }

    pub fn transcribe(&self, audio_path: &Path) -> Result<String, String> {
        // Load audio file
        let audio_data = self.load_audio(audio_path)?;

        // Create parameters for transcription
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });

        // Configure parameters for better performance
        params.set_n_threads(4);
        params.set_translate(false);
        params.set_language(Some("en"));
        params.set_print_special(false);
        params.set_print_progress(false); // Disabled for performance - was causing 9-10s delays
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        // Progress callback disabled for performance - uncomment only for debugging
        // params.set_progress_callback_safe(|progress| {
        //     log::info!(target: "whisper", "Progress: {}%", progress);
        // });

        // Suppress non-speech tokens (music, background noise descriptions)
        params.set_suppress_non_speech_tokens(true);

        // Suppress blank tokens to prevent hallucinations at chunk boundaries
        params.set_suppress_blank(true);

        // Set stricter decoding parameters to reduce hallucinations
        params.set_temperature(0.0);
        params.set_temperature_inc(0.2);
        params.set_entropy_thold(2.4);
        params.set_logprob_thold(-1.0);
        params.set_no_speech_thold(0.6);

        // Run the transcription
        // CRITICAL: Serialize state creation to prevent CoreML initialization deadlocks
        // when Tiny and Medium models try to initialize simultaneously
        let mut state = {
            let _lock = COREML_INIT_LOCK.lock().unwrap();
            info(
                Component::Transcription,
                "Creating whisper state (with CoreML lock)",
            );
            info(
                Component::Transcription,
                "Note: First Core ML initialization for large models can take 2-3 minutes",
            );
            let start_time = std::time::Instant::now();
            let state_result = self
                .context
                .create_state()
                .map_err(|e| format!("Failed to create state: {}", e));
            let elapsed = start_time.elapsed();
            info(
                Component::Transcription,
                &format!(
                    "Whisper state created successfully in {:.2}s",
                    elapsed.as_secs_f64()
                ),
            );
            state_result?
        };

        // Log transcription start
        log::info!(target: "whisper", "Starting transcription of {} samples", audio_data.len());

        state
            .full(params, &audio_data)
            .map_err(|e| format!("Failed to transcribe: {}", e))?;

        // Log transcription complete
        log::info!(target: "whisper", "Transcription complete");

        // Get the transcribed text
        let num_segments = state
            .full_n_segments()
            .map_err(|e| format!("Failed to get segments: {}", e))?;

        let mut transcription = String::new();

        for i in 0..num_segments {
            let segment = state
                .full_get_segment_text(i)
                .map_err(|e| format!("Failed to get segment text: {}", e))?;
            transcription.push_str(&segment);
            transcription.push(' ');
        }

        Ok(transcription.trim().to_string())
    }

    fn load_audio(&self, audio_path: &Path) -> Result<Vec<f32>, String> {
        // Use the new conversion pipeline that preserves native formats
        WhisperAudioConverter::convert_wav_file_for_whisper(audio_path)
    }

    // Resampling is now handled by WhisperAudioConverter
    // Keeping this for backward compatibility if needed
    #[allow(dead_code)]
    fn resample(&self, samples: &[f32], ratio: f32) -> Vec<f32> {
        let new_len = (samples.len() as f32 * ratio) as usize;
        let mut resampled = Vec::with_capacity(new_len);

        for i in 0..new_len {
            let src_idx = i as f32 / ratio;
            let idx = src_idx as usize;
            let frac = src_idx - idx as f32;

            let sample = if idx + 1 < samples.len() {
                samples[idx] * (1.0 - frac) + samples[idx + 1] * frac
            } else {
                samples[idx]
            };

            resampled.push(sample);
        }

        resampled
    }
}
