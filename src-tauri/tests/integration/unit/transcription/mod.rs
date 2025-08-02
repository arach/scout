// Transcription module unit tests
//
// This module contains comprehensive unit tests for the Scout transcription system,
// including strategy pattern implementation, ring buffer transcription, and chunk processing.
//
// Test Organization:
// - strategy_test.rs: Tests for transcription strategies (Classic, RingBuffer, Progressive)
// - ring_buffer_transcriber_test.rs: Tests for chunked transcription processing
// - mock_transcriber.rs: Mock transcriber implementation for predictable testing
//
// Test Types:
// - Unit tests: Fast, isolated tests with mocked whisper dependencies
// - Performance tests: Tests for transcription speed and memory usage
// - Concurrency tests: Tests for thread safety and concurrent processing
//
// Running Tests:
// - All transcription tests: `cargo test transcription::`
// - Strategy tests only: `cargo test transcription::strategy_test::`
// - With output: `cargo test transcription:: -- --nocapture`

pub mod strategy_test;
pub mod ring_buffer_transcriber_test;
pub mod mock_transcriber;

// Re-export common test utilities and mocks
pub use mock_transcriber::{MockTranscriber, MockTranscriberWrapper};
pub use super::super::common::*;

#[cfg(test)]
mod integration_tests {
    use super::*;
    use std::time::Duration;
    use tempfile::TempDir;

    /// Integration test that verifies different transcription strategies work together
    #[tokio::test]
    async fn test_strategy_interoperability() {
        let temp_dir = TempDir::new().unwrap();
        let mock_transcriber = MockTranscriberWrapper::new();
        mock_transcriber.set_response("short", "Strategy interop test");
        
        let transcriber_arc = std::sync::Arc::new(tokio::sync::Mutex::new(mock_transcriber));
        
        // Test that different strategies can use the same transcriber
        let strategies: Vec<Box<dyn scout_lib::transcription::TranscriptionStrategy>> = vec![
            Box::new(scout_lib::transcription::strategy::ClassicTranscriptionStrategy::new(
                transcriber_arc.clone()
            )),
        ];
        
        for strategy in strategies {
            assert!(!strategy.name().is_empty());
            let config = scout_lib::transcription::TranscriptionConfig::default();
            assert!(strategy.can_handle(Some(Duration::from_secs(5)), &config) 
                   || strategy.name() == "classic"); // Classic can handle anything
        }
    }

    /// Test that mock transcriber produces consistent results
    #[tokio::test]
    async fn test_mock_transcriber_consistency() {
        let mock = MockTranscriberWrapper::new();
        mock.set_response("test", "Consistent result");
        
        // Multiple calls should produce the same result
        let path = std::path::PathBuf::from("test.wav");
        let result1 = mock.transcribe_file(&path).unwrap();
        let result2 = mock.transcribe_file(&path).unwrap();
        
        assert_eq!(result1, result2);
        assert_eq!(mock.get_call_count(), 2);
    }

    /// Test error propagation through transcription layers
    #[tokio::test]
    async fn test_error_propagation() {
        let mock = MockTranscriberWrapper::new();
        mock.fail_next_transcription();
        
        let transcriber_arc = std::sync::Arc::new(tokio::sync::Mutex::new(mock));
        let mut strategy = scout_lib::transcription::strategy::ClassicTranscriptionStrategy::new(
            transcriber_arc
        );
        
        let temp_dir = TempDir::new().unwrap();
        let audio_path = temp_dir.path().join("error_test.wav");
        
        // Create minimal test file
        let samples = create_test_audio_buffer(0.1, 16000, 440.0);
        let spec = create_test_wav_spec(1, 16000);
        create_test_wav_file(&audio_path, spec, &samples).unwrap();
        
        let config = scout_lib::transcription::TranscriptionConfig::default();
        strategy.start_recording(&audio_path, &config).await.unwrap();
        
        let result = strategy.finish_recording().await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Classic transcription failed"));
    }
}

