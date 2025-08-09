use std::path::PathBuf;

use crate::services::downloads::download_file_with_progress;

#[tauri::command]
pub async fn download_file(app: tauri::AppHandle, url: String, dest_path: String) -> Result<(), String> {
    let path = PathBuf::from(dest_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    download_file_with_progress(&app, &url, &path, "file").await
}

