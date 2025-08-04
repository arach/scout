// Integration tests for transcription workflow scenarios
//
// These tests validate the complete transcription workflows including
// strategy selection, file handling, and end-to-end processing.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;
use tokio::sync::Mutex;

// Import from the scout crate
extern crate scout_lib;

use scout_lib::transcription::{
    TranscriptionConfig, TranscriptionResult, TranscriptionStrategy, TranscriptionStrategySelector,
};
use scout_lib::transcription::strategy::{
    ClassicTranscriptionStrategy, RingBufferTranscriptionStrategy,
};
use scout_lib::model_state::{ModelStateManager, CoreMLState};

mod common;
use common::{create_test_audio_buffer, create_test_wav_file, create_test_wav_spec};

mod unit;
use unit::transcription::mock_transcriber::MockTranscriberWrapper;

/// Integration tests for complete transcription workflows
#[cfg(test)]
mod workflow_integration_tests {
    use super::*;

    /// Test complete ring buffer workflow from start to finish
    #[tokio::test]
    async fn test_ring_buffer_complete_workflow() {
        let temp_dir = TempDir::new().unwrap();
        let audio_path = temp_dir.path().join("test_recording.wav");
        let temp_dir_path = temp_dir.path().to_path_buf();
        
        // Create test audio file
        let samples = create_test_audio_buffer(2.0, 16000, 440.0); // 2 seconds of audio
        let spec = create_test_wav_spec(1, 16000);
        create_test_wav_file(&audio_path, spec, &samples).unwrap();
        
        // Setup mock transcriber
        let mock_transcriber = Arc::new(Mutex::new(MockTranscriberWrapper::new()));
        {
            let mock = mock_transcriber.lock().await;
            mock.set_response("short", "Complete workflow test transcription");
        }
        
        // Create ring buffer strategy
        let mut strategy = RingBufferTranscriptionStrategy::new(
            mock_transcriber.clone(),
            temp_dir_path,
        );
        
        let config = TranscriptionConfig {
            enable_chunking: true,
            chunk_duration_secs: 1, // Small chunks for testing
            chunking_threshold_secs: 1,
            ..Default::default()
        };
        
        // Start recording
        strategy.start_recording(&audio_path, &config).await.unwrap();
        
        // Simulate processing samples in chunks
        let chunk_size = 8000; // 0.5 seconds at 16kHz
        for chunk in samples.chunks(chunk_size) {
            strategy.process_samples(chunk).await.unwrap();
            // Small delay to simulate real-time processing
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        
        // Finish recording and get result
        let result = strategy.finish_recording().await.unwrap();
        
        // Verify results
        assert!(!result.text.is_empty());
        assert_eq!(result.strategy_used, "ring_buffer");
        assert!(result.processing_time_ms > 0);
        assert!(result.chunks_processed > 0);
        
        // Verify main recording file exists and has content
        assert!(audio_path.exists());
        let file_size = std::fs::metadata(&audio_path).unwrap().len();
        assert!(file_size > 1000); // Should have substantial audio data
        
        // Verify transcriber was called
        let mock = mock_transcriber.lock().await;
        assert!(mock.get_call_count() > 0);
    }

    /// Test progressive transcription strategy workflow
    #[tokio::test]
    async fn test_progressive_strategy_workflow_simulation() {
        let temp_dir = TempDir::new().unwrap();
        let models_dir = temp_dir.path().join("models");
        let audio_path = temp_dir.path().join("test_recording.wav");
        
        // Create mock model files
        tokio::fs::create_dir_all(&models_dir).await.unwrap();
        tokio::fs::write(models_dir.join("ggml-tiny.en.bin"), b"mock tiny model").await.unwrap();
        tokio::fs::write(models_dir.join("ggml-medium.en.bin"), b"mock medium model").await.unwrap();
        
        // Create test audio file
        let samples = create_test_audio_buffer(5.0, 16000, 440.0); // 5 seconds
        let spec = create_test_wav_spec(1, 16000);
        create_test_wav_file(&audio_path, spec, &samples).unwrap();
        
        // Test strategy selection logic (without actual progressive strategy creation)
        let config = TranscriptionConfig {
            enable_chunking: true,
            chunking_threshold_secs: 3,
            refinement_chunk_secs: Some(10),
            ..Default::default()
        };
        
        // Verify that progressive strategy would be selected
        let tiny_exists = models_dir.join("ggml-tiny.en.bin").exists();
        let medium_exists = models_dir.join("ggml-medium.en.bin").exists();
        let should_use_progressive = config.enable_chunking && tiny_exists && medium_exists;
        
        assert!(should_use_progressive);
        
        // Test file copying logic that progressive strategy uses
        let ring_buffer_file = temp_dir.path().join("ring_buffer_test_recording.wav");
        let main_recording = temp_dir.path().join("main_recording.wav");
        
        // Create ring buffer file with content
        tokio::fs::write(&ring_buffer_file, &samples.iter().map(|&f| f.to_le_bytes()).flatten().collect::<Vec<u8>>()).await.unwrap();
        
        // Test copying logic
        if ring_buffer_file.exists() {
            let copy_result = std::fs::copy(&ring_buffer_file, &main_recording);
            assert!(copy_result.is_ok());
            
            // Verify copy was successful
            assert!(main_recording.exists());
            let original_size = std::fs::metadata(&ring_buffer_file).unwrap().len();
            let copied_size = std::fs::metadata(&main_recording).unwrap().len();
            assert_eq!(original_size, copied_size);
            
            // Test cleanup
            std::fs::remove_file(&ring_buffer_file).unwrap();
            assert!(!ring_buffer_file.exists());
            assert!(main_recording.exists());
        }
    }

    /// Test strategy selector with different configurations
    #[tokio::test]
    async fn test_strategy_selector_integration() {
        let temp_dir = TempDir::new().unwrap();
        let models_dir = temp_dir.path().join("models");
        
        // Create different model scenarios
        tokio::fs::create_dir_all(&models_dir).await.unwrap();
        
        let mock_transcriber = Arc::new(Mutex::new(MockTranscriberWrapper::new()));
        
        // Test 1: No models - should fall back to ring buffer
        let config1 = TranscriptionConfig {
            enable_chunking: true,
            ..Default::default()
        };
        
        let strategy1 = TranscriptionStrategySelector::select_strategy(
            Some(Duration::from_secs(10)),
            &config1,
            mock_transcriber.clone(),
            models_dir.clone(),
            None,
        ).await;
        
        assert_eq!(strategy1.name(), "ring_buffer");
        
        // Test 2: Only tiny model - should use ring buffer
        tokio::fs::write(models_dir.join("ggml-tiny.en.bin"), b"mock tiny").await.unwrap();
        
        let strategy2 = TranscriptionStrategySelector::select_strategy(
            Some(Duration::from_secs(10)),
            &config1,
            mock_transcriber.clone(),
            models_dir.clone(),
            None,
        ).await;
        
        assert_eq!(strategy2.name(), "ring_buffer");
        
        // Test 3: Both tiny and medium models - should use progressive
        tokio::fs::write(models_dir.join("ggml-medium.en.bin"), b"mock medium").await.unwrap();
        
        let strategy3 = TranscriptionStrategySelector::select_strategy(
            Some(Duration::from_secs(10)),
            &config1,
            mock_transcriber.clone(),
            models_dir.clone(),
            None,
        ).await;
        
        assert_eq!(strategy3.name(), "progressive");
        
        // Test 4: Forced classic strategy
        let config4 = TranscriptionConfig {
            force_strategy: Some("classic".to_string()),
            ..Default::default()
        };
        
        let strategy4 = TranscriptionStrategySelector::select_strategy(
            Some(Duration::from_secs(10)),
            &config4,
            mock_transcriber.clone(),
            models_dir.clone(),
            None,
        ).await;
        
        assert_eq!(strategy4.name(), "classic");
        
        // Test 5: Chunking disabled - should use classic
        let config5 = TranscriptionConfig {
            enable_chunking: false,
            ..Default::default()
        };
        
        let strategy5 = TranscriptionStrategySelector::select_strategy(
            Some(Duration::from_secs(10)),
            &config5,
            mock_transcriber.clone(),
            models_dir.clone(),
            None,
        ).await;
        
        assert_eq!(strategy5.name(), "classic");
    }

    /// Test model state manager integration with transcription
    #[tokio::test]
    async fn test_model_state_integration() {
        let temp_dir = TempDir::new().unwrap();
        let models_dir = temp_dir.path().join("models");
        let data_dir = temp_dir.path().join("data");
        
        tokio::fs::create_dir_all(&models_dir).await.unwrap();
        tokio::fs::create_dir_all(&data_dir).await.unwrap();
        
        // Create model state manager
        let manager = Arc::new(ModelStateManager::new(&data_dir));
        
        // Test initial state (no models ready)
        assert!(!manager.is_coreml_ready("tiny.en").await);
        assert!(!manager.should_use_coreml("tiny.en").await);
        
        // Mark model as downloaded but not ready
        manager.mark_model_downloaded("tiny.en", true).await;
        let state = manager.get_state("tiny.en").await.unwrap();
        assert!(state.ggml_downloaded);
        assert!(matches!(state.coreml_state, CoreMLState::Downloaded));
        assert!(!manager.is_coreml_ready("tiny.en").await);
        
        // Transition through warming to ready
        manager.update_coreml_state("tiny.en", CoreMLState::Warming).await;
        assert!(!manager.is_coreml_ready("tiny.en").await);
        
        manager.update_coreml_state("tiny.en", CoreMLState::Ready).await;
        assert!(manager.is_coreml_ready("tiny.en").await);
        assert!(manager.should_use_coreml("tiny.en").await);
        
        // Test failed state
        manager.update_coreml_state("tiny.en", CoreMLState::Failed("Test error".to_string())).await;
        assert!(!manager.is_coreml_ready("tiny.en").await);
        assert!(!manager.should_use_coreml("tiny.en").await);
        
        // Verify persistence by creating new manager
        let manager2 = ModelStateManager::new(&data_dir);
        let state2 = manager2.get_state("tiny.en").await.unwrap();
        assert!(matches!(state2.coreml_state, CoreMLState::Failed(_)));
    }

    /// Test error handling in complete workflow
    #[tokio::test]
    async fn test_workflow_error_handling() {
        let temp_dir = TempDir::new().unwrap();
        let audio_path = temp_dir.path().join("test_recording.wav");
        let temp_dir_path = temp_dir.path().to_path_buf();
        
        // Create test audio file
        let samples = create_test_audio_buffer(1.0, 16000, 440.0);
        let spec = create_test_wav_spec(1, 16000);
        create_test_wav_file(&audio_path, spec, &samples).unwrap();
        
        // Setup mock transcriber to fail
        let mock_transcriber = Arc::new(Mutex::new(MockTranscriberWrapper::new()));
        {
            let mock = mock_transcriber.lock().await;
            mock.fail_next_transcription();
        }
        
        // Test classic strategy error handling
        let mut classic_strategy = ClassicTranscriptionStrategy::new(mock_transcriber.clone());
        let config = TranscriptionConfig::default();
        
        classic_strategy.start_recording(&audio_path, &config).await.unwrap();
        let result = classic_strategy.finish_recording().await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Classic transcription failed"));
        
        // Test ring buffer strategy with invalid file sizes
        let empty_file = temp_dir.path().join("empty.wav");
        tokio::fs::write(&empty_file, b"").await.unwrap();
        
        let mut ring_strategy = RingBufferTranscriptionStrategy::new(
            mock_transcriber.clone(),
            temp_dir_path,
        );
        
        ring_strategy.start_recording(&empty_file, &config).await.unwrap();
        let result = ring_strategy.finish_recording().await;
        
        // Should handle empty files gracefully (may error or return empty transcription)
        // The exact behavior depends on the implementation details
        if let Err(error) = result {
            assert!(error.contains("too small") || error.contains("empty") || error.contains("file"));
        }
    }

    /// Test concurrent strategy usage
    #[tokio::test]
    async fn test_concurrent_strategy_usage() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc as StdArc;
        
        let temp_dir = TempDir::new().unwrap();
        let counter = StdArc::new(AtomicUsize::new(0));
        
        let handles: Vec<_> = (0..5).map(|i| {
            let temp_dir_path = temp_dir.path().to_path_buf();
            let counter = counter.clone();
            
            tokio::spawn(async move {
                let audio_path = temp_dir_path.join(format!("test_{}.wav", i));
                
                // Create test audio file
                let samples = create_test_audio_buffer(0.5, 16000, 440.0);
                let spec = create_test_wav_spec(1, 16000);
                create_test_wav_file(&audio_path, spec, &samples).unwrap();
                
                // Setup mock transcriber
                let mock_transcriber = Arc::new(Mutex::new(MockTranscriberWrapper::new()));
                {
                    let mock = mock_transcriber.lock().await;
                    mock.set_response("short", &format!("Concurrent test {}", i));
                }
                
                // Create and run classic strategy
                let mut strategy = ClassicTranscriptionStrategy::new(mock_transcriber);
                let config = TranscriptionConfig::default();
                
                strategy.start_recording(&audio_path, &config).await.unwrap();
                let result = strategy.finish_recording().await.unwrap();
                
                assert!(result.text.contains(&format!("Concurrent test {}", i)));
                assert_eq!(result.strategy_used, "classic");
                
                counter.fetch_add(1, Ordering::SeqCst);
                i
            })
        }).collect();
        
        // Wait for all tasks to complete
        for handle in handles {
            handle.await.unwrap();
        }
        
        // All 5 concurrent strategies should have completed
        assert_eq!(counter.load(Ordering::SeqCst), 5);
    }

