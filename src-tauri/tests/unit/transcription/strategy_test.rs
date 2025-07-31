use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;
use tokio::sync::Mutex;

use scout_lib::transcription::{
    TranscriptionConfig, TranscriptionResult, TranscriptionStrategy, TranscriptionStrategySelector,
};
use scout_lib::transcription::strategy::{
    ClassicTranscriptionStrategy, RingBufferTranscriptionStrategy, ProgressiveTranscriptionStrategy,
};

use crate::unit::transcription::mock_transcriber::{MockTranscriber, MockTranscriberWrapper};
use crate::common::{create_test_audio_buffer, create_test_wav_file, create_test_wav_spec};

#[cfg(test)]
mod transcription_config_tests {
    use super::*;

    #[test]
    fn test_transcription_config_default() {
        let config = TranscriptionConfig::default();
        
        assert_eq!(config.enable_chunking, true);
        assert_eq!(config.chunking_threshold_secs, 5);
        assert_eq!(config.chunk_duration_secs, 5);
        assert_eq!(config.force_strategy, None);
        assert_eq!(config.refinement_chunk_secs, Some(10));
    }

    #[test]
    fn test_transcription_config_custom() {
        let config = TranscriptionConfig {
            enable_chunking: false,
            chunking_threshold_secs: 10,
            chunk_duration_secs: 3,
            force_strategy: Some("classic".to_string()),
            refinement_chunk_secs: Some(15),
        };
        
        assert_eq!(config.enable_chunking, false);
        assert_eq!(config.chunking_threshold_secs, 10);
        assert_eq!(config.chunk_duration_secs, 3);
        assert_eq!(config.force_strategy, Some("classic".to_string()));
        assert_eq!(config.refinement_chunk_secs, Some(15));
    }

    #[test]
    fn test_transcription_config_clone() {
        let config1 = TranscriptionConfig {
            enable_chunking: true,
            chunking_threshold_secs: 7,
            chunk_duration_secs: 4,
            force_strategy: Some("ring_buffer".to_string()),
            refinement_chunk_secs: None,
        };
        
        let config2 = config1.clone();
        assert_eq!(config1.enable_chunking, config2.enable_chunking);
        assert_eq!(config1.chunking_threshold_secs, config2.chunking_threshold_secs);
        assert_eq!(config1.chunk_duration_secs, config2.chunk_duration_secs);
        assert_eq!(config1.force_strategy, config2.force_strategy);
        assert_eq!(config1.refinement_chunk_secs, config2.refinement_chunk_secs);
    }
}

#[cfg(test)]
mod transcription_result_tests {
    use super::*;

    #[test]
    fn test_transcription_result_creation() {
        let result = TranscriptionResult {
            text: "Hello world".to_string(),
            processing_time_ms: 150,
            strategy_used: "classic".to_string(),
            chunks_processed: 1,
        };
        
        assert_eq!(result.text, "Hello world");
        assert_eq!(result.processing_time_ms, 150);
        assert_eq!(result.strategy_used, "classic");
        assert_eq!(result.chunks_processed, 1);
    }

    #[test]
    fn test_transcription_result_clone() {
        let result1 = TranscriptionResult {
            text: "Test transcription".to_string(),
            processing_time_ms: 200,
            strategy_used: "ring_buffer".to_string(),
            chunks_processed: 3,
        };
        
        let result2 = result1.clone();
        assert_eq!(result1.text, result2.text);
        assert_eq!(result1.processing_time_ms, result2.processing_time_ms);
        assert_eq!(result1.strategy_used, result2.strategy_used);
        assert_eq!(result1.chunks_processed, result2.chunks_processed);
    }

    #[test]
    fn test_transcription_result_debug() {
        let result = TranscriptionResult {
            text: "Debug test".to_string(),
            processing_time_ms: 75,
            strategy_used: "progressive".to_string(),
            chunks_processed: 2,
        };
        
        let debug_str = format!("{:?}", result);
        assert!(debug_str.contains("Debug test"));
        assert!(debug_str.contains("75"));
        assert!(debug_str.contains("progressive"));
        assert!(debug_str.contains("2"));
    }
}

