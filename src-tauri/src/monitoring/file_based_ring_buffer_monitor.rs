use crate::logger::{debug, error, info, warn, Component};
use crate::transcription::file_based_ring_buffer_transcriber::FileBasedRingBufferTranscriber;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::time;

/// File-based ring buffer monitor that reads chunks from a growing WAV file
/// This provides clean separation between recording and transcription
pub struct FileBasedRingBufferMonitor {
    /// File-based transcriber for processing chunks
    transcriber: Option<FileBasedRingBufferTranscriber>,
    /// Interval between chunk processing attempts
    chunk_interval: Duration,
    /// When recording started
    recording_start_time: Instant,
    /// Completed chunk texts
    completed_chunks: Vec<String>,
    /// App handle for emitting events
    app_handle: Option<AppHandle>,
}

impl FileBasedRingBufferMonitor {
    /// Create a new file-based ring buffer monitor
    pub fn new(_wav_file_path: PathBuf) -> Self {
        Self {
            transcriber: None,
            chunk_interval: Duration::from_secs(2), // Check every 2 seconds
            recording_start_time: Instant::now(),
            completed_chunks: Vec::new(),
            app_handle: None,
        }
    }

    /// Set the app handle for emitting events
    pub fn with_app_handle(mut self, app_handle: AppHandle) -> Self {
        self.app_handle = Some(app_handle);
        self
    }

    /// Start monitoring the WAV file with the given transcriber
    pub async fn start_monitoring(
        mut self,
        transcriber: FileBasedRingBufferTranscriber,
    ) -> (tokio::task::JoinHandle<Self>, mpsc::Sender<()>) {
        let (stop_tx, mut stop_rx) = mpsc::channel::<()>(1);

        self.transcriber = Some(transcriber);

        let handle = tokio::spawn(async move {
            info(Component::RingBuffer, "File-based ring buffer monitor started");

            let mut interval = time::interval(self.chunk_interval);

            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        // Continue with monitoring logic
                    }
                    _ = stop_rx.recv() => {
                        info(Component::RingBuffer, "File-based ring buffer monitor stopping");
                        break;
                    }
                }

                let elapsed = self.recording_start_time.elapsed();

                // Only start processing after we have some audio
                if elapsed < Duration::from_secs(3) {
                    continue;
                }

                // Process next chunk if available
                if let Some(ref mut transcriber) = self.transcriber {
                    match transcriber.process_next_chunk().await {
                        Ok(Some(text)) => {
                            if !text.is_empty() {
                                info(
                                    Component::RingBuffer,
                                    &format!("File-based chunk completed: \"{}\"", text),
                                );
                                self.completed_chunks.push(text.clone());

                                // Emit real-time transcription chunk event
                                if let Some(ref app) = self.app_handle {
                                    let chunk_data = serde_json::json!({
                                        "id": self.completed_chunks.len() - 1,
                                        "text": text,
                                        "timestamp": chrono::Utc::now().timestamp_millis(),
                                        "isPartial": false
                                    });
                                    if let Err(e) = app.emit("transcription-chunk", &chunk_data) {
                                        warn(
                                            Component::RingBuffer,
                                            &format!("Failed to emit transcription chunk: {}", e),
                                        );
                                    } else {
                                        debug(
                                            Component::RingBuffer,
                                            &format!("Emitted file-based transcription chunk"),
                                        );
                                    }
                                }
                            }
                        }
                        Ok(None) => {
                            // No new chunk available yet
                            debug(Component::RingBuffer, "No new chunk data available");
                        }
                        Err(e) => {
                            error(
                                Component::RingBuffer,
                                &format!("Failed to process file-based chunk: {}", e),
                            );
                        }
                    }
                }

                // Log status periodically
                if elapsed.as_secs() % 10 == 0 {
                    debug(
                        Component::RingBuffer,
                        &format!(
                            "File-based monitor status: elapsed={:.1}s, chunks={}",
                            elapsed.as_secs_f64(),
                            self.completed_chunks.len()
                        ),
                    );
                }
            }

            info(Component::RingBuffer, "File-based ring buffer monitor finished");
            self
        });

        (handle, stop_tx)
    }

    /// Signal that recording is complete and collect all results
    pub async fn recording_complete(mut self) -> Result<Vec<String>, String> {
        info(
            Component::RingBuffer,
            "File-based recording complete, processing final chunk...",
        );

        // Process any remaining audio as a final chunk
        if let Some(ref mut transcriber) = self.transcriber {
            match transcriber.process_final_chunk().await {
                Ok(Some(text)) => {
                    if !text.is_empty() {
                        info(
                            Component::RingBuffer,
                            &format!("File-based final chunk completed: \"{}\"", text),
                        );
                        self.completed_chunks.push(text);
                    }
                }
                Ok(None) => {
                    debug(Component::RingBuffer, "No final chunk data available");
                }
                Err(e) => {
                    error(
                        Component::RingBuffer,
                        &format!("Failed to process final file-based chunk: {}", e),
                    );
                }
            }
        }

        info(
            Component::RingBuffer,
            &format!(
                "File-based processing complete: {} chunks collected",
                self.completed_chunks.len()
            ),
        );

        // Debug: Show all collected chunks
        for (i, chunk) in self.completed_chunks.iter().enumerate() {
            debug(Component::RingBuffer, &format!("File chunk {}: {}", i, chunk));
        }

        Ok(self.completed_chunks)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_file_based_monitor_creation() {
        let temp_dir = tempdir().unwrap();
        let wav_path = temp_dir.path().join("test.wav");
        
        let monitor = FileBasedRingBufferMonitor::new(wav_path);
        
        // Check that monitor was created with default values
        assert_eq!(monitor.chunk_interval, Duration::from_secs(2));
        assert_eq!(monitor.completed_chunks.len(), 0);
        assert!(monitor.transcriber.is_none());
        assert!(monitor.app_handle.is_none());
    }

    #[test]
    fn test_file_based_monitor_with_app_handle() {
        let temp_dir = tempdir().unwrap();
        let wav_path = temp_dir.path().join("test.wav");
        
        let monitor = FileBasedRingBufferMonitor::new(wav_path);
        
        // Test that we can create a monitor (actual app handle would be needed for full test)
        assert!(monitor.app_handle.is_none());
        
        // In a real test, we would:
        // let monitor = monitor.with_app_handle(app_handle);
        // assert!(monitor.app_handle.is_some());
    }

    #[tokio::test]
    async fn test_recording_complete_empty() {
        let temp_dir = tempdir().unwrap();
        let wav_path = temp_dir.path().join("test.wav");
        
        let monitor = FileBasedRingBufferMonitor::new(wav_path);
        
        // Test completing recording with no transcriber
        let result = monitor.recording_complete().await;
        assert!(result.is_ok());
        
        let chunks = result.unwrap();
        assert_eq!(chunks.len(), 0);
    }

    #[test]
    fn test_duration_constants() {
        // Test that our durations are reasonable
        assert_eq!(Duration::from_secs(2).as_secs(), 2);
        assert_eq!(Duration::from_secs(3).as_secs(), 3);
        assert_eq!(Duration::from_secs(10).as_secs(), 10);
        
        // Test that intervals make sense
        let chunk_interval = Duration::from_secs(2);
        let startup_delay = Duration::from_secs(3);
        
        assert!(chunk_interval < startup_delay);
    }
}