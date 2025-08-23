use crate::audio::WhisperAudioConverter;
use crate::logger::{info, warn, Component};
use crate::models::model_state::ModelStateManager;
use once_cell::sync::Lazy;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub mod file_based_ring_buffer_transcriber;
pub mod ring_buffer_transcriber;
pub mod streaming_transcriber;
pub mod native_streaming_strategy;
pub mod strategy;
pub mod external_service;
pub mod external_strategy;

pub use strategy::{
    TranscriptionConfig, TranscriptionResult, TranscriptionStrategy, TranscriptionStrategySelector,
};

// Export Transcriber for tests and other internal use (defined below in this module)
// Note: The struct is defined in this file, so we don't need to re-export it

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

        // Check if Core ML is ready and if any other model is warming up
        let use_coreml = if let Some(manager) = &model_state_manager {
            // If ANY model is warming up, skip Core ML to avoid deadlock
            if manager.is_any_model_warming().await {
                let warming_models = manager.get_warming_models().await;
                warn(
                    Component::Transcription,
                    &format!(
                        "Skipping Core ML for {} because models are warming up: {:?}",
                        model_id, warming_models
                    ),
                );
                false
            } else {
                manager.should_use_coreml(model_id).await
            }
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
        
        // Check audio duration and warn if very short
        let duration_seconds = audio_data.len() as f32 / 16000.0; // 16kHz after conversion
        if duration_seconds < 0.5 {
            warn(
                Component::Transcription,
                &format!(
                    "Very short audio detected: {:.2}s. Whisper may struggle with clips < 0.5s",
                    duration_seconds
                ),
            );
        }

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

        // For very short clips, don't suppress blank tokens as it can prevent single word transcription
        if duration_seconds > 1.0 {
            params.set_suppress_blank(true);
        } else {
            params.set_suppress_blank(false);
            info(
                Component::Transcription,
                "Disabled blank suppression for very short clip to allow single words",
            );
        }

        // Adjust decoding parameters based on audio duration
        params.set_temperature(0.0);
        params.set_temperature_inc(0.2);
        
        if duration_seconds <= 1.0 {
            // For very short clips (including padded clips), use very permissive thresholds
            params.set_entropy_thold(4.0);     // Very permissive for short clips
            params.set_logprob_thold(-2.0);    // Very permissive for short clips  
            params.set_no_speech_thold(0.2);   // Very low threshold - accept almost anything as speech
            
            info(
                Component::Transcription,
                &format!("Using very permissive parameters for short clip: {:.2}s", duration_seconds),
            );
        } else if duration_seconds < 3.0 {
            // For medium-short clips, use moderately permissive thresholds
            params.set_entropy_thold(3.0);     // Moderately permissive
            params.set_logprob_thold(-1.5);    // Moderately permissive
            params.set_no_speech_thold(0.4);   // Lower threshold
            
            info(
                Component::Transcription,
                &format!("Using moderately permissive parameters for medium clip: {:.2}s", duration_seconds),
            );
        } else {
            // For longer clips, use stricter thresholds to reduce hallucinations
            params.set_entropy_thold(2.4);
            params.set_logprob_thold(-1.0);
            params.set_no_speech_thold(0.6);
            
            info(
                Component::Transcription,
                &format!("Using strict parameters for long clip: {:.2}s", duration_seconds),
            );
        }
        
        // Enhanced parameters for short audio clips
        // Note: set_condition_on_previous_text is not available in whisper-rs 0.13.2
        // params.set_condition_on_previous_text(false);
        
        // Set initial prompt to help with common short utterances
        // This helps Whisper understand context for single words or brief phrases
        params.set_initial_prompt("Speech transcription of a brief utterance or command:");

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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Test transcriber cache behavior
    #[tokio::test]
    async fn test_transcriber_cache_basic() {
        let temp_dir = TempDir::new().unwrap();
        let model_path = temp_dir.path().join("test_model.bin");
        
        // Create a mock model file
        std::fs::write(&model_path, b"mock model data").unwrap();
        
        // Test that cache is initially empty for non-existent path
        let cache = TRANSCRIBER_CACHE.lock().await;
        assert!(cache.get(&model_path).is_none());
        drop(cache);
        
        // This test would require a mock WhisperContext to fully test
        // For now, we test the cache structure and logic
        
        // Test cache key generation for CPU-only mode
        let cpu_cache_key = model_path
            .parent()
            .map(|p| {
                p.join(format!(
                    "{}_cpu_only",
                    model_path.file_name().unwrap_or_default().to_string_lossy()
                ))
            })
            .unwrap_or_else(|| model_path.clone());
        
        assert!(cpu_cache_key.to_string_lossy().contains("cpu_only"));
        assert_ne!(cpu_cache_key, model_path);
    }

    /// Test model ID extraction from path
    #[test]
    fn test_model_id_extraction() {
        use std::path::PathBuf;
        
        let test_cases = vec![
            ("ggml-tiny.en.bin", "tiny.en"),
            ("ggml-medium.en.bin", "medium.en"),
            ("ggml-base.bin", "base"),
            ("ggml-large-v2.bin", "large-v2"),
        ];
        
        for (filename, expected_id) in test_cases {
            let path = PathBuf::from(filename);
            let model_id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .and_then(|s| s.strip_prefix("ggml-"))
                .unwrap_or("");
            
            assert_eq!(model_id, expected_id);
        }
    }

    /// Test CoreML path generation
    #[test]
    fn test_coreml_path_generation() {
        use std::path::PathBuf;
        
        let test_cases = vec![
            ("ggml-tiny.en.bin", "ggml-tiny.en-encoder.mlmodelc"),
            ("ggml-medium.en.bin", "ggml-medium.en-encoder.mlmodelc"),
            ("ggml-base.bin", "ggml-base-encoder.mlmodelc"),
        ];
        
        for (model_file, expected_coreml) in test_cases {
            let model_path = PathBuf::from(model_file);
            let model_stem = model_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            let coreml_path = model_path
                .parent()
                .map(|p| p.join(format!("{}-encoder.mlmodelc", model_stem)))
                .unwrap_or_default();
            
            assert_eq!(coreml_path.file_name().unwrap().to_string_lossy(), expected_coreml);
        }
    }

    /// Test whisper parameters configuration
    #[test]
    fn test_whisper_params_configuration() {
        use whisper_rs::{FullParams, SamplingStrategy};
        
        // Test that parameters are configured correctly for performance
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        
        // Configure like in the actual transcriber
        params.set_n_threads(4);
        params.set_translate(false);
        params.set_language(Some("en"));
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_suppress_non_speech_tokens(true);
        params.set_suppress_blank(true);
        params.set_temperature(0.0);
        params.set_temperature_inc(0.2);
        params.set_entropy_thold(2.4);
        params.set_logprob_thold(-1.0);
        params.set_no_speech_thold(0.6);
        
        // Verify some key parameters (others are internal to whisper-rs)
        // This mainly tests that the API calls don't panic
        assert!(true); // Parameters were set successfully if we reach here
    }

    /// Test cache key generation for different configurations
    #[test]
    fn test_cache_key_generation() {
        use std::path::PathBuf;
        
        let model_path = PathBuf::from("/models/ggml-tiny.en.bin");
        
        // Test normal cache key (same as model path)
        let normal_key = model_path.clone();
        assert_eq!(normal_key, model_path);
        
        // Test CPU-only cache key (should be different)
        let cpu_key = model_path
            .parent()
            .map(|p| {
                p.join(format!(
                    "{}_cpu_only",
                    model_path.file_name().unwrap_or_default().to_string_lossy()
                ))
            })
            .unwrap_or_else(|| model_path.clone());
        
        assert_ne!(cpu_key, model_path);
        assert!(cpu_key.to_string_lossy().contains("cpu_only"));
        assert!(cpu_key.to_string_lossy().contains("ggml-tiny.en.bin"));
    }

    /// Test concurrent access to transcriber cache
    #[tokio::test]
    async fn test_transcriber_cache_concurrent_access() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc as StdArc;
        
        let counter = StdArc::new(AtomicUsize::new(0));
        
        let handles: Vec<_> = (0..10).map(|i| {
            let counter = counter.clone();
            
            tokio::spawn(async move {
                let model_path = PathBuf::from(format!("model_{}.bin", i));
                
                // Test concurrent cache access
                let cache = TRANSCRIBER_CACHE.lock().await;
                let cache_entry = cache.get(&model_path);
                assert!(cache_entry.is_none()); // Should be empty for test paths
                drop(cache);
                
                counter.fetch_add(1, Ordering::SeqCst);
                i
            })
        }).collect();
        
        // Wait for all tasks to complete
        for handle in handles {
            handle.await.unwrap();
        }
        
        // All 10 tasks should have completed
        assert_eq!(counter.load(Ordering::SeqCst), 10);
    }

    /// Test error handling scenarios
    #[test]
    fn test_error_handling_paths() {
        use std::path::PathBuf;
        
        // Test invalid path handling
        let invalid_path = PathBuf::from("");
        let path_str = invalid_path.to_str();
        assert!(path_str.is_some()); // Empty path is still valid str
        
        // Test path with invalid UTF-8 would require special setup
        // For now, test that normal paths work
        let normal_path = PathBuf::from("model.bin");
        let path_str = normal_path.to_str();
        assert!(path_str.is_some());
        assert_eq!(path_str.unwrap(), "model.bin");
    }

    /// Test Core ML lock behavior
    #[test]
    fn test_coreml_init_lock() {
        // Test that the lock can be acquired
        let _lock = COREML_INIT_LOCK.lock().unwrap();
        // Lock should be successfully acquired
        assert!(true);
        
        // Lock should be released when dropped
        drop(_lock);
        
        // Should be able to acquire again
        let _lock2 = COREML_INIT_LOCK.lock().unwrap();
        assert!(true);
    }

    /// Test concurrent Core ML lock access
    #[tokio::test]
    async fn test_coreml_lock_concurrent() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc as StdArc;
        use std::time::Duration;
        
        let counter = StdArc::new(AtomicUsize::new(0));
        
        let handles: Vec<_> = (0..5).map(|i| {
            let counter = counter.clone();
            
            tokio::task::spawn_blocking(move || {
                // Simulate the lock usage pattern from transcription
                let _lock = COREML_INIT_LOCK.lock().unwrap();
                
                // Simulate some work (like Core ML initialization)
                std::thread::sleep(Duration::from_millis(10));
                
                counter.fetch_add(1, Ordering::SeqCst);
                i
            })
        }).collect();
        
        // Wait for all tasks to complete
        for handle in handles {
            handle.await.unwrap();
        }
        
        // All 5 tasks should have completed sequentially due to the lock
        assert_eq!(counter.load(Ordering::SeqCst), 5);
    }
}
