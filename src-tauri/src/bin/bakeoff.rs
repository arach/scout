use std::path::PathBuf;
use std::sync::Arc;
use clap::{Arg, Command};
use tokio;
use serde_json;

// Import the benchmarking modules
use scout_lib::benchmarking::{BenchmarkRunner, TestDataExtractor, StrategyTester, TranscriptionStrategy};
use scout_lib::db::Database;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let matches = Command::new("Scout Strategy Bake-off")
        .version("0.1.0")
        .about("Compares different cutoff times and strategies")
        .arg(
            Arg::new("database")
                .short('d')
                .long("database")
                .value_name("PATH")
                .help("Path to Scout database")
                .default_value("./scout.db")
        )
        .arg(
            Arg::new("output-dir")
                .short('o')
                .long("output")
                .value_name("DIR")
                .help("Output directory for results")
                .default_value("./bakeoff_results")
        )
        .get_matches();

    let db_path = PathBuf::from(matches.get_one::<String>("database").unwrap());
    let output_dir = PathBuf::from(matches.get_one::<String>("output-dir").unwrap());

    println!("🥊 Scout Strategy Bake-off");
    println!("📊 Cutoffs: 1s vs 3s vs 5s");
    println!("🎯 Strategies: Ring Buffer vs Processing Queue");
    println!("🗄️ Database: {}", db_path.display());
    println!("📁 Output: {}", output_dir.display());

    // Create output directory
    tokio::fs::create_dir_all(&output_dir).await?;

    // Initialize database and test data
    let database = Arc::new(Database::new(&db_path).await?);
    let extractor = TestDataExtractor::new(database.clone());
    let tests = extractor.extract_test_recordings().await?;

    if tests.is_empty() {
        println!("⚠️ No test recordings found in database");
        return Ok(());
    }

    println!("📋 Found {} test recordings", tests.len());

    // Define our test matrix
    let cutoffs = vec![1000, 3000, 5000]; // 1s, 3s, 5s in milliseconds
    let strategies = vec![
        ("processing_queue", None),
        ("ring_buffer_1s", Some(1000)),
        ("ring_buffer_3s", Some(3000)),
        ("ring_buffer_5s", Some(5000)),
    ];

    let model_path = PathBuf::from("./models/ggml-base.en.bin");
    let strategy_tester = StrategyTester::new(&model_path)
        .map_err(|e| format!("Failed to initialize Whisper model: {}", e))?;
    let mut bakeoff_results = Vec::new();

    println!("\n🚀 Starting Strategy Bake-off...\n");

    // Run the bake-off matrix
    for cutoff_ms in &cutoffs {
        println!("📏 Testing {}s cutoff...", *cutoff_ms as f32 / 1000.0);
        
        for (strategy_name, chunk_size) in &strategies {
            // Skip combinations that don't make sense
            if strategy_name.starts_with("ring_buffer") && chunk_size.is_some() {
                let expected_chunk = if strategy_name.contains("1s") { 1000 }
                else if strategy_name.contains("3s") { 3000 }
                else { 5000 };
                
                if chunk_size.unwrap() != expected_chunk {
                    continue; // Skip mismatched combinations
                }
            }
            
            println!("  🎯 Testing {}", strategy_name);
            
            let strategy = match *strategy_name {
                "processing_queue" => TranscriptionStrategy::ProcessingQueue,
                name if name.starts_with("ring_buffer") => {
                    TranscriptionStrategy::RingBuffer { 
                        chunk_size_ms: chunk_size.unwrap() 
                    }
                }
                _ => continue,
            };

            let mut strategy_results = Vec::new();
            let mut successful_tests = 0;
            let mut total_ttfr = 0.0;
            let mut total_accuracy = 0.0;

            // Test each recording with this strategy
            for test in &tests {
                // Only test recordings that would trigger this cutoff
                let should_use_strategy = match *strategy_name {
                    "processing_queue" => test.duration_ms <= *cutoff_ms,
                    name if name.starts_with("ring_buffer") => test.duration_ms > *cutoff_ms,
                    _ => false,
                };

                if !should_use_strategy {
                    continue; // Skip recordings that wouldn't use this strategy
                }

                match strategy_tester.test_strategy(&strategy, &test.audio_file, &test.name).await {
                    Ok(result) => {
                        total_ttfr += result.timing_metrics.time_to_first_result_ms as f32;
                        total_accuracy += result.accuracy_metrics.confidence_score;
                        successful_tests += 1;
                        strategy_results.push(result);
                    }
                    Err(e) => {
                        println!("    ❌ Test {} failed: {}", test.name, e);
                    }
                }
            }

            if successful_tests > 0 {
                let avg_ttfr = total_ttfr / successful_tests as f32;
                let avg_accuracy = total_accuracy / successful_tests as f32;
                
                println!("    ✅ {} tests - Avg TTFR: {:.1}ms, Accuracy: {:.2}", 
                        successful_tests, avg_ttfr, avg_accuracy);

                bakeoff_results.push(BakeoffResult {
                    cutoff_ms: *cutoff_ms,
                    strategy_name: strategy_name.to_string(),
                    chunk_size_ms: *chunk_size,
                    tests_run: successful_tests,
                    avg_ttfr_ms: avg_ttfr,
                    avg_accuracy: avg_accuracy,
                    test_results: strategy_results,
                });
            } else {
                println!("    ⚠️ No applicable tests for this strategy/cutoff combination");
            }
        }
        println!();
    }

    // Generate and save comprehensive report
    let report = generate_bakeoff_report(bakeoff_results);
    save_bakeoff_report(&output_dir, &report).await?;
    print_bakeoff_summary(&report);

    println!("\n✅ Bake-off completed! Results saved to: {}", output_dir.display());
    Ok(())
}

