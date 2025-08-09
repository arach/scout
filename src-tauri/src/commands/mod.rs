// Group Tauri command implementations by responsibility
pub mod diagnostics;
pub use diagnostics::*;
pub mod recording;
pub use recording::*;
pub mod audio_devices;
pub use audio_devices::*;
pub mod transcription;
pub use transcription::*;

