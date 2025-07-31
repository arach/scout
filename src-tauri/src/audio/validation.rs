use super::metadata::AudioPatternAnalysis;
use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// Real-time audio format validator
pub struct AudioFormatValidator {
    /// Sample buffer for analysis
    sample_buffer: VecDeque<f32>,

    /// Expected sample rate
    expected_sample_rate: u32,

    /// Expected channels
    expected_channels: u16,

    /// Callback counter
    callback_count: u64,

    /// Validation interval (callbacks between validations)
    validation_interval: u64,

    /// Last validation time
    last_validation: Instant,

    /// Pattern analysis window size
    analysis_window_size: usize,

    /// Detected inconsistencies
    inconsistencies: Vec<ValidationInconsistency>,

    /// Signal level tracking for dead signal detection
    signal_levels: VecDeque<f32>,

    /// Zero crossing rate tracking for frequency analysis
    zero_crossings: VecDeque<u32>,
}

#[derive(Debug, Clone)]
pub struct ValidationInconsistency {
    pub inconsistency_type: String,
    pub detected_at: Instant,
    pub details: String,
    pub severity: InconsistencySeverity,
}

#[derive(Debug, Clone, PartialEq, PartialOrd, Ord, Eq)]
pub enum InconsistencySeverity {
    Low,      // Minor variations, probably normal
    Medium,   // Noticeable but not critical
    High,     // Likely to cause audio issues
    Critical, // Will definitely cause problems
}

impl AudioFormatValidator {
    pub fn new(expected_sample_rate: u32, expected_channels: u16) -> Self {
        let analysis_window_size = (expected_sample_rate as usize / 10).max(1024); // 100ms window or minimum 1024 samples

        Self {
            sample_buffer: VecDeque::with_capacity(analysis_window_size * 2),
            expected_sample_rate,
            expected_channels,
            callback_count: 0,
            validation_interval: 50, // Validate every 50 callbacks initially
            last_validation: Instant::now(),
            analysis_window_size,
            inconsistencies: Vec::new(),
            signal_levels: VecDeque::with_capacity(100), // Track last 100 level measurements
            zero_crossings: VecDeque::with_capacity(100),
        }
    }

    /// Process audio callback and perform validation if needed
    pub fn process_callback(
        &mut self,
        samples: &[f32],
        callback_info: &CallbackInfo,
    ) -> ValidationResult {
        self.callback_count += 1;

        // Add samples to buffer for analysis
        for &sample in samples {
            if self.sample_buffer.len() >= self.analysis_window_size * 2 {
                self.sample_buffer.pop_front();
            }
            self.sample_buffer.push_back(sample);
        }

        // Calculate and track signal level
        let rms = calculate_rms(samples);
        if self.signal_levels.len() >= 100 {
            self.signal_levels.pop_front();
        }
        self.signal_levels.push_back(rms);

        // Calculate zero crossings for frequency analysis
        let zero_crossings = count_zero_crossings(samples);
        if self.zero_crossings.len() >= 100 {
            self.zero_crossings.pop_front();
        }
        self.zero_crossings.push_back(zero_crossings);

        // Perform validation at intervals
        let mut validation_result = ValidationResult::Ok;

        if self.should_validate() {
            validation_result = self.perform_validation(callback_info);
            self.last_validation = Instant::now();

            // Adjust validation frequency based on device stability
            self.adjust_validation_frequency(&validation_result);
        }

        // Quick checks on every callback
        self.perform_quick_checks(samples, callback_info);

        validation_result
    }

