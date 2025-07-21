use std::path::{Path, PathBuf};
use std::time::Instant;
use clap::Parser;
use scout_lib::transcription::{TranscriptionConfig, TranscriptionStrategySelector, Transcriber};
use scout_lib::logger::{init_logger, info, Component};
use serde::{Serialize, Deserialize};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Path to the recording file
    #[arg(short, long)]
    recording: PathBuf,
    
    /// Refinement chunk size in seconds
    #[arg(short, long, default_value = "15")]
    chunk_size: u64,
    
    /// Output file for results
    #[arg(short, long)]
    output: Option<PathBuf>,
}

#[derive(Serialize, Deserialize)]
struct BenchmarkResult {
    recording: String,
    duration_secs: f32,
    chunk_size: u64,
    strategy_used: String,
    tiny_chunks: usize,
    refinements_completed: usize,
    processing_time_ms: u64,
    finalization_time_ms: u64,
    total_time_ms: u64,
    text_length: usize,
    text_preview: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    init_logger();
    
    println!("\nProgressive Transcription Benchmark");
    println!("===================================");
    println!("Recording: {}", args.recording.display());
    println!("Chunk size: {}s", args.chunk_size);
    println!("");
    
    let models_dir = PathBuf::from("/Users/arach/Library/Application Support/com.scout.app/models");
    let temp_dir = std::env::temp_dir().join("scout_benchmark");
    std::fs::create_dir_all(&temp_dir)?;
    
    // Verify recording exists
    if !args.recording.exists() {
        eprintln!("Error: Recording file not found: {}", args.recording.display());
        std::process::exit(1);
    }
    
    // Load audio to get duration
    let reader = hound::WavReader::open(&args.recording)?;
    let spec = reader.spec();
    let sample_count = reader.len();
    let duration_secs = sample_count as f32 / spec.sample_rate as f32;
    
    println!("Audio duration: {:.1}s", duration_secs);
    println!("Sample rate: {}Hz", spec.sample_rate);
    println!("");
    
    // Create config
    let mut config = TranscriptionConfig::default();
    config.force_strategy = Some("progressive".to_string());
    config.refinement_chunk_secs = Some(args.chunk_size);
    config.enable_chunking = true;
    config.chunking_threshold_secs = 5;
    
    // Create transcriber
    let medium_path = models_dir.join("ggml-medium.en.bin");
    if !medium_path.exists() {
        eprintln!("Error: Medium model not found at: {}", medium_path.display());
        std::process::exit(1);
    }
    
    let transcriber = Transcriber::get_or_create_cached(&medium_path).await?;
    
    let total_start = Instant::now();
    
    // Create strategy
    let mut strategy = TranscriptionStrategySelector::select_strategy(
        Some(std::time::Duration::from_secs(duration_secs as u64)),
        &config,
        transcriber,
        temp_dir,
        None,
    ).await;
    
    println!("Strategy selected: {}", strategy.name());
    
    // Start recording
    strategy.start_recording(&args.recording, &config).await?;
    
    // Load and process audio
    let mut reader = hound::WavReader::open(&args.recording)?;
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => {
            reader.samples::<f32>()
                .map(|s| s.unwrap_or(0.0))
                .collect()
        }
        hound::SampleFormat::Int => {
            let bits = spec.bits_per_sample;
            if bits == 16 {
                reader.samples::<i16>()
                    .map(|s| s.unwrap_or(0) as f32 / i16::MAX as f32)
                    .collect()
            } else {
                reader.samples::<i32>()
                    .map(|s| s.unwrap_or(0) as f32 / i32::MAX as f32)
                    .collect()
            }
        }
    };
    
    // Process in 1-second chunks to simulate real-time
    let chunk_size_samples = spec.sample_rate as usize;
    let processing_start = Instant::now();
    
    println!("Processing {} samples in {}s chunks...", samples.len(), 1);
    
    let mut processed = 0;
    for (i, chunk) in samples.chunks(chunk_size_samples).enumerate() {
        strategy.process_samples(chunk).await?;
        processed += chunk.len();
        
        if i % 5 == 0 && i > 0 {
            let progress = (processed as f32 / samples.len() as f32) * 100.0;
            println!("  Progress: {:.1}% ({}s processed)", progress, i);
        }
    }
    
    let processing_time = processing_start.elapsed();
    println!("\nProcessing complete in {:.2}s", processing_time.as_secs_f32());
    
    // Finish recording
    println!("Finalizing transcription...");
    let finalization_start = Instant::now();
    let result = strategy.finish_recording().await?;
    let finalization_time = finalization_start.elapsed();
    
    let total_time = total_start.elapsed();
    
    // Count actual refinements from logs (this is approximate)
    let expected_tiny_chunks = (duration_secs / 5.0).ceil() as usize;
    let expected_refinements = (duration_secs / args.chunk_size as f32).floor() as usize;
    
    // Create benchmark result
    let benchmark_result = BenchmarkResult {
        recording: args.recording.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        duration_secs,
        chunk_size: args.chunk_size,
        strategy_used: result.strategy_used.clone(),
        tiny_chunks: expected_tiny_chunks,
        refinements_completed: expected_refinements,
        processing_time_ms: processing_time.as_millis() as u64,
        finalization_time_ms: finalization_time.as_millis() as u64,
        total_time_ms: total_time.as_millis() as u64,
        text_length: result.text.len(),
        text_preview: result.text.chars().take(100).collect::<String>() + "...",
    };
    
    // Print results
    println!("\nRESULTS");
    println!("=======");
    println!("Strategy used: {}", benchmark_result.strategy_used);
    println!("Total time: {:.2}s", benchmark_result.total_time_ms as f32 / 1000.0);
    println!("Processing time: {:.2}s", benchmark_result.processing_time_ms as f32 / 1000.0);
    println!("Finalization time: {:.2}s", benchmark_result.finalization_time_ms as f32 / 1000.0);
    println!("Expected Tiny chunks: {}", benchmark_result.tiny_chunks);
    println!("Expected refinements: {}", benchmark_result.refinements_completed);
    println!("Text length: {} characters", benchmark_result.text_length);
    println!("\nTranscript preview:");
    println!("{}", benchmark_result.text_preview);
    
    // Save results if output specified
    if let Some(output_path) = args.output {
        let json = serde_json::to_string_pretty(&benchmark_result)?;
        std::fs::write(&output_path, json)?;
        println!("\nResults saved to: {}", output_path.display());
    }
    
    Ok(())
}