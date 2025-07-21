use std::path::Path;
use std::time::Instant;
use scout_lib::transcription::{TranscriptionConfig, TranscriptionStrategySelector, Transcriber};
use scout_lib::logger::{init_logger, info, Component};
use scout_lib::audio::ring_buffer_recorder::RingBufferRecorder;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    init_logger();
    
    println!("\nProgressive Transcription - Real Processing Test");
    println!("===============================================\n");
    
    let models_dir = Path::new("/Users/arach/Library/Application Support/com.scout.app/models");
    let temp_dir = std::path::PathBuf::from("/tmp/scout_progressive_test");
    std::fs::create_dir_all(&temp_dir)?;
    
    // Test recordings
    let recordings = vec![
        ("/Users/arach/Library/Application Support/com.scout.app/recordings/recording_20250717_213547.wav", "100s recording"),
        ("/Users/arach/Library/Application Support/com.scout.app/recordings/recording_20250717_202651.wav", "72s recording"),
        ("/Users/arach/Library/Application Support/com.scout.app/recordings/recording_20250717_200446.wav", "10s recording"),
        ("/Users/arach/Library/Application Support/com.scout.app/recordings/recording_20250718_085337.wav", "8s recording"),
    ];
    
    // Test with 15s refinement chunks
    let chunk_size = 15u64;
    
    for (recording_path, description) in recordings {
        println!("\n{'='*60}");
        println!("Testing: {} ({})", description, recording_path);
        println!("Refinement chunk size: {}s", chunk_size);
        println!("{'='*60}\n");
        
        let path = Path::new(recording_path);
        if !path.exists() {
            println!("File not found, skipping...");
            continue;
        }
        
        // Create config
        let mut config = TranscriptionConfig::default();
        config.force_strategy = Some("progressive".to_string());
        config.refinement_chunk_secs = Some(chunk_size);
        
        // Create transcriber (this will load from cache after first time)
        let medium_path = models_dir.join("ggml-medium.en.bin");
        let transcriber = Transcriber::get_or_create_cached(&medium_path).await?;
        
        // Time the entire process
        let start = Instant::now();
        
        // Create strategy
        let mut strategy = TranscriptionStrategySelector::select_strategy(
            None,
            &config,
            transcriber,
            temp_dir.clone(),
            None,
        ).await;
        
        println!("Strategy selected: {}", strategy.name());
        
        // Start recording
        strategy.start_recording(path, &config).await?;
        
        // Load and process audio
        let mut reader = hound::WavReader::open(path)?;
        let spec = reader.spec();
        let sample_rate = spec.sample_rate as f32;
        
        // Collect all samples
        let samples: Vec<f32> = reader.samples::<i16>()
            .map(|s| s.unwrap_or(0) as f32 / i16::MAX as f32)
            .collect();
        
        let duration_secs = samples.len() as f32 / sample_rate;
        println!("Audio duration: {:.1}s", duration_secs);
        println!("Total samples: {}", samples.len());
        
        // Process in 1-second chunks to simulate real-time
        let chunk_size_samples = sample_rate as usize;
        let mut processed = 0;
        let mut chunk_count = 0;
        
        println!("\nProcessing audio in real-time simulation...");
        let processing_start = Instant::now();
        
        for chunk in samples.chunks(chunk_size_samples) {
            strategy.process_samples(chunk).await?;
            processed += chunk.len();
            chunk_count += 1;
            
            if chunk_count % 5 == 0 {
                println!("  Processed {}s of audio...", chunk_count);
            }
            
            // Don't sleep - process as fast as possible for testing
        }
        
        let processing_time = processing_start.elapsed();
        println!("Audio processing complete in {:.2}s", processing_time.as_secs_f32());
        
        // Finish recording and get results
        println!("\nFinalizing transcription...");
        let finish_start = Instant::now();
        let result = strategy.finish_recording().await?;
        let finish_time = finish_start.elapsed();
        
        let total_time = start.elapsed();
        
        // Print results
        println!("\nRESULTS:");
        println!("--------");
        println!("Total time: {:.2}s", total_time.as_secs_f32());
        println!("Processing time: {:.2}s", processing_time.as_secs_f32());
        println!("Finalization time: {:.2}s", finish_time.as_secs_f32());
        println!("Chunks processed: {}", result.chunks_processed);
        println!("Text length: {} characters", result.text.len());
        println!("\nFirst 200 characters of transcript:");
        println!("{}", result.text.chars().take(200).collect::<String>());
        
        // Calculate theoretical vs actual
        let expected_tiny_chunks = (duration_secs / 5.0).floor() as usize;
        let expected_medium_chunks = (duration_secs / chunk_size as f32).floor() as usize;
        
        println!("\nAnalysis:");
        println!("Expected Tiny chunks (5s): {}", expected_tiny_chunks);
        println!("Expected Medium refinements ({}s): {}", chunk_size, expected_medium_chunks);
        println!("Actual chunks processed: {}", result.chunks_processed);
    }
    
    println!("\n\nTest complete!");
    
    Ok(())
}