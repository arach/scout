use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader, BufWriter};
use tokio::process::{Child, Command};
use tokio::sync::{broadcast, mpsc, RwLock};
use tokio::time::{interval, sleep, Instant};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::protocol::{AudioChunk, HealthStatus, Transcript, TranscriptionError};

/// Configuration for the Python worker
#[derive(Debug, Clone)]
pub struct WorkerConfig {
    /// Python executable path (defaults to "uv")
    pub python_command: String,
    /// Script arguments to pass to uv run
    pub script_args: Vec<String>,
    /// Working directory for the process
    pub working_dir: Option<String>,
    /// Environment variables
    pub env_vars: Vec<(String, String)>,
    /// Maximum number of restart attempts
    pub max_restarts: u32,
    /// Initial backoff duration for restarts
    pub initial_backoff: Duration,
    /// Maximum backoff duration
    pub max_backoff: Duration,
    /// Heartbeat interval
    pub heartbeat_interval: Duration,
    /// Timeout for worker responses
    pub response_timeout: Duration,
}

impl Default for WorkerConfig {
    fn default() -> Self {
        Self {
            python_command: "uv".to_string(),
            script_args: vec!["run".to_string(), "python/transcriber.py".to_string()],
            working_dir: None,
            env_vars: Vec::new(),
            max_restarts: 10,
            initial_backoff: Duration::from_secs(1),
            max_backoff: Duration::from_secs(60),
            heartbeat_interval: Duration::from_secs(30),
            response_timeout: Duration::from_secs(30),
        }
    }
}

/// Statistics for worker performance monitoring
#[derive(Debug, Clone, Default)]
pub struct WorkerStats {
    pub total_requests: u64,
    pub successful_requests: u64,
    pub failed_requests: u64,
    pub restart_count: u32,
    pub average_response_time_ms: f64,
    pub last_heartbeat: Option<DateTime<Utc>>,
    pub uptime_seconds: u64,
}

/// Python worker manager that handles subprocess lifecycle
pub struct PythonWorker {
    config: WorkerConfig,
    process: Arc<RwLock<Option<Child>>>,
    stats: Arc<RwLock<WorkerStats>>,
    is_running: Arc<AtomicBool>,
    restart_count: Arc<AtomicU64>,
    
    // Communication channels
    input_tx: mpsc::Sender<AudioChunk>,
    output_rx: Arc<RwLock<Option<mpsc::Receiver<Result<Transcript, TranscriptionError>>>>>,
    shutdown_tx: broadcast::Sender<()>,
    
    // Worker identification
    worker_id: String,
    start_time: Instant,
}

impl PythonWorker {
    /// Create a new Python worker with the given configuration
    pub fn new(config: WorkerConfig) -> Self {
        let (input_tx, _) = mpsc::channel(1000);
        let (shutdown_tx, _) = broadcast::channel(1);
        
        Self {
            config,
            process: Arc::new(RwLock::new(None)),
            stats: Arc::new(RwLock::new(WorkerStats::default())),
            is_running: Arc::new(AtomicBool::new(false)),
            restart_count: Arc::new(AtomicU64::new(0)),
            input_tx,
            output_rx: Arc::new(RwLock::new(None)),
            shutdown_tx,
            worker_id: Uuid::new_v4().to_string(),
            start_time: Instant::now(),
        }
    }
    
    /// Start the Python worker process and communication handlers
    pub async fn start(&self) -> Result<()> {
        if self.is_running.load(Ordering::Relaxed) {
            warn!("Worker {} is already running", self.worker_id);
            return Ok(());
        }
        
        info!("Starting Python worker {}", self.worker_id);
        
        // Start the main worker loop
        let _worker_handle = self.spawn_worker_loop();
        let _heartbeat_handle = self.spawn_heartbeat_monitor();
        
        // Mark as running
        self.is_running.store(true, Ordering::Relaxed);
        
        // Wait for initial startup
        sleep(Duration::from_millis(100)).await;
        
        info!("Python worker {} started successfully", self.worker_id);
        Ok(())
    }
    
    /// Stop the Python worker gracefully
    pub async fn stop(&self) -> Result<()> {
        if !self.is_running.load(Ordering::Relaxed) {
            return Ok(());
        }
        
        info!("Stopping Python worker {}", self.worker_id);
        
        // Signal shutdown
        let _ = self.shutdown_tx.send(());
        self.is_running.store(false, Ordering::Relaxed);
        
        // Kill the process if it exists
        if let Some(mut process) = self.process.write().await.take() {
            if let Err(e) = process.kill().await {
                error!("Failed to kill Python process: {}", e);
            } else {
                debug!("Python process killed successfully");
            }
        }
        
        info!("Python worker {} stopped", self.worker_id);
        Ok(())
    }
    
