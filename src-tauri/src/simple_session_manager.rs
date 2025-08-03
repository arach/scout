use crate::audio::simple_recorder::{SimpleAudioRecorder, RecorderState, RecordingInfo};
use crate::audio::recorder::AudioRecorder;
use crate::transcription::simple_transcriber::{SimpleTranscriptionService, TranscriptionRequest, TranscriptionResponse};
use crate::logger::{debug, error, info, warn, Component};
use crate::sound::SoundPlayer;
use crate::db::Database;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;
use uuid::Uuid;
use tauri::{AppHandle, Emitter};
use serde_json::json;

/// Simplified, high-performance session manager that replaces the complex workflow system
/// 
/// This integrates the simplified audio recorder and transcription service:
/// - Single recording session at a time
/// - Direct file-to-transcription pipeline
/// - Performance-optimized state management
/// - Comprehensive logging and error recovery
/// - Real-time event emission for frontend updates
/// - Integrated sound feedback
pub struct SimpleSessionManager {
    /// Simplified audio recorder instance (writes to single file)
    simple_recorder: Arc<Mutex<SimpleAudioRecorder>>,
    /// Main audio recorder instance (handles actual audio input)
    main_recorder: Arc<Mutex<AudioRecorder>>,
    /// Transcription service
    transcription_service: Arc<Mutex<SimpleTranscriptionService>>,
    /// Current session state
    current_session: Arc<Mutex<Option<RecordingSession>>>,
    /// Output directory for recordings
    recordings_dir: PathBuf,
    /// Tauri app handle for event emission
    app_handle: AppHandle,
    /// Database connection for saving transcripts
    database: Arc<Database>,
}

#[derive(Debug, Clone)]
pub struct RecordingSession {
    /// Unique session identifier
    pub id: String,
    /// Output file path
    pub file_path: PathBuf,
    /// When the recording started
    pub start_time: Instant,
    /// Current session state
    pub state: SessionState,
    /// Device information
    pub device_name: Option<String>,
}

#[derive(Debug, Clone)]
pub enum SessionState {
    /// Recording is in progress
    Recording,
    /// Recording finished, transcription in progress
    Transcribing { recording_info: RecordingInfo },
    /// Session completed successfully
    Completed { 
        recording_info: RecordingInfo, 
        transcription: TranscriptionResponse 
    },
    /// Session failed with error
    Failed { error: String },
}

#[derive(Debug, Clone)]
pub struct SessionResult {
    pub session_id: String,
    pub file_path: PathBuf,
    pub recording_info: RecordingInfo,
    pub transcription: Option<TranscriptionResponse>,
    pub total_duration_ms: u64,
}

impl SimpleSessionManager {
    /// Create a new simple session manager
    pub async fn new(
        main_recorder: Arc<Mutex<AudioRecorder>>,
        recordings_dir: PathBuf,
        models_dir: PathBuf,
        model_state_manager: Arc<crate::model_state::ModelStateManager>,
        settings_manager: Arc<Mutex<crate::settings::SettingsManager>>,
        app_handle: AppHandle,
        database: Arc<Database>,
    ) -> Result<Self, String> {
        info(
            Component::Recording,
            &format!("✅ Initializing SimpleSessionManager - recordings dir: {:?}", recordings_dir),
        );

        // Get current audio device settings
        let (sample_rate, channels) = {
            let recorder = main_recorder.lock().await;
            if let Some(device_info) = recorder.get_current_device_info() {
                (device_info.sample_rate, device_info.channels)
            } else {
                // Default settings if no device info available
                (48000, 1)
            }
        };

        // Initialize services with device-specific settings
        // We'll record at the device's native rate and convert during transcription
        let wav_spec = hound::WavSpec {
            channels,
            sample_rate,
            bits_per_sample: 32,  // Float samples
            sample_format: hound::SampleFormat::Float,
        };
        
        let simple_recorder = SimpleAudioRecorder::new(wav_spec);
        
        // Get the active model from settings
        let (active_model_path, model_name) = {
            let settings = settings_manager.lock().await;
            let settings_data = settings.get();
            let active_model_id = &settings_data.models.active_model_id;
            
            // Get all models and find the active one
            let models = crate::models::WhisperModel::all(&models_dir, &settings_data);
            let active_model = models.iter()
                .find(|m| &m.id == active_model_id)
                .ok_or_else(|| format!("Active model '{}' not found", active_model_id))?;
            
            let model_path = models_dir.join(&active_model.filename);
            let model_name = active_model.id.clone();
            (model_path, model_name)
        };
        
        info(
            Component::Recording,
            &format!("Loading transcription model: {} from {:?}", model_name, active_model_path),
        );
        
        let transcriber = crate::transcription::Transcriber::get_or_create_cached_with_readiness(
            &active_model_path,
            Some(model_state_manager.clone()),
        ).await?;
        
        let transcription_service = SimpleTranscriptionService::new(
            transcriber,
            model_name,
        );
        
        info(
            Component::Recording,
            "✅ SimpleSessionManager successfully initialized",
        );

        Ok(Self {
            simple_recorder: Arc::new(Mutex::new(simple_recorder)),
            main_recorder,
            transcription_service: Arc::new(Mutex::new(transcription_service)),
            current_session: Arc::new(Mutex::new(None)),
            recordings_dir,
            app_handle,
            database,
        })
    }

