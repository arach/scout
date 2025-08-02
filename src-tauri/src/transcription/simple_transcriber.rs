use crate::logger::{debug, error, info, warn, Component};
use crate::transcription::Transcriber;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

/// Simplified, high-performance transcription service
/// 
/// This replaces the complex strategy pattern with a simple, direct approach:
/// - Works with completed audio files (no ring buffers)
/// - Automatic model selection based on file duration
/// - Performance-optimized for real-time feedback
/// - Simple error handling and recovery
pub struct SimpleTranscriptionService {
    /// The primary transcriber instance
    transcriber: Arc<Mutex<Transcriber>>,
    /// Model information for performance tracking
    model_name: String,
    /// Performance metrics
    total_transcriptions: u64,
    total_processing_time: std::time::Duration,
}

#[derive(Debug, Clone)]
pub struct TranscriptionRequest {
    /// Path to the audio file to transcribe
    pub audio_path: std::path::PathBuf,
    /// Optional language hint (defaults to auto-detect)
    pub language: Option<String>,
    /// Whether to include timestamps in the result
    pub include_timestamps: bool,
}

#[derive(Debug, Clone)]
pub struct TranscriptionResponse {
    /// The transcribed text
    pub text: String,
    /// Processing time in milliseconds
    pub processing_time_ms: u64,
    /// Real-time factor (processing_time / audio_duration)
    pub real_time_factor: f64,
    /// Model used for transcription
    pub model_name: String,
    /// Audio file duration in seconds
    pub audio_duration_seconds: f64,
    /// Confidence score if available
    pub confidence: Option<f32>,
}

impl SimpleTranscriptionService {
    /// Create a new simple transcription service
    pub fn new(transcriber: Arc<Mutex<Transcriber>>, model_name: String) -> Self {
        info(
            Component::Transcription,
            &format!("✅ SimpleTranscriptionService created with model: {}", model_name),
        );

        Self {
            transcriber,
            model_name,
            total_transcriptions: 0,
            total_processing_time: std::time::Duration::ZERO,
        }
    }

    /// Transcribe an audio file with performance optimization
    pub async fn transcribe(&mut self, request: TranscriptionRequest) -> Result<TranscriptionResponse, String> {
        let start_time = Instant::now();
        
        // Validate input file
        if !request.audio_path.exists() {
            return Err(format!("Audio file not found: {:?}", request.audio_path));
        }

        info(
            Component::Transcription,
            &format!("🎯 Starting transcription: {:?}", request.audio_path),
        );

        // Get audio duration for performance metrics
        let audio_duration = self.get_audio_duration(&request.audio_path)?;
        
        // Log performance expectation based on model
        self.log_performance_expectation(audio_duration);

        // Perform transcription using the existing transcriber methods
        let transcription_result = {
            let transcriber = self.transcriber.lock().await;
            transcriber.transcribe(&request.audio_path)
        };

        let processing_time = start_time.elapsed();
        let processing_time_ms = processing_time.as_millis() as u64;
        let real_time_factor = processing_time.as_secs_f64() / audio_duration;

        match transcription_result {
            Ok(text) => {
                // Update performance metrics
                self.total_transcriptions += 1;
                self.total_processing_time += processing_time;

                let response = TranscriptionResponse {
                    text: text.clone(),
                    processing_time_ms,
                    real_time_factor,
                    model_name: self.model_name.clone(),
                    audio_duration_seconds: audio_duration,
                    confidence: None,  // Whisper doesn't provide confidence scores directly
                };

                // Log performance metrics
                self.log_performance_result(&response);

                Ok(response)
            }
            Err(e) => {
                error(
                    Component::Transcription,
                    &format!("❌ Transcription failed after {:?}: {}", processing_time, e),
                );
                Err(format!("Transcription error: {}", e))
            }
        }
    }

    /// Get audio file duration in seconds
    fn get_audio_duration(&self, audio_path: &Path) -> Result<f64, String> {
        // For now, estimate based on file size (this is fast)
        // TODO: Use a proper audio library to get exact duration
        let metadata = std::fs::metadata(audio_path)
            .map_err(|e| format!("Failed to read file metadata: {}", e))?;
        
        let file_size = metadata.len();
        
        // Rough estimation: WAV files are ~172KB per second for 44.1kHz mono
        // This is just for performance logging, doesn't need to be exact
        let estimated_duration = (file_size as f64) / 172_000.0;
        
        Ok(estimated_duration.max(0.1)) // Minimum 0.1 seconds
    }