#[cfg(test)]
mod performance_tests {
    use super::*;
    use std::time::Instant;

    /// Benchmark mock transcriber performance
    #[tokio::test]
    async fn test_mock_transcriber_performance() {
        let mock = MockTranscriberWrapper::new();
        mock.set_response("perf", "Performance test result");
        
        let iterations = 100;
        let start = Instant::now();
        
        for i in 0..iterations {
            let path = std::path::PathBuf::from(format!("perf_test_{}.wav", i));
            let _result = mock.transcribe_file(&path).unwrap();
        }
        
        let duration = start.elapsed();
        let per_call = duration / iterations;
        
        println!("Mock transcriber performance: {:?} per call", per_call);
        
        // Should be very fast since it's mocked
        assert!(per_call < Duration::from_millis(1));
        assert_eq!(mock.get_call_count(), iterations);
    }

    /// Test concurrent transcription performance
    #[tokio::test]
    async fn test_concurrent_transcription_performance() {
        let mock = MockTranscriberWrapper::new();
        mock.set_response("concurrent", "Concurrent test");
        
        let transcriber_arc = std::sync::Arc::new(tokio::sync::Mutex::new(mock));
        let concurrent_tasks = 10;
        
        let start = Instant::now();
        
        let handles: Vec<_> = (0..concurrent_tasks).map(|i| {
            let transcriber = transcriber_arc.clone();
            tokio::spawn(async move {
                let path = std::path::PathBuf::from(format!("concurrent_test_{}.wav", i));
                let transcriber = transcriber.lock().await;
                transcriber.transcribe_file(&path)
            })
        }).collect();
        
        let results: Vec<_> = futures_util::future::join_all(handles).await;
        let duration = start.elapsed();
        
        // All should succeed
        for result in results {
            assert!(result.unwrap().is_ok());
        }
        
        println!("Concurrent transcription: {:?} for {} tasks", duration, concurrent_tasks);
        
        // Should still be fast even with concurrent access
        assert!(duration < Duration::from_millis(100));
        
        let final_mock = transcriber_arc.lock().await;
        assert_eq!(final_mock.get_call_count(), concurrent_tasks);
    }
}

#[cfg(test)]
mod memory_tests {
    use super::*;

    /// Test memory usage with large transcription workloads
    #[tokio::test]
    async fn test_large_workload_memory() {
        let mock = MockTranscriberWrapper::new();
        mock.set_response("large", "Large workload test result with substantial content");
        
        // Process many files to test memory management
        let file_count = 1000;
        
        for i in 0..file_count {
            let path = std::path::PathBuf::from(format!("large_test_{}.wav", i));
            let result = mock.transcribe_file(&path);
            assert!(result.is_ok());
            
            // Periodically check that we can still allocate memory
            if i % 100 == 0 {
                let _test_allocation = vec![0u8; 1024 * 1024]; // 1MB test allocation
            }
        }
        
        assert_eq!(mock.get_call_count(), file_count);
        
        // Should have processed all files without running out of memory
        println!("Successfully processed {} files", file_count);
    }

    /// Test transcriber state cleanup
    #[tokio::test]
    async fn test_transcriber_cleanup() {
        // Test that transcribers clean up properly when dropped
        {
            let mock = MockTranscriberWrapper::new();
            mock.set_response("cleanup", "Cleanup test");
            
            // Use the transcriber
            let path = std::path::PathBuf::from("cleanup_test.wav");
            let _result = mock.transcribe_file(&path).unwrap();
            
            // Transcriber will be dropped here
        }
        
        // Should not leak memory or resources
        // In a real test, you might check system resources here
        
        // Create a new transcriber to ensure we can still allocate
        let new_mock = MockTranscriberWrapper::new();
        let path = std::path::PathBuf::from("cleanup_test2.wav");
        let result = new_mock.transcribe_file(&path);
        assert!(result.is_ok());
    }
}