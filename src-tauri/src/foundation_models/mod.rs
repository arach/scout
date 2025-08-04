/// Foundation Models integration for Scout
/// 
/// This module provides integration with Apple's Foundation Models framework
/// for text enhancement, summarization, and structured output generation.
/// 
/// Uses the existing Swift/Objective-C bridge system for native integration.

use serde::{Deserialize, Serialize};
use tauri::command;
use crate::logger::{debug, error, info, warn, Component};
#[cfg(target_os = "macos")]
use crate::macos::FoundationModels;

/// Configuration for Foundation Models text processing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FoundationModelsConfig {
    /// Enable text enhancement (grammar, punctuation, readability)
    pub enable_enhancement: bool,
    /// Enable summarization features
    pub enable_summarization: bool,
    /// Enable structured output extraction
    pub enable_structured_output: bool,
    /// Temperature for text generation (0.0 = deterministic, higher = more creative)
    pub temperature: f64,
    /// Maximum output length
    pub max_length: usize,
}

impl Default for FoundationModelsConfig {
    fn default() -> Self {
        Self {
            enable_enhancement: true,
            enable_summarization: false,
            enable_structured_output: false,
            temperature: 0.1, // Low temperature for deterministic enhancement
            max_length: 2000,
        }
    }
}

/// Request for Foundation Models processing
#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessingRequest {
    pub text: String,
    pub operation: ProcessingOperation,
    pub config: FoundationModelsConfig,
}

/// Response from Foundation Models processing
#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessingResponse {
    pub success: bool,
    pub result: Option<String>,
    pub error: Option<String>,
    pub processing_time_ms: u64,
}

/// Types of processing operations available
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "params")]
pub enum ProcessingOperation {
    /// Enhance text quality (grammar, punctuation, readability)
    Enhance,
    /// Generate a summary of the text
    Summarize { max_sentences: usize },
    /// Extract structured data from text
    ExtractStructured { format: String },
    /// Clean up speech patterns (um, uh, repetitions)
    CleanSpeech,
    /// Format as specific document type
    Format { document_type: String },
}

/// Foundation Models processor using native Swift bridge
pub struct FoundationModelsProcessor {
    config: FoundationModelsConfig,
}

impl FoundationModelsProcessor {
    pub fn new(config: FoundationModelsConfig) -> Result<Self, String> {
        info(Component::Enhancement, "Foundation Models processor initialized");
        Ok(Self { config })
    }

    /// Check if Foundation Models is available on this system
    pub async fn is_available(&self) -> bool {
        #[cfg(target_os = "macos")]
        {
            FoundationModels::is_available()
        }
        #[cfg(not(target_os = "macos"))]
        {
            false
        }
    }

    /// Process text with Foundation Models
    pub async fn process_text(
        &self,
        text: &str,
        operation: ProcessingOperation,
    ) -> Result<String, String> {
        if text.is_empty() {
            return Ok(text.to_string());
        }

        let start_time = std::time::Instant::now();
        
        #[cfg(target_os = "macos")]
        {
            let result = match operation {
                ProcessingOperation::Enhance => {
                    FoundationModels::enhance_text(text)
                }
                ProcessingOperation::CleanSpeech => {
                    FoundationModels::clean_speech_patterns(text)
                }
                ProcessingOperation::Summarize { max_sentences } => {
                    FoundationModels::summarize_text(text, max_sentences as u32)
                }
                _ => {
                    Err("Operation not supported".to_string())
                }
            };

            let processing_time = start_time.elapsed();
            
            match result {
                Ok(enhanced_text) => {
                    info(Component::Enhancement, &format!(
                        "Foundation Models processing completed in {}ms", 
                        processing_time.as_millis()
                    ));
                    Ok(enhanced_text)
                }
                Err(e) => {
                    warn(Component::Enhancement, &format!("Foundation Models processing failed: {}", e));
                    Err(e)
                }
            }
        }
        
        #[cfg(not(target_os = "macos"))]
        {
            Err("Foundation Models not available on this platform".to_string())
        }
    }

    /// Update configuration
    pub fn update_config(&mut self, config: FoundationModelsConfig) {
        self.config = config;
        info(Component::Enhancement, "Foundation Models configuration updated");
    }
}

// Tauri commands for Foundation Models integration

#[command]
pub async fn enhance_transcript(
    text: String,
    config: Option<FoundationModelsConfig>,
) -> Result<String, String> {
    let processor_config = config.unwrap_or_default();
    let processor = FoundationModelsProcessor::new(processor_config)?;
    
    if !processor.is_available().await {
        return Err("Foundation Models not available on this system".to_string());
    }

    processor.process_text(&text, ProcessingOperation::Enhance).await
}

#[command]
pub async fn summarize_transcript(
    text: String,
    max_sentences: Option<usize>,
    config: Option<FoundationModelsConfig>,
) -> Result<String, String> {
    let processor_config = config.unwrap_or_default();
    let processor = FoundationModelsProcessor::new(processor_config)?;
    
    if !processor.is_available().await {
        return Err("Foundation Models not available on this system".to_string());
    }

    let operation = ProcessingOperation::Summarize {
        max_sentences: max_sentences.unwrap_or(3),
    };

    processor.process_text(&text, operation).await
}

#[command]
pub async fn clean_speech_patterns(
    text: String,
    config: Option<FoundationModelsConfig>,
) -> Result<String, String> {
    let processor_config = config.unwrap_or_default();
    let processor = FoundationModelsProcessor::new(processor_config)?;
    
    if !processor.is_available().await {
        return Err("Foundation Models not available on this system".to_string());
    }

    processor.process_text(&text, ProcessingOperation::CleanSpeech).await
}

#[command]
pub async fn extract_structured_data(
    text: String,
    format: String,
    config: Option<FoundationModelsConfig>,
) -> Result<String, String> {
    let processor_config = config.unwrap_or_default();
    let processor = FoundationModelsProcessor::new(processor_config)?;
    
    if !processor.is_available().await {
        return Err("Foundation Models not available on this system".to_string());
    }

    let operation = ProcessingOperation::ExtractStructured { format };
    processor.process_text(&text, operation).await
}

#[command]
pub async fn format_transcript(
    text: String,
    document_type: String,
    config: Option<FoundationModelsConfig>,
) -> Result<String, String> {
    let processor_config = config.unwrap_or_default();
    let processor = FoundationModelsProcessor::new(processor_config)?;
    
    if !processor.is_available().await {
        return Err("Foundation Models not available on this system".to_string());
    }

    let operation = ProcessingOperation::Format { document_type };
    processor.process_text(&text, operation).await
}

#[command]
pub async fn check_foundation_models_availability() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(FoundationModels::is_available())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(false)
    }
}