    /// Start a new recording session
    pub async fn start_recording(&self, device_name: Option<String>) -> Result<String, String> {
        let start_time = Instant::now();
        
        // Check if there's already an active session
        {
            let session_guard = self.current_session.lock().await;
            if session_guard.is_some() {
                return Err("A recording session is already active".to_string());
            }
        }

        // Generate unique session ID and file path
        let session_id = format!("recording_{}", Uuid::new_v4().simple());
        let file_name = format!("{}.wav", session_id);
        let file_path = self.recordings_dir.join(&file_name);

        // Ensure recordings directory exists
        if let Err(e) = std::fs::create_dir_all(&self.recordings_dir) {
            return Err(format!("Failed to create recordings directory: {}", e));
        }

        info(
            Component::Recording,
            &format!("🎙️ Starting recording session: {} → {:?}", session_id, file_path),
        );

        // Play start sound
        SoundPlayer::play_start();

        // Start the simple recorder to prepare file writing
        {
            let simple_recorder = self.simple_recorder.lock().await;
            simple_recorder.start_recording(&file_path)?;
        }

        // Create a sample callback that forwards audio to the simple recorder
        let simple_recorder_clone = self.simple_recorder.clone();
        let sample_callback = Arc::new(move |samples: &[f32]| {
            // This callback runs in the audio thread, so we use try_lock to avoid blocking
            if let Ok(recorder) = simple_recorder_clone.try_lock() {
                if let Err(e) = recorder.write_samples(samples) {
                    error(
                        Component::Recording,
                        &format!("Failed to write samples to simple recorder: {}", e),
                    );
                }
            } else {
                // Recorder is busy, skip this batch of samples
                // This should be rare and only happen during state transitions
                debug(
                    Component::Recording,
                    "Simple recorder busy, skipping sample batch",
                );
            }
        });

        // Set the sample callback on the main recorder
        {
            let main_recorder = self.main_recorder.lock().await;
            main_recorder.set_sample_callback(Some(sample_callback))?;
        }

        // Start the main audio recorder
        {
            let main_recorder = self.main_recorder.lock().await;
            // Create a temporary file for the main recorder (won't be used in simple mode)
            let temp_path = self.recordings_dir.join(format!("{}_temp.wav", session_id));
            main_recorder.start_recording(&temp_path, device_name.as_deref())?;
        }

        // Create and store session
        let session = RecordingSession {
            id: session_id.clone(),
            file_path: file_path.clone(),
            start_time,
            state: SessionState::Recording,
            device_name: device_name.clone(),
        };

        {
            let mut session_guard = self.current_session.lock().await;
            *session_guard = Some(session);
        }

        let latency = start_time.elapsed();
        info(
            Component::Recording,
            &format!("✅ Recording session started in {:?}: {}", latency, session_id),
        );

        // Emit recording state changed event
        let _ = self.app_handle.emit("recording-state-changed", json!({
            "state": "recording",
            "session_id": &session_id,
            "filename": file_name
        }));

        // Start emitting progress events
        let session_id_for_progress = session_id.clone();
        let app_handle_for_progress = self.app_handle.clone();
        let start_time_for_progress = start_time.clone();
        let current_session_for_progress = self.current_session.clone();
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(100));
            loop {
                interval.tick().await;
                
                // Check if we're still recording
                let still_recording = {
                    let session_guard = current_session_for_progress.lock().await;
                    if let Some(ref session) = *session_guard {
                        matches!(session.state, SessionState::Recording) && session.id == session_id_for_progress
                    } else {
                        false
                    }
                };
                
                if !still_recording {
                    break; // Stop emitting progress if recording stopped
                }
                
                let duration_ms = start_time_for_progress.elapsed().as_millis() as u64;
                if let Err(_) = app_handle_for_progress.emit("recording-progress", json!({
                    "Recording": {
                        "duration_ms": duration_ms,
                        "session_id": &session_id_for_progress
                    }
                })) {
                    break; // Stop if we can't emit events
                }
            }
        });

        Ok(session_id)
    }

    /// Stop the current recording session and start transcription
    pub async fn stop_recording(&self) -> Result<SessionResult, String> {
        let stop_time = Instant::now();
        
        // Get current session
        let session = {
            let mut session_guard = self.current_session.lock().await;
            match session_guard.take() {
                Some(session) => session,
                None => return Err("No active recording session to stop".to_string()),
            }
        };

        info(
            Component::Recording,
            &format!("🛑 Stopping recording session: {}", session.id),
        );

        // Emit immediate stopping state for user feedback
        let _ = self.app_handle.emit("recording-state-changed", json!({
            "state": "stopping"
        }));

        // Play stop sound
        SoundPlayer::play_stop();

        // Emit recording stopped event
        let _ = self.app_handle.emit("recording-state-changed", json!({
            "state": "stopped"
        }));

        // Clear the sample callback first to stop receiving audio
        {
            let main_recorder = self.main_recorder.lock().await;
            main_recorder.set_sample_callback(None)?;
        }

        // Stop the main audio recorder
        {
            let main_recorder = self.main_recorder.lock().await;
            main_recorder.stop_recording()?;
        }

        // Stop the simple recorder and get recording info
        let recording_info = {
            let simple_recorder = self.simple_recorder.lock().await;
            simple_recorder.stop_recording()?
        };

        // Clean up the temporary file created for the main recorder
        let temp_path = self.recordings_dir.join(format!("{}_temp.wav", session.id));
        if temp_path.exists() {
            if let Err(e) = std::fs::remove_file(&temp_path) {
                debug(
                    Component::Recording,
                    &format!("Failed to clean up temp file: {}", e),
                );
            }
        }

        let recording_latency = stop_time.elapsed();
        info(
            Component::Recording,
            &format!(
                "✅ Recording stopped in {:?} - Duration: {:.2}s, File: {:?}",
                recording_latency, recording_info.duration_seconds, recording_info.path
            ),
        );

        // Clone session fields we'll need later
        let session_id = session.id.clone();
        let session_start_time = session.start_time;
        let session_file_path = session.file_path.clone();
        let session_device_name = session.device_name.clone();
        
        // Update session state
        let updated_session = RecordingSession {
            state: SessionState::Transcribing { recording_info: recording_info.clone() },
            ..session
        };

        {
            let mut session_guard = self.current_session.lock().await;
            *session_guard = Some(updated_session);
        }

        // Emit processing state event
        let _ = self.app_handle.emit("recording-state-changed", json!({
            "state": "processing"
        }));

        // Start transcription
        let transcription_start = Instant::now();
        info(
            Component::Transcription,
            &format!("🎯 Starting transcription for session: {}", session_id),
        );

        let transcription_request = TranscriptionRequest {
            audio_path: recording_info.path.clone(),
            language: None, // Auto-detect
            include_timestamps: false,
        };

        let transcription_result = {
            let mut transcription_service = self.transcription_service.lock().await;
            transcription_service.transcribe(transcription_request).await
        };

        let total_duration = session_start_time.elapsed();

        match transcription_result {
            Ok(transcription) => {
                // Update session state to completed
                let completed_session = RecordingSession {
                    id: session_id.clone(),
                    file_path: session_file_path.clone(),
                    start_time: session_start_time,
                    device_name: session_device_name.clone(),
                    state: SessionState::Completed { 
                        recording_info: recording_info.clone(), 
                        transcription: transcription.clone() 
                    },
                };

                {
                    let mut session_guard = self.current_session.lock().await;
                    *session_guard = Some(completed_session);
                }

                let transcription_latency = transcription_start.elapsed();
                info(
                    Component::Transcription,
                    &format!(
                        "✅ Session completed in {:?} total - Transcription: {:?} (RTF: {:.2}x)",
                        total_duration, transcription_latency, transcription.real_time_factor
                    ),
                );

                // Play success sound
                SoundPlayer::play_success();

                // Get file size for database storage
                let file_size = std::fs::metadata(&recording_info.path)
                    .map(|m| m.len() as i64)
                    .ok();

                // Build metadata with model info and performance metrics
                let metadata_json = serde_json::json!({
                    "filename": recording_info.path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown.wav"),
                    "model_used": transcription.model_name,
                    "processing_type": "simplified_session",
                    "device_name": session_device_name,
                    "sample_rate": recording_info.sample_rate,
                    "channels": recording_info.channels,
                    "real_time_factor": transcription.real_time_factor,
                    "processing_time_ms": transcription.processing_time_ms,
                    "audio_duration_seconds": transcription.audio_duration_seconds,
                });

                // Save transcript to database
                match self.database.save_transcript(
                    &transcription.text,
                    total_duration.as_millis() as i32,
                    Some(&metadata_json.to_string()),
                    Some(recording_info.path.to_str().unwrap_or("")),
                    file_size,
                ).await {
                    Ok(saved_transcript) => {
                        info(
                            Component::Transcription,
                            &format!("✅ Transcript saved to database with id={}", saved_transcript.id),
                        );

                        // Emit transcript-created event with full database object
                        let _ = self.app_handle.emit("transcript-created", &saved_transcript);

                        // Trigger webhook deliveries in background (fire-and-forget)
                        crate::webhooks::events::trigger_webhook_delivery_async(
                            self.database.clone(),
                            saved_transcript.clone(),
                        );

                        // TODO: Future LLM post-processing integration
                        // This is where we'll add LLM processing once implemented:
                        // - Execute LLM prompts against the transcript
                        // - Save LLM outputs to database
                        // - Emit events for UI updates
                    }
                    Err(e) => {
                        error(
                            Component::Transcription,
                            &format!("Failed to save transcript to database: {}", e),
                        );
                        
                        // Even if database save fails, emit the old event for backward compatibility
                        let _ = self.app_handle.emit("processing-complete", json!({
                            "transcript": &transcription.text,
                            "session_id": &session_id,
                            "duration_ms": total_duration.as_millis() as u64
                        }));
                    }
                }

                // Clear the session after successful completion
                {
                    let mut session_guard = self.current_session.lock().await;
                    *session_guard = None;
                }

                Ok(SessionResult {
                    session_id: session_id.clone(),
                    file_path: recording_info.path.clone(),
                    recording_info,
                    transcription: Some(transcription),
                    total_duration_ms: total_duration.as_millis() as u64,
                })
            }
            Err(transcription_error) => {
                // Update session state to failed
                let failed_session = RecordingSession {
                    id: session_id.clone(),
                    file_path: session_file_path.clone(),
                    start_time: session_start_time,
                    device_name: session_device_name.clone(),
                    state: SessionState::Failed { error: transcription_error.clone() },
                };

                {
                    let mut session_guard = self.current_session.lock().await;
                    *session_guard = Some(failed_session);
                }

                error(
                    Component::Transcription,
                    &format!("❌ Session {} failed after {:?}: {}", session_id, total_duration, transcription_error),
                );

                // Play error sound
                SoundPlayer::play_error();

                // Emit error event
                let _ = self.app_handle.emit("recording-error", json!({
                    "error": &transcription_error,
                    "session_id": &session_id
                }));

                // Return partial result with recording info but no transcription
                Ok(SessionResult {
                    session_id: session_id,
                    file_path: recording_info.path.clone(),
                    recording_info,
                    transcription: None,
                    total_duration_ms: total_duration.as_millis() as u64,
                })
            }
        }
    }

    /// Cancel the current recording session
    pub async fn cancel_recording(&self) -> Result<(), String> {
        let cancel_time = Instant::now();
        
        // Get current session
        let session = {
            let mut session_guard = self.current_session.lock().await;
            match session_guard.take() {
                Some(session) => session,
                None => return Err("No active recording session to cancel".to_string()),
            }
        };

        info(
            Component::Recording,
            &format!("🚫 Cancelling recording session: {}", session.id),
        );

        // Clear the sample callback first
        {
            let main_recorder = self.main_recorder.lock().await;
            let _ = main_recorder.set_sample_callback(None); // Ignore errors during cancellation
        }

        // Stop the main recorder
        {
            let main_recorder = self.main_recorder.lock().await;
            let _ = main_recorder.stop_recording(); // Ignore errors during cancellation
        }

        // Stop the simple recorder if active
        let recorder_state = {
            let simple_recorder = self.simple_recorder.lock().await;
            simple_recorder.get_state().unwrap_or(RecorderState::Idle)
        };

        if matches!(recorder_state, RecorderState::Recording { .. }) {
            let simple_recorder = self.simple_recorder.lock().await;
            let _ = simple_recorder.stop_recording(); // Ignore errors during cancellation
        }

        // Clean up the recording file
        if session.file_path.exists() {
            if let Err(e) = std::fs::remove_file(&session.file_path) {
                warn(
                    Component::Recording,
                    &format!("Failed to clean up cancelled recording file: {}", e),
                );
            } else {
                debug(
                    Component::Recording,
                    &format!("Cleaned up cancelled recording file: {:?}", session.file_path),
                );
            }
        }

        // Clean up the temporary file
        let temp_path = self.recordings_dir.join(format!("{}_temp.wav", session.id));
        if temp_path.exists() {
            if let Err(e) = std::fs::remove_file(&temp_path) {
                debug(
                    Component::Recording,
                    &format!("Failed to clean up temp file: {}", e),
                );
            }
        }

        let latency = cancel_time.elapsed();
        info(
            Component::Recording,
            &format!("✅ Recording session cancelled in {:?}: {}", latency, session.id),
        );

        Ok(())
    }

    /// Get the current session state
    pub async fn get_current_session(&self) -> Option<RecordingSession> {
        let session_guard = self.current_session.lock().await;
        session_guard.clone()
    }

    /// Check if there's an active recording
    pub async fn is_recording(&self) -> bool {
        let session_guard = self.current_session.lock().await;
        matches!(
            session_guard.as_ref().map(|s| &s.state),
            Some(SessionState::Recording)
        )
    }

    /// Get performance statistics from the transcription service
    pub async fn get_performance_stats(&self) -> crate::transcription::simple_transcriber::PerformanceStats {
        let transcription_service = self.transcription_service.lock().await;
        transcription_service.get_performance_stats()
    }

    /// Get current audio level from the main recorder for overlay waveform
    pub async fn get_current_audio_level(&self) -> f32 {
        let recorder = self.main_recorder.lock().await;
        recorder.get_current_audio_level()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::simple_recorder::SimpleAudioRecorder;
    use crate::transcription::simple_transcriber::SimpleTranscriptionService;
    use hound::WavSpec;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_session_lifecycle() {
        let temp_dir = tempdir().unwrap();
        let recordings_dir = temp_dir.path().to_path_buf();

        // Create simplified components (this is a basic test structure)
        let spec = WavSpec {
            channels: 1,
            sample_rate: 44100,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };

        let recorder = Arc::new(Mutex::new(SimpleAudioRecorder::new(spec)));
        
        // For testing, we'll skip the actual transcription service creation
        // since it requires a real Whisper model
        
        // Test session manager creation
        // let session_manager = SimpleSessionManager::new(
        //     recorder,
        //     transcription_service,
        //     recordings_dir,
        // );

        // Basic functionality tests would go here
        // This is primarily for compilation verification
    }

    #[test]
    fn test_session_state_transitions() {
        let recording_info = RecordingInfo {
            path: PathBuf::from("test.wav"),
            duration_samples: 1000,
            duration_seconds: 1.0,
            sample_rate: 44100,
            channels: 1,
        };

        // Test state transitions
        let session = RecordingSession {
            id: "test-session".to_string(),
            file_path: PathBuf::from("test.wav"),
            start_time: Instant::now(),
            state: SessionState::Recording,
            device_name: Some("Test Device".to_string()),
        };

        assert!(matches!(session.state, SessionState::Recording));
        assert_eq!(session.id, "test-session");
        assert_eq!(session.device_name, Some("Test Device".to_string()));
    }
}