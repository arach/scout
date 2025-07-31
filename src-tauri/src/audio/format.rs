use super::notifications::{notify_bluetooth_detected, notify_sample_rate_mismatch};
use crate::logger::{error, info, warn, Component};

/// Information about the native hardware audio format
#[derive(Debug, Clone)]
pub struct NativeAudioFormat {
    pub sample_rate: u32,
    pub channels: u16,
    pub sample_format: cpal::SampleFormat,
    pub device_name: String,
}

impl NativeAudioFormat {
    pub fn new(
        sample_rate: u32,
        channels: u16,
        sample_format: cpal::SampleFormat,
        device_name: String,
    ) -> Self {
        Self {
            sample_rate,
            channels,
            sample_format,
            device_name,
        }
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
        info(
            Component::Recording,
            &format!("{} - Audio Format Details:", context),
        );
        info(
            Component::Recording,
            &format!("  Device: {}", self.device_name),
        );
        info(
            Component::Recording,
            &format!(
                "  Sample Rate: {} Hz (native hardware rate)",
                self.sample_rate
            ),
        );
        info(
            Component::Recording,
            &format!(
                "  Channels: {} ({})",
                self.channels,
                if self.channels == 1 {
                    "mono"
                } else if self.channels == 2 {
                    "stereo"
                } else {
                    "multi-channel"
                }
            ),
        );
        info(
            Component::Recording,
            &format!(
                "  Sample Format: {:?} ({} bits)",
                self.sample_format,
                self.bits_per_sample()
            ),
        );
        info(
            Component::Recording,
            &format!(
                "  Data Rate: {} bytes/sec",
                self.sample_rate * self.channels as u32 * (self.bits_per_sample() as u32 / 8)
            ),
        );
    }
}

/// Audio conversion pipeline for Whisper compatibility
pub struct WhisperAudioConverter;

