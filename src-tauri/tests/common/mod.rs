use std::sync::Arc;
use tempfile::TempDir;
use cpal::traits::{DeviceTrait, HostTrait};
use hound::{WavSpec, SampleFormat, WavWriter};
use std::fs::File;
use std::path::Path;

// Add simplified pipeline module
pub mod simplified_pipeline;

/// Create a test audio buffer with a sine wave
pub fn create_test_audio_buffer(duration_secs: f32, sample_rate: u32, frequency: f32) -> Vec<f32> {
    let num_samples = (duration_secs * sample_rate as f32) as usize;
    let mut buffer = Vec::with_capacity(num_samples);
    
    for i in 0..num_samples {
        let t = i as f32 / sample_rate as f32;
        let sample = (2.0 * std::f32::consts::PI * frequency * t).sin();
        buffer.push(sample);
    }
    
    buffer
}

/// Create a test audio buffer with a sawtooth wave
pub fn create_sawtooth_buffer(duration_secs: f32, sample_rate: u32, frequency: f32) -> Vec<f32> {
    let num_samples = (duration_secs * sample_rate as f32) as usize;
    let mut buffer = Vec::with_capacity(num_samples);
    
    for i in 0..num_samples {
        let t = i as f32 / sample_rate as f32;
        let phase = (frequency * t) % 1.0;
        let sample = 2.0 * phase - 1.0; // Sawtooth from -1 to 1
        buffer.push(sample);
    }
    
    buffer
}

/// Create a test audio buffer with white noise
pub fn create_noise_buffer(duration_secs: f32, sample_rate: u32, amplitude: f32) -> Vec<f32> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    
    let num_samples = (duration_secs * sample_rate as f32) as usize;
    let mut buffer = Vec::with_capacity(num_samples);
    
    // Simple PRNG for reproducible noise
    let mut seed = 12345u64;
    for _ in 0..num_samples {
        let mut hasher = DefaultHasher::new();
        seed.hash(&mut hasher);
        seed = hasher.finish();
        
        let normalized = (seed as f32 / u64::MAX as f32) * 2.0 - 1.0;
        buffer.push(normalized * amplitude);
    }
    
    buffer
}

/// Create a test database in a temporary directory
pub async fn create_test_db() -> (sqlx::SqlitePool, TempDir) {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.db");
    let db_url = format!("sqlite:{}", db_path.display());
    
    let pool = sqlx::SqlitePool::connect(&db_url).await.unwrap();
    
    // Run migrations
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .unwrap();
    
    (pool, temp_dir)
}

/// Create silence detection test data
pub fn create_silence_buffer(duration_secs: f32, sample_rate: u32) -> Vec<f32> {
    vec![0.0; (duration_secs * sample_rate as f32) as usize]
}

/// Create a buffer with alternating silence and audio
pub fn create_mixed_audio_buffer(
    audio_duration: f32,
    silence_duration: f32, 
    sample_rate: u32,
    frequency: f32,
    repetitions: usize
) -> Vec<f32> {
    let mut buffer = Vec::new();
    
    for _ in 0..repetitions {
        // Add audio
        buffer.extend(create_test_audio_buffer(audio_duration, sample_rate, frequency));
        // Add silence
        buffer.extend(create_silence_buffer(silence_duration, sample_rate));
    }
    
    buffer
}

/// Create a buffer with gradual volume changes (fade in/out)
pub fn create_fading_buffer(duration_secs: f32, sample_rate: u32, frequency: f32) -> Vec<f32> {
    let num_samples = (duration_secs * sample_rate as f32) as usize;
    let mut buffer = Vec::with_capacity(num_samples);
    
    for i in 0..num_samples {
        let t = i as f32 / sample_rate as f32;
        let progress = i as f32 / num_samples as f32;
        
        // Sine wave
        let sine = (2.0 * std::f32::consts::PI * frequency * t).sin();
        
        // Fade envelope (fade in first quarter, fade out last quarter)
        let envelope = if progress < 0.25 {
            progress * 4.0 // Fade in
        } else if progress > 0.75 {
            (1.0 - progress) * 4.0 // Fade out
        } else {
            1.0 // Full volume
        };
        
        buffer.push(sine * envelope);
    }
    
    buffer
}

/// Convert f32 samples to i16 for testing
pub fn convert_f32_to_i16(samples: &[f32]) -> Vec<i16> {
    samples.iter()
        .map(|&sample| {
            let clamped = sample.clamp(-1.0, 1.0);
            (clamped * i16::MAX as f32) as i16
        })
        .collect()
}

/// Convert i16 samples to f32 for testing
pub fn convert_i16_to_f32(samples: &[i16]) -> Vec<f32> {
    samples.iter()
        .map(|&sample| sample as f32 / i16::MAX as f32)
        .collect()
}

/// Assert that two audio buffers are approximately equal
pub fn assert_audio_equal(actual: &[f32], expected: &[f32], tolerance: f32) {
    assert_eq!(actual.len(), expected.len(), 
        "Audio buffers have different lengths: {} vs {}", actual.len(), expected.len());
    
    for (i, (&a, &e)) in actual.iter().zip(expected.iter()).enumerate() {
        assert!((a - e).abs() < tolerance, 
            "Sample {} differs: {} vs {} (tolerance: {})", i, a, e, tolerance);
    }
}

/// Assert that audio buffer has expected RMS level
pub fn assert_audio_rms(samples: &[f32], expected_rms: f32, tolerance: f32) {
    let rms = calculate_rms(samples);
    assert!((rms - expected_rms).abs() < tolerance,
        "RMS differs: {} vs {} (tolerance: {})", rms, expected_rms, tolerance);
}

