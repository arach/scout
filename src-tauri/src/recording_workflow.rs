use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};
use chrono;

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
                                    
                                    // Create callback for AudioRecorder
                                    let sample_callback = std::sync::Arc::new(move |samples: &[f32]| {
                                        // Send samples to transcription context asynchronously
                                        let samples_vec = samples.to_vec();
                                        if let Err(_) = sample_tx.send(samples_vec) {
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
                                            if let Some(ring_buffer) = transcription_context.get_ring_buffer() {
                                                let ring_buffer_clone = ring_buffer.clone();
                                                tokio::spawn(async move {
                                                    let mut sample_count = 0;
                                                    while let Some(samples) = sample_rx.recv().await {
                                                        sample_count += samples.len();
                                                        
                                                        // Feed samples directly to ring buffer
                                                        if let Err(e) = ring_buffer_clone.add_samples(&samples) {
                                                            eprintln!("Failed to add samples to ring buffer: {}", e);
                                                        }
                                                        
                                                        if sample_count % 48000 == 0 { // Log every second of audio
                                                            println!("🔊 Fed {} samples to ring buffer", sample_count);
                                                        }
                                                    }
                                                    println!("🔊 Ring buffer feeding complete - {} samples processed", sample_count);
                                                });
                                                println!("📡 Ring buffer sample processing task started");
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
                        if let Some(mut active_recording) = current_recording.take() {
                            let duration_ms = active_recording.start_time.elapsed().as_millis() as i32;
                            
                            // Update to Stopping state briefly
                            progress_tracker.update(RecordingProgress::Stopping { 
                                filename: active_recording.filename.clone() 
                            });
                            
                            // Get device info before stopping recording
                            let recorder = recorder.lock().await;
                            let device_info = recorder.get_current_device_info();
                            if let Err(e) = recorder.stop_recording() {
                                // Update to idle on error
                                progress_tracker.update(RecordingProgress::Idle);
                                let _ = response.send(Err(e));
                                continue;
                            }
                            drop(recorder); // Release lock
                            
                            // Finish transcription strategy if available
                            if let Some(mut transcription_context) = active_recording.transcription_context.take() {
                                let strategy_name = transcription_context.current_strategy_name()
                                    .unwrap_or_else(|| "unknown".to_string());
                                println!("🎯 Finishing transcription with strategy: {}", strategy_name);
                                match transcription_context.finish_recording().await {
                                    Ok(transcription_result) => {
                                        println!("✅ Transcription completed: {} chars in {:.2}s", 
                                                transcription_result.text.len(),
                                                transcription_result.processing_time_ms as f64 / 1000.0);
                                        
                                        // Skip traditional processing queue since we already have the result
                                        progress_tracker.update(RecordingProgress::Idle);
                                        
                                        let _ = response.send(Ok(RecordingResult {
                                            filename: active_recording.filename,
                                            transcript: Some(transcription_result.text),
                                            duration_ms,
                                            device_name: device_info.as_ref().map(|d| d.name.clone()),
                                            sample_rate: device_info.as_ref().map(|d| d.sample_rate),
                                            channels: device_info.as_ref().map(|d| d.channels),
                                        }));
                                        continue;
                                    }
                                    Err(e) => {
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
                                }
                            }
                            
                            // Fallback: Use traditional processing queue
                            let audio_path = recordings_dir.join(&active_recording.filename);
                            let job = ProcessingJob {
                                filename: active_recording.filename.clone(),
                                audio_path,
                                duration_ms,
                                app_handle: None, // TODO: pass app handle for transcript-created events
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