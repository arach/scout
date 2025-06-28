use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio::time;
use crate::audio::ring_buffer_recorder::RingBufferRecorder;
use crate::transcription::ring_buffer_transcriber::RingBufferTranscriber;
use crate::logger::{info, debug, warn, error, Component};

/// Monitors ring buffer recording and triggers chunking when appropriate
pub struct RingBufferMonitor {
    ring_buffer: Arc<RingBufferRecorder>,
    chunked_transcriber: Option<RingBufferTranscriber>,
    last_chunk_time: Duration,
    chunk_duration: Duration,
    threshold_duration: Duration,
    recording_start_time: Instant,
    completed_chunks: Vec<String>, // Store completed chunk texts
    next_chunk_id: usize,
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
            completed_chunks: Vec::new(),
            next_chunk_id: 0,
        }
    }
    
    /// Start monitoring the ring buffer recording
    pub async fn start_monitoring(
        mut self,
        ring_transcriber: crate::transcription::ring_buffer_transcriber::RingBufferTranscriber,
    ) -> (tokio::task::JoinHandle<Self>, mpsc::Sender<()>) {
        let (stop_tx, mut stop_rx) = mpsc::channel::<()>(1);
        
        let handle = tokio::spawn(async move {
            info(Component::RingBuffer, "Ring buffer monitor started");
            
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
                        
                        // Process chunk synchronously and collect result immediately
                        println!("🔍 Processing chunk {} at offset {:?} with duration {:?}", 
                                 self.next_chunk_id, self.last_chunk_time, self.chunk_duration);
                        match chunked.process_chunk_sync(self.next_chunk_id, self.last_chunk_time, self.chunk_duration).await {
                            Ok(text) => {
                                if !text.is_empty() {
                                    println!("📝 Collected chunk {}: \"{}\"", self.next_chunk_id, text);
                                    self.completed_chunks.push(text);
                                } else {
                                    println!("⚠️ Chunk {} was empty", self.next_chunk_id);
                                }
                                self.last_chunk_time += self.chunk_duration;
                                self.next_chunk_id += 1;
                            }
                            Err(e) => {
                                eprintln!("❌ Failed to process ring buffer chunk: {}", e);
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
        println!("🏁 Recording complete, collecting all chunks...");
        println!("📊 Already collected {} chunks during recording", self.completed_chunks.len());
        
        if let Some(mut chunked) = self.chunked_transcriber.take() {
            let buffer_duration = self.ring_buffer.get_duration();
            let remaining_duration = buffer_duration.saturating_sub(self.last_chunk_time);
            
            // Process any remaining audio as a final chunk
            if remaining_duration > Duration::from_millis(500) { // Only process if > 500ms
                println!("🏁 Processing final ring buffer chunk (start: {:?}, duration: {:?})", 
                         self.last_chunk_time, remaining_duration);
                
                // Adjust duration to ensure it aligns with channel boundaries
                let sample_rate = 48000; // Default sample rate
                let channels = 1; // Mono
                let total_samples = (remaining_duration.as_secs_f32() * sample_rate as f32 * channels as f32) as usize;
                let aligned_samples = (total_samples / channels) * channels;
                let aligned_duration = Duration::from_secs_f32(aligned_samples as f32 / (sample_rate as f32 * channels as f32));
                
                println!("📐 Aligned final chunk duration from {:?} to {:?}", remaining_duration, aligned_duration);
                
                // Process final chunk synchronously
                match chunked.process_chunk_sync(self.next_chunk_id, self.last_chunk_time, aligned_duration).await {
                    Ok(text) => {
                        if !text.is_empty() {
                            println!("📝 Collected final chunk {}: \"{}\"", self.next_chunk_id, text);
                            self.completed_chunks.push(text);
                        }
                    }
                    Err(e) => {
                        eprintln!("❌ Failed to process final ring buffer chunk: {}", e);
                    }
                }
            }
            
            // No need to wait for async results - we already have everything
            println!("✅ Total chunks collected: {}", self.completed_chunks.len());
            
            // Debug: Show all collected chunks
            for (i, chunk) in self.completed_chunks.iter().enumerate() {
                println!("📝 Chunk {}: {}", i, chunk);
            }
            
            Ok(self.completed_chunks)
        } else {
            // Recording was too short for chunking, return any chunks we did collect
            if !self.completed_chunks.is_empty() {
                println!("📝 Returning {} chunks from short recording", self.completed_chunks.len());
                Ok(self.completed_chunks)
            } else {
                println!("⚠️ No chunks were processed");
                Ok(vec![])
            }
        }
    }
}