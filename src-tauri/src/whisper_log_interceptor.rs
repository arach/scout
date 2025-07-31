use crate::whisper_logger;
use log::{Level, Log, Metadata, Record};
use once_cell::sync::Lazy;
use std::sync::Mutex;

static CURRENT_SESSION_ID: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

pub struct WhisperLogInterceptor {
    inner: Box<dyn Log>,
}

impl WhisperLogInterceptor {
    pub fn new(inner: Box<dyn Log>) -> Self {
        Self { inner }
    }

    pub fn set_session_id(session_id: Option<String>) {
        if let Ok(mut current) = CURRENT_SESSION_ID.lock() {
            *current = session_id;
        }
    }
}

impl Log for WhisperLogInterceptor {
    fn enabled(&self, metadata: &Metadata) -> bool {
        self.inner.enabled(metadata)
    }

    fn log(&self, record: &Record) {
        // First, pass through to the inner logger
        self.inner.log(record);

        // Then check if this is a whisper log
        if record.target().starts_with("whisper") || record.target() == "whisper_rs" {
            if let Ok(current) = CURRENT_SESSION_ID.lock() {
                if let Some(ref session_id) = *current {
                    let level = match record.level() {
                        Level::Error => "ERROR",
                        Level::Warn => "WARN",
                        Level::Info => "INFO",
                        Level::Debug => "DEBUG",
                        Level::Trace => "TRACE",
                    };

                    // Extract component from target (e.g., "whisper::decoder" -> "decoder")
                    let component = record
                        .target()
                        .strip_prefix("whisper::")
                        .or_else(|| record.target().strip_prefix("whisper_"))
                        .unwrap_or("WHISPER");

                    whisper_logger::write_whisper_log(
                        session_id,
                        level,
                        component,
                        &format!("{}", record.args()),
                        None,
                    );
                } else {
                    eprintln!("[INTERCEPTOR] No active session ID for whisper log");
                }
            }
        }
    }

    fn flush(&self) {
        self.inner.flush()
    }
}