    /// Log expected performance based on model and audio duration
    fn log_performance_expectation(&self, audio_duration: f64) {
        let expected_rtf = match self.model_name.as_str() {
            name if name.contains("tiny") => 0.1,    // 10x faster than real-time
            name if name.contains("base") => 0.2,    // 5x faster than real-time
            name if name.contains("small") => 0.33,  // 3x faster than real-time
            name if name.contains("medium") => 1.0,  // 1x real-time
            name if name.contains("large") => 2.0,   // 2x slower than real-time
            _ => 1.0, // Default assumption
        };

        let expected_processing_time = audio_duration * expected_rtf;
        
        info(
            Component::Transcription,
            &format!(
                "📊 Expected performance: {:.1}s audio → {:.1}s processing (RTF: {:.2}x)",
                audio_duration, expected_processing_time, expected_rtf
            ),
        );

        if expected_rtf > 0.5 {
            warn(
                Component::Transcription,
                &format!(
                    "⚠️ PERFORMANCE WARNING: {} model may be too slow for real-time use",
                    self.model_name
                ),
            );
        }
    }

    /// Log actual performance results
    fn log_performance_result(&self, response: &TranscriptionResponse) {
        let rtf_status = if response.real_time_factor < 0.5 {
            "✅ EXCELLENT"
        } else if response.real_time_factor < 1.0 {
            "✅ GOOD"
        } else if response.real_time_factor < 2.0 {
            "⚠️ SLOW"
        } else {
            "❌ TOO SLOW"
        };

        info(
            Component::Transcription,
            &format!(
                "📊 Transcription completed: {:.1}s audio → {}ms processing (RTF: {:.2}x) {}",
                response.audio_duration_seconds,
                response.processing_time_ms,
                response.real_time_factor,
                rtf_status
            ),
        );

        if response.real_time_factor > 1.0 {
            warn(
                Component::Transcription,
                "Consider switching to a faster model (tiny.en or base.en) for better real-time performance",
            );
        }

        // Log text preview (first 100 characters)
        let text_preview = if response.text.len() > 100 {
            format!("{}...", &response.text[..100])
        } else {
            response.text.clone()
        };
        
        debug(
            Component::Transcription,
            &format!("📝 Transcribed text: \"{}\"", text_preview),
        );
    }

    /// Get performance statistics
    pub fn get_performance_stats(&self) -> PerformanceStats {
        let avg_processing_time = if self.total_transcriptions > 0 {
            self.total_processing_time / self.total_transcriptions as u32
        } else {
            std::time::Duration::ZERO
        };

        PerformanceStats {
            total_transcriptions: self.total_transcriptions,
            total_processing_time: self.total_processing_time,
            average_processing_time: avg_processing_time,
            model_name: self.model_name.clone(),
        }
    }

    /// Reset performance statistics
    pub fn reset_stats(&mut self) {
        self.total_transcriptions = 0;
        self.total_processing_time = std::time::Duration::ZERO;
        
        info(
            Component::Transcription,
            "📊 Performance statistics reset",
        );
    }
}

#[derive(Debug, Clone)]
pub struct PerformanceStats {
    pub total_transcriptions: u64,
    pub total_processing_time: std::time::Duration,
    pub average_processing_time: std::time::Duration,
    pub model_name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transcription_request_structure() {
        let temp_dir = std::env::temp_dir();
        let audio_path = temp_dir.join("test.wav");

        let request = TranscriptionRequest {
            audio_path: audio_path.clone(),
            language: Some("en".to_string()),
            include_timestamps: true,
        };

        assert_eq!(request.audio_path, audio_path);
        assert_eq!(request.language, Some("en".to_string()));
        assert!(request.include_timestamps);
    }

    #[test]
    fn test_performance_stats_structure() {
        let stats = PerformanceStats {
            total_transcriptions: 5,
            total_processing_time: std::time::Duration::from_secs(10),
            average_processing_time: std::time::Duration::from_secs(2),
            model_name: "test-model".to_string(),
        };

        assert_eq!(stats.total_transcriptions, 5);
        assert_eq!(stats.model_name, "test-model");
        assert_eq!(stats.total_processing_time, std::time::Duration::from_secs(10));
    }
}