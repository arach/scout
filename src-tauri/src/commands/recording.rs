use tauri::State;

use crate::services::recording::RecordingService;
use crate::AppState;

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