#[derive(Debug, serde::Serialize)]
struct BakeoffResult {
    cutoff_ms: u32,
    strategy_name: String,
    chunk_size_ms: Option<u32>,
    tests_run: usize,
    avg_ttfr_ms: f32,
    avg_accuracy: f32,
    test_results: Vec<scout_lib::benchmarking::BenchmarkResult>,
}

#[derive(Debug, serde::Serialize)]
struct BakeoffReport {
    results: Vec<BakeoffResult>,
    summary: BakeoffSummary,
    created_at: String,
}

#[derive(Debug, serde::Serialize)]
struct BakeoffSummary {
    best_responsiveness: BestResult,
    best_accuracy: BestResult,
    best_overall: BestResult,
    strategy_comparison: Vec<StrategyComparison>,
    cutoff_analysis: Vec<CutoffAnalysis>,
}

#[derive(Debug, serde::Serialize)]
struct BestResult {
    strategy: String,
    cutoff_ms: u32,
    value: f32,
    tests_run: usize,
}

#[derive(Debug, serde::Serialize)]
struct StrategyComparison {
    strategy: String,
    avg_ttfr_ms: f32,
    avg_accuracy: f32,
    total_tests: usize,
    cutoffs_tested: Vec<u32>,
}

#[derive(Debug, serde::Serialize)]
struct CutoffAnalysis {
    cutoff_ms: u32,
    processing_queue_performance: Option<f32>,
    ring_buffer_performance: Option<f32>,
    optimal_strategy: String,
}

fn generate_bakeoff_report(results: Vec<BakeoffResult>) -> BakeoffReport {
    // Find best performers
    let best_responsiveness = results.iter()
        .min_by(|a, b| a.avg_ttfr_ms.partial_cmp(&b.avg_ttfr_ms).unwrap())
        .map(|r| BestResult {
            strategy: r.strategy_name.clone(),
            cutoff_ms: r.cutoff_ms,
            value: r.avg_ttfr_ms,
            tests_run: r.tests_run,
        })
        .unwrap_or(BestResult {
            strategy: "none".to_string(),
            cutoff_ms: 0,
            value: 0.0,
            tests_run: 0,
        });

    let best_accuracy = results.iter()
        .max_by(|a, b| a.avg_accuracy.partial_cmp(&b.avg_accuracy).unwrap())
        .map(|r| BestResult {
            strategy: r.strategy_name.clone(),
            cutoff_ms: r.cutoff_ms,
            value: r.avg_accuracy,
            tests_run: r.tests_run,
        })
        .unwrap_or(BestResult {
            strategy: "none".to_string(),
            cutoff_ms: 0,
            value: 0.0,
            tests_run: 0,
        });

    // Calculate overall score (weighted combination of speed and accuracy)
    let best_overall = results.iter()
        .map(|r| {
            let speed_score = 1000.0 / r.avg_ttfr_ms.max(1.0); // Higher is better
            let accuracy_score = r.avg_accuracy * 1000.0; // Scale to similar range
            let overall_score = speed_score * 0.6 + accuracy_score * 0.4; // 60% speed, 40% accuracy
            (r, overall_score)
        })
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
        .map(|(r, score)| BestResult {
            strategy: r.strategy_name.clone(),
            cutoff_ms: r.cutoff_ms,
            value: score,
            tests_run: r.tests_run,
        })
        .unwrap_or(BestResult {
            strategy: "none".to_string(),
            cutoff_ms: 0,
            value: 0.0,
            tests_run: 0,
        });

    // Generate strategy comparisons
    let mut strategy_groups = std::collections::HashMap::new();
    for result in &results {
        let strategy_base = if result.strategy_name.starts_with("ring_buffer") {
            "ring_buffer"
        } else {
            &result.strategy_name
        };
        
        strategy_groups.entry(strategy_base.to_string())
            .or_insert_with(Vec::new)
            .push(result);
    }

    let strategy_comparison: Vec<StrategyComparison> = strategy_groups.into_iter()
        .map(|(strategy, results)| {
            let total_tests: usize = results.iter().map(|r| r.tests_run).sum();
            let weighted_ttfr: f32 = results.iter()
                .map(|r| r.avg_ttfr_ms * r.tests_run as f32)
                .sum::<f32>() / total_tests as f32;
            let weighted_accuracy: f32 = results.iter()
                .map(|r| r.avg_accuracy * r.tests_run as f32)
                .sum::<f32>() / total_tests as f32;
            let cutoffs_tested: Vec<u32> = results.iter().map(|r| r.cutoff_ms).collect();

            StrategyComparison {
                strategy,
                avg_ttfr_ms: weighted_ttfr,
                avg_accuracy: weighted_accuracy,
                total_tests,
                cutoffs_tested,
            }
        })
        .collect();

    // Generate cutoff analysis
    let cutoff_analysis: Vec<CutoffAnalysis> = [1000, 3000, 5000].iter()
        .map(|&cutoff| {
            let pq_result = results.iter()
                .find(|r| r.cutoff_ms == cutoff && r.strategy_name == "processing_queue");
            let rb_result = results.iter()
                .find(|r| r.cutoff_ms == cutoff && r.strategy_name.starts_with("ring_buffer"));

            let optimal_strategy = match (pq_result, rb_result) {
                (Some(pq), Some(rb)) => {
                    if pq.avg_ttfr_ms < rb.avg_ttfr_ms { 
                        "processing_queue".to_string() 
                    } else { 
                        "ring_buffer".to_string() 
                    }
                }
                (Some(_), None) => "processing_queue".to_string(),
                (None, Some(_)) => "ring_buffer".to_string(),
                (None, None) => "none".to_string(),
            };

            CutoffAnalysis {
                cutoff_ms: cutoff,
                processing_queue_performance: pq_result.map(|r| r.avg_ttfr_ms),
                ring_buffer_performance: rb_result.map(|r| r.avg_ttfr_ms),
                optimal_strategy,
            }
        })
        .collect();

    BakeoffReport {
        results,
        summary: BakeoffSummary {
            best_responsiveness,
            best_accuracy,
            best_overall,
            strategy_comparison,
            cutoff_analysis,
        },
        created_at: chrono::Utc::now().to_rfc3339(),
    }
}

