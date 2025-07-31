use std::path::Path;
use hound::WavReader;
use crate::logger::{info, warn, error, Component};

/// Validates WAV files for format consistency
pub struct WavValidator;

impl WavValidator {
    /// Validate a WAV file and check for common issues
    pub fn validate_wav_file(path: &Path) -> Result<WavValidationResult, String> {
        let mut reader = WavReader::open(path)
            .map_err(|e| format!("Failed to open WAV file for validation: {}", e))?;
        
        let spec = reader.spec();
        let sample_count = reader.len();
        let expected_frames = sample_count / spec.channels as u32;
        let duration_seconds = expected_frames as f32 / spec.sample_rate as f32;
        
        info(Component::Recording, &format!("WAV Validation for: {:?}", path));
        info(Component::Recording, &format!("  Format: {} Hz, {} channels, {} bits, {:?}", 
            spec.sample_rate, spec.channels, spec.bits_per_sample, spec.sample_format));
        info(Component::Recording, &format!("  Samples: {}, Frames: {}, Duration: {:.2}s", 
            sample_count, expected_frames, duration_seconds));
        
        // Check for common issues
        let mut issues = Vec::new();
        
        // Check for suspiciously short recordings
        if duration_seconds < 0.1 {
            issues.push(ValidationIssue {
                severity: Severity::Warning,
                message: format!("Very short recording: {:.3}s", duration_seconds),
            });
        }
        
        // Check for unusual sample rates that might indicate a mismatch
        let common_rates = [8000, 16000, 22050, 24000, 44100, 48000, 96000, 192000];
        if !common_rates.contains(&spec.sample_rate) {
            issues.push(ValidationIssue {
                severity: Severity::Warning,
                message: format!("Unusual sample rate: {} Hz", spec.sample_rate),
            });
        }
        
        // Check for sample/channel alignment
        if sample_count % spec.channels as u32 != 0 {
            issues.push(ValidationIssue {
                severity: Severity::Error,
                message: format!("Sample count {} not divisible by channel count {}", 
                    sample_count, spec.channels),
            });
        }
        
        // Analyze first few samples to detect common issues
        let samples_to_check = std::cmp::min(1000, sample_count) as usize;
        let mut first_samples = Vec::with_capacity(samples_to_check);
        
        match spec.sample_format {
            hound::SampleFormat::Float => {
                for sample in reader.samples::<f32>().take(samples_to_check) {
                    if let Ok(s) = sample {
                        first_samples.push(s);
                    }
                }
            }
            hound::SampleFormat::Int => {
                let max_val = (1 << (spec.bits_per_sample - 1)) as f32;
                for sample in reader.samples::<i32>().take(samples_to_check) {
                    if let Ok(s) = sample {
                        first_samples.push(s as f32 / max_val);
                    }
                }
            }
        }
        
        // Check for silence at start
        let silence_threshold = 0.001;
        let silent_samples = first_samples.iter()
            .take_while(|&&s| s.abs() < silence_threshold)
            .count();
        
        if silent_samples > spec.sample_rate as usize / 10 {
            let silence_ms = (silent_samples as f32 / spec.sample_rate as f32) * 1000.0;
            issues.push(ValidationIssue {
                severity: Severity::Info,
                message: format!("Recording starts with {:.0}ms of silence", silence_ms),
            });
        }
        
        // Check for potential sample rate mismatch by analyzing frequency content
        if first_samples.len() >= 100 {
            let zero_crossings = count_zero_crossings(&first_samples);
            let estimated_freq = (zero_crossings as f32 / 2.0) * (spec.sample_rate as f32 / first_samples.len() as f32);
            
            // If we detect very high frequency content relative to sample rate, might indicate upsampling
            if estimated_freq > spec.sample_rate as f32 * 0.4 {
                issues.push(ValidationIssue {
                    severity: Severity::Warning,
                    message: format!("High frequency content detected ({:.0} Hz) - possible sample rate mismatch", estimated_freq),
                });
            }
        }
        
        Ok(WavValidationResult {
            spec,
            sample_count,
            duration_seconds,
            issues,
        })
    }
}

fn count_zero_crossings(samples: &[f32]) -> usize {
    if samples.len() < 2 {
        return 0;
    }
    
    let mut crossings = 0;
    let mut prev_sign = samples[0] >= 0.0;
    
    for &sample in samples.iter().skip(1) {
        let current_sign = sample >= 0.0;
        if current_sign != prev_sign {
            crossings += 1;
        }
        prev_sign = current_sign;
    }
    
    crossings
}

#[derive(Debug)]
pub struct WavValidationResult {
    pub spec: hound::WavSpec,
    pub sample_count: u32,
    pub duration_seconds: f32,
    pub issues: Vec<ValidationIssue>,
}

#[derive(Debug)]
pub struct ValidationIssue {
    pub severity: Severity,
    pub message: String,
}

#[derive(Debug, PartialEq)]
pub enum Severity {
    Info,
    Warning,
    Error,
}

impl WavValidationResult {
    pub fn has_errors(&self) -> bool {
        self.issues.iter().any(|i| i.severity == Severity::Error)
    }
    
    pub fn has_warnings(&self) -> bool {
        self.issues.iter().any(|i| i.severity == Severity::Warning)
    }
    
    pub fn log_issues(&self) {
        for issue in &self.issues {
            match issue.severity {
                Severity::Info => info(Component::Recording, &format!("WAV Validation Info: {}", issue.message)),
                Severity::Warning => warn(Component::Recording, &format!("WAV Validation Warning: {}", issue.message)),
                Severity::Error => error(Component::Recording, &format!("WAV Validation Error: {}", issue.message)),
            }
        }
    }
}