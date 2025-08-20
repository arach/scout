use anyhow::{Context, Result};
use clap::{Parser, ValueEnum};
use scout_transcriber::{
    protocol::{AudioChunk, Transcript, TranscriptionError},
    queue::{Queue, SledQueue},
    tracker::{MessageTracker, MessageTrackerStats},
    worker::{WorkerConfig, WorkerPool},
};

#[cfg(feature = "zeromq-queue")]
use scout_transcriber::queue::{ZmqQueue, ZmqQueueConfig};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::signal;
use tokio::sync::broadcast;
use tokio::time::interval;
use tracing::{debug, error, info, warn};

#[derive(Parser)]
#[command(name = "scout-transcriber")]
#[command(about = "A standalone transcription service using Python workers")]
#[command(version = env!("CARGO_PKG_VERSION"))]
pub struct Args {
    /// Input queue directory path
    #[arg(long, default_value = "/tmp/scout-transcriber/input")]
    pub input_queue: PathBuf,

    /// Output queue directory path
    #[arg(long, default_value = "/tmp/scout-transcriber/output")]
    pub output_queue: PathBuf,

    /// Number of Python worker processes
    #[arg(long, default_value = "2")]
    pub workers: usize,

    /// Python command to use (e.g., 'python', 'uv')
    #[arg(long, default_value = "uv")]
    pub python_cmd: String,

    /// Python script arguments
    #[arg(long, default_value = "run python/transcriber.py")]
    pub python_args: String,

    /// Working directory for Python processes
    #[arg(long)]
    pub python_workdir: Option<PathBuf>,

    /// Log level
    #[arg(long, value_enum, default_value = "info")]
    pub log_level: LogLevel,

    /// Maximum restart attempts per worker
    #[arg(long, default_value = "10")]
    pub max_restarts: u32,

    /// Heartbeat interval in seconds
    #[arg(long, default_value = "30")]
    pub heartbeat_interval: u64,

    /// Response timeout in seconds
    #[arg(long, default_value = "30")]
    pub response_timeout: u64,

    /// Queue processing interval in milliseconds
    #[arg(long, default_value = "100")]
    pub poll_interval: u64,

    /// Enable queue persistence (disable for in-memory queues)
    #[arg(long, default_value = "true")]
    pub persistent_queues: bool,

    /// ZeroMQ push endpoint for input queue
    #[cfg(feature = "zeromq-queue")]
    #[arg(long, default_value = "tcp://127.0.0.1:5555")]
    pub zmq_push_endpoint: String,

    /// ZeroMQ pull endpoint for output queue  
    #[cfg(feature = "zeromq-queue")]
    #[arg(long, default_value = "tcp://127.0.0.1:5556")]
    pub zmq_pull_endpoint: String,

    /// Use ZeroMQ queues instead of Sled
    #[cfg(feature = "zeromq-queue")]
    #[arg(long, default_value = "false")]
    pub use_zeromq: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, ValueEnum, Debug)]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

impl From<LogLevel> for tracing::Level {
    fn from(level: LogLevel) -> Self {
        match level {
            LogLevel::Trace => tracing::Level::TRACE,
            LogLevel::Debug => tracing::Level::DEBUG,
            LogLevel::Info => tracing::Level::INFO,
            LogLevel::Warn => tracing::Level::WARN,
            LogLevel::Error => tracing::Level::ERROR,
        }
    }
}

/// Queue type enumeration to support different queue implementations
#[derive(Clone)]
pub enum QueueType<T> {
    Sled(SledQueue<T>),
    #[cfg(feature = "zeromq-queue")]
    ZeroMQ(ZmqQueue<T>),
}

