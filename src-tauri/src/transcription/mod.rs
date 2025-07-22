use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
use crate::logger::{warn, info, Component};
use once_cell::sync::Lazy;

pub mod strategy;
pub mod ring_buffer_transcriber;

pub use strategy::{TranscriptionStrategy, TranscriptionConfig, TranscriptionResult, TranscriptionStrategySelector};

// Global cache for transcriber instances to avoid CoreML reinitialization
// Changed from single instance to HashMap to support multiple models
static TRANSCRIBER_CACHE: Lazy<Arc<Mutex<std::collections::HashMap<PathBuf, Arc<Mutex<Transcriber>>>>>> = 
    Lazy::new(|| Arc::new(Mutex::new(std::collections::HashMap::new())));

// Global mutex to serialize CoreML state creation and prevent concurrent initialization deadlocks
static COREML_INIT_LOCK: Lazy<std::sync::Mutex<()>> = Lazy::new(|| std::sync::Mutex::new(()));

pub struct Transcriber {
    context: WhisperContext,
}

impl Transcriber {
    /// Get or create a cached transcriber instance to avoid CoreML reinitialization
    pub async fn get_or_create_cached(model_path: &Path) -> Result<Arc<Mutex<Self>>, String> {
        let mut cache = TRANSCRIBER_CACHE.lock().await;
        
        // Check if we have a cached transcriber for this model
        if let Some(cached_transcriber) = cache.get(model_path) {
            info(Component::Transcription, &format!("Reusing cached transcriber instance for {:?}", model_path));
            return Ok(cached_transcriber.clone());
        }
        
        // Create new transcriber
        info(Component::Transcription, &format!("Creating new transcriber for model: {:?}", model_path));
        let transcriber = Self::new(model_path)?;
        let transcriber_arc = Arc::new(Mutex::new(transcriber));
        
        // Update cache
        cache.insert(model_path.to_path_buf(), transcriber_arc.clone());
        info(Component::Transcription, &format!("Cached transcriber for {:?}. Total cached models: {}", model_path, cache.len()));
        
        Ok(transcriber_arc)
    }
    
    pub fn new(model_path: &Path) -> Result<Self, String> {
        let model_path_str = model_path.to_str().ok_or("Invalid model path")?;
        
        // Try Core ML first (faster, more efficient on macOS)
        let context = match WhisperContext::new_with_params(
            model_path_str,
            WhisperContextParameters::default(), // Uses Core ML on macOS
        ) {
            Ok(ctx) => {
                ctx
            }
            Err(core_ml_error) => {
                warn(Component::Transcription, &format!("Core ML initialization failed: {}, falling back to CPU mode", core_ml_error));
                
                // Fallback to CPU-only mode
                let mut params = WhisperContextParameters::default();
                params.use_gpu(false);
                
                WhisperContext::new_with_params(model_path_str, params)
                    .map_err(|cpu_error| {
                        format!("Both Core ML and CPU initialization failed. Core ML: {}. CPU: {}", 
                               core_ml_error, cpu_error)
                    })?
            }
        };

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
        params.set_print_progress(false);  // Disabled for performance - was causing 9-10s delays
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
            info(Component::Transcription, "Creating whisper state (with CoreML lock)");
            let state_result = self.context.create_state().map_err(|e| format!("Failed to create state: {}", e));
            info(Component::Transcription, "Whisper state created successfully");
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
        let num_segments = state.full_n_segments().map_err(|e| format!("Failed to get segments: {}", e))?;
        
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
        let mut reader = hound::WavReader::open(audio_path)
            .map_err(|e| format!("Failed to open audio file: {}", e))?;

        let spec = reader.spec();
        let sample_rate = spec.sample_rate;

        // Whisper expects 16kHz mono audio
        let target_sample_rate = 16000;
        let resample_ratio = target_sample_rate as f32 / sample_rate as f32;

        let samples: Vec<f32> = match spec.sample_format {
            hound::SampleFormat::Float => reader
                .samples::<f32>()
                .map(|s| s.unwrap_or(0.0))
                .collect(),
            hound::SampleFormat::Int => {
                let max_value = (1 << (spec.bits_per_sample - 1)) as f32;
                reader
                    .samples::<i32>()
                    .map(|s| s.unwrap_or(0) as f32 / max_value)
                    .collect()
            }
        };
        
        // Check if we have any samples
        if samples.is_empty() {
            return Err("Audio file contains no samples".to_string());
        }

        // Convert to mono if stereo
        let mono_samples = if spec.channels > 1 {
            samples
                .chunks(spec.channels as usize)
                .map(|chunk| chunk.iter().sum::<f32>() / chunk.len() as f32)
                .collect()
        } else {
            samples
        };
        
        // Check if we still have samples after mono conversion
        if mono_samples.is_empty() {
            return Err("No audio samples after mono conversion".to_string());
        }

        // Resample if necessary
        let resampled = if resample_ratio != 1.0 {
            self.resample(&mono_samples, resample_ratio)
        } else {
            mono_samples
        };
        
        // Final check
        if resampled.is_empty() {
            return Err("No audio samples after resampling".to_string());
        }
        
        Ok(resampled)
    }

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