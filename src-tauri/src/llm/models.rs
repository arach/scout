use crate::logger::{info, Component};
use anyhow::{anyhow, Result as AnyhowResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LLMModel {
    pub id: String,
    pub name: String,
    pub size_mb: u32,
    pub parameters: String,
    pub description: String,
    pub model_url: String,
    pub tokenizer_url: String,
    pub filename: String,
    pub speed: String,
    pub context_length: u32,
    pub downloaded: bool,
    pub active: bool,
}

impl LLMModel {
    pub fn all(models_dir: &Path, active_model_id: &str) -> Vec<Self> {
        let mut models = vec![
            // Phi-2 Q4 - Best tiny model with smart output
            LLMModel {
                id: "phi-2-q4".to_string(),
                name: "Phi-2 Q4".to_string(),
                size_mb: 1700,  // ~1.7GB for Q4
                parameters: "2.7B".to_string(),
                description: "Best tiny model with smart output - Microsoft".to_string(),
                model_url: "https://huggingface.co/TheBloke/phi-2-GGUF/resolve/main/phi-2.Q4_K_M.gguf".to_string(),
                tokenizer_url: "https://huggingface.co/microsoft/phi-2/resolve/main/tokenizer.json".to_string(),
                filename: "phi-2-q4.gguf".to_string(),
                speed: "~60 tokens/sec".to_string(),
                context_length: 2048,
                downloaded: false,
                active: false,
            },
            // StableLM 2 1.6B Q4 - Good alternative to TinyLlama
            LLMModel {
                id: "stablelm-2-1.6b-q4".to_string(),
                name: "StableLM 2 1.6B Q4".to_string(),
                size_mb: 950,  // ~950MB for Q4
                parameters: "1.6B".to_string(),
                description: "Stability AI's efficient instruct model".to_string(),
                model_url: "https://huggingface.co/TheBloke/stablelm-2-1_6b-chat-GGUF/resolve/main/stablelm-2-1_6b-chat.Q4_K_M.gguf".to_string(),
                tokenizer_url: "https://huggingface.co/stabilityai/stablelm-2-1_6b-chat/resolve/main/tokenizer.json".to_string(),
                filename: "stablelm-2-1.6b-q4.gguf".to_string(),
                speed: "~80 tokens/sec".to_string(),
                context_length: 4096,
                downloaded: false,
                active: false,
            },
            // Gemma 2B Q4 - Google's model
            LLMModel {
                id: "gemma-2b-q4".to_string(),
                name: "Gemma 2B Q4".to_string(),
                size_mb: 1500,  // ~1.5GB for Q4
                parameters: "2B".to_string(),
                description: "Google's Gemma - reliable with continued support".to_string(),
                model_url: "https://huggingface.co/TheBloke/gemma-2b-it-GGUF/resolve/main/gemma-2b-it.Q4_K_M.gguf".to_string(),
                tokenizer_url: "https://huggingface.co/google/gemma-2b/resolve/main/tokenizer.json".to_string(),
                filename: "gemma-2b-q4.gguf".to_string(),
                speed: "~70 tokens/sec".to_string(),
                context_length: 8192,
                downloaded: false,
                active: false,
            },
            // Orca-Mini 3B Q4 - Great mid-size option
            LLMModel {
                id: "orca-mini-3b-q4".to_string(),
                name: "Orca Mini 3B Q4".to_string(),
                size_mb: 2000,  // ~2GB for Q4
                parameters: "3B".to_string(),
                description: "Great mid-size model if RAM allows".to_string(),
                model_url: "https://huggingface.co/TheBloke/orca_mini_3B-GGUF/resolve/main/orca_mini_3b.Q4_K_M.gguf".to_string(),
                tokenizer_url: "https://huggingface.co/pankajmathur/orca_mini_3b/resolve/main/tokenizer.json".to_string(),
                filename: "orca-mini-3b-q4.gguf".to_string(),
                speed: "~40 tokens/sec".to_string(),
                context_length: 4096,
                downloaded: false,
                active: false,
            },
            // TinyLlama Q4 - Smallest option
            LLMModel {
                id: "tinyllama-1.1b-q4".to_string(),
                name: "TinyLlama 1.1B Q4".to_string(),
                size_mb: 670,  // ~670MB for Q4
                parameters: "1.1B".to_string(),
                description: "Smallest model - fast and efficient".to_string(),
                model_url: "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf".to_string(),
                tokenizer_url: "https://huggingface.co/TinyLlama/TinyLlama-1.1B-Chat-v1.0/resolve/main/tokenizer.json".to_string(),
                filename: "tinyllama-1.1b-q4.gguf".to_string(),
                speed: "~100 tokens/sec".to_string(),
                context_length: 2048,
                downloaded: false,
                active: false,
            },
            // TinyLlama full precision - SafeTensors format
            LLMModel {
                id: "tinyllama-1.1b".to_string(),
                name: "TinyLlama 1.1B Chat".to_string(),
                size_mb: 2200,
                parameters: "1.1B".to_string(),
                description: "Balanced model for summarization and formatting".to_string(),
                model_url: "https://huggingface.co/TinyLlama/TinyLlama-1.1B-Chat-v1.0/resolve/main/model.safetensors".to_string(),
                tokenizer_url: "https://huggingface.co/TinyLlama/TinyLlama-1.1B-Chat-v1.0/resolve/main/tokenizer.json".to_string(),
                filename: "tinyllama-1.1b.safetensors".to_string(),
                speed: "~50 tokens/sec".to_string(),
                context_length: 2048,
                downloaded: false,
                active: false,
            },
            // NOTE: Models above use GGUF format which requires different loading code
            // TODO: Add GGUF support to use quantized models
        ];

        // Check which models are downloaded and which is active
        models.iter_mut().for_each(|model| {
            let model_path = models_dir.join(&model.filename);
            let tokenizer_path = models_dir.join(format!("{}_tokenizer.json", model.id));
            model.downloaded = model_path.exists() && tokenizer_path.exists();
            model.active = model.id == active_model_id;
        });

        models
    }

    pub fn get_active_model_path(models_dir: &Path, active_model_id: &str) -> Option<PathBuf> {
        let models = Self::all(models_dir, active_model_id);

        models
            .iter()
            .find(|m| m.id == active_model_id && m.downloaded)
            .map(|m| models_dir.join(&m.filename))
    }
}

pub struct ModelManager {
    models_dir: PathBuf,
}

impl ModelManager {
    pub fn new(models_dir: PathBuf) -> Self {
        Self { models_dir }
    }

    pub async fn download_model(&self, model: &LLMModel) -> AnyhowResult<()> {
        self.download_model_with_progress(model, None).await
    }

    pub async fn download_model_with_progress(
        &self,
        model: &LLMModel,
        app_handle: Option<&tauri::AppHandle>,
    ) -> AnyhowResult<()> {
        // Create models directory if it doesn't exist
        fs::create_dir_all(&self.models_dir)?;

        info(
            Component::Processing,
            &format!("Downloading LLM model: {}", model.name),
        );

        // Download model file
        let model_path = self.models_dir.join(&model.filename);
        if !model_path.exists() {
            self.download_file_with_progress(&model.model_url, &model_path, &model.id, app_handle)
                .await?;
        } else {
            info(
                Component::Processing,
                &format!("Model file already exists: {}", model.filename),
            );
        }

        // Download tokenizer
        let tokenizer_path = self.models_dir.join(format!("{}_tokenizer.json", model.id));
        if !tokenizer_path.exists() {
            info(Component::Processing, "Downloading tokenizer...");
            self.download_file(&model.tokenizer_url, &tokenizer_path)
                .await?;
        } else {
            info(Component::Processing, "Tokenizer already exists");
        }

        info(
            Component::Processing,
            &format!("Model {} downloaded successfully", model.name),
        );
        Ok(())
    }

    async fn download_file(&self, url: &str, dest: &Path) -> AnyhowResult<()> {
        use futures_util::StreamExt;
        use std::io::Write;

        info(Component::Processing, &format!("Downloading from: {}", url));

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300)) // 5 minute timeout
            .build()?;

        let response = client
            .get(url)
            .header("User-Agent", "Scout/1.0")
            .send()
            .await
            .map_err(|e| anyhow!("Failed to start download: {}", e))?;

        if !response.status().is_success() {
            return Err(anyhow!(
                "Download failed with status: {}",
                response.status()
            ));
        }

        let total_size = response
            .content_length()
            .ok_or_else(|| anyhow!("Failed to get content length"))?;

        info(
            Component::Processing,
            &format!("File size: {} MB", total_size / (1024 * 1024)),
        );

        let mut file = std::fs::File::create(dest)?;
        let mut downloaded = 0u64;
        let mut stream = response.bytes_stream();
        let mut last_progress = 0;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| anyhow!("Download failed: {}", e))?;
            file.write_all(&chunk)?;
            downloaded += chunk.len() as u64;

            // Log progress every 5%
            let progress = (downloaded as f64 / total_size as f64) * 100.0;
            let progress_int = progress as i32;
            if progress_int >= last_progress + 5 {
                info(
                    Component::Processing,
                    &format!(
                        "Download progress: {:.1}% ({} MB / {} MB)",
                        progress,
                        downloaded / (1024 * 1024),
                        total_size / (1024 * 1024)
                    ),
                );
                last_progress = progress_int;
            }
        }

        file.sync_all()?;
        info(Component::Processing, "Download completed successfully");

        Ok(())
    }

    async fn download_file_with_progress(
        &self,
        url: &str,
        dest: &Path,
        model_id: &str,
        app_handle: Option<&tauri::AppHandle>,
    ) -> AnyhowResult<()> {
        use futures_util::StreamExt;
        use std::io::Write;
        use tauri::Emitter;

        info(Component::Processing, &format!("Downloading from: {}", url));

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300)) // 5 minute timeout
            .build()?;

        let response = client
            .get(url)
            .header("User-Agent", "Scout/1.0")
            .send()
            .await
            .map_err(|e| anyhow!("Failed to start download: {}", e))?;

        if !response.status().is_success() {
            return Err(anyhow!(
                "Download failed with status: {}",
                response.status()
            ));
        }

        let total_size = response
            .content_length()
            .ok_or_else(|| anyhow!("Failed to get content length"))?;

        info(
            Component::Processing,
            &format!("File size: {} MB", total_size / (1024 * 1024)),
        );

        let mut file = std::fs::File::create(dest)?;
        let mut downloaded = 0u64;
        let mut stream = response.bytes_stream();
        let mut last_progress = 0;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| anyhow!("Download failed: {}", e))?;
            file.write_all(&chunk)?;
            downloaded += chunk.len() as u64;

            let progress = (downloaded as f64 / total_size as f64) * 100.0;
            let progress_int = progress as i32;

            // Only emit progress events every 1% to avoid overwhelming the UI
            if progress_int > last_progress {
                if let Some(app) = app_handle {
                    let _ = app.emit(
                        "llm-download-progress",
                        serde_json::json!({
                            "model_id": model_id,
                            "progress": progress,
                            "downloaded_bytes": downloaded,
                            "total_bytes": total_size,
                        }),
                    );
                }

                // Log progress every 5%
                if progress_int >= last_progress + 5 || progress_int - last_progress >= 5 {
                    info(
                        Component::Processing,
                        &format!(
                            "Download progress: {:.1}% ({} MB / {} MB)",
                            progress,
                            downloaded / (1024 * 1024),
                            total_size / (1024 * 1024)
                        ),
                    );
                }

                last_progress = progress_int;
            }
        }

        file.sync_all()?;
        info(Component::Processing, "Download completed successfully");

        Ok(())
    }

    pub fn list_models(&self, active_model_id: &str) -> Vec<LLMModel> {
        LLMModel::all(&self.models_dir, active_model_id)
    }

    pub fn get_model_path(&self, model_id: &str) -> Option<PathBuf> {
        let models = self.list_models(model_id);
        models
            .iter()
            .find(|m| m.id == model_id && m.downloaded)
            .map(|m| self.models_dir.join(&m.filename))
    }

    pub fn get_tokenizer_path(&self, model_id: &str) -> Option<PathBuf> {
        let models = self.list_models(model_id);
        models
            .iter()
            .find(|m| m.id == model_id && m.downloaded)
            .map(|m| self.models_dir.join(format!("{}_tokenizer.json", m.id)))
    }
}
