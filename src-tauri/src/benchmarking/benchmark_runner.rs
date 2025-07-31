use crate::logger::{error, info, Component};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkTest {
    pub name: String,
    pub audio_file: PathBuf,
    pub expected_transcript: Option<String>,
    pub duration_ms: u32,
    pub content_type: ContentType,
    pub recording_length_category: RecordingLength,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ContentType {
    Technical,
    Conversational,
    Formal,
    Numbers,
    Mixed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RecordingLength {
    UltraShort, // 0.5-2s
    Short,      // 2-5s
    Medium,     // 5-15s
    Long,       // 15-60s
    Extended,   // 60s+
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkResult {
    pub test_name: String,
    pub strategy_used: String,
    pub chunk_size_ms: Option<u32>,
    pub timing_metrics: TimingMetrics,
    pub accuracy_metrics: AccuracyMetrics,
    pub success: bool,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimingMetrics {
    pub time_to_first_result_ms: u32,
    pub total_transcription_time_ms: u32,
    pub perceived_latency_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccuracyMetrics {
    pub transcribed_text: String,
    pub word_count: u32,
    pub character_count: u32,
    pub confidence_score: f32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BenchmarkReport {
    pub test_results: Vec<BenchmarkResult>,
    pub summary: BenchmarkSummary,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BenchmarkSummary {
    pub total_tests: usize,
    pub successful_tests: usize,
    pub failed_tests: usize,
    pub avg_time_to_first_result: f32,
    pub avg_total_time: f32,
    pub strategies_tested: Vec<String>,
}

pub struct BenchmarkRunner {
    pub output_dir: PathBuf,
}

impl BenchmarkRunner {
    pub fn new(output_dir: PathBuf) -> Self {
        Self { output_dir }
    }

    pub async fn run_benchmark_suite(
        &self,
        tests: Vec<BenchmarkTest>,
    ) -> Result<BenchmarkReport, String> {
        info(
            Component::Processing,
            &format!("🚀 Starting benchmark suite with {} tests", tests.len()),
        );

        let mut results = Vec::new();
        let start_time = Instant::now();

        for test in tests {
            info(
                Component::Processing,
                &format!("📊 Running test: {}", test.name),
            );

            match self.run_single_test(&test).await {
                Ok(result) => {
                    info(
                        Component::Processing,
                        &format!("✅ Test '{}' completed successfully", test.name),
                    );
                    results.push(result);
                }
                Err(e) => {
                    error(
                        Component::Processing,
                        &format!("❌ Test '{}' failed: {}", test.name, e),
                    );
                    results.push(BenchmarkResult {
                        test_name: test.name.clone(),
                        strategy_used: "unknown".to_string(),
                        chunk_size_ms: None,
                        timing_metrics: TimingMetrics {
                            time_to_first_result_ms: 0,
                            total_transcription_time_ms: 0,
                            perceived_latency_ms: 0,
                        },
                        accuracy_metrics: AccuracyMetrics {
                            transcribed_text: "".to_string(),
                            word_count: 0,
                            character_count: 0,
                            confidence_score: 0.0,
                        },
                        success: false,
                        error_message: Some(e),
                    });
                }
            }
        }

        let total_duration = start_time.elapsed();
        info(
            Component::Processing,
            &format!("🏁 Benchmark suite completed in {:?}", total_duration),
        );

        let summary = self.generate_summary(&results);
        let report = BenchmarkReport {
            test_results: results,
            summary,
            created_at: chrono::Utc::now().to_rfc3339(),
        };

        // Save report
        self.save_report(&report).await?;

        Ok(report)
    }

    async fn run_single_test(&self, test: &BenchmarkTest) -> Result<BenchmarkResult, String> {
        let start_time = Instant::now();

        // Read audio file
        let audio_data = fs::read(&test.audio_file)
            .await
            .map_err(|e| format!("Failed to read audio file: {}", e))?;

        info(
            Component::Processing,
            &format!("📁 Audio file loaded: {} bytes", audio_data.len()),
        );

        // For now, we'll run a simple processing queue strategy
        // TODO: Implement different strategies (ring buffer, progressive, etc.)
        let strategy_used = "processing_queue".to_string();

        // Simulate transcription (replace with actual transcription call)
        let transcription_start = Instant::now();
        let transcribed_text = self
            .run_transcription_strategy(&audio_data, &strategy_used)
            .await?;
        let transcription_duration = transcription_start.elapsed();

        let total_duration = start_time.elapsed();

        Ok(BenchmarkResult {
            test_name: test.name.clone(),
            strategy_used,
            chunk_size_ms: None,
            timing_metrics: TimingMetrics {
                time_to_first_result_ms: transcription_duration.as_millis() as u32,
                total_transcription_time_ms: transcription_duration.as_millis() as u32,
                perceived_latency_ms: total_duration.as_millis() as u32,
            },
            accuracy_metrics: AccuracyMetrics {
                transcribed_text: transcribed_text.clone(),
                word_count: transcribed_text.split_whitespace().count() as u32,
                character_count: transcribed_text.len() as u32,
                confidence_score: 0.85, // Placeholder
            },
            success: true,
            error_message: None,
        })
    }

    async fn run_transcription_strategy(
        &self,
        _audio_data: &[u8],
        strategy: &str,
    ) -> Result<String, String> {
        // TODO: Implement actual transcription strategies
        // For now, return a placeholder
        info(
            Component::Processing,
            &format!("🎯 Running transcription strategy: {}", strategy),
        );

        // Simulate processing time
        tokio::time::sleep(Duration::from_millis(100)).await;

        Ok("This is a placeholder transcription result".to_string())
    }

    fn generate_summary(&self, results: &[BenchmarkResult]) -> BenchmarkSummary {
        let successful_tests = results.iter().filter(|r| r.success).count();
        let failed_tests = results.len() - successful_tests;

        let avg_time_to_first_result = if successful_tests > 0 {
            results
                .iter()
                .filter(|r| r.success)
                .map(|r| r.timing_metrics.time_to_first_result_ms as f32)
                .sum::<f32>()
                / successful_tests as f32
        } else {
            0.0
        };

        let avg_total_time = if successful_tests > 0 {
            results
                .iter()
                .filter(|r| r.success)
                .map(|r| r.timing_metrics.total_transcription_time_ms as f32)
                .sum::<f32>()
                / successful_tests as f32
        } else {
            0.0
        };

        let strategies_tested: Vec<String> = results
            .iter()
            .map(|r| r.strategy_used.clone())
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();

        BenchmarkSummary {
            total_tests: results.len(),
            successful_tests,
            failed_tests,
            avg_time_to_first_result,
            avg_total_time,
            strategies_tested,
        }
    }

    async fn save_report(&self, report: &BenchmarkReport) -> Result<(), String> {
        // Ensure output directory exists
        tokio::fs::create_dir_all(&self.output_dir)
            .await
            .map_err(|e| format!("Failed to create output directory: {}", e))?;

        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let filename = format!("benchmark_report_{}.json", timestamp);
        let filepath = self.output_dir.join(filename);

        let json_content = serde_json::to_string_pretty(report)
            .map_err(|e| format!("Failed to serialize report: {}", e))?;

        tokio::fs::write(&filepath, json_content)
            .await
            .map_err(|e| format!("Failed to write report file: {}", e))?;

        info(
            Component::Processing,
            &format!("📄 Benchmark report saved to: {}", filepath.display()),
        );
        Ok(())
    }
}
