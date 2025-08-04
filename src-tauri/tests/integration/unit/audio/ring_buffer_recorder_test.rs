use super::super::super::common::{create_test_audio_buffer, create_silence_buffer, assert_audio_equal};
use scout_lib::audio::ring_buffer_recorder::{RingBufferRecorder, save_samples_to_wav};
use hound::{WavSpec, SampleFormat};
use std::time::Duration;
use tempfile::TempDir;

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_temp_dir() -> TempDir {
        TempDir::new().expect("Failed to create temp directory")
    }

    fn create_test_spec() -> WavSpec {
        WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 32,
            sample_format: SampleFormat::Float,
        }
    }

    fn create_stereo_spec() -> WavSpec {
        WavSpec {
            channels: 2,
            sample_rate: 48000,
            bits_per_sample: 32,
            sample_format: SampleFormat::Float,
        }
    }

    #[test]
    fn test_ring_buffer_recorder_new() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        let spec = create_test_spec();

        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();
        
        assert_eq!(recorder.sample_count(), 0);
        assert_eq!(recorder.get_duration().as_secs(), 0);
        assert!(!recorder.is_finalized());
        
        let retrieved_spec = recorder.get_spec();
        assert_eq!(retrieved_spec.channels, 1);
        assert_eq!(retrieved_spec.sample_rate, 16000);
        assert_eq!(retrieved_spec.bits_per_sample, 32);
    }

    #[test]
    fn test_ring_buffer_recorder_new_invalid_path() {
        let spec = create_test_spec();
        let invalid_path = std::path::Path::new("/invalid/path/that/does/not/exist/test.wav");
        
        let result = RingBufferRecorder::new(spec, &invalid_path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to create WAV writer"));
    }

    #[test]
    fn test_add_samples_basic() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        let spec = create_test_spec();

        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();
        
        // Add 1 second of test audio
        let test_samples = create_test_audio_buffer(1.0, 16000, 440.0);
        let result = recorder.add_samples(&test_samples);
        
        assert!(result.is_ok());
        assert_eq!(recorder.sample_count(), 16000);
        assert_eq!(recorder.get_duration().as_secs(), 1);
    }

    #[test]
    fn test_add_samples_empty() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        let spec = create_test_spec();

        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();
        
        let empty_samples: Vec<f32> = vec![];
        let result = recorder.add_samples(&empty_samples);
        
        assert!(result.is_ok());
        assert_eq!(recorder.sample_count(), 0);
    }

    #[test]
    fn test_add_samples_multiple_calls() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        let spec = create_test_spec();

        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();
        
        // Add samples in multiple chunks
        for i in 0..5 {
            let chunk_samples = create_test_audio_buffer(0.2, 16000, 440.0 + (i as f32 * 100.0));
            let result = recorder.add_samples(&chunk_samples);
            assert!(result.is_ok());
        }
        
        // Should have 1 second of audio (5 × 0.2s)
        assert_eq!(recorder.sample_count(), 16000);
        assert_eq!(recorder.get_duration().as_secs(), 1);
    }

    #[test]
    fn test_ring_buffer_overflow() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        let spec = create_test_spec();

        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();
        
        // Add more than 5 minutes of audio to test buffer limits
        // Each call adds 1 second, we'll add 6 minutes worth
        for i in 0..360 {
            let chunk_samples = create_test_audio_buffer(1.0, 16000, 440.0);
            let result = recorder.add_samples(&chunk_samples);
            assert!(result.is_ok());
            
            // After 300 seconds (5 minutes), buffer should maintain max size
            if i >= 300 {
                assert_eq!(recorder.sample_count(), 16000 * 300); // 5 minutes max
            }
        }
        
        // Buffer should not exceed 5 minutes
        assert_eq!(recorder.sample_count(), 16000 * 300);
        assert_eq!(recorder.get_duration().as_secs(), 300);
    }

    #[test]
    fn test_extract_chunk_basic() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        let spec = create_test_spec();

        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();
        
        // Add 2 seconds of test audio
        let test_samples = create_test_audio_buffer(2.0, 16000, 440.0);
        recorder.add_samples(&test_samples).unwrap();
        
        // Extract first second
        let chunk = recorder.extract_chunk(
            Duration::ZERO, 
            Duration::from_secs(1)
        ).unwrap();
        
        assert_eq!(chunk.len(), 16000);
        
        // Extract second half
        let chunk2 = recorder.extract_chunk(
            Duration::from_secs(1),
            Duration::from_secs(1)
        ).unwrap();
        
        assert_eq!(chunk2.len(), 16000);
    }

    #[test]
    fn test_extract_chunk_beyond_bounds() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        let spec = create_test_spec();

        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();
        
        // Add 1 second of audio
        let test_samples = create_test_audio_buffer(1.0, 16000, 440.0);
        recorder.add_samples(&test_samples).unwrap();
        
        // Try to extract beyond available audio
        let result = recorder.extract_chunk(
            Duration::from_secs(2), // Start beyond available audio
            Duration::from_secs(1)
        );
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Start offset beyond available audio"));
    }

    #[test]
    fn test_extract_chunk_partial() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        let spec = create_test_spec();

        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();
        
        // Add 1.5 seconds of audio
        let test_samples = create_test_audio_buffer(1.5, 16000, 440.0);
        recorder.add_samples(&test_samples).unwrap();
        
        // Extract 2 seconds (should get only 1.5 available)
        let chunk = recorder.extract_chunk(
            Duration::ZERO,
            Duration::from_secs(2)
        ).unwrap();
        
        // Should get 1.5 seconds worth
        assert_eq!(chunk.len(), 24000);
    }

    #[test]
    fn test_extract_chunk_zero_duration() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        let spec = create_test_spec();

        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();
        
        let test_samples = create_test_audio_buffer(1.0, 16000, 440.0);
        recorder.add_samples(&test_samples).unwrap();
        
        // Extract zero duration
        let chunk = recorder.extract_chunk(
            Duration::ZERO,
            Duration::ZERO
        ).unwrap();
        
        assert_eq!(chunk.len(), 0);
    }

    #[test]
    fn test_extract_chunk_stereo() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        let spec = create_stereo_spec();

        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();
        
        // Create stereo samples (interleaved L/R)
        let mut stereo_samples = Vec::new();
        for i in 0..48000 { // 1 second at 48kHz
            stereo_samples.push((i as f32) / 48000.0); // Left channel
            stereo_samples.push((i as f32) / 48000.0 * 0.5); // Right channel (half amplitude)
        }
        
        recorder.add_samples(&stereo_samples).unwrap();
        
        // Extract 0.5 seconds
        let chunk = recorder.extract_chunk(
            Duration::ZERO,
            Duration::from_millis(500)
        ).unwrap();
        
        // Should have 0.5 seconds × 48000 Hz × 2 channels = 48000 samples
        assert_eq!(chunk.len(), 48000);
        
        // Verify channel alignment (samples should be aligned to 2-sample boundaries)
        assert_eq!(chunk.len() % 2, 0);
    }

    #[test]
    fn test_save_chunk_to_file() {
        let temp_dir = setup_temp_dir();
        let main_output_path = temp_dir.path().join("main.wav");
        let chunk_output_path = temp_dir.path().join("chunk.wav");
        let spec = create_test_spec();

        let recorder = RingBufferRecorder::new(spec, &main_output_path).unwrap();
        
        // Add test audio
        let test_samples = create_test_audio_buffer(2.0, 16000, 440.0);
        recorder.add_samples(&test_samples).unwrap();
        
        // Extract a chunk
        let chunk = recorder.extract_chunk(
            Duration::from_millis(500),
            Duration::from_secs(1)
        ).unwrap();
        
        // Save chunk to file
        let result = recorder.save_chunk_to_file(&chunk, &chunk_output_path);
        assert!(result.is_ok());
        
        // Verify file was created
        assert!(chunk_output_path.exists());
        
        // Verify file size is reasonable
        let metadata = std::fs::metadata(&chunk_output_path).unwrap();
        assert!(metadata.len() > 0);
    }

    #[test]
    fn test_save_chunk_empty_data() {
        let temp_dir = setup_temp_dir();
        let main_output_path = temp_dir.path().join("main.wav");
        let chunk_output_path = temp_dir.path().join("chunk.wav");
        let spec = create_test_spec();

        let recorder = RingBufferRecorder::new(spec, &main_output_path).unwrap();
        
        // Try to save empty chunk
        let empty_chunk: Vec<f32> = vec![];
        let result = recorder.save_chunk_to_file(&empty_chunk, &chunk_output_path);
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Cannot save empty chunk"));
    }

    #[test]
    fn test_save_chunk_misaligned_data() {
        let temp_dir = setup_temp_dir();
        let main_output_path = temp_dir.path().join("main.wav");
        let chunk_output_path = temp_dir.path().join("chunk.wav");
        let spec = create_stereo_spec(); // 2 channels

        let recorder = RingBufferRecorder::new(spec, &main_output_path).unwrap();
        
        // Create misaligned data (odd number of samples for stereo)
        let misaligned_chunk = vec![0.1, 0.2, 0.3]; // 3 samples for 2-channel format
        let result = recorder.save_chunk_to_file(&misaligned_chunk, &chunk_output_path);
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a multiple of channels"));
    }

    #[test]
    fn test_finalize_recording() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        let spec = create_test_spec();

        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();
        
        // Add some audio
        let test_samples = create_test_audio_buffer(1.0, 16000, 440.0);
        recorder.add_samples(&test_samples).unwrap();
        
        // Finalize recording
        let result = recorder.finalize_recording();
        assert!(result.is_ok());
        assert!(recorder.is_finalized());
        
        // Verify file was created and has content
        assert!(output_path.exists());
        let metadata = std::fs::metadata(&output_path).unwrap();
        assert!(metadata.len() > 0);
    }

    #[test]
    fn test_finalize_recording_multiple_calls() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        let spec = create_test_spec();

        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();
        
        let test_samples = create_test_audio_buffer(0.5, 16000, 440.0);
        recorder.add_samples(&test_samples).unwrap();
        
        // Multiple finalize calls should not cause issues
        assert!(recorder.finalize_recording().is_ok());
        assert!(recorder.finalize_recording().is_ok());
        assert!(recorder.finalize_recording().is_ok());
        
        assert!(recorder.is_finalized());
    }

    #[test]
    fn test_clear_buffer() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        let spec = create_test_spec();

        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();
        
        // Add some audio
        let test_samples = create_test_audio_buffer(2.0, 16000, 440.0);
        recorder.add_samples(&test_samples).unwrap();
        
        assert_eq!(recorder.sample_count(), 32000);
        
        // Clear buffer
        recorder.clear();
        
        assert_eq!(recorder.sample_count(), 0);
        assert_eq!(recorder.get_duration().as_secs(), 0);
    }

    #[test]
    fn test_get_samples_range() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        let spec = create_test_spec();

        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();
        
        // Add known test pattern
        let test_samples = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        recorder.add_samples(&test_samples).unwrap();
        
        // Get middle range
        let range_samples = recorder.get_samples_range(1..4).unwrap();
        assert_eq!(range_samples, vec![2.0, 3.0, 4.0]);
        
        // Get full range
        let full_samples = recorder.get_samples_range(0..5).unwrap();
        assert_eq!(full_samples, test_samples);
    }

    #[test]
    fn test_get_samples_range_out_of_bounds() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        let spec = create_test_spec();

        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();
        
        let test_samples = vec![1.0, 2.0, 3.0];
        recorder.add_samples(&test_samples).unwrap();
        
        // Test various out-of-bounds scenarios
        let result = recorder.get_samples_range(5..10);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("out of bounds"));
        
        let result = recorder.get_samples_range(0..10);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("out of bounds"));
    }

    #[test]
    fn test_get_total_samples() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        let spec = create_test_spec();

        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();
        
        assert_eq!(recorder.get_total_samples(), 0);
        
        let test_samples = create_test_audio_buffer(1.0, 16000, 440.0);
        recorder.add_samples(&test_samples).unwrap();
        
        assert_eq!(recorder.get_total_samples(), 16000);
        assert_eq!(recorder.get_total_samples(), recorder.sample_count());
    }

    #[test]
    fn test_recording_start_time() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        let spec = create_test_spec();

        let before_creation = std::time::Instant::now();
        let recorder = RingBufferRecorder::new(spec, &output_path).unwrap();
        let after_creation = std::time::Instant::now();
        
        let start_time = recorder.recording_start_time();
        
        // Start time should be between before and after creation
        assert!(start_time >= before_creation);
        assert!(start_time <= after_creation);
    }

    #[test]
    fn test_wav_spec_consistency() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        
        let original_spec = WavSpec {
            channels: 2,
            sample_rate: 44100,
            bits_per_sample: 16,
            sample_format: SampleFormat::Int,
        };

        let recorder = RingBufferRecorder::new(original_spec, &output_path).unwrap();
        let retrieved_spec = recorder.get_spec();
        
        assert_eq!(retrieved_spec.channels, original_spec.channels);
        assert_eq!(retrieved_spec.sample_rate, original_spec.sample_rate);
        assert_eq!(retrieved_spec.bits_per_sample, original_spec.bits_per_sample);
        assert_eq!(retrieved_spec.sample_format, original_spec.sample_format);
    }

    #[test]
    fn test_thread_safety() {
        use std::sync::Arc;
        use std::thread;

        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("test.wav");
        let spec = create_test_spec();

        let recorder = Arc::new(RingBufferRecorder::new(spec, &output_path).unwrap());
        let mut handles = vec![];

        // Test concurrent access
        for i in 0..5 {
            let recorder_clone = recorder.clone();
            let handle = thread::spawn(move || {
                // Add samples concurrently
                let samples = vec![i as f32; 1000];
                recorder_clone.add_samples(&samples).unwrap();
                
                // Query state concurrently
                let _count = recorder_clone.sample_count();
                let _duration = recorder_clone.get_duration();
                let _spec = recorder_clone.get_spec();
                
                i
            });
            handles.push(handle);
        }

        // Wait for all threads
        for handle in handles {
            let thread_id = handle.join().expect("Thread should complete");
            assert!(thread_id < 5);
        }

        // Should have samples from all threads
        assert_eq!(recorder.sample_count(), 5000);
    }
}