/// Calculate RMS (Root Mean Square) of audio samples
pub fn calculate_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    
    let sum_squares: f32 = samples.iter().map(|&s| s * s).sum();
    (sum_squares / samples.len() as f32).sqrt()
}

/// Calculate peak amplitude of audio samples
pub fn calculate_peak(samples: &[f32]) -> f32 {
    samples.iter().map(|&s| s.abs()).fold(0.0, f32::max)
}

/// Detect zero crossings in audio samples
pub fn count_zero_crossings(samples: &[f32]) -> usize {
    let mut crossings = 0;
    for i in 1..samples.len() {
        if (samples[i-1] >= 0.0) != (samples[i] >= 0.0) {
            crossings += 1;
        }
    }
    crossings
}

/// Create a WAV file for testing
pub fn create_test_wav_file(
    path: &Path, 
    spec: WavSpec, 
    samples: &[f32]
) -> Result<(), Box<dyn std::error::Error>> {
    let mut writer = WavWriter::create(path, spec)?;
    
    match spec.sample_format {
        SampleFormat::Float => {
            for &sample in samples {
                writer.write_sample(sample)?;
            }
        }
        SampleFormat::Int => {
            for &sample in samples {
                let sample_i16 = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                writer.write_sample(sample_i16)?;
            }
        }
    }
    
    writer.finalize()?;
    Ok(())
}

/// Read a WAV file for testing
pub fn read_test_wav_file(path: &Path) -> Result<(WavSpec, Vec<f32>), Box<dyn std::error::Error>> {
    let mut reader = hound::WavReader::open(path)?;
    let spec = reader.spec();
    
    let samples: Result<Vec<f32>, _> = match spec.sample_format {
        hound::SampleFormat::Float => {
            reader.samples::<f32>().collect()
        }
        hound::SampleFormat::Int => {
            reader.samples::<i16>()
                .map(|s| s.map(|sample| sample as f32 / i16::MAX as f32))
                .collect()
        }
    };
    
    let wav_spec = WavSpec {
        channels: spec.channels,
        sample_rate: spec.sample_rate,
        bits_per_sample: spec.bits_per_sample,
        sample_format: match spec.sample_format {
            hound::SampleFormat::Float => SampleFormat::Float,
            hound::SampleFormat::Int => SampleFormat::Int,
        },
    };
    
    Ok((wav_spec, samples?))
}

/// Create a mock audio device info
pub fn create_mock_device_info() -> MockDeviceInfo {
    MockDeviceInfo {
        name: "Test Audio Device".to_string(),
        sample_rate: 16000,
        channels: 1,
    }
}

pub struct MockDeviceInfo {
    pub name: String,
    pub sample_rate: u32,
    pub channels: u16,
}

/// Mock WAV spec for testing
pub fn create_test_wav_spec(channels: u16, sample_rate: u32) -> WavSpec {
    WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 32,
        sample_format: SampleFormat::Float,
    }
}

/// Mock I16 WAV spec for testing
pub fn create_test_wav_spec_i16(channels: u16, sample_rate: u32) -> WavSpec {
    WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    }
}

/// Create stereo samples from mono by duplicating channels
pub fn mono_to_stereo(mono_samples: &[f32]) -> Vec<f32> {
    let mut stereo = Vec::with_capacity(mono_samples.len() * 2);
    for &sample in mono_samples {
        stereo.push(sample);
        stereo.push(sample);
    }
    stereo
}

/// Convert stereo samples to mono by averaging channels
pub fn stereo_to_mono(stereo_samples: &[f32]) -> Vec<f32> {
    assert_eq!(stereo_samples.len() % 2, 0, "Stereo samples must be even length");
    
    let mut mono = Vec::with_capacity(stereo_samples.len() / 2);
    for chunk in stereo_samples.chunks_exact(2) {
        let avg = (chunk[0] + chunk[1]) / 2.0;
        mono.push(avg);
    }
    mono
}

/// Apply simple gain to audio samples
pub fn apply_gain(samples: &mut [f32], gain_db: f32) {
    let gain_linear = 10.0_f32.powf(gain_db / 20.0);
    for sample in samples {
        *sample *= gain_linear;
    }
}

/// Create a test environment with temporary directory
pub fn setup_test_env() -> TempDir {
    TempDir::new().expect("Failed to create temp directory")
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_create_test_audio_buffer() {
        let buffer = create_test_audio_buffer(1.0, 16000, 440.0);
        assert_eq!(buffer.len(), 16000);
        
        // Check that it's actually a sine wave
        let first_peak_idx = (16000.0 / 440.0 / 4.0) as usize;
        assert!(buffer[first_peak_idx] > 0.9);
    }
    
    #[test]
    fn test_convert_f32_to_i16() {
        let f32_samples = vec![0.0, 0.5, 1.0, -0.5, -1.0];
        let i16_samples = convert_f32_to_i16(&f32_samples);
        
        assert_eq!(i16_samples[0], 0);
        assert_eq!(i16_samples[1], i16::MAX / 2);
        assert_eq!(i16_samples[2], i16::MAX);
        assert_eq!(i16_samples[3], i16::MIN / 2 + 1); // Rounding difference
        assert_eq!(i16_samples[4], i16::MIN + 1); // Due to asymmetry
    }
}

/// Create a WAV file with the given samples
pub fn create_wav_file(path: &std::path::Path, spec: hound::WavSpec, samples: &[i16]) -> Result<(), hound::Error> {
    let mut writer = hound::WavWriter::create(path, spec)?;
    for &sample in samples {
        writer.write_sample(sample)?;
    }
    writer.finalize()?;
    Ok(())
}