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
                        
                        // Start recording
                        let recorder = recorder.lock().await;
                        match recorder.start_recording(&path, device_name.as_deref()) {
                            Ok(_) => {
                                let start_time = std::time::Instant::now();
                                
                                // Start transcription strategy with estimated duration (unknown at start)
                                let mut transcription_context = transcription_context;
                                match transcription_context.start_recording(&path, None).await {
                                    Ok(_) => {
                                        let strategy_name = transcription_context.current_strategy_name()
                                            .unwrap_or_else(|| "unknown".to_string());
                                        println!("🎙️ Started recording with transcription strategy: {}", strategy_name);
                                        
                                        current_recording = Some(ActiveRecording {
                                            filename: filename.clone(),
                                            start_time,
                                            transcription_context: Some(transcription_context),
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