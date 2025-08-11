use tauri::{Emitter, State};

use crate::AppState;

// ============================================================================
// Overlay Commands
// ============================================================================

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

// ============================================================================
// Shortcut Commands
// ============================================================================

#[tauri::command]
pub async fn update_global_shortcut(app: tauri::AppHandle, state: State<'_, AppState>, shortcut: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let global_shortcut = app.global_shortcut();
    let mut settings = state.settings.lock().await;
    let current = settings.get().ui.hotkey.clone();
    let _ = global_shortcut.unregister(current.as_str());
    let app_handle = app.clone();
    global_shortcut
        .on_shortcut(shortcut.as_str(), move |_app, _event, _shortcut| {
            if let Err(e) = app_handle.emit("toggle-recording", ()) {
                crate::logger::error(crate::logger::Component::UI, &format!("Failed to emit toggle-recording event: {}", e));
            }
        })
        .map_err(|e| format!("Failed to register shortcut '{}': {}", shortcut, e))?;
    settings
        .update(|s| s.ui.hotkey = shortcut.clone())
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_current_shortcut(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.settings.lock().await;
    Ok(settings.get().ui.hotkey.clone())
}

#[tauri::command]
pub async fn get_push_to_talk_shortcut(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.settings.lock().await;
    Ok(settings.get().ui.push_to_talk_hotkey.clone())
}

#[tauri::command]
pub async fn update_push_to_talk_shortcut(app: tauri::AppHandle, state: State<'_, AppState>, shortcut: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let global_shortcut = app.global_shortcut();
    let mut settings = state.settings.lock().await;
    let current = settings.get().ui.push_to_talk_hotkey.clone();
    let _ = global_shortcut.unregister(current.as_str());
    let app_handle = app.clone();
    global_shortcut
        .on_shortcut(shortcut.as_str(), move |_app, _event, _shortcut| {
            if let Err(e) = app_handle.emit("push-to-talk-pressed", ()) {
                crate::logger::error(crate::logger::Component::UI, &format!("Failed to emit push-to-talk-pressed event: {}", e));
            }
        })
        .map_err(|e| format!("Failed to register push-to-talk shortcut '{}': {}", shortcut, e))?;
    state.keyboard_monitor.set_push_to_talk_key(&shortcut);
    settings
        .update(|s| s.ui.push_to_talk_hotkey = shortcut.clone())
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    Ok(())
}

// ============================================================================
// Clipboard Commands (from misc.rs)
// ============================================================================

#[tauri::command]
pub async fn paste_text() -> Result<(), String> {
    crate::clipboard::simulate_paste()
}

// ============================================================================
// Onboarding Command (from misc.rs)
// ============================================================================

#[tauri::command]
pub async fn mark_onboarding_complete(_state: State<'_, AppState>) -> Result<(), String> {
    Ok(())
}

// ============================================================================
// Processing Status Command (from misc.rs)
// ============================================================================

#[tauri::command]
pub async fn get_processing_status() -> Result<Vec<String>, String> {
    Ok(vec!["Processing queue is active".to_string()])
}