impl<T> QueueType<T>
where
    T: serde::Serialize + serde::de::DeserializeOwned + Clone + Send + Sync + 'static,
{
    /// Push an item to the queue
    pub async fn push(&self, item: &T) -> Result<()> {
        match self {
            QueueType::Sled(queue) => queue.push(item).await,
            #[cfg(feature = "zeromq-queue")]
            QueueType::ZeroMQ(queue) => queue.push(item).await,
        }
    }

    /// Pop an item from the queue
    pub async fn pop(&self) -> Result<Option<T>> {
        match self {
            QueueType::Sled(queue) => queue.pop().await,
            #[cfg(feature = "zeromq-queue")]
            QueueType::ZeroMQ(queue) => queue.pop().await,
        }
    }

    /// Get an item by ID without removing it
    pub async fn get(&self, id: &uuid::Uuid) -> Result<Option<T>> {
        match self {
            QueueType::Sled(queue) => queue.get(id).await,
            #[cfg(feature = "zeromq-queue")]
            QueueType::ZeroMQ(queue) => queue.get(id).await,
        }
    }

    /// Remove an item by ID
    pub async fn remove(&self, id: &uuid::Uuid) -> Result<bool> {
        match self {
            QueueType::Sled(queue) => queue.remove(id).await,
            #[cfg(feature = "zeromq-queue")]
            QueueType::ZeroMQ(queue) => queue.remove(id).await,
        }
    }

    /// Get the current queue length
    pub async fn len(&self) -> Result<usize> {
        match self {
            QueueType::Sled(queue) => queue.len().await,
            #[cfg(feature = "zeromq-queue")]
            QueueType::ZeroMQ(queue) => queue.len().await,
        }
    }

    /// Check if the queue is empty
    pub async fn is_empty(&self) -> Result<bool> {
        match self {
            QueueType::Sled(queue) => queue.is_empty().await,
            #[cfg(feature = "zeromq-queue")]
            QueueType::ZeroMQ(queue) => queue.is_empty().await,
        }
    }

    /// Clear all items from the queue
    pub async fn clear(&self) -> Result<()> {
        match self {
            QueueType::Sled(queue) => queue.clear().await,
            #[cfg(feature = "zeromq-queue")]
            QueueType::ZeroMQ(queue) => queue.clear().await,
        }
    }
}

/// Main transcription service
pub struct TranscriptionService {
    input_queue: QueueType<AudioChunk>,
    output_queue: QueueType<Result<Transcript, TranscriptionError>>,
    worker_pool: WorkerPool,
    message_tracker: Arc<MessageTracker>,
    running: Arc<AtomicBool>,
    shutdown_tx: broadcast::Sender<()>,
    args: Args,
}