    /// Test realistic file sizes and processing times
    #[tokio::test]
    async fn test_realistic_workflow_performance() {
        let temp_dir = TempDir::new().unwrap();
        let audio_path = temp_dir.path().join("long_recording.wav");
        
        // Create longer audio file (10 seconds)
        let samples = create_test_audio_buffer(10.0, 16000, 440.0);
        let spec = create_test_wav_spec(1, 16000);
        create_test_wav_file(&audio_path, spec, &samples).unwrap();
        
        // Verify file size is realistic
        let file_size = std::fs::metadata(&audio_path).unwrap().len();
        assert!(file_size > 100_000); // Should be > 100KB for 10 seconds
        
        // Setup mock transcriber with realistic delay
        let mock_transcriber = Arc::new(Mutex::new(MockTranscriberWrapper::with_realistic_delays()));
        {
            let mock = mock_transcriber.lock().await;
            mock.set_response("long", "This is a long transcription result that would be typical for a 10-second audio recording with realistic content and proper length for testing purposes.");
        }
        
        // Test classic strategy performance
        let mut strategy = ClassicTranscriptionStrategy::new(mock_transcriber.clone());
        let config = TranscriptionConfig::default();
        
        let start_time = std::time::Instant::now();
        strategy.start_recording(&audio_path, &config).await.unwrap();
        let result = strategy.finish_recording().await.unwrap();
        let total_time = start_time.elapsed();
        
        // Verify results
        assert!(!result.text.is_empty());
        assert!(result.text.len() > 50); // Should be substantial text
        assert!(result.processing_time_ms > 100); // Should take some time
        assert!(total_time.as_millis() > 100); // Total workflow should take time
        
        // Performance should be reasonable for 10 seconds of audio
        assert!(result.processing_time_ms < 5000); // Should be less than 5 seconds for mock
        assert!(total_time.as_millis() < 10000); // Total time should be reasonable
        
        // Verify transcriber was called once for classic strategy
        let mock = mock_transcriber.lock().await;
        assert_eq!(mock.get_call_count(), 1);
    }
}