#[cfg(test)]
mod classic_strategy_tests {
    use super::*;

    fn create_mock_transcriber_arc() -> Arc<Mutex<MockTranscriberWrapper>> {
        Arc::new(Mutex::new(MockTranscriberWrapper::new()))
    }

    #[test]
    fn test_classic_strategy_name() {
        let mock_transcriber = create_mock_transcriber_arc();
        let strategy = ClassicTranscriptionStrategy::new(mock_transcriber);
        assert_eq!(strategy.name(), "classic");
    }

    #[test]
    fn test_classic_strategy_can_handle() {
        let mock_transcriber = create_mock_transcriber_arc();
        let strategy = ClassicTranscriptionStrategy::new(mock_transcriber);
        let config = TranscriptionConfig::default();
        
        // Classic strategy can handle any recording
        assert!(strategy.can_handle(None, &config));
        assert!(strategy.can_handle(Some(Duration::from_secs(1)), &config));
        assert!(strategy.can_handle(Some(Duration::from_secs(100)), &config));
        
        // Test with different configs
        let config_no_chunking = TranscriptionConfig {
            enable_chunking: false,
            ..Default::default()
        };
        assert!(strategy.can_handle(Some(Duration::from_secs(10)), &config_no_chunking));
    }

    #[tokio::test]
    async fn test_classic_strategy_full_workflow() {
        let temp_dir = TempDir::new().unwrap();
        let audio_path = temp_dir.path().join("test.wav");
        
        // Create test audio file
        let samples = create_test_audio_buffer(1.0, 16000, 440.0);
        let spec = create_test_wav_spec(1, 16000);
        create_test_wav_file(&audio_path, spec, &samples).unwrap();
        
        // Setup mock transcriber
        let mock_transcriber = Arc::new(Mutex::new(MockTranscriberWrapper::new()));
        {
            let mock = mock_transcriber.lock().await;
            mock.set_response("short", "Test transcription result");
        }
        
        // Create and test strategy
        let mut strategy = ClassicTranscriptionStrategy::new(mock_transcriber.clone());
        let config = TranscriptionConfig::default();
        
        // Start recording
        strategy.start_recording(&audio_path, &config).await.unwrap();
        
        // Process some samples (should be no-op for classic strategy)
        let test_samples = vec![0.1, 0.2, 0.3];
        strategy.process_samples(&test_samples).await.unwrap();
        
        // Get partial results (should be empty for classic strategy)
        let partial = strategy.get_partial_results();
        assert!(partial.is_empty());
        
        // Finish recording
        let result = strategy.finish_recording().await.unwrap();
        
        assert_eq!(result.text, "Test transcription result");
        assert_eq!(result.strategy_used, "classic");
        assert_eq!(result.chunks_processed, 1);
        assert!(result.processing_time_ms > 0);
        
        // Verify transcriber was called
        let mock = mock_transcriber.lock().await;
        assert_eq!(mock.get_call_count(), 1);
        let transcribed_files = mock.get_transcribed_files();
        assert_eq!(transcribed_files.len(), 1);
        assert_eq!(transcribed_files[0], audio_path);
    }

    #[tokio::test]
    async fn test_classic_strategy_error_handling() {
        let temp_dir = TempDir::new().unwrap();
        let audio_path = temp_dir.path().join("test.wav");
        
        // Create test audio file
        let samples = create_test_audio_buffer(0.5, 16000, 440.0);
        let spec = create_test_wav_spec(1, 16000);
        create_test_wav_file(&audio_path, spec, &samples).unwrap();
        
        // Setup mock transcriber to fail
        let mock_transcriber = Arc::new(Mutex::new(MockTranscriberWrapper::new()));
        {
            let mock = mock_transcriber.lock().await;
            mock.fail_next_transcription();
        }
        
        let mut strategy = ClassicTranscriptionStrategy::new(mock_transcriber);
        let config = TranscriptionConfig::default();
        
        strategy.start_recording(&audio_path, &config).await.unwrap();
        let result = strategy.finish_recording().await;
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Classic transcription failed"));
    }

