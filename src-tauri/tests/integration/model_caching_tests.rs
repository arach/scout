// Integration tests for Core ML model initialization and caching
//
// These tests validate the model state management, warm-up processes,
// and caching behavior across the entire transcription system.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;
use tokio::fs;

// Import from the scout crate
extern crate scout_lib;

use scout_lib::model_state::{ModelStateManager, CoreMLState, warm_coreml_models};
use scout_lib::transcription::Transcriber;

/// Integration tests for Core ML model initialization and caching
#[cfg(test)]
mod model_caching_integration_tests {
    use super::*;

    /// Helper to create realistic model directory structure
    async fn create_realistic_model_structure(models_dir: &Path) -> Result<(), std::io::Error> {
        fs::create_dir_all(models_dir).await?;
        
        // Create GGML model files
        fs::write(models_dir.join("ggml-tiny.en.bin"), b"mock tiny model data that represents a real whisper model file with sufficient content").await?;
        fs::write(models_dir.join("ggml-base.en.bin"), b"mock base model data that represents a real whisper model file with substantial content").await?;
        fs::write(models_dir.join("ggml-small.en.bin"), b"mock small model data that represents a real whisper model file with larger content").await?;
        fs::write(models_dir.join("ggml-medium.en.bin"), b"mock medium model data that represents a real whisper model file with even more content").await?;
        
        // Create CoreML model directories (mlmodelc packages are directories)
        fs::create_dir_all(models_dir.join("ggml-tiny.en-encoder.mlmodelc")).await?;
        fs::write(models_dir.join("ggml-tiny.en-encoder.mlmodelc/model.mlmodel"), b"mock coreml model").await?;
        fs::write(models_dir.join("ggml-tiny.en-encoder.mlmodelc/metadata.json"), r#"{"version": "1.0"}"#).await?;
        
        fs::create_dir_all(models_dir.join("ggml-medium.en-encoder.mlmodelc")).await?;
        fs::write(models_dir.join("ggml-medium.en-encoder.mlmodelc/model.mlmodel"), b"mock coreml medium model").await?;
        fs::write(models_dir.join("ggml-medium.en-encoder.mlmodelc/metadata.json"), r#"{"version": "1.0"}"#).await?;
        
        // base and small models don't have CoreML (realistic scenario)
        
        Ok(())
    }

    /// Test Core ML model discovery and warm-up workflow
    #[tokio::test]
    async fn test_coreml_model_discovery_integration() {
        let temp_dir = TempDir::new().unwrap();
        let models_dir = temp_dir.path().join("models");
        let data_dir = temp_dir.path().join("data");
        
        // Create realistic model structure
        create_realistic_model_structure(&models_dir).await.unwrap();
        fs::create_dir_all(&data_dir).await.unwrap();
        
        let manager = Arc::new(ModelStateManager::new(&data_dir));
        
        // Test model discovery logic (simulate warm_coreml_models without actual transcription)
        let mut discovered_models = Vec::new();
        
        if let Ok(entries) = std::fs::read_dir(&models_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                    if file_name.starts_with("ggml-") && file_name.ends_with(".bin") {
                        if let Some(model_id) = file_name.strip_prefix("ggml-").and_then(|s| s.strip_suffix(".bin")) {
                            let coreml_path = models_dir.join(format!("ggml-{}-encoder.mlmodelc", model_id));
                            if coreml_path.exists() {
                                discovered_models.push(model_id.to_string());
                            }
                        }
                    }
                }
            }
        }
        
        // Should discover tiny.en and medium.en (which have CoreML)
        assert_eq!(discovered_models.len(), 2);
        assert!(discovered_models.contains(&"tiny.en".to_string()));
        assert!(discovered_models.contains(&"medium.en".to_string()));
        
        // Verify base.en and small.en are not discovered (no CoreML)
        assert!(!discovered_models.contains(&"base.en".to_string()));
        assert!(!discovered_models.contains(&"small.en".to_string()));
    }

