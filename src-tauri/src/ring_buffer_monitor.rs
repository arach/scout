use crate::audio::ring_buffer_recorder::RingBufferRecorder;
use crate::logger::{debug, error, info, warn, Component};
use crate::transcription::ring_buffer_transcriber::RingBufferTranscriber;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::time;

/// Monitors ring buffer recording and triggers chunking when appropriate
pub struct RingBufferMonitor {
    ring_buffer: Arc<RingBufferRecorder>,
    chunked_transcriber: Option<RingBufferTranscriber>,
    initial_transcriber: Option<RingBufferTranscriber>, // Store the initial transcriber for short recordings
    last_chunk_time: Duration,
    chunk_duration: Duration,
    threshold_duration: Duration,
    recording_start_time: Instant,
    completed_chunks: Vec<String>, // Store completed chunk texts
    next_chunk_id: usize,
    app_handle: Option<AppHandle>,
}

impl RingBufferMonitor {
    pub fn new(ring_buffer: Arc<RingBufferRecorder>) -> Self {
        Self {
            ring_buffer,
            chunked_transcriber: None,
            initial_transcriber: None,
            last_chunk_time: Duration::ZERO,
            chunk_duration: Duration::from_secs(5), // 5-second chunks for better coverage
            threshold_duration: Duration::from_secs(3), // Start chunking after 3 seconds for better short recording support
            recording_start_time: Instant::now(),
            completed_chunks: Vec::new(),
            next_chunk_id: 0,
            app_handle: None,
        }
    }