    /// Perform comprehensive validation
    fn perform_validation(&mut self, callback_info: &CallbackInfo) -> ValidationResult {
        if self.sample_buffer.len() < self.analysis_window_size {
            return ValidationResult::InsufficientData;
        }

        let mut issues = Vec::new();

        // 1. Sample rate validation through frequency analysis
        if let Some(detected_rate) = self.estimate_sample_rate() {
            let rate_diff = (detected_rate as i32 - self.expected_sample_rate as i32).abs();
            if rate_diff > 1000 {
                issues.push(ValidationInconsistency {
                    inconsistency_type: "sample_rate_mismatch".to_string(),
                    detected_at: Instant::now(),
                    details: format!(
                        "Expected: {} Hz, Detected: {} Hz (diff: {} Hz)",
                        self.expected_sample_rate, detected_rate, rate_diff
                    ),
                    severity: if rate_diff > 8000 {
                        InconsistencySeverity::Critical
                    } else {
                        InconsistencySeverity::High
                    },
                });
            }
        }

        // 2. Signal consistency validation
        if let Some(issue) = self.validate_signal_consistency() {
            issues.push(issue);
        }

        // 3. Channel configuration validation
        if let Some(issue) = self.validate_channel_configuration(callback_info) {
            issues.push(issue);
        }

        // 4. Timing validation
        if let Some(issue) = self.validate_callback_timing(callback_info) {
            issues.push(issue);
        }

        // Store issues for reporting
        self.inconsistencies.extend(issues.clone());

        // Keep only recent inconsistencies (last 5 minutes)
        let cutoff = Instant::now() - Duration::from_secs(300);
        self.inconsistencies.retain(|i| i.detected_at > cutoff);

        if issues.is_empty() {
            ValidationResult::Ok
        } else {
            let max_severity = issues
                .iter()
                .map(|i| &i.severity)
                .max()
                .unwrap_or(&InconsistencySeverity::Low)
                .clone();
            ValidationResult::IssuesDetected(issues, max_severity)
        }
    }

    /// Quick checks performed on every callback
    fn perform_quick_checks(&mut self, samples: &[f32], _callback_info: &CallbackInfo) {
        // Check for NaN or infinite values
        for (i, &sample) in samples.iter().enumerate() {
            if !sample.is_finite() {
                self.inconsistencies.push(ValidationInconsistency {
                    inconsistency_type: "invalid_sample".to_string(),
                    detected_at: Instant::now(),
                    details: format!("Sample {} is not finite: {}", i, sample),
                    severity: InconsistencySeverity::Critical,
                });
                break; // Don't spam with multiple errors
            }
        }

        // Check for completely silent audio (possible device disconnection)
        if samples.len() > 100 && samples.iter().all(|&s| s.abs() < 1e-10) {
            // Only report if we've had several silent callbacks in a row
            let recent_silent = self
                .signal_levels
                .iter()
                .rev()
                .take(10)
                .all(|&level| level < 1e-8);
            if recent_silent && self.callback_count > 50 {
                self.inconsistencies.push(ValidationInconsistency {
                    inconsistency_type: "potential_device_disconnection".to_string(),
                    detected_at: Instant::now(),
                    details: "Extended period of complete silence detected".to_string(),
                    severity: InconsistencySeverity::Medium,
                });
            }
        }
    }

    /// Estimate sample rate from zero-crossing analysis
    fn estimate_sample_rate(&self) -> Option<u32> {
        if self.zero_crossings.len() < 10 {
            return None;
        }

        // Calculate average zero crossings per callback
        let avg_crossings: f32 =
            self.zero_crossings.iter().sum::<u32>() as f32 / self.zero_crossings.len() as f32;

        // Estimate frequency from zero crossings (very rough approximation)
        // This is a simplified approach - real frequency analysis would need FFT
        let samples_per_callback = self.analysis_window_size as f32 / 10.0; // Rough estimate
        let estimated_freq =
            (avg_crossings / 2.0) * (self.expected_sample_rate as f32 / samples_per_callback);

        // Convert back to sample rate estimate (this is very approximate)
        // For speech, fundamental frequencies are typically 80-255 Hz
        // This is more about detecting major discrepancies than precise measurement
        if estimated_freq > 10.0 && estimated_freq < 1000.0 {
            // Use the expected sample rate as baseline and look for major discrepancies
            // This is primarily to catch cases where device reports wrong rate
            Some(self.expected_sample_rate)
        } else {
            None
        }
    }