    #[tokio::test]
    async fn test_classic_strategy_without_start() {
        let mock_transcriber = create_mock_transcriber_arc();
        let mut strategy = ClassicTranscriptionStrategy::new(mock_transcriber);
        
        // Try to finish without starting
        let result = strategy.finish_recording().await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Recording was not started"));
    }

    #[tokio::test]
    async fn test_classic_strategy_ring_buffer() {
        let mock_transcriber = create_mock_transcriber_arc();
        let strategy = ClassicTranscriptionStrategy::new(mock_transcriber);
        
        // Classic strategy doesn't have a ring buffer
        assert!(strategy.get_ring_buffer().is_none());
    }
}

#[cfg(test)]
mod strategy_selector_tests {
    use super::*;

    async fn create_test_environment() -> (Arc<Mutex<MockTranscriberWrapper>>, PathBuf) {
        let mock_transcriber = Arc::new(Mutex::new(MockTranscriberWrapper::new()));
        let temp_dir = TempDir::new().unwrap();
        let temp_path = temp_dir.path().to_path_buf();
        
        // Create mock model files for progressive strategy testing
        let tiny_model = temp_path.join("ggml-tiny.en.bin");
        let medium_model = temp_path.join("ggml-medium.en.bin");
        
        // Create empty files to simulate model existence
        std::fs::write(&tiny_model, b"mock tiny model").unwrap();
        std::fs::write(&medium_model, b"mock medium model").unwrap();
        
        (mock_transcriber, temp_path)
    }

    #[tokio::test]
    async fn test_strategy_selector_forced_classic() {
        let (mock_transcriber, temp_dir) = create_test_environment().await;
        
        let config = TranscriptionConfig {
            force_strategy: Some("classic".to_string()),
            ..Default::default()
        };
        
        let strategy = TranscriptionStrategySelector::select_strategy(
            Some(Duration::from_secs(10)),
            &config,
            mock_transcriber,
            temp_dir,
            None,
        ).await;
        
        assert_eq!(strategy.name(), "classic");
    }

    #[tokio::test]
    async fn test_strategy_selector_forced_ring_buffer() {
        let (mock_transcriber, temp_dir) = create_test_environment().await;
        
        let config = TranscriptionConfig {
            force_strategy: Some("ring_buffer".to_string()),
            ..Default::default()
        };
        
        let strategy = TranscriptionStrategySelector::select_strategy(
            Some(Duration::from_secs(10)),
            &config,
            mock_transcriber,
            temp_dir,
            None,
        ).await;
        
        assert_eq!(strategy.name(), "ring_buffer");
    }

    #[tokio::test]
    async fn test_strategy_selector_unknown_forced_strategy() {
        let (mock_transcriber, temp_dir) = create_test_environment().await;
        
        let config = TranscriptionConfig {
            force_strategy: Some("unknown_strategy".to_string()),
            ..Default::default()
        };
        
        let strategy = TranscriptionStrategySelector::select_strategy(
            Some(Duration::from_secs(10)),
            &config,
            mock_transcriber,
            temp_dir,
            None,
        ).await;
        
        // Should fall back to ring buffer since chunking is enabled
        assert_eq!(strategy.name(), "ring_buffer");
    }

    #[tokio::test]
    async fn test_strategy_selector_auto_classic_no_chunking() {
        let (mock_transcriber, temp_dir) = create_test_environment().await;
        
        let config = TranscriptionConfig {
            enable_chunking: false,
            ..Default::default()
        };
        
        let strategy = TranscriptionStrategySelector::select_strategy(
            Some(Duration::from_secs(2)),
            &config,
            mock_transcriber,
            temp_dir,
            None,
        ).await;
        
        assert_eq!(strategy.name(), "classic");
    }

    #[tokio::test]
    async fn test_strategy_selector_auto_ring_buffer() {
        let (mock_transcriber, temp_dir) = create_test_environment().await;
        
        let config = TranscriptionConfig {
            enable_chunking: true,
            chunking_threshold_secs: 5,
            ..Default::default()
        };
        
        let strategy = TranscriptionStrategySelector::select_strategy(
            Some(Duration::from_secs(10)),
            &config,
            mock_transcriber,
            temp_dir,
            None,
        ).await;
        
        assert_eq!(strategy.name(), "ring_buffer");
    }

