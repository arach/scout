use tauri::State;

use crate::db;
use crate::performance_tracker;
use crate::services::diagnostics as diag;
use crate::AppState;

// ============================================================================
// Diagnostics Commands
// ============================================================================

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

// ============================================================================
// Logging Commands
// ============================================================================

#[tauri::command]
pub async fn get_log_file_path() -> Result<Option<String>, String> {
    Ok(crate::logger::get_log_file_path().map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn open_log_file() -> Result<(), String> {
    use std::process::Command;
    if let Some(log_path) = crate::logger::get_log_file_path() {
        #[cfg(target_os = "macos")]
        { Command::new("open").arg(&log_path).spawn().map_err(|e| format!("Failed to open log file: {}", e))?; }
        #[cfg(target_os = "windows")]
        { Command::new("notepad").arg(&log_path).spawn().map_err(|e| format!("Failed to open log file: {}", e))?; }
        #[cfg(target_os = "linux")]
        { Command::new("xdg-open").arg(&log_path).spawn().map_err(|e| format!("Failed to open log file: {}", e))?; }
        Ok(())
    } else {
        Err("No log file found".to_string())
    }
}

#[tauri::command]
pub async fn show_log_file_in_finder() -> Result<(), String> {
    use std::process::Command;
    if let Some(log_path) = crate::logger::get_log_file_path() {
        #[cfg(target_os = "macos")]
        { Command::new("open").arg("-R").arg(&log_path).spawn().map_err(|e| format!("Failed to reveal log file in Finder: {}", e))?; }
        #[cfg(target_os = "windows")]
        { Command::new("explorer").arg("/select,").arg(&log_path).spawn().map_err(|e| format!("Failed to reveal log file in Explorer: {}", e))?; }
        #[cfg(target_os = "linux")]
        {
            if let Some(parent) = log_path.parent() {
                Command::new("xdg-open").arg(parent).spawn().map_err(|e| format!("Failed to open logs directory: {}", e))?;
            } else {
                return Err("Could not find logs directory".to_string());
            }
        }
        Ok(())
    } else {
        Err("No log file found".to_string())
    }
}

// ============================================================================
// Performance Monitoring Commands
// ============================================================================

#[derive(serde::Serialize)]
pub struct DayActivity {
    pub date: String,
    pub count: i32,
    pub duration_ms: i64,
    pub words: i64,
}

#[derive(serde::Serialize)]
pub struct RecordingStats {
    pub total_recordings: i32,
    pub total_duration: i64,
    pub total_words: i64,
    pub current_streak: i32,
    pub longest_streak: i32,
    pub average_daily: f64,
    pub most_active_day: String,
    pub most_active_hour: i32,
    pub daily_activity: Vec<DayActivity>,
    pub weekly_distribution: Vec<(String, i32)>,
    pub hourly_distribution: Vec<(i32, i32)>,
}

#[tauri::command]
pub async fn generate_sample_data(state: State<'_, AppState>) -> Result<String, String> {
    use chrono::{Datelike, Duration, Local, Timelike, Weekday};
    eprintln!("Generating sample transcript data...");
    let now = Local::now();
    let mut generated_count = 0;
    for days_ago in 0..180 {
        let date = now - Duration::days(days_ago);
        let skip_chance = match date.weekday() { Weekday::Sat | Weekday::Sun => 0.7, _ => 0.2 };
        let date_seed = (date.day() * date.month() * ((days_ago + 1) as u32)) as f32;
        if (date_seed % 100.0) / 100.0 < skip_chance { continue; }
        let base_recordings = match date.weekday() {
            Weekday::Mon | Weekday::Wed | Weekday::Fri => 3..=7,
            Weekday::Tue | Weekday::Thu => 2..=5,
            Weekday::Sat | Weekday::Sun => 1..=3,
        };
        let num_recordings = ((date_seed as usize % 5) + base_recordings.start()).min(*base_recordings.end());
        for recording_num in 0..num_recordings {
            let hour = match recording_num % 5 { 0 => 9 + (date_seed as u32 % 2), 1 => 11 + (date_seed as u32 % 2), 2 => 14 + (date_seed as u32 % 2), 3 => 16 + (date_seed as u32 % 2), _ => 10 + (date_seed as u32 % 8) };
            let minute = (date_seed as u32 * ((recording_num + 1) as u32)) % 60;
            let duration_ms = match hour { 9..=11 => 60000 + ((date_seed as i32 * 1000) % 180000), 14..=16 => 120000 + ((date_seed as i32 * 1500) % 240000), _ => 90000 + ((date_seed as i32 * 800) % 150000) };
            let words_per_minute = 150 + ((date_seed as i32) % 50);
            let words = (duration_ms / 60000) * words_per_minute;
            let text = format!("Sample recording from {} at {}:{:02}. This is recording {} of {} for the day. The recording lasted {} seconds and contains approximately {} words of transcribed content. This demonstrates typical usage patterns with varying activity levels throughout the week.", date.format("%A, %B %d, %Y"), hour, minute, recording_num + 1, num_recordings, duration_ms / 1000, words);
            let created_at = date.with_hour(hour).unwrap().with_minute(minute).unwrap().with_second(0).unwrap().format("%Y-%m-%d %H:%M:%S").to_string();
            match state.database.save_transcript_with_timestamp(&text, duration_ms, None, None, &created_at).await { Ok(_) => generated_count += 1, Err(e) => eprintln!("Failed to create sample transcript: {}", e) }
        }
    }
    Ok(format!("Generated {} sample transcripts over 180 days", generated_count))
}

#[tauri::command]
pub async fn get_recording_stats(state: State<'_, AppState>) -> Result<RecordingStats, String> {
    use chrono::{DateTime, Datelike, Local, NaiveDate, NaiveDateTime, TimeZone, Timelike, Weekday, Duration};
    use std::collections::HashMap;
    eprintln!("get_recording_stats called");
    let all_transcripts = state.database.get_recent_transcripts(10000).await?;
    eprintln!("Found {} transcripts", all_transcripts.len());
    if all_transcripts.is_empty() {
        eprintln!("No transcripts found, returning demo data...");
        let now = Local::now();
        let mut daily_activity = Vec::new();
        let mut weekly_dist = HashMap::new();
        let mut hourly_dist = HashMap::new();
        for days_ago in 0..90 {
            let date = now - Duration::days(days_ago);
            let date_str = date.format("%Y-%m-%d").to_string();
            let (count, duration, words) = match date.weekday() {
                Weekday::Sat | Weekday::Sun => { if days_ago % 3 == 0 { (1, 60000 + (days_ago as i32 * 1000) % 120000, 200 + (days_ago as i32 * 10) % 300) } else { (0, 0, 0) } }
                _ => { let base_count = 2 + (days_ago % 3) as i32; let base_duration = 120000 + (days_ago as i32 * 2000) % 180000; let base_words = 400 + (days_ago as i32 * 20) % 500; (base_count, base_duration, base_words) }
            };
            if count > 0 {
                daily_activity.push(DayActivity { date: date_str, count, duration_ms: duration as i64, words: words as i64 });
                let weekday = match date.weekday() { Weekday::Mon => "Mon", Weekday::Tue => "Tue", Weekday::Wed => "Wed", Weekday::Thu => "Thu", Weekday::Fri => "Fri", Weekday::Sat => "Sat", Weekday::Sun => "Sun", }.to_string();
                *weekly_dist.entry(weekday).or_insert(0) += count;
                let hour = (9 + (days_ago % 10)) as i32; *hourly_dist.entry(hour).or_insert(0) += count;
            }
        }
        let weekly_distribution: Vec<(String, i32)> = vec![
            ("Mon".to_string(), *weekly_dist.get("Mon").unwrap_or(&0)),
            ("Tue".to_string(), *weekly_dist.get("Tue").unwrap_or(&0)),
            ("Wed".to_string(), *weekly_dist.get("Wed").unwrap_or(&0)),
            ("Thu".to_string(), *weekly_dist.get("Thu").unwrap_or(&0)),
            ("Fri".to_string(), *weekly_dist.get("Fri").unwrap_or(&0)),
            ("Sat".to_string(), *weekly_dist.get("Sat").unwrap_or(&0)),
            ("Sun".to_string(), *weekly_dist.get("Sun").unwrap_or(&0)),
        ];
        let mut hourly_distribution: Vec<(i32, i32)> = hourly_dist.into_iter().collect();
        hourly_distribution.sort_by_key(|&(hour, _)| hour);
        let total_recordings: i32 = daily_activity.iter().map(|d| d.count).sum();
        let total_duration: i64 = daily_activity.iter().map(|d| d.duration_ms).sum();
        let total_words: i64 = daily_activity.iter().map(|d| d.words).sum();
        return Ok(RecordingStats { total_recordings, total_duration, total_words, current_streak: 3, longest_streak: 12, average_daily: total_recordings as f64 / 90.0, most_active_day: "Wednesday".to_string(), most_active_hour: 14, daily_activity, weekly_distribution, hourly_distribution });
    }
    eprintln!("Processing {} real transcripts", all_transcripts.len());
    let total_recordings = all_transcripts.len() as i32;
    let total_duration: i64 = all_transcripts.iter().map(|t| t.duration_ms as i64).sum();
    let total_words: i64 = all_transcripts.iter().map(|t| t.text.split_whitespace().count() as i64).sum();
    let mut daily_map: HashMap<String, (i32, i64, i64)> = HashMap::new();
    let mut weekday_map: HashMap<Weekday, i32> = HashMap::new();
    let mut hour_map: HashMap<i32, i32> = HashMap::new();
    for transcript in &all_transcripts {
        let created_at = if let Ok(dt) = DateTime::parse_from_rfc3339(&transcript.created_at) { dt.with_timezone(&Local) } else if let Ok(naive_dt) = NaiveDateTime::parse_from_str(&transcript.created_at, "%Y-%m-%d %H:%M:%S") { Local.from_local_datetime(&naive_dt).single().ok_or_else(|| format!("Ambiguous local time: {}", transcript.created_at))? } else if let Ok(naive_dt) = transcript.created_at.parse::<chrono::NaiveDateTime>() { Local.from_local_datetime(&naive_dt).single().ok_or_else(|| format!("Ambiguous local time: {}", transcript.created_at))? } else { return Err(format!("Failed to parse timestamp: {} (expected RFC3339 or YYYY-MM-DD HH:MM:SS format)", transcript.created_at)); };
        let date_str = created_at.format("%Y-%m-%d").to_string();
        let words = transcript.text.split_whitespace().count() as i64;
        let entry = daily_map.entry(date_str).or_insert((0, 0, 0));
        entry.0 += 1; entry.1 += transcript.duration_ms as i64; entry.2 += words;
        *weekday_map.entry(created_at.weekday()).or_insert(0) += 1;
        *hour_map.entry(created_at.hour() as i32).or_insert(0) += 1;
    }
    let mut daily_activity: Vec<DayActivity> = daily_map.into_iter().map(|(date, (count, duration, words))| DayActivity { date, count, duration_ms: duration, words }).collect();
    daily_activity.sort_by(|a, b| a.date.cmp(&b.date));
    let mut current_streak = 0; let mut longest_streak = 0; let mut temp_streak = 0; let mut last_date: Option<NaiveDate> = None;
    let today = Local::now().date_naive();
    for activity in &daily_activity {
        let date = NaiveDate::parse_from_str(&activity.date, "%Y-%m-%d").map_err(|_| "Failed to parse date")?;
        if let Some(last) = last_date { let diff = date.signed_duration_since(last).num_days(); if diff == 1 { temp_streak += 1; } else { longest_streak = longest_streak.max(temp_streak); temp_streak = 1; } } else { temp_streak = 1; }
        last_date = Some(date);
        if date == today || date == today.pred_opt().unwrap_or(today) { current_streak = temp_streak; }
    }
    longest_streak = longest_streak.max(temp_streak);
    let days_with_recordings = daily_activity.len() as f64;
    let average_daily = if days_with_recordings > 0.0 { total_recordings as f64 / days_with_recordings } else { 0.0 };
    let most_active_day = weekday_map.iter().max_by_key(|(_, count)| *count).map(|(weekday, _)| format!("{:?}", weekday)).unwrap_or_else(|| "Monday".to_string());
    let most_active_hour = hour_map.iter().max_by_key(|(_, count)| *count).map(|(hour, _)| *hour).unwrap_or(0);
    let weekly_distribution = vec![
        ("Monday".to_string(), *weekday_map.get(&Weekday::Mon).unwrap_or(&0)),
        ("Tuesday".to_string(), *weekday_map.get(&Weekday::Tue).unwrap_or(&0)),
        ("Wednesday".to_string(), *weekday_map.get(&Weekday::Wed).unwrap_or(&0)),
        ("Thursday".to_string(), *weekday_map.get(&Weekday::Thu).unwrap_or(&0)),
        ("Friday".to_string(), *weekday_map.get(&Weekday::Fri).unwrap_or(&0)),
        ("Saturday".to_string(), *weekday_map.get(&Weekday::Sat).unwrap_or(&0)),
        ("Sunday".to_string(), *weekday_map.get(&Weekday::Sun).unwrap_or(&0)),
    ];
    let hourly_distribution: Vec<(i32, i32)> = (0..24).map(|h| (h, *hour_map.get(&h).unwrap_or(&0))).collect();
    Ok(RecordingStats { total_recordings, total_duration, total_words, current_streak, longest_streak, average_daily, most_active_day, most_active_hour, daily_activity, weekly_distribution, hourly_distribution })
}

#[tauri::command]
pub async fn get_performance_metrics(
    state: State<'_, AppState>,
    transcript_id: Option<i64>,
) -> Result<db::PerformanceMetrics, String> {
    // Get metrics from database
    if let Some(id) = transcript_id {
        match state.database.get_performance_metrics_for_transcript(id).await {
            Ok(Some(metrics)) => Ok(metrics),
            Ok(None) => Err(format!("No metrics found for transcript {}", id)),
            Err(e) => Err(e),
        }
    } else {
        // Return empty metrics if no transcript specified
        Ok(db::PerformanceMetrics {
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
) -> Result<db::PerformanceMetrics, String> {
    match state.database.get_performance_metrics_for_transcript(transcript_id).await {
        Ok(Some(metrics)) => Ok(metrics),
        Ok(None) => Err(format!("No metrics found for transcript {}", transcript_id)),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn get_performance_timeline(
    state: State<'_, AppState>,
) -> Result<Option<performance_tracker::PerformanceTimeline>, String> {
    Ok(state.performance_tracker.get_current_timeline().await)
}

#[tauri::command]
pub async fn get_performance_timeline_for_transcript(
    state: State<'_, AppState>,
    transcript_id: i64,
) -> Result<Vec<serde_json::Value>, String> {
    state.database.get_performance_timeline_for_transcript(transcript_id).await
}

// ============================================================================
// Permission Commands
// ============================================================================

#[tauri::command]
pub async fn check_microphone_permission() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use cpal::traits::HostTrait;
        let host = cpal::default_host();
        return Ok(match host.default_input_device() { Some(_) => "granted", None => "denied" }.to_string());
    }
    #[cfg(not(target_os = "macos"))]
    { Ok("granted".to_string()) }
}

#[tauri::command]
pub async fn request_microphone_permission() -> Result<String, String> {
    check_microphone_permission().await
}

#[tauri::command]
pub async fn open_system_preferences_audio() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .spawn()
            .map_err(|e| format!("Failed to open system preferences: {}", e))?;
    }
    Ok(())
}