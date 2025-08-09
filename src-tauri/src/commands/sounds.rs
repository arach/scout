use tauri::State;

use crate::sound;
use crate::AppState;

#[tauri::command]
pub async fn set_sound_enabled(enabled: bool) -> Result<(), String> {
    sound::SoundPlayer::set_enabled(enabled);
    Ok(())
}

#[tauri::command]
pub async fn is_sound_enabled() -> Result<bool, String> {
    Ok(sound::SoundPlayer::is_enabled())
}

#[tauri::command]
pub async fn get_available_sounds() -> Result<Vec<String>, String> {
    Ok(sound::SoundPlayer::get_available_sounds())
}

#[tauri::command]
pub async fn get_sound_settings() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "startSound": sound::SoundPlayer::get_start_sound(),
        "stopSound": sound::SoundPlayer::get_stop_sound(),
        "successSound": sound::SoundPlayer::get_success_sound()
    }))
}

#[tauri::command]
pub async fn set_start_sound(sound_name: String) -> Result<(), String> {
    sound::SoundPlayer::set_start_sound(sound_name);
    Ok(())
}

#[tauri::command]
pub async fn set_stop_sound(sound_name: String) -> Result<(), String> {
    sound::SoundPlayer::set_stop_sound(sound_name);
    Ok(())
}

#[tauri::command]
pub async fn set_success_sound(sound_name: String) -> Result<(), String> {
    sound::SoundPlayer::set_success_sound(sound_name);
    Ok(())
}

#[tauri::command]
pub async fn preview_sound_flow() -> Result<(), String> {
    sound::SoundPlayer::preview_sound_flow().await;
    Ok(())
}

#[tauri::command]
pub async fn play_success_sound() -> Result<(), String> {
    sound::SoundPlayer::play_success();
    Ok(())
}

#[tauri::command]
pub async fn update_completion_sound_threshold(state: State<'_, AppState>, threshold_ms: i32) -> Result<(), String> {
    let mut settings = state.settings.lock().await;
    settings
        .update(|s| s.ui.completion_sound_threshold_ms = threshold_ms as u64)
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    Ok(())
}

