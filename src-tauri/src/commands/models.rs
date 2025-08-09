use tauri::State;

use crate::services::downloads::download_file_with_progress;
use crate::AppState;
use crate::{logger::*, models};

#[tauri::command]
pub async fn download_model(app: tauri::AppHandle, model_name: String, model_url: String) -> Result<(), String> {
    let models_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("models");
    std::fs::create_dir_all(&models_dir).map_err(|e| format!("Failed to create models directory: {}", e))?;
    let model_filename = format!("ggml-{}.bin", model_name);
    let dest_path = models_dir.join(&model_filename);
    if dest_path.exists() {
        info(Component::Transcription, &format!("Model {} already exists, skipping download", model_name));
        return Ok(());
    }
    download_file_with_progress(&app, &model_url, &dest_path, "model").await?;
    let state: State<crate::AppState> = app.state();
    state.model_state_manager.mark_model_downloaded(&model_name, false).await;
    info(Component::Transcription, &format!("Model {} downloaded successfully", model_name));
    Ok(())
}

#[cfg(target_os = "macos")]
async fn download_coreml_model(
    app: &tauri::AppHandle,
    model_name: &str,
    models_dir: &std::path::Path,
) -> Result<(), String> {
    let coreml_url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}-encoder.mlmodelc.zip?download=true",
        model_name
    );
    let coreml_filename = format!("ggml-{}-encoder.mlmodelc", model_name);
    let coreml_path = models_dir.join(&coreml_filename);
    if coreml_path.exists() {
        info(Component::Transcription, &format!("Core ML model already exists: {}", coreml_filename));
        return Ok(());
    }
    info(Component::Transcription, &format!("Downloading Core ML model for {}", model_name));
    let zip_path = models_dir.join(format!("{}.zip", coreml_filename));
    download_file_with_progress(app, &coreml_url, &zip_path, "coreml").await?;
    extract_coreml_model(&zip_path, &coreml_path)?;
    let _ = std::fs::remove_file(&zip_path);
    info(Component::Transcription, &format!("Core ML model downloaded and extracted: {}", coreml_filename));
    Ok(())
}

#[cfg(target_os = "macos")]
fn extract_coreml_model(zip_path: &std::path::Path, dest_path: &std::path::Path) -> Result<(), String> {
    use std::process::Command;
    let output = Command::new("unzip")
        .arg("-q")
        .arg("-o")
        .arg(zip_path)
        .arg("-d")
        .arg(dest_path.parent().unwrap())
        .output()
        .map_err(|e| format!("Failed to run unzip: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to extract Core ML model: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn check_and_download_missing_coreml_models(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let models_dir = state.models_dir.clone();
        let settings_manager = state.settings.lock().await;
        let settings = settings_manager.get();
        let models_list = models::WhisperModel::all(&models_dir, settings);
        drop(settings_manager);
        let mut downloaded_models = Vec::new();
        for model in models_list {
            if model.downloaded && !model.coreml_downloaded && model.coreml_url.is_some() {
                info(Component::Models, &format!("Found model {} with missing Core ML, downloading...", model.id));
                if let Err(e) = download_coreml_model(&app, &model.id, &models_dir).await {
                    error(Component::Models, &format!("Failed to download Core ML for {}: {}", model.id, e));
                } else {
                    downloaded_models.push(model.id.clone());
                }
            }
        }
        return Ok(downloaded_models);
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub async fn download_coreml_for_model(app: tauri::AppHandle, state: State<'_, AppState>, model_id: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let models_dir = state.models_dir.clone();
        download_coreml_model(&app, &model_id, &models_dir).await?;
        state.model_state_manager.mark_coreml_downloaded(&model_id).await;
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Core ML is only supported on macOS".to_string())
    }
}

#[tauri::command]
pub async fn get_available_models(state: State<'_, AppState>) -> Result<Vec<models::WhisperModel>, String> {
    let settings = state.settings.lock().await;
    Ok(models::WhisperModel::all(&state.models_dir, settings.get()))
}

#[tauri::command]
pub async fn has_any_model(state: State<'_, AppState>) -> Result<bool, String> {
    let has_models = match std::fs::read_dir(&state.models_dir) {
        Ok(entries) => entries.filter_map(Result::ok).any(|entry| entry.path().extension().and_then(|ext| ext.to_str()).map(|ext| ext == "bin").unwrap_or(false)),
        Err(e) => {
            error(Component::Transcription, &format!("Error reading models directory: {}", e));
            false
        }
    };
    Ok(has_models)
}

#[tauri::command]
pub async fn set_active_model(state: State<'_, AppState>, model_id: String) -> Result<(), String> {
    let mut settings = state.settings.lock().await;
    let _previous_model = settings.get().models.active_model_id.clone();
    settings
        .update(|s| s.models.active_model_id = model_id.clone())
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_models_dir(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.models_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_current_model(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.settings.lock().await;
    Ok(settings.get().models.active_model_id.clone())
}

#[tauri::command]
pub async fn get_model_coreml_status(state: State<'_, AppState>, model_id: String) -> Result<crate::model_state::CoreMLState, String> {
    if let Some(model_state) = state.model_state_manager.get_state(&model_id).await {
        Ok(model_state.coreml_state)
    } else {
        Ok(crate::model_state::CoreMLState::NotDownloaded)
    }
}

#[tauri::command]
pub async fn open_models_folder(state: State<'_, AppState>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(&state.models_dir).spawn().map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer").arg(&state.models_dir).spawn().map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(&state.models_dir).spawn().map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    Ok(())
}

