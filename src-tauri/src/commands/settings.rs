use tauri::State;

use crate::settings;
use crate::AppState;

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let settings = state.settings.lock().await;
    serde_json::to_value(settings.get()).map_err(|e| format!("Failed to serialize settings: {}", e))
}

#[tauri::command]
pub async fn update_settings(state: State<'_, AppState>, new_settings: serde_json::Value) -> Result<(), String> {
    let mut settings_lock = state.settings.lock().await;
    let app_settings: settings::AppSettings = serde_json::from_value(new_settings)
        .map_err(|e| format!("Invalid settings format: {}", e))?;
    settings_lock.update(|s| *s = app_settings)?;
    Ok(())
}

#[tauri::command]
pub async fn set_auto_copy(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    let mut settings = state.settings.lock().await;
    settings.update(|s| s.ui.auto_copy = enabled)
}

#[tauri::command]
pub async fn is_auto_copy_enabled(state: State<'_, AppState>) -> Result<bool, String> {
    let settings = state.settings.lock().await;
    Ok(settings.get().ui.auto_copy)
}

#[tauri::command]
pub async fn set_auto_paste(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    let mut settings = state.settings.lock().await;
    settings.update(|s| s.ui.auto_paste = enabled)
}

#[tauri::command]
pub async fn is_auto_paste_enabled(state: State<'_, AppState>) -> Result<bool, String> {
    let settings = state.settings.lock().await;
    Ok(settings.get().ui.auto_paste)
}

