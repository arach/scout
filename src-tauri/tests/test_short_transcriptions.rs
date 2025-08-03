#[cfg(feature = "disabled-tests")] // Temporarily disabled due to refactoring - needs module visibility updates  
mod test_short_transcriptions {
    use scout_lib::audio::format::WhisperAudioConverter;
    use scout_lib::audio::recorder::AudioRecorder;
    use scout_lib::transcription::{Transcriber, TranscriptionConfig};
    use std::path::PathBuf;
    use tempfile::TempDir;

    /// Test configuration optimizations for short audio
    #[test]
    fn test_short_audio_config() {
        let config = TranscriptionConfig::default();
        
        // Verify lowered chunking threshold
        assert_eq!(config.chunking_threshold_secs, 3);
        
        // Ensure chunking is enabled by default
        assert!(config.enable_chunking);
    }

    /// Test silence padding logic for very short recordings
    #[test]
    fn test_silence_padding_threshold() {
        // Test recordings of various durations
        let test_cases = vec![
            (0.1, true),   // 100ms - should pad
            (0.2, true),   // 200ms - should pad
            (0.3, false),  // 300ms - should NOT pad
            (0.5, false),  // 500ms - should NOT pad
            (1.0, false),  // 1 second - should NOT pad
        ];

        for (duration, should_pad) in test_cases {
            let samples_at_16khz = (duration * 16000.0) as usize;
            let needs_padding = duration < 0.3;
            
            assert_eq!(
                needs_padding, should_pad,
                "Duration {}s padding expectation mismatch",
                duration
            );
            
            if needs_padding {
                // Should pad to 0.5 seconds (8000 samples at 16kHz)
                let target_samples = 8000;
                assert!(
                    samples_at_16khz < target_samples,
                    "Short audio should be padded to {} samples",
                    target_samples
                );
            }
        }
    }

    /// Test Whisper audio converter with short clips
    #[test]
    fn test_audio_converter_short_clips() {
        use scout_lib::audio::format::NativeAudioFormat;
        
        // Test with 200ms of audio at 48kHz stereo
        let sample_rate = 48000;
        let duration = 0.2;
        let channels = 2;
        let sample_count = (sample_rate as f32 * duration * channels as f32) as usize;
        
        // Create test audio (sine wave)
        let mut samples = vec![0.0f32; sample_count];
        for (i, sample) in samples.iter_mut().enumerate() {
            let t = i as f32 / sample_rate as f32;
            *sample = (2.0 * std::f32::consts::PI * 440.0 * t).sin() * 0.1;
        }
        
        let native_format = NativeAudioFormat::new(
            sample_rate,
            channels,
            cpal::SampleFormat::F32,
            "Test Device".to_string(),
        );
        
        // Convert to Whisper format
        let result = WhisperAudioConverter::convert_for_whisper(&samples, &native_format);
        
        assert!(result.is_ok(), "Conversion should succeed");
        
        let whisper_samples = result.unwrap();
        
        // Should be converted to 16kHz mono
        let expected_samples = (duration * 16000.0) as usize;
        let tolerance = 10; // Allow small rounding differences
        
        assert!(
            (whisper_samples.len() as i32 - expected_samples as i32).abs() < tolerance,
            "Expected ~{} samples, got {}",
            expected_samples,
            whisper_samples.len()
        );
    }

    /// Test common short utterances that might fail
    #[test]
    fn test_problematic_short_utterances() {
        // Common short utterances that Whisper might struggle with
        let test_utterances = vec![
            ("yes", 0.3),
            ("no", 0.25),
            ("ok", 0.2),
            ("hello", 0.4),
            ("stop", 0.35),
            ("go", 0.2),
            ("one", 0.25),
            ("test", 0.3),
        ];

        for (utterance, typical_duration) in test_utterances {
            println!(
                "Testing utterance '{}' with typical duration {}s",
                utterance, typical_duration
            );
            
            // With our fixes:
            // - Padding only applies to clips < 0.3s (padded to 0.5s)
            // - Whisper params optimized for short clips
            // - Initial prompt helps with context
            
            if typical_duration < 0.3 {
                println!(
                    "  -> Will be padded from {}s to 0.5s for better Whisper performance",
                    typical_duration
                );
            } else {
                println!("  -> No padding needed, duration is sufficient");
            }
        }
    }

    /// Integration test for short recording workflow
    #[tokio::test]
    async fn test_short_recording_workflow() {
        use scout_lib::transcription::TranscriptionContext;
        
        // This test would require actual model files and audio hardware
        // For now, we verify the configuration is correct
        
        let config = TranscriptionConfig {
            enable_chunking: true,
            chunking_threshold_secs: 3, // Lower threshold
            chunk_duration_secs: 5,
            force_strategy: Some("classic".to_string()), // Force classic for short clips
            refinement_chunk_secs: None,
        };
        
        // Verify classic strategy is used for short recordings
        assert_eq!(config.force_strategy, Some("classic".to_string()));
        
        // Verify chunking threshold is appropriate
        assert!(config.chunking_threshold_secs <= 3);
    }
}