    /// Send an audio chunk for transcription
    pub async fn transcribe(&self, audio_chunk: AudioChunk) -> Result<()> {
        if !self.is_running.load(Ordering::Relaxed) {
            return Err(anyhow::anyhow!("Worker is not running"));
        }
        
        self.input_tx.send(audio_chunk).await
            .context("Failed to send audio chunk to worker")?;
        
        // Update stats
        let mut stats = self.stats.write().await;
        stats.total_requests += 1;
        
        Ok(())
    }
    
    /// Get worker statistics
    pub async fn get_stats(&self) -> WorkerStats {
        let mut stats = self.stats.read().await.clone();
        stats.uptime_seconds = self.start_time.elapsed().as_secs();
        stats
    }
    
    /// Get worker health status
    pub async fn get_health(&self) -> HealthStatus {
        let stats = self.get_stats().await;
        let healthy = self.is_running.load(Ordering::Relaxed) && stats.last_heartbeat.is_some();
        
        let mut status = HealthStatus::new(self.worker_id.clone(), healthy);
        status.last_heartbeat = stats.last_heartbeat.unwrap_or_else(Utc::now);
        
        status
    }
    
    /// Get the worker ID
    pub fn id(&self) -> &str {
        &self.worker_id
    }
    
    /// Check if the worker is running
    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::Relaxed)
    }
    
    /// Spawn the main worker loop
    fn spawn_worker_loop(&self) -> tokio::task::JoinHandle<()> {
        let config = self.config.clone();
        let process = Arc::clone(&self.process);
        let stats = Arc::clone(&self.stats);
        let is_running = Arc::clone(&self.is_running);
        let restart_count = Arc::clone(&self.restart_count);
        let mut shutdown_rx = self.shutdown_tx.subscribe();
        let worker_id = self.worker_id.clone();
        
        tokio::spawn(async move {
            let mut backoff = config.initial_backoff;
            
            loop {
                if !is_running.load(Ordering::Relaxed) {
                    break;
                }
                
                // Check for shutdown signal
                if shutdown_rx.try_recv().is_ok() {
                    break;
                }
                
                match spawn_python_process(&config).await {
                    Ok(child) => {
                        info!("Python process spawned successfully for worker {}", worker_id);
                        *process.write().await = Some(child);
                        
                        // Reset backoff on successful start
                        backoff = config.initial_backoff;
                        
                        // Monitor the process
                        if let Err(e) = monitor_process(&process, &stats).await {
                            error!("Process monitoring failed for worker {}: {}", worker_id, e);
                        }
                    }
                    Err(e) => {
                        error!("Failed to spawn Python process for worker {}: {}", worker_id, e);
                    }
                }
                
                let current_restarts = restart_count.fetch_add(1, Ordering::Relaxed);
                if current_restarts >= config.max_restarts as u64 {
                    error!("Max restarts ({}) exceeded for worker {}", config.max_restarts, worker_id);
                    is_running.store(false, Ordering::Relaxed);
                    break;
                }
                
                info!("Restarting worker {} in {:?} (attempt {})", worker_id, backoff, current_restarts + 1);
                sleep(backoff).await;
                
                // Exponential backoff
                backoff = std::cmp::min(backoff * 2, config.max_backoff);
            }
            
            info!("Worker loop ended for worker {}", worker_id);
        })
    }
    
    /// Spawn the heartbeat monitor
    fn spawn_heartbeat_monitor(&self) -> tokio::task::JoinHandle<()> {
        let stats = Arc::clone(&self.stats);
        let is_running = Arc::clone(&self.is_running);
        let mut shutdown_rx = self.shutdown_tx.subscribe();
        let heartbeat_interval = self.config.heartbeat_interval;
        let worker_id = self.worker_id.clone();
        
        tokio::spawn(async move {
            let mut interval = interval(heartbeat_interval);
            
            loop {
                interval.tick().await;
                
                if !is_running.load(Ordering::Relaxed) {
                    break;
                }
                
                // Check for shutdown signal
                if shutdown_rx.try_recv().is_ok() {
                    break;
                }
                
                // Update heartbeat timestamp
                {
                    let mut stats = stats.write().await;
                    stats.last_heartbeat = Some(Utc::now());
                }
                
                debug!("Heartbeat sent for worker {}", worker_id);
            }
        })
    }
}

/// Spawn a new Python process with the given configuration
async fn spawn_python_process(config: &WorkerConfig) -> Result<Child> {
    let mut cmd = Command::new(&config.python_command);
    
    // Add script arguments
    cmd.args(&config.script_args);
    
    // Set working directory if specified
    if let Some(ref dir) = config.working_dir {
        cmd.current_dir(dir);
    }
    
    // Add environment variables
    for (key, value) in &config.env_vars {
        cmd.env(key, value);
    }
    
    // Configure stdio for communication
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    
    let child = cmd.spawn()
        .context("Failed to spawn Python process")?;
    
    debug!("Python process spawned with PID: {:?}", child.id());
    Ok(child)
}

