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
            chunk_duration: Duration::from_secs(5), // 5-second chunks
            threshold_duration: Duration::from_secs(5), // Start chunking after 5 seconds
            recording_start_time: Instant::now(),
        }
    }
    
    /// Start monitoring the ring buffer recording
    pub async fn start_monitoring(
        mut self,
        ring_transcriber: crate::transcription::ring_buffer_transcriber::RingBufferTranscriber,
    ) -> (tokio::task::JoinHandle<Self>, mpsc::Sender<()>) {
        let (stop_tx, mut stop_rx) = mpsc::channel::<()>(1);
        
        let handle = tokio::spawn(async move {
            println!("📊 Ring buffer monitor started");
            
            // Store the ring transcriber for later use
            let mut ring_transcriber = Some(ring_transcriber);
            
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
                let sample_count = self.ring_buffer.sample_count();
                
                // Debug ring buffer status
                if elapsed.as_secs() % 2 == 0 { // Log every 2 seconds to avoid spam
                    println!("📊 Ring buffer status: elapsed={:.1}s, buffer_duration={:.1}s, samples={}", 
                             elapsed.as_secs_f64(), buffer_duration.as_secs_f64(), sample_count);
                }
                
                // Check if we should start chunking
                if elapsed > self.threshold_duration && self.chunked_transcriber.is_none() {
                    println!("🚀 Recording exceeds {}s, starting ring buffer transcription", 
                             self.threshold_duration.as_secs());
                    
                    if sample_count == 0 {
                        println!("⚠️  Ring buffer has no samples - audio may not be flowing to ring buffer");
                    }
                    
                    // Use the pre-created ring transcriber
                    if let Some(transcriber) = ring_transcriber.take() {
                        self.chunked_transcriber = Some(transcriber);
                    }
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
        if let Some(mut chunked) = self.chunked_transcriber.take() {
            let buffer_duration = self.ring_buffer.get_duration();
            let remaining_duration = buffer_duration.saturating_sub(self.last_chunk_time);
            
            // Process any remaining audio as a final chunk
            if remaining_duration > Duration::from_millis(500) { // Only process if > 500ms
                println!("🏁 Processing final ring buffer chunk (start: {:?}, duration: {:?})", 
                         self.last_chunk_time, remaining_duration);
                
                match chunked.process_chunk(self.last_chunk_time, remaining_duration).await {
                    Ok(_) => {
                        println!("✅ Final ring buffer chunk submitted successfully");
                    }
                    Err(e) => {
                        eprintln!("❌ Failed to submit final ring buffer chunk: {}", e);
                    }
                }
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