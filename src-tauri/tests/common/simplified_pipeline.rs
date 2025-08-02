/// Common test utilities for simplified pipeline testing
/// 
/// This module provides shared utilities for:
/// - Test environment setup
/// - Mock data generation
/// - Performance measurement
/// - Test audio file creation

use std::path::{Path, PathBuf};
use std::time::Duration;
use std::sync::Arc;
use tokio::sync::Mutex;
use hound::{WavSpec, WavWriter};

/// Test configuration for pipeline tests
#[derive(Debug, Clone)]
pub struct TestConfig {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
    pub use_mock_transcriber: bool,
    pub enable_performance_logging: bool,
}

impl Default for TestConfig {
    fn default() -> Self {
        Self {
            sample_rate: 48000,
            channels: 1,
            bits_per_sample: 32,
            use_mock_transcriber: true,
            enable_performance_logging: false,
        }
    }
}

/// Setup test environment with proper directories and configuration
pub async fn setup_test_environment() -> Result<TestEnvironment, Box<dyn std::error::Error>> {
    use tempfile::TempDir;
    
    let temp_dir = TempDir::new()?;
    let recordings_dir = temp_dir.path().join("recordings");
    let models_dir = temp_dir.path().join("models");
    let data_dir = temp_dir.path().join("data");
    
    std::fs::create_dir_all(&recordings_dir)?;
    std::fs::create_dir_all(&models_dir)?;
    std::fs::create_dir_all(&data_dir)?;
    
    // Copy or create mock model files if needed
    create_mock_model_files(&models_dir)?;
    
    Ok(TestEnvironment {
        temp_dir,
        recordings_dir,
        models_dir,
        data_dir,
    })
}

pub struct TestEnvironment {
    pub temp_dir: tempfile::TempDir,
    pub recordings_dir: PathBuf,
    pub models_dir: PathBuf,
    pub data_dir: PathBuf,
}

/// Generate test audio file with specified duration
/// Creates a WAV file with a 440Hz sine wave for testing
pub fn generate_test_audio(path: &Path, duration: Duration) -> Result<(), Box<dyn std::error::Error>> {
    let spec = WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let mut writer = WavWriter::create(path, spec)?;
    let total_samples = (spec.sample_rate as f64 * duration.as_secs_f64()) as usize;
    
    for i in 0..total_samples {
        let sample = (2.0 * std::f32::consts::PI * 440.0 * i as f32 / spec.sample_rate as f32).sin();
        writer.write_sample(sample)?;
    }
    
    writer.finalize()?;
    Ok(())
}