impl TranscriptionService {
    /// Create a new transcription service with the given arguments
    pub async fn new(args: Args) -> Result<Self> {
        // Create queue directories if they don't exist
        if args.persistent_queues {
            if let Some(parent) = args.input_queue.parent() {
                tokio::fs::create_dir_all(parent).await
                    .context("Failed to create input queue directory")?;
            }
            if let Some(parent) = args.output_queue.parent() {
                tokio::fs::create_dir_all(parent).await
                    .context("Failed to create output queue directory")?;
            }
        }

        // Create queues based on configuration
        #[cfg(feature = "zeromq-queue")]
        let (input_queue, output_queue) = if args.use_zeromq {
            info!("Using ZeroMQ queues");
            
            // For the service:
            // Input queue: PULL socket binds to 5555 (receives from clients)
            // Output queue: PUSH socket binds to 5556 (sends to clients)
            let input_config = ZmqQueueConfig {
                push_endpoint: args.zmq_push_endpoint.clone(),  // Where to receive (bind PULL)
                pull_endpoint: "tcp://127.0.0.1:15555".to_string(),  // Not used in server mode
                ..Default::default()
            };
            
            let output_config = ZmqQueueConfig {
                push_endpoint: "tcp://127.0.0.1:15556".to_string(),  // Not used in server mode  
                pull_endpoint: args.zmq_pull_endpoint.clone(),  // Where to send (bind PUSH)
                ..Default::default()
            };

            let input_queue = ZmqQueue::with_config_server(input_config).await
                .context("Failed to create ZeroMQ input queue")?;
            
            let output_queue = ZmqQueue::with_config_server(output_config).await
                .context("Failed to create ZeroMQ output queue")?;

            (QueueType::ZeroMQ(input_queue), QueueType::ZeroMQ(output_queue))
        } else {
            info!("Using Sled queues");
            
            let input_queue = if args.persistent_queues {
                SledQueue::new(&args.input_queue)
                    .context("Failed to create input queue")?
            } else {
                SledQueue::new_temp()
                    .context("Failed to create temporary input queue")?
            };

            let output_queue = if args.persistent_queues {
                SledQueue::new(&args.output_queue)
                    .context("Failed to create output queue")?
            } else {
                SledQueue::new_temp()
                    .context("Failed to create temporary output queue")?
            };

            (QueueType::Sled(input_queue), QueueType::Sled(output_queue))
        };

        #[cfg(not(feature = "zeromq-queue"))]
        let (input_queue, output_queue) = {
            info!("Using Sled queues (ZeroMQ feature not enabled)");
            
            let input_queue = if args.persistent_queues {
                SledQueue::new(&args.input_queue)
                    .context("Failed to create input queue")?
            } else {
                SledQueue::new_temp()
                    .context("Failed to create temporary input queue")?
            };

            let output_queue = if args.persistent_queues {
                SledQueue::new(&args.output_queue)
                    .context("Failed to create output queue")?
            } else {
                SledQueue::new_temp()
                    .context("Failed to create temporary output queue")?
            };

            (QueueType::Sled(input_queue), QueueType::Sled(output_queue))
        };

        // Parse Python arguments
        let python_args: Vec<String> = args.python_args
            .split_whitespace()
            .map(|s| s.to_string())
            .collect();

        // Create worker configuration
        let worker_config = WorkerConfig {
            python_command: args.python_cmd.clone(),
            script_args: python_args,
            working_dir: args.python_workdir.as_ref().map(|p| p.to_string_lossy().to_string()),
            env_vars: Vec::new(),
            max_restarts: args.max_restarts,
            initial_backoff: Duration::from_secs(1),
            max_backoff: Duration::from_secs(60),
            heartbeat_interval: Duration::from_secs(args.heartbeat_interval),
            response_timeout: Duration::from_secs(args.response_timeout),
        };

        // Create worker pool
        let worker_pool = WorkerPool::new(args.workers, worker_config);

        // Create message tracker for monitoring
        let message_tracker = Arc::new(MessageTracker::new(
            args.max_restarts as u32,
            args.response_timeout,
        ));

        let (shutdown_tx, _) = broadcast::channel(1);

        Ok(Self {
            input_queue,
            output_queue,
            worker_pool,
            message_tracker,
            running: Arc::new(AtomicBool::new(false)),
            shutdown_tx,
            args,
        })
    }

    /// Start the transcription service
    pub async fn start(&self) -> Result<()> {
        if self.running.load(Ordering::Relaxed) {
            warn!("Service is already running");
            return Ok(());
        }

        info!("Starting transcription service with {} workers", self.args.workers);

        // Start workers
        if !self.args.use_zeromq {
            // Traditional stdin/stdout workers
            self.worker_pool.start().await
                .context("Failed to start worker pool")?;
        } else {
            // ZeroMQ workers that connect directly to queues
            info!("Starting ZeroMQ workers that connect directly to queues");
            info!("  - Workers PULL from tcp://127.0.0.1:5555");
            info!("  - Workers PUSH to tcp://127.0.0.1:5556");
            
            // Spawn ZeroMQ workers
            self.spawn_zeromq_workers().await
                .context("Failed to spawn ZeroMQ workers")?;
        }

        // Mark as running
        self.running.store(true, Ordering::Relaxed);

        // Start queue processing loop
        let processing_handle = self.spawn_processing_loop();

        // Start statistics reporting
        let stats_handle = self.spawn_stats_reporter();

        // Start health monitoring
        let health_handle = self.spawn_health_monitor();

        info!("Transcription service started successfully");

        // Wait for shutdown signal
        let shutdown_result = {
            let mut shutdown_rx = self.shutdown_tx.subscribe();
            tokio::select! {
                _ = signal::ctrl_c() => {
                    info!("Received Ctrl+C signal");
                    Ok(())
                }
                _ = self.wait_for_term_signal() => {
                    info!("Received TERM signal");
                    Ok(())
                }
                _ = shutdown_rx.recv() => {
                    info!("Received internal shutdown signal");
                    Ok(())
                }
            }
        };

        // Stop processing
        processing_handle.abort();
        stats_handle.abort();
        health_handle.abort();

        // Stop worker pool only if not using ZeroMQ
        if !self.args.use_zeromq {
            self.worker_pool.stop().await
                .context("Failed to stop worker pool")?;
        }

        // Mark as stopped
        self.running.store(false, Ordering::Relaxed);

        info!("Transcription service stopped");
        shutdown_result
    }

