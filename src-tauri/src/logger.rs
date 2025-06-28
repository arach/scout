use chrono::Local;

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
}

impl Component {
    fn as_str(&self) -> &'static str {
        match self {
            Component::Overlay => "OVERLAY",
            Component::Recording => "RECORDING",
            Component::Transcription => "TRANSCRIPTION",
            Component::RingBuffer => "RINGBUFFER",
            Component::Processing => "PROCESSING",
            Component::FFI => "FFI",
            Component::UI => "UI",
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
}

/// Log a message with timestamp, component, and level
pub fn log(component: Component, level: LogLevel, message: &str) {
    let timestamp = Local::now().format("%H:%M:%S%.3f");
    println!("[{}] {} [{}] {}", timestamp, level.emoji(), component.as_str(), message);
}

/// Log with additional context/details
pub fn log_with_context(component: Component, level: LogLevel, message: &str, context: &str) {
    let timestamp = Local::now().format("%H:%M:%S%.3f");
    println!("[{}] {} [{}] {} - {}", timestamp, level.emoji(), component.as_str(), message, context);
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