/// Generate test audio with speech-like characteristics
/// Creates a more realistic test file with varying frequencies and amplitudes
pub fn generate_speech_like_audio(path: &Path, duration: Duration) -> Result<(), Box<dyn std::error::Error>> {
    let spec = WavSpec {
        channels: 1,
        sample_rate: 16000, // Common for speech
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let mut writer = WavWriter::create(path, spec)?;
    let total_samples = (spec.sample_rate as f64 * duration.as_secs_f64()) as usize;
    
    // Simulate speech with formants and variations
    for i in 0..total_samples {
        let t = i as f32 / spec.sample_rate as f32;
        
        // Combine multiple frequencies to simulate speech formants
        let f1 = 700.0 + 200.0 * (t * 0.5).sin(); // First formant
        let f2 = 1220.0 + 300.0 * (t * 0.3).sin(); // Second formant
        let f3 = 2600.0 + 400.0 * (t * 0.2).sin(); // Third formant
        
        let sample = 0.3 * (2.0 * std::f32::consts::PI * f1 * t).sin()
                   + 0.2 * (2.0 * std::f32::consts::PI * f2 * t).sin()
                   + 0.1 * (2.0 * std::f32::consts::PI * f3 * t).sin();
        
        // Add amplitude modulation to simulate speech patterns
        let envelope = (0.5 + 0.5 * (t * 2.0).sin()).max(0.1);
        writer.write_sample(sample * envelope)?;
    }
    
    writer.finalize()?;
    Ok(())
}

/// Generate silent audio file for testing VAD and silence detection
pub fn generate_silent_audio(path: &Path, duration: Duration) -> Result<(), Box<dyn std::error::Error>> {
    let spec = WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let mut writer = WavWriter::create(path, spec)?;
    let total_samples = (spec.sample_rate as f64 * duration.as_secs_f64()) as usize;
    
    // Write silence with minimal noise
    // Use a simple linear congruential generator for predictable noise
    let mut seed = 12345u32;
    for _ in 0..total_samples {
        // Simple LCG for pseudo-random numbers
        seed = seed.wrapping_mul(1103515245).wrapping_add(12345);
        let noise = ((seed >> 16) as f32 / 32768.0 - 1.0) * 0.001; // Very low noise floor
        writer.write_sample(noise)?;
    }
    
    writer.finalize()?;
    Ok(())
}

/// Generate audio with alternating speech and silence
pub fn generate_vad_test_audio(path: &Path, speech_duration: Duration, silence_duration: Duration, cycles: usize) -> Result<(), Box<dyn std::error::Error>> {
    let spec = WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    
    let mut writer = WavWriter::create(path, spec)?;
    let speech_samples = (spec.sample_rate as f64 * speech_duration.as_secs_f64()) as usize;
    let silence_samples = (spec.sample_rate as f64 * silence_duration.as_secs_f64()) as usize;
    
    for cycle in 0..cycles {
        // Speech segment
        for i in 0..speech_samples {
            let t = i as f32 / spec.sample_rate as f32;
            let sample = 0.5 * (2.0 * std::f32::consts::PI * 440.0 * t).sin();
            writer.write_sample(sample)?;
        }
        
        // Silence segment
        for _ in 0..silence_samples {
            writer.write_sample(0.0f32)?;
        }
    }
    
    writer.finalize()?;
    Ok(())
}

/// Create mock model files for testing
fn create_mock_model_files(models_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    // Create mock model files (empty files for testing)
    let models = vec!["ggml-tiny.bin", "ggml-base.bin", "ggml-small.bin"];
    
    for model in models {
        let model_path = models_dir.join(model);
        std::fs::File::create(model_path)?;
    }
    
    Ok(())
}

/// Mock audio device for testing
pub struct MockAudioDevice {
    pub name: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub buffer_size: usize,
}

impl Default for MockAudioDevice {
    fn default() -> Self {
        Self {
            name: "Mock Audio Device".to_string(),
            sample_rate: 48000,
            channels: 1,
            buffer_size: 512,
        }
    }
}

/// Performance measurement helper
pub struct PerformanceTracker {
    measurements: Vec<PerformanceMeasurement>,
}

#[derive(Debug, Clone)]
pub struct PerformanceMeasurement {
    pub name: String,
    pub duration_ms: u64,
    pub memory_mb: usize,
    pub timestamp: std::time::Instant,
}

impl PerformanceTracker {
    pub fn new() -> Self {
        Self {
            measurements: Vec::new(),
        }
    }
    
    pub fn record(&mut self, name: &str, duration: Duration) {
        self.measurements.push(PerformanceMeasurement {
            name: name.to_string(),
            duration_ms: duration.as_millis() as u64,
            memory_mb: get_memory_usage_mb(),
            timestamp: std::time::Instant::now(),
        });
    }
    
    pub fn get_summary(&self) -> PerformanceSummary {
        let total_duration_ms: u64 = self.measurements.iter().map(|m| m.duration_ms).sum();
        let avg_memory_mb = if self.measurements.is_empty() {
            0
        } else {
            self.measurements.iter().map(|m| m.memory_mb).sum::<usize>() / self.measurements.len()
        };
        
        PerformanceSummary {
            total_duration_ms,
            avg_memory_mb,
            measurement_count: self.measurements.len(),
        }
    }
    
    pub fn print_report(&self) {
        println!("\n=== Performance Report ===");
        for measurement in &self.measurements {
            println!("{}: {}ms, {}MB", measurement.name, measurement.duration_ms, measurement.memory_mb);
        }
        let summary = self.get_summary();
        println!("Total: {}ms, Avg Memory: {}MB", summary.total_duration_ms, summary.avg_memory_mb);
    }
}

#[derive(Debug)]
pub struct PerformanceSummary {
    pub total_duration_ms: u64,
    pub avg_memory_mb: usize,
    pub measurement_count: usize,
}

fn get_memory_usage_mb() -> usize {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let output = Command::new("ps")
            .args(&["-o", "rss=", "-p", &std::process::id().to_string()])
            .output()
            .unwrap_or_else(|_| {
                std::process::Command::new("echo")
                    .arg("0")
                    .output()
                    .unwrap()
            });
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<usize>()
            .unwrap_or(0) / 1024
    }
    
    #[cfg(target_os = "linux")]
    {
        // Parse /proc/self/status for VmRSS
        use std::fs::File;
        use std::io::{BufRead, BufReader};
        
        if let Ok(file) = File::open("/proc/self/status") {
            let reader = BufReader::new(file);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if line.starts_with("VmRSS:") {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if parts.len() >= 2 {
                            if let Ok(kb) = parts[1].parse::<usize>() {
                                return kb / 1024;
                            }
                        }
                    }
                }
            }
        }
        0
    }
    
    #[cfg(target_os = "windows")]
    {
        // Use Windows API - simplified implementation
        // For a full implementation, we would use winapi crate with GetProcessMemoryInfo
        0
    }
    
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        0 // Fallback for other platforms
    }
}