    /// Check if the service is running
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    /// Stop the service gracefully
    pub async fn stop(&self) -> Result<()> {
        if !self.is_running() {
            return Ok(());
        }

        info!("Stopping transcription service");
        let _ = self.shutdown_tx.send(());
        Ok(())
    }

    /// Spawn the main queue processing loop
    fn spawn_processing_loop(&self) -> tokio::task::JoinHandle<()> {
        let input_queue = self.input_queue.clone();
        let output_queue = self.output_queue.clone();
        let worker_pool = self.worker_pool.clone();
        let message_tracker = Arc::clone(&self.message_tracker);
        let running = Arc::clone(&self.running);
        let mut shutdown_rx = self.shutdown_tx.subscribe();
        let poll_interval = Duration::from_millis(self.args.poll_interval);
        let use_zeromq = self.args.use_zeromq;

        tokio::spawn(async move {
            let mut interval = interval(poll_interval);

            while running.load(Ordering::Relaxed) {
                interval.tick().await;

                // Check for shutdown signal
                if shutdown_rx.try_recv().is_ok() {
                    break;
                }

                if use_zeromq {
                    // In ZeroMQ mode, monitor messages and track their lifecycle
                    Self::monitor_zeromq_queues(&input_queue, &output_queue, &message_tracker).await;
                } else {
                    // Process input queue for stdin/stdout workers
                    match Self::process_input_queue(&input_queue, &worker_pool).await {
                        Ok(processed) => {
                            if processed > 0 {
                                debug!("Processed {} items from input queue", processed);
                            }
                        }
                        Err(e) => {
                            error!("Error processing input queue: {}", e);
                        }
                    }
                }

                // Small delay to prevent busy waiting
                if !running.load(Ordering::Relaxed) {
                    break;
                }
            }

            info!("Queue processing loop ended");
        })
    }

    /// Spawn ZeroMQ workers that connect directly to the queues
    async fn spawn_zeromq_workers(&self) -> Result<()> {
        use tokio::process::Command;
        use uuid::Uuid;
        
        for i in 0..self.args.workers {
            let worker_id = Uuid::new_v4().to_string();
            let mut cmd = Command::new(&self.args.python_cmd);
            
            // Use zmq_worker.py for ZeroMQ mode
            cmd.arg("run");
            cmd.arg("python/zmq_worker.py");
            cmd.arg("--input");
            cmd.arg(&self.args.zmq_push_endpoint);
            cmd.arg("--output");
            cmd.arg(&self.args.zmq_pull_endpoint);
            cmd.arg("--worker-id");
            cmd.arg(&worker_id);
            cmd.arg("--log-level");
            cmd.arg("INFO");
            
            // Set working directory if specified
            if let Some(ref workdir) = self.args.python_workdir {
                cmd.current_dir(workdir);
            }
            
            // Spawn the worker
            let child = cmd.spawn()
                .with_context(|| format!("Failed to spawn ZeroMQ worker {}", i))?;
            
            info!("Spawned ZeroMQ worker {} with ID {} (PID: {:?})", i, worker_id, child.id());
            
            // Store the process handle for later management
            // For now, we just let them run independently
            // TODO: Track and manage ZeroMQ worker processes
        }
        
        Ok(())
    }

