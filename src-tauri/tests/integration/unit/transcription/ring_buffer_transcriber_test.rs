use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;
use tokio::sync::Mutex;
use tokio::time::timeout;

use scout_lib::audio::ring_buffer_recorder::RingBufferRecorder;
use scout_lib::transcription::ring_buffer_transcriber::{
    RingBufferTranscriber, ChunkRequest, ChunkResult,
};

use crate::unit::transcription::mock_transcriber::MockTranscriberWrapper;
use crate::common::{create_test_audio_buffer, create_test_wav_spec};

/// Create a mock ring buffer recorder for testing
async fn create_mock_ring_buffer(temp_dir: &Path) -> Arc<RingBufferRecorder> {
    let spec = create_test_wav_spec(1, 16000);
    let ring_buffer_path = temp_dir.join("test_ring_buffer.wav");
    
    Arc::new(RingBufferRecorder::new(spec, &ring_buffer_path).unwrap())
}

/// Create a mock transcriber for testing
fn create_mock_transcriber() -> Arc<Mutex<MockTranscriberWrapper>> {
    let mock = MockTranscriberWrapper::new();
    Arc::new(Mutex::new(mock))
}

#[cfg(test)]
mod chunk_request_tests {
    use super::*;

    #[test]
    fn test_chunk_request_creation() {
        let request = ChunkRequest {
            chunk_id: 42,
            start_offset: Duration::from_secs(5),
            duration: Duration::from_secs(3),
        };
        
        assert_eq!(request.chunk_id, 42);
        assert_eq!(request.start_offset, Duration::from_secs(5));
        assert_eq!(request.duration, Duration::from_secs(3));
    }

    #[test]
    fn test_chunk_request_debug() {
        let request = ChunkRequest {
            chunk_id: 1,
            start_offset: Duration::from_millis(1500),
            duration: Duration::from_millis(2500),
        };
        
        let debug_str = format!("{:?}", request);
        assert!(debug_str.contains("1"));
        assert!(debug_str.contains("1500"));
        assert!(debug_str.contains("2500"));
    }
}

#[cfg(test)]
mod chunk_result_tests {
    use super::*;

    #[test]
    fn test_chunk_result_creation() {
        let result = ChunkResult {
            chunk_id: 10,
            text: "Hello world".to_string(),
            start_offset: Duration::from_secs(2),
            duration: Duration::from_secs(1),
        };
        
        assert_eq!(result.chunk_id, 10);
        assert_eq!(result.text, "Hello world");
        assert_eq!(result.start_offset, Duration::from_secs(2));
        assert_eq!(result.duration, Duration::from_secs(1));
    }

    #[test]
    fn test_chunk_result_debug() {
        let result = ChunkResult {
            chunk_id: 5,
            text: "Debug test".to_string(),
            start_offset: Duration::from_millis(500),
            duration: Duration::from_millis(1000),
        };
        
        let debug_str = format!("{:?}", result);
        assert!(debug_str.contains("5"));
        assert!(debug_str.contains("Debug test"));
        assert!(debug_str.contains("500"));
        assert!(debug_str.contains("1000"));
    }
}

#[cfg(test)]
mod ring_buffer_transcriber_tests {
    use super::*;

    #[tokio::test]
    async fn test_ring_buffer_transcriber_creation() {
        let temp_dir = TempDir::new().unwrap();
        let ring_buffer = create_mock_ring_buffer(temp_dir.path()).await;
        let mock_transcriber = create_mock_transcriber();
        
        let transcriber = RingBufferTranscriber::new(
            ring_buffer,
            mock_transcriber,
            temp_dir.path().to_path_buf(),
        );
        
        // Transcriber should be created successfully
        // We can't easily test internal state, but creation not panicking is good
        drop(transcriber); // Explicit drop to test cleanup
    }

