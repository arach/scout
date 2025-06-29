use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use std::path::PathBuf;
use crate::audio::ring_buffer_recorder::RingBufferRecorder;
use crate::transcription::Transcriber;
use crate::logger::{info, debug, warn, error, Component};

#[derive(Debug)]
pub struct ChunkRequest {
    pub chunk_id: usize,
    pub start_offset: Duration,
    pub duration: Duration,
}

#[derive(Debug)]
pub struct ChunkResult {
    pub chunk_id: usize,
    pub text: String,
    pub start_offset: Duration,
    pub duration: Duration,
}

/// Manages chunked transcription using a ring buffer for real-time processing
pub struct RingBufferTranscriber {
    ring_buffer: Arc<RingBufferRecorder>,
    transcriber: Arc<Mutex<Transcriber>>,
    chunk_tx: mpsc::Sender<ChunkRequest>,
    result_rx: Arc<Mutex<mpsc::Receiver<ChunkResult>>>,
    worker_handle: Option<JoinHandle<()>>,
    temp_dir: PathBuf,
    next_chunk_id: usize,
}

impl RingBufferTranscriber {
    pub fn new(
        ring_buffer: Arc<RingBufferRecorder>,
        transcriber: Arc<Mutex<Transcriber>>,
        temp_dir: PathBuf,
    ) -> Self {
        let (chunk_tx, chunk_rx) = mpsc::channel::<ChunkRequest>(32);
        let (result_tx, result_rx) = mpsc::channel::<ChunkResult>(32);
        
        // Start worker thread for processing chunks
        let worker_handle = Some(tokio::spawn(Self::chunk_worker(
            ring_buffer.clone(),
            transcriber.clone(),
            chunk_rx,
            result_tx,
            temp_dir.clone(),
        )));
        
        Self {
            ring_buffer,
            transcriber,
            chunk_tx,
            result_rx: Arc::new(Mutex::new(result_rx)),
            worker_handle,
            temp_dir,
            next_chunk_id: 0,
        }
    }
    
    /// Submit a chunk for transcription
    pub async fn process_chunk(&mut self, start_offset: Duration, duration: Duration) -> Result<(), String> {
        let chunk_request = ChunkRequest {
            chunk_id: self.next_chunk_id,
            start_offset,
            duration,
        };
        
        debug(Component::RingBuffer, &format!("Submitting chunk {} for transcription (offset: {:?}, duration: {:?})", 
                 chunk_request.chunk_id, start_offset, duration));
        
        self.chunk_tx.send(chunk_request).await
            .map_err(|e| format!("Failed to send chunk request: {}", e))?;
        
        self.next_chunk_id += 1;
        Ok(())
    }
    
    /// Try to get a completed chunk result (non-blocking)
    pub fn try_get_result(&self) -> Option<ChunkResult> {
        if let Ok(mut rx) = self.result_rx.try_lock() {
            rx.try_recv().ok()
        } else {
            None
        }
    }
    
    /// Get all available results (non-blocking)
    pub fn get_all_results(&self) -> Vec<ChunkResult> {
        let mut results = Vec::new();
        
        if let Ok(mut rx) = self.result_rx.try_lock() {
            while let Ok(result) = rx.try_recv() {
                results.push(result);
            }
        }
        
        results
    }
    
    /// Wait for all pending chunks to complete and collect results
    pub async fn finish_and_collect_results(mut self) -> Result<Vec<ChunkResult>, String> {
        // Close the chunk sender to signal no more chunks
        // We need to move chunk_tx out of self to drop it
        let _chunk_tx = std::mem::replace(&mut self.chunk_tx, {
            // Create a dummy channel that we'll never use
            let (tx, _) = mpsc::channel(1);
            tx
        });
        // Drop the original sender by letting _chunk_tx go out of scope
        
        // Wait for worker to finish
        if let Some(handle) = self.worker_handle.take() {
            handle.await
                .map_err(|e| format!("Worker thread panicked: {}", e))?;
        }
        
        // Collect all remaining results
        let mut all_results = Vec::new();
        
        if let Ok(mut rx) = self.result_rx.try_lock() {
            while let Ok(result) = rx.try_recv() {
                all_results.push(result);
            }
        }
        
        // Sort results by chunk_id to maintain order
        all_results.sort_by_key(|r| r.chunk_id);
        
        Ok(all_results)
    }
    
