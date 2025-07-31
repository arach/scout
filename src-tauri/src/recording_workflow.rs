use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};
use chrono;
use tauri::Emitter;

use crate::audio::AudioRecorder;
use crate::recording_progress::RecordingProgress;
use crate::processing_queue::ProcessingQueue;
use crate::transcription_context::TranscriptionContext;
use crate::db::Database;
use crate::settings::SettingsManager;
use crate::logger::{info, debug, warn, error, Component};
use crate::whisper_logger;
use crate::whisper_log_interceptor::WhisperLogInterceptor;
use crate::performance_tracker::PerformanceTracker;

#[derive(Debug)]
pub enum RecordingCommand {
    StartRecording {
        device_name: Option<String>,
        response: oneshot::Sender<Result<String, String>>,
    },
    StopRecording {
        response: oneshot::Sender<Result<RecordingResult, String>>,
    },
    CancelRecording {
        response: oneshot::Sender<Result<(), String>>,
    },
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RecordingResult {
    pub filename: String,
    pub transcript: Option<String>,
    pub duration_ms: i32,
    pub device_name: Option<String>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u16>,
}

pub struct RecordingWorkflow {
    command_tx: mpsc::Sender<RecordingCommand>,
}

struct ActiveRecording {
    filename: String,
    start_time: std::time::Instant,
    transcription_context: Option<TranscriptionContext>,
    sample_channel: Option<tokio::sync::mpsc::UnboundedReceiver<Vec<f32>>>,
    session_id: String,
    whisper_log_path: Option<PathBuf>,
    #[cfg(target_os = "macos")]
    app_context: Option<crate::macos::AppContext>,
    #[cfg(not(target_os = "macos"))]
    app_context: Option<()>,
}

impl RecordingWorkflow {
    pub fn new(
        recorder: Arc<tokio::sync::Mutex<AudioRecorder>>,
        recordings_dir: PathBuf,
        progress_tracker: Arc<crate::recording_progress::ProgressTracker>,
        _processing_queue: Arc<ProcessingQueue>,
        database: Arc<Database>,
        models_dir: PathBuf,
        app_handle: tauri::AppHandle,
        settings: Arc<tokio::sync::Mutex<SettingsManager>>,
        performance_tracker: Arc<PerformanceTracker>,
    ) -> Self {
        let (command_tx, mut command_rx) = mpsc::channel::<RecordingCommand>(100);
        
        // Spawn the workflow task using Tauri's runtime
        tauri::async_runtime::spawn(async move {
            let mut current_recording: Option<ActiveRecording> = None;
            
            while let Some(command) = command_rx.recv().await {
                // Clone for this iteration
                let app_handle_for_iter = app_handle.clone();
                let settings_for_iter = settings.clone();
                let database_for_iter = database.clone();
                let recordings_dir_for_iter = recordings_dir.clone();
                let progress_tracker_for_iter = progress_tracker.clone();
                let performance_tracker_for_iter = performance_tracker.clone();
                
                match command {
                    RecordingCommand::StartRecording { device_name, response } => {
                        info(Component::Recording, "Starting recording workflow...");
                        
                        // Start performance tracking
                        let session_id = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
                        performance_tracker_for_iter.start_session(session_id.clone()).await;
                        performance_tracker_for_iter.track_event("recording_command", "StartRecording command received").await;
                        
                        // Capture active app context on macOS
                        performance_tracker_for_iter.track_event("app_context", "Capturing active app context").await;
                        #[cfg(target_os = "macos")]
                        let app_context = crate::macos::get_active_app_context();
                        #[cfg(not(target_os = "macos"))]
                        let app_context: Option<crate::macos::AppContext> = None;
                        
                        if let Some(ref ctx) = app_context {
                            info(Component::Recording, &format!("Recording started in app: {} ({})", ctx.name, ctx.bundle_id));
                        }
                        
                        // Generate filename - reuse session ID from performance tracker
                        let timestamp = session_id.clone();
                        let filename = format!("recording_{}.wav", timestamp);
                        let path = recordings_dir_for_iter.join(&filename);
                        
                        // Start whisper logging session
                        performance_tracker_for_iter.track_event("whisper_logging", "Starting whisper log session").await;
                        // Set the session ID for the log interceptor
                        WhisperLogInterceptor::set_session_id(Some(session_id.clone()));
                        let whisper_log_path = match whisper_logger::start_whisper_session(&session_id) {
                            Ok(path) => {
                                debug(Component::Recording, &format!("Started whisper log session: {}", session_id));
                                Some(path)
                            },
                            Err(e) => {
                                warn(Component::Recording, &format!("Failed to start whisper logging: {}", e));
                                None
                            }
                        };
                        
                        info(Component::Recording, "Initializing transcription context for real-time chunking...");
                        performance_tracker_for_iter.track_event("transcription_init", "Creating transcription context").await;
                        
                        // Get the current settings
                        let settings_guard = settings_for_iter.lock().await;
                        let current_settings = settings_guard.get().clone();
                        drop(settings_guard);
                        
                        // Initialize transcription context for real-time chunking
                        let transcription_context = match TranscriptionContext::new_from_db(
                            database_for_iter.clone(),
                            models_dir.clone(),
                            &current_settings,
                        ).await {
                            Ok(ctx) => ctx.with_app_handle(app_handle_for_iter.clone()),
                            Err(e) => {
                                warn(Component::Recording, &format!("Failed to create transcription context: {}", e));
                                info(Component::Recording, "Falling back to traditional processing queue");
                                // Continue with traditional recording workflow without strategy integration
                                performance_tracker_for_iter.track_event("fallback", "Using traditional recording without transcription context").await;
                                let recorder = recorder.lock().await;
                                match recorder.start_recording(&path, device_name.as_deref()) {
                                    Ok(_) => {
                                        let start_time = std::time::Instant::now();
                                        current_recording = Some(ActiveRecording {
                                            filename: filename.clone(),
                                            start_time,
                                            transcription_context: None, // No transcription context
                                            sample_channel: None,
                                            session_id: session_id.clone(),
                                            whisper_log_path: whisper_log_path.clone(),
                                            app_context,
                                        });
                                        
                                        progress_tracker_for_iter.update(RecordingProgress::Recording { 
                                            filename: filename.clone(),
                                            start_time: chrono::Utc::now().timestamp_millis() as u64
                                        });
                                        
                                        let _ = response.send(Ok(filename));
                                    }
                                    Err(e) => {
                                        progress_tracker_for_iter.update(RecordingProgress::Idle);
                                        let _ = response.send(Err(e));
                                    }
                                }
                                continue;
                            }
                        };
                        
                        // Start transcription strategy first to get ring buffer setup
                        let mut transcription_context = transcription_context;
                        performance_tracker_for_iter.track_event("strategy_start", "Starting transcription strategy").await;
                        match transcription_context.start_recording(&path, None).await {
                            Ok(_) => {
                                // Set up sample callback to bridge AudioRecorder to RingBuffer
                                let strategy_name = transcription_context.current_strategy_name()
                                    .unwrap_or_else(|| "unknown".to_string());
                                
                                let sample_rx_option = if strategy_name == "ring_buffer" || strategy_name == "progressive" {
                                    info(Component::RingBuffer, &format!("Detected {} strategy - connecting audio samples", strategy_name));
                                    
                                    // Create a channel to send samples from AudioRecorder thread to transcription context
                                    let (sample_tx, sample_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<f32>>();
                                    
                                    // Get audio device info to check channels
                                    let recorder_guard = recorder.lock().await;
                                    let device_info = recorder_guard.get_current_device_info();
                                    let audio_channels = device_info.as_ref().map(|d| d.channels).unwrap_or(2) as usize;
                                    drop(recorder_guard);
                                    
                                    info(Component::RingBuffer, &format!("Audio device has {} channels, ring buffer expects 1 channel", audio_channels));
                                    
                                    // Create callback for AudioRecorder
                                    let sample_callback = std::sync::Arc::new(move |samples: &[f32]| {
                                        // Convert stereo to mono if needed
                                        let mono_samples = if audio_channels == 2 {
                                            // Convert stereo to mono by averaging left and right channels
                                            let mut mono = Vec::with_capacity(samples.len() / 2);
                                            for i in (0..samples.len()).step_by(2) {
                                                if i + 1 < samples.len() {
                                                    // Average left and right channels
                                                    mono.push((samples[i] + samples[i + 1]) / 2.0);
                                                }
                                            }
                                            mono
                                        } else {
                                            // Already mono, just copy
                                            samples.to_vec()
                                        };
                                        
                                        // Send samples to transcription context asynchronously
                                        if let Err(_) = sample_tx.send(mono_samples) {
                                            // Channel closed, probably shutting down
                                        }
                                    });
                                    
                                    // Set the callback on the recorder
                                    let recorder = recorder.lock().await;
                                    if let Err(e) = recorder.set_sample_callback(Some(sample_callback)) {
                                        error(Component::Recording, &format!("Failed to set sample callback: {}", e));
                                        None
                                    } else {
                                        info(Component::RingBuffer, "AudioRecorder callback set - samples will be captured");
                                        drop(recorder);
                                        info(Component::RingBuffer, "Connected AudioRecorder to RingBuffer via sample forwarding");
                                        Some(sample_rx)
                                    }
                                } else {
                                    None
                                };
                                
                                // Start recording
                                performance_tracker_for_iter.track_event("audio_start", "Starting audio recording").await;
                                let recorder = recorder.lock().await;
                                match recorder.start_recording(&path, device_name.as_deref()) {
                                    Ok(_) => {
                                        let start_time = std::time::Instant::now();
                                        let strategy_name = transcription_context.current_strategy_name()
                                            .unwrap_or_else(|| "unknown".to_string());
                                        info(Component::Recording, &format!("Started recording with transcription strategy: {}", strategy_name));
                                        
                                        // Create sample processing task if we have ring buffer
                                        if let Some(mut sample_rx) = sample_rx_option {
                                            debug(Component::RingBuffer, "Attempting to get ring buffer reference from transcription context");
                                            if let Some(ring_buffer) = transcription_context.get_ring_buffer() {
                                                info(Component::RingBuffer, "Got ring buffer reference successfully");
                                                let ring_buffer_clone = ring_buffer.clone();
                                                tokio::spawn(async move {
                                                    let mut sample_count = 0;
                                                    let mut batch_count = 0;
                                                    info(Component::RingBuffer, "Ring buffer sample processor task starting");
                                                    while let Some(samples) = sample_rx.recv().await {
                                                        batch_count += 1;
                                                        sample_count += samples.len();
                                                        
                                                        // Debug: Check ring buffer state before adding
                                                        let before_count = ring_buffer_clone.sample_count();
                                                        
                                                        // Feed samples directly to ring buffer
                                                        if let Err(e) = ring_buffer_clone.add_samples(&samples) {
                                                            error(Component::RingBuffer, &format!("Failed to add samples to ring buffer: {}", e));
                                                        }
                                                        
                                                        // Debug: Check ring buffer state after adding
                                                        let after_count = ring_buffer_clone.sample_count();
                                                        
                                                        // Log first few batches to verify audio is flowing
                                                        if batch_count <= 5 {
                                                            debug(Component::RingBuffer, &format!("Batch {}: {} samples received, buffer: {} -> {}", 
                                                                     batch_count, samples.len(), before_count, after_count));
                                                        }
                                                        
                                                        if sample_count % 48000 == 0 { // Log every second of audio
                                                            debug(Component::RingBuffer, &format!("Fed {} samples to ring buffer (buffer: {} -> {} samples)", 
                                                                     sample_count, before_count, after_count));
                                                        }
                                                    }
                                                    info(Component::RingBuffer, &format!("Ring buffer feeding complete - {} samples processed in {} batches", 
                                                             sample_count, batch_count));
                                                    
                                                    // Force flush any remaining samples to ring buffer
                                                    if let Err(e) = ring_buffer_clone.finalize_recording() {
                                                        warn(Component::RingBuffer, &format!("Error finalizing ring buffer during sample feed completion: {}", e));
                                                    }
                                                });
                                                info(Component::RingBuffer, "Ring buffer sample processing task started");
                                            } else {
                                                error(Component::RingBuffer, "Failed to get ring buffer reference from transcription context");
                                                debug(Component::RingBuffer, &format!("Current strategy: {:?}", transcription_context.current_strategy_name()));
                                                // Process samples without ring buffer - they'll be lost
                                                tokio::spawn(async move {
                                                    let mut sample_count = 0;
                                                    while let Some(samples) = sample_rx.recv().await {
                                                        sample_count += samples.len();
                                                    }
                                                    warn(Component::RingBuffer, &format!("Discarded {} samples - no ring buffer available", sample_count));
                                                });
                                            }
                                        }
                                        
                                        current_recording = Some(ActiveRecording {
                                            filename: filename.clone(),
                                            start_time,
                                            transcription_context: Some(transcription_context),
                                            sample_channel: None, // Sample processing is handled in spawned task
                                            session_id: session_id.clone(),
                                            whisper_log_path: whisper_log_path.clone(),
                                            app_context,
                                        });
                                        
                                        // Update progress to Recording state
                                        performance_tracker_for_iter.track_event("state_change", "Updated to Recording state").await;
                                        progress_tracker_for_iter.update(RecordingProgress::Recording { 
                                            filename: filename.clone(),
                                            start_time: chrono::Utc::now().timestamp_millis() as u64
                                        });
                                        
                                        let _ = response.send(Ok(filename));
                                    }
                                    Err(e) => {
                                        // Stop recording if transcription setup failed
                                        let _ = recorder.stop_recording();
                                        progress_tracker_for_iter.update(RecordingProgress::Idle);
                                        let _ = response.send(Err(format!("Failed to setup transcription: {}", e)));
                                    }
                                }
                            }
                            Err(e) => {
                                // Go back to idle on error
                                progress_tracker_for_iter.update(RecordingProgress::Idle);
                                let _ = response.send(Err(e));
                            }
                        }
                    }
                    
                    RecordingCommand::StopRecording { response } => {
                        info(Component::Recording, "RecordingWorkflow: StopRecording command received");
                        performance_tracker_for_iter.track_event("recording_command", "StopRecording command received").await;
                        if let Some(mut active_recording) = current_recording.take() {
                            let duration_ms = active_recording.start_time.elapsed().as_millis() as i32;
                            info(Component::Recording, &format!("Recording duration: {}ms", duration_ms));
                            
                            // Update to Idle state immediately for better UI responsiveness
                            performance_tracker_for_iter.track_event("state_change", "Updated to Idle state").await;
                            progress_tracker_for_iter.update(RecordingProgress::Idle);
                            
                            // Get device info before stopping recording
                            let recorder = recorder.lock().await;
                            let device_info = recorder.get_current_device_info();
                            debug(Component::Recording, "Calling recorder.stop_recording()...");
                            performance_tracker_for_iter.track_event("audio_stop", "Stopping audio recorder").await;
                            if let Err(e) = recorder.stop_recording() {
                                error(Component::Recording, &format!("Failed to stop recording: {}", e));
                                // Update to idle on error
                                progress_tracker_for_iter.update(RecordingProgress::Idle);
                                let _ = response.send(Err(e));
                                continue;
                            }
                            info(Component::Recording, "recorder.stop_recording() succeeded");
                            drop(recorder); // Release lock
                            
                            // Validate the WAV file
                            let wav_path = recordings_dir_for_iter.join(&active_recording.filename);
                            match crate::audio::WavValidator::validate_wav_file(&wav_path) {
                                Ok(validation_result) => {
                                    validation_result.log_issues();
                                    if validation_result.has_errors() {
                                        error(Component::Recording, "WAV file validation found errors - audio may have issues");
                                    } else if validation_result.has_warnings() {
                                        warn(Component::Recording, "WAV file validation found warnings - check logs for details");
                                    } else {
                                        info(Component::Recording, "WAV file validation passed - no issues detected");
                                    }
                                }
                                Err(e) => {
                                    error(Component::Recording, &format!("Failed to validate WAV file: {}", e));
                                }
                            }
                            
                            // Send immediate response for UI responsiveness
                            performance_tracker_for_iter.track_event("response_sent", "Sent immediate response to UI").await;
                            let immediate_result = RecordingResult {
                                filename: active_recording.filename.clone(),
                                transcript: None, // Will be filled in later
                                duration_ms,
                                device_name: device_info.as_ref().map(|d| d.name.clone()),
                                sample_rate: device_info.as_ref().map(|d| d.sample_rate),
                                channels: device_info.as_ref().map(|d| d.channels),
                            };
                            let _ = response.send(Ok(immediate_result));
                            
                            // Process transcription asynchronously for better UI responsiveness
                            if let Some(mut transcription_context) = active_recording.transcription_context.take() {
                                let strategy_name = transcription_context.current_strategy_name()
                                    .unwrap_or_else(|| "unknown".to_string());
                                let model_name = transcription_context.get_model_name().to_string();
                                info(Component::Transcription, &format!("Processing transcription asynchronously with strategy: {} using model: {}", strategy_name, model_name));
                                
                                // Clone what we need for async processing
                                let app_handle_clone = app_handle_for_iter.clone();
                                let database_clone = database_for_iter.clone();
                                let settings_clone = settings_for_iter.clone();
                                let recordings_dir_clone = recordings_dir_for_iter.clone();
                                let filename_clone = active_recording.filename.clone();
                                let session_id_clone = active_recording.session_id.clone();
                                let whisper_log_path_clone = active_recording.whisper_log_path.clone();
                                let _app_context_clone = active_recording.app_context.clone();
                                let recording_start_time = active_recording.start_time;
                                let device_info_result = device_info.clone();
                                
                                // Clone performance tracker for async task
                                let perf_tracker_clone = performance_tracker_for_iter.clone();
                                
                                // Spawn async task for transcription
                                tokio::spawn(async move {
                                    perf_tracker_clone.track_event("transcription_start", "Starting async transcription processing").await;
                                    
                                    // Emit transcribing status for native overlay
                                    let transcribing_status = crate::processing_queue::ProcessingStatus::Transcribing {
                                        filename: filename_clone.clone(),
                                    };
                                    if let Err(e) = app_handle_clone.emit("processing-status", &transcribing_status) {
                                        error(Component::UI, &format!("Failed to emit transcribing status: {:?}", e));
                                    } else {
                                        info(Component::UI, "Emitted transcribing status for native overlay");
                                    }
                                    // Add timeout to prevent hanging
                                    perf_tracker_clone.track_event("transcription_finish", "Calling finish_recording on transcription context").await;
                                    let finish_timeout = tokio::time::timeout(
                                        tokio::time::Duration::from_secs(45), // 45 second timeout
                                        transcription_context.finish_recording()
                                    ).await;
                                
                                match finish_timeout {
                                    Ok(Ok(transcription_result)) => {
                                        perf_tracker_clone.track_event("transcription_complete", 
                                            &format!("Transcription completed: {} chars, {} chunks", 
                                                transcription_result.text.len(), 
                                                transcription_result.chunks_processed)).await;
                                        let speed_ratio = duration_ms as f64 / transcription_result.processing_time_ms as f64;
                                        info(Component::Transcription, &format!("Transcription completed: {} chars in {:.2}s", 
                                                transcription_result.text.len(),
                                                transcription_result.processing_time_ms as f64 / 1000.0));
                                        info(Component::Transcription, &format!("⚡ Performance: {}ms transcription for {}ms audio ({:.2}x speed) using ring buffer strategy", 
                                                transcription_result.processing_time_ms, duration_ms, speed_ratio));
                                        
                                        // Performance warnings
                                        if speed_ratio < 1.0 {
                                            warn(Component::Transcription, &format!("⚠️ Slow transcription: {:.2}x speed (slower than real-time)", speed_ratio));
                                        } else if speed_ratio > 5.0 {
                                            info(Component::Transcription, &format!("🚀 Fast transcription: {:.2}x speed", speed_ratio));
                                        }
                                        
                                        // Execute post-processing hooks (profanity filter, auto-copy, auto-paste, etc.)
                                        perf_tracker_clone.track_event("post_processing", "Starting post-processing hooks").await;
                                        let post_processing = crate::post_processing::PostProcessingHooks::new(settings_clone.clone(), database_clone.clone());
                                        let (filtered_transcript, original_transcript, analysis_logs) = post_processing.execute_hooks(&transcription_result.text, "Ring Buffer", Some(duration_ms), None).await;
                                        
                                        // Save transcript to database
                                        let mut metadata_json = serde_json::json!({
                                            "model_used": model_name,
                                            "strategy_used": transcription_result.strategy_used,
                                            "chunks_processed": transcription_result.chunks_processed,
                                            "processing_type": "ring_buffer",
                                            "original_transcript": original_transcript,
                                            "filter_analysis": analysis_logs
                                        });
                                        
                                        // Add app context to metadata if available
                                        #[cfg(target_os = "macos")]
                                        if let Some(ref ctx) = active_recording.app_context {
                                            metadata_json["app_context"] = serde_json::json!({
                                                "name": ctx.name,
                                                "bundle_id": ctx.bundle_id,
                                            });
                                        }
                                        
                                        let metadata = metadata_json.to_string();
                                        
                                        // Get audio metadata if available
                                        let audio_metadata_json = if let Some(ref device_info) = device_info_result {
                                            device_info.metadata.as_ref().and_then(|m| m.to_json().ok())
                                        } else {
                                            None
                                        };
                                        
                                        // Save filtered transcript to database with audio metadata
                                        perf_tracker_clone.track_event("db_save", "Saving transcript to database").await;
                                        match database_clone.save_transcript_with_audio_metadata(
                                            &filtered_transcript,
                                            duration_ms,
                                            Some(&metadata),
                                            audio_metadata_json.as_deref(),
                                            Some(&recordings_dir_clone.join(&filename_clone).to_string_lossy()),
                                            None // TODO: Calculate actual file size
                                        ).await {
                                            Ok(transcript) => {
                                                info(Component::Processing, &format!("Filtered transcript saved to database with ID: {}", transcript.id));
                                                perf_tracker_clone.track_event("db_saved", &format!("Transcript saved with ID: {}", transcript.id)).await;
                                                
                                                // Save performance metrics using the consolidated service
                                                let mut perf_builder = crate::performance_metrics_service::PerformanceDataBuilder::new(
                                                    duration_ms,
                                                    transcription_result.processing_time_ms as i32,
                                                    model_name.clone(),
                                                    "ring_buffer".to_string()
                                                )
                                                .with_chunks(transcription_result.chunks_processed)
                                                .with_audio_info(None, Some("wav".to_string()))
                                                .with_strategy_metadata(serde_json::json!({
                                                    "strategy_used": transcription_result.strategy_used
                                                }));
                                                
                                                // Add device info if available
                                                if let Some(ref device_info) = device_info_result {
                                                    perf_builder = perf_builder.with_device_info(device_info);
                                                }
                                                
                                                let performance_data = perf_builder.build();
                                                
                                                if let Err(e) = post_processing.save_performance_metrics(transcript.id, performance_data).await {
                                                    error(Component::Processing, &format!("Failed to save performance metrics: {}", e));
                                                }
                                                
                                                // Save performance timeline events to database
                                                if let Some(timeline_events) = perf_tracker_clone.get_timeline_for_database(&session_id_clone).await {
                                                    if let Err(e) = database_clone.save_performance_timeline_events(
                                                        transcript.id,
                                                        &session_id_clone,
                                                        timeline_events
                                                    ).await {
                                                        error(Component::Processing, &format!("Failed to save performance timeline: {}", e));
                                                    } else {
                                                        info(Component::Processing, "Performance timeline saved to database");
                                                    }
                                                }
                                                
                                                // Execute LLM processing with the saved transcript ID
                                                post_processing.execute_llm_processing(&filtered_transcript, transcript.id).await;
                                                
                                                // Update to idle state first
                                                perf_tracker_clone.track_event("state_change", "Updated to Idle state (post-processing)").await;
                                                progress_tracker_for_iter.update(RecordingProgress::Idle);
                                                
                                                // The progress tracker update will automatically notify the overlay
                                                info(Component::Processing, "Updated progress tracker to Idle state");
                                                
                                                // Emit processing-status complete for native overlay
                                                // since we're not going through the processing queue
                                                let processing_complete = crate::processing_queue::ProcessingStatus::Complete {
                                                    filename: active_recording.filename.clone(),
                                                    transcript: filtered_transcript.clone(),
                                                };
                                                if let Err(e) = app_handle_clone.emit("processing-status", &processing_complete) {
                                                    error(Component::UI, &format!("Failed to emit processing-status complete: {:?}", e));
                                                } else {
                                                    info(Component::UI, "Emitted processing-status complete for native overlay");
                                                }
                                                
                                                // Add a small delay to ensure the event is processed
                                                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                                                
                                                // Emit transcript-created event
                                                debug(Component::UI, &format!("Emitting transcript-created event for transcript ID: {}", transcript.id));
                                                debug(Component::UI, &format!("Transcript details: {} chars, {}ms duration", 
                                                        transcript.text.len(), transcript.duration_ms));
                                                if let Err(e) = app_handle_clone.emit("transcript-created", &transcript) {
                                                    error(Component::UI, &format!("Failed to emit transcript-created event: {:?}", e));
                                                } else {
                                                    info(Component::UI, "transcript-created event emitted successfully");
                                                }
                                                
                                                // Note: Native overlay is updated via progress tracker listener
                                                
                                                // Give the event system time to process
                                                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                                                
                                                // Emit multiple completion events to ensure at least one is caught
                                                debug(Component::UI, "Emitting processing-complete event");
                                                if let Err(e) = app_handle_clone.emit("processing-complete", &transcript) {
                                                    error(Component::UI, &format!("Failed to emit processing-complete event: {:?}", e));
                                                } else {
                                                    info(Component::UI, "processing-complete event emitted successfully");
                                                }
                                                
                                                
                                                // Small delay between events
                                                tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
                                                
                                                // Also emit recording-completed as backup
                                                debug(Component::UI, "Emitting recording-completed event");
                                                if let Err(e) = app_handle_clone.emit("recording-completed", &transcript.id) {
                                                    error(Component::UI, &format!("Failed to emit recording-completed event: {:?}", e));
                                                } else {
                                                    info(Component::UI, "recording-completed event emitted successfully");
                                                }
                                                
                                                
                                                // Send response with filtered transcript
                                                // Response was already sent at the beginning
                                                
                                                // Get performance summary before ending session
                                                if let Some(summary) = perf_tracker_clone.end_session().await {
                                                    info(Component::Recording, &summary);
                                                }
                                                
                                                // Fire-and-forget: Process whisper logs to database (development convenience)
                                                if let Some(_log_path) = whisper_log_path_clone {
                                                    let session_id = session_id_clone.clone();
                                                    let transcript_id = transcript.id;
                                                    let db_clone = database_clone.clone();
                                                    
                                                    tokio::spawn(async move {
                                                        debug(Component::Recording, &format!("Processing whisper logs for session {} in background", session_id));
                                                        
                                                        // End the whisper session to flush logs
                                                        if let Some(final_log_path) = whisper_logger::end_whisper_session(&session_id) {
                                                            // Process logs to database
                                                            if let Err(e) = whisper_logger::process_whisper_logs_to_db(
                                                                final_log_path,
                                                                session_id.clone(),
                                                                Some(transcript_id),
                                                                db_clone
                                                            ).await {
                                                                debug(Component::Recording, &format!("Failed to process whisper logs to db: {}", e));
                                                            } else {
                                                                debug(Component::Recording, &format!("Successfully processed whisper logs for session {}", session_id));
                                                            }
                                                        }
                                                    });
                                                } else {
                                                    // Just end the session if we have one
                                                    whisper_logger::end_whisper_session(&session_id_clone);
                                                    // Clear the session ID from the log interceptor
                                                    WhisperLogInterceptor::set_session_id(None);
                                                }
                                            }
                                            Err(e) => {
                                                error(Component::Processing, &format!("Failed to save transcript: {}", e));
                                                // Response was already sent at the beginning
                                            }
                                        }
                                    }
                                    Ok(Err(e)) => {
                                        error(Component::Transcription, &format!("Transcription failed: {}", e));
                                        info(Component::Transcription, "Would fall back to processing queue, but we already sent response");
                                        
                                        // Log failure metrics for debugging
                                        let fallback_duration = recording_start_time.elapsed();
                                        info(Component::Transcription, "=== FALLBACK PERFORMANCE METRICS ===");
                                        info(Component::Transcription, &format!("Recording Duration: {:.2}s", fallback_duration.as_secs_f64()));
                                        error(Component::Transcription, "Strategy Failed: ring_buffer");
                                        error(Component::Transcription, &format!("Reason: {}", e));
                                        info(Component::Transcription, "Falling back to: traditional processing queue");
                                        info(Component::Transcription, "=======================================");
                                    }
                                    Err(_) => {
                                        error(Component::Transcription, "Transcription timeout after 45 seconds!");
                                        info(Component::Transcription, "Would fall back to processing queue, but we already sent response");
                                    }
                                    }
                                });
                            } else {
                                // No transcription context - just end whisper session if we have one
                                whisper_logger::end_whisper_session(&active_recording.session_id);
                                // Clear the session ID from the log interceptor
                                WhisperLogInterceptor::set_session_id(None);
                            }
                        } else {
                            let _ = response.send(Err("No recording in progress".to_string()));
                        }
                    }
                    
                    RecordingCommand::CancelRecording { response } => {
                        if let Some(mut active_recording) = current_recording.take() {
                            // Stop recording
                            let recorder = recorder.lock().await;
                            if let Err(e) = recorder.stop_recording() {
                                let _ = response.send(Err(e));
                                continue;
                            }
                            drop(recorder); // Release lock
                            
                            // Cancel transcription context if it exists
                            if let Some(_transcription_context) = active_recording.transcription_context.take() {
                                info(Component::Transcription, "Cancelled transcription");
                                // TranscriptionContext doesn't need explicit cleanup
                            }
                            
                            // Delete the recording file
                            let audio_path = recordings_dir_for_iter.join(&active_recording.filename);
                            if let Err(e) = tokio::fs::remove_file(&audio_path).await {
                                error(Component::Recording, &format!("Failed to delete cancelled recording: {}", e));
                            }
                            
                            // Update to idle state
                            progress_tracker_for_iter.update(RecordingProgress::Idle);
                            
                            let _ = response.send(Ok(()));
                        } else {
                            let _ = response.send(Err("No recording in progress".to_string()));
                        }
                    }
                }
            }
        });
        
        RecordingWorkflow { command_tx }
    }
    
    pub async fn start_recording(&self, device_name: Option<String>) -> Result<String, String> {
        let (response_tx, response_rx) = oneshot::channel();
        self.command_tx
            .send(RecordingCommand::StartRecording { device_name, response: response_tx })
            .await
            .map_err(|_| "Failed to send command".to_string())?;
        
        response_rx.await.map_err(|_| "Failed to receive response".to_string())?
    }
    
    pub async fn stop_recording(&self) -> Result<RecordingResult, String> {
        let (response_tx, response_rx) = oneshot::channel();
        self.command_tx
            .send(RecordingCommand::StopRecording { response: response_tx })
            .await
            .map_err(|_| "Failed to send command".to_string())?;
        
        response_rx.await.map_err(|_| "Failed to receive response".to_string())?
    }
    
    pub async fn cancel_recording(&self) -> Result<(), String> {
        let (response_tx, response_rx) = oneshot::channel();
        self.command_tx
            .send(RecordingCommand::CancelRecording { response: response_tx })
            .await
            .map_err(|_| "Failed to send command".to_string())?;
        
        response_rx.await.map_err(|_| "Failed to receive response".to_string())?
    }
}