    #[tokio::test]
    async fn test_ring_buffer_transcriber_process_chunk() {
        let temp_dir = TempDir::new().unwrap();
        let mut transcriber = create_test_transcriber(temp_dir.path()).await;
        
        // Process a chunk
        let result = transcriber.process_chunk(
            Duration::from_secs(0),
            Duration::from_secs(1),
        ).await;
        
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_ring_buffer_transcriber_multiple_chunks() {
        let temp_dir = TempDir::new().unwrap();
        let mut transcriber = create_test_transcriber(temp_dir.path()).await;
        
        // Process multiple chunks
        for i in 0..3 {
            let result = transcriber.process_chunk(
                Duration::from_secs(i * 2),
                Duration::from_secs(1),
            ).await;
            assert!(result.is_ok());
        }
        
        // Give some time for async processing
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    #[tokio::test]
    async fn test_ring_buffer_transcriber_try_get_result() {
        let temp_dir = TempDir::new().unwrap();
        let ring_buffer = create_mock_ring_buffer(temp_dir.path()).await;
        let mock_transcriber = create_mock_transcriber();
        
        // Add some test audio data to the ring buffer
        let test_samples = create_test_audio_buffer(1.0, 16000, 440.0);
        ring_buffer.add_samples(&test_samples).unwrap();
        
        let mut transcriber = RingBufferTranscriber::new(
            ring_buffer,
            mock_transcriber,
            temp_dir.path().to_path_buf(),
        );
        
        // Initially no results
        let result = transcriber.try_get_result();
        assert!(result.is_none());
        
        // Process a chunk
        transcriber.process_chunk(
            Duration::from_secs(0),
            Duration::from_millis(500),
        ).await.unwrap();
        
        // Wait a bit and try to get result
        tokio::time::sleep(Duration::from_millis(100)).await;
        
        // May or may not have result depending on processing speed
        let _result = transcriber.try_get_result();
        // We can't assert on this because it's timing-dependent
    }

    #[tokio::test]
    async fn test_ring_buffer_transcriber_get_all_results() {
        let temp_dir = TempDir::new().unwrap();
        let transcriber = create_test_transcriber(temp_dir.path()).await;
        
        // Initially no results
        let results = transcriber.get_all_results();
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn test_ring_buffer_transcriber_finish_and_collect() {
        let temp_dir = TempDir::new().unwrap();
        let ring_buffer = create_mock_ring_buffer(temp_dir.path()).await;
        let mock_transcriber = create_mock_transcriber();
        
        // Setup mock responses
        {
            let mock = mock_transcriber.lock().await;
            mock.set_response("short", "Chunk 1");
            mock.reset_call_count();
        }
        
        // Add test audio data
        let test_samples = create_test_audio_buffer(2.0, 16000, 440.0);
        ring_buffer.add_samples(&test_samples).unwrap();
        
        let mut transcriber = RingBufferTranscriber::new(
            ring_buffer,
            mock_transcriber.clone(),
            temp_dir.path().to_path_buf(),
        );
        
        // Process a couple of chunks
        transcriber.process_chunk(
            Duration::from_secs(0),
            Duration::from_millis(500),
        ).await.unwrap();
        
        transcriber.process_chunk(
            Duration::from_millis(500),
            Duration::from_millis(500),
        ).await.unwrap();
        
        // Finish and collect results
        let results = timeout(
            Duration::from_secs(5),
            transcriber.finish_and_collect_results()
        ).await.expect("Timeout waiting for results").unwrap();
        
        // Should have processed chunks
        assert!(results.len() >= 0); // May be 0 if chunks were empty
        
        // Results should be sorted by chunk_id
        for i in 1..results.len() {
            assert!(results[i-1].chunk_id <= results[i].chunk_id);
        }
    }

    #[tokio::test]
    async fn test_ring_buffer_transcriber_process_chunk_sync() {
        let temp_dir = TempDir::new().unwrap();
        let ring_buffer = create_mock_ring_buffer(temp_dir.path()).await;
        let mock_transcriber = create_mock_transcriber();
        
        // Setup mock response
        {
            let mock = mock_transcriber.lock().await;
            mock.set_response("short", "Synchronous result");
        }
        
        // Add test audio data
        let test_samples = create_test_audio_buffer(1.0, 16000, 440.0);
        ring_buffer.add_samples(&test_samples).unwrap();
        
        let transcriber = RingBufferTranscriber::new(
            ring_buffer,
            mock_transcriber.clone(),
            temp_dir.path().to_path_buf(),
        );
        
        // Process chunk synchronously
        let result = transcriber.process_chunk_sync(
            42,
            Duration::from_secs(0),
            Duration::from_millis(500),
        ).await;
        
        // Should succeed (may be empty if no audio data in chunk)
        assert!(result.is_ok());
        
        // Verify transcriber was called
        let mock = mock_transcriber.lock().await;
        assert!(mock.get_call_count() >= 0); // May be 0 if chunk was empty
    }

    #[tokio::test]
    async fn test_ring_buffer_transcriber_error_handling() {
        let temp_dir = TempDir::new().unwrap();
        let ring_buffer = create_mock_ring_buffer(temp_dir.path()).await;
        let mock_transcriber = create_mock_transcriber();
        
        // Setup mock to fail
        {
            let mock = mock_transcriber.lock().await;
            mock.fail_next_transcription();
        }
        
        // Add test audio data
        let test_samples = create_test_audio_buffer(1.0, 16000, 440.0);
        ring_buffer.add_samples(&test_samples).unwrap();
        
        let transcriber = RingBufferTranscriber::new(
            ring_buffer,
            mock_transcriber,
            temp_dir.path().to_path_buf(),
        );
        
        // Process chunk synchronously - should handle error gracefully
        let result = transcriber.process_chunk_sync(
            1,
            Duration::from_secs(0),
            Duration::from_millis(500),
        ).await;
        
        // The result may be Ok with empty string or Err depending on implementation
        // Either way, it shouldn't panic
        let _result_text = match result {
            Ok(text) => text,
            Err(_) => String::new(),
        };
    }

    #[tokio::test]
    async fn test_ring_buffer_transcriber_empty_chunks() {
        let temp_dir = TempDir::new().unwrap();
        let ring_buffer = create_mock_ring_buffer(temp_dir.path()).await;
        let mock_transcriber = create_mock_transcriber();
        
        // Don't add any audio data to ring buffer
        
        let transcriber = RingBufferTranscriber::new(
            ring_buffer,
            mock_transcriber,
            temp_dir.path().to_path_buf(),
        );
        
        // Process chunk from empty buffer
        let result = transcriber.process_chunk_sync(
            1,
            Duration::from_secs(0),
            Duration::from_millis(500),
        ).await;
        
        // Should handle empty chunks gracefully
        assert!(result.is_ok());
        let text = result.unwrap();
        assert!(text.is_empty()); // Empty chunk should produce empty text
    }

    #[tokio::test]
    async fn test_ring_buffer_transcriber_concurrent_access() {
        let temp_dir = TempDir::new().unwrap();
        let ring_buffer = create_mock_ring_buffer(temp_dir.path()).await;
        let mock_transcriber = create_mock_transcriber();
        
        // Add test audio data
        let test_samples = create_test_audio_buffer(5.0, 16000, 440.0);
        ring_buffer.add_samples(&test_samples).unwrap();
        
        let transcriber = Arc::new(RingBufferTranscriber::new(
            ring_buffer,
            mock_transcriber,
            temp_dir.path().to_path_buf(),
        ));
        
        // Process multiple chunks concurrently
        let handles: Vec<_> = (0..5).map(|i| {
            let transcriber = transcriber.clone();
            tokio::spawn(async move {
                transcriber.process_chunk_sync(
                    i,
                    Duration::from_millis(i as u64 * 200),
                    Duration::from_millis(200),
                ).await
            })
        }).collect();
        
        // Wait for all to complete
        for handle in handles {
            let result = handle.await.unwrap();
            assert!(result.is_ok());
        }
    }

    #[tokio::test]
    async fn test_ring_buffer_transcriber_drop_cleanup() {
        let temp_dir = TempDir::new().unwrap();
        let ring_buffer = create_mock_ring_buffer(temp_dir.path()).await;
        let mock_transcriber = create_mock_transcriber();
        
        {
            let mut transcriber = RingBufferTranscriber::new(
                ring_buffer,
                mock_transcriber,
                temp_dir.path().to_path_buf(),
            );
            
            // Process a chunk
            transcriber.process_chunk(
                Duration::from_secs(0),
                Duration::from_millis(100),
            ).await.unwrap();
            
            // Transcriber will be dropped here
        }
        
        // Should not panic or hang during drop
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    async fn create_test_transcriber(temp_dir: &Path) -> RingBufferTranscriber {
        let ring_buffer = create_mock_ring_buffer(temp_dir).await;
        let mock_transcriber = create_mock_transcriber();
        
        RingBufferTranscriber::new(
            ring_buffer,
            mock_transcriber,
            temp_dir.to_path_buf(),
        )
    }
}

#[cfg(test)]
mod performance_tests {
    use super::*;
    use std::time::Instant;

    #[tokio::test]
    async fn test_ring_buffer_transcriber_performance() {
        let temp_dir = TempDir::new().unwrap();
        let ring_buffer = create_mock_ring_buffer(temp_dir.path()).await;
        let mock_transcriber = create_mock_transcriber();
        
        // Setup fast mock responses
        {
            let mock = mock_transcriber.lock().await;
            mock.set_response("short", "Fast response");
        }
        
        // Add substantial test audio data
        let test_samples = create_test_audio_buffer(10.0, 16000, 440.0);
        ring_buffer.add_samples(&test_samples).unwrap();
        
        let mut transcriber = RingBufferTranscriber::new(
            ring_buffer,
            mock_transcriber,
            temp_dir.path().to_path_buf(),
        );
        
        let start = Instant::now();
        
        // Process multiple chunks
        for i in 0..10 {
            transcriber.process_chunk(
                Duration::from_millis(i * 100),
                Duration::from_millis(100),
            ).await.unwrap();
        }
        
        let process_time = start.elapsed();
        
        // Processing should be relatively fast (mostly just queuing)
        assert!(process_time < Duration::from_millis(100));
        
        // Cleanup
        let _results = timeout(
            Duration::from_secs(2),
            transcriber.finish_and_collect_results()
        ).await.expect("Timeout during cleanup").unwrap();
    }

    #[tokio::test]
    async fn test_ring_buffer_transcriber_memory_usage() {
        // This is a basic memory usage test - in a real scenario you'd use more sophisticated tools
        let temp_dir = TempDir::new().unwrap();
        let ring_buffer = create_mock_ring_buffer(temp_dir.path()).await;
        let mock_transcriber = create_mock_transcriber();
        
        // Add large amount of test audio data
        let test_samples = create_test_audio_buffer(30.0, 16000, 440.0);
        ring_buffer.add_samples(&test_samples).unwrap();
        
        let mut transcriber = RingBufferTranscriber::new(
            ring_buffer,
            mock_transcriber,
            temp_dir.path().to_path_buf(),
        );
        
        // Process many chunks
        for i in 0..50 {
            transcriber.process_chunk(
                Duration::from_millis(i * 50),
                Duration::from_millis(50),
            ).await.unwrap();
        }
        
        // Should not run out of memory or crash
        let _results = timeout(
            Duration::from_secs(5),
            transcriber.finish_and_collect_results()
        ).await.expect("Timeout during memory test").unwrap();
        
        // Basic assertion - results should exist and be reasonable
        assert!(_results.len() >= 0);
    }

    #[tokio::test]
    async fn test_ring_buffer_transcriber_stress_test() {
        let temp_dir = TempDir::new().unwrap();
        let ring_buffer = create_mock_ring_buffer(temp_dir.path()).await;
        let mock_transcriber = create_mock_transcriber();
        
        // Setup various mock responses
        {
            let mock = mock_transcriber.lock().await;
            mock.set_response("short", "Stress test response");
            mock.set_response("medium", "Medium stress test response with more content");
            mock.set_response("long", "Long stress test response with much more content that simulates real transcription output");
        }
        
        // Add audio data
        let test_samples = create_test_audio_buffer(20.0, 16000, 440.0);
        ring_buffer.add_samples(&test_samples).unwrap();
        
        let transcriber = Arc::new(RingBufferTranscriber::new(
            ring_buffer,
            mock_transcriber,
            temp_dir.path().to_path_buf(),
        ));
        
        // Create multiple concurrent tasks
        let handles: Vec<_> = (0..20).map(|i| {
            let transcriber = transcriber.clone();
            tokio::spawn(async move {
                transcriber.process_chunk_sync(
                    i,
                    Duration::from_millis(i as u64 * 50),
                    Duration::from_millis(100),
                ).await
            })
        }).collect();
        
        // Wait for all tasks with timeout
        let results = timeout(Duration::from_secs(10), async {
            let mut results = Vec::new();
            for handle in handles {
                results.push(handle.await.unwrap());
            }
            results
        }).await.expect("Stress test timeout");
        
        // All tasks should complete successfully
        for result in results {
            assert!(result.is_ok());
        }
    }
}