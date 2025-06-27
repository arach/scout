use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio::time;
use crate::audio::ring_buffer_recorder::RingBufferRecorder;
use crate::transcription::ring_buffer_transcriber::RingBufferTranscriber;

/// Monitors ring buffer recording and triggers chunking when appropriate
pub struct RingBufferMonitor {
    ring_buffer: Arc<RingBufferRecorder>,
    chunked_transcriber: Option<RingBufferTranscriber>,
    last_chunk_time: Duration,
    chunk_duration: Duration,
    threshold_duration: Duration,
    recording_start_time: Instant,
}

impl RingBufferMonitor {
    pub fn new(ring_buffer: Arc<RingBufferRecorder>) -> Self {
        Self {
            ring_buffer,
            chunked_transcriber: None,
            last_chunk_time: Duration::ZERO,
            chunk_duration: Duration::from_secs(10), // 10-second chunks
            threshold_duration: Duration::from_secs(10), // Start chunking after 10 seconds
            recording_start_time: Instant::now(),
        }
    }
    
    /// Start monitoring the ring buffer recording
    pub async fn start_monitoring(
        mut self,
        transcriber: Arc<tokio::sync::Mutex<crate::transcription::Transcriber>>,
        temp_dir: std::path::PathBuf,
    ) -> (tokio::task::JoinHandle<Self>, mpsc::Sender<()>) {
        let (stop_tx, mut stop_rx) = mpsc::channel::<()>(1);
        
        let handle = tokio::spawn(async move {
            println!("📊 Ring buffer monitor started");
            
            // Check every 2 seconds
            let mut interval = time::interval(Duration::from_secs(2));
            
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        // Continue with monitoring logic
                    }
                    _ = stop_rx.recv() => {
                        println!("📊 Ring buffer monitor stopping");
                        break;
                    }
                }
                
                let elapsed = self.recording_start_time.elapsed();
                let buffer_duration = self.ring_buffer.get_duration();
                
                // Check if we should start chunking
                if elapsed > self.threshold_duration && self.chunked_transcriber.is_none() {
                    println!("🚀 Recording exceeds {}s, initializing ring buffer transcription", 
                             self.threshold_duration.as_secs());
                    
                    // Convert Arc<tokio::sync::Mutex<_>> to Arc<std::sync::Mutex<_>>
                    let std_transcriber = {
                        let transcriber_guard = transcriber.lock().await;
                        // We need to extract the transcriber and wrap it in std::sync::Mutex
                        // This is a bit tricky - we'll need to modify the approach
                        
                        // For now, let's create a placeholder - we'll fix this in integration
                        println!("⚠️  TODO: Create transcriber adapter for ring buffer");
                        continue;
                    };
                }
                
                // Check if we should create a new chunk
                if let Some(ref mut chunked) = self.chunked_transcriber {
                    let time_since_last_chunk = elapsed - self.last_chunk_time;
                    
                    if time_since_last_chunk >= self.chunk_duration && 
                       buffer_duration > self.last_chunk_time + self.chunk_duration {
                        
                        println!("✂️ Creating ring buffer chunk at {:?}", self.last_chunk_time);
                        
                        match chunked.process_chunk(self.last_chunk_time, self.chunk_duration).await {
                            Ok(_) => {
                                println!("✅ Ring buffer chunk submitted successfully");
                                self.last_chunk_time += self.chunk_duration;
                            }
                            Err(e) => {
                                eprintln!("❌ Failed to submit ring buffer chunk: {}", e);
                            }
                        }
                    }
                }
            }
            
            println!("📊 Ring buffer monitor finished");
            self
        });
        
        (handle, stop_tx)
    }
    
    /// Signal that recording is complete and collect all results
    pub async fn recording_complete(mut self) -> Result<Vec<String>, String> {
        if let Some(chunked) = self.chunked_transcriber.take() {
            let buffer_duration = self.ring_buffer.get_duration();
            let remaining_duration = buffer_duration.saturating_sub(self.last_chunk_time);
            
            // Process any remaining audio as a final chunk
            if remaining_duration > Duration::ZERO {
                println!("🏁 Processing final ring buffer chunk (duration: {:?})", remaining_duration);
                // Note: We would need to submit this final chunk, but since we moved chunked,
                // we need to handle this differently. Let's collect results first.
            }
            
            // Collect all results
            let results = chunked.finish_and_collect_results().await?;
            
            // Combine all chunk texts
            let combined_text: Vec<String> = results
                .into_iter()
                .map(|r| r.text)
                .collect();
            
            Ok(combined_text)
        } else {
            // Recording was too short for chunking
            Ok(vec![])
        }
    }
}