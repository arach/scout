use tauri::State;

use crate::AppState;

#[tauri::command]
pub async fn get_overlay_position(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.settings.lock().await;
    Ok(settings.get().ui.overlay_position.clone())
}

#[tauri::command]
pub async fn set_overlay_position(state: State<'_, AppState>, position: String) -> Result<(), String> {
    let mut settings = state.settings.lock().await;
    settings
        .update(|s| s.ui.overlay_position = position.clone())
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    drop(settings);

    #[cfg(target_os = "macos")]
    {
        let overlay = state.native_panel_overlay.lock().await;
        overlay.set_position(&position);
    }
    Ok(())
}

#[tauri::command]
pub async fn set_overlay_treatment(state: State<'_, AppState>, treatment: String) -> Result<(), String> {
    // Persist to settings
    let mut settings = state.settings.lock().await;
    settings
        .update(|s| s.ui.overlay_treatment = treatment.clone())
        .map_err(|e| format!("Failed to save overlay_treatment setting: {}", e))?;
    drop(settings);
    
    // Update native overlay
    #[cfg(target_os = "macos")]
    {
        let overlay = state.native_panel_overlay.lock().await;
        overlay.set_waveform_style(&treatment);
    }
    Ok(())
}

#[tauri::command]
pub async fn set_overlay_waveform_style(state: State<'_, AppState>, style: String) -> Result<(), String> {
    // Persist to settings (same as overlay_treatment)
    let mut settings = state.settings.lock().await;
    settings
        .update(|s| s.ui.overlay_treatment = style.clone())
        .map_err(|e| format!("Failed to save overlay_waveform_style setting: {}", e))?;
    drop(settings);
    
    // Update native overlay
    #[cfg(target_os = "macos")]
    {
        let overlay = state.native_panel_overlay.lock().await;
        overlay.set_waveform_style(&style);
    }
    Ok(())
}

