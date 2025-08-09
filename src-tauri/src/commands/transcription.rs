use tauri::State;

use crate::services::transcription::TranscriptionService;
use crate::AppState;

#[tauri::command]
pub async fn transcribe_audio(state: State<'_, AppState>, audio_filename: String) -> Result<String, String> {
    let svc = TranscriptionService {
        recordings_dir: state.recordings_dir.clone(),
        models_dir: state.models_dir.clone(),
        processing_queue: state.processing_queue.clone(),
        transcriber: state.transcriber.clone(),
        current_model_path: state.current_model_path.clone(),
        settings: state.settings.clone(),
    };
    svc.transcribe_audio(audio_filename).await
}

#[tauri::command]
pub async fn transcribe_file(state: State<'_, AppState>, file_path: String, app: tauri::AppHandle) -> Result<String, String> {
    let svc = TranscriptionService {
        recordings_dir: state.recordings_dir.clone(),
        models_dir: state.models_dir.clone(),
        processing_queue: state.processing_queue.clone(),
        transcriber: state.transcriber.clone(),
        current_model_path: state.current_model_path.clone(),
        settings: state.settings.clone(),
    };
    svc.transcribe_file(file_path, &app).await
}

