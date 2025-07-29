use crate::logger::{info, Component};

/// Information about the native hardware audio format
#[derive(Debug, Clone)]
pub struct NativeAudioFormat {
    pub sample_rate: u32,
    pub channels: u16,
    pub sample_format: cpal::SampleFormat,
    pub device_name: String,
}

impl NativeAudioFormat {
    pub fn new(sample_rate: u32, channels: u16, sample_format: cpal::SampleFormat, device_name: String) -> Self {
        Self { sample_rate, channels, sample_format, device_name }
    }
    
    /// Get the bits per sample for this format
    pub fn bits_per_sample(&self) -> u16 {
        match self.sample_format {
            cpal::SampleFormat::I16 => 16,
            cpal::SampleFormat::U16 => 16,
            cpal::SampleFormat::F32 => 32,
            _ => 16, // Default fallback
        }
    }
    
    /// Get the hound sample format for this native format
    pub fn hound_sample_format(&self) -> hound::SampleFormat {
        match self.sample_format {
            cpal::SampleFormat::F32 => hound::SampleFormat::Float,
            _ => hound::SampleFormat::Int,
        }
    }
    
    /// Create a WAV spec that preserves the native hardware format
    pub fn to_wav_spec(&self) -> hound::WavSpec {
        hound::WavSpec {
            channels: self.channels,
            sample_rate: self.sample_rate,
            bits_per_sample: self.bits_per_sample(),
            sample_format: self.hound_sample_format(),
        }
    }
    
    /// Log detailed format information
    pub fn log_format_info(&self, context: &str) {
        info(Component::Recording, &format!("{} - Audio Format Details:", context));
        info(Component::Recording, &format!("  Device: {}", self.device_name));
        info(Component::Recording, &format!("  Sample Rate: {} Hz (native hardware rate)", self.sample_rate));
        info(Component::Recording, &format!("  Channels: {} ({})", self.channels, 
            if self.channels == 1 { "mono" } else if self.channels == 2 { "stereo" } else { "multi-channel" }));
        info(Component::Recording, &format!("  Sample Format: {:?} ({} bits)", self.sample_format, self.bits_per_sample()));
        info(Component::Recording, &format!("  Data Rate: {} bytes/sec", 
            self.sample_rate * self.channels as u32 * (self.bits_per_sample() as u32 / 8)));
    }
}

/// Audio conversion pipeline for Whisper compatibility
pub struct WhisperAudioConverter;

impl WhisperAudioConverter {
    /// Convert audio from native format to Whisper's requirements
    /// Whisper expects: 16kHz, mono, f32 samples
    pub fn convert_for_whisper(
        samples: &[f32], 
        native_format: &NativeAudioFormat
    ) -> Result<Vec<f32>, String> {
        let start_time = std::time::Instant::now();
        
        // Log conversion pipeline
        info(Component::Transcription, "=== Whisper Audio Conversion Pipeline ===");
        info(Component::Transcription, &format!("Input: {} Hz, {} channel(s), {} samples", 
            native_format.sample_rate, native_format.channels, samples.len()));
        
        // Step 1: Convert to mono if needed
        let mono_samples = if native_format.channels > 1 {
            info(Component::Transcription, &format!("Step 1: Converting {} channels to mono (averaging)", native_format.channels));
            let chunks_count = samples.len() / native_format.channels as usize;
            let mut mono = Vec::with_capacity(chunks_count);
            
            for chunk in samples.chunks_exact(native_format.channels as usize) {
                let avg: f32 = chunk.iter().sum::<f32>() / chunk.len() as f32;
                mono.push(avg);
            }
            
            info(Component::Transcription, &format!("  Mono conversion complete: {} samples", mono.len()));
            mono
        } else {
            info(Component::Transcription, "Step 1: Already mono, no conversion needed");
            samples.to_vec()
        };
        
        // Step 2: Resample to 16kHz if needed
        let whisper_samples = if native_format.sample_rate != 16000 {
            let resample_ratio = 16000.0 / native_format.sample_rate as f32;
            info(Component::Transcription, &format!("Step 2: Resampling from {} Hz to 16000 Hz (ratio: {:.3})", 
                native_format.sample_rate, resample_ratio));
            
            let resampled = Self::resample(&mono_samples, resample_ratio)?;
            info(Component::Transcription, &format!("  Resampling complete: {} samples", resampled.len()));
            resampled
        } else {
            info(Component::Transcription, "Step 2: Already at 16kHz, no resampling needed");
            mono_samples
        };
        
        // Step 3: Validate output
        if whisper_samples.is_empty() {
            return Err("No samples after conversion".to_string());
        }
        
        let duration_ms = (whisper_samples.len() as f32 / 16.0) as u32; // 16 samples per ms at 16kHz
        let elapsed = start_time.elapsed();
        
        info(Component::Transcription, &format!("=== Conversion Complete ==="));
        info(Component::Transcription, &format!("Output: 16000 Hz, mono, {} samples ({} ms audio)", 
            whisper_samples.len(), duration_ms));
        info(Component::Transcription, &format!("Conversion time: {:?}", elapsed));
        
        Ok(whisper_samples)
    }
    
