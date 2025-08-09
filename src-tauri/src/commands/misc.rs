use tauri::State;

use crate::AppState;

#[tauri::command]
pub async fn mark_onboarding_complete(_state: State<'_, AppState>) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn get_processing_status() -> Result<Vec<String>, String> {
    Ok(vec!["Processing queue is active".to_string()])
}

#[tauri::command]
pub async fn paste_text() -> Result<(), String> {
    crate::clipboard::simulate_paste()
}