/// Verify audio file integrity
pub fn verify_wav_file(path: &Path) -> Result<WavFileInfo, Box<dyn std::error::Error>> {
    let reader = hound::WavReader::open(path)?;
    let spec = reader.spec();
    let sample_count = reader.len();
    let duration_seconds = sample_count as f64 / spec.sample_rate as f64;
    
    Ok(WavFileInfo {
        sample_rate: spec.sample_rate,
        channels: spec.channels,
        bits_per_sample: spec.bits_per_sample,
        sample_count,
        duration_seconds,
        file_size_bytes: std::fs::metadata(path)?.len(),
    })
}

#[derive(Debug)]
pub struct WavFileInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
    pub sample_count: u32,
    pub duration_seconds: f64,
    pub file_size_bytes: u64,
}

/// Assert that two float values are approximately equal
pub fn assert_approx_eq(actual: f64, expected: f64, tolerance: f64, message: &str) {
    let diff = (actual - expected).abs();
    assert!(
        diff <= tolerance,
        "{}: expected {} ± {}, got {} (diff: {})",
        message, expected, tolerance, actual, diff
    );
}

/// Generate corrupted audio file for error handling tests
pub fn generate_corrupted_audio(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    use std::io::Write;
    
    // Write invalid WAV header
    let mut file = std::fs::File::create(path)?;
    file.write_all(b"RIFF")?;
    file.write_all(&[0xFF; 100])?; // Invalid data
    
    Ok(())
}

/// Simulate audio device disconnection (for error handling tests)
pub struct AudioDeviceSimulator {
    pub is_connected: Arc<Mutex<bool>>,
}

impl AudioDeviceSimulator {
    pub fn new() -> Self {
        Self {
            is_connected: Arc::new(Mutex::new(true)),
        }
    }
    
    pub async fn disconnect(&self) {
        *self.is_connected.lock().await = false;
    }
    
    pub async fn reconnect(&self) {
        *self.is_connected.lock().await = true;
    }
    
    pub async fn is_available(&self) -> bool {
        *self.is_connected.lock().await
    }
}