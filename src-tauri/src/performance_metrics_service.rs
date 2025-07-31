use crate::db::Database;
use crate::logger::{error, info, Component};
use std::sync::Arc;

/// Service for collecting and storing performance metrics
pub struct PerformanceMetricsService {
    database: Arc<Database>,
}

/// Comprehensive performance data collected during transcription
#[derive(Debug, Clone)]
pub struct TranscriptionPerformanceData {
    // Core timing metrics
    pub recording_duration_ms: i32,
    pub transcription_time_ms: i32,
    pub user_perceived_latency_ms: Option<i32>,
    pub processing_queue_time_ms: Option<i32>,

    // Model and strategy info
    pub model_used: String,
    pub transcription_strategy: String,

    // Audio properties
    pub audio_file_size_bytes: Option<i64>,
    pub audio_format: Option<String>,

    // Audio device and configuration
    pub audio_device_name: Option<String>,
    pub audio_sample_rate: Option<i32>,
    pub audio_channels: Option<i32>,
    pub audio_bit_depth: Option<i32>,
    pub audio_buffer_size: Option<String>,
    pub audio_input_gain: Option<f32>,
    pub requested_sample_rate: Option<i32>,
    pub requested_channels: Option<i32>,

    // Success/failure
    pub success: bool,
    pub error_message: Option<String>,

    // Strategy-specific metadata
    pub chunks_processed: Option<usize>,
    pub strategy_metadata: Option<serde_json::Value>,

    // Audio configuration metadata
    pub audio_metadata: Option<crate::audio::AudioMetadata>,
}

impl PerformanceMetricsService {
    pub fn new(database: Arc<Database>) -> Self {
        Self { database }
    }

    /// Save performance metrics for a completed transcription
    pub async fn save_transcription_metrics(
        &self,
        transcript_id: i64,
        performance_data: TranscriptionPerformanceData,
    ) -> Result<i64, String> {
        info(Component::Processing, &format!(
            "📊 Saving performance metrics: {}ms transcription for {}ms audio ({:.2}x speed) using {} strategy",
            performance_data.transcription_time_ms,
            performance_data.recording_duration_ms,
            performance_data.recording_duration_ms as f64 / performance_data.transcription_time_ms as f64,
            performance_data.transcription_strategy
        ));

        // Build metadata JSON with strategy-specific information
        let mut metadata = serde_json::json!({
            "transcription_strategy": performance_data.transcription_strategy,
        });

        if let Some(chunks) = performance_data.chunks_processed {
            metadata["chunks_processed"] = serde_json::Value::Number(chunks.into());
        }

        if let Some(strategy_meta) = performance_data.strategy_metadata {
            metadata["strategy_metadata"] = strategy_meta;
        }

        let metadata_str = metadata.to_string();

        // Extract audio metadata values if available
        if let Some(ref audio_meta) = performance_data.audio_metadata {
            metadata["audio_metadata"] = serde_json::json!({
                "device": audio_meta.device,
                "format": audio_meta.format,
                "recording": audio_meta.recording,
                "system": audio_meta.system,
                "mismatches": audio_meta.mismatches,
            });
        }

        // Save to database with audio details
        let metrics_id = match self
            .database
            .save_performance_metrics_with_audio_details(
                Some(transcript_id),
                performance_data.recording_duration_ms,
                performance_data.transcription_time_ms,
                performance_data.user_perceived_latency_ms,
                performance_data.processing_queue_time_ms,
                Some(&performance_data.model_used),
                Some(&performance_data.transcription_strategy),
                performance_data.audio_file_size_bytes,
                performance_data.audio_format.as_deref(),
                performance_data.audio_device_name.as_deref(),
                performance_data.audio_sample_rate,
                performance_data.audio_channels,
                performance_data.audio_bit_depth,
                performance_data.audio_buffer_size.as_deref(),
                performance_data.audio_input_gain,
                performance_data.requested_sample_rate,
                performance_data.requested_channels,
                performance_data.success,
                performance_data.error_message.as_deref(),
                Some(&metadata_str),
            )
            .await
        {
            Ok(metrics_id) => {
                info(
                    Component::Processing,
                    &format!(
                        "✅ Performance metrics saved successfully (ID: {})",
                        metrics_id
                    ),
                );
                metrics_id
            }
            Err(e) => {
                error(
                    Component::Processing,
                    &format!("❌ Failed to save performance metrics: {}", e),
                );
                return Err(e);
            }
        };

        // Audio metadata is already saved in the performance_metrics table
        // No need for separate mismatch tracking

        Ok(metrics_id)
    }