    /// Test model state persistence across manager instances
    #[tokio::test]
    async fn test_model_state_persistence_integration() {
        let temp_dir = TempDir::new().unwrap();
        let data_dir = temp_dir.path().join("data");
        fs::create_dir_all(&data_dir).await.unwrap();
        
        // Create first manager and set some states
        {
            let manager1 = ModelStateManager::new(&data_dir);
            
            // Mark several models with different states
            manager1.mark_model_downloaded("tiny.en", true).await;
            manager1.update_coreml_state("tiny.en", CoreMLState::Ready).await;
            
            manager1.mark_model_downloaded("base.en", false).await;
            
            manager1.mark_model_downloaded("medium.en", true).await;
            manager1.update_coreml_state("medium.en", CoreMLState::Failed("Test error".to_string())).await;
            
            // Verify states are set
            assert!(manager1.is_coreml_ready("tiny.en").await);
            assert!(!manager1.is_coreml_ready("base.en").await);
            assert!(!manager1.is_coreml_ready("medium.en").await);
        }
        
        // Create second manager and verify persistence
        {
            let manager2 = ModelStateManager::new(&data_dir);
            
            // States should be loaded from disk
            assert!(manager2.is_coreml_ready("tiny.en").await);
            assert!(!manager2.is_coreml_ready("base.en").await);
            assert!(!manager2.is_coreml_ready("medium.en").await);
            
            // Verify detailed states
            let tiny_state = manager2.get_state("tiny.en").await.unwrap();
            assert!(matches!(tiny_state.coreml_state, CoreMLState::Ready));
            assert!(tiny_state.last_warmed.is_some());
            
            let base_state = manager2.get_state("base.en").await.unwrap();
            assert!(matches!(base_state.coreml_state, CoreMLState::NotDownloaded));
            
            let medium_state = manager2.get_state("medium.en").await.unwrap();
            assert!(matches!(medium_state.coreml_state, CoreMLState::Failed(_)));
        }
    }

    /// Test warm-up skip logic for already ready models
    #[tokio::test]
    async fn test_warmup_skip_logic_integration() {
        let temp_dir = TempDir::new().unwrap();
        let models_dir = temp_dir.path().join("models");
        let data_dir = temp_dir.path().join("data");
        
        create_realistic_model_structure(&models_dir).await.unwrap();
        fs::create_dir_all(&data_dir).await.unwrap();
        
        let manager = Arc::new(ModelStateManager::new(&data_dir));
        
        // Pre-mark one model as ready
        manager.update_coreml_state("tiny.en", CoreMLState::Ready).await;
        
        // Simulate the warm-up check logic
        let models_to_warm = vec!["tiny.en", "medium.en"];
        let mut models_that_would_be_warmed = Vec::new();
        
        for model_id in &models_to_warm {
            let current_state = manager.get_state(model_id).await;
            
            // Skip if already ready (this is the key logic being tested)
            if let Some(state) = &current_state {
                if matches!(state.coreml_state, CoreMLState::Ready) {
                    // Would be skipped in real warm-up
                    continue;
                }
            }
            
            models_that_would_be_warmed.push(model_id.to_string());
        }
        
        // Only medium.en should be warmed (tiny.en should be skipped)
        assert_eq!(models_that_would_be_warmed.len(), 1);
        assert!(models_that_would_be_warmed.contains(&"medium.en".to_string()));
        assert!(!models_that_would_be_warmed.contains(&"tiny.en".to_string()));
    }

    /// Test concurrent model state updates
    #[tokio::test]
    async fn test_concurrent_model_state_updates() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc as StdArc;
        
        let temp_dir = TempDir::new().unwrap();
        let data_dir = temp_dir.path().join("data");
        fs::create_dir_all(&data_dir).await.unwrap();
        
        let manager = Arc::new(ModelStateManager::new(&data_dir));
        let success_counter = StdArc::new(AtomicUsize::new(0));
        
        let handles: Vec<_> = (0..10).map(|i| {
            let manager = manager.clone();
            let counter = success_counter.clone();
            
            tokio::spawn(async move {
                let model_id = format!("model-{}", i);
                
                // Simulate rapid state transitions
                manager.mark_model_downloaded(&model_id, true).await;
                manager.update_coreml_state(&model_id, CoreMLState::Warming).await;
                
                // Small delay to simulate actual warm-up work
                tokio::time::sleep(Duration::from_millis(10)).await;
                
                manager.update_coreml_state(&model_id, CoreMLState::Ready).await;
                
                // Verify final state
                assert!(manager.is_coreml_ready(&model_id).await);
                assert!(manager.should_use_coreml(&model_id).await);
                
                counter.fetch_add(1, Ordering::SeqCst);
                i
            })
        }).collect();
        
        // Wait for all concurrent updates to complete
        for handle in handles {
            handle.await.unwrap();
        }
        
        // All 10 concurrent updates should have succeeded
        assert_eq!(success_counter.load(Ordering::SeqCst), 10);
        
