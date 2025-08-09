use tauri::{Emitter, Manager, State};

use crate::recording_workflow::RecordingResult;
use crate::{sound, AppState};

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

