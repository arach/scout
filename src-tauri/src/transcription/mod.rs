use std::path::Path;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct Transcriber {
    context: WhisperContext,
}

impl Transcriber {
    pub fn new(model_path: &Path) -> Result<Self, String> {
        let context = WhisperContext::new_with_params(
            model_path.to_str().ok_or("Invalid model path")?,
            WhisperContextParameters::default(),
        )
        .map_err(|e| format!("Failed to create whisper context: {}", e))?;

        Ok(Self { context })
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
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        // Run the transcription
        let mut state = self.context.create_state().map_err(|e| format!("Failed to create state: {}", e))?;
        
        state
            .full(params, &audio_data)
            .map_err(|e| format!("Failed to transcribe: {}", e))?;

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