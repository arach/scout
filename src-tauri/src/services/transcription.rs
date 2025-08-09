use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::db::Database;
use crate::logger::{debug, error, info, Component};
use crate::models;
use crate::processing_queue::{self, ProcessingQueue};
use crate::settings::SettingsManager;
use crate::transcription::Transcriber;

pub struct TranscriptionService {
    pub recordings_dir: PathBuf,
    pub models_dir: PathBuf,
    pub processing_queue: Arc<ProcessingQueue>,
    pub transcriber: Arc<Mutex<Option<Transcriber>>>,
    pub current_model_path: Arc<Mutex<Option<PathBuf>>>,
    pub settings: Arc<Mutex<SettingsManager>>,
}

impl TranscriptionService {
    pub async fn transcribe_audio(&self, audio_filename: String) -> Result<String, String> {
        let audio_path = self.recordings_dir.join(&audio_filename);
        if !audio_path.exists() {
            return Err(format!("Audio file not found at path: {:?}", audio_path));
        }
        let metadata = std::fs::metadata(&audio_path)
            .map_err(|e| format!("Failed to read file metadata: {}", e))?;
        if metadata.len() < 1024 {
            return Err(format!(
                "Audio file appears to be empty or corrupted (size: {} bytes)",
                metadata.len()
            ));
        }

        let model_path = {
            let settings = self.settings.lock().await;
            models::WhisperModel::get_active_model_path(&self.models_dir, settings.get())
        };

        if !model_path.exists() {
            error(
                Component::Transcription,
                &format!("Model file does not exist at: {:?}", model_path),
            );
            debug(Component::Transcription, "Models directory contents:");
            if let Ok(entries) = std::fs::read_dir(&self.models_dir) {
                for entry in entries.filter_map(Result::ok) {
                    debug(
                        Component::Transcription,
                        &format!("  - {:?}", entry.path()),
                    );
                }
            }
            return Err("No Whisper model found. Please download a model from Settings.".to_string());
        }

        let result = {
            let mut current_model = self.current_model_path.lock().await;
            let mut transcriber_opt = self.transcriber.lock().await;
            let needs_new_transcriber = match (&*current_model, &*transcriber_opt) {
                (Some(current_path), Some(_)) if current_path == &model_path => false,
                _ => true,
            };
            if needs_new_transcriber {
                info(
                    Component::Transcription,
                    &format!(
                        "Creating new singleton transcriber for model: {:?}",
                        model_path
                    ),
                );
                match Transcriber::new(&model_path) {
                    Ok(new_transcriber) => {
                        *transcriber_opt = Some(new_transcriber);
                        *current_model = Some(model_path.clone());
                    }
                    Err(e) => return Err(e),
                }
            }
            let transcriber = transcriber_opt.as_ref().unwrap();
            transcriber.transcribe(&audio_path)?
        };
        Ok(result)
    }

    pub async fn transcribe_file(&self, file_path: String, app: &tauri::AppHandle) -> Result<String, String> {
        let path = Path::new(&file_path);
        if !path.exists() {
            return Err("File not found".to_string());
        }
        let metadata = std::fs::metadata(&path)
            .map_err(|e| format!("Failed to read file metadata: {}", e))?;
        let file_size_mb = metadata.len() as f64 / (1024.0 * 1024.0);
        if file_size_mb > 100.0 {
            return Err(format!("File too large: {:.1}MB (max 100MB)", file_size_mb));
        }
        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        let supported_formats = ["wav", "mp3", "m4a", "flac", "ogg", "webm"];
        if !supported_formats.contains(&extension.as_str()) {
            return Err(format!("Unsupported file format: .{}", extension));
        }
        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
        let filename = format!(
            "upload_{}_{}",
            timestamp,
            path.file_name().unwrap().to_string_lossy()
        );
        let dest_path = self.recordings_dir.join(&filename);
        std::fs::copy(&path, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;
        let estimated_duration_ms = (file_size_mb * 60000.0) as i32;
        let job = processing_queue::ProcessingJob {
            filename: filename.clone(),
            audio_path: dest_path,
            duration_ms: estimated_duration_ms,
            app_handle: Some(app.clone()),
            queue_entry_time: tokio::time::Instant::now(),
            user_stop_time: None,
            #[cfg(target_os = "macos")]
            app_context: None,
            #[cfg(not(target_os = "macos"))]
            app_context: None,
        };
        let _ = self.processing_queue.queue_job(job).await;
        app
            .emit(
                "file-upload-complete",
                serde_json::json!({
                    "filename": filename,
                    "originalName": path.file_name().unwrap().to_string_lossy(),
                    "size": metadata.len(),
                }),
            )
            .map_err(|e| format!("Failed to emit event: {}", e))?;
        Ok(filename)
    }
}

