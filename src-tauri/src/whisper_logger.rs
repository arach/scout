use chrono::{DateTime, Local, Timelike};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::fs::{create_dir_all, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::logger::{debug, info, Component};

// Global whisper session logger
static WHISPER_SESSION_LOGGER: Lazy<Arc<Mutex<WhisperSessionLogger>>> =
    Lazy::new(|| Arc::new(Mutex::new(WhisperSessionLogger::new())));

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WhisperLogEntry {
    pub timestamp: String, // Store as RFC3339 string for SQLite compatibility
    pub level: String,
    pub component: String,
    pub message: String,
    pub metadata: Option<serde_json::Value>,
}

struct WhisperSessionLogger {
    log_dir: PathBuf,
    active_sessions: std::collections::HashMap<String, WhisperSession>,
}

struct WhisperSession {
    session_id: String,
    file: BufWriter<File>,
    start_time: DateTime<Local>,
    entry_count: usize,
}

impl WhisperSessionLogger {
    fn new() -> Self {
        Self {
            log_dir: PathBuf::new(),
            active_sessions: std::collections::HashMap::new(),
        }
    }
}

pub fn init_whisper_logger(log_dir: &Path) -> Result<(), String> {
    let whisper_log_dir = log_dir.join("whisper_sessions");
    create_dir_all(&whisper_log_dir)
        .map_err(|e| format!("Failed to create whisper log directory: {}", e))?;

    if let Ok(mut logger) = WHISPER_SESSION_LOGGER.lock() {
        logger.log_dir = whisper_log_dir.clone();
    }

    info(
        Component::Transcription,
        &format!(
            "Whisper session logs will be written to: {:?}",
            whisper_log_dir
        ),
    );

    Ok(())
}

pub fn start_whisper_session(session_id: &str) -> Result<PathBuf, String> {
    let mut logger = WHISPER_SESSION_LOGGER
        .lock()
        .map_err(|e| format!("Failed to lock logger: {}", e))?;

    if logger.log_dir.as_os_str().is_empty() {
        return Err("Whisper logger not initialized".to_string());
    }

    // Create session log file: whisper_{session_id}.log
    let log_file_name = format!("whisper_{}.log", session_id);
    let log_path = logger.log_dir.join(&log_file_name);

    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to create session log file: {}", e))?;

    let mut writer = BufWriter::new(file);
    let start_time = Local::now();

    // Write header
    writeln!(
        writer,
        "=== Whisper Session '{}' Started at {} ===",
        session_id,
        start_time.format("%Y-%m-%d %H:%M:%S")
    )
    .map_err(|e| format!("Failed to write header: {}", e))?;
    writeln!(writer, "Session ID: {}", session_id).map_err(|e| e.to_string())?;
    writeln!(
        writer,
        "Log Format: [timestamp] [level] [component] message"
    )
    .map_err(|e| e.to_string())?;
    writeln!(writer, "===\n").map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())?;

    let session = WhisperSession {
        session_id: session_id.to_string(),
        file: writer,
        start_time,
        entry_count: 0,
    };

    logger
        .active_sessions
        .insert(session_id.to_string(), session);

    debug(
        Component::Transcription,
        &format!(
            "Started whisper session '{}', log file: {:?}",
            session_id, log_path
        ),
    );

    Ok(log_path)
}

pub fn end_whisper_session(session_id: &str) -> Option<PathBuf> {
    let mut logger = match WHISPER_SESSION_LOGGER.lock() {
        Ok(l) => l,
        Err(_) => return None,
    };

    if let Some(mut session) = logger.active_sessions.remove(session_id) {
        let end_time = Local::now();
        let duration = end_time.signed_duration_since(session.start_time);

        // Write footer
        let _ = writeln!(session.file, "\n===");
        let _ = writeln!(
            session.file,
            "Session '{}' ended at {}",
            session_id,
            end_time.format("%Y-%m-%d %H:%M:%S")
        );
        let _ = writeln!(session.file, "Duration: {}", duration);
        let _ = writeln!(session.file, "Total entries: {}", session.entry_count);
        let _ = writeln!(session.file, "===");
        let _ = session.file.flush();

        debug(
            Component::Transcription,
            &format!(
                "Ended whisper session '{}' with {} entries",
                session_id, session.entry_count
            ),
        );

        // Return the log file path for post-processing
        Some(logger.log_dir.join(format!("whisper_{}.log", session_id)))
    } else {
        None
    }
}

