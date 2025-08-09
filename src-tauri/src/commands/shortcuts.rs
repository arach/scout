use tauri::State;

use crate::AppState;

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

