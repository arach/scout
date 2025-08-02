use chrono::Local;
use once_cell::sync::Lazy;
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Log levels for Scout application
#[derive(Debug, Clone, Copy)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

/// Components in Scout application
#[derive(Debug, Clone, Copy)]
pub enum Component {
    Overlay,
    Recording,
    Transcription,
    RingBuffer,
    Processing,
    FFI,
    UI,
    Models,
    Webhooks,
}

impl Component {
    fn as_str(&self) -> &'static str {
        match self {
            Component::Overlay => "OVLY",
            Component::Recording => "RCRD",
            Component::Transcription => "TRNS",
            Component::RingBuffer => "RING",
            Component::Processing => "PROC",
            Component::FFI => "FFI ", // Extra space for alignment
            Component::UI => "UI  ",  // Extra spaces for alignment
            Component::Models => "MODL",
            Component::Webhooks => "WHOK",
        }
    }
}

impl LogLevel {
    fn emoji(&self) -> &'static str {
        match self {
            LogLevel::Debug => "🔍",
            LogLevel::Info => "📊",
            LogLevel::Warn => "⚠️",
            LogLevel::Error => "❌",
        }
    }

    fn as_str(&self) -> &'static str {
        match self {
            LogLevel::Debug => "DEBUG",
            LogLevel::Info => "INFO ",
            LogLevel::Warn => "WARN ",
            LogLevel::Error => "ERROR",
        }
    }
}

struct Logger {
    writer: Arc<Mutex<Option<BufWriter<File>>>>,
    log_file_path: Arc<Mutex<Option<PathBuf>>>,
}

impl Logger {
    fn new() -> Self {
        Self {
            writer: Arc::new(Mutex::new(None)),
            log_file_path: Arc::new(Mutex::new(None)),
        }
    }

    fn initialize(&self, app_data_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
        let logs_dir = app_data_dir.join("logs");
        std::fs::create_dir_all(&logs_dir)?;

        let log_file_name = format!("scout-{}.log", Local::now().format("%Y%m%d"));
        let log_file_path = logs_dir.join(log_file_name);

        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_file_path)?;

        let writer = BufWriter::new(file);

        *self.writer.lock().unwrap() = Some(writer);
        *self.log_file_path.lock().unwrap() = Some(log_file_path.clone());

        // Log initialization message
        self.write_log_entry(
            "INIT",
            "INFO ",
            "📊",
            "Logger initialized",
            &format!("Log file: {:?}", log_file_path),
        );

        Ok(())
    }

    fn write_log_entry(
        &self,
        component: &str,
        level: &str,
        emoji: &str,
        message: &str,
        context: &str,
    ) {
        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let log_line = if context.is_empty() {
            format!("[{}] {} [{}] {}\n", timestamp, level, component, message)
        } else {
            format!(
                "[{}] {} [{}] {} - {}\n",
                timestamp, level, component, message, context
            )
        };

        // Write to file
        if let Ok(mut writer_guard) = self.writer.lock() {
            if let Some(ref mut writer) = *writer_guard {
                if let Err(e) = writer.write_all(log_line.as_bytes()) {
                    eprintln!("Failed to write to log file: {}", e);
                }
                if let Err(e) = writer.flush() {
                    eprintln!("Failed to flush log file: {}", e);
                }
            }
        }

        // Also write to console with emoji for development
        let timestamp_str = timestamp.to_string();
        let short_timestamp = timestamp_str.split(' ').nth(1).unwrap_or(&timestamp_str);
        let console_line = if context.is_empty() {
            format!(
                "[{}] {} [{}] {}",
                short_timestamp, emoji, component, message
            )
        } else {
            format!(
                "[{}] {} [{}] {} - {}",
                short_timestamp, emoji, component, message, context
            )
        };
        println!("{}", console_line);
    }
}

static LOGGER: Lazy<Arc<Logger>> = Lazy::new(|| Arc::new(Logger::new()));

/// Initialize the logger with the app data directory
pub fn init_logger(app_data_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    LOGGER.initialize(app_data_dir)
}

/// Get the current log file path
pub fn get_log_file_path() -> Option<PathBuf> {
    LOGGER.log_file_path.lock().unwrap().clone()
}

/// Log a message with timestamp, component, and level
pub fn log(component: Component, level: LogLevel, message: &str) {
    LOGGER.write_log_entry(
        component.as_str(),
        level.as_str(),
        level.emoji(),
        message,
        "",
    );
}

/// Log with additional context/details
pub fn log_with_context(component: Component, level: LogLevel, message: &str, context: &str) {
    LOGGER.write_log_entry(
        component.as_str(),
        level.as_str(),
        level.emoji(),
        message,
        context,
    );
}

// Convenience functions
pub fn debug(component: Component, message: &str) {
    log(component, LogLevel::Debug, message);
}

pub fn info(component: Component, message: &str) {
    log(component, LogLevel::Info, message);
}

pub fn warn(component: Component, message: &str) {
    log(component, LogLevel::Warn, message);
}

pub fn error(component: Component, message: &str) {
    log(component, LogLevel::Error, message);
}
