use tauri::{Emitter, Manager, State};

use crate::recording_workflow::RecordingResult;
use crate::services::{audio_devices, recording::RecordingService};
use crate::{sound, AppState};

// ============================================================================
// Audio Device Commands
// ============================================================================

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

// ============================================================================
// Core Recording Commands
// ============================================================================

#[tauri::command]
pub async fn start_recording(state: State<'_, AppState>, app: tauri::AppHandle, device_name: Option<String>) -> Result<String, String> {
    if state.progress_tracker.is_busy() {
        crate::logger::warn(crate::logger::Component::Recording, "Attempted to start recording while already recording");
        return Err("Recording already in progress".to_string());
    }
    let recorder = state.recorder.lock().await;
    if recorder.is_recording() {
        drop(recorder);
        crate::logger::warn(crate::logger::Component::Recording, "Audio recorder is already recording");
        return Err("Audio recorder is already active".to_string());
    }
    drop(recorder);

    sound::SoundPlayer::play_start();

    let filename = state.recording_workflow.start_recording(device_name).await?;
    *state.current_recording_file.lock().await = Some(filename.clone());

    if let Some(menu_item) = app.try_state::<tauri::menu::MenuItem<tauri::Wry>>() {
        let _ = menu_item.set_text("Stop Recording");
    }

    #[cfg(target_os = "macos")]
    {
        let overlay = state.native_panel_overlay.lock().await;
        overlay.show();
        overlay.set_recording_state(true);
        drop(overlay);

        let overlay_clone = state.native_panel_overlay.clone();
        let recorder_clone = state.recorder.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
            let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(200));
            let mut consecutive_not_recording = 0;
            loop {
                interval.tick().await;
                let recorder = recorder_clone.lock().await;
                let is_recording = recorder.is_recording();
                let level = recorder.get_current_audio_level();
                drop(recorder);
                if !is_recording {
                    consecutive_not_recording += 1;
                    if consecutive_not_recording > 5 {
                        break;
                    }
                } else {
                    consecutive_not_recording = 0;
                }
                let overlay = overlay_clone.lock().await;
                overlay.set_volume_level(level);
                drop(overlay);
            }
        });
    }

    let _ = app.emit("recording-state-changed", serde_json::json!({
        "state": "recording",
        "filename": &filename
    }));
    Ok(filename)
}

#[tauri::command]
pub async fn cancel_recording(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    state.recording_workflow.cancel_recording().await?;
    state.current_recording_file.lock().await.take();
    if let Some(menu_item) = app.try_state::<tauri::menu::MenuItem<tauri::Wry>>() {
        let _ = menu_item.set_text("Start Recording");
    }
    state.is_recording_overlay_active.store(false, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn stop_recording(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<RecordingResult, String> {
    let result = state.recording_workflow.stop_recording().await?;
    sound::SoundPlayer::play_stop();

    #[cfg(target_os = "macos")]
    {
        let overlay = state.native_panel_overlay.lock().await;
        overlay.set_processing_state(true);
        drop(overlay);
    }

    let filename = state.current_recording_file.lock().await.take();
    if let Some(filename) = filename {
        let recordings_dir = state.recordings_dir.clone();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
                let file_path = recordings_dir.join(&filename);
                let _ = tokio::fs::metadata(&file_path).await;
            });
        } else {
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(async {
                    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
                    let file_path = recordings_dir.join(&filename);
                    let _ = tokio::fs::metadata(&file_path).await;
                });
            });
        }
    }

    if let Some(menu_item) = app.try_state::<tauri::menu::MenuItem<tauri::Wry>>() {
        let _ = menu_item.set_text("Start Recording");
    }
    state.is_recording_overlay_active.store(false, std::sync::atomic::Ordering::Relaxed);
    let _ = app.emit("recording-state-changed", serde_json::json!({ "state": "stopped" }));
    Ok(result)
}

#[tauri::command]
pub async fn is_recording(state: State<'_, AppState>) -> Result<bool, String> {
    let progress = state.progress_tracker.current_state();
    match progress {
        crate::recording_progress::RecordingProgress::Recording { .. } => Ok(true),
        crate::recording_progress::RecordingProgress::Stopping { .. } => Ok(true),
        crate::recording_progress::RecordingProgress::Idle => {
            let recorder = state.recorder.lock().await;
            let is_recording = recorder.is_recording();
            drop(recorder);
            if is_recording {
                crate::logger::warn(crate::logger::Component::Recording, "is_recording mismatch: recorder says true but progress tracker is idle");
            }
            Ok(is_recording)
        }
    }
}

#[tauri::command]
pub async fn log_from_overlay(_message: String) -> Result<(), String> { Ok(()) }

#[tauri::command]
pub async fn get_current_recording_file(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let file = state.current_recording_file.lock().await;
    Ok(file.clone())
}

