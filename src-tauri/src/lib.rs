mod audio;
mod db;
mod transcription;

use audio::AudioRecorder;
use db::Database;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Manager, State};
use tokio::sync::Mutex;

pub struct AppState {
    pub recorder: Arc<Mutex<AudioRecorder>>,
    pub database: Arc<Database>,
    pub recordings_dir: PathBuf,
}

#[tauri::command]
async fn start_recording(state: State<'_, AppState>) -> Result<String, String> {
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let filename = format!("recording_{}.wav", timestamp);
    let path = state.recordings_dir.join(&filename);

    let recorder = state.recorder.lock().await;
    recorder.start_recording(&path)?;

    Ok(filename)
}

#[tauri::command]
async fn stop_recording(state: State<'_, AppState>) -> Result<(), String> {
    let recorder = state.recorder.lock().await;
    recorder.stop_recording()
}

#[tauri::command]
async fn is_recording(state: State<'_, AppState>) -> Result<bool, String> {
    let recorder = state.recorder.lock().await;
    Ok(recorder.is_recording())
}

#[tauri::command]
async fn transcribe_audio(
    state: State<'_, AppState>,
    audio_filename: String,
) -> Result<String, String> {
    let _audio_path = state.recordings_dir.join(audio_filename);
    
    // TODO: Implement transcription with whisper.cpp
    // For now, return a placeholder
    Ok("Transcription will be implemented with whisper.cpp".to_string())
}

#[tauri::command]
async fn save_transcript(
    state: State<'_, AppState>,
    text: String,
    duration_ms: i32,
) -> Result<i64, String> {
    state.database.save_transcript(&text, duration_ms, None).await
}

#[tauri::command]
async fn get_recent_transcripts(
    state: State<'_, AppState>,
    limit: i32,
) -> Result<Vec<db::Transcript>, String> {
    state.database.get_recent_transcripts(limit).await
}

#[tauri::command]
async fn search_transcripts(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<db::Transcript>, String> {
    state.database.search_transcripts(&query).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            let recordings_dir = app_data_dir.join("recordings");
            std::fs::create_dir_all(&recordings_dir).expect("Failed to create recordings directory");

            let db_path = app_data_dir.join("scout.db");
            let database = tauri::async_runtime::block_on(async {
                Database::new(&db_path).await.expect("Failed to initialize database")
            });

            let mut recorder = AudioRecorder::new();
            recorder.init();
            
            let state = AppState {
                recorder: Arc::new(Mutex::new(recorder)),
                database: Arc::new(database),
                recordings_dir,
            };

            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            is_recording,
            transcribe_audio,
            save_transcript,
            get_recent_transcripts,
            search_transcripts
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
