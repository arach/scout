use anyhow::{anyhow, Result as AnyhowResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::fs;
use crate::logger::{info, debug, warn, error, Component};

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
            LLMModel {
                id: "tinyllama-1.1b".to_string(),
                name: "TinyLlama 1.1B Chat".to_string(),
                size_mb: 2200,
                parameters: "1.1B".to_string(),
                description: "Compact model for basic summarization and formatting".to_string(),
                model_url: "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf".to_string(),
                tokenizer_url: "https://huggingface.co/TinyLlama/TinyLlama-1.1B-Chat-v1.0/resolve/main/tokenizer.json".to_string(),
                filename: "tinyllama-1.1b-chat.safetensors".to_string(),
                speed: "~50 tokens/sec".to_string(),
                context_length: 2048,
                downloaded: false,
                active: false,
            },
            LLMModel {
                id: "phi-2".to_string(),
                name: "Microsoft Phi-2".to_string(),
                size_mb: 5500,
                parameters: "2.7B".to_string(),
                description: "Excellent for code understanding and structured output".to_string(),
                model_url: "https://huggingface.co/microsoft/phi-2/resolve/main/model.safetensors".to_string(),
                tokenizer_url: "https://huggingface.co/microsoft/phi-2/resolve/main/tokenizer.json".to_string(),
                filename: "phi-2.safetensors".to_string(),
                speed: "~30 tokens/sec".to_string(),
                context_length: 2048,
                downloaded: false,
                active: false,
            },
            LLMModel {
                id: "stablelm-zephyr-1.6b".to_string(),
                name: "StableLM 2 Zephyr 1.6B".to_string(),
                size_mb: 3200,
                parameters: "1.6B".to_string(),
                description: "Well-balanced model for general text processing".to_string(),
                model_url: "https://huggingface.co/stabilityai/stablelm-2-zephyr-1_6b/resolve/main/model.safetensors".to_string(),
                tokenizer_url: "https://huggingface.co/stabilityai/stablelm-2-zephyr-1_6b/resolve/main/tokenizer.json".to_string(),
                filename: "stablelm-2-zephyr-1.6b.safetensors".to_string(),
                speed: "~40 tokens/sec".to_string(),
                context_length: 4096,
                downloaded: false,
                active: false,
            },
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
        
        models.iter()
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
        // Create models directory if it doesn't exist
        fs::create_dir_all(&self.models_dir)?;
        
        info(Component::Processing, &format!("Downloading LLM model: {}", model.name));
        
        // Download model file
        let model_path = self.models_dir.join(&model.filename);
        if !model_path.exists() {
            self.download_file(&model.model_url, &model_path).await?;
        }
        
        // Download tokenizer
        let tokenizer_path = self.models_dir.join(format!("{}_tokenizer.json", model.id));
        if !tokenizer_path.exists() {
            self.download_file(&model.tokenizer_url, &tokenizer_path).await?;
        }
        
        info(Component::Processing, &format!("Model {} downloaded successfully", model.name));
        Ok(())
    }
    
    async fn download_file(&self, url: &str, dest: &Path) -> AnyhowResult<()> {
        use futures_util::StreamExt;
        use std::io::Write;
        
        let client = reqwest::Client::new();
        let response = client
            .get(url)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to download: {}", e))?;
        
        let total_size = response
            .content_length()
            .ok_or_else(|| anyhow!("Failed to get content length"))?;
        
        let mut file = std::fs::File::create(dest)?;
        let mut downloaded = 0u64;
        let mut stream = response.bytes_stream();
        
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| anyhow!("Download failed: {}", e))?;
            file.write_all(&chunk)?;
            downloaded += chunk.len() as u64;
            
            // Log progress every 10MB
            if downloaded % (10 * 1024 * 1024) == 0 {
                let progress = (downloaded as f64 / total_size as f64) * 100.0;
                debug(Component::Processing, &format!("Download progress: {:.1}%", progress));
            }
        }
        
        Ok(())
    }
    
    pub fn list_models(&self, active_model_id: &str) -> Vec<LLMModel> {
        LLMModel::all(&self.models_dir, active_model_id)
    }
    
    pub fn get_model_path(&self, model_id: &str) -> Option<PathBuf> {
        let models = self.list_models(model_id);
        models.iter()
            .find(|m| m.id == model_id && m.downloaded)
            .map(|m| self.models_dir.join(&m.filename))
    }
    
    pub fn get_tokenizer_path(&self, model_id: &str) -> Option<PathBuf> {
        let models = self.list_models(model_id);
        models.iter()
            .find(|m| m.id == model_id && m.downloaded)
            .map(|m| self.models_dir.join(format!("{}_tokenizer.json", m.id)))
    }
}