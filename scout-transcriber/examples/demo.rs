#!/usr/bin/env cargo +nightly -Zscript

//! Demo showing how to use the Scout Transcriber service and client
//! 
//! This example demonstrates:
//! - Creating audio chunks programmatically
//! - Using the TranscriberClient to submit work
//! - Queue operations and statistics
//! 
//! To run: cargo run --example demo

use anyhow::Result;
use scout_transcriber::{
    protocol::{AudioChunk, TranscriptMetadata},
    utils::{create_test_audio_chunk, validate_audio_chunk},
    TranscriberClient,
};
use std::time::Duration;
use tokio::time::sleep;
use tracing::{info, warn};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .with_target(false)
        .init();

    info!("Scout Transcriber Demo Starting");

    // Create a client (uses default queue paths)
    let client = TranscriberClient::new()?;

    // Clear any existing queues for clean demo
    client.clear_queues().await?;
    info!("Cleared existing queues");

    // Create some test audio chunks
    let chunks = vec![
        create_test_audio_chunk(1.0, 16000), // 1 second of 440Hz tone
        create_test_audio_chunk(2.5, 16000), // 2.5 seconds of 440Hz tone
        create_test_audio_chunk(0.8, 16000), // 0.8 seconds of 440Hz tone
    ];

    info!("Created {} test audio chunks", chunks.len());

    // Validate and submit audio chunks
    for (i, chunk) in chunks.iter().enumerate() {
        if validate_audio_chunk(chunk) {
            info!("Chunk {}: duration={:.2}s, samples={}, id={}", 
                  i + 1, chunk.duration(), chunk.audio.len(), chunk.id);
            
            // Submit for transcription
            client.transcribe(chunk.clone()).await?;
            info!("Submitted chunk {} for transcription", i + 1);
        } else {
            warn!("Invalid audio chunk {}", i + 1);
        }
    }

    // Check queue statistics
    let (input_count, output_count) = client.get_queue_stats().await?;
    info!("Queue stats: input={}, output={}", input_count, output_count);

    // Simulate waiting for processing (in a real scenario, you'd have the service running)
    info!("In a real scenario, the scout-transcriber service would process these chunks...");
    sleep(Duration::from_millis(500)).await;

    // Try to poll for results (won't have any since no service is running)
    match client.poll_results().await? {
        Some(result) => {
            match result {
                Ok(transcript) => {
                    info!("Received transcript: '{}' (confidence: {:.2})", 
                          transcript.text, transcript.confidence);
                }
                Err(error) => {
                    warn!("Transcription error: {} (code: {})", error.message, error.code);
                }
            }
        }
        None => {
            info!("No transcription results available yet");
        }
    }

    // Show how to create audio chunks with metadata
    let mut metadata_chunk = create_test_audio_chunk(1.5, 16000);
    metadata_chunk.metadata = Some({
        let mut meta = std::collections::HashMap::new();
        meta.insert("source".to_string(), "demo".to_string());
        meta.insert("speaker".to_string(), "synthetic".to_string());
        meta
    });

    info!("Created chunk with metadata: {:?}", metadata_chunk.metadata);
    client.transcribe(metadata_chunk).await?;

    // Final queue statistics
    let (input_count, output_count) = client.get_queue_stats().await?;
    info!("Final queue stats: input={}, output={}", input_count, output_count);

    info!("Demo completed successfully!");
    info!("To run the actual service, use: cargo run -- --workers 2 --log-level info");

    Ok(())
}