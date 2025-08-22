// Organized command modules by domain
pub mod audio;
pub use audio::*;

pub mod transcription;
pub use transcription::*;

pub mod test_transcription;
pub use test_transcription::*;

pub mod ui;
pub use ui::*;

pub mod system;
pub use system::*;

pub mod settings;
pub use settings::*;

pub mod ai;
pub use ai::*;

pub mod storage;
pub use storage::*;