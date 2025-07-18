use std::path::Path;
use std::time::Instant;
use scout_lib::transcription::{TranscriptionConfig, TranscriptionStrategySelector, Transcriber};
use scout_lib::logger::{init_logger, info, Component};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logger
    init_logger();
    
    println!("Progressive Transcription Benchmark");
    println!("==================================\n");
    
    let models_dir = Path::new("/Users/arach/Library/Application Support/com.scout.app/models");
    let recordings_dir = Path::new("/Users/arach/Library/Application Support/com.scout.app/recordings");
    let temp_dir = Path::new("/tmp/scout_benchmark");
    std::fs::create_dir_all(&temp_dir)?;
    
    // Get recent recordings
    let mut recordings: Vec<_> = std::fs::read_dir(recordings_dir)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.path().extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext == "wav")
                .unwrap_or(false)
        })
        .collect();
    
    // Sort by modified time (most recent first)
    recordings.sort_by_key(|entry| {
        entry.metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    });
    recordings.reverse();
    
    // Take the 2 most recent
    let test_recordings: Vec<_> = recordings.into_iter()
        .take(2)
        .map(|entry| entry.path())
        .collect();
    
    println!("Test recordings:");
    for recording in &test_recordings {
        println!("  - {}", recording.file_name().unwrap().to_str().unwrap());
    }
    
    // Test different refinement chunk sizes
    let chunk_sizes = vec![5, 10, 15, 20, 25, 30];
    
    println!("\nTesting refinement chunk sizes: {:?} seconds\n", chunk_sizes);
    
    // Results storage
    let mut results = Vec::new();
    
    for chunk_size in &chunk_sizes {
        for recording in &test_recordings {
            println!("Testing {}s chunks on {}...", 
                chunk_size, 
                recording.file_name().unwrap().to_str().unwrap()
            );
            
            // Create config with specific chunk size
            let mut config = TranscriptionConfig::default();
            config.force_strategy = Some("progressive".to_string());
            config.refinement_chunk_secs = Some(*chunk_size);
            
            // Create a dummy transcriber (Medium model)
            let medium_path = models_dir.join("ggml-medium.en.bin");
            let transcriber = Transcriber::get_or_create_cached(&medium_path).await?;
            
            // Time the strategy creation and transcription
            let start = Instant::now();
            
            let mut strategy = TranscriptionStrategySelector::select_strategy(
                None, // duration estimate
                &config,
                transcriber,
                temp_dir.to_path_buf(),
                None, // app handle
            ).await;
            
            // Simulate recording and transcription
            strategy.start_recording(recording, &config).await?;
            
            // Load audio samples
            let audio_data = load_audio_file(recording)?;
            
            // Process in chunks to simulate real-time
            let chunk_size_samples = 48000 * 5; // 5 second chunks
            for chunk in audio_data.chunks(chunk_size_samples) {
                strategy.process_samples(chunk).await?;
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            }
            
            // Finish and get results
            let result = strategy.finish_recording().await?;
            
            let total_time = start.elapsed();
            
            results.push((
                *chunk_size,
                recording.file_name().unwrap().to_str().unwrap().to_string(),
                total_time.as_millis(),
                result.processing_time_ms,
                result.chunks_processed,
            ));
            
            println!("  Total time: {}ms", total_time.as_millis());
            println!("  Processing time: {}ms", result.processing_time_ms);
            println!("  Chunks processed: {}\n", result.chunks_processed);
        }
    }
    
    // Print summary
    println!("\nSummary");
    println!("=======");
    println!("Chunk Size | Recording | Total Time | Processing Time | Chunks");
    println!("-----------|-----------|------------|-----------------|-------");
    
    for (chunk_size, recording, total_ms, proc_ms, chunks) in results {
        println!("{:10} | {:9} | {:10}ms | {:15}ms | {:6}", 
            format!("{}s", chunk_size),
            &recording[..9],
            total_ms,
            proc_ms,
            chunks
        );
    }
    
    Ok(())
}

fn load_audio_file(path: &Path) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
    let mut reader = hound::WavReader::open(path)?;
    let spec = reader.spec();
    
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => {
            reader.samples::<f32>()
                .map(|s| s.unwrap_or(0.0))
                .collect()
        }
        hound::SampleFormat::Int => {
            let max_value = (1 << (spec.bits_per_sample - 1)) as f32;
            reader.samples::<i32>()
                .map(|s| s.unwrap_or(0) as f32 / max_value)
                .collect()
        }
    };
    
    Ok(samples)
}