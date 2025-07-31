use clap::{Arg, Command};
use std::path::PathBuf;
use std::sync::Arc;
use tokio;

// Import the benchmarking modules
use scout_lib::benchmarking::{
    BenchmarkRunner, MetricsAnalyzer, StrategyTester, TestDataExtractor, TranscriptionStrategy,
};
use scout_lib::db::Database;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let matches = Command::new("Scout Transcription Benchmark")
        .version("0.1.0")
        .about("Benchmarks transcription strategies")
        .arg(
            Arg::new("test-type")
                .short('t')
                .long("test")
                .value_name("TYPE")
                .help("Type of benchmark to run")
                .value_parser(["cutoff", "progressive", "strategies", "extract-data"])
                .default_value("strategies"),
        )
        .arg(
            Arg::new("output-dir")
                .short('o')
                .long("output")
                .value_name("DIR")
                .help("Output directory for benchmark results")
                .default_value("./benchmark_results"),
        )
        .arg(
            Arg::new("database-path")
                .short('d')
                .long("database")
                .value_name("PATH")
                .help("Path to Scout database")
                .default_value("./scout.db"),
        )
        .get_matches();

    let test_type = matches.get_one::<String>("test-type").unwrap();
    let output_dir = PathBuf::from(matches.get_one::<String>("output-dir").unwrap());
    let db_path = PathBuf::from(matches.get_one::<String>("database-path").unwrap());

    println!("🚀 Starting Scout Transcription Benchmark");
    println!("📊 Test type: {}", test_type);
    println!("📁 Output directory: {}", output_dir.display());
    println!("🗄️ Database: {}", db_path.display());

    // Create output directory
    tokio::fs::create_dir_all(&output_dir).await?;

    // Initialize database
    let database = Arc::new(Database::new(&db_path).await?);

    // Initialize benchmark runner
    let runner = BenchmarkRunner::new(output_dir.clone());

    match test_type.as_str() {
        "extract-data" => {
            extract_test_data(database).await?;
        }
        "strategies" => {
            run_strategy_benchmark(&runner, database).await?;
        }
        "cutoff" => {
            run_cutoff_benchmark(&runner, database).await?;
        }
        "progressive" => {
            run_progressive_benchmark(&runner, database).await?;
        }
        _ => {
            eprintln!("Unknown test type: {}", test_type);
            return Ok(());
        }
    }

    println!(
        "✅ Benchmark completed! Results saved to: {}",
        output_dir.display()
    );
    Ok(())
}

async fn extract_test_data(database: Arc<Database>) -> Result<(), Box<dyn std::error::Error>> {
    println!("📊 Extracting test data from database...");

    let extractor = TestDataExtractor::new(database);
    let tests = extractor.extract_test_recordings().await?;

    println!("📋 Found {} test recordings:", tests.len());
    for test in &tests {
        println!(
            "  - {} ({:?}, {} ms)",
            test.name, test.recording_length_category, test.duration_ms
        );
    }

    // Save test data configuration
    let config_path = PathBuf::from("./benchmark_test_data.json");
    let json_data = serde_json::to_string_pretty(&tests)?;
    tokio::fs::write(&config_path, json_data).await?;

    println!(
        "💾 Test data configuration saved to: {}",
        config_path.display()
    );
    Ok(())
}