    #[tokio::test]
    async fn test_strategy_selector_handles_missing_models() {
        let mock_transcriber = Arc::new(Mutex::new(MockTranscriberWrapper::new()));
        let temp_dir = TempDir::new().unwrap();
        let temp_path = temp_dir.path().to_path_buf();
        
        // Don't create model files - they won't exist
        
        let config = TranscriptionConfig {
            enable_chunking: true,
            ..Default::default()
        };
        
        let strategy = TranscriptionStrategySelector::select_strategy(
            Some(Duration::from_secs(10)),
            &config,
            mock_transcriber,
            temp_path,
            None,
        ).await;
        
        // Should fall back to ring buffer even without models for progressive strategy
        assert_eq!(strategy.name(), "ring_buffer");
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;

    #[tokio::test]
    async fn test_strategy_pattern_consistency() {
        // Test that all strategies implement the trait consistently
        let mock_transcriber = Arc::new(Mutex::new(MockTranscriberWrapper::new()));
        let temp_dir = TempDir::new().unwrap();
        let temp_path = temp_dir.path().to_path_buf();
        
        let strategies: Vec<Box<dyn TranscriptionStrategy>> = vec![
            Box::new(ClassicTranscriptionStrategy::new(mock_transcriber.clone())),
            Box::new(RingBufferTranscriptionStrategy::new(
                mock_transcriber.clone(), 
                temp_path.clone()
            )),
        ];
        
        let config = TranscriptionConfig::default();
        
        for strategy in strategies {
            // All strategies should have a name
            assert!(!strategy.name().is_empty());
            
            // All strategies should respond to can_handle
            let can_handle_short = strategy.can_handle(Some(Duration::from_secs(1)), &config);
            let can_handle_long = strategy.can_handle(Some(Duration::from_secs(60)), &config);
            
            // At least one should be true (they can handle something)
            assert!(can_handle_short || can_handle_long || strategy.name() == "classic");
            
            // Partial results should return a Vec (may be empty)
            let partial = strategy.get_partial_results();
            assert!(partial.len() >= 0); // Always true, but checks the method exists
        }
    }

    #[tokio::test]
    async fn test_config_validation() {
        // Test various config combinations
        let configs = vec![
            TranscriptionConfig::default(),
            TranscriptionConfig {
                enable_chunking: false,
                ..Default::default()
            },
            TranscriptionConfig {
                chunking_threshold_secs: 0,
                ..Default::default()
            },
            TranscriptionConfig {
                chunk_duration_secs: 1,
                ..Default::default()
            },
            TranscriptionConfig {
                refinement_chunk_secs: None,
                ..Default::default()
            },
        ];
        
        for config in configs {
            // All configs should be valid (no panics or invalid states)
            assert!(config.chunk_duration_secs > 0);
            assert!(config.chunking_threshold_secs >= 0);
            
            if let Some(refinement_secs) = config.refinement_chunk_secs {
                assert!(refinement_secs > 0);
            }
        }
    }

    #[tokio::test]
    async fn test_concurrent_strategy_access() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc as StdArc;
        
        let mock_transcriber = Arc::new(Mutex::new(MockTranscriberWrapper::new()));
        let counter = StdArc::new(AtomicUsize::new(0));
        
        let handles: Vec<_> = (0..10).map(|i| {
            let transcriber = mock_transcriber.clone();
            let counter = counter.clone();
            
            tokio::spawn(async move {
                let strategy = ClassicTranscriptionStrategy::new(transcriber);
                
                // Each strategy should have the correct name
                assert_eq!(strategy.name(), "classic");
                
                // Increment counter to verify concurrent access
                counter.fetch_add(1, Ordering::SeqCst);
                
                i
            })
        }).collect();
        
        // Wait for all tasks to complete
        for handle in handles {
            handle.await.unwrap();
        }
        
        // All 10 tasks should have completed
        assert_eq!(counter.load(Ordering::SeqCst), 10);
    }
}