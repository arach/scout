use super::{GenerationOptions, LLMEngine, PromptTemplate};
use crate::logger::{debug, error, info, Component};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LLMOutput {
    pub transcript_id: i64,
    pub prompt_id: String,
    pub prompt_name: String,
    pub input_text: String,
    pub output_text: String,
    pub processing_time_ms: u64,
    pub model_used: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

pub struct LLMPipeline {
    engine: Arc<Mutex<Box<dyn LLMEngine>>>,
}

impl LLMPipeline {
    pub fn new(engine: Box<dyn LLMEngine>) -> Self {
        Self {
            engine: Arc::new(Mutex::new(engine)),
        }
    }

    pub async fn process_transcript(
        &self,
        transcript_id: i64,
        transcript_text: &str,
        templates: &[&PromptTemplate],
        options: GenerationOptions,
    ) -> Result<Vec<LLMOutput>> {
        let mut outputs = Vec::new();

        for template in templates {
            info(
                Component::Processing,
                &format!("Processing transcript with prompt: {}", template.name),
            );

            let start_time = std::time::Instant::now();
            let prompt = template.render(transcript_text);

            match self.generate_with_retry(&prompt, options.clone()).await {
                Ok(output_text) => {
                    let processing_time_ms = start_time.elapsed().as_millis() as u64;

                    let engine = self.engine.lock().await;
                    let model_info = engine
                        .model_info()
                        .map(|info| info.name)
                        .unwrap_or_else(|| "unknown".to_string());
                    drop(engine);

                    debug(
                        Component::Processing,
                        &format!(
                            "LLM processing completed in {}ms for prompt '{}'",
                            processing_time_ms, template.name
                        ),
                    );

                    outputs.push(LLMOutput {
                        transcript_id,
                        prompt_id: template.id.clone(),
                        prompt_name: template.name.clone(),
                        input_text: transcript_text.to_string(),
                        output_text,
                        processing_time_ms,
                        model_used: model_info,
                        timestamp: chrono::Utc::now(),
                    });
                }
                Err(e) => {
                    error(
                        Component::Processing,
                        &format!(
                            "Failed to process transcript with prompt '{}': {}",
                            template.name, e
                        ),
                    );
                }
            }
        }

        Ok(outputs)
    }

    async fn generate_with_retry(
        &self,
        prompt: &str,
        options: GenerationOptions,
    ) -> Result<String> {
        let max_retries = 3;
        let mut last_error = None;

        for attempt in 1..=max_retries {
            let engine = self.engine.lock().await;
            match engine.generate(prompt, options.clone()).await {
                Ok(result) => return Ok(result),
                Err(e) => {
                    last_error = Some(e);
                    if attempt < max_retries {
                        debug(
                            Component::Processing,
                            &format!(
                                "LLM generation failed (attempt {}/{}), retrying...",
                                attempt, max_retries
                            ),
                        );
                        // Exponential backoff
                        tokio::time::sleep(tokio::time::Duration::from_millis(100 * attempt)).await;
                    }
                }
            }
        }

        Err(last_error.unwrap())
    }

    pub async fn is_ready(&self) -> bool {
        let engine = self.engine.lock().await;
        engine.is_loaded()
    }

    pub async fn load_model(&self, model_path: &std::path::Path) -> Result<()> {
        let mut engine = self.engine.lock().await;
        engine.load_model(model_path).await
    }
}

// Chunking utilities for long transcripts
pub fn chunk_transcript(transcript: &str, max_tokens: usize) -> Vec<String> {
    // Simple chunking by sentences
    // In production, you'd want smarter chunking based on token count
    let sentences: Vec<&str> = transcript
        .split(|c| c == '.' || c == '!' || c == '?')
        .filter(|s| !s.trim().is_empty())
        .collect();

    let mut chunks = Vec::new();
    let mut current_chunk = String::new();
    let words_per_token = 1.3; // Rough estimate
    let max_words = (max_tokens as f64 / words_per_token) as usize;

    for sentence in sentences {
        let sentence_with_punct = format!("{}. ", sentence.trim());
        let word_count = sentence_with_punct.split_whitespace().count();

        if current_chunk.split_whitespace().count() + word_count > max_words
            && !current_chunk.is_empty()
        {
            chunks.push(current_chunk.trim().to_string());
            current_chunk = sentence_with_punct;
        } else {
            current_chunk.push_str(&sentence_with_punct);
        }
    }

    if !current_chunk.trim().is_empty() {
        chunks.push(current_chunk.trim().to_string());
    }

    chunks
}
