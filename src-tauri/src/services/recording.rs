use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::audio::AudioRecorder;
use crate::logger::{info, Component};
use crate::core::recording_progress::ProgressTracker;
use crate::recording_workflow::RecordingWorkflow;

pub struct RecordingService {
    pub recorder: Arc<Mutex<AudioRecorder>>,
    pub recording_workflow: Arc<RecordingWorkflow>,
    pub progress_tracker: Arc<ProgressTracker>,
    pub recordings_dir: PathBuf,
}

impl RecordingService {
    pub async fn start_no_transcription(&self) -> Result<String, String> {
        info(Component::Recording, "🎙️  Starting recording WITHOUT transcription components");

        if self.progress_tracker.is_busy() {
            return Err("Recording already in progress".to_string());
        }

        let recorder = self.recorder.lock().await;
        if recorder.is_recording() {
            drop(recorder);
            return Err("Audio recorder is already active".to_string());
        }
        drop(recorder);

        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S_%3f").to_string();
        let filename = format!("recording_no_transcription_{}.wav", timestamp);

        // Keep the behavior as-is (original used a hardcoded path); we preserve parity
        let recordings_dir = std::path::PathBuf::from(
            "/Users/arach/Library/Application Support/com.jdi.scout/recordings",
        );
        let path = recordings_dir.join(&filename);
        info(Component::Recording, &format!("Recording to: {:?}", path));

        let recorder = self.recorder.lock().await;
        match recorder.start_recording(&path, None) {
            Ok(_) => {
                drop(recorder);
                info(Component::Recording, "Pure audio recording started successfully");
                Ok(filename)
            }
            Err(e) => {
                drop(recorder);
                Err(format!("Failed to start pure recording: {}", e))
            }
        }
    }

    pub async fn stop_no_transcription(&self) -> Result<String, String> {
        info(Component::Recording, "🛑 Stopping pure recording");
        let recorder = self.recorder.lock().await;
        match recorder.stop_recording() {
            Ok(_) => {
                drop(recorder);
                info(Component::Recording, "Pure recording stopped successfully");
                Ok("Recording stopped".to_string())
            }
            Err(e) => {
                drop(recorder);
                Err(format!("Failed to stop pure recording: {}", e))
            }
        }
    }

    pub async fn start_simple_callback_test(&self) -> Result<String, String> {
        info(
            Component::Recording,
            "🎙️ Starting recording with SIMPLE callback test (no channel forwarding)",
        );
        if self.progress_tracker.is_busy() {
            return Err("Recording already in progress".to_string());
        }
        std::env::set_var("USE_SIMPLE_CALLBACK_TEST", "true");
        let res = self.recording_workflow.start_recording(None).await;
        std::env::remove_var("USE_SIMPLE_CALLBACK_TEST");
        res
    }

    pub async fn start_ring_buffer_no_callbacks(&self) -> Result<String, String> {
        info(
            Component::Recording,
            "🎙️ Starting recording with RING BUFFER but NO sample callbacks",
        );
        if self.progress_tracker.is_busy() {
            return Err("Recording already in progress".to_string());
        }
        std::env::set_var("FORCE_TRANSCRIPTION_STRATEGY", "ring_buffer");
        std::env::set_var("DISABLE_SAMPLE_CALLBACKS", "true");
        let res = self.recording_workflow.start_recording(None).await;
        std::env::remove_var("FORCE_TRANSCRIPTION_STRATEGY");
        std::env::remove_var("DISABLE_SAMPLE_CALLBACKS");
        res
    }

    pub async fn start_classic_strategy(&self) -> Result<String, String> {
        info(
            Component::Recording,
            "🎙️ Starting recording with CLASSIC strategy (no ring buffer, no progressive chunking)",
        );
        if self.progress_tracker.is_busy() {
            return Err("Recording already in progress".to_string());
        }
        std::env::set_var("FORCE_TRANSCRIPTION_STRATEGY", "classic");
        let res = self.recording_workflow.start_recording(None).await;
        std::env::remove_var("FORCE_TRANSCRIPTION_STRATEGY");
        res
    }
}

