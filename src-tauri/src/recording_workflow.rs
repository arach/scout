use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};
use chrono;
use tauri::{Emitter, Manager};

use crate::audio::AudioRecorder;
use crate::recording_progress::RecordingProgress;
use crate::processing_queue::{ProcessingQueue, ProcessingJob};
use crate::transcription_context::TranscriptionContext;
use crate::db::Database;
use crate::settings::SettingsManager;
use crate::logger::{info, debug, warn, error, Component};

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
        processing_queue: Arc<ProcessingQueue>,
        database: Arc<Database>,
        models_dir: PathBuf,
        app_handle: tauri::AppHandle,
        settings: Arc<tokio::sync::Mutex<SettingsManager>>,
    ) -> Self {
        let (command_tx, mut command_rx) = mpsc::channel::<RecordingCommand>(100);
        
        // Spawn the workflow task using Tauri's runtime
        tauri::async_runtime::spawn(async move {
            let mut current_recording: Option<ActiveRecording> = None;
            
            while let Some(command) = command_rx.recv().await {
                match command {
                    RecordingCommand::StartRecording { device_name, response } => {
                        info(Component::Recording, "Starting recording workflow...");
                        
                        // Capture active app context on macOS
                        #[cfg(target_os = "macos")]
                        let app_context = crate::macos::get_active_app_context();
                        #[cfg(not(target_os = "macos"))]
                        let app_context: Option<crate::macos::AppContext> = None;
                        
                        if let Some(ref ctx) = app_context {
                            info(Component::Recording, &format!("Recording started in app: {} ({})", ctx.name, ctx.bundle_id));
                        }
                        
                        // Generate filename
                        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
                        let filename = format!("recording_{}.wav", timestamp);
                        let path = recordings_dir.join(&filename);
                        
                        info(Component::Recording, "Initializing transcription context for real-time chunking...");
                        // Initialize transcription context for real-time chunking
                        let transcription_context = match TranscriptionContext::new_from_db(
                            database.clone(),
                            models_dir.clone(),
                        ) {
                            Ok(ctx) => ctx,
                            Err(e) => {
                                warn(Component::Recording, &format!("Failed to create transcription context: {}", e));
                                info(Component::Recording, "Falling back to traditional processing queue");
                                // Continue with traditional recording workflow without strategy integration
                                let recorder = recorder.lock().await;
                                match recorder.start_recording(&path, device_name.as_deref()) {
                                    Ok(_) => {
                                        let start_time = std::time::Instant::now();
                                        current_recording = Some(ActiveRecording {
                                            filename: filename.clone(),
                                            start_time,
                                            transcription_context: None, // No transcription context
                                            sample_channel: None,
                                            app_context,
                                        });
                                        
                                        progress_tracker.update(RecordingProgress::Recording { 
                                            filename: filename.clone(),
                                            start_time: chrono::Utc::now().timestamp_millis() as u64
                                        });
                                        
                                        let _ = response.send(Ok(filename));
                                    }
                                    Err(e) => {
                                        progress_tracker.update(RecordingProgress::Idle);
                                        let _ = response.send(Err(e));
                                    }
                                }
                                continue;
                            }
                        };
                        
                        // Start transcription strategy first to get ring buffer setup
                        let mut transcription_context = transcription_context;
                        match transcription_context.start_recording(&path, None).await {
                            Ok(_) => {
                                // Set up sample callback to bridge AudioRecorder to RingBuffer
                                let strategy_name = transcription_context.current_strategy_name()
                                    .unwrap_or_else(|| "unknown".to_string());
                                
                                let sample_rx_option = if strategy_name == "ring_buffer" {
                                    info(Component::RingBuffer, "Detected ring buffer strategy - connecting audio samples");
                                    
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
                                            app_context,
                                        });
                                        
                                        // Update progress to Recording state
                                        progress_tracker.update(RecordingProgress::Recording { 
                                            filename: filename.clone(),
                                            start_time: chrono::Utc::now().timestamp_millis() as u64
                                        });
                                        
                                        let _ = response.send(Ok(filename));
                                    }
                                    Err(e) => {
                                        // Stop recording if transcription setup failed
                                        let _ = recorder.stop_recording();
                                        progress_tracker.update(RecordingProgress::Idle);
                                        let _ = response.send(Err(format!("Failed to setup transcription: {}", e)));
                                    }
                                }
                            }
                            Err(e) => {
                                // Go back to idle on error
                                progress_tracker.update(RecordingProgress::Idle);
                                let _ = response.send(Err(e));
                            }
                        }
                    }
                    
                    RecordingCommand::StopRecording { response } => {
                        info(Component::Recording, "RecordingWorkflow: StopRecording command received");
                        if let Some(mut active_recording) = current_recording.take() {
                            let duration_ms = active_recording.start_time.elapsed().as_millis() as i32;
                            info(Component::Recording, &format!("Recording duration: {}ms", duration_ms));
                            
                            // Update to Stopping state briefly
                            progress_tracker.update(RecordingProgress::Stopping { 
                                filename: active_recording.filename.clone() 
                            });
                            
                            // Get device info before stopping recording
                            let recorder = recorder.lock().await;
                            let device_info = recorder.get_current_device_info();
                            debug(Component::Recording, "Calling recorder.stop_recording()...");
                            if let Err(e) = recorder.stop_recording() {
                                error(Component::Recording, &format!("Failed to stop recording: {}", e));
                                // Update to idle on error
                                progress_tracker.update(RecordingProgress::Idle);
                                let _ = response.send(Err(e));
                                continue;
                            }
                            info(Component::Recording, "recorder.stop_recording() succeeded");
                            drop(recorder); // Release lock
                            
                            // Finish transcription strategy if available
                            if let Some(mut transcription_context) = active_recording.transcription_context.take() {
                                let strategy_name = transcription_context.current_strategy_name()
                                    .unwrap_or_else(|| "unknown".to_string());
                                let model_name = transcription_context.get_model_name().to_string();
                                info(Component::Transcription, &format!("Finishing transcription with strategy: {} using model: {}", strategy_name, model_name));
                                
                                // Add timeout to prevent hanging
                                let finish_timeout = tokio::time::timeout(
                                    tokio::time::Duration::from_secs(45), // 45 second timeout
                                    transcription_context.finish_recording()
                                ).await;
                                
                                match finish_timeout {
                                    Ok(Ok(transcription_result)) => {
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
                                        let post_processing = crate::post_processing::PostProcessingHooks::new(settings.clone());
                                        let (filtered_transcript, original_transcript, analysis_logs) = post_processing.execute_hooks(&transcription_result.text, "Ring Buffer", Some(duration_ms)).await;
                                        
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
                                        
                                        // Save filtered transcript to database
                                        match database.save_transcript(
                                            &filtered_transcript,
                                            duration_ms,
                                            Some(&metadata),
                                            Some(&recordings_dir.join(&active_recording.filename).to_string_lossy()),
                                            None // TODO: Calculate actual file size
                                        ).await {
                                            Ok(transcript) => {
                                                info(Component::Processing, &format!("Filtered transcript saved to database with ID: {}", transcript.id));
                                                
                                                // Update to idle state first
                                                progress_tracker.update(RecordingProgress::Idle);
                                                
                                                // The progress tracker update will automatically notify the overlay
                                                info(Component::Processing, "Updated progress tracker to Idle state");
                                                
                                                // Emit processing-status complete for native overlay
                                                // since we're not going through the processing queue
                                                let processing_complete = crate::processing_queue::ProcessingStatus::Complete {
                                                    filename: active_recording.filename.clone(),
                                                    transcript: filtered_transcript.clone(),
                                                };
                                                if let Err(e) = app_handle.emit("processing-status", &processing_complete) {
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
                                                if let Err(e) = app_handle.emit("transcript-created", &transcript) {
                                                    error(Component::UI, &format!("Failed to emit transcript-created event: {:?}", e));
                                                } else {
                                                    info(Component::UI, "transcript-created event emitted successfully");
                                                }
                                                
                                                // Also emit directly to overlay window
                                                if let Some(overlay_window) = app_handle.get_webview_window("overlay") {
                                                    let _ = overlay_window.emit("transcript-created", &transcript);
                                                    debug(Component::UI, "Emitted transcript-created to overlay window");
                                                }
                                                
                                                // Give the event system time to process
                                                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                                                
                                                // Emit multiple completion events to ensure at least one is caught
                                                debug(Component::UI, "Emitting processing-complete event");
                                                if let Err(e) = app_handle.emit("processing-complete", &transcript) {
                                                    error(Component::UI, &format!("Failed to emit processing-complete event: {:?}", e));
                                                } else {
                                                    info(Component::UI, "processing-complete event emitted successfully");
                                                }
                                                
                                                // Also emit directly to overlay window
                                                if let Some(overlay_window) = app_handle.get_webview_window("overlay") {
                                                    let _ = overlay_window.emit("processing-complete", &transcript);
                                                    debug(Component::UI, "Emitted processing-complete to overlay window");
                                                }
                                                
                                                // Small delay between events
                                                tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
                                                
                                                // Also emit recording-completed as backup
                                                debug(Component::UI, "Emitting recording-completed event");
                                                if let Err(e) = app_handle.emit("recording-completed", &transcript.id) {
                                                    error(Component::UI, &format!("Failed to emit recording-completed event: {:?}", e));
                                                } else {
                                                    info(Component::UI, "recording-completed event emitted successfully");
                                                }
                                                
                                                // Also emit directly to overlay window
                                                if let Some(overlay_window) = app_handle.get_webview_window("overlay") {
                                                    let _ = overlay_window.emit("recording-completed", &transcript.id);
                                                    debug(Component::UI, "Emitted recording-completed to overlay window");
                                                }
                                                
                                                // Send response with filtered transcript
                                                let _ = response.send(Ok(RecordingResult {
                                                    filename: active_recording.filename,
                                                    transcript: Some(filtered_transcript),
                                                    duration_ms,
                                                    device_name: device_info.as_ref().map(|d| d.name.clone()),
                                                    sample_rate: device_info.as_ref().map(|d| d.sample_rate),
                                                    channels: device_info.as_ref().map(|d| d.channels),
                                                }));
                                            }
                                            Err(e) => {
                                                error(Component::Processing, &format!("Failed to save transcript: {}", e));
                                                progress_tracker.update(RecordingProgress::Idle);
                                                let _ = response.send(Err(format!("Failed to save transcript: {}", e)));
                                            }
                                        }
                                        continue;
                                    }
                                    Ok(Err(e)) => {
                                        error(Component::Transcription, &format!("Transcription failed: {}", e));
                                        info(Component::Transcription, "Falling back to traditional processing queue");
                                        
                                        // Log failure metrics for debugging
                                        let fallback_duration = active_recording.start_time.elapsed();
                                        info(Component::Transcription, "=== FALLBACK PERFORMANCE METRICS ===");
                                        info(Component::Transcription, &format!("Recording Duration: {:.2}s", fallback_duration.as_secs_f64()));
                                        error(Component::Transcription, "Strategy Failed: ring_buffer");
                                        error(Component::Transcription, &format!("Reason: {}", e));
                                        info(Component::Transcription, "Falling back to: traditional processing queue");
                                        info(Component::Transcription, "=======================================");
                                        
                                        // Fall back to traditional processing queue
                                    }
                                    Err(_) => {
                                        error(Component::Transcription, "Transcription timeout after 45 seconds!");
                                        info(Component::Transcription, "Falling back to traditional processing queue");
                                        
                                        // Update to idle state on timeout
                                        progress_tracker.update(RecordingProgress::Idle);
                                        
                                        // Fall back to traditional processing queue
                                    }
                                }
                            }
                            
                            // Fallback: Use traditional processing queue
                            let audio_path = recordings_dir.join(&active_recording.filename);
                            let job = ProcessingJob {
                                filename: active_recording.filename.clone(),
                                audio_path,
                                duration_ms,
                                app_handle: Some(app_handle.clone()),
                                queue_entry_time: tokio::time::Instant::now(),
                                user_stop_time: Some(tokio::time::Instant::now()), // Recording just stopped
                                app_context: active_recording.app_context.clone(),
                            };
                            
                            // Queue the job for processing
                            let _ = processing_queue.queue_job(job).await;
                            
                            // Update to idle state immediately - recording is done
                            progress_tracker.update(RecordingProgress::Idle);
                            
                            // Send immediate response with device metadata
                            let _ = response.send(Ok(RecordingResult {
                                filename: active_recording.filename,
                                transcript: None,
                                duration_ms,
                                device_name: device_info.as_ref().map(|d| d.name.clone()),
                                sample_rate: device_info.as_ref().map(|d| d.sample_rate),
                                channels: device_info.as_ref().map(|d| d.channels),
                            }));
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
                            let audio_path = recordings_dir.join(&active_recording.filename);
                            if let Err(e) = tokio::fs::remove_file(&audio_path).await {
                                error(Component::Recording, &format!("Failed to delete cancelled recording: {}", e));
                            }
                            
                            // Update to idle state
                            progress_tracker.update(RecordingProgress::Idle);
                            
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