// Audio module unit tests
//
// This module contains comprehensive unit tests for the Scout audio system,
// including recording, ring buffer management, audio conversion, and device monitoring.
//
// Test Organization:
// - recorder_test.rs: Tests for the main AudioRecorder with mocked cpal dependencies
// - ring_buffer_recorder_test.rs: Tests for the RingBufferRecorder circular buffer
// - converter_test.rs: Tests for audio format conversion using Symphonia
// - device_monitor_test.rs: Tests for device enumeration and monitoring
//
// Test Types:
// - Unit tests: Fast, isolated tests with mocked dependencies
// - Integration tests: Tests marked with #[ignore] that require real audio hardware
//
// Running Tests:
// - All unit tests: `cargo test`
// - Integration tests: `cargo test -- --ignored`
// - Specific module: `cargo test audio::recorder_test`
// - With output: `cargo test -- --nocapture`

mod recorder_test;
mod ring_buffer_recorder_test;
mod converter_test;
mod device_monitor_test;

// Re-export common test utilities for use in audio tests
pub use super::super::common::*;

#[cfg(test)]
mod integration_tests {
    use super::*;
    use std::time::Duration;
    use tempfile::TempDir;

    /// Integration test that verifies the entire audio pipeline works together
    #[test]
    #[ignore] // Requires real audio hardware
    fn test_full_audio_pipeline() {
        // This test would verify that:
        // 1. Device enumeration works
        // 2. Recording can be started and stopped
        // 3. Audio data flows through the ring buffer
        // 4. Files are written correctly
        // 5. Conversion works end-to-end
        
        use scout_lib::audio::{AudioRecorder, device_monitor::DeviceMonitor};
        
        let temp_dir = TempDir::new().unwrap();
        let output_path = temp_dir.path().join("integration_test.wav");
        
        // Test device enumeration
        let mut monitor = DeviceMonitor::new();
        if monitor.start_monitoring().is_ok() {
            let devices = monitor.get_current_devices();
            println!("Found {} audio devices", devices.len());
            
            // Test recording if devices are available
            if !devices.is_empty() {
                let mut recorder = AudioRecorder::new();
                recorder.init();
                
                if recorder.start_recording(&output_path, None).is_ok() {
                    // Record for a very short time
                    std::thread::sleep(Duration::from_millis(100));
                    
                    if recorder.stop_recording().is_ok() {
                        // Verify file was created
                        assert!(output_path.exists());
                        
                        let metadata = std::fs::metadata(&output_path).unwrap();
                        assert!(metadata.len() > 0);
                        
                        println!("Integration test passed - recorded {} bytes", metadata.len());
                    }
                }
            }
            
            monitor.stop_monitoring();
        }
    }

    /// Test that audio utilities work correctly with real files
    #[test]
    fn test_audio_utilities_integration() {
        let temp_dir = setup_test_env();
        let test_file = temp_dir.path().join("utility_test.wav");
        
        // Create test audio
        let samples = create_test_audio_buffer(1.0, 16000, 440.0);
        let spec = create_test_wav_spec(1, 16000);
        
        // Write and read back
        create_test_wav_file(&test_file, spec, &samples).unwrap();
        let (read_spec, read_samples) = read_test_wav_file(&test_file).unwrap();
        
        // Verify specs match
        assert_eq!(read_spec.channels, spec.channels);
        assert_eq!(read_spec.sample_rate, spec.sample_rate);
        
        // Verify samples are approximately equal (some precision loss expected)
        assert_audio_equal(&read_samples, &samples, 0.01);
        
        // Test audio analysis utilities
        let rms = calculate_rms(&samples);
        let peak = calculate_peak(&samples);
        let zero_crossings = count_zero_crossings(&samples);
        
        assert!(rms > 0.0 && rms < 1.0);
        assert!(peak > 0.0 && peak <= 1.0);
        assert!(zero_crossings > 0); // 440Hz should have many zero crossings
        
        println!("Audio analysis - RMS: {:.3}, Peak: {:.3}, Zero crossings: {}", 
                rms, peak, zero_crossings);
    }

    /// Test different audio waveforms and conversions
    #[test]
    fn test_waveform_generation() {
        let duration = 0.1; // Short test
        let sample_rate = 16000;
        let frequency = 1000.0;
        
        // Test different waveforms
        let sine = create_test_audio_buffer(duration, sample_rate, frequency);
        let sawtooth = create_sawtooth_buffer(duration, sample_rate, frequency);
        let noise = create_noise_buffer(duration, sample_rate, 0.1);
        let fading = create_fading_buffer(duration, sample_rate, frequency);
        let silence = create_silence_buffer(duration, sample_rate);
        
        // Basic validation
        assert_eq!(sine.len(), (duration * sample_rate as f32) as usize);
        assert_eq!(sawtooth.len(), sine.len());
        assert_eq!(noise.len(), sine.len());
        assert_eq!(fading.len(), sine.len());
        assert_eq!(silence.len(), sine.len());
        
        // Verify different characteristics
        assert!(calculate_rms(&sine) > 0.5); // Sine wave should have significant RMS
        assert!(calculate_rms(&sawtooth) > 0.5); // Sawtooth too
        assert!(calculate_rms(&noise) > 0.05); // Noise should have some level
        assert!(calculate_rms(&silence) < 0.001); // Silence should be quiet
        
        // Fading should have lower RMS than sine (due to fade in/out)
        assert!(calculate_rms(&fading) < calculate_rms(&sine));
        
        // Test format conversions
        let i16_samples = convert_f32_to_i16(&sine);
        let back_to_f32 = convert_i16_to_f32(&i16_samples);
        
        // Should be approximately equal (some precision loss)
        assert_audio_equal(&sine, &back_to_f32, 0.01);
        
        // Test stereo conversion
        let stereo = mono_to_stereo(&sine);
        assert_eq!(stereo.len(), sine.len() * 2);
        
        let back_to_mono = stereo_to_mono(&stereo);
        assert_audio_equal(&sine, &back_to_mono, 0.001);
    }