async fn save_bakeoff_report(output_dir: &PathBuf, report: &BakeoffReport) -> Result<(), Box<dyn std::error::Error>> {
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let filename = format!("bakeoff_report_{}.json", timestamp);
    let filepath = output_dir.join(filename);

    let json_content = serde_json::to_string_pretty(report)?;
    tokio::fs::write(&filepath, json_content).await?;

    println!("📄 Detailed report saved to: {}", filepath.display());
    Ok(())
}

fn print_bakeoff_summary(report: &BakeoffReport) {
    println!("\n🏆 BAKE-OFF RESULTS\n");
    
    println!("🚀 BEST RESPONSIVENESS:");
    println!("   {} ({}ms cutoff) - {:.1}ms TTFR ({} tests)",
        report.summary.best_responsiveness.strategy,
        report.summary.best_responsiveness.cutoff_ms,
        report.summary.best_responsiveness.value,
        report.summary.best_responsiveness.tests_run);
    
    println!("\n🎯 BEST ACCURACY:");
    println!("   {} ({}ms cutoff) - {:.3} confidence ({} tests)",
        report.summary.best_accuracy.strategy,
        report.summary.best_accuracy.cutoff_ms,
        report.summary.best_accuracy.value,
        report.summary.best_accuracy.tests_run);
    
    println!("\n🏅 BEST OVERALL:");
    println!("   {} ({}ms cutoff) - {:.1} score ({} tests)",
        report.summary.best_overall.strategy,
        report.summary.best_overall.cutoff_ms,
        report.summary.best_overall.value,
        report.summary.best_overall.tests_run);

    println!("\n📊 STRATEGY COMPARISON:");
    for strategy in &report.summary.strategy_comparison {
        println!("   {} - TTFR: {:.1}ms, Accuracy: {:.3}, Tests: {}",
            strategy.strategy,
            strategy.avg_ttfr_ms,
            strategy.avg_accuracy,
            strategy.total_tests);
    }

    println!("\n⏱️ CUTOFF ANALYSIS:");
    for analysis in &report.summary.cutoff_analysis {
        println!("   {}s cutoff - Optimal: {}",
            analysis.cutoff_ms as f32 / 1000.0,
            analysis.optimal_strategy);
        if let Some(pq_perf) = analysis.processing_queue_performance {
            println!("      Processing Queue: {:.1}ms", pq_perf);
        }
        if let Some(rb_perf) = analysis.ring_buffer_performance {
            println!("      Ring Buffer: {:.1}ms", rb_perf);
        }
    }
}