#[tauri::command]
pub async fn subscribe_to_progress(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    let mut receiver = state.progress_tracker.subscribe();
    tauri::async_runtime::spawn(async move {
        while receiver.changed().await.is_ok() {
            let progress = receiver.borrow().clone();
            let _ = app.emit("recording-progress", &progress);
        }
    });
    Ok(())
}

// ============================================================================
// Alternative Recording Strategies (for testing)
// ============================================================================

#[tauri::command]
pub async fn start_recording_no_transcription(state: State<'_, AppState>) -> Result<String, String> {
    let svc = RecordingService {
        recorder: state.recorder.clone(),
        recording_workflow: state.recording_workflow.clone(),
        progress_tracker: state.progress_tracker.clone(),
        recordings_dir: state.recordings_dir.clone(),
    };
    svc.start_no_transcription().await
}

#[tauri::command]
pub async fn stop_recording_no_transcription(state: State<'_, AppState>) -> Result<String, String> {
    let svc = RecordingService {
        recorder: state.recorder.clone(),
        recording_workflow: state.recording_workflow.clone(),
        progress_tracker: state.progress_tracker.clone(),
        recordings_dir: state.recordings_dir.clone(),
    };
    svc.stop_no_transcription().await
}

#[tauri::command]
pub async fn start_recording_simple_callback_test(state: State<'_, AppState>) -> Result<String, String> {
    let svc = RecordingService {
        recorder: state.recorder.clone(),
        recording_workflow: state.recording_workflow.clone(),
        progress_tracker: state.progress_tracker.clone(),
        recordings_dir: state.recordings_dir.clone(),
    };
    svc.start_simple_callback_test().await
}

#[tauri::command]
pub async fn start_recording_ring_buffer_no_callbacks(state: State<'_, AppState>) -> Result<String, String> {
    let svc = RecordingService {
        recorder: state.recorder.clone(),
        recording_workflow: state.recording_workflow.clone(),
        progress_tracker: state.progress_tracker.clone(),
        recordings_dir: state.recordings_dir.clone(),
    };
    svc.start_ring_buffer_no_callbacks().await
}

#[tauri::command]
pub async fn start_recording_classic_strategy(state: State<'_, AppState>) -> Result<String, String> {
    let svc = RecordingService {
        recorder: state.recorder.clone(),
        recording_workflow: state.recording_workflow.clone(),
        progress_tracker: state.progress_tracker.clone(),
        recordings_dir: state.recordings_dir.clone(),
    };
    svc.start_classic_strategy().await
}

// ============================================================================
// Sound Commands
// ============================================================================

#[tauri::command]
pub async fn set_sound_enabled(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    // Update in-memory state
    sound::SoundPlayer::set_enabled(enabled);
    
    // Persist to settings
    let mut settings = state.settings.lock().await;
    settings
        .update(|s| s.ui.sound_enabled = enabled)
        .map_err(|e| format!("Failed to save sound_enabled setting: {}", e))?;
    
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
pub async fn set_start_sound(state: State<'_, AppState>, sound_name: String) -> Result<(), String> {
    // Update in-memory state
    sound::SoundPlayer::set_start_sound(sound_name.clone());
    
    // Persist to settings
    let mut settings = state.settings.lock().await;
    settings
        .update(|s| s.ui.start_sound = sound_name)
        .map_err(|e| format!("Failed to save start_sound setting: {}", e))?;
    
    Ok(())
}

#[tauri::command]
pub async fn set_stop_sound(state: State<'_, AppState>, sound_name: String) -> Result<(), String> {
    // Update in-memory state
    sound::SoundPlayer::set_stop_sound(sound_name.clone());
    
    // Persist to settings
    let mut settings = state.settings.lock().await;
    settings
        .update(|s| s.ui.stop_sound = sound_name)
        .map_err(|e| format!("Failed to save stop_sound setting: {}", e))?;
    
    Ok(())
}

#[tauri::command]
pub async fn set_success_sound(state: State<'_, AppState>, sound_name: String) -> Result<(), String> {
    // Update in-memory state
    sound::SoundPlayer::set_success_sound(sound_name.clone());
    
    // Persist to settings
    let mut settings = state.settings.lock().await;
    settings
        .update(|s| s.ui.success_sound = sound_name)
        .map_err(|e| format!("Failed to save success_sound setting: {}", e))?;
    
    Ok(())
}

#[tauri::command]
pub async fn preview_sound_flow(state: State<'_, AppState>) -> Result<(), String> {
    // Read threshold from settings to simulate the configured flow
    let threshold_ms = {
        let settings_guard = state.settings.lock().await;
        settings_guard.get().ui.completion_sound_threshold_ms
    };

    // Simulate real sequence: start → slight gap → stop → threshold delay → success
    sound::SoundPlayer::play_start();
    tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;
    sound::SoundPlayer::play_stop();
    tokio::time::sleep(tokio::time::Duration::from_millis(threshold_ms)).await;
    sound::SoundPlayer::play_success();
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