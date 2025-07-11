use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::benchmarking::BenchmarkResult;

#[derive(Debug, Serialize, Deserialize)]
pub struct PerformanceAnalysis {
    pub strategy_comparisons: Vec<StrategyComparison>,
    pub cutoff_analysis: CutoffAnalysis,
    pub recommendations: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StrategyComparison {
    pub strategy_name: String,
    pub avg_time_to_first_result_ms: f32,
    pub avg_total_time_ms: f32,
    pub avg_confidence_score: f32,
    pub success_rate: f32,
    pub test_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CutoffAnalysis {
    pub optimal_cutoff_1s: PerformanceMetric,
    pub optimal_cutoff_2s: PerformanceMetric,
    pub optimal_cutoff_5s: PerformanceMetric,
    pub recommendation: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PerformanceMetric {
    pub avg_latency_ms: f32,
    pub avg_accuracy: f32,
    pub user_satisfaction_score: f32,
}

pub struct MetricsAnalyzer;

impl MetricsAnalyzer {
    pub fn analyze_results(results: &[BenchmarkResult]) -> PerformanceAnalysis {
        let strategy_comparisons = Self::analyze_strategies(results);
        let cutoff_analysis = Self::analyze_cutoff_performance(results);
        let recommendations = Self::generate_recommendations(results);

        PerformanceAnalysis {
            strategy_comparisons,
            cutoff_analysis,
            recommendations,
        }
    }

    fn analyze_strategies(results: &[BenchmarkResult]) -> Vec<StrategyComparison> {
        let mut strategy_groups: HashMap<String, Vec<&BenchmarkResult>> = HashMap::new();
        
        // Group results by strategy
        for result in results {
            strategy_groups.entry(result.strategy_used.clone()).or_insert_with(Vec::new).push(result);
        }

        // Calculate metrics for each strategy
        let mut comparisons = Vec::new();
        for (strategy_name, strategy_results) in strategy_groups {
            let successful_results: Vec<&BenchmarkResult> = strategy_results.iter()
                .filter(|r| r.success)
                .copied()
                .collect();

            if successful_results.is_empty() {
                continue;
            }

            let avg_time_to_first_result_ms = successful_results.iter()
                .map(|r| r.timing_metrics.time_to_first_result_ms as f32)
                .sum::<f32>() / successful_results.len() as f32;

            let avg_total_time_ms = successful_results.iter()
                .map(|r| r.timing_metrics.total_transcription_time_ms as f32)
                .sum::<f32>() / successful_results.len() as f32;

            let avg_confidence_score = successful_results.iter()
                .map(|r| r.accuracy_metrics.confidence_score)
                .sum::<f32>() / successful_results.len() as f32;

            let success_rate = successful_results.len() as f32 / strategy_results.len() as f32;

            comparisons.push(StrategyComparison {
                strategy_name,
                avg_time_to_first_result_ms,
                avg_total_time_ms,
                avg_confidence_score,
                success_rate,
                test_count: strategy_results.len(),
            });
        }

        comparisons
    }

    fn analyze_cutoff_performance(results: &[BenchmarkResult]) -> CutoffAnalysis {
        // Simulate cutoff analysis based on chunk sizes
        let ring_buffer_results: Vec<&BenchmarkResult> = results.iter()
            .filter(|r| r.strategy_used.contains("ring_buffer"))
            .collect();

        let optimal_cutoff_1s = Self::calculate_performance_for_cutoff(&ring_buffer_results, 1000);
        let optimal_cutoff_2s = Self::calculate_performance_for_cutoff(&ring_buffer_results, 2000);
        let optimal_cutoff_5s = Self::calculate_performance_for_cutoff(&ring_buffer_results, 5000);

        let recommendation = if optimal_cutoff_1s.user_satisfaction_score > optimal_cutoff_2s.user_satisfaction_score {
            "1-second cutoff provides best user experience".to_string()
        } else if optimal_cutoff_2s.user_satisfaction_score > optimal_cutoff_5s.user_satisfaction_score {
            "2-second cutoff provides optimal balance".to_string()
        } else {
            "5-second cutoff provides best accuracy".to_string()
        };

        CutoffAnalysis {
            optimal_cutoff_1s,
            optimal_cutoff_2s,
            optimal_cutoff_5s,
            recommendation,
        }
    }

    fn calculate_performance_for_cutoff(results: &[&BenchmarkResult], cutoff_ms: u32) -> PerformanceMetric {
        if results.is_empty() {
            return PerformanceMetric {
                avg_latency_ms: 0.0,
                avg_accuracy: 0.0,
                user_satisfaction_score: 0.0,
            };
        }

        let avg_latency_ms = results.iter()
            .map(|r| r.timing_metrics.time_to_first_result_ms as f32)
            .sum::<f32>() / results.len() as f32;

        let avg_accuracy = results.iter()
            .map(|r| r.accuracy_metrics.confidence_score)
            .sum::<f32>() / results.len() as f32;

        // Calculate user satisfaction score based on latency and accuracy
        let latency_score = (1000.0 - avg_latency_ms.min(1000.0)) / 1000.0; // Higher is better
        let accuracy_score = avg_accuracy; // Already 0-1 scale
        let user_satisfaction_score = (latency_score * 0.6) + (accuracy_score * 0.4);

        PerformanceMetric {
            avg_latency_ms,
            avg_accuracy,
            user_satisfaction_score,
        }
    }

    fn generate_recommendations(results: &[BenchmarkResult]) -> Vec<String> {
        let mut recommendations = Vec::new();

        // Analyze overall performance
        let successful_results: Vec<&BenchmarkResult> = results.iter()
            .filter(|r| r.success)
            .collect();

        if successful_results.is_empty() {
            recommendations.push("No successful tests found. Check audio file paths and transcription setup.".to_string());
            return recommendations;
        }

        let avg_latency = successful_results.iter()
            .map(|r| r.timing_metrics.time_to_first_result_ms as f32)
            .sum::<f32>() / successful_results.len() as f32;

        if avg_latency < 200.0 {
            recommendations.push("Excellent responsiveness achieved. Consider implementing progressive transcription for quality improvements.".to_string());
        } else if avg_latency < 500.0 {
            recommendations.push("Good responsiveness. Consider smaller chunk sizes for better user experience.".to_string());
        } else {
            recommendations.push("High latency detected. Consider faster models or optimized processing pipeline.".to_string());
        }

        // Strategy-specific recommendations
        let has_ring_buffer = results.iter().any(|r| r.strategy_used.contains("ring_buffer"));
        let has_progressive = results.iter().any(|r| r.strategy_used.contains("progressive"));

        if !has_ring_buffer {
            recommendations.push("Consider implementing ring buffer strategy for better real-time performance.".to_string());
        }

        if !has_progressive {
            recommendations.push("Consider implementing progressive transcription for immediate feedback with quality improvements.".to_string());
        }

        recommendations
    }
}