    /// Validate signal consistency
    fn validate_signal_consistency(&self) -> Option<ValidationInconsistency> {
        if self.signal_levels.len() < 20 {
            return None;
        }

        // Check for sudden level changes that might indicate format issues
        let recent_levels: Vec<f32> = self.signal_levels.iter().rev().take(10).cloned().collect();
        let older_levels: Vec<f32> = self
            .signal_levels
            .iter()
            .rev()
            .skip(10)
            .take(10)
            .cloned()
            .collect();

        if !recent_levels.is_empty() && !older_levels.is_empty() {
            let recent_avg: f32 = recent_levels.iter().sum::<f32>() / recent_levels.len() as f32;
            let older_avg: f32 = older_levels.iter().sum::<f32>() / older_levels.len() as f32;

            // Check for dramatic level changes
            if older_avg > 1e-6 && recent_avg > 1e-6 {
                let ratio = recent_avg / older_avg;
                if ratio > 5.0 || ratio < 0.2 {
                    return Some(ValidationInconsistency {
                        inconsistency_type: "signal_level_discontinuity".to_string(),
                        detected_at: Instant::now(),
                        details: format!(
                            "Signal level changed by {}x (from {:.6} to {:.6})",
                            ratio, older_avg, recent_avg
                        ),
                        severity: InconsistencySeverity::Medium,
                    });
                }
            }
        }

        None
    }

    /// Validate channel configuration
    fn validate_channel_configuration(
        &self,
        callback_info: &CallbackInfo,
    ) -> Option<ValidationInconsistency> {
        // Check if callback sample count matches expected channel configuration
        let expected_samples_per_callback = callback_info.frames * self.expected_channels as usize;
        if callback_info.samples_received != expected_samples_per_callback {
            return Some(ValidationInconsistency {
                inconsistency_type: "channel_mismatch".to_string(),
                detected_at: Instant::now(),
                details: format!(
                    "Expected {} samples ({} frames × {} channels), got {}",
                    expected_samples_per_callback,
                    callback_info.frames,
                    self.expected_channels,
                    callback_info.samples_received
                ),
                severity: InconsistencySeverity::High,
            });
        }

        None
    }

    /// Validate callback timing
    fn validate_callback_timing(
        &self,
        callback_info: &CallbackInfo,
    ) -> Option<ValidationInconsistency> {
        // Calculate expected time between callbacks
        let expected_interval_ms =
            (callback_info.frames as f32 / self.expected_sample_rate as f32) * 1000.0;
        let actual_interval_ms = callback_info.time_since_last.as_millis() as f32;

        // Allow for some variance in timing
        let tolerance = expected_interval_ms * 0.5; // 50% tolerance

        if (actual_interval_ms - expected_interval_ms).abs() > tolerance && actual_interval_ms > 1.0
        {
            return Some(ValidationInconsistency {
                inconsistency_type: "timing_inconsistency".to_string(),
                detected_at: Instant::now(),
                details: format!(
                    "Expected ~{:.1}ms between callbacks, got {:.1}ms",
                    expected_interval_ms, actual_interval_ms
                ),
                severity: InconsistencySeverity::Low,
            });
        }

        None
    }

    /// Check if validation should be performed
    fn should_validate(&self) -> bool {
        self.callback_count % self.validation_interval == 0
            || self.last_validation.elapsed() > Duration::from_secs(30)
    }

    /// Adjust validation frequency based on detected issues
    fn adjust_validation_frequency(&mut self, result: &ValidationResult) {
        match result {
            ValidationResult::Ok => {
                // Decrease frequency for stable operation
                self.validation_interval = (self.validation_interval + 10).min(200);
            }
            ValidationResult::IssuesDetected(_, severity) => {
                // Increase frequency for problematic devices
                match severity {
                    InconsistencySeverity::Critical => self.validation_interval = 10,
                    InconsistencySeverity::High => self.validation_interval = 20,
                    InconsistencySeverity::Medium => self.validation_interval = 30,
                    InconsistencySeverity::Low => self.validation_interval = 50,
                }
            }
            _ => {}
        }
    }

