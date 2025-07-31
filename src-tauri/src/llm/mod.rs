pub mod engine;
pub mod models;
pub mod prompts;
pub mod pipeline;

use anyhow::Result;
use std::path::Path;
use tokio::sync::mpsc::Receiver;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Token {
    pub text: String,
    pub id: u32,
    pub logprob: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationOptions {
    pub temperature: f32,
    pub top_p: f32,
    pub max_tokens: usize,
    pub repeat_penalty: f32,
    pub seed: Option<u64>,
}

impl Default for GenerationOptions {
    fn default() -> Self {
        Self {
            temperature: 0.7,
            top_p: 0.9,
            max_tokens: 500,
            repeat_penalty: 1.1,
            seed: None,
        }
    }
}

#[async_trait]
pub trait LLMEngine: Send + Sync {
    async fn load_model(&mut self, model_path: &Path) -> Result<()>;
    async fn generate(&self, prompt: &str, options: GenerationOptions) -> Result<String>;
    async fn stream_generate(&self, prompt: &str, options: GenerationOptions) -> Result<Receiver<Token>>;
    fn is_loaded(&self) -> bool;
    fn model_info(&self) -> Option<ModelInfo>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub parameters: usize,
    pub context_length: usize,
    pub model_type: String,
}

pub use engine::CandleEngine;
pub use models::ModelManager;
pub use prompts::{PromptTemplate, PromptManager};