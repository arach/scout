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
    crate::logger::info(crate::logger::Component::Settings, &format!("Setting auto_copy to: {}", enabled));
    let mut settings = state.settings.lock().await;
    settings.update(|s| s.ui.auto_copy = enabled)
        .map_err(|e| format!("Failed to update auto_copy: {}", e))?;
    
    // Verify the value was actually saved
    let current_value = settings.get().ui.auto_copy;
    crate::logger::info(crate::logger::Component::Settings, &format!("✅ auto_copy set to: {} (verified: {})", enabled, current_value));
    
    // Force a reload to ensure it was written to disk
    settings.reload().map_err(|e| format!("Failed to reload settings: {}", e))?;
    let reloaded_value = settings.get().ui.auto_copy;
    crate::logger::info(crate::logger::Component::Settings, &format!("✅ After reload from disk: auto_copy = {}", reloaded_value));
    
    Ok(())
}

#[tauri::command]
pub async fn is_auto_copy_enabled(state: State<'_, AppState>) -> Result<bool, String> {
    let settings = state.settings.lock().await;
    Ok(settings.get().ui.auto_copy)
}

#[tauri::command]
pub async fn set_auto_paste(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    crate::logger::info(crate::logger::Component::Settings, &format!("Setting auto_paste to: {}", enabled));
    let mut settings = state.settings.lock().await;
    settings.update(|s| s.ui.auto_paste = enabled)
        .map_err(|e| format!("Failed to update auto_paste: {}", e))?;
    
    // Verify the value was actually saved
    let current_value = settings.get().ui.auto_paste;
    crate::logger::info(crate::logger::Component::Settings, &format!("✅ auto_paste set to: {} (verified: {})", enabled, current_value));
    
    // Force a reload to ensure it was written to disk
    settings.reload().map_err(|e| format!("Failed to reload settings: {}", e))?;
    let reloaded_value = settings.get().ui.auto_paste;
    crate::logger::info(crate::logger::Component::Settings, &format!("✅ After reload from disk: auto_paste = {}", reloaded_value));
    
    Ok(())
}

#[tauri::command]
pub async fn is_auto_paste_enabled(state: State<'_, AppState>) -> Result<bool, String> {
    let settings = state.settings.lock().await;
    Ok(settings.get().ui.auto_paste)
}