// Tests for the standalone save_samples_to_wav function
#[cfg(test)]
mod save_function_tests {
    use super::*;

    #[test]
    fn test_save_samples_to_wav_basic() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("save_test.wav");
        
        let samples = create_test_audio_buffer(1.0, 16000, 440.0);
        let spec = create_test_spec();
        
        let result = save_samples_to_wav(&samples, &output_path, spec);
        assert!(result.is_ok());
        
        // Verify file was created
        assert!(output_path.exists());
        let metadata = std::fs::metadata(&output_path).unwrap();
        assert!(metadata.len() > 0);
    }

    #[test]
    fn test_save_samples_to_wav_empty() {
        let temp_dir = setup_temp_dir();
        let output_path = temp_dir.path().join("empty_save_test.wav");
        
        let samples: Vec<f32> = vec![];
        let spec = create_test_spec();
        
        let result = save_samples_to_wav(&samples, &output_path, spec);
        assert!(result.is_ok()); // Empty file should still be valid
        
        assert!(output_path.exists());
    }

    #[test]
    fn test_save_samples_to_wav_invalid_path() {
        let samples = create_test_audio_buffer(0.1, 16000, 440.0);
        let spec = create_test_spec();
        let invalid_path = std::path::Path::new("/invalid/path/test.wav");
        
        let result = save_samples_to_wav(&samples, &invalid_path, spec);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to create WAV writer"));
    }

    #[test]
    fn test_save_samples_to_wav_different_specs() {
        let temp_dir = setup_temp_dir();
        let samples = vec![0.1, 0.2, -0.1, -0.2];
        
        // Test different sample rates
        for &sample_rate in &[8000, 16000, 44100, 48000] {
            let output_path = temp_dir.path().join(format!("test_{}.wav", sample_rate));
            let spec = WavSpec {
                channels: 1,
                sample_rate,
                bits_per_sample: 32,
                sample_format: SampleFormat::Float,
            };
            
            let result = save_samples_to_wav(&samples, &output_path, spec);
            assert!(result.is_ok(), "Failed for sample rate {}", sample_rate);
            assert!(output_path.exists());
        }
        
        // Test different channel counts
        for &channels in &[1, 2] {
            let output_path = temp_dir.path().join(format!("test_{}ch.wav", channels));
            let mut channel_samples = samples.clone();
            if channels == 2 && channel_samples.len() % 2 != 0 {
                channel_samples.push(0.0); // Make even for stereo
            }
            
            let spec = WavSpec {
                channels,
                sample_rate: 16000,
                bits_per_sample: 32,
                sample_format: SampleFormat::Float,
            };
            
            let result = save_samples_to_wav(&channel_samples, &output_path, spec);
            assert!(result.is_ok(), "Failed for {} channels", channels);
            assert!(output_path.exists());
        }
    }
}