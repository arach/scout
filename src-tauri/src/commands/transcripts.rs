use tauri::{Emitter, State};

use crate::db;
use crate::services::transcripts::TranscriptsService;
use crate::AppState;

// Helper functions for export that don't need database access
fn export_transcripts_markdown_static(transcripts: &[db::Transcript]) -> Result<String, String> {
    let mut output = String::from("# Scout Transcripts\n\n");
    for transcript in transcripts {
        output.push_str(&format!(
            "## {}\n\n{}\n\n*Duration: {}ms*\n\n---\n\n",
            transcript.created_at,
            transcript.text,
            transcript.duration_ms
        ));
    }
    Ok(output)
}

fn export_transcripts_text_static(transcripts: &[db::Transcript]) -> Result<String, String> {
    let mut output = String::new();
    for transcript in transcripts {
        output.push_str(&format!(
            "[{}] ({}ms):\n{}\n\n",
            transcript.created_at,
            transcript.duration_ms,
            transcript.text
        ));
    }
    Ok(output)
}

#[tauri::command]
pub async fn save_transcript(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    text: String,
    duration_ms: i32,
) -> Result<i64, String> {
    let settings = state.settings.lock().await;
    let active_model = settings.get().models.active_model_id.clone();
    drop(settings);
    let metadata = serde_json::json!({
        "model_used": active_model,
        "processing_type": "manual_save"
    })
    .to_string();
    let transcript = state
        .database
        .save_transcript(&text, duration_ms, Some(&metadata), None, None)
        .await?;
    let _ = app.emit("transcript-created", &transcript);
    crate::webhooks::events::trigger_webhook_delivery_async(state.database.clone(), transcript.clone());
    Ok(transcript.id)
}

#[tauri::command]
pub async fn get_recent_transcripts(state: State<'_, AppState>, limit: i32) -> Result<Vec<db::Transcript>, String> {
    let svc = TranscriptsService { database: state.database.clone(), performance_tracker: state.performance_tracker.clone() };
    svc.get_recent_transcripts(limit).await
}

#[tauri::command]
pub async fn get_transcript(state: State<'_, AppState>, transcript_id: i64) -> Result<Option<db::Transcript>, String> {
    let svc = TranscriptsService { database: state.database.clone(), performance_tracker: state.performance_tracker.clone() };
    svc.get_transcript(transcript_id).await
}

#[derive(serde::Serialize)]
pub struct TranscriptWithAudioDetails {
    pub transcript: db::Transcript,
    pub audio_metadata: Option<serde_json::Value>,
    pub performance_metrics: Option<db::PerformanceMetrics>,
}

#[tauri::command]
pub async fn get_transcript_with_audio_details(
    state: State<'_, AppState>,
    transcript_id: i64,
) -> Result<Option<TranscriptWithAudioDetails>, String> {
    let transcript = match state.database.get_transcript(transcript_id).await? {
        Some(t) => t,
        None => return Ok(None),
    };
    let audio_metadata = transcript
        .audio_metadata
        .as_ref()
        .and_then(|json_str| serde_json::from_str::<serde_json::Value>(json_str).ok());
    let performance_metrics = state
        .database
        .get_performance_metrics_for_transcript(transcript_id)
        .await?;
    Ok(Some(TranscriptWithAudioDetails { transcript, audio_metadata, performance_metrics }))
}

#[tauri::command]
pub async fn search_transcripts(state: State<'_, AppState>, query: String) -> Result<Vec<db::Transcript>, String> {
    let svc = TranscriptsService { database: state.database.clone(), performance_tracker: state.performance_tracker.clone() };
    svc.search_transcripts(query).await
}

#[tauri::command]
pub async fn delete_transcript(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let svc = TranscriptsService { database: state.database.clone(), performance_tracker: state.performance_tracker.clone() };
    svc.delete_transcript(id).await
}

#[tauri::command]
pub async fn delete_transcripts(state: State<'_, AppState>, ids: Vec<i64>) -> Result<(), String> {
    let svc = TranscriptsService { database: state.database.clone(), performance_tracker: state.performance_tracker.clone() };
    svc.delete_transcripts(ids).await
}

#[tauri::command]
pub async fn export_transcripts(transcripts: Vec<db::Transcript>, format: String) -> Result<String, String> {
    // These are static utility functions that don't need database access
    match format.as_str() {
        "json" => serde_json::to_string_pretty(&transcripts).map_err(|e| format!("Failed to serialize to JSON: {}", e)),
        "markdown" => export_transcripts_markdown_static(&transcripts),
        "text" => export_transcripts_text_static(&transcripts),
        _ => Err("Invalid export format".to_string()),
    }
}

#[tauri::command]
pub async fn export_audio_file(source_path: String, destination_path: String) -> Result<(), String> {
    use std::path::Path;
    let source = Path::new(&source_path);
    if !source.exists() {
        return Err("Source audio file not found".to_string());
    }
    std::fs::copy(source_path, destination_path).map_err(|e| format!("Failed to copy audio file: {}", e))?;
    Ok(())
}