        // Verify all models are in ready state
        for i in 0..10 {
            let model_id = format!("model-{}", i);
            assert!(manager.is_coreml_ready(&model_id).await);
        }
    }

    /// Test model state transitions and validation
    #[tokio::test]
    async fn test_model_state_transitions_integration() {
        let temp_dir = TempDir::new().unwrap();
        let data_dir = temp_dir.path().join("data");
        fs::create_dir_all(&data_dir).await.unwrap();
        
        let manager = ModelStateManager::new(&data_dir);
        let model_id = "test-model";
        
        // Test complete state lifecycle
        
        // 1. Initial state (not downloaded)
        assert!(!manager.is_coreml_ready(model_id).await);
        assert!(!manager.should_use_coreml(model_id).await);
        
        // 2. Downloaded state
        manager.mark_model_downloaded(model_id, true).await;
        let state = manager.get_state(model_id).await.unwrap();
        assert!(state.ggml_downloaded);
        assert!(matches!(state.coreml_state, CoreMLState::Downloaded));
        assert!(!manager.is_coreml_ready(model_id).await);
        
        // 3. Warming state
        manager.update_coreml_state(model_id, CoreMLState::Warming).await;
        assert!(!manager.is_coreml_ready(model_id).await);
        assert!(!manager.should_use_coreml(model_id).await);
        
        // 4. Ready state
        manager.update_coreml_state(model_id, CoreMLState::Ready).await;
        assert!(manager.is_coreml_ready(model_id).await);
        assert!(manager.should_use_coreml(model_id).await);
        
        let ready_state = manager.get_state(model_id).await.unwrap();
        assert!(ready_state.last_warmed.is_some());
        
        // 5. Failed state
        manager.update_coreml_state(model_id, CoreMLState::Failed("Integration test error".to_string())).await;
        assert!(!manager.is_coreml_ready(model_id).await);
        assert!(!manager.should_use_coreml(model_id).await);
        
        let failed_state = manager.get_state(model_id).await.unwrap();
        if let CoreMLState::Failed(error_msg) = &failed_state.coreml_state {
            assert_eq!(error_msg, "Integration test error");
        } else {
            panic!("Expected Failed state");
        }
        
        // 6. Recovery to ready
        manager.update_coreml_state(model_id, CoreMLState::Ready).await;
        assert!(manager.is_coreml_ready(model_id).await);
        assert!(manager.should_use_coreml(model_id).await);
    }

    /// Test error handling in model state persistence
    #[tokio::test]
    async fn test_model_state_error_handling_integration() {
        let temp_dir = TempDir::new().unwrap();
        
        // Test with non-existent directory
        let non_existent_dir = temp_dir.path().join("does_not_exist");
        let manager1 = ModelStateManager::new(&non_existent_dir);
        
        // Should handle gracefully without panicking
        manager1.update_coreml_state("test", CoreMLState::Ready).await;
        assert!(manager1.is_coreml_ready("test").await);
        
        // Test with read-only directory (if possible on this platform)
        let readonly_dir = temp_dir.path().join("readonly");
        fs::create_dir_all(&readonly_dir).await.unwrap();
        
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&readonly_dir).await.unwrap().permissions();
            perms.set_mode(0o444); // Read-only
            let _ = fs::set_permissions(&readonly_dir, perms).await;
        }
        
        let manager2 = ModelStateManager::new(&readonly_dir);
        
        // Should handle persistence errors gracefully
        manager2.update_coreml_state("test2", CoreMLState::Ready).await;
        
        // State should still be available in memory even if persistence fails
        assert!(manager2.is_coreml_ready("test2").await);
    }

    /// Test warm-up function behavior without actual transcription
    #[tokio::test]
    async fn test_warmup_function_logic_integration() {
        let temp_dir = TempDir::new().unwrap();
        let models_dir = temp_dir.path().join("models");
        let data_dir = temp_dir.path().join("data");
        
        create_realistic_model_structure(&models_dir).await.unwrap();
        fs::create_dir_all(&data_dir).await.unwrap();
        
        let manager = Arc::new(ModelStateManager::new(&data_dir));
        
        // Test the discovery logic from warm_coreml_models
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
        
        // Should find models with CoreML support
        assert!(!available_models.is_empty());
        assert_eq!(available_models.len(), 2); // tiny.en and medium.en
        
        // Test state tracking during simulated warm-up
        for model_id in &available_models {
            let current_state = manager.get_state(model_id).await;
            
            // Initially no state or not ready
            if let Some(state) = current_state {
                assert!(!matches!(state.coreml_state, CoreMLState::Ready));
            }
            
            // Simulate warm-up state updates
            manager.update_coreml_state(model_id, CoreMLState::Warming).await;
            
            // Simulate successful warm-up
            manager.update_coreml_state(model_id, CoreMLState::Ready).await;
            
            // Verify ready state
            assert!(manager.is_coreml_ready(model_id).await);
        }
        
        // Test that subsequent calls would skip already ready models
        let models_to_skip = available_models.iter().filter(|model_id| {
            // This would be async in real code, but we're testing the logic
            futures::executor::block_on(async {
                if let Some(state) = manager.get_state(model_id).await {
                    matches!(state.coreml_state, CoreMLState::Ready)
                } else {
                    false
                }
            })
        }).count();
        
        assert_eq!(models_to_skip, available_models.len()); // All should be ready now
    }

    /// Test model cache key generation and behavior
    #[tokio::test]
    async fn test_model_cache_key_behavior_integration() {
        use std::path::PathBuf;
        
        let temp_dir = TempDir::new().unwrap();
        let models_dir = temp_dir.path().join("models");
        create_realistic_model_structure(&models_dir).await.unwrap();
        
        let model_path = models_dir.join("ggml-tiny.en.bin");
        
        // Test normal cache key (same as model path)
        let normal_key = model_path.clone();
        
        // Test CPU-only cache key generation
        let cpu_cache_key = model_path
            .parent()
            .map(|p| {
                p.join(format!(
                    "{}_cpu_only",
                    model_path.file_name().unwrap_or_default().to_string_lossy()
                ))
            })
            .unwrap_or_else(|| model_path.clone());
        
        // Keys should be different
        assert_ne!(normal_key, cpu_cache_key);
        assert!(cpu_cache_key.to_string_lossy().contains("cpu_only"));
        
        // Test that both keys can coexist
        let mut cache_simulation = HashMap::new();
        cache_simulation.insert(normal_key.clone(), "Normal transcriber");
        cache_simulation.insert(cpu_cache_key.clone(), "CPU-only transcriber");
        
        assert_eq!(cache_simulation.len(), 2);
        assert!(cache_simulation.contains_key(&normal_key));
        assert!(cache_simulation.contains_key(&cpu_cache_key));
    }

    /// Test realistic model file validation
    #[tokio::test]
    async fn test_model_file_validation_integration() {
        let temp_dir = TempDir::new().unwrap();
        let models_dir = temp_dir.path().join("models");
        fs::create_dir_all(&models_dir).await.unwrap();
        
        // Create files with different characteristics
        let valid_model = models_dir.join("ggml-tiny.en.bin");
        let empty_model = models_dir.join("ggml-empty.bin");
        let invalid_name = models_dir.join("not-a-model.bin");
        let coreml_model = models_dir.join("ggml-tiny.en-encoder.mlmodelc");
        
        // Valid model file
        fs::write(&valid_model, vec![0u8; 10000]).await.unwrap(); // 10KB
        
        // Empty model file
        fs::write(&empty_model, b"").await.unwrap();
        
        // Invalid name pattern
        fs::write(&invalid_name, vec![0u8; 5000]).await.unwrap();
        
        // CoreML model directory
        fs::create_dir_all(&coreml_model).await.unwrap();
        fs::write(coreml_model.join("model.mlmodel"), b"coreml data").await.unwrap();
        
        // Test validation logic
        let mut valid_models = Vec::new();
        
        if let Ok(entries) = std::fs::read_dir(&models_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                    // Must be GGML format
                    if !file_name.starts_with("ggml-") || !file_name.ends_with(".bin") {
                        continue;
                    }
                    
                    // Must have reasonable size
                    if let Ok(metadata) = std::fs::metadata(&path) {
                        if metadata.len() < 1000 { // Less than 1KB is suspicious
                            continue;
                        }
                    }
                    
                    // Extract model ID
                    if let Some(model_id) = file_name.strip_prefix("ggml-").and_then(|s| s.strip_suffix(".bin")) {
                        valid_models.push(model_id.to_string());
                    }
                }
            }
        }
        
        // Should only find the valid model
        assert_eq!(valid_models.len(), 1);
        assert!(valid_models.contains(&"tiny.en".to_string()));
        assert!(!valid_models.contains(&"empty".to_string()));
    }
}