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
            states.insert(
                model_id.to_string(),
                ModelState {
                    model_id: model_id.to_string(),
                    ggml_downloaded: true, // Assume true if we're updating CoreML state
                    coreml_state: state,
                    last_warmed: None,
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
}

// Background warmer that runs on startup
pub async fn warm_coreml_models(model_state_manager: Arc<ModelStateManager>, models_dir: PathBuf) {
    info(
        Component::Models,
        "Starting background Core ML model warming",
    );

    // Get all models that have Core ML downloaded but not warmed
    let states = model_state_manager.states.read().await.clone();

    for (model_id, state) in states {
        if matches!(state.coreml_state, CoreMLState::Downloaded) {
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
                match warm_single_model(&model_id_clone, &models_dir_clone).await {
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
}

async fn warm_single_model(model_id: &str, models_dir: &Path) -> Result<(), String> {
    use crate::transcription::Transcriber;

    let model_path = models_dir.join(format!("ggml-{}.bin", model_id));
    if !model_path.exists() {
        return Err(format!("Model file not found: {:?}", model_path));
    }

    // Create a transcriber instance to warm up Core ML
    let transcriber = Transcriber::new(&model_path)?;

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

    // Run transcription to warm up Core ML
    let _ = transcriber.transcribe(&temp_path)?;

    // Clean up
    let _ = std::fs::remove_file(&temp_path);

    Ok(())
}
