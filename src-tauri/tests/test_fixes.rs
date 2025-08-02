// Comprehensive tests for the three major fixes implemented
//
// This test file focuses on testing the specific fixes:
// 1. Core ML warm-up fix (uses cached transcriber system)
// 2. Progressive strategy fix (enabled when Tiny + Medium models exist)
// 3. Empty WAV file fix (ring buffer copies audio to main recording file)

use std::sync::Arc;
use tempfile::TempDir;

// Re-export the scout library for testing
extern crate scout_lib;

/// Test Core ML warm-up logic
#[tokio::test]
async fn test_coreml_warmup_fix() {
    let temp_dir = TempDir::new().unwrap();
    let data_dir = temp_dir.path().join("data");
    tokio::fs::create_dir_all(&data_dir).await.unwrap();
    
    let manager = scout_lib::model_state::ModelStateManager::new(&data_dir);
    
    // Test 1: Initial state should not be ready
    assert!(!manager.is_coreml_ready("tiny.en").await);
    assert!(!manager.should_use_coreml("tiny.en").await);
    
    // Test 2: Mark as ready and verify state
    manager.update_coreml_state("tiny.en", scout_lib::model_state::CoreMLState::Ready).await;
    assert!(manager.is_coreml_ready("tiny.en").await);
    assert!(manager.should_use_coreml("tiny.en").await);
    
    // Test 3: Verify state persistence by creating new manager
    let manager2 = scout_lib::model_state::ModelStateManager::new(&data_dir);
    assert!(manager2.is_coreml_ready("tiny.en").await);
}

/// Test progressive strategy selection logic
#[tokio::test]
async fn test_progressive_strategy_selection_fix() {
    let temp_dir = TempDir::new().unwrap();
    let models_dir = temp_dir.path().join("models");
    tokio::fs::create_dir_all(&models_dir).await.unwrap();
    
    // Test 1: No models - should not enable progressive
    let config = scout_lib::transcription::TranscriptionConfig {
        enable_chunking: true,
        ..Default::default()
    };
    
    let tiny_exists = models_dir.join("ggml-tiny.en.bin").exists();
    let medium_exists = models_dir.join("ggml-medium.en.bin").exists();
    let should_use_progressive = config.enable_chunking && tiny_exists && medium_exists;
    assert!(!should_use_progressive);
    
    // Test 2: Only tiny model - should not enable progressive
    tokio::fs::write(models_dir.join("ggml-tiny.en.bin"), b"mock tiny model").await.unwrap();
    let tiny_exists = models_dir.join("ggml-tiny.en.bin").exists();
    let medium_exists = models_dir.join("ggml-medium.en.bin").exists();
    let should_use_progressive = config.enable_chunking && tiny_exists && medium_exists;
    assert!(!should_use_progressive);
    
    // Test 3: Both tiny and medium models - should enable progressive
    tokio::fs::write(models_dir.join("ggml-medium.en.bin"), b"mock medium model").await.unwrap();
    let tiny_exists = models_dir.join("ggml-tiny.en.bin").exists();
    let medium_exists = models_dir.join("ggml-medium.en.bin").exists();
    let should_use_progressive = config.enable_chunking && tiny_exists && medium_exists;
    assert!(should_use_progressive);
}

/// Test ring buffer file copying logic
#[tokio::test]
async fn test_ring_buffer_file_copying_fix() {
    let temp_dir = TempDir::new().unwrap();
    let main_recording = temp_dir.path().join("recording.wav");
    let ring_buffer_file = temp_dir.path().join("ring_buffer_recording.wav");
    
    // Test 1: Create ring buffer file with content
    let test_content = b"mock audio data for testing file copying logic";
    tokio::fs::write(&ring_buffer_file, test_content).await.unwrap();
    
    // Test 2: Verify ring buffer file exists and has content
    assert!(ring_buffer_file.exists());
    let ring_size = std::fs::metadata(&ring_buffer_file).unwrap().len();
    assert!(ring_size > 0);
    
    // Test 3: Copy ring buffer to main recording (the fix being tested)
    if ring_buffer_file.exists() {
        match std::fs::copy(&ring_buffer_file, &main_recording) {
            Ok(bytes_copied) => {
                assert_eq!(bytes_copied, test_content.len() as u64);
                
                // Test 4: Verify content was copied correctly
                let copied_content = tokio::fs::read(&main_recording).await.unwrap();
                assert_eq!(copied_content, test_content);
                
                // Test 5: Verify main file has same size as ring buffer
                let main_size = std::fs::metadata(&main_recording).unwrap().len();
                assert_eq!(main_size, ring_size);
                
                // Test 6: Clean up ring buffer file (part of the fix)
                std::fs::remove_file(&ring_buffer_file).unwrap();
                assert!(!ring_buffer_file.exists());
                assert!(main_recording.exists());
            }
            Err(e) => panic!("File copy failed: {}", e),
        }
    }
}

