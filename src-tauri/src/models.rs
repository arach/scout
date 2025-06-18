use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisperModel {
    pub id: String,
    pub name: String,
    pub size_mb: u32,
    pub description: String,
    pub url: String,
    pub filename: String,
    pub speed: String,
    pub accuracy: String,
    pub downloaded: bool,
    pub active: bool,
}

impl WhisperModel {
    pub fn all(models_dir: &Path) -> Vec<Self> {
        let models = vec![
            WhisperModel {
                id: "tiny.en".to_string(),
                name: "Tiny English".to_string(),
                size_mb: 39,
                description: "Fastest model, good for quick drafts".to_string(),
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin".to_string(),
                filename: "ggml-tiny.en.bin".to_string(),
                speed: "~10x realtime".to_string(),
                accuracy: "Basic (WER ~15%)".to_string(),
                downloaded: false,
                active: false,
            },
            WhisperModel {
                id: "base.en".to_string(),
                name: "Base English".to_string(),
                size_mb: 142,
                description: "Good balance of speed and accuracy".to_string(),
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin".to_string(),
                filename: "ggml-base.en.bin".to_string(),
                speed: "~5x realtime".to_string(),
                accuracy: "Good (WER ~10%)".to_string(),
                downloaded: false,
                active: false,
            },
            WhisperModel {
                id: "small.en".to_string(),
                name: "Small English".to_string(),
                size_mb: 466,
                description: "Better accuracy, handles accents and noise well".to_string(),
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin".to_string(),
                filename: "ggml-small.en.bin".to_string(),
                speed: "~3x realtime".to_string(),
                accuracy: "Very Good (WER ~7%)".to_string(),
                downloaded: false,
                active: false,
            },
            WhisperModel {
                id: "medium.en".to_string(),
                name: "Medium English".to_string(),
                size_mb: 1533,
                description: "Excellent accuracy for professional use".to_string(),
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin".to_string(),
                filename: "ggml-medium.en.bin".to_string(),
                speed: "~1x realtime".to_string(),
                accuracy: "Excellent (WER ~5%)".to_string(),
                downloaded: false,
                active: false,
            },
            WhisperModel {
                id: "large-v3".to_string(),
                name: "Large v3".to_string(),
                size_mb: 3094,
                description: "State-of-the-art accuracy, multilingual".to_string(),
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin".to_string(),
                filename: "ggml-large-v3.bin".to_string(),
                speed: "~0.5x realtime".to_string(),
                accuracy: "Best (WER ~3%)".to_string(),
                downloaded: false,
                active: false,
            },
        ];

        // Check which models are downloaded and which is active
        let active_model = Self::get_active_model_id();
        
        models.into_iter().map(|mut model| {
            let model_path = models_dir.join(&model.filename);
            model.downloaded = model_path.exists();
            model.active = Some(&model.id) == active_model.as_ref();
            model
        }).collect()
    }

    pub fn get_active_model_id() -> Option<String> {
        // Read from a config file or use default
        if let Ok(contents) = fs::read_to_string(Self::config_path()) {
            contents.trim().parse().ok()
        } else {
            Some("base.en".to_string()) // Default
        }
    }

    pub fn set_active_model(model_id: &str) -> Result<(), String> {
        fs::write(Self::config_path(), model_id)
            .map_err(|e| format!("Failed to save active model: {}", e))
    }

    fn config_path() -> PathBuf {
        // Store in app data directory
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("scout")
            .join("active_model.txt")
    }

    pub fn get_active_model_path(models_dir: &Path) -> PathBuf {
        let model_id = Self::get_active_model_id().unwrap_or_else(|| "base.en".to_string());
        let models = Self::all(models_dir);
        
        models.iter()
            .find(|m| m.id == model_id)
            .map(|m| models_dir.join(&m.filename))
            .unwrap_or_else(|| models_dir.join("ggml-base.en.bin"))
    }
}