    /// Worker task that processes chunk requests
    async fn chunk_worker(
        ring_buffer: Arc<RingBufferRecorder>,
        transcriber: Arc<Mutex<Transcriber>>,
        mut chunk_rx: mpsc::Receiver<ChunkRequest>,
        result_tx: mpsc::Sender<ChunkResult>,
        temp_dir: PathBuf,
    ) {
        info(Component::RingBuffer, "Ring buffer transcriber worker started");
        
        while let Some(chunk_request) = chunk_rx.recv().await {
            debug(Component::RingBuffer, &format!("Processing chunk {} (offset: {:?}, duration: {:?})", 
                     chunk_request.chunk_id, chunk_request.start_offset, chunk_request.duration));
            
            match Self::process_single_chunk(
                &ring_buffer,
                &transcriber,
                &chunk_request,
                &temp_dir,
            ).await {
                Ok(result) => {
                    info(Component::RingBuffer, &format!("Chunk {} completed: \"{}\"", chunk_request.chunk_id, result.text));
                    if let Err(e) = result_tx.send(result).await {
                        error(Component::RingBuffer, &format!("Failed to send chunk result: {}", e));
                        break;
                    }
                }
                Err(e) => {
                    error(Component::RingBuffer, &format!("Failed to process chunk {}: {}", chunk_request.chunk_id, e));
                    
                    // Send empty result to maintain order
                    let error_result = ChunkResult {
                        chunk_id: chunk_request.chunk_id,
                        text: String::new(),
                        start_offset: chunk_request.start_offset,
                        duration: chunk_request.duration,
                    };
                    
                    if let Err(e) = result_tx.send(error_result).await {
                        error(Component::RingBuffer, &format!("Failed to send error result: {}", e));
                        break;
                    }
                }
            }
        }
        
        info(Component::RingBuffer, "Ring buffer transcriber worker finished");
    }
    
    /// Process a chunk synchronously and return the result immediately
    pub async fn process_chunk_sync(
        &self,
        chunk_id: usize,
        start_offset: Duration,
        duration: Duration,
    ) -> Result<String, String> {
        debug(Component::RingBuffer, &format!("Processing chunk {} (offset: {:?}, duration: {:?}) synchronously", 
                 chunk_id, start_offset, duration));
        
        // Extract chunk data from ring buffer
        let chunk_data = self.ring_buffer.extract_chunk(start_offset, duration)?;
        debug(Component::RingBuffer, &format!("Extracted {} samples for chunk {}", chunk_data.len(), chunk_id));
        
        if chunk_data.is_empty() {
            return Ok(String::new());
        }
        
        // Save chunk to temporary file
        let chunk_filename = format!("ring_chunk_{}.wav", chunk_id);
        let chunk_path = self.temp_dir.join(&chunk_filename);
        
        self.ring_buffer.save_chunk_to_file(&chunk_data, &chunk_path)?;
        
        // Transcribe the chunk
        let text = {
            let transcriber = self.transcriber.lock().await;
            transcriber.transcribe_file(&chunk_path)
                .map_err(|e| format!("Transcription failed: {}", e))?
        };
        
        info(Component::RingBuffer, &format!("Chunk {} completed: \"{}\"", chunk_id, text));
        
        // Clean up temporary file
        if let Err(e) = std::fs::remove_file(&chunk_path) {
            warn(Component::RingBuffer, &format!("Failed to clean up chunk file: {}", e));
        }
        
        Ok(text)
    }

    /// Process a single chunk request
    async fn process_single_chunk(
        ring_buffer: &RingBufferRecorder,
        transcriber: &Arc<Mutex<Transcriber>>,
        request: &ChunkRequest,
        temp_dir: &PathBuf,
    ) -> Result<ChunkResult, String> {
        // Extract chunk data from ring buffer
        let chunk_data = ring_buffer.extract_chunk(request.start_offset, request.duration)?;
        
        if chunk_data.is_empty() {
            return Ok(ChunkResult {
                chunk_id: request.chunk_id,
                text: String::new(),
                start_offset: request.start_offset,
                duration: request.duration,
            });
        }
        
        // Save chunk to temporary file
        let chunk_filename = format!("ring_chunk_{}.wav", request.chunk_id);
        let chunk_path = temp_dir.join(&chunk_filename);
        
        ring_buffer.save_chunk_to_file(&chunk_data, &chunk_path)?;
        
        // Transcribe the chunk
        let text = {
            let transcriber = transcriber.lock().await;
            transcriber.transcribe_file(&chunk_path)
                .map_err(|e| format!("Transcription failed: {}", e))?
        };
        
        // Clean up temporary file
        if let Err(e) = std::fs::remove_file(&chunk_path) {
            warn(Component::RingBuffer, &format!("Failed to clean up chunk file: {}", e));
        }
        
        Ok(ChunkResult {
            chunk_id: request.chunk_id,
            text,
            start_offset: request.start_offset,
            duration: request.duration,
        })
    }
}

impl Drop for RingBufferTranscriber {
    fn drop(&mut self) {
        // Ensure worker is cleaned up
        if let Some(handle) = self.worker_handle.take() {
            handle.abort();
        }
    }
}