/// Monitor a running Python process
async fn monitor_process(
    process: &Arc<RwLock<Option<Child>>>,
    stats: &Arc<RwLock<WorkerStats>>,
) -> Result<()> {
    let mut process_guard = process.write().await;
    
    if let Some(ref mut child) = *process_guard {
        // Set up communication channels
        let stdin = child.stdin.take()
            .ok_or_else(|| anyhow::anyhow!("Failed to get stdin"))?;
        let stdout = child.stdout.take()
            .ok_or_else(|| anyhow::anyhow!("Failed to get stdout"))?;
        let stderr = child.stderr.take()
            .ok_or_else(|| anyhow::anyhow!("Failed to get stderr"))?;
        
        let mut stdout_reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();
        let _stdin_writer = BufWriter::new(stdin);
        
        // Monitor stdout and stderr
        let stdout_handle = tokio::spawn(async move {
            while let Ok(Some(line)) = stdout_reader.next_line().await {
                debug!("Python stdout: {}", line);
                
                // Try to parse as MessagePack transcript result
                if let Ok(bytes) = hex::decode(&line) {
                    if let Ok(transcript) = Transcript::from_bytes(&bytes) {
                        info!("Received transcript: {:?}", transcript.text);
                    }
                }
            }
        });
        
        let stderr_handle = tokio::spawn(async move {
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                warn!("Python stderr: {}", line);
            }
        });
        
        // Wait for process to exit
        let status = child.wait().await?;
        
        // Cancel monitoring tasks
        stdout_handle.abort();
        stderr_handle.abort();
        
        info!("Python process exited with status: {}", status);
        
        if !status.success() {
            let mut stats = stats.write().await;
            stats.failed_requests += 1;
        }
    }
    
    Ok(())
}

/// Manager for multiple Python workers
#[derive(Clone)]
pub struct WorkerPool {
    workers: Arc<Vec<PythonWorker>>,
    next_worker: Arc<AtomicU64>,
}

impl WorkerPool {
    /// Create a new worker pool with the specified number of workers
    pub fn new(worker_count: usize, config: WorkerConfig) -> Self {
        let workers = (0..worker_count)
            .map(|_| PythonWorker::new(config.clone()))
            .collect();
        
        Self {
            workers: Arc::new(workers),
            next_worker: Arc::new(AtomicU64::new(0)),
        }
    }
    
    /// Start all workers in the pool
    pub async fn start(&self) -> Result<()> {
        for worker in self.workers.iter() {
            worker.start().await?;
        }
        Ok(())
    }
    
    /// Stop all workers in the pool
    pub async fn stop(&self) -> Result<()> {
        for worker in self.workers.iter() {
            worker.stop().await?;
        }
        Ok(())
    }
    
    /// Get the next worker using round-robin scheduling
    pub fn next_worker(&self) -> &PythonWorker {
        let index = self.next_worker.fetch_add(1, Ordering::Relaxed) as usize % self.workers.len();
        &self.workers[index]
    }
    
    /// Send an audio chunk to the next available worker
    pub async fn transcribe(&self, audio_chunk: AudioChunk) -> Result<()> {
        let worker = self.next_worker();
        worker.transcribe(audio_chunk).await
    }
    
    /// Get combined statistics for all workers
    pub async fn get_stats(&self) -> Vec<WorkerStats> {
        let mut stats = Vec::new();
        for worker in self.workers.iter() {
            stats.push(worker.get_stats().await);
        }
        stats
    }
    
    /// Get health status for all workers
    pub async fn get_health(&self) -> Vec<HealthStatus> {
        let mut health = Vec::new();
        for worker in self.workers.iter() {
            health.push(worker.get_health().await);
        }
        health
    }
    
    /// Get the number of workers in the pool
    pub fn size(&self) -> usize {
        self.workers.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    
    #[test]
    fn test_worker_config_default() {
        let config = WorkerConfig::default();
        assert_eq!(config.python_command, "uv");
        assert_eq!(config.script_args, vec!["run", "main.py"]);
        assert_eq!(config.max_restarts, 10);
    }
    
    #[tokio::test]
    async fn test_worker_creation() {
        let config = WorkerConfig::default();
        let worker = PythonWorker::new(config);
        
        assert!(!worker.is_running());
        assert!(!worker.id().is_empty());
    }
    
    #[tokio::test]
    async fn test_worker_pool_creation() {
        let config = WorkerConfig::default();
        let pool = WorkerPool::new(3, config);
        
        assert_eq!(pool.size(), 3);
    }
    
    #[test]
    fn test_worker_stats_default() {
        let stats = WorkerStats::default();
        assert_eq!(stats.total_requests, 0);
        assert_eq!(stats.successful_requests, 0);
        assert_eq!(stats.failed_requests, 0);
    }
}