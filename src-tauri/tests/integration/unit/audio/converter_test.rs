use super::super::super::common::{create_test_audio_buffer, assert_audio_equal};
use scout_lib::audio::converter::AudioConverter;
use hound::{WavSpec, SampleFormat, WavWriter};
use std::fs::File;
use std::io::Cursor;
use tempfile::TempDir;

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_temp_dir() -> TempDir {
        TempDir::new().expect("Failed to create temp directory")
    }

    fn create_test_wav_file(path: &std::path::Path, spec: WavSpec, samples: &[f32]) -> Result<(), String> {
        let mut writer = WavWriter::create(path, spec)
            .map_err(|e| format!("Failed to create WAV writer: {}", e))?;
        
        match spec.sample_format {
            SampleFormat::Float => {
                for &sample in samples {
                    writer.write_sample(sample)
                        .map_err(|e| format!("Failed to write sample: {}", e))?;
                }
            }
            SampleFormat::Int => {
                for &sample in samples {
                    let sample_i16 = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                    writer.write_sample(sample_i16)
                        .map_err(|e| format!("Failed to write sample: {}", e))?;
                }
            }
        }
        
        writer.finalize()
            .map_err(|e| format!("Failed to finalize WAV: {}", e))?;
        
        Ok(())
    }

    fn create_mono_16khz_spec() -> WavSpec {
        WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 16,
            sample_format: SampleFormat::Int,
        }
    }

    fn create_stereo_48khz_spec() -> WavSpec {
        WavSpec {
            channels: 2,
            sample_rate: 48000,
            bits_per_sample: 32,
            sample_format: SampleFormat::Float,
        }
    }

    #[test]
    fn test_needs_conversion_wav_file() {
        let temp_dir = setup_temp_dir();
        let wav_path = temp_dir.path().join("test.wav");
        let mp3_path = temp_dir.path().join("test.mp3");
        let no_ext_path = temp_dir.path().join("test");
        
        assert!(!AudioConverter::needs_conversion(&wav_path));
        assert!(AudioConverter::needs_conversion(&mp3_path));
        assert!(AudioConverter::needs_conversion(&no_ext_path));
    }

    #[test]
    fn test_needs_conversion_case_insensitive() {
        let temp_dir = setup_temp_dir();
        let wav_upper = temp_dir.path().join("test.WAV");
        let wav_mixed = temp_dir.path().join("test.Wav");
        
        // Should be case insensitive
        assert!(!AudioConverter::needs_conversion(&wav_upper));
        assert!(!AudioConverter::needs_conversion(&wav_mixed));
    }

    #[test]
    fn test_get_wav_path() {
        let temp_dir = setup_temp_dir();
        let mp3_path = temp_dir.path().join("audio.mp3");
        let expected_wav = temp_dir.path().join("audio.wav");
        
        let wav_path = AudioConverter::get_wav_path(&mp3_path);
        assert_eq!(wav_path, expected_wav);
    }

    #[test]
    fn test_get_wav_path_already_wav() {
        let temp_dir = setup_temp_dir();
        let wav_path = temp_dir.path().join("audio.wav");
        
        let result_path = AudioConverter::get_wav_path(&wav_path);
        assert_eq!(result_path, wav_path);
    }

    #[test]
    fn test_get_wav_path_no_extension() {
        let temp_dir = setup_temp_dir();
        let no_ext_path = temp_dir.path().join("audio");
        let expected_wav = temp_dir.path().join("audio.wav");
        
        let wav_path = AudioConverter::get_wav_path(&no_ext_path);
        assert_eq!(wav_path, expected_wav);
    }

    #[test]
    fn test_convert_to_wav_bytes_basic() {
        let temp_dir = setup_temp_dir();
        let input_path = temp_dir.path().join("input.wav");
        
        // Create a simple test WAV file
        let spec = create_mono_16khz_spec();
        let test_samples = create_test_audio_buffer(0.5, 16000, 440.0);
        create_test_wav_file(&input_path, spec, &test_samples).unwrap();
        
        // Convert to bytes
        let result = AudioConverter::convert_to_wav_bytes(&input_path);
        assert!(result.is_ok(), "Failed to convert WAV to bytes: {:?}", result);
        
        let wav_bytes = result.unwrap();
        assert!(wav_bytes.len() > 0);
        
        // Basic WAV header validation
        assert_eq!(&wav_bytes[0..4], b"RIFF");
        assert_eq!(&wav_bytes[8..12], b"WAVE");
    }

    #[test]
    fn test_convert_to_wav_bytes_nonexistent_file() {
        let temp_dir = setup_temp_dir();
        let nonexistent_path = temp_dir.path().join("nonexistent.wav");
        
        let result = AudioConverter::convert_to_wav_bytes(&nonexistent_path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to open input file"));
    }

    #[test]
    fn test_convert_to_wav_bytes_invalid_file() {
        let temp_dir = setup_temp_dir();
        let invalid_path = temp_dir.path().join("invalid.wav");
        
        // Create a file with invalid content
        std::fs::write(&invalid_path, b"not a valid audio file").unwrap();
        
        let result = AudioConverter::convert_to_wav_bytes(&invalid_path);
        assert!(result.is_err());
        // Should fail during audio format probing
    }

    #[test]
    fn test_convert_to_wav_file_basic() {
        let temp_dir = setup_temp_dir();
        let input_path = temp_dir.path().join("input.wav");
        let output_path = temp_dir.path().join("output.wav");
        
        // Create input file with different specs than target
        let input_spec = create_stereo_48khz_spec();
        let test_samples = create_test_audio_buffer(1.0, 48000, 440.0);
        
        // Create stereo by duplicating mono samples
        let mut stereo_samples = Vec::new();
        for sample in test_samples {
            stereo_samples.push(sample);
            stereo_samples.push(sample * 0.8); // Slightly different right channel
        }
        
        create_test_wav_file(&input_path, input_spec, &stereo_samples).unwrap();
        
        // Convert to 16kHz mono WAV
        let result = AudioConverter::convert_to_wav(&input_path, &output_path);
        assert!(result.is_ok(), "Failed to convert WAV: {:?}", result);
        
        // Verify output file exists
        assert!(output_path.exists());
        
        // Verify output file has correct format by reading it back
        let reader = hound::WavReader::open(&output_path);
        assert!(reader.is_ok());
        
        let reader = reader.unwrap();
        let spec = reader.spec();
        assert_eq!(spec.channels, 1); // Should be mono
        assert_eq!(spec.sample_rate, 16000); // Should be 16kHz
        assert_eq!(spec.bits_per_sample, 16); // Should be 16-bit
    }

    #[test]
    fn test_convert_to_wav_file_already_correct_format() {
        let temp_dir = setup_temp_dir();
        let input_path = temp_dir.path().join("input.wav");
        let output_path = temp_dir.path().join("output.wav");
        
        // Create input file that's already in target format (16kHz mono)
        let spec = create_mono_16khz_spec();
        let test_samples = create_test_audio_buffer(1.0, 16000, 440.0);
        create_test_wav_file(&input_path, spec, &test_samples).unwrap();
        
        let result = AudioConverter::convert_to_wav(&input_path, &output_path);
        assert!(result.is_ok());
        
        assert!(output_path.exists());
        
        // Verify output maintains the same format
        let reader = hound::WavReader::open(&output_path).unwrap();
        let output_spec = reader.spec();
        assert_eq!(output_spec.channels, 1);
        assert_eq!(output_spec.sample_rate, 16000);
    }

    #[test]
    fn test_convert_to_wav_file_nonexistent_input() {
        let temp_dir = setup_temp_dir();
        let nonexistent_input = temp_dir.path().join("nonexistent.wav");
        let output_path = temp_dir.path().join("output.wav");
        
        let result = AudioConverter::convert_to_wav(&nonexistent_input, &output_path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to open input file"));
    }

    #[test]
    fn test_convert_to_wav_file_invalid_output_path() {
        let temp_dir = setup_temp_dir();
        let input_path = temp_dir.path().join("input.wav");
        let invalid_output = std::path::Path::new("/invalid/path/output.wav");
        
        // Create valid input
        let spec = create_mono_16khz_spec();
        let test_samples = create_test_audio_buffer(0.5, 16000, 440.0);
        create_test_wav_file(&input_path, spec, &test_samples).unwrap();
        
        let result = AudioConverter::convert_to_wav(&input_path, &invalid_output);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to create WAV file"));
    }

    #[test]
    fn test_convert_downsampling() {
        let temp_dir = setup_temp_dir();
        let input_path = temp_dir.path().join("input.wav");
        let output_path = temp_dir.path().join("output.wav");
        
        // Create high sample rate input (48kHz)
        let input_spec = WavSpec {
            channels: 1,
            sample_rate: 48000,
            bits_per_sample: 32,
            sample_format: SampleFormat::Float,
        };
        
        let test_samples = create_test_audio_buffer(1.0, 48000, 440.0);
        create_test_wav_file(&input_path, input_spec, &test_samples).unwrap();
        
        let result = AudioConverter::convert_to_wav(&input_path, &output_path);
        assert!(result.is_ok());
        
        // Verify output is downsampled to 16kHz
        let reader = hound::WavReader::open(&output_path).unwrap();
        let spec = reader.spec();
        assert_eq!(spec.sample_rate, 16000);
        
        // Verify sample count is reduced proportionally
        let samples: Result<Vec<i16>, _> = reader.into_samples().collect();
        assert!(samples.is_ok());
        let samples = samples.unwrap();
        
        // Should have roughly 16000 samples for 1 second of audio (give or take for resampling)
        assert!(samples.len() > 15000 && samples.len() < 17000);
    }

    #[test]
    fn test_convert_stereo_to_mono() {
        let temp_dir = setup_temp_dir();
        let input_path = temp_dir.path().join("input.wav");
        let output_path = temp_dir.path().join("output.wav");
        
        // Create stereo input
        let input_spec = WavSpec {
            channels: 2,
            sample_rate: 16000,
            bits_per_sample: 32,
            sample_format: SampleFormat::Float,
        };
        
        // Create test stereo samples (L/R interleaved)
        let mut stereo_samples = Vec::new();
        for i in 0..16000 {
            let left = (i as f32 / 16000.0).sin();
            let right = (i as f32 / 16000.0 * 2.0).sin();
            stereo_samples.push(left);
            stereo_samples.push(right);
        }
        
        create_test_wav_file(&input_path, input_spec, &stereo_samples).unwrap();
        
        let result = AudioConverter::convert_to_wav(&input_path, &output_path);
        assert!(result.is_ok());
        
        // Verify output is mono
        let reader = hound::WavReader::open(&output_path).unwrap();
        let spec = reader.spec();
        assert_eq!(spec.channels, 1);
        assert_eq!(spec.sample_rate, 16000);
        
        // Verify sample count is halved (stereo to mono)
        let samples: Result<Vec<i16>, _> = reader.into_samples().collect();
        assert!(samples.is_ok());
        let samples = samples.unwrap();
        assert_eq!(samples.len(), 16000); // Should be 16000 mono samples
    }

    #[test]
    fn test_convert_different_bit_depths() {
        let temp_dir = setup_temp_dir();
        
        // Test various input bit depths
        let input_specs = vec![
            WavSpec {
                channels: 1,
                sample_rate: 16000,
                bits_per_sample: 32,
                sample_format: SampleFormat::Float,
            },
            WavSpec {
                channels: 1,
                sample_rate: 16000,
                bits_per_sample: 16,
                sample_format: SampleFormat::Int,
            },
        ];
        
        for (i, input_spec) in input_specs.iter().enumerate() {
            let input_path = temp_dir.path().join(format!("input_{}.wav", i));
            let output_path = temp_dir.path().join(format!("output_{}.wav", i));
            
            let test_samples = create_test_audio_buffer(0.5, 16000, 440.0);
            create_test_wav_file(&input_path, *input_spec, &test_samples).unwrap();
            
            let result = AudioConverter::convert_to_wav(&input_path, &output_path);
            assert!(result.is_ok(), "Failed for spec: {:?}", input_spec);
            
            // All outputs should be 16-bit int
            let reader = hound::WavReader::open(&output_path).unwrap();
            let spec = reader.spec();
            assert_eq!(spec.bits_per_sample, 16);
            assert_eq!(spec.sample_format, hound::SampleFormat::Int);
        }
    }

    #[test]
    fn test_convert_very_short_audio() {
        let temp_dir = setup_temp_dir();
        let input_path = temp_dir.path().join("input.wav");
        let output_path = temp_dir.path().join("output.wav");
        
        // Create very short audio (0.1 seconds)
        let spec = create_mono_16khz_spec();
        let test_samples = create_test_audio_buffer(0.1, 16000, 440.0);
        create_test_wav_file(&input_path, spec, &test_samples).unwrap();
        
        let result = AudioConverter::convert_to_wav(&input_path, &output_path);
        assert!(result.is_ok());
        
        assert!(output_path.exists());
        
        // Verify we still get some samples
        let reader = hound::WavReader::open(&output_path).unwrap();
        let samples: Result<Vec<i16>, _> = reader.into_samples().collect();
        assert!(samples.is_ok());
        let samples = samples.unwrap();
        assert!(samples.len() > 0);
    }

    #[test]
    fn test_convert_empty_audio() {
        let temp_dir = setup_temp_dir();
        let input_path = temp_dir.path().join("input.wav");
        let output_path = temp_dir.path().join("output.wav");
        
        // Create empty audio file
        let spec = create_mono_16khz_spec();
        let empty_samples: Vec<f32> = vec![];
        create_test_wav_file(&input_path, spec, &empty_samples).unwrap();
        
        let result = AudioConverter::convert_to_wav(&input_path, &output_path);
        assert!(result.is_ok());
        
        assert!(output_path.exists());
        
        // Should be a valid empty WAV file
        let reader = hound::WavReader::open(&output_path);
        assert!(reader.is_ok());
    }

    #[test]
    fn test_resampling_quality() {
        let temp_dir = setup_temp_dir();
        let input_path = temp_dir.path().join("input.wav");
        let output_path = temp_dir.path().join("output.wav");
        
        // Create input with known frequency at 48kHz
        let input_spec = WavSpec {
            channels: 1,
            sample_rate: 48000,
            bits_per_sample: 32,
            sample_format: SampleFormat::Float,
        };
        
        // Generate 1 second of 1kHz sine wave
        let test_samples = create_test_audio_buffer(1.0, 48000, 1000.0);
        create_test_wav_file(&input_path, input_spec, &test_samples).unwrap();
        
        let result = AudioConverter::convert_to_wav(&input_path, &output_path);
        assert!(result.is_ok());
        
        // Read output and verify it's still recognizable as 1kHz tone
        let reader = hound::WavReader::open(&output_path).unwrap();
        let samples: Result<Vec<i16>, _> = reader.into_samples().collect();
        assert!(samples.is_ok());
        let samples = samples.unwrap();
        
        // Convert back to f32 for analysis
        let f32_samples: Vec<f32> = samples.iter()
            .map(|&s| s as f32 / i16::MAX as f32)
            .collect();
        
        // Basic signal validation - should still be oscillating
        let mut zero_crossings = 0;
        for i in 1..f32_samples.len() {
            if (f32_samples[i-1] >= 0.0) != (f32_samples[i] >= 0.0) {
                zero_crossings += 1;
            }
        }
        
        // 1kHz signal at 16kHz sample rate should have roughly 2000 zero crossings per second
        // Allow some tolerance for resampling artifacts
        assert!(zero_crossings > 1500 && zero_crossings < 2500,
                "Expected ~2000 zero crossings, got {}", zero_crossings);
    }

    #[test]
    fn test_multiple_conversions_same_source() {
        let temp_dir = setup_temp_dir();
        let input_path = temp_dir.path().join("input.wav");
        
        // Create input file
        let spec = create_stereo_48khz_spec();
        let test_samples = create_test_audio_buffer(0.5, 48000, 440.0);
        
        // Create stereo samples
        let mut stereo_samples = Vec::new();
        for sample in test_samples {
            stereo_samples.push(sample);
            stereo_samples.push(sample * 0.9);
        }
        
        create_test_wav_file(&input_path, spec, &stereo_samples).unwrap();
        
        // Convert to multiple outputs
        for i in 0..3 {
            let output_path = temp_dir.path().join(format!("output_{}.wav", i));
            let result = AudioConverter::convert_to_wav(&input_path, &output_path);
            assert!(result.is_ok(), "Failed conversion {}", i);
            assert!(output_path.exists());
            
            // Each output should be identical
            let reader = hound::WavReader::open(&output_path).unwrap();
            let spec = reader.spec();
            assert_eq!(spec.channels, 1);
            assert_eq!(spec.sample_rate, 16000);
        }
    }

    #[test]
    fn test_thread_safety() {
        use std::sync::Arc;
        use std::thread;

        let temp_dir = Arc::new(setup_temp_dir());
        let mut handles = vec![];

        // Create multiple input files
        for i in 0..5 {
            let input_path = temp_dir.path().join(format!("input_{}.wav", i));
            let spec = create_mono_16khz_spec();
            let test_samples = create_test_audio_buffer(0.2, 16000, 440.0 + (i as f32 * 100.0));
            create_test_wav_file(&input_path, spec, &test_samples).unwrap();
        }

        // Convert them concurrently
        for i in 0..5 {
            let temp_dir_clone = temp_dir.clone();
            let handle = thread::spawn(move || {
                let input_path = temp_dir_clone.path().join(format!("input_{}.wav", i));
                let output_bytes = AudioConverter::convert_to_wav_bytes(&input_path);
                assert!(output_bytes.is_ok(), "Thread {} failed", i);
                
                let bytes = output_bytes.unwrap();
                assert!(bytes.len() > 0);
                i
            });
            handles.push(handle);
        }

        // Wait for all threads
        for handle in handles {
            let thread_id = handle.join().expect("Thread should complete");
            assert!(thread_id < 5);
        }
    }
}