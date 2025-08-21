use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "transcriber")]
#[command(about = "Scout Transcriber Service", long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Start the transcriber service
    Start {
        #[arg(short, long, default_value = "whisper")]
        model: String,
        
        #[arg(short, long, default_value = "2")]
        workers: usize,
        
        #[arg(short = 'z', long)]
        zeromq: bool,
        
        #[arg(short, long)]
        daemon: bool,
        
        #[arg(long, default_value = "/tmp/transcriber.pid")]
        pid_file: PathBuf,
    },
    
    /// Stop the transcriber service
    Stop {
        #[arg(long, default_value = "/tmp/transcriber.pid")]
        pid_file: PathBuf,
    },
    
    /// Restart the transcriber service
    Restart {
        #[arg(short, long, default_value = "whisper")]
        model: String,
        
        #[arg(short, long, default_value = "2")]
        workers: usize,
        
        #[arg(short = 'z', long)]
        zeromq: bool,
    },
    
    /// Check service status
    Status {
        #[arg(long, default_value = "/tmp/transcriber.pid")]
        pid_file: PathBuf,
    },
    
    /// Run in legacy mode (no subcommand)
    #[command(hide = true)]
    Run(crate::Args),
}