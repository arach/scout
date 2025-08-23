use crate::db::Database;
use crate::logger::{info, warn, Component};
use crate::transcription::TranscriptionResult;
use std::sync::Arc;
use std::time::Duration;

/// Comprehensive performance logging for transcription strategies
pub struct PerformanceLogger {
    database: Arc<Database>,
}

impl PerformanceLogger {
    pub fn new(database: Arc<Database>) -> Self {
        Self { database }
    }

    /// Log detailed performance metrics for a completed transcription
    pub async fn log_transcription_performance(
        &self,
        transcript_id: Option<i64>,
        recording_duration: Duration,
        transcription_result: &TranscriptionResult,
        audio_file_size: Option<i64>,
        audio_format: Option<&str>,
        user_perceived_latency: Option<Duration>,
        processing_queue_time: Option<Duration>,
        model_used: Option<&str>,
    ) -> Result<(), String> {
        let recording_duration_ms = recording_duration.as_millis() as i32;
        let transcription_time_ms = transcription_result.processing_time_ms as i32;
        let user_perceived_latency_ms = user_perceived_latency.map(|d| d.as_millis() as i32);
        let processing_queue_time_ms = processing_queue_time.map(|d| d.as_millis() as i32);

        // Create comprehensive performance metadata
        let performance_metadata = serde_json::json!({
            "chunks_processed": transcription_result.chunks_processed,
            "text_length": transcription_result.text.len(),
            "strategy_details": {
                "name": transcription_result.strategy_used,
                "chunks": transcription_result.chunks_processed,
                "average_chunk_time_ms": if transcription_result.chunks_processed > 0 {
                    Some(transcription_result.processing_time_ms / transcription_result.chunks_processed as u64)
                } else {
                    None
                }
            }
        });

        // Log comprehensive performance information
        info(
            Component::Transcription,
            "=== TRANSCRIPTION PERFORMANCE METRICS ===",
        );
        info(
            Component::Transcription,
            &format!(
                "Recording Duration: {:.2}s",
                recording_duration.as_secs_f64()
            ),
        );
        info(
            Component::Transcription,
            &format!(
                "Transcription Time: {:.2}s",
                transcription_result.processing_time_ms as f64 / 1000.0
            ),
        );
        info(
            Component::Transcription,
            &format!("Strategy Used: {}", transcription_result.strategy_used),
        );
        info(
            Component::Transcription,
            &format!(
                "Chunks Processed: {}",
                transcription_result.chunks_processed
            ),
        );
        info(
            Component::Transcription,
            &format!(
                "Text Length: {} characters",
                transcription_result.text.len()
            ),
        );

        // Calculate performance ratios
        let transcription_ratio =
            transcription_result.processing_time_ms as f64 / recording_duration.as_millis() as f64;
        info(
            Component::Transcription,
            &format!(
                "Transcription Ratio: {:.3}x (lower is better)",
                transcription_ratio
            ),
        );

        if transcription_ratio < 1.0 {
            info(
                Component::Transcription,
                &format!(
                    "FASTER THAN REAL-TIME: {:.1}% of recording time",
                    transcription_ratio * 100.0
                ),
            );
        } else {
            warn(
                Component::Transcription,
                &format!(
                    "SLOWER THAN REAL-TIME: {:.1}x recording time",
                    transcription_ratio
                ),
            );
        }

        // User-perceived latency
        if let Some(latency) = user_perceived_latency {
            info(
                Component::Transcription,
                &format!("User Perceived Latency: {:.2}s", latency.as_secs_f64()),
            );
            if latency.as_millis() < 300 {
                info(Component::Transcription, "EXCELLENT: Under 300ms target");
            } else if latency.as_millis() < 1000 {
                info(Component::Transcription, "GOOD: Under 1s");
            } else {
                warn(Component::Transcription, "SLOW: Over 1s latency");
            }
        }

        // Strategy-specific insights
        match transcription_result.strategy_used.as_str() {
            "classic" => {
                info(
                    Component::Transcription,
                    "Classic Strategy: Single-pass transcription",
                );
                if recording_duration.as_secs() > 10 {
                    info(Component::Transcription, "SUGGESTION: Long recording detected - ring buffer strategy might be faster");
                }
            }
            "ring_buffer" => {
                info(
                    Component::Transcription,
                    "Ring Buffer Strategy: Chunked transcription",
                );
                if transcription_result.chunks_processed > 1 {
                    let avg_chunk_time = transcription_result.processing_time_ms
                        / transcription_result.chunks_processed as u64;
                    info(
                        Component::Transcription,
                        &format!("Average Chunk Time: {:.2}s", avg_chunk_time as f64 / 1000.0),
                    );
                }
                if recording_duration.as_secs() <= 10 {
                    info(
                        Component::Transcription,
                        "SUGGESTION: Short recording - classic strategy might be more efficient",
                    );
                }
            }
            strategy => {
                info(Component::Transcription, &format!("Strategy: {}", strategy));
            }
        }

        // File size efficiency (if available)
        if let Some(file_size) = audio_file_size {
            let mb_size = file_size as f64 / (1024.0 * 1024.0);
            let transcription_speed_mbps =
                mb_size / (transcription_result.processing_time_ms as f64 / 1000.0);
            info(
                Component::Transcription,
                &format!("File Size: {:.2} MB", mb_size),
            );
            info(
                Component::Transcription,
                &format!("Processing Speed: {:.2} MB/s", transcription_speed_mbps),
            );
        }

        info(
            Component::Transcription,
            "================================================",
        );

        // Save to database
        self.database
            .save_performance_metrics(
                transcript_id,
                recording_duration_ms,
                transcription_time_ms,
                user_perceived_latency_ms,
                processing_queue_time_ms,
                model_used,
                Some(&transcription_result.strategy_used),
                audio_file_size,
                audio_format,
                true,
                None,
                Some(&performance_metadata.to_string()),
            )
            .await?;

        Ok(())
    }

