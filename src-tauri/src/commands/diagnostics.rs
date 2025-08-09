use tauri::State;

use crate::services::diagnostics as diag;
use crate::AppState;

#[tauri::command]
pub async fn analyze_audio_corruption(file_path: String) -> Result<serde_json::Value, String> {
    diag::analyze_audio_corruption(&file_path).await
}

#[tauri::command]
pub async fn test_simple_recording(state: State<'_, AppState>) -> Result<String, String> {
    let svc = diag::DiagnosticsService { recordings_dir: state.recordings_dir.clone(), recorder: state.recorder.clone() };
    svc.test_simple_recording().await
}

#[tauri::command]
pub async fn test_device_config_consistency(state: State<'_, AppState>) -> Result<String, String> {
    let svc = diag::DiagnosticsService { recordings_dir: state.recordings_dir.clone(), recorder: state.recorder.clone() };
    svc.test_device_config_consistency().await
}

#[tauri::command]
pub async fn test_voice_with_sample_rate_mismatch(state: State<'_, AppState>) -> Result<diag::VoiceTestResult, String> {
    let svc = diag::DiagnosticsService { recordings_dir: state.recordings_dir.clone(), recorder: state.recorder.clone() };
    svc.test_voice_with_sample_rate_mismatch().await
}

#[tauri::command]
pub async fn test_sample_rate_mismatch_reproduction(state: State<'_, AppState>) -> Result<String, String> {
    let svc = diag::DiagnosticsService { recordings_dir: state.recordings_dir.clone(), recorder: state.recorder.clone() };
    svc.test_sample_rate_mismatch_reproduction().await
}

#[tauri::command]
pub async fn test_multiple_scout_recordings(state: State<'_, AppState>) -> Result<String, String> {
    let svc = diag::DiagnosticsService { recordings_dir: state.recordings_dir.clone(), recorder: state.recorder.clone() };
    svc.test_multiple_scout_recordings().await
}

#[tauri::command]
pub async fn test_scout_pipeline_recording(state: State<'_, AppState>) -> Result<String, String> {
    let svc = diag::DiagnosticsService { recordings_dir: state.recordings_dir.clone(), recorder: state.recorder.clone() };
    svc.test_scout_pipeline_recording().await
}