async fn run_strategy_benchmark(
    runner: &BenchmarkRunner,
    database: Arc<Database>,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("🎯 Running strategy comparison benchmark...");

    // Extract test data
    let extractor = TestDataExtractor::new(database);
    let mut tests = extractor.extract_test_recordings().await?;

    // Add synthetic tests for missing data
    let synthetic_tests = extractor.create_synthetic_tests().await?;
    tests.extend(synthetic_tests);

    if tests.is_empty() {
        println!("⚠️ No test data found. Please record some audio first or ensure the database path is correct.");
        return Ok(());
    }

    println!("📊 Running benchmark with {} tests", tests.len());

    // Run benchmark
    let report = runner.run_benchmark_suite(tests).await?;

    // Analyze results
    let analysis = MetricsAnalyzer::analyze_results(&report.test_results);

    // Print summary
    println!("\n📈 Benchmark Results Summary:");
    println!("  Total tests: {}", report.summary.total_tests);
    println!("  Successful: {}", report.summary.successful_tests);
    println!("  Failed: {}", report.summary.failed_tests);
    println!(
        "  Avg time to first result: {:.2}ms",
        report.summary.avg_time_to_first_result
    );
    println!("  Avg total time: {:.2}ms", report.summary.avg_total_time);

    println!("\n🎯 Strategy Comparisons:");
    for comparison in &analysis.strategy_comparisons {
        println!(
            "  {} ({}x):",
            comparison.strategy_name, comparison.test_count
        );
        println!("    TTFR: {:.2}ms", comparison.avg_time_to_first_result_ms);
        println!("    Total: {:.2}ms", comparison.avg_total_time_ms);
        println!("    Confidence: {:.2}", comparison.avg_confidence_score);
        println!("    Success rate: {:.1}%", comparison.success_rate * 100.0);
    }

    println!("\n💡 Recommendations:");
    for rec in &analysis.recommendations {
        println!("  - {}", rec);
    }

    Ok(())
}

async fn run_cutoff_benchmark(
    runner: &BenchmarkRunner,
    database: Arc<Database>,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("⏱️ Running cutoff optimization benchmark...");

    // Extract test data focusing on different length categories
    let extractor = TestDataExtractor::new(database);
    let tests = extractor.extract_test_recordings().await?;

    if tests.is_empty() {
        println!("⚠️ No test data found for cutoff analysis.");
        return Ok(());
    }

    // Test different cutoff strategies
    let cutoff_tests = vec![
        ("1s_cutoff", 1000),
        ("2s_cutoff", 2000),
        ("5s_cutoff", 5000),
    ];

    for (name, cutoff_ms) in cutoff_tests {
        println!("🔍 Testing {} cutoff...", name);

        // Simulate different cutoff behaviors
        let mut cutoff_specific_tests = tests.clone();
        for test in &mut cutoff_specific_tests {
            test.name = format!("{}_{}", name, test.name);
        }

        let report = runner.run_benchmark_suite(cutoff_specific_tests).await?;
        println!(
            "  ✅ {} completed: {} successful / {} total",
            name, report.summary.successful_tests, report.summary.total_tests
        );
    }

    Ok(())
}

async fn run_progressive_benchmark(
    runner: &BenchmarkRunner,
    database: Arc<Database>,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("🔄 Running progressive transcription benchmark...");

    let extractor = TestDataExtractor::new(database);
    let tests = extractor.extract_test_recordings().await?;

    if tests.is_empty() {
        println!("⚠️ No test data found for progressive analysis.");
        return Ok(());
    }

    // Test progressive strategies
    let strategies = vec![
        TranscriptionStrategy::ProcessingQueue,
        TranscriptionStrategy::RingBuffer {
            chunk_size_ms: 5000,
        },
        TranscriptionStrategy::RingBuffer {
            chunk_size_ms: 1000,
        },
        TranscriptionStrategy::Progressive {
            quick_model: "tiny.en".to_string(),
            quality_model: "medium.en".to_string(),
            chunk_size_ms: 1000,
        },
    ];

    let model_path = PathBuf::from("./models/ggml-base.en.bin");
    let strategy_tester = StrategyTester::new(&model_path)
        .map_err(|e| format!("Failed to initialize Whisper model: {}", e))?;

    for strategy in strategies {
        println!("🎯 Testing strategy: {}", strategy.name());

        let mut strategy_results = Vec::new();
        for test in &tests {
            match strategy_tester
                .test_strategy(&strategy, &test.audio_file, &test.name)
                .await
            {
                Ok(result) => strategy_results.push(result),
                Err(e) => println!("  ❌ Test {} failed: {}", test.name, e),
            }
        }

        if !strategy_results.is_empty() {
            let avg_ttfr = strategy_results
                .iter()
                .map(|r| r.timing_metrics.time_to_first_result_ms as f32)
                .sum::<f32>()
                / strategy_results.len() as f32;

            println!(
                "  ✅ Average TTFR: {:.2}ms ({} tests)",
                avg_ttfr,
                strategy_results.len()
            );
        }
    }

    Ok(())
}
