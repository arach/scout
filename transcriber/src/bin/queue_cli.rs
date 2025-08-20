use anyhow::Result;
use clap::{Parser, Subcommand};
use transcriber::{
    protocol::{AudioChunk, Transcript, TranscriptionError},
    queue::{Queue, SledQueue},
};
use std::path::PathBuf;
use uuid::Uuid;

/// CLI tool for interacting with Transcriber queues
#[derive(Parser)]
#[command(name = "queue-cli")]
#[command(about = "CLI for Scout Transcriber queue operations")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Push audio to the input queue
    Push {
        /// Audio data as JSON array
        #[arg(long)]
        audio: String,
        
        /// Sample rate
        #[arg(long, default_value = "16000")]
        sample_rate: u32,
        
        /// Number of channels
        #[arg(long, default_value = "1")]
        channels: u8,
    },
    
    /// Pop from a queue
    Pop {
        /// Queue to pop from (input or output)
        #[arg(long)]
        queue: String,
    },
    
    /// List queue contents
    List {
        /// Queue to list (input or output)
        #[arg(long)]
        queue: String,
    },
    
    /// Get queue length
    Len {
        /// Queue to check (input or output)
        #[arg(long)]
        queue: String,
    },
    
    /// Clear a queue
    Clear {
        /// Queue to clear (input or output)
        #[arg(long)]
        queue: String,
    },
    
    /// Push test audio
    TestPush {
        /// Duration in seconds
        #[arg(long, default_value = "2.0")]
        duration: f32,
        
        /// Frequency in Hz
        #[arg(long, default_value = "440")]
        frequency: f32,
    },
    
    /// Wait for a specific result
    WaitResult {
        /// Chunk ID to wait for
        #[arg(long)]
        id: String,
        
        /// Timeout in seconds
        #[arg(long, default_value = "30")]
        timeout: u64,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    
    match cli.command {
        Commands::Push { audio, sample_rate, channels } => {
            let input_queue = SledQueue::<AudioChunk>::new(&PathBuf::from("/tmp/transcriber/input"))?;
            
            // Parse audio data
            let audio_data: Vec<f32> = serde_json::from_str(&audio)?;
            
            let chunk = AudioChunk::new(
                audio_data,
                sample_rate,
                channels as u16,
            );
            
            input_queue.push(&chunk).await?;
            println!("{}", serde_json::to_string(&chunk)?);
        }
        
        Commands::Pop { queue } => {
            match queue.as_str() {
                "input" => {
                    let queue = SledQueue::<AudioChunk>::new(&PathBuf::from("/tmp/transcriber/input"))?;
                    if let Some(chunk) = queue.pop().await? {
                        println!("{}", serde_json::to_string(&chunk)?);
                    } else {
                        println!("null");
                    }
                }
                "output" => {
                    let queue = SledQueue::<Result<Transcript, TranscriptionError>>::new(
                        &PathBuf::from("/tmp/transcriber/output")
                    )?;
                    if let Some(result) = queue.pop().await? {
                        match result {
                            Ok(transcript) => println!("{}", serde_json::to_string(&transcript)?),
                            Err(error) => println!("{}", serde_json::to_string(&error)?),
                        }
                    } else {
                        println!("null");
                    }
                }
                _ => eprintln!("Invalid queue: {}", queue),
            }
        }
        
        Commands::List { queue } => {
            match queue.as_str() {
                "input" => {
                    let queue = SledQueue::<AudioChunk>::new(&PathBuf::from("/tmp/transcriber/input"))?;
                    let mut items = Vec::new();
                    // Note: This is a simplified approach - in production, use proper iteration
                    while let Some(chunk) = queue.pop().await? {
                        items.push(chunk);
                    }
                    // Push them back (this changes order, but it's for debugging)
                    for item in &items {
                        queue.push(item).await?;
                    }
                    println!("{}", serde_json::to_string(&items)?);
                }
                "output" => {
                    let queue = SledQueue::<Result<Transcript, TranscriptionError>>::new(
                        &PathBuf::from("/tmp/transcriber/output")
                    )?;
                    println!("Output queue listing not fully implemented");
                }
                _ => eprintln!("Invalid queue: {}", queue),
            }
        }
        
        Commands::Len { queue } => {
            match queue.as_str() {
                "input" => {
                    let queue = SledQueue::<AudioChunk>::new(&PathBuf::from("/tmp/transcriber/input"))?;
                    println!("{}", queue.len().await?);
                }
                "output" => {
                    let queue = SledQueue::<Result<Transcript, TranscriptionError>>::new(
                        &PathBuf::from("/tmp/transcriber/output")
                    )?;
                    println!("{}", queue.len().await?);
                }
                _ => eprintln!("Invalid queue: {}", queue),
            }
        }
        
        Commands::Clear { queue } => {
            match queue.as_str() {
                "input" => {
                    let queue = SledQueue::<AudioChunk>::new(&PathBuf::from("/tmp/transcriber/input"))?;
                    queue.clear().await?;
                    println!("Input queue cleared");
                }
                "output" => {
                    let queue = SledQueue::<Result<Transcript, TranscriptionError>>::new(
                        &PathBuf::from("/tmp/transcriber/output")
                    )?;
                    queue.clear().await?;
                    println!("Output queue cleared");
                }
                _ => eprintln!("Invalid queue: {}", queue),
            }
        }
        
        Commands::TestPush { duration, frequency } => {
            let input_queue = SledQueue::<AudioChunk>::new(&PathBuf::from("/tmp/transcriber/input"))?;
            
            // Generate test audio
            let sample_rate = 16000;
            let num_samples = (duration * sample_rate as f32) as usize;
            let mut audio = Vec::with_capacity(num_samples);
            
            for i in 0..num_samples {
                let t = i as f32 / sample_rate as f32;
                let sample = (2.0 * std::f32::consts::PI * frequency * t).sin() * 0.3;
                audio.push(sample);
            }
            
            let chunk = AudioChunk::new(
                audio,
                sample_rate,
                1,
            );
            
            input_queue.push(&chunk).await?;
            println!("{}", serde_json::to_string(&chunk)?);
        }
        
        Commands::WaitResult { id, timeout } => {
            let chunk_id = Uuid::parse_str(&id)?;
            let output_queue = SledQueue::<Result<Transcript, TranscriptionError>>::new(
                &PathBuf::from("/tmp/transcriber/output")
            )?;
            
            let start = std::time::Instant::now();
            let timeout_duration = std::time::Duration::from_secs(timeout);
            
            loop {
                if let Some(result) = output_queue.pop().await? {
                    match result {
                        Ok(transcript) if transcript.id == chunk_id => {
                            println!("{}", serde_json::to_string(&transcript)?);
                            break;
                        }
                        Err(error) if error.id == chunk_id => {
                            println!("{}", serde_json::to_string(&error)?);
                            break;
                        }
                        other => {
                            // Not our result, push it back
                            output_queue.push(&other).await?;
                        }
                    }
                }
                
                if start.elapsed() > timeout_duration {
                    println!("null");
                    break;
                }
                
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        }
    }
    
    Ok(())
}