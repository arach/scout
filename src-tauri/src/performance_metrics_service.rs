use std::sync::Arc;
use serde_json;
use crate::db::Database;
use crate::logger::{info, error, Component};

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
    
    // Success/failure
    pub success: bool,
    pub error_message: Option<String>,
    
    // Strategy-specific metadata
    pub chunks_processed: Option<usize>,
    pub strategy_metadata: Option<serde_json::Value>,
}

impl PerformanceMetricsService {
    pub fn new(database: Arc<Database>) -> Self {
        Self { database }
    }
    
    /// Save performance metrics for a completed transcription
    pub async fn save_transcription_metrics(
        &self, 
        transcript_id: i64, 
        performance_data: TranscriptionPerformanceData
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
        
        // Save to database
        match self.database.save_performance_metrics(
            Some(transcript_id),
            performance_data.recording_duration_ms,
            performance_data.transcription_time_ms,
            performance_data.user_perceived_latency_ms,
            performance_data.processing_queue_time_ms,
            Some(&performance_data.model_used),
            Some(&performance_data.transcription_strategy),
            performance_data.audio_file_size_bytes,
            performance_data.audio_format.as_deref(),
            performance_data.success,
            performance_data.error_message.as_deref(),
            Some(&metadata_str),
        ).await {
            Ok(metrics_id) => {
                info(Component::Processing, &format!(
                    "✅ Performance metrics saved successfully (ID: {})", metrics_id
                ));
                Ok(metrics_id)
            }
            Err(e) => {
                error(Component::Processing, &format!(
                    "❌ Failed to save performance metrics: {}", e
                ));
                Err(e)
            }
        }
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
            info(Component::Processing, &format!(
                "🚀 VERY FAST TRANSCRIPTION: {:.2}x speed - excellent performance!",
                speed_ratio
            ));
        } else if speed_ratio > 5.0 {
            info(Component::Processing, &format!(
                "⚡ FAST TRANSCRIPTION: {:.2}x speed - good performance",
                speed_ratio
            ));
        }
        
        // Strategy-specific recommendations
        match performance_data.transcription_strategy.as_str() {
            "ring_buffer" => {
                if performance_data.recording_duration_ms < 5000 {
                    info(Component::Processing, 
                        "💡 SUGGESTION: Short recording - classic strategy might be more efficient");
                }
                if let Some(chunks) = performance_data.chunks_processed {
                    info(Component::Processing, &format!(
                        "📊 Ring buffer processed {} chunks (avg {:.1}ms per chunk)",
                        chunks,
                        performance_data.transcription_time_ms as f64 / chunks as f64
                    ));
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
                error(Component::Processing, &format!(
                    "⚠️ LARGE AUDIO FILE: {:.1}MB - may impact performance", file_size_mb
                ));
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
                success: true,
                error_message: None,
                chunks_processed: None,
                strategy_metadata: None,
            }
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
    
    pub fn build(self) -> TranscriptionPerformanceData {
        self.data
    }
}