pub fn write_whisper_log(
    session_id: &str,
    level: &str,
    component: &str,
    message: &str,
    metadata: Option<serde_json::Value>,
) {
    let now = Local::now();
    let entry = WhisperLogEntry {
        timestamp: now.to_rfc3339(),
        level: level.to_string(),
        component: component.to_string(),
        message: message.to_string(),
        metadata,
    };

    if let Ok(mut logger) = WHISPER_SESSION_LOGGER.lock() {
        if let Some(session) = logger.active_sessions.get_mut(session_id) {
            // Format: [HH:MM:SS.mmm] [LEVEL] [COMPONENT] message
            let formatted = format!(
                "[{}] [{}] [{}] {}",
                now.format("%H:%M:%S%.3f"),
                entry.level,
                entry.component,
                entry.message
            );

            let _ = writeln!(session.file, "{}", formatted);

            // Write metadata on next line if present
            if let Some(ref meta) = entry.metadata {
                let _ = writeln!(
                    session.file,
                    "  metadata: {}",
                    serde_json::to_string(meta).unwrap_or_default()
                );
            }

            session.entry_count += 1;

            // Flush periodically (every 10 entries)
            if session.entry_count % 10 == 0 {
                let _ = session.file.flush();
            }
        }
    }
}

// Convenience function to capture whisper stdout/stderr
pub fn capture_whisper_output(session_id: &str, output: &str) {
    // Parse whisper output and categorize it
    let (level, component) = if output.contains("error") || output.contains("failed") {
        ("ERROR", "WHISPER")
    } else if output.contains("warning") || output.contains("warn") {
        ("WARN", "WHISPER")
    } else if output.contains("whisper_full") || output.contains("decoder") {
        ("DEBUG", "WHISPER")
    } else {
        ("INFO", "WHISPER")
    };

    write_whisper_log(session_id, level, component, output.trim(), None);
}

pub fn close_all_sessions() {
    if let Ok(logger) = WHISPER_SESSION_LOGGER.lock() {
        let session_ids: Vec<String> = logger.active_sessions.keys().cloned().collect();

        for session_id in session_ids {
            end_whisper_session(&session_id);
        }
    }
}

// Background task to process whisper log files and store in database
pub async fn process_whisper_logs_to_db(
    log_path: PathBuf,
    session_id: String,
    transcript_id: Option<i64>,
    db: Arc<crate::db::Database>,
) -> Result<(), String> {
    use std::fs::File;
    use std::io::{BufRead, BufReader};

    let file = File::open(&log_path).map_err(|e| format!("Failed to open log file: {}", e))?;
    let reader = BufReader::new(file);

    let mut entries = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read line: {}", e))?;

        // Skip empty lines and headers
        if line.trim().is_empty() || line.starts_with("===") {
            continue;
        }

        // Parse log line: [HH:MM:SS.mmm] [LEVEL] [COMPONENT] message
        if let Some(entry) = parse_log_line(&line) {
            entries.push((session_id.clone(), transcript_id, entry));
        }
    }

    // Batch insert into database
    if !entries.is_empty() {
        db.insert_whisper_logs(entries).await?;
    } else {
        debug(Component::Recording, "No whisper log entries to process");
    }

    // Optionally delete the log file after processing
    // std::fs::remove_file(log_path).ok();

    Ok(())
}

fn parse_log_line(line: &str) -> Option<WhisperLogEntry> {
    // Simple parser for: [HH:MM:SS.mmm] [LEVEL] [COMPONENT] message
    let parts: Vec<&str> = line.splitn(4, ']').collect();
    if parts.len() < 4 {
        return None;
    }

    let _timestamp_str = parts[0].trim_start_matches('[');
    let level_raw = parts[1].trim().trim_start_matches('[');
    let component = parts[2].trim().trim_start_matches('[');
    let message = parts[3].trim();

    // Validate and normalize log level to match DB constraint
    let level = match level_raw.to_uppercase().as_str() {
        "DEBUG" => "DEBUG",
        "INFO" => "INFO",
        "WARN" | "WARNING" => "WARN",
        "ERROR" | "ERR" => "ERROR",
        _ => return None, // Skip entries with invalid log levels
    };

    // Skip header/footer lines
    if line.starts_with("===") || line.starts_with("Session ID:") || line.starts_with("Log Format:")
    {
        return None;
    }

    // For now, use current date with parsed time
    let now = Local::now();
    let timestamp = now.with_hour(0)?.with_minute(0)?.with_second(0)?;

    Some(WhisperLogEntry {
        timestamp: timestamp.to_rfc3339(),
        level: level.to_string(),
        component: component.to_string(),
        message: message.to_string(),
        metadata: None,
    })
}