    /// Log a simple performance comparison between strategies
    pub fn log_strategy_comparison(
        recording_duration: Duration,
        classic_time: Option<Duration>,
        ring_buffer_time: Option<Duration>,
    ) {
        info(
            Component::Transcription,
            "=== STRATEGY PERFORMANCE COMPARISON ===",
        );
        info(
            Component::Transcription,
            &format!("Recording: {:.2}s", recording_duration.as_secs_f64()),
        );

        if let Some(classic) = classic_time {
            info(
                Component::Transcription,
                &format!("Classic Strategy: {:.2}s", classic.as_secs_f64()),
            );
        }

        if let Some(ring_buffer) = ring_buffer_time {
            info(
                Component::Transcription,
                &format!("Ring Buffer Strategy: {:.2}s", ring_buffer.as_secs_f64()),
            );
        }

        if let (Some(classic), Some(ring_buffer)) = (classic_time, ring_buffer_time) {
            let _improvement = if ring_buffer < classic {
                let speedup = classic.as_secs_f64() / ring_buffer.as_secs_f64();
                info(
                    Component::Transcription,
                    &format!("Ring Buffer is {:.2}x FASTER", speedup),
                );
            } else {
                let slowdown = ring_buffer.as_secs_f64() / classic.as_secs_f64();
                warn(
                    Component::Transcription,
                    &format!("Classic is {:.2}x faster", slowdown),
                );
            };
        }

        info(
            Component::Transcription,
            "=============================================",
        );
    }

    /// Log real-time performance during chunked transcription
    pub fn log_chunk_progress(
        chunk_id: usize,
        chunk_duration: Duration,
        processing_time: Duration,
        current_text: &str,
    ) {
        let efficiency = chunk_duration.as_secs_f64() / processing_time.as_secs_f64();

        info(Component::RingBuffer, &format!("Chunk {} | Duration: {:.1}s | Processed: {:.2}s | Efficiency: {:.2}x | Text: \"{}...\"",
                 chunk_id,
                 chunk_duration.as_secs_f64(),
                 processing_time.as_secs_f64(),
                 efficiency,
                 current_text.chars().take(50).collect::<String>()
        ));
    }
}

/// Helper function for performance-friendly duration formatting
pub fn format_duration(duration: Duration) -> String {
    let total_secs = duration.as_secs();
    let minutes = total_secs / 60;
    let seconds = total_secs % 60;
    let millis = duration.subsec_millis();

    if minutes > 0 {
        format!("{}m {}.{:03}s", minutes, seconds, millis)
    } else {
        format!("{}.{:03}s", seconds, millis)
    }
}
