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
    ) -> Self {
        let (command_tx, mut command_rx) = mpsc::channel::<RecordingCommand>(100);
        
        // Spawn the workflow task using Tauri's runtime
        tauri::async_runtime::spawn(async move {
            let mut current_recording: Option<ActiveRecording> = None;
            
            while let Some(command) = command_rx.recv().await {
                match command {
                    RecordingCommand::StartRecording { device_name, response } => {
                        println!("📝 Starting recording workflow...");
                        // Generate filename
                        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
                        let filename = format!("recording_{}.wav", timestamp);
                        let path = recordings_dir.join(&filename);
                        
                        println!("🔧 Initializing transcription context for real-time chunking...");
                        // Initialize transcription context for real-time chunking
                        let transcription_context = match TranscriptionContext::new_from_db(
                            database.clone(),
                            models_dir.clone(),
                        ) {
                            Ok(ctx) => ctx,
                            Err(e) => {
                                println!("⚠️ Failed to create transcription context: {}", e);
                                println!("📦 Falling back to traditional processing queue");
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
                                    println!("🔗 Detected ring buffer strategy - connecting audio samples");
                                    
                                    // Create a channel to send samples from AudioRecorder thread to transcription context
                                    let (sample_tx, sample_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<f32>>();
                                    
                                    // Get audio device info to check channels
                                    let recorder_guard = recorder.lock().await;
                                    let device_info = recorder_guard.get_current_device_info();
                                    let audio_channels = device_info.as_ref().map(|d| d.channels).unwrap_or(2) as usize;
                                    drop(recorder_guard);
                                    
                                    println!("🔊 Audio device has {} channels, ring buffer expects 1 channel", audio_channels);
                                    
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
                                        eprintln!("Failed to set sample callback: {}", e);
                                        None
                                    } else {
                                        println!("✅ AudioRecorder callback set - samples will be captured");
                                        drop(recorder);
                                        println!("🔗 Connected AudioRecorder to RingBuffer via sample forwarding");
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
                                        println!("🎙️ Started recording with transcription strategy: {}", strategy_name);
                                        
                                        // Create sample processing task if we have ring buffer
                                        if let Some(mut sample_rx) = sample_rx_option {
                                            println!("🔍 Attempting to get ring buffer reference from transcription context");
                                            if let Some(ring_buffer) = transcription_context.get_ring_buffer() {
                                                println!("✅ Got ring buffer reference successfully");
                                                let ring_buffer_clone = ring_buffer.clone();
                                                tokio::spawn(async move {
                                                    let mut sample_count = 0;
                                                    let mut batch_count = 0;
                                                    println!("🎯 Ring buffer sample processor task starting");
                                                    while let Some(samples) = sample_rx.recv().await {
                                                        batch_count += 1;
                                                        sample_count += samples.len();
                                                        
                                                        // Debug: Check ring buffer state before adding
                                                        let before_count = ring_buffer_clone.sample_count();
                                                        
                                                        // Feed samples directly to ring buffer
                                                        if let Err(e) = ring_buffer_clone.add_samples(&samples) {
                                                            eprintln!("Failed to add samples to ring buffer: {}", e);
                                                        }
                                                        
                                                        // Debug: Check ring buffer state after adding
                                                        let after_count = ring_buffer_clone.sample_count();
                                                        
                                                        // Log first few batches to verify audio is flowing
                                                        if batch_count <= 5 {
                                                            println!("🎵 Batch {}: {} samples received, buffer: {} -> {}", 
                                                                     batch_count, samples.len(), before_count, after_count);
                                                        }
                                                        
                                                        if sample_count % 48000 == 0 { // Log every second of audio
                                                            println!("🔊 Fed {} samples to ring buffer (buffer: {} -> {} samples)", 
                                                                     sample_count, before_count, after_count);
                                                        }
                                                    }
                                                    println!("🔊 Ring buffer feeding complete - {} samples processed in {} batches", 
                                                             sample_count, batch_count);
                                                    
                                                    // Force flush any remaining samples to ring buffer
                                                    if let Err(e) = ring_buffer_clone.finalize_recording() {
                                                        eprintln!("⚠️ Error finalizing ring buffer during sample feed completion: {}", e);
                                                    }
                                                });
                                                println!("📡 Ring buffer sample processing task started");
                                            } else {
                                                println!("❌ Failed to get ring buffer reference from transcription context");
                                                println!("🔍 Current strategy: {:?}", transcription_context.current_strategy_name());
                                                // Process samples without ring buffer - they'll be lost
                                                tokio::spawn(async move {
                                                    let mut sample_count = 0;
                                                    while let Some(samples) = sample_rx.recv().await {
                                                        sample_count += samples.len();
                                                    }
                                                    println!("⚠️ Discarded {} samples - no ring buffer available", sample_count);
                                                });
                                            }
                                        }
                                        
                                        current_recording = Some(ActiveRecording {
                                            filename: filename.clone(),
                                            start_time,
                                            transcription_context: Some(transcription_context),
                                            sample_channel: None, // Sample processing is handled in spawned task
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
                        println!("🎵 RecordingWorkflow: StopRecording command received");
                        if let Some(mut active_recording) = current_recording.take() {
                            let duration_ms = active_recording.start_time.elapsed().as_millis() as i32;
                            println!("🕒 Recording duration: {}ms", duration_ms);
                            
                            // Update to Stopping state briefly
                            progress_tracker.update(RecordingProgress::Stopping { 
                                filename: active_recording.filename.clone() 
                            });
                            
                            // Get device info before stopping recording
                            let recorder = recorder.lock().await;
                            let device_info = recorder.get_current_device_info();
                            println!("🛑 Calling recorder.stop_recording()...");
                            if let Err(e) = recorder.stop_recording() {
                                println!("❌ Failed to stop recording: {}", e);
                                // Update to idle on error
                                progress_tracker.update(RecordingProgress::Idle);
                                let _ = response.send(Err(e));
                                continue;
                            }
                            println!("✅ recorder.stop_recording() succeeded");
                            drop(recorder); // Release lock
                            
                            // Finish transcription strategy if available
                            if let Some(mut transcription_context) = active_recording.transcription_context.take() {
                                let strategy_name = transcription_context.current_strategy_name()
                                    .unwrap_or_else(|| "unknown".to_string());
                                println!("🎯 Finishing transcription with strategy: {}", strategy_name);
                                
                                // Add timeout to prevent hanging
                                let finish_timeout = tokio::time::timeout(
                                    tokio::time::Duration::from_secs(45), // 45 second timeout
                                    transcription_context.finish_recording()
                                ).await;
                                
                                match finish_timeout {
                                    Ok(Ok(transcription_result)) => {
                                        println!("✅ Transcription completed: {} chars in {:.2}s", 
                                                transcription_result.text.len(),
                                                transcription_result.processing_time_ms as f64 / 1000.0);
                                        
                                        // Save transcript to database
                                        let metadata = serde_json::json!({
                                            "model_used": transcription_result.strategy_used,
                                            "chunks_processed": transcription_result.chunks_processed,
                                            "processing_type": "ring_buffer"
                                        }).to_string();
                                        
                                        match database.save_transcript(
                                            &transcription_result.text,
                                            duration_ms,
                                            Some(&metadata),
                                            Some(&recordings_dir.join(&active_recording.filename).to_string_lossy()),
                                            None // TODO: Calculate actual file size
                                        ).await {
                                            Ok(transcript) => {
                                                println!("💾 Transcript saved to database with ID: {}", transcript.id);
                                                
                                                // Update to idle state first
                                                progress_tracker.update(RecordingProgress::Idle);
                                                
                                                // The progress tracker update will automatically notify the overlay
                                                println!("✅ Updated progress tracker to Idle state");
                                                
                                                // Emit processing-status complete for native overlay
                                                // since we're not going through the processing queue
                                                let processing_complete = crate::processing_queue::ProcessingStatus::Complete {
                                                    filename: active_recording.filename.clone(),
                                                    transcript: transcription_result.text.clone(),
                                                };
                                                if let Err(e) = app_handle.emit("processing-status", &processing_complete) {
                                                    eprintln!("❌ Failed to emit processing-status complete: {:?}", e);
                                                } else {
                                                    println!("✅ Emitted processing-status complete for native overlay");
                                                }
                                                
                                                // Emit transcript-created event
                                                println!("📤 Emitting transcript-created event for transcript ID: {}", transcript.id);
                                                println!("📊 Transcript details: {} chars, {}ms duration", 
                                                        transcript.text.len(), transcript.duration_ms);
                                                if let Err(e) = app_handle.emit("transcript-created", &transcript) {
                                                    eprintln!("❌ Failed to emit transcript-created event: {:?}", e);
                                                } else {
                                                    println!("✅ transcript-created event emitted successfully");
                                                }
                                                
                                                // Also emit directly to overlay window
                                                if let Some(overlay_window) = app_handle.get_webview_window("overlay") {
                                                    let _ = overlay_window.emit("transcript-created", &transcript);
                                                    println!("✅ Emitted transcript-created to overlay window");
                                                }
                                                
                                                // Give the event system time to process
                                                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                                                
                                                // Emit multiple completion events to ensure at least one is caught
                                                println!("📤 Emitting processing-complete event");
                                                if let Err(e) = app_handle.emit("processing-complete", &transcript) {
                                                    eprintln!("❌ Failed to emit processing-complete event: {:?}", e);
                                                } else {
                                                    println!("✅ processing-complete event emitted successfully");
                                                }
                                                
                                                // Also emit directly to overlay window
                                                if let Some(overlay_window) = app_handle.get_webview_window("overlay") {
                                                    let _ = overlay_window.emit("processing-complete", &transcript);
                                                    println!("✅ Emitted processing-complete to overlay window");
                                                }
                                                
                                                // Small delay between events
                                                tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
                                                
                                                // Also emit recording-completed as backup
                                                println!("📤 Emitting recording-completed event");
                                                if let Err(e) = app_handle.emit("recording-completed", &transcript.id) {
                                                    eprintln!("❌ Failed to emit recording-completed event: {:?}", e);
                                                } else {
                                                    println!("✅ recording-completed event emitted successfully");
                                                }
                                                
                                                // Also emit directly to overlay window
                                                if let Some(overlay_window) = app_handle.get_webview_window("overlay") {
                                                    let _ = overlay_window.emit("recording-completed", &transcript.id);
                                                    println!("✅ Emitted recording-completed to overlay window");
                                                }
                                                
                                                // Send response with transcript
                                                let _ = response.send(Ok(RecordingResult {
                                                    filename: active_recording.filename,
                                                    transcript: Some(transcription_result.text),
                                                    duration_ms,
                                                    device_name: device_info.as_ref().map(|d| d.name.clone()),
                                                    sample_rate: device_info.as_ref().map(|d| d.sample_rate),
                                                    channels: device_info.as_ref().map(|d| d.channels),
                                                }));
                                            }
                                            Err(e) => {
                                                eprintln!("❌ Failed to save transcript: {}", e);
                                                progress_tracker.update(RecordingProgress::Idle);
                                                let _ = response.send(Err(format!("Failed to save transcript: {}", e)));
                                            }
                                        }
                                        continue;
                                    }
                                    Ok(Err(e)) => {
                                        println!("❌ Transcription failed: {}", e);
                                        println!("📦 Falling back to traditional processing queue");
                                        
                                        // Log failure metrics for debugging
                                        let fallback_duration = active_recording.start_time.elapsed();
                                        println!("📊 === FALLBACK PERFORMANCE METRICS ===");
                                        println!("🎙️  Recording Duration: {:.2}s", fallback_duration.as_secs_f64());
                                        println!("❌ Strategy Failed: ring_buffer");
                                        println!("🔄 Reason: {}", e);
                                        println!("📦 Falling back to: traditional processing queue");
                                        println!("=======================================");
                                        
                                        // Fall back to traditional processing queue
                                    }
                                    Err(_) => {
                                        println!("⏰ Transcription timeout after 45 seconds!");
                                        println!("📦 Falling back to traditional processing queue");
                                        
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
                                println!("🚫 Cancelled transcription");
                                // TranscriptionContext doesn't need explicit cleanup
                            }
                            
                            // Delete the recording file
                            let audio_path = recordings_dir.join(&active_recording.filename);
                            if let Err(e) = tokio::fs::remove_file(&audio_path).await {
                                println!("Failed to delete cancelled recording: {}", e);
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