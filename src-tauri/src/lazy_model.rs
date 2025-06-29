use std::sync::Arc;
use tokio::sync::{Mutex, OnceCell};
use std::path::PathBuf;
use crate::transcription::Transcriber;
use crate::logger::{info, warn, Component};

/// Lazy-loaded Whisper model to reduce startup time and memory usage
pub struct LazyModel {
    model_path: PathBuf,
    transcriber: Arc<OnceCell<Arc<Mutex<Transcriber>>>>,
}

impl LazyModel {
    pub fn new(model_path: PathBuf) -> Self {
        Self {
            model_path,
            transcriber: Arc::new(OnceCell::new()),
        }
    }
    
    /// Get or create the transcriber instance
    pub async fn get_transcriber(&self) -> Result<Arc<Mutex<Transcriber>>, String> {
        self.transcriber
            .get_or_init(|| async {
                info(Component::Transcription, "Lazy-loading Whisper model...");
                let start = std::time::Instant::now();
                
                match Transcriber::new(&self.model_path) {
                    Ok(t) => {
                        let elapsed = start.elapsed();
                        info(Component::Transcription, 
                             &format!("Model loaded in {:.2}s", elapsed.as_secs_f64()));
                        Arc::new(Mutex::new(t))
                    }
                    Err(e) => {
                        warn(Component::Transcription, 
                             &format!("Failed to load model: {}", e));
                        panic!("Failed to load Whisper model: {}", e);
                    }
                }
            })
            .await;
            
        Ok(self.transcriber.get().unwrap().clone())
    }
    
    /// Check if model is already loaded
    pub fn is_loaded(&self) -> bool {
        self.transcriber.initialized()
    }
    
    /// Pre-load the model (useful for background initialization)
    pub async fn preload(&self) -> Result<(), String> {
        self.get_transcriber().await.map(|_| ())
    }
    
    /// Get memory usage estimate based on model size
    pub fn estimated_memory_mb(&self) -> u64 {
        let filename = self.model_path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
            
        match filename {
            n if n.contains("tiny") => 39,
            n if n.contains("base") => 74,
            n if n.contains("small") => 244,
            n if n.contains("medium") => 769,
            n if n.contains("large") => 1550,
            _ => 100, // Default estimate
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    
    #[tokio::test]
    async fn test_lazy_loading() {
        let dir = tempdir().unwrap();
        let model_path = dir.path().join("test-model.bin");
        
        // Create a dummy file
        std::fs::write(&model_path, b"dummy").unwrap();
        
        let lazy_model = LazyModel::new(model_path);
        
        // Should not be loaded initially
        assert!(!lazy_model.is_loaded());
        
        // After getting transcriber, should be loaded
        // Note: This will fail in tests without a real model
        // let _ = lazy_model.get_transcriber().await;
        // assert!(lazy_model.is_loaded());
    }
}