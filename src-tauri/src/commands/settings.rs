use tauri::State;

use crate::db;
use crate::settings;
use crate::AppState;

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let settings = state.settings.lock().await;
    serde_json::to_value(settings.get()).map_err(|e| format!("Failed to serialize settings: {}", e))
}

#[tauri::command]
pub async fn update_settings(state: State<'_, AppState>, new_settings: serde_json::Value) -> Result<(), String> {
    // Log the incoming settings update
    if let Some(transcription_mode) = new_settings.get("transcription_mode") {
        crate::logger::info(crate::logger::Component::Settings, 
            &format!("Updating transcription_mode to: {:?}", transcription_mode));
    }
    if let Some(external_service) = new_settings.get("external_service") {
        if let Some(enabled) = external_service.get("enabled") {
            crate::logger::info(crate::logger::Component::Settings, 
                &format!("Updating external_service.enabled to: {}", enabled));
        }
    }
    
    let mut settings_lock = state.settings.lock().await;
    let app_settings: settings::AppSettings = serde_json::from_value(new_settings)
        .map_err(|e| format!("Invalid settings format: {}", e))?;
    
    // Log before update
    crate::logger::info(crate::logger::Component::Settings, 
        &format!("Current external_service.enabled: {}", settings_lock.get().external_service.enabled));
    
    settings_lock.update(|s| *s = app_settings)?;
    
    // Log after update
    crate::logger::info(crate::logger::Component::Settings, 
        &format!("After update external_service.enabled: {}", settings_lock.get().external_service.enabled));
    
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

// ============================================================================
// Dictionary Commands
// ============================================================================

#[tauri::command]
pub async fn get_dictionary_entries(state: State<'_, AppState>, enabled_only: bool) -> Result<Vec<db::DictionaryEntry>, String> {
    if enabled_only { state.database.get_enabled_dictionary_entries().await } else { state.database.get_all_dictionary_entries().await }
}

#[tauri::command]
pub async fn save_dictionary_entry(
    state: State<'_, AppState>,
    original_text: String,
    replacement_text: String,
    match_type: String,
    is_case_sensitive: bool,
    phonetic_pattern: Option<String>,
    category: Option<String>,
    description: Option<String>,
) -> Result<i64, String> {
    state
        .database
        .save_dictionary_entry(
            &original_text,
            &replacement_text,
            &match_type,
            is_case_sensitive,
            phonetic_pattern.as_deref(),
            category.as_deref(),
            description.as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn update_dictionary_entry(
    state: State<'_, AppState>,
    id: i64,
    original_text: String,
    replacement_text: String,
    match_type: String,
    is_case_sensitive: bool,
    phonetic_pattern: Option<String>,
    category: Option<String>,
    description: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    state
        .database
        .update_dictionary_entry(
            id,
            &original_text,
            &replacement_text,
            &match_type,
            is_case_sensitive,
            phonetic_pattern.as_deref(),
            category.as_deref(),
            description.as_deref(),
            enabled,
        )
        .await
}

#[tauri::command]
pub async fn delete_dictionary_entry(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.database.delete_dictionary_entry(id).await
}

#[tauri::command]
pub async fn get_dictionary_matches_for_transcript(state: State<'_, AppState>, transcript_id: i64) -> Result<Vec<serde_json::Value>, String> {
    state.database.get_dictionary_matches_for_transcript(transcript_id).await
}

#[tauri::command]
pub async fn test_dictionary_replacement(state: State<'_, AppState>, text: String) -> Result<String, String> {
    let dictionary_processor = crate::dictionary_processor::DictionaryProcessor::new(state.database.clone());
    let (processed_text, _matches) = dictionary_processor.process_transcript(&text, None).await?;
    Ok(processed_text)
}