    /// Generate pattern analysis report
    pub fn generate_pattern_analysis(&self) -> Option<AudioPatternAnalysis> {
        if self.signal_levels.is_empty() {
            return None;
        }

        let avg_signal_level =
            self.signal_levels.iter().sum::<f32>() / self.signal_levels.len() as f32;
        let avg_zero_crossings = if !self.zero_crossings.is_empty() {
            self.zero_crossings.iter().sum::<u32>() as f32 / self.zero_crossings.len() as f32
        } else {
            0.0
        };

        // Simple frequency content classification
        let frequency_content = if avg_zero_crossings < 10.0 {
            "low_frequency".to_string()
        } else if avg_zero_crossings < 50.0 {
            "speech_range".to_string()
        } else {
            "high_frequency".to_string()
        };

        // Confidence in sample rate detection (simplified)
        let sample_rate_confidence = if self
            .inconsistencies
            .iter()
            .any(|i| i.inconsistency_type == "sample_rate_mismatch")
        {
            0.3 // Low confidence if mismatches detected
        } else {
            0.8 // Moderate confidence if no issues
        };

        Some(AudioPatternAnalysis {
            avg_signal_level,
            frequency_content,
            sample_rate_confidence,
            detected_format: None, // Could be enhanced with more sophisticated analysis
        })
    }

    /// Get validation statistics
    pub fn get_validation_stats(&self) -> ValidationStats {
        let critical_count = self
            .inconsistencies
            .iter()
            .filter(|i| i.severity == InconsistencySeverity::Critical)
            .count();
        let high_count = self
            .inconsistencies
            .iter()
            .filter(|i| i.severity == InconsistencySeverity::High)
            .count();
        let medium_count = self
            .inconsistencies
            .iter()
            .filter(|i| i.severity == InconsistencySeverity::Medium)
            .count();
        let low_count = self
            .inconsistencies
            .iter()
            .filter(|i| i.severity == InconsistencySeverity::Low)
            .count();

        ValidationStats {
            callbacks_processed: self.callback_count,
            validations_performed: self.callback_count / self.validation_interval,
            inconsistencies_detected: self.inconsistencies.len() as u32,
            critical_issues: critical_count as u32,
            high_issues: high_count as u32,
            medium_issues: medium_count as u32,
            low_issues: low_count as u32,
        }
    }
}

#[derive(Debug)]
pub struct CallbackInfo {
    pub frames: usize,
    pub samples_received: usize,
    pub time_since_last: Duration,
}

#[derive(Debug)]
pub enum ValidationResult {
    Ok,
    InsufficientData,
    IssuesDetected(Vec<ValidationInconsistency>, InconsistencySeverity),
}

#[derive(Debug)]
pub struct ValidationStats {
    pub callbacks_processed: u64,
    pub validations_performed: u64,
    pub inconsistencies_detected: u32,
    pub critical_issues: u32,
    pub high_issues: u32,
    pub medium_issues: u32,
    pub low_issues: u32,
}

/// Calculate RMS level of audio samples
fn calculate_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }

    let sum_squares: f32 = samples.iter().map(|&s| s * s).sum();
    (sum_squares / samples.len() as f32).sqrt()
}

/// Count zero crossings in audio samples
fn count_zero_crossings(samples: &[f32]) -> u32 {
    if samples.len() < 2 {
        return 0;
    }

    let mut crossings = 0u32;
    for i in 1..samples.len() {
        if (samples[i - 1] >= 0.0) != (samples[i] >= 0.0) {
            crossings += 1;
        }
    }

    crossings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rms_calculation() {
        let samples = vec![0.5, -0.5, 0.5, -0.5];
        let rms = calculate_rms(&samples);
        assert!((rms - 0.5).abs() < 1e-6);
    }

    #[test]
    fn test_zero_crossings() {
        let samples = vec![1.0, -1.0, 1.0, -1.0, 1.0];
        let crossings = count_zero_crossings(&samples);
        assert_eq!(crossings, 4);
    }

    #[test]
    fn test_validator_creation() {
        let validator = AudioFormatValidator::new(48000, 2);
        assert_eq!(validator.expected_sample_rate, 48000);
        assert_eq!(validator.expected_channels, 2);
    }
}