    /// Log performance warnings and recommendations
    pub fn log_performance_analysis(&self, performance_data: &TranscriptionPerformanceData) {
        let speed_ratio = performance_data.recording_duration_ms as f64
            / performance_data.transcription_time_ms as f64;

        if speed_ratio < 1.0 {
            error(Component::Processing, &format!(
                "⚠️ SLOW TRANSCRIPTION: {:.2}x speed (slower than real-time) - consider switching to a smaller model",
                speed_ratio
            ));
        } else if speed_ratio > 10.0 {
            info(
                Component::Processing,
                &format!(
                    "🚀 VERY FAST TRANSCRIPTION: {:.2}x speed - excellent performance!",
                    speed_ratio
                ),
            );
        } else if speed_ratio > 5.0 {
            info(
                Component::Processing,
                &format!(
                    "⚡ FAST TRANSCRIPTION: {:.2}x speed - good performance",
                    speed_ratio
                ),
            );
        }

        // Strategy-specific recommendations
        match performance_data.transcription_strategy.as_str() {
            "ring_buffer" => {
                if performance_data.recording_duration_ms < 5000 {
                    info(
                        Component::Processing,
                        "💡 SUGGESTION: Short recording - classic strategy might be more efficient",
                    );
                }
                if let Some(chunks) = performance_data.chunks_processed {
                    info(
                        Component::Processing,
                        &format!(
                            "📊 Ring buffer processed {} chunks (avg {:.1}ms per chunk)",
                            chunks,
                            performance_data.transcription_time_ms as f64 / chunks as f64
                        ),
                    );
                }
            }
            "processing_queue" | "classic" => {
                if performance_data.recording_duration_ms > 30000 {
                    info(Component::Processing,
                        "💡 SUGGESTION: Long recording - ring buffer strategy might provide better user experience");
                }
            }
            _ => {}
        }

        // Memory/performance warnings
        if let Some(file_size) = performance_data.audio_file_size_bytes {
            let file_size_mb = file_size as f64 / 1_048_576.0;
            if file_size_mb > 50.0 {
                error(
                    Component::Processing,
                    &format!(
                        "⚠️ LARGE AUDIO FILE: {:.1}MB - may impact performance",
                        file_size_mb
                    ),
                );
            }
        }
    }
}

/// Builder for TranscriptionPerformanceData
pub struct PerformanceDataBuilder {
    data: TranscriptionPerformanceData,
}

impl PerformanceDataBuilder {
    pub fn new(
        recording_duration_ms: i32,
        transcription_time_ms: i32,
        model_used: String,
        transcription_strategy: String,
    ) -> Self {
        Self {
            data: TranscriptionPerformanceData {
                recording_duration_ms,
                transcription_time_ms,
                model_used,
                transcription_strategy,
                user_perceived_latency_ms: None,
                processing_queue_time_ms: None,
                audio_file_size_bytes: None,
                audio_format: None,
                audio_device_name: None,
                audio_sample_rate: None,
                audio_channels: None,
                audio_bit_depth: None,
                audio_buffer_size: None,
                audio_input_gain: None,
                requested_sample_rate: None,
                requested_channels: None,
                success: true,
                error_message: None,
                chunks_processed: None,
                strategy_metadata: None,
                audio_metadata: None,
            },
        }
    }

    pub fn with_user_latency(mut self, latency_ms: i32) -> Self {
        self.data.user_perceived_latency_ms = Some(latency_ms);
        self
    }

    pub fn with_queue_time(mut self, queue_time_ms: i32) -> Self {
        self.data.processing_queue_time_ms = Some(queue_time_ms);
        self
    }

    pub fn with_audio_info(mut self, file_size_bytes: Option<i64>, format: Option<String>) -> Self {
        self.data.audio_file_size_bytes = file_size_bytes;
        self.data.audio_format = format;
        self
    }

    pub fn with_chunks(mut self, chunks_processed: usize) -> Self {
        self.data.chunks_processed = Some(chunks_processed);
        self
    }

    pub fn with_strategy_metadata(mut self, metadata: serde_json::Value) -> Self {
        self.data.strategy_metadata = Some(metadata);
        self
    }

    pub fn with_error(mut self, error_message: String) -> Self {
        self.data.success = false;
        self.data.error_message = Some(error_message);
        self
    }

    pub fn with_audio_metadata(mut self, metadata: crate::audio::AudioMetadata) -> Self {
        // Extract values from metadata for individual fields
        self.data.audio_device_name = Some(metadata.device.name.clone());
        self.data.audio_sample_rate = Some(metadata.format.sample_rate as i32);
        self.data.audio_channels = Some(metadata.format.channels as i32);
        self.data.audio_bit_depth = Some(metadata.format.bit_depth as i32);
        self.data.audio_buffer_size =
            Some(serde_json::to_string(&metadata.format.buffer_config).unwrap_or_default());
        self.data.audio_input_gain = metadata.recording.input_gain;
        self.data.requested_sample_rate = metadata.format.requested_sample_rate.map(|r| r as i32);
        self.data.requested_channels = metadata.format.requested_channels.map(|c| c as i32);

        // Store full metadata object
        self.data.audio_metadata = Some(metadata);
        self
    }

    pub fn with_device_info(mut self, device_info: &crate::audio::recorder::DeviceInfo) -> Self {
        if let Some(metadata) = &device_info.metadata {
            self = self.with_audio_metadata(metadata.clone());
        } else {
            // Set basic device info even without full metadata
            self.data.audio_device_name = Some(device_info.name.clone());
            self.data.audio_sample_rate = Some(device_info.sample_rate as i32);
            self.data.audio_channels = Some(device_info.channels as i32);
        }
        self
    }

    pub fn build(self) -> TranscriptionPerformanceData {
        self.data
    }
}
