use std::path::{Path, PathBuf};

use crate::services::downloads::download_file_with_progress;

// ============================================================================
// File Operations Commands
// ============================================================================

#[tauri::command]
pub async fn serve_audio_file(file_path: String) -> Result<Vec<u8>, String> {
    use std::fs;
    fs::read(&file_path).map_err(|e| format!("Failed to read audio file: {}", e))
}

#[tauri::command]
pub async fn read_audio_file(audio_path: String) -> Result<Vec<u8>, String> {
    let path = Path::new(&audio_path);
    if path.extension().and_then(|s| s.to_str()) == Some("wav") {
        return std::fs::read(&audio_path).map_err(|e| e.to_string());
    }
    crate::audio::converter::AudioConverter::convert_to_wav_bytes(path)
}

// ============================================================================
// Download Commands
// ============================================================================

#[tauri::command]
pub async fn download_file(app: tauri::AppHandle, url: String, dest_path: String) -> Result<(), String> {
    let path = PathBuf::from(dest_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    download_file_with_progress(&app, &url, &path, "file").await
}