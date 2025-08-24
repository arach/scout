use crate::logger::{error, info, Component};
use crate::transcription::Transcriber;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{Mutex, OnceCell};

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
        // Check if already loaded
        if let Some(transcriber) = self.transcriber.get() {
            return Ok(transcriber.clone());
        }

        // Validate model path exists before attempting to load
        if !self.model_path.exists() {
            let error_msg = format!("Model file does not exist: {}", self.model_path.display());
            error(Component::Transcription, &format!("❌ {}", error_msg));
            return Err(error_msg);
        }

        // Try to initialize the transcriber
        let result = self
            .transcriber
            .get_or_init(|| async {
                info(Component::Transcription, "Lazy-loading Whisper model...");
                let start = std::time::Instant::now();

                // Since we've already validated the path exists, this should succeed
                // But we still need to handle the error case for OnceCell
                match Transcriber::new(&self.model_path) {
                    Ok(t) => {
                        let elapsed = start.elapsed();
                        info(
                            Component::Transcription,
                            &format!("✅ Model loaded in {:.2}s", elapsed.as_secs_f64()),
                        );
                        Arc::new(Mutex::new(t))
                    }
                    Err(e) => {
                        error(
                            Component::Transcription,
                            &format!("❌ Failed to load model even though path exists: {}", e),
                        );
                        // We have to return something for OnceCell - this is a limitation of the current design
                        // In a future refactor, we should use a different pattern that allows error propagation
                        panic!(
                            "Critical error: Model file exists but failed to load: {}",
                            e
                        );
                    }
                }
            })
            .await;

        Ok(result.clone())
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
        let filename = self
            .model_path
            .file_name()
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
