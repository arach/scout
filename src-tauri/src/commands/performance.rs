use tauri::State;
use crate::AppState;
use crate::db::PerformanceMetrics;

#[tauri::command]
pub async fn get_performance_metrics(
    state: State<'_, AppState>,
    transcript_id: Option<i64>,
) -> Result<PerformanceMetrics, String> {
    // Get metrics from database
    if let Some(id) = transcript_id {
        match state.database.get_performance_metrics_for_transcript(id).await {
            Ok(Some(metrics)) => Ok(metrics),
            Ok(None) => Err(format!("No metrics found for transcript {}", id)),
            Err(e) => Err(e),
        }
    } else {
        // Return empty metrics if no transcript specified
        Ok(PerformanceMetrics {
            id: 0,
            transcript_id: None,
            recording_duration_ms: 0,
            transcription_time_ms: 0,
            user_perceived_latency_ms: None,
            processing_queue_time_ms: None,
            model_used: None,
            transcription_strategy: None,
            audio_file_size_bytes: None,
            audio_format: None,
            success: true,
            error_message: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            metadata: None,
        })
    }
}

#[tauri::command]
pub async fn get_performance_metrics_for_transcript(
    state: State<'_, AppState>,
    transcript_id: i64,
) -> Result<PerformanceMetrics, String> {
    match state.database.get_performance_metrics_for_transcript(transcript_id).await {
        Ok(Some(metrics)) => Ok(metrics),
        Ok(None) => Err(format!("No metrics found for transcript {}", transcript_id)),
        Err(e) => Err(e),
    }
}

// Timeline methods not implemented in performance_tracker yet
// #[tauri::command]
// pub async fn get_performance_timeline(
//     state: State<'_, AppState>,
// ) -> Result<Vec<crate::performance_tracker::TimelineEntry>, String> {
//     Ok(state.performance_tracker.get_timeline())
// }

// #[tauri::command]
// pub async fn get_performance_timeline_for_transcript(
//     state: State<'_, AppState>,
//     transcript_id: i64,
// ) -> Result<Vec<crate::performance_tracker::TimelineEntry>, String> {
//     state.performance_tracker.get_timeline_for_transcript(transcript_id).await
// }