    /// High-quality linear interpolation resampling
    fn resample(samples: &[f32], ratio: f32) -> Result<Vec<f32>, String> {
        if ratio == 1.0 {
            return Ok(samples.to_vec());
        }
        
        let new_len = (samples.len() as f32 * ratio) as usize;
        if new_len == 0 {
            return Err("Resampling would result in 0 samples".to_string());
        }
        
        let mut resampled = Vec::with_capacity(new_len);
        
        for i in 0..new_len {
            let src_idx = i as f32 / ratio;
            let idx = src_idx as usize;
            let frac = src_idx - idx as f32;
            
            let sample = if idx + 1 < samples.len() {
                // Linear interpolation between two samples
                samples[idx] * (1.0 - frac) + samples[idx + 1] * frac
            } else if idx < samples.len() {
                // Edge case: use last sample
                samples[idx]
            } else {
                // Should not happen, but handle gracefully
                0.0
            };
            
            resampled.push(sample);
        }
        
        Ok(resampled)
    }
    
    /// Convert WAV file data for Whisper (preserves original file)
    pub fn convert_wav_file_for_whisper(
        wav_path: &std::path::Path
    ) -> Result<Vec<f32>, String> {
        let mut reader = hound::WavReader::open(wav_path)
            .map_err(|e| format!("Failed to open WAV file: {}", e))?;
        
        let spec = reader.spec();
        
        // Create native format info from WAV spec
        let native_format = NativeAudioFormat {
            sample_rate: spec.sample_rate,
            channels: spec.channels,
            sample_format: if spec.sample_format == hound::SampleFormat::Float { 
                cpal::SampleFormat::F32 
            } else { 
                cpal::SampleFormat::I16 
            },
            device_name: "WAV File".to_string(),
        };
        
        // Read samples as f32
        let samples: Vec<f32> = match spec.sample_format {
            hound::SampleFormat::Float => {
                reader.samples::<f32>()
                    .map(|s| s.unwrap_or(0.0))
                    .collect()
            }
            hound::SampleFormat::Int => {
                let max_value = (1 << (spec.bits_per_sample - 1)) as f32;
                reader.samples::<i32>()
                    .map(|s| s.unwrap_or(0) as f32 / max_value)
                    .collect()
            }
        };
        
        // Convert to Whisper format
        Self::convert_for_whisper(&samples, &native_format)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_mono_conversion() {
        let stereo_samples = vec![0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
        let format = NativeAudioFormat::new(48000, 2, cpal::SampleFormat::F32, "Test".to_string());
        
        let result = WhisperAudioConverter::convert_for_whisper(&stereo_samples, &format).unwrap();
        
        // Should average pairs: (0.1+0.2)/2=0.15, (0.3+0.4)/2=0.35, (0.5+0.6)/2=0.55
        // Then resample from 48kHz to 16kHz (ratio 1/3)
        assert!(result.len() < stereo_samples.len());
    }
    
    #[test]
    fn test_resample_ratio() {
        let samples = vec![0.0; 48000]; // 1 second at 48kHz
        let format = NativeAudioFormat::new(48000, 1, cpal::SampleFormat::F32, "Test".to_string());
        
        let result = WhisperAudioConverter::convert_for_whisper(&samples, &format).unwrap();
        
        // Should be approximately 16000 samples (1 second at 16kHz)
        assert!((result.len() as i32 - 16000).abs() < 10);
    }
}