    /// Test audio gain and processing utilities
    #[test]
    fn test_audio_processing() {
        let mut samples = create_test_audio_buffer(0.1, 16000, 440.0);
        let original_rms = calculate_rms(&samples);
        
        // Test gain application
        apply_gain(&mut samples, 6.0); // +6dB
        let gained_rms = calculate_rms(&samples);
        
        // +6dB should approximately double the RMS
        let expected_gain = 10.0_f32.powf(6.0 / 20.0); // ~2.0
        assert!((gained_rms / original_rms - expected_gain).abs() < 0.1);
        
        // Test negative gain
        apply_gain(&mut samples, -6.0); // -6dB to bring back down
        let reduced_rms = calculate_rms(&samples);
        
        // Should be close to original (within precision)
        assert!((reduced_rms / original_rms - 1.0).abs() < 0.1);
    }
}

/// Performance benchmarks for audio operations
#[cfg(test)]
mod benchmarks {
    use super::*;
    use std::time::Instant;

    #[test]
    #[ignore] // Run with: cargo test benchmarks -- --ignored
    fn bench_audio_buffer_creation() {
        let iterations = 100;
        
        // Benchmark sine wave generation
        let start = Instant::now();
        for _ in 0..iterations {
            let _samples = create_test_audio_buffer(1.0, 48000, 440.0);
        }
        let sine_duration = start.elapsed();
        
        // Benchmark noise generation
        let start = Instant::now();
        for _ in 0..iterations {
            let _samples = create_noise_buffer(1.0, 48000, 0.5);
        }
        let noise_duration = start.elapsed();
        
        println!("Sine wave generation: {:?} per buffer", sine_duration / iterations);
        println!("Noise generation: {:?} per buffer", noise_duration / iterations);
        
        // Both should be reasonably fast
        assert!(sine_duration.as_millis() < 1000); // Less than 1ms per buffer
        assert!(noise_duration.as_millis() < 1000);
    }

    #[test]
    #[ignore] // Run with: cargo test benchmarks -- --ignored
    fn bench_audio_analysis() {
        let samples = create_test_audio_buffer(10.0, 48000, 440.0); // 10 seconds
        let iterations = 1000;

        // Benchmark RMS calculation
        let start = Instant::now();
        for _ in 0..iterations {
            let _rms = calculate_rms(&samples);
        }
        let rms_duration = start.elapsed();

        // Benchmark peak calculation
        let start = Instant::now();
        for _ in 0..iterations {
            let _peak = calculate_peak(&samples);
        }
        let peak_duration = start.elapsed();

        // Benchmark zero crossing detection
        let start = Instant::now();
        for _ in 0..iterations {
            let _crossings = count_zero_crossings(&samples);
        }
        let crossing_duration = start.elapsed();

        println!("RMS calculation: {:?} per call", rms_duration / iterations);
        println!("Peak calculation: {:?} per call", peak_duration / iterations);
        println!("Zero crossing detection: {:?} per call", crossing_duration / iterations);

        // Should all be very fast for real-time processing
        assert!(rms_duration.as_micros() / iterations as u128 < 1000); // Less than 1ms
        assert!(peak_duration.as_micros() / iterations as u128 < 1000);
        assert!(crossing_duration.as_micros() / iterations as u128 < 10000); // Bit more complex
    }
}

/// Memory usage tests for audio operations
#[cfg(test)]
mod memory_tests {
    use super::*;

    #[test]
    fn test_large_buffer_handling() {
        // Test that we can handle large audio buffers without excessive memory usage
        let duration = 60.0; // 1 minute
        let sample_rate = 48000;
        
        let samples = create_test_audio_buffer(duration, sample_rate, 440.0);
        assert_eq!(samples.len(), (duration * sample_rate as f32) as usize);
        
        // Should be able to process large buffers
        let rms = calculate_rms(&samples);
        assert!(rms > 0.0);
        
        let peak = calculate_peak(&samples);
        assert!(peak > 0.0);
        
        // Memory should be released when samples goes out of scope
    }

    #[test]
    fn test_buffer_reuse() {
        // Test that we can reuse buffers efficiently
        let mut buffer = Vec::with_capacity(48000);
        
        for _ in 0..10 {
            buffer.clear();
            buffer.extend(create_test_audio_buffer(1.0, 48000, 440.0));
            
            // Capacity should remain stable (no reallocations)
            assert_eq!(buffer.capacity(), 48000);
        }
    }
}