use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub active_model_id: String,
    #[serde(default)]
    pub model_preferences: serde_json::Value, // For future extensibility
}

impl Default for ModelConfig {
    fn default() -> Self {
        Self {
            active_model_id: "base.en".to_string(),
            model_preferences: serde_json::json!({}),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisperModel {
    pub id: String,
    pub name: String,
    pub size_mb: u32,
    pub description: String,
    pub url: String,
    pub filename: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coreml_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coreml_filename: Option<String>,
    pub speed: String,
    pub accuracy: String,
    pub downloaded: bool,
    #[serde(default)]
    pub coreml_downloaded: bool,
    pub active: bool,
}

impl WhisperModel {
    pub fn all(models_dir: &Path, settings: &crate::settings::AppSettings) -> Vec<Self> {
        let mut models = vec![
            WhisperModel {
                id: "tiny.en".to_string(),
                name: "Tiny English".to_string(),
                size_mb: 39,
                description: "Fastest model, good for quick drafts".to_string(),
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin".to_string(),
                filename: "ggml-tiny.en.bin".to_string(),
                coreml_url: Some("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-encoder.mlmodelc.zip?download=true".to_string()),
                coreml_filename: Some("ggml-tiny.en-encoder.mlmodelc".to_string()),
                speed: "~10x realtime".to_string(),
                accuracy: "Basic (WER ~15%)".to_string(),
                downloaded: false,
                coreml_downloaded: false,
                active: false,
            },
            WhisperModel {
                id: "base.en".to_string(),
                name: "Base English".to_string(),
                size_mb: 142,
                description: "Good balance of speed and accuracy".to_string(),
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin".to_string(),
                filename: "ggml-base.en.bin".to_string(),
                coreml_url: Some("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-encoder.mlmodelc.zip?download=true".to_string()),
                coreml_filename: Some("ggml-base.en-encoder.mlmodelc".to_string()),
                speed: "~5x realtime".to_string(),
                accuracy: "Good (WER ~10%)".to_string(),
                downloaded: false,
                coreml_downloaded: false,
                active: false,
            },
            WhisperModel {
                id: "small.en".to_string(),
                name: "Small English".to_string(),
                size_mb: 466,
                description: "Better accuracy, handles accents and noise well".to_string(),
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin".to_string(),
                filename: "ggml-small.en.bin".to_string(),
                coreml_url: Some("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-encoder.mlmodelc.zip?download=true".to_string()),
                coreml_filename: Some("ggml-small.en-encoder.mlmodelc".to_string()),
                speed: "~3x realtime".to_string(),
                accuracy: "Very Good (WER ~7%)".to_string(),
                downloaded: false,
                coreml_downloaded: false,
                active: false,
            },
            WhisperModel {
                id: "medium.en".to_string(),
                name: "Medium English".to_string(),
                size_mb: 1533,
                description: "Excellent accuracy for professional use".to_string(),
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin".to_string(),
                filename: "ggml-medium.en.bin".to_string(),
                coreml_url: Some("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en-encoder.mlmodelc.zip?download=true".to_string()),
                coreml_filename: Some("ggml-medium.en-encoder.mlmodelc".to_string()),
                speed: "~1x realtime".to_string(),
                accuracy: "Excellent (WER ~5%)".to_string(),
                downloaded: false,
                coreml_downloaded: false,
                active: false,
            },
            WhisperModel {
                id: "large-v3-turbo".to_string(),
                name: "Large v3 Turbo".to_string(),
                size_mb: 1644,
                description: "Optimized for speed with near-large accuracy".to_string(),
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin".to_string(),
                filename: "ggml-large-v3-turbo.bin".to_string(),
                coreml_url: Some("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-encoder.mlmodelc.zip?download=true".to_string()),
                coreml_filename: Some("ggml-large-v3-turbo-encoder.mlmodelc".to_string()),
                speed: "~2x realtime".to_string(),
                accuracy: "Excellent (WER ~5%)".to_string(),
                downloaded: false,
                coreml_downloaded: false,
                active: false,
            },
            WhisperModel {
                id: "large-v3".to_string(),
                name: "Large v3".to_string(),
                size_mb: 3094,
                description: "State-of-the-art accuracy, multilingual".to_string(),
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin".to_string(),
                filename: "ggml-large-v3.bin".to_string(),
                coreml_url: Some("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-encoder.mlmodelc.zip?download=true".to_string()),
                coreml_filename: Some("ggml-large-v3-encoder.mlmodelc".to_string()),
                speed: "~0.5x realtime".to_string(),
                accuracy: "Best (WER ~3%)".to_string(),
                downloaded: false,
                coreml_downloaded: false,
                active: false,
            },
        ];

        // Add any custom models found in the models directory
        if let Ok(entries) = fs::read_dir(models_dir) {
            for entry in entries.flatten() {
                if let Some(filename) = entry.file_name().to_str() {
                    // Check if it's a .bin file and not already in our list
                    if filename.ends_with(".bin") && !models.iter().any(|m| m.filename == filename)
                    {
                        // This is a custom model
                        let id = format!("custom_{}", filename.trim_end_matches(".bin"));
                        let file_size = entry
                            .metadata()
                            .ok()
                            .map(|m| m.len() / 1_048_576)
                            .unwrap_or(0) as u32;

                        models.push(WhisperModel {
                            id: id.clone(),
                            name: format!("Custom: {}", filename),
                            size_mb: file_size,
                            description: "User-provided custom model".to_string(),
                            url: String::new(), // No URL for custom models
                            filename: filename.to_string(),
                            coreml_url: None,
                            coreml_filename: None,
                            speed: "Unknown".to_string(),
                            accuracy: "Unknown".to_string(),
                            downloaded: true, // Already exists
                            coreml_downloaded: false,
                            active: false,
                        });
                    }
                }
            }
        }

        // Check which models are downloaded and which is active
        let active_model = Self::get_active_model_id(settings);

        models
            .into_iter()
            .map(|mut model| {
                let model_path = models_dir.join(&model.filename);
                model.downloaded = model_path.exists();

                // Check if Core ML model is downloaded (only on macOS)
                #[cfg(target_os = "macos")]
                if let Some(ref coreml_filename) = model.coreml_filename {
                    let coreml_path = models_dir.join(coreml_filename);
                    model.coreml_downloaded = coreml_path.exists();
                }

                model.active = Some(&model.id) == active_model.as_ref();
                model
            })
            .collect()
    }

    pub fn get_active_model_id(settings: &crate::settings::AppSettings) -> Option<String> {
        Some(settings.models.active_model_id.clone())
    }

    pub fn get_active_model_path(
        models_dir: &Path,
        settings: &crate::settings::AppSettings,
    ) -> PathBuf {
        let model_id = Self::get_active_model_id(settings).unwrap_or_else(|| "tiny.en".to_string());

        let models = Self::all(models_dir, settings);

        // First try to find the requested model
        if let Some(model) = models.iter().find(|m| m.id == model_id && m.downloaded) {
            let path = models_dir.join(&model.filename);
            return path;
        }

        // Fallback to any available model
        if let Some(model) = models.iter().find(|m| m.downloaded) {
            let path = models_dir.join(&model.filename);
            return path;
        }

        // Last resort - return expected path even if not downloaded
        let fallback = models_dir.join("ggml-tiny.en.bin");
        fallback
    }
}
