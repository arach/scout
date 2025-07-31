use super::{GenerationOptions, LLMEngine, ModelInfo, Token};
use crate::logger::{info, Component};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::llama::{Cache, Config, Llama};
use std::path::Path;
use tokenizers::Tokenizer;
use tokio::sync::mpsc::{channel, Receiver};

pub struct CandleEngine {
    model: Option<Llama>,
    tokenizer: Option<Tokenizer>,
    device: Device,
    config: Option<Config>,
    model_info: Option<ModelInfo>,
    cache: Option<Cache>,
}

impl CandleEngine {
    pub fn new() -> Result<Self> {
        // For now, use CPU to avoid dependency issues
        // TODO: Re-enable Metal support when dependency conflicts are resolved
        let device = Device::Cpu;

        info(
            Component::Processing,
            &format!("Initialized Candle with device: {:?}", device),
        );

        Ok(Self {
            model: None,
            tokenizer: None,
            device,
            config: None,
            model_info: None,
            cache: None,
        })
    }

    async fn load_tinyllama_model(&mut self, model_path: &Path) -> Result<()> {
        info(Component::Processing, "Loading TinyLlama model...");

        // Load tokenizer - try both naming conventions
        let parent_dir = model_path
            .parent()
            .ok_or_else(|| anyhow!("Invalid model path"))?;

        let tokenizer_path = if parent_dir.join("tinyllama-1.1b_tokenizer.json").exists() {
            parent_dir.join("tinyllama-1.1b_tokenizer.json")
        } else {
            parent_dir.join("tokenizer.json")
        };

        let tokenizer = Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| anyhow!("Failed to load tokenizer: {}", e))?;

        // TinyLlama configuration for Candle 0.9
        let config = Config {
            hidden_size: 2048,
            intermediate_size: 5632,
            vocab_size: 32000,
            num_hidden_layers: 22,
            num_attention_heads: 32,
            num_key_value_heads: 4, // Changed from Option to usize
            max_position_embeddings: 2048,
            rms_norm_eps: 1e-5,
            rope_theta: 10000.0,
            bos_token_id: Some(1),
            eos_token_id: Some(candle_transformers::models::llama::LlamaEosToks::Single(2)),
            rope_scaling: None,
            tie_word_embeddings: false,
            use_flash_attn: false,
        };

        // Load model weights
        let vb = unsafe {
            VarBuilder::from_mmaped_safetensors(&[model_path], DType::F16, &self.device)?
        };

        let model = Llama::load(vb, &config)?;
        let cache = Cache::new(false, DType::F16, &config, &self.device)?;

        self.model = Some(model);
        self.tokenizer = Some(tokenizer);
        self.config = Some(config.clone());
        self.cache = Some(cache);
        self.model_info = Some(ModelInfo {
            name: "TinyLlama-1.1B-Chat".to_string(),
            parameters: 1_100_000_000,
            context_length: config.max_position_embeddings,
            model_type: "llama".to_string(),
        });

        info(Component::Processing, "TinyLlama model loaded successfully");
        Ok(())
    }

    fn apply_chat_template(&self, prompt: &str) -> String {
        // TinyLlama chat template
        format!(
            "<|system|>\nYou are a helpful assistant that processes transcripts.</s>\n<|user|>\n{}</s>\n<|assistant|>\n",
            prompt
        )
    }
}

#[async_trait]
impl LLMEngine for CandleEngine {
    async fn load_model(&mut self, model_path: &Path) -> Result<()> {
        // For now, we only support TinyLlama
        // Future: detect model type from config.json
        self.load_tinyllama_model(model_path).await
    }

    async fn generate(&self, prompt: &str, options: GenerationOptions) -> Result<String> {
        // Since we need mutable access to cache, we'll create a new one for each generation
        // This is not ideal but works for now. In production, you'd want a better solution.
        let model = self
            .model
            .as_ref()
            .ok_or_else(|| anyhow!("Model not loaded"))?;
        let tokenizer = self
            .tokenizer
            .as_ref()
            .ok_or_else(|| anyhow!("Tokenizer not loaded"))?;
        let config = self
            .config
            .as_ref()
            .ok_or_else(|| anyhow!("Config not loaded"))?;

        // Apply chat template
        let formatted_prompt = self.apply_chat_template(prompt);

        // Tokenize input
        let tokens = tokenizer
            .encode(formatted_prompt.as_str(), true)
            .map_err(|e| anyhow!("Tokenization failed: {}", e))?;
        let input_ids = tokens.get_ids();

        let mut token_ids = input_ids.to_vec();
        let mut generated_text = String::new();

        // Create a new cache for this generation
        let mut cache = Cache::new(false, DType::F16, config, &self.device)?;

        // Generate tokens
        for idx in 0..options.max_tokens {
            let input = Tensor::new(token_ids.as_slice(), &self.device)?.unsqueeze(0)?;

            let logits = model.forward(&input, idx, &mut cache)?;
            let logits = logits.squeeze(0)?;

            // Get last token logits
            let last_logits = logits.get(logits.dims()[0] - 1)?;

            // Apply temperature
            let temp_tensor = Tensor::new(&[options.temperature], &self.device)?;
            let scaled_logits = last_logits.div(&temp_tensor)?;

            // Sample next token
            let probs = candle_nn::ops::softmax_last_dim(&scaled_logits)?;
            let next_token = sample_token(&probs, options.top_p)?;

            // Check for EOS
            if next_token == tokenizer.token_to_id("</s>").unwrap_or(2) {
                break;
            }

            token_ids.push(next_token);

            // Decode the new token
            if let Ok(piece) = tokenizer.decode(&[next_token], false) {
                generated_text.push_str(&piece);
            }
        }

        Ok(generated_text.trim().to_string())
    }

    async fn stream_generate(
        &self,
        prompt: &str,
        options: GenerationOptions,
    ) -> Result<Receiver<Token>> {
        // TODO: Implement streaming generation
        let (tx, rx) = channel(100);

        // For now, just generate normally and send as one token
        let result = self.generate(prompt, options).await?;
        let token = Token {
            text: result,
            id: 0,
            logprob: None,
        };

        tokio::spawn(async move {
            let _ = tx.send(token).await;
        });

        Ok(rx)
    }

    fn is_loaded(&self) -> bool {
        self.model.is_some() && self.tokenizer.is_some()
    }

    fn model_info(&self) -> Option<ModelInfo> {
        self.model_info.clone()
    }
}

fn sample_token(probs: &Tensor, top_p: f32) -> Result<u32> {
    // Simple top-p sampling
    let probs_vec: Vec<f32> = probs.to_vec1()?;

    // Sort probabilities
    let mut indexed_probs: Vec<(usize, f32)> =
        probs_vec.iter().enumerate().map(|(i, &p)| (i, p)).collect();
    indexed_probs.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

    // Calculate cumulative probability
    let mut cumsum = 0.0;
    let mut cutoff_idx = indexed_probs.len();

    for (i, (_, prob)) in indexed_probs.iter().enumerate() {
        cumsum += prob;
        if cumsum >= top_p {
            cutoff_idx = i + 1;
            break;
        }
    }

    // Sample from top-p tokens
    let top_tokens = &indexed_probs[..cutoff_idx];
    let selected_idx = if top_tokens.is_empty() {
        0
    } else {
        // For simplicity, just take the highest probability token
        // In production, you'd want proper sampling here
        top_tokens[0].0
    };

    Ok(selected_idx as u32)
}