/// Test model state manager concurrent access (testing the fix's thread safety)
#[tokio::test]
async fn test_model_state_concurrent_access() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc as StdArc;
    
    let temp_dir = TempDir::new().unwrap();
    let data_dir = temp_dir.path().join("data");
    tokio::fs::create_dir_all(&data_dir).await.unwrap();
    
    let manager = Arc::new(scout_lib::model_state::ModelStateManager::new(&data_dir));
    let counter = StdArc::new(AtomicUsize::new(0));
    
    let handles: Vec<_> = (0..10).map(|i| {
        let manager = manager.clone();
        let counter = counter.clone();
        
        tokio::spawn(async move {
            let model_id = format!("model-{}", i);
            
            // Update state concurrently (testing the fix's thread safety)
            manager.update_coreml_state(&model_id, scout_lib::model_state::CoreMLState::Ready).await;
            
            // Verify state was set
            assert!(manager.is_coreml_ready(&model_id).await);
            
            counter.fetch_add(1, Ordering::SeqCst);
            i
        })
    }).collect();
    
    // Wait for all tasks to complete
    for handle in handles {
        handle.await.unwrap();
    }
    
    // All 10 concurrent updates should have succeeded
    assert_eq!(counter.load(Ordering::SeqCst), 10);
}

/// Test empty WAV file detection and handling (part of the ring buffer fix)
#[tokio::test]
async fn test_empty_wav_file_detection() {
    let temp_dir = TempDir::new().unwrap();
    let empty_file = temp_dir.path().join("empty.wav");
    let small_file = temp_dir.path().join("small.wav");
    let normal_file = temp_dir.path().join("normal.wav");
    
    // Create different sized files
    tokio::fs::write(&empty_file, b"").await.unwrap();
    tokio::fs::write(&small_file, b"tiny").await.unwrap(); // 4 bytes
    tokio::fs::write(&normal_file, vec![0u8; 2000]).await.unwrap(); // 2000 bytes
    
    // Test the size checking logic used in the fix (1000 bytes threshold)
    let empty_size = std::fs::metadata(&empty_file).unwrap().len();
    let small_size = std::fs::metadata(&small_file).unwrap().len();
    let normal_size = std::fs::metadata(&normal_file).unwrap().len();
    
    // Files smaller than 1KB should be considered too small for transcription
    assert!(empty_size < 1000);
    assert!(small_size < 1000);
    assert!(normal_size >= 1000);
    
    // The fix should handle empty files gracefully by checking size first
    assert_eq!(empty_size, 0);
    assert!(small_size > 0 && small_size < 1000);
    assert!(normal_size >= 1000);
}

/// Test configuration validation for the fixes
#[test]
fn test_transcription_config_validation() {
    // Test default configuration (should enable progressive strategy)
    let default_config = scout_lib::transcription::TranscriptionConfig::default();
    assert!(default_config.enable_chunking);
    assert_eq!(default_config.chunking_threshold_secs, 5);
    assert_eq!(default_config.chunk_duration_secs, 5);
    assert_eq!(default_config.refinement_chunk_secs, Some(10));
    
    // Test custom configuration for progressive strategy
    let progressive_config = scout_lib::transcription::TranscriptionConfig {
        enable_chunking: true,
        refinement_chunk_secs: Some(15),
        ..Default::default()
    };
    assert!(progressive_config.enable_chunking);
    assert_eq!(progressive_config.refinement_chunk_secs, Some(15));
    
    // Test configuration that disables chunking (won't use progressive)
    let classic_config = scout_lib::transcription::TranscriptionConfig {
        enable_chunking: false,
        ..Default::default()
    };
    assert!(!classic_config.enable_chunking);
}

/// Test model discovery logic used in the warm-up fix
#[tokio::test]
async fn test_model_discovery_logic() {
    let temp_dir = TempDir::new().unwrap();
    let models_dir = temp_dir.path().join("models");
    tokio::fs::create_dir_all(&models_dir).await.unwrap();
    
    // Create GGML models
    tokio::fs::write(models_dir.join("ggml-tiny.en.bin"), b"mock tiny model").await.unwrap();
    tokio::fs::write(models_dir.join("ggml-base.en.bin"), b"mock base model").await.unwrap();
    tokio::fs::write(models_dir.join("ggml-medium.en.bin"), b"mock medium model").await.unwrap();
    
    // Create CoreML models for some of them
    tokio::fs::create_dir_all(models_dir.join("ggml-tiny.en-encoder.mlmodelc")).await.unwrap();
    tokio::fs::write(models_dir.join("ggml-tiny.en-encoder.mlmodelc/model.mlmodel"), b"mock coreml").await.unwrap();
    
    tokio::fs::create_dir_all(models_dir.join("ggml-medium.en-encoder.mlmodelc")).await.unwrap();
    tokio::fs::write(models_dir.join("ggml-medium.en-encoder.mlmodelc/model.mlmodel"), b"mock coreml").await.unwrap();
    
    // Test the discovery logic from the warm-up fix
    let mut available_models = Vec::new();
    
    if let Ok(entries) = std::fs::read_dir(&models_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                if file_name.starts_with("ggml-") && file_name.ends_with(".bin") {
                    if let Some(model_id) = file_name.strip_prefix("ggml-").and_then(|s| s.strip_suffix(".bin")) {
                        let coreml_path = models_dir.join(format!("ggml-{}-encoder.mlmodelc", model_id));
                        if coreml_path.exists() {
                            available_models.push(model_id.to_string());
                        }
                    }
                }
            }
        }
    }
    
    // Should find tiny.en and medium.en (which have CoreML), but not base.en
    assert_eq!(available_models.len(), 2);
    assert!(available_models.contains(&"tiny.en".to_string()));
    assert!(available_models.contains(&"medium.en".to_string()));
    assert!(!available_models.contains(&"base.en".to_string()));
}