use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::time::{sleep, Duration};
use serde_json;

use crate::db::Database;
use crate::transcription::Transcriber;
use crate::audio::AudioConverter;

#[derive(Debug, Clone)]
pub struct ProcessingJob {
    pub filename: String,
    pub audio_path: PathBuf,
    pub duration_ms: i32,
}

#[derive(Debug, Clone, serde::Serialize)]
pub enum ProcessingStatus {
    Queued { position: usize },
    Processing { filename: String },
    Converting { filename: String },
    Transcribing { filename: String },
    Complete { filename: String, transcript: String },
    Failed { filename: String, error: String },
}

pub struct ProcessingQueue {
    sender: mpsc::Sender<ProcessingJob>,
}

impl ProcessingQueue {
    pub fn new(
        database: Arc<Database>,
        models_dir: PathBuf,
    ) -> (Self, mpsc::Receiver<ProcessingStatus>) {
        let (job_tx, mut job_rx) = mpsc::channel::<ProcessingJob>(100);
        let (status_tx, status_rx) = mpsc::channel::<ProcessingStatus>(100);
        
        // Spawn the processing worker using Tauri's runtime
        tauri::async_runtime::spawn(async move {
            let mut queue: Vec<ProcessingJob> = Vec::new();
            let mut processing = false;
            
            loop {
                // Check for new jobs
                while let Ok(job) = job_rx.try_recv() {
                    queue.push(job);
                    // Notify about queue position
                    for (i, _queued_job) in queue.iter().enumerate() {
                        if !processing || i > 0 {
                            let _ = status_tx.send(ProcessingStatus::Queued { 
                                position: if processing { i } else { i + 1 } 
                            }).await;
                        }
                    }
                }
                
                // Process the next job if not currently processing
                if !processing && !queue.is_empty() {
                    processing = true;
                    let job = queue.remove(0);
                    
                    // Update status
                    let _ = status_tx.send(ProcessingStatus::Processing { 
                        filename: job.filename.clone() 
                    }).await;
                    
                    // Wait for file to be fully written with retries
                    let mut retry_count = 0;
                    let max_retries = 10;
                    let mut file_ready = false;
                    
                    while retry_count < max_retries && !file_ready {
                        sleep(Duration::from_millis(500)).await;
                        
                        match std::fs::metadata(&job.audio_path) {
                            Ok(metadata) if metadata.len() > 1024 => {
                                file_ready = true;
                                println!("Audio file ready after {} retries, size: {} bytes", retry_count, metadata.len());
                            }
                            Ok(metadata) => {
                                println!("Audio file exists but too small ({} bytes), retry {}/{}", metadata.len(), retry_count + 1, max_retries);
                            }
                            Err(e) => {
                                println!("Audio file not found yet, retry {}/{}: {}", retry_count + 1, max_retries, e);
                            }
                        }
                        retry_count += 1;
                    }
                    
                    // Check if file exists and is valid
                    if file_ready {
                        match std::fs::metadata(&job.audio_path) {
                            Ok(metadata) if metadata.len() > 1024 => {
                            // Check if we need to convert the audio file
                            let audio_path_for_transcription = if AudioConverter::needs_conversion(&job.audio_path) {
                                println!("Converting audio file to WAV format...");
                                
                                // Update status to converting
                                let _ = status_tx.send(ProcessingStatus::Converting { 
                                    filename: job.filename.clone() 
                                }).await;
                                
                                let wav_path = AudioConverter::get_wav_path(&job.audio_path);
                                
                                match AudioConverter::convert_to_wav(&job.audio_path, &wav_path) {
                                    Ok(_) => {
                                        println!("Audio conversion successful");
                                        wav_path
                                    }
                                    Err(e) => {
                                        let _ = status_tx.send(ProcessingStatus::Failed { 
                                            filename: job.filename.clone(),
                                            error: format!("Audio conversion failed: {}", e),
                                        }).await;
                                        processing = false;
                                        continue;
                                    }
                                }
                            } else {
                                job.audio_path.clone()
                            };
                            
                            // Update to transcribing
                            let _ = status_tx.send(ProcessingStatus::Transcribing { 
                                filename: job.filename.clone() 
                            }).await;
                            
                            // File is valid, proceed with transcription
                            // This is a limitation - we can't access settings from here
                            // For now, try to find any available model
                            let mut model_path = models_dir.join("ggml-tiny.en.bin");
                            if !model_path.exists() {
                                // Try base model
                                model_path = models_dir.join("ggml-base.en.bin");
                                if !model_path.exists() {
                                    // Find any .bin file
                                    let mut found = false;
                                    if let Ok(entries) = std::fs::read_dir(&models_dir) {
                                        for entry in entries.filter_map(Result::ok) {
                                            let path = entry.path();
                                            if path.extension().and_then(|e| e.to_str()) == Some("bin") {
                                                model_path = path;
                                                found = true;
                                                break;
                                            }
                                        }
                                    }
                                    if !found {
                                        eprintln!("No model files found in {:?}", models_dir);
                                    }
                                }
                            }
                            
                            if model_path.exists() {
                                match Transcriber::new(&model_path) {
                                    Ok(transcriber) => {
                                        match transcriber.transcribe(&audio_path_for_transcription) {
                                            Ok(transcript) => {
                                                println!("Transcription successful: {} chars", transcript.len());
                                                
                                                // Save to database
                                                if let Err(e) = database.save_transcript(
                                                    &transcript,
                                                    job.duration_ms,
                                                    Some(&serde_json::json!({
                                                        "filename": job.filename,
                                                        "audio_path": job.audio_path.to_str().unwrap_or("")
                                                    }).to_string())
                                                ).await {
                                                    eprintln!("Failed to save transcript to database: {}", e);
                                                }
                                                
                                                let _ = status_tx.send(ProcessingStatus::Complete { 
                                                    filename: job.filename.clone(),
                                                    transcript,
                                                }).await;
                                                
                                                // Clean up temporary WAV file if we converted
                                                if AudioConverter::needs_conversion(&job.audio_path) {
                                                    let wav_path = AudioConverter::get_wav_path(&job.audio_path);
                                                    if wav_path.exists() {
                                                        let _ = std::fs::remove_file(&wav_path);
                                                        println!("Cleaned up temporary WAV file");
                                                    }
                                                }
                                            }
                                            Err(e) => {
                                                eprintln!("Transcription failed: {}", e);
                                                let _ = status_tx.send(ProcessingStatus::Failed { 
                                                    filename: job.filename.clone(),
                                                    error: format!("Transcription failed: {}", e),
                                                }).await;
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        eprintln!("Failed to create transcriber: {}", e);
                                        let _ = status_tx.send(ProcessingStatus::Failed { 
                                            filename: job.filename.clone(),
                                            error: format!("Failed to create transcriber: {}", e),
                                        }).await;
                                    }
                                }
                            } else {
                                eprintln!("Model file not found at: {:?}", model_path);
                                let _ = status_tx.send(ProcessingStatus::Failed { 
                                    filename: job.filename.clone(),
                                    error: "Whisper model not found".to_string(),
                                }).await;
                            }
                        }
                            _ => {
                                eprintln!("Audio file not ready or too small");
                                let _ = status_tx.send(ProcessingStatus::Failed { 
                                    filename: job.filename.clone(),
                                    error: "Audio file not ready or too small".to_string(),
                                }).await;
                            }
                        }
                    } else {
                        // File not ready after all retries
                        eprintln!("Audio file not ready after {} retries", max_retries);
                        let _ = status_tx.send(ProcessingStatus::Failed { 
                            filename: job.filename.clone(),
                            error: format!("Audio file not ready after {} seconds", max_retries / 2),
                        }).await;
                    }
                    
                    processing = false;
                    
                    // Update queue positions after processing
                    for (i, _) in queue.iter().enumerate() {
                        let _ = status_tx.send(ProcessingStatus::Queued { 
                            position: i + 1 
                        }).await;
                    }
                }
                
                // Small delay to prevent busy loop
                sleep(Duration::from_millis(100)).await;
            }
        });
        
        (ProcessingQueue { sender: job_tx }, status_rx)
    }
    
    pub async fn queue_job(&self, job: ProcessingJob) -> Result<(), String> {
        println!("Queueing processing job for file: {}", job.filename);
        self.sender.send(job).await
            .map_err(|_| "Failed to queue processing job".to_string())
    }
}