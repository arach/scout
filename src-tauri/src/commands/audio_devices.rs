use tauri::State;

use crate::services::audio_devices;
use crate::AppState;

#[tauri::command]
pub async fn get_audio_devices() -> Result<Vec<String>, String> {
    audio_devices::list_device_names()
}

#[tauri::command]
pub async fn get_audio_devices_detailed() -> Result<Vec<audio_devices::AudioDeviceInfo>, String> {
    audio_devices::list_devices_detailed()
}

#[tauri::command]
pub async fn start_audio_level_monitoring(state: State<'_, AppState>, device_name: Option<String>) -> Result<(), String> {
    let recorder = state.recorder.lock().await;
    recorder.start_audio_level_monitoring(device_name.as_deref())
}

#[tauri::command]
pub async fn stop_audio_level_monitoring(state: State<'_, AppState>) -> Result<(), String> {
    let recorder = state.recorder.lock().await;
    recorder.stop_audio_level_monitoring()
}

#[tauri::command]
pub async fn get_current_audio_level(state: State<'_, AppState>) -> Result<f32, String> {
    let recorder = state.recorder.lock().await;
    Ok(recorder.get_current_audio_level())
}