    /// Monitor ZeroMQ queues and track message lifecycle
    async fn monitor_zeromq_queues(
        input_queue: &QueueType<AudioChunk>,
        output_queue: &QueueType<Result<Transcript, TranscriptionError>>,
        tracker: &Arc<MessageTracker>,
    ) {
        // Monitor for new messages in input queue (without consuming)
        // This is a monitoring-only operation - workers pull messages directly
        
        // Check for timed out messages
        let timed_out = tracker.check_timeouts().await;
        for message_id in timed_out {
            if let Ok(can_retry) = tracker.handle_timeout(message_id).await {
                if can_retry {
                    info!("Message {} will be retried after timeout", message_id);
                    // In ZeroMQ mode, the message stays in the queue for another worker to pick up
                } else {
                    error!("Message {} permanently failed after timeout", message_id);
                    // TODO: Move to dead letter queue
                }
            }
        }
        
        // Clean up old completed messages
        tracker.cleanup_old_messages(300).await; // 5 minutes
        
        // Log current tracking stats periodically
        static mut LAST_STATS_LOG: Option<std::time::Instant> = None;
        unsafe {
            if LAST_STATS_LOG.is_none() || LAST_STATS_LOG.unwrap().elapsed() > Duration::from_secs(30) {
                let stats = tracker.get_stats().await;
                if stats.total > 0 {
                    info!("Message tracker: {}", stats);
                }
                LAST_STATS_LOG = Some(std::time::Instant::now());
            }
        }
    }

    /// Process items from the input queue
    async fn process_input_queue(
        input_queue: &QueueType<AudioChunk>,
        worker_pool: &WorkerPool,
    ) -> Result<usize> {
        let mut processed = 0;

        // Process up to 10 items at a time to avoid blocking
        for _ in 0..10 {
            if let Some(audio_chunk) = input_queue.pop().await? {
                debug!("Processing audio chunk {} (duration: {:.2}s)", 
                       audio_chunk.id, audio_chunk.duration());

                // Send to worker pool
                if let Err(e) = worker_pool.transcribe(audio_chunk.clone()).await {
                    error!("Failed to send audio chunk {} to workers: {}", audio_chunk.id, e);
                    
                    // Create error result and push to output queue
                    let _error = TranscriptionError::new(
                        audio_chunk.id,
                        format!("Worker processing failed: {}", e),
                        "WORKER_ERROR".to_string(),
                    );
                    
                    // Note: In a real implementation, you'd need to handle worker responses
                    // and push results to the output queue. This is a simplified version.
                }

                processed += 1;
            } else {
                // No more items to process
                break;
            }
        }

        Ok(processed)
    }

    /// Spawn the statistics reporter
    fn spawn_stats_reporter(&self) -> tokio::task::JoinHandle<()> {
        let worker_pool = self.worker_pool.clone();
        let input_queue = self.input_queue.clone();
        let output_queue = self.output_queue.clone();
        let message_tracker = Arc::clone(&self.message_tracker);
        let running = Arc::clone(&self.running);
        let mut shutdown_rx = self.shutdown_tx.subscribe();
        let use_zeromq = self.args.use_zeromq;

        tokio::spawn(async move {
            let mut interval = interval(Duration::from_secs(60)); // Report every minute

            while running.load(Ordering::Relaxed) {
                interval.tick().await;

                // Check for shutdown signal
                if shutdown_rx.try_recv().is_ok() {
                    break;
                }

                // Gather statistics
                if use_zeromq {
                    // Include message tracker stats for ZeroMQ mode
                    let tracker_stats = message_tracker.get_stats().await;
                    info!("ZeroMQ tracker stats: {}", tracker_stats);
                }
                
                match Self::gather_stats(&input_queue, &output_queue, &worker_pool).await {
                    Ok(stats) => {
                        info!("Service stats: {}", stats);
                    }
                    Err(e) => {
                        error!("Failed to gather statistics: {}", e);
                    }
                }
            }

            info!("Statistics reporter ended");
        })
    }

    /// Gather service statistics
    async fn gather_stats(
        input_queue: &QueueType<AudioChunk>,
        output_queue: &QueueType<Result<Transcript, TranscriptionError>>,
        worker_pool: &WorkerPool,
    ) -> Result<String> {
        let input_len = input_queue.len().await?;
        let output_len = output_queue.len().await?;
        let worker_stats = worker_pool.get_stats().await;
        
        let total_requests: u64 = worker_stats.iter().map(|s| s.total_requests).sum();
        let successful_requests: u64 = worker_stats.iter().map(|s| s.successful_requests).sum();
        let failed_requests: u64 = worker_stats.iter().map(|s| s.failed_requests).sum();
        
        Ok(format!(
            "input_queue={}, output_queue={}, total_requests={}, successful={}, failed={}, workers={}",
            input_len, output_len, total_requests, successful_requests, failed_requests, worker_stats.len()
        ))
    }