    pub fn with_app_handle(mut self, app_handle: AppHandle) -> Self {
        self.app_handle = Some(app_handle);
        self
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
            self.initial_transcriber = Some(ring_transcriber);

            // Check every 1 second for more responsive processing
            let mut interval = time::interval(Duration::from_secs(1));

            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        // Continue with monitoring logic
                    }
                    _ = stop_rx.recv() => {
                        info(Component::RingBuffer, "Ring buffer monitor stopping");
                        break;
                    }
                }

                let elapsed = self.recording_start_time.elapsed();
                let buffer_duration = self.ring_buffer.get_duration();
                let sample_count = self.ring_buffer.sample_count();

                // Debug ring buffer status
                if elapsed.as_secs() % 2 == 0 {
                    // Log every 2 seconds to avoid spam
                    info(Component::RingBuffer, &format!("Ring buffer status: elapsed={:.1}s, buffer_duration={:.1}s, samples={}",
                             elapsed.as_secs_f64(), buffer_duration.as_secs_f64(), sample_count));
                }

                // Start chunking after threshold duration
                if elapsed > self.threshold_duration && self.chunked_transcriber.is_none() {
                    info(
                        Component::RingBuffer,
                        &format!(
                            "Recording exceeds {}s, starting ring buffer transcription",
                            self.threshold_duration.as_secs()
                        ),
                    );

                    if sample_count == 0 {
                        warn(
                            Component::RingBuffer,
                            "Ring buffer has no samples - audio may not be flowing to ring buffer",
                        );
                    }

                    // Use the pre-created ring transcriber
                    if let Some(transcriber) = self.initial_transcriber.take() {
                        self.chunked_transcriber = Some(transcriber);
                    }
                }

                // Check if we should create a new chunk
                if let Some(ref mut chunked) = self.chunked_transcriber {
                    // Process chunk as soon as we have enough audio
                    if buffer_duration >= self.last_chunk_time + self.chunk_duration {
                        info(
                            Component::RingBuffer,
                            &format!("Creating ring buffer chunk at {:?}", self.last_chunk_time),
                        );

                        // Process chunk synchronously and collect result immediately
                        debug(
                            Component::RingBuffer,
                            &format!(
                                "Processing chunk {} at offset {:?} with duration {:?}",
                                self.next_chunk_id, self.last_chunk_time, self.chunk_duration
                            ),
                        );
                        match chunked
                            .process_chunk_sync(
                                self.next_chunk_id,
                                self.last_chunk_time,
                                self.chunk_duration,
                            )
                            .await
                        {
                            Ok(text) => {
                                if !text.is_empty() {
                                    info(
                                        Component::RingBuffer,
                                        &format!(
                                            "Collected chunk {}: \"{}\"",
                                            self.next_chunk_id, text
                                        ),
                                    );
                                    self.completed_chunks.push(text.clone());

                                    // Emit real-time transcription chunk event
                                    if let Some(ref app) = self.app_handle {
                                        let chunk_data = serde_json::json!({
                                            "id": self.next_chunk_id,
                                            "text": text,
                                            "timestamp": chrono::Utc::now().timestamp_millis(),
                                            "isPartial": false
                                        });
                                        if let Err(e) = app.emit("transcription-chunk", &chunk_data)
                                        {
                                            warn(
                                                Component::RingBuffer,
                                                &format!(
                                                    "Failed to emit transcription chunk: {}",
                                                    e
                                                ),
                                            );
                                        } else {
                                            debug(
                                                Component::RingBuffer,
                                                &format!(
                                                    "Emitted transcription chunk {}",
                                                    self.next_chunk_id
                                                ),
                                            );
                                        }
                                    }
                                } else {
                                    warn(
                                        Component::RingBuffer,
                                        &format!("Chunk {} was empty", self.next_chunk_id),
                                    );
                                }
                                self.last_chunk_time += self.chunk_duration;
                                self.next_chunk_id += 1;
                            }
                            Err(e) => {
                                error(
                                    Component::RingBuffer,
                                    &format!("Failed to process ring buffer chunk: {}", e),
                                );
                            }
                        }
                    }
                }
            }

            info(Component::RingBuffer, "Ring buffer monitor finished");
            self
        });

        (handle, stop_tx)
    }

    /// Signal that recording is complete and collect all results
    pub async fn recording_complete(mut self) -> Result<Vec<String>, String> {
        info(
            Component::RingBuffer,
            "Recording complete, collecting all chunks...",
        );
        info(
            Component::RingBuffer,
            &format!(
                "Already collected {} chunks during recording",
                self.completed_chunks.len()
            ),
        );

        // If no chunks were processed during recording (short recording), process the entire recording as one chunk
        if self.completed_chunks.is_empty() && self.chunked_transcriber.is_none() {
            let buffer_duration = self.ring_buffer.get_duration();
            if buffer_duration > Duration::from_millis(100) {
                // Process anything > 100ms
                info(
                    Component::RingBuffer,
                    &format!(
                        "Short recording detected ({:?}), processing as single chunk",
                        buffer_duration
                    ),
                );

                // Use the initial transcriber that was stored for short recordings
                if let Some(transcriber) = self.initial_transcriber.take() {
                    info(
                        Component::RingBuffer,
                        "Using stored transcriber for short recording",
                    );
                    self.chunked_transcriber = Some(transcriber);
                } else {
                    warn(
                        Component::RingBuffer,
                        "No initial transcriber available for short recording",
                    );
                    return Ok(vec![]);
                }
            } else {
                warn(
                    Component::RingBuffer,
                    "Recording too short to process (< 500ms)",
                );
                return Ok(vec![]);
            }
        }

        if let Some(chunked) = self.chunked_transcriber.take() {
            let buffer_duration = self.ring_buffer.get_duration();
            let remaining_duration = buffer_duration.saturating_sub(self.last_chunk_time);

            // Process any remaining audio as a final chunk
            if remaining_duration > Duration::from_millis(100) {
                // Process anything > 100ms
                info(
                    Component::RingBuffer,
                    &format!(
                        "Processing final ring buffer chunk (start: {:?}, duration: {:?})",
                        self.last_chunk_time, remaining_duration
                    ),
                );

                // Adjust duration to ensure it aligns with channel boundaries
                let sample_rate = 48000; // Default sample rate
                let channels = 1; // Mono
                let total_samples = (remaining_duration.as_secs_f32()
                    * sample_rate as f32
                    * channels as f32) as usize;
                let aligned_samples = (total_samples / channels) * channels;
                let aligned_duration = Duration::from_secs_f32(
                    aligned_samples as f32 / (sample_rate as f32 * channels as f32),
                );

                debug(
                    Component::RingBuffer,
                    &format!(
                        "Aligned final chunk duration from {:?} to {:?}",
                        remaining_duration, aligned_duration
                    ),
                );

                // Process final chunk synchronously
                match chunked
                    .process_chunk_sync(self.next_chunk_id, self.last_chunk_time, aligned_duration)
                    .await
                {
                    Ok(text) => {
                        if !text.is_empty() {
                            info(
                                Component::RingBuffer,
                                &format!(
                                    "Collected final chunk {}: \"{}\"",
                                    self.next_chunk_id, text
                                ),
                            );
                            self.completed_chunks.push(text);
                        }
                    }
                    Err(e) => {
                        error(
                            Component::RingBuffer,
                            &format!("Failed to process final ring buffer chunk: {}", e),
                        );
                    }
                }
            }

            // No need to wait for async results - we already have everything
            info(
                Component::RingBuffer,
                &format!("Total chunks collected: {}", self.completed_chunks.len()),
            );

            // Debug: Show all collected chunks
            for (i, chunk) in self.completed_chunks.iter().enumerate() {
                debug(Component::RingBuffer, &format!("Chunk {}: {}", i, chunk));
            }

            Ok(self.completed_chunks)
        } else {
            // Recording was too short for chunking, return any chunks we did collect
            if !self.completed_chunks.is_empty() {
                info(
                    Component::RingBuffer,
                    &format!(
                        "Returning {} chunks from short recording",
                        self.completed_chunks.len()
                    ),
                );
                Ok(self.completed_chunks)
            } else {
                warn(Component::RingBuffer, "No chunks were processed");
                Ok(vec![])
            }
        }
    }
}