impl WhisperAudioConverter {
    /// Convert audio from native format to Whisper's requirements
    /// Whisper expects: 16kHz, mono, f32 samples
    pub fn convert_for_whisper(
        samples: &[f32],
        native_format: &NativeAudioFormat,
    ) -> Result<Vec<f32>, String> {
        let start_time = std::time::Instant::now();

        // Log conversion pipeline
        info(
            Component::Transcription,
            "=== Whisper Audio Conversion Pipeline ===",
        );
        info(
            Component::Transcription,
            &format!(
                "Input: {} Hz, {} channel(s), {} samples",
                native_format.sample_rate,
                native_format.channels,
                samples.len()
            ),
        );

        // ENHANCED: Validate input format and check for common device issues
        Self::validate_input_format(samples, native_format)?;

        // Step 1: Convert to mono if needed
        let mono_samples = if native_format.channels > 1 {
            info(
                Component::Transcription,
                &format!(
                    "Step 1: Converting {} channels to mono (averaging)",
                    native_format.channels
                ),
            );
            let chunks_count = samples.len() / native_format.channels as usize;
            let mut mono = Vec::with_capacity(chunks_count);

            for chunk in samples.chunks_exact(native_format.channels as usize) {
                let avg: f32 = chunk.iter().sum::<f32>() / chunk.len() as f32;
                mono.push(avg);
            }

            info(
                Component::Transcription,
                &format!("  Mono conversion complete: {} samples", mono.len()),
            );
            mono
        } else {
            info(
                Component::Transcription,
                "Step 1: Already mono, no conversion needed",
            );
            samples.to_vec()
        };

        // Step 2: Resample to 16kHz if needed with enhanced validation
        let whisper_samples = if native_format.sample_rate != 16000 {
            let resample_ratio = 16000.0 / native_format.sample_rate as f32;
            info(
                Component::Transcription,
                &format!(
                    "Step 2: Resampling from {} Hz to 16000 Hz (ratio: {:.3})",
                    native_format.sample_rate, resample_ratio
                ),
            );

            let resampled =
                Self::resample_with_validation(&mono_samples, resample_ratio, native_format)?;
            info(
                Component::Transcription,
                &format!("  Resampling complete: {} samples", resampled.len()),
            );
            resampled
        } else {
            info(
                Component::Transcription,
                "Step 2: Already at 16kHz, no resampling needed",
            );
            mono_samples
        };

        // Step 3: Validate output
        if whisper_samples.is_empty() {
            return Err("No samples after conversion".to_string());
        }

        let duration_ms = (whisper_samples.len() as f32 / 16.0) as u32; // 16 samples per ms at 16kHz
        let elapsed = start_time.elapsed();

        info(
            Component::Transcription,
            &format!("=== Conversion Complete ==="),
        );
        info(
            Component::Transcription,
            &format!(
                "Output: 16000 Hz, mono, {} samples ({} ms audio)",
                whisper_samples.len(),
                duration_ms
            ),
        );
        info(
            Component::Transcription,
            &format!("Conversion time: {:?}", elapsed),
        );

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

    /// Validate input format and detect common device issues
    fn validate_input_format(
        samples: &[f32],
        native_format: &NativeAudioFormat,
    ) -> Result<(), String> {
        // Check for empty or invalid samples
        if samples.is_empty() {
            return Err("No audio samples provided for conversion".to_string());
        }

        // Check for NaN or infinite values that might indicate hardware issues
        let invalid_count = samples.iter().filter(|&&s| !s.is_finite()).count();
        if invalid_count > 0 {
            return Err(format!(
                "Invalid audio samples detected: {} non-finite values out of {}",
                invalid_count,
                samples.len()
            ));
        }

        // Detect potential AirPods or Bluetooth device issues
        Self::detect_device_specific_issues(samples, native_format)?;

        // Validate sample rate makes sense
        if native_format.sample_rate < 8000 || native_format.sample_rate > 192000 {
            return Err(format!(
                "Unusual sample rate detected: {} Hz",
                native_format.sample_rate
            ));
        }

        Ok(())
    }

    /// Detect device-specific audio issues
    fn detect_device_specific_issues(
        samples: &[f32],
        native_format: &NativeAudioFormat,
    ) -> Result<(), String> {
        let device_name_lower = native_format.device_name.to_lowercase();

        // AirPods specific checks
        if device_name_lower.contains("airpod") {
            info(
                Component::Transcription,
                "AirPods device detected - applying enhanced validation",
            );

            // Check for call mode (low sample rates)
            if native_format.sample_rate <= 24000 {
                warn(
                    Component::Transcription,
                    &format!(
                        "AirPods in call mode: {} Hz - audio may have limited quality",
                        native_format.sample_rate
                    ),
                );

                // Analyze signal for potential sample rate mismatch
                if let Some(detected_rate) =
                    Self::estimate_actual_sample_rate(samples, native_format.sample_rate)
                {
                    if (detected_rate as i32 - native_format.sample_rate as i32).abs() > 8000 {
                        error(Component::Transcription, &format!(
                            "CRITICAL: AirPods sample rate mismatch! Reported: {} Hz, Detected: {} Hz",
                            native_format.sample_rate, detected_rate));
                        error(
                            Component::Transcription,
                            "This will cause chipmunk effect or slow audio!",
                        );

                        // Notify frontend about critical sample rate mismatch
                        notify_sample_rate_mismatch(
                            native_format.device_name.clone(),
                            native_format.sample_rate,
                            Some(detected_rate),
                        );

                        // Return error for critical mismatches
                        return Err(format!(
                            "Critical sample rate mismatch: reported {} Hz, detected {} Hz",
                            native_format.sample_rate, detected_rate
                        ));
                    }
                }
            }

            // Check for completely silent audio (connection issues)
            if Self::is_audio_silent(samples) {
                warn(
                    Component::Transcription,
                    "AirPods audio appears silent - possible connection issue",
                );
            }
        }

        // Bluetooth device checks
        if device_name_lower.contains("bluetooth") || device_name_lower.contains("wireless") {
            info(
                Component::Transcription,
                "Bluetooth device detected - checking for common issues",
            );

            // Check for intermittent dropouts (common in Bluetooth)
            let has_dropouts = Self::detect_audio_dropouts(samples);
            if has_dropouts {
                warn(
                    Component::Transcription,
                    "Audio dropouts detected - possible Bluetooth interference",
                );
            }

            // Notify frontend about Bluetooth device detection
            notify_bluetooth_detected(native_format.device_name.clone(), has_dropouts);
        }

        Ok(())
    }

    /// Estimate actual sample rate from audio content (simplified approach)
    fn estimate_actual_sample_rate(samples: &[f32], reported_rate: u32) -> Option<u32> {
        // This is a simplified heuristic - real implementation would use FFT
        // We're mainly looking for major discrepancies (2x, 3x, 0.5x, etc.)

        if samples.len() < 1024 {
            return None; // Need sufficient samples for analysis
        }

        // Calculate zero-crossing rate as a rough frequency indicator
        let mut zero_crossings = 0;
        for i in 1..samples.len() {
            if (samples[i - 1] >= 0.0) != (samples[i] >= 0.0) {
                zero_crossings += 1;
            }
        }

        // Estimate dominant frequency (very rough)
        let crossing_rate = zero_crossings as f32 / samples.len() as f32;
        let estimated_freq = crossing_rate * reported_rate as f32 / 2.0;

        // For speech, we expect frequencies mostly in 80-255 Hz range for fundamentals
        // If we detect very high or very low frequencies, it might indicate sample rate issues
        if estimated_freq < 10.0 {
            // Very low frequency might indicate sample rate is too high
            Some(reported_rate / 2)
        } else if estimated_freq > 1000.0 {
            // Very high frequency might indicate sample rate is too low
            Some(reported_rate * 2)
        } else {
            None // Seems reasonable
        }
    }

    /// Check if audio is completely silent
    fn is_audio_silent(samples: &[f32]) -> bool {
        let threshold = 1e-6;
        samples.iter().all(|&s| s.abs() < threshold)
    }

    /// Detect audio dropouts (periods of complete silence)
    fn detect_audio_dropouts(samples: &[f32]) -> bool {
        if samples.len() < 1000 {
            return false;
        }

        let threshold = 1e-6;
        let window_size = 100; // Check for 100-sample silent windows
        let mut silent_windows = 0;

        for chunk in samples.chunks(window_size) {
            if chunk.iter().all(|&s| s.abs() < threshold) {
                silent_windows += 1;
            }
        }

        // If more than 10% of windows are silent, consider it dropouts
        let total_windows = samples.len() / window_size;
        silent_windows > total_windows / 10
    }

    /// Enhanced resampling with device-specific optimizations
    fn resample_with_validation(
        samples: &[f32],
        ratio: f32,
        native_format: &NativeAudioFormat,
    ) -> Result<Vec<f32>, String> {
        if ratio == 1.0 {
            return Ok(samples.to_vec());
        }

        info(
            Component::Transcription,
            &format!(
                "Resampling with ratio {:.3} for device: {}",
                ratio, native_format.device_name
            ),
        );

        // Check for problematic ratios that might indicate sample rate issues
        if ratio < 0.1 || ratio > 10.0 {
            warn(
                Component::Transcription,
                &format!(
                    "Extreme resampling ratio: {:.3} - possible sample rate mismatch",
                    ratio
                ),
            );
        }

        // Use standard resampling
        Self::resample(samples, ratio)
    }

    /// Convert WAV file data for Whisper (preserves original file)
    pub fn convert_wav_file_for_whisper(wav_path: &std::path::Path) -> Result<Vec<f32>, String> {
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
                reader.samples::<f32>().map(|s| s.unwrap_or(0.0)).collect()
            }
            hound::SampleFormat::Int => {
                let max_value = (1 << (spec.bits_per_sample - 1)) as f32;
                reader
                    .samples::<i32>()
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