    /// Spawn the health monitor
    fn spawn_health_monitor(&self) -> tokio::task::JoinHandle<()> {
        let worker_pool = self.worker_pool.clone();
        let running = Arc::clone(&self.running);
        let mut shutdown_rx = self.shutdown_tx.subscribe();

        tokio::spawn(async move {
            let mut interval = interval(Duration::from_secs(30)); // Check every 30 seconds

            while running.load(Ordering::Relaxed) {
                interval.tick().await;

                // Check for shutdown signal
                if shutdown_rx.try_recv().is_ok() {
                    break;
                }

                // Check worker health
                let health_statuses = worker_pool.get_health().await;
                for status in health_statuses {
                    if !status.healthy {
                        warn!("Worker {} is unhealthy", status.worker_id);
                    } else {
                        debug!("Worker {} is healthy", status.worker_id);
                    }
                }
            }

            info!("Health monitor ended");
        })
    }


    /// Wait for TERM signal (Unix only)
    #[cfg(unix)]
    async fn wait_for_term_signal(&self) {
        use tokio::signal::unix::{signal, SignalKind};
        if let Ok(mut stream) = signal(SignalKind::terminate()) {
            stream.recv().await;
        }
    }

    #[cfg(not(unix))]
    async fn wait_for_term_signal(&self) {
        // On non-Unix systems, just wait indefinitely
        futures::future::pending::<()>().await;
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    // Initialize logging
    let log_level: tracing::Level = args.log_level.into();
    tracing_subscriber::fmt()
        .with_max_level(log_level)
        .with_target(false)
        .init();

    info!("Starting Scout Transcriber v{}", env!("CARGO_PKG_VERSION"));
    info!("Configuration:");
    info!("  Input queue: {}", args.input_queue.display());
    info!("  Output queue: {}", args.output_queue.display());
    info!("  Workers: {}", args.workers);
    info!("  Python command: {}", args.python_cmd);
    info!("  Python args: {}", args.python_args);
    info!("  Log level: {:?}", args.log_level);

    // Create and start the service
    let service = TranscriptionService::new(args).await
        .context("Failed to create transcription service")?;

    // Run the service
    if let Err(e) = service.start().await {
        error!("Service error: {}", e);
        return Err(e);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_args_parsing() {
        let args = Args::parse_from(&[
            "scout-transcriber",
            "--workers", "4",
            "--python-cmd", "python3",
            "--log-level", "debug"
        ]);

        assert_eq!(args.workers, 4);
        assert_eq!(args.python_cmd, "python3");
        assert!(matches!(args.log_level, LogLevel::Debug));
    }

    #[tokio::test]
    async fn test_service_creation() {
        let temp_dir = TempDir::new().unwrap();
        let input_path = temp_dir.path().join("input");
        let output_path = temp_dir.path().join("output");

        let args = Args {
            input_queue: input_path,
            output_queue: output_path,
            workers: 1,
            python_cmd: "echo".to_string(),
            python_args: "test".to_string(),
            python_workdir: None,
            log_level: LogLevel::Info,
            max_restarts: 5,
            heartbeat_interval: 10,
            response_timeout: 5,
            poll_interval: 50,
            persistent_queues: false, // Use in-memory for tests
            #[cfg(feature = "zeromq-queue")]
            zmq_push_endpoint: "tcp://127.0.0.1:5555".to_string(),
            #[cfg(feature = "zeromq-queue")]
            zmq_pull_endpoint: "tcp://127.0.0.1:5556".to_string(),
            #[cfg(feature = "zeromq-queue")]
            use_zeromq: false,
        };

        let service = TranscriptionService::new(args).await.unwrap();
        assert!(!service.is_running());
    }
}