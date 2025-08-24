use crate::logger::{info, warn, Component};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CoreMLState {
    NotDownloaded,
    Downloaded,
    Warming,
    Ready,
    Failed(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelState {
    pub model_id: String,
    pub ggml_downloaded: bool,
    pub coreml_state: CoreMLState,
    pub last_warmed: Option<String>,
}

pub struct ModelStateManager {
    states: Arc<RwLock<HashMap<String, ModelState>>>,
    state_file: PathBuf,
}

impl ModelStateManager {
    pub fn new(data_dir: &Path) -> Self {
        let state_file = data_dir.join("model_states.json");
        let mut manager = Self {
            states: Arc::new(RwLock::new(HashMap::new())),
            state_file,
        };

        // Load existing states
        if let Ok(contents) = std::fs::read_to_string(&manager.state_file) {
            if let Ok(states) = serde_json::from_str::<HashMap<String, ModelState>>(&contents) {
                manager.states = Arc::new(RwLock::new(states));
                info(Component::Models, "Loaded model states from disk");
            }
        }

        manager
    }

    pub async fn get_state(&self, model_id: &str) -> Option<ModelState> {
        self.states.read().await.get(model_id).cloned()
    }

    pub async fn update_coreml_state(&self, model_id: &str, state: CoreMLState) {
        let mut states = self.states.write().await;

        if let Some(model_state) = states.get_mut(model_id) {
            model_state.coreml_state = state.clone();
            if matches!(state, CoreMLState::Ready) {
                model_state.last_warmed = Some(chrono::Local::now().to_rfc3339());
            }
        } else {
            let last_warmed = if matches!(state, CoreMLState::Ready) {
                Some(chrono::Local::now().to_rfc3339())
            } else {
                None
            };
            
            states.insert(
                model_id.to_string(),
                ModelState {
                    model_id: model_id.to_string(),
                    ggml_downloaded: true, // Assume true if we're updating CoreML state
                    coreml_state: state,
                    last_warmed,
                },
            );
        }

        // Save to disk
        self.persist_states(&states).await;
    }

    pub async fn is_coreml_ready(&self, model_id: &str) -> bool {
        if let Some(state) = self.get_state(model_id).await {
            matches!(state.coreml_state, CoreMLState::Ready)
        } else {
            false
        }
    }

    pub async fn should_use_coreml(&self, model_id: &str) -> bool {
        // Only use Core ML if it's ready
        self.is_coreml_ready(model_id).await
    }

    async fn persist_states(&self, states: &HashMap<String, ModelState>) {
        if let Ok(json) = serde_json::to_string_pretty(states) {
            let _ = tokio::fs::write(&self.state_file, json).await;
        }
    }

    pub async fn mark_model_downloaded(&self, model_id: &str, has_coreml: bool) {
        let mut states = self.states.write().await;

        let coreml_state = if has_coreml {
            CoreMLState::Downloaded
        } else {
            CoreMLState::NotDownloaded
        };

        states.insert(
            model_id.to_string(),
            ModelState {
                model_id: model_id.to_string(),
                ggml_downloaded: true,
                coreml_state,
                last_warmed: None,
            },
        );

        self.persist_states(&states).await;
    }
    
    pub async fn mark_coreml_downloaded(&self, model_id: &str) {
        let mut states = self.states.write().await;
        
        if let Some(state) = states.get_mut(model_id) {
            state.coreml_state = CoreMLState::Downloaded;
            self.persist_states(&states).await;
            info(Component::Models, &format!("Marked CoreML as downloaded for model: {}", model_id));
        } else {
            warn(Component::Models, &format!("Attempted to mark CoreML downloaded for unknown model: {}", model_id));
        }
    }
    
    /// Check if any model is currently warming up Core ML
    pub async fn is_any_model_warming(&self) -> bool {
        let states = self.states.read().await;
        states.values().any(|state| matches!(state.coreml_state, CoreMLState::Warming))
    }
    
    /// Get list of models that are currently warming up
    pub async fn get_warming_models(&self) -> Vec<String> {
        let states = self.states.read().await;
        states
            .iter()
            .filter(|(_, state)| matches!(state.coreml_state, CoreMLState::Warming))
            .map(|(id, _)| id.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tokio::fs;

    /// Test that ModelStateManager can be created and loads empty state initially
    #[tokio::test]
    async fn test_model_state_manager_creation() {
        let temp_dir = TempDir::new().unwrap();
        let manager = ModelStateManager::new(temp_dir.path());
        
        // Should return None for non-existent model
        let state = manager.get_state("non-existent").await;
        assert!(state.is_none());
        
        // Should not be ready for non-existent model
        assert!(!manager.is_coreml_ready("non-existent").await);
        assert!(!manager.should_use_coreml("non-existent").await);
    }

    /// Test that model state can be updated and persisted
    #[tokio::test]
    async fn test_model_state_update_and_persistence() {
        let temp_dir = TempDir::new().unwrap();
        let manager = ModelStateManager::new(temp_dir.path());
        
        // Update state for a model
        manager.update_coreml_state("test-model", CoreMLState::Ready).await;
        
        // Should be able to retrieve the state
        let state = manager.get_state("test-model").await;
        assert!(state.is_some());
        let state = state.unwrap();
        assert_eq!(state.model_id, "test-model");
        assert!(matches!(state.coreml_state, CoreMLState::Ready));
        assert!(state.last_warmed.is_some());
        
        // Should be ready now
        assert!(manager.is_coreml_ready("test-model").await);
        assert!(manager.should_use_coreml("test-model").await);
        
        // Create a new manager pointing to same directory - should load persisted state
        let manager2 = ModelStateManager::new(temp_dir.path());
        let state2 = manager2.get_state("test-model").await;
        assert!(state2.is_some());
        assert!(manager2.is_coreml_ready("test-model").await);
    }

    /// Test different CoreML states
    #[tokio::test]
    async fn test_coreml_state_transitions() {
        let temp_dir = TempDir::new().unwrap();
        let manager = ModelStateManager::new(temp_dir.path());
        
        // Start with NotDownloaded
        manager.update_coreml_state("test", CoreMLState::NotDownloaded).await;
        assert!(!manager.is_coreml_ready("test").await);
        assert!(!manager.should_use_coreml("test").await);
        
        // Move to Downloaded
        manager.update_coreml_state("test", CoreMLState::Downloaded).await;
        assert!(!manager.is_coreml_ready("test").await);
        assert!(!manager.should_use_coreml("test").await);
        
        // Move to Warming
        manager.update_coreml_state("test", CoreMLState::Warming).await;
        assert!(!manager.is_coreml_ready("test").await);
        assert!(!manager.should_use_coreml("test").await);
        
        // Move to Ready
        manager.update_coreml_state("test", CoreMLState::Ready).await;
        assert!(manager.is_coreml_ready("test").await);
        assert!(manager.should_use_coreml("test").await);
        
        // Move to Failed
        manager.update_coreml_state("test", CoreMLState::Failed("Test error".to_string())).await;
        assert!(!manager.is_coreml_ready("test").await);
        assert!(!manager.should_use_coreml("test").await);
    }

    /// Test model marking as downloaded
    #[tokio::test]
    async fn test_mark_model_downloaded() {
        let temp_dir = TempDir::new().unwrap();
        let manager = ModelStateManager::new(temp_dir.path());
        
        // Mark model as downloaded with CoreML
        manager.mark_model_downloaded("test-with-coreml", true).await;
        let state = manager.get_state("test-with-coreml").await.unwrap();
        assert!(state.ggml_downloaded);
        assert!(matches!(state.coreml_state, CoreMLState::Downloaded));
        
        // Mark model as downloaded without CoreML
        manager.mark_model_downloaded("test-without-coreml", false).await;
        let state = manager.get_state("test-without-coreml").await.unwrap();
        assert!(state.ggml_downloaded);
        assert!(matches!(state.coreml_state, CoreMLState::NotDownloaded));
    }

    /// Create test model files in a directory
    async fn create_test_model_files(models_dir: &Path) -> Result<(), std::io::Error> {
        fs::create_dir_all(models_dir).await?;
        
        // Create GGML models
        fs::write(models_dir.join("ggml-tiny.en.bin"), b"mock tiny model").await?;
        fs::write(models_dir.join("ggml-base.en.bin"), b"mock base model").await?;
        fs::write(models_dir.join("ggml-medium.en.bin"), b"mock medium model").await?;
        
        // Create CoreML models for some of them
        fs::create_dir_all(models_dir.join("ggml-tiny.en-encoder.mlmodelc")).await?;
        fs::write(models_dir.join("ggml-tiny.en-encoder.mlmodelc/model.mlmodel"), b"mock coreml").await?;
        
        fs::create_dir_all(models_dir.join("ggml-medium.en-encoder.mlmodelc")).await?;
        fs::write(models_dir.join("ggml-medium.en-encoder.mlmodelc/model.mlmodel"), b"mock coreml").await?;
        
        Ok(())
    }

    /// Test warm-up discovery of available models
    #[tokio::test]
    async fn test_warm_coreml_models_discovery() {
        let temp_dir = TempDir::new().unwrap();
        let models_dir = temp_dir.path().join("models");
        create_test_model_files(&models_dir).await.unwrap();
        
        let manager = Arc::new(ModelStateManager::new(temp_dir.path()));
        
        // Mock the warm-up function by calling the discovery logic
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

    /// Test that already ready models are skipped during warm-up
    #[tokio::test]
    async fn test_warm_coreml_models_skip_ready() {
        let temp_dir = TempDir::new().unwrap();
        let models_dir = temp_dir.path().join("models");
        create_test_model_files(&models_dir).await.unwrap();
        
        let manager = Arc::new(ModelStateManager::new(temp_dir.path()));
        
        // Mark one model as already ready
        manager.update_coreml_state("tiny.en", CoreMLState::Ready).await;
        
        // Test the logic that checks if a model should be skipped
        let tiny_state = manager.get_state("tiny.en").await;
        let medium_state = manager.get_state("medium.en").await;
        
        // Tiny should be skipped (already ready)
        if let Some(state) = &tiny_state {
            assert!(matches!(state.coreml_state, CoreMLState::Ready));
        }
        
        // Medium should not be skipped (not ready yet)
        if let Some(state) = &medium_state {
            assert!(!matches!(state.coreml_state, CoreMLState::Ready));
        } else {
            // Medium doesn't have state yet, so it should be warmed
            assert!(medium_state.is_none());
        }
    }

    /// Test CoreMLState serialization/deserialization
    #[test]
    fn test_coreml_state_serialization() {
        let states = vec![
            CoreMLState::NotDownloaded,
            CoreMLState::Downloaded,
            CoreMLState::Warming,
            CoreMLState::Ready,
            CoreMLState::Failed("Test error".to_string()),
        ];
        
        for state in states {
            let json = serde_json::to_string(&state).unwrap();
            let deserialized: CoreMLState = serde_json::from_str(&json).unwrap();
            
            match (&state, &deserialized) {
                (CoreMLState::NotDownloaded, CoreMLState::NotDownloaded) => (),
                (CoreMLState::Downloaded, CoreMLState::Downloaded) => (),
                (CoreMLState::Warming, CoreMLState::Warming) => (),
                (CoreMLState::Ready, CoreMLState::Ready) => (),
                (CoreMLState::Failed(msg1), CoreMLState::Failed(msg2)) => assert_eq!(msg1, msg2),
                _ => panic!("Serialization round-trip failed"),
            }
        }
    }

    /// Test ModelState serialization/deserialization
    #[test]
    fn test_model_state_serialization() {
        let state = ModelState {
            model_id: "test-model".to_string(),
            ggml_downloaded: true,
            coreml_state: CoreMLState::Ready,
            last_warmed: Some("2023-01-01T00:00:00Z".to_string()),
        };
        
        let json = serde_json::to_string(&state).unwrap();
        let deserialized: ModelState = serde_json::from_str(&json).unwrap();
        
        assert_eq!(state.model_id, deserialized.model_id);
        assert_eq!(state.ggml_downloaded, deserialized.ggml_downloaded);
        assert_eq!(state.last_warmed, deserialized.last_warmed);
        
        match (&state.coreml_state, &deserialized.coreml_state) {
            (CoreMLState::Ready, CoreMLState::Ready) => (),
            _ => panic!("CoreML state serialization failed"),
        }
    }

    /// Test concurrent access to ModelStateManager
    #[tokio::test]
    async fn test_concurrent_model_state_access() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc as StdArc;
        
        let temp_dir = TempDir::new().unwrap();
        let manager = Arc::new(ModelStateManager::new(temp_dir.path()));
        let counter = StdArc::new(AtomicUsize::new(0));
        
        let handles: Vec<_> = (0..10).map(|i| {
            let manager = manager.clone();
            let counter = counter.clone();
            
            tokio::spawn(async move {
                let model_id = format!("model-{}", i);
                
                // Update state concurrently
                manager.update_coreml_state(&model_id, CoreMLState::Ready).await;
                
                // Verify state was set
                let state = manager.get_state(&model_id).await;
                assert!(state.is_some());
                assert!(manager.is_coreml_ready(&model_id).await);
                
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
        
        // Verify all models are in the state
        for i in 0..10 {
            let model_id = format!("model-{}", i);
            assert!(manager.is_coreml_ready(&model_id).await);
        }
    }

    /// Test error handling in model state persistence
    #[tokio::test]
    async fn test_model_state_persistence_error_handling() {
        // Use a read-only directory to force persistence errors
        let temp_dir = TempDir::new().unwrap();
        let readonly_dir = temp_dir.path().join("readonly");
        fs::create_dir_all(&readonly_dir).await.unwrap();
        
        // Set read-only permissions (this may not work on all platforms, so we'll just test)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&readonly_dir).await.unwrap().permissions();
            perms.set_mode(0o444); // Read-only
            fs::set_permissions(&readonly_dir, perms).await.unwrap();
        }
        
        let manager = ModelStateManager::new(&readonly_dir);
        
        // This should not panic even if persistence fails
        manager.update_coreml_state("test", CoreMLState::Ready).await;
        
        // State should still be available in memory
        assert!(manager.is_coreml_ready("test").await);
    }
}

// Background warmer that runs on startup
pub async fn warm_coreml_models(model_state_manager: Arc<ModelStateManager>, models_dir: PathBuf) {
    info(
        Component::Models,
        "Starting background Core ML model warming",
    );

    // Discover all available models in the models directory
    let mut available_models = Vec::new();
    
    if let Ok(entries) = std::fs::read_dir(&models_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                // Look for GGML model files (ggml-{model-id}.bin)
                if file_name.starts_with("ggml-") && file_name.ends_with(".bin") {
                    if let Some(model_id) = file_name.strip_prefix("ggml-").and_then(|s| s.strip_suffix(".bin")) {
                        // Check if corresponding Core ML model exists
                        let coreml_path = models_dir.join(format!("ggml-{}-encoder.mlmodelc", model_id));
                        if coreml_path.exists() {
                            available_models.push(model_id.to_string());
                            info(
                                Component::Models,
                                &format!("Found model with Core ML support: {}", model_id),
                            );
                        } else {
                            info(
                                Component::Models,
                                &format!("Found model without Core ML support: {}", model_id),
                            );
                        }
                    }
                }
            }
        }
    }

    if available_models.is_empty() {
        warn(
            Component::Models,
            "No models with Core ML support found for warming",
        );
        return;
    }

    info(
        Component::Models,
        &format!("Found {} models with Core ML support to warm", available_models.len()),
    );

    // Warm each available model that isn't already ready
    for model_id in available_models {
        let current_state = model_state_manager.get_state(&model_id).await;
        
        // Skip if already ready
        if let Some(state) = &current_state {
            if matches!(state.coreml_state, CoreMLState::Ready) {
                info(
                    Component::Models,
                    &format!("Core ML already ready for model: {}, skipping warm-up", model_id),
                );
                continue;
            }
        }

        info(
            Component::Models,
            &format!("Warming Core ML for model: {}", model_id),
        );

        // Update state to warming
        model_state_manager
            .update_coreml_state(&model_id, CoreMLState::Warming)
            .await;

        // Clone for the spawned task
        let model_id_clone = model_id.clone();
        let models_dir_clone = models_dir.clone();
        let manager_clone = model_state_manager.clone();

        // Spawn a task to warm this model
        tokio::spawn(async move {
            match warm_single_model(&model_id_clone, &models_dir_clone, Some(manager_clone.clone())).await {
                Ok(_) => {
                    info(
                        Component::Models,
                        &format!("Successfully warmed Core ML for: {}", model_id_clone),
                    );
                    manager_clone
                        .update_coreml_state(&model_id_clone, CoreMLState::Ready)
                        .await;
                }
                Err(e) => {
                    warn(
                        Component::Models,
                        &format!("Failed to warm Core ML for {}: {}", model_id_clone, e),
                    );
                    manager_clone
                        .update_coreml_state(&model_id_clone, CoreMLState::Failed(e))
                        .await;
                }
            }
        });
    }
}

async fn warm_single_model(
    model_id: &str,
    models_dir: &Path,
    _model_state_manager: Option<Arc<ModelStateManager>>,
) -> Result<(), String> {
    use crate::transcription::Transcriber;

    let model_path = models_dir.join(format!("ggml-{}.bin", model_id));
    if !model_path.exists() {
        return Err(format!("Model file not found: {:?}", model_path));
    }

    info(
        Component::Models,
        &format!("Warming Core ML for model: {} at {:?}", model_id, model_path),
    );

    // Use the cached transcriber system to properly initialize Core ML
    // For warm-up, we want to force Core ML initialization even if not marked as ready yet
    // This is different from normal transcription which checks readiness first
    let transcriber_arc = Transcriber::get_or_create_cached(&model_path).await?;

    // Create a small sample of silence to run through the model
    let sample_rate = 16000;
    let duration_secs = 1;
    let silence: Vec<f32> = vec![0.0; sample_rate * duration_secs];

    // Create a temporary WAV file
    let temp_dir = std::env::temp_dir();
    let temp_path = temp_dir.join(format!("scout_warmup_{}.wav", model_id));

    // Write silence to WAV
    use hound::{WavSpec, WavWriter};
    let spec = WavSpec {
        channels: 1,
        sample_rate: sample_rate as u32,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };

    let mut writer = WavWriter::create(&temp_path, spec)
        .map_err(|e| format!("Failed to create temp WAV: {}", e))?;

    for sample in &silence {
        writer
            .write_sample(*sample)
            .map_err(|e| format!("Failed to write sample: {}", e))?;
    }

    writer
        .finalize()
        .map_err(|e| format!("Failed to finalize WAV: {}", e))?;

    info(
        Component::Models,
        &format!("Running warm-up transcription for model: {}", model_id),
    );

    // Run transcription to warm up Core ML - this locks the transcriber to ensure exclusive access
    let transcriber = transcriber_arc.lock().await;
    let transcription_result = transcriber.transcribe(&temp_path);

    // Release the lock before cleanup
    drop(transcriber);

    // Clean up temp file
    let _ = std::fs::remove_file(&temp_path);

    // Check transcription result
    match transcription_result {
        Ok(_) => {
            info(
                Component::Models,
                &format!("Core ML warm-up completed successfully for model: {}", model_id),
            );
        }
        Err(e) => {
            return Err(format!("Core ML warm-up failed for {}: {}", model_id, e));
        }
    }

    Ok(())
}
