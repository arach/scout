/// Control plane monitor for receiving status updates from external services
/// This module binds to port 5557 and receives status messages from the Python worker
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use zmq;
use anyhow::{Result, Context};

/// Maximum number of status messages to keep in history
const MAX_STATUS_HISTORY: usize = 100;

/// Status message from the worker
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusMessage {
    pub worker_id: String,
    pub status: StatusDetails,
    pub timestamp: String,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusDetails {
    #[serde(rename = "type")]
    pub status_type: String,
    #[serde(flatten)]
    pub data: serde_json::Value,
}

/// Health information derived from status messages
#[derive(Debug, Clone, Serialize)]
pub struct WorkerHealth {
    pub is_healthy: bool,
    pub last_heartbeat_seconds_ago: Option<u64>,
    pub uptime_seconds: Option<u64>,
    pub messages_processed: u64,
    pub errors: u64,
    pub last_error: Option<String>,
    pub worker_id: Option<String>,
}

/// Control plane monitor that receives and tracks worker status
pub struct ControlPlaneMonitor {
    latest_heartbeat: Arc<RwLock<Option<Instant>>>,
    status_history: Arc<RwLock<VecDeque<StatusMessage>>>,
    worker_stats: Arc<RwLock<WorkerStats>>,
    running: Arc<RwLock<bool>>,
}

#[derive(Debug, Default)]
struct WorkerStats {
    messages_processed: u64,
    errors: u64,
    uptime_seconds: Option<u64>,
    last_error: Option<String>,
    worker_id: Option<String>,
}

impl ControlPlaneMonitor {
    /// Create a new control plane monitor
    pub fn new() -> Result<Self> {
        Ok(Self {
            latest_heartbeat: Arc::new(RwLock::new(None)),
            status_history: Arc::new(RwLock::new(VecDeque::with_capacity(MAX_STATUS_HISTORY))),
            worker_stats: Arc::new(RwLock::new(WorkerStats::default())),
            running: Arc::new(RwLock::new(false)),
        })
    }
    
    /// Start monitoring for status messages
    pub async fn start_monitoring(self: Arc<Self>) {
        // Check if already running
        let mut running = self.running.write().await;
        if *running {
            log::warn!("Control plane monitor already running");
            return;
        }
        *running = true;
        drop(running);
        
        log::info!("Starting control plane monitor");
        
        // Clone for the spawned task
        let monitor = self.clone();
        
        // Spawn a blocking task since ZMQ operations are blocking
        tokio::task::spawn_blocking(move || {
            // Create ZMQ context and socket in the thread that will use them
            let context = zmq::Context::new();
            
            let pull_socket = match context.socket(zmq::PULL) {
                Ok(sock) => sock,
                Err(e) => {
                    log::error!("Failed to create PULL socket: {}", e);
                    return;
                }
            };
            
            // Set receive timeout to avoid blocking forever
            if let Err(e) = pull_socket.set_rcvtimeo(100) {
                log::error!("Failed to set receive timeout: {}", e);
                return;
            }
            
            // Bind to the control plane port
            if let Err(e) = pull_socket.bind("tcp://127.0.0.1:5557") {
                log::error!("Failed to bind to port 5557: {}", e);
                return;
            }
            
            log::info!("Control plane monitor bound to port 5557");
            
            // Use a runtime handle for async operations within the blocking thread
            let runtime = tokio::runtime::Handle::current();
            
            loop {
                // Check if we should stop
                let should_stop = runtime.block_on(async {
                    !*monitor.running.read().await
                });
                
                if should_stop {
                    log::info!("Control plane monitor stopping");
                    break;
                }
                
                // Try to receive a message (non-blocking due to timeout)
                match pull_socket.recv_bytes(0) {
                    Ok(msg) => {
                        // Parse the MessagePack message
                        let monitor_clone = monitor.clone();
                        runtime.block_on(async move {
                            if let Err(e) = monitor_clone.process_message(msg.as_slice()).await {
                                log::error!("Failed to process status message: {}", e);
                            }
                        });
                    }
                    Err(zmq::Error::EAGAIN) => {
                        // Timeout - no message available, this is normal
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(e) => {
                        log::error!("Error receiving status message: {}", e);
                        std::thread::sleep(Duration::from_millis(100));
                    }
                }
            }
            
            // Clean up
            if let Err(e) = pull_socket.unbind("tcp://127.0.0.1:5557") {
                log::error!("Failed to unbind socket: {}", e);
            }
        });
    }
    
    /// Process a received status message
    async fn process_message(&self, msg: &[u8]) -> Result<()> {
        // Deserialize MessagePack message
        let status: StatusMessage = rmp_serde::from_slice(msg)
            .context("Failed to deserialize status message")?;
        
        log::debug!("Received status: {} from worker {}", 
            status.status.status_type, status.worker_id);
        
        // Update worker ID
        {
            let mut stats = self.worker_stats.write().await;
            stats.worker_id = Some(status.worker_id.clone());
        }
        
        // Process based on status type
        match status.status.status_type.as_str() {
            "Heartbeat" => {
                // Update heartbeat timestamp
                *self.latest_heartbeat.write().await = Some(Instant::now());
                
                // Extract stats from heartbeat data
                if let Ok(data) = serde_json::from_value::<serde_json::Map<String, serde_json::Value>>(status.status.data.clone()) {
                    let mut stats = self.worker_stats.write().await;
                    
                    if let Some(processed) = data.get("messages_processed").and_then(|v| v.as_u64()) {
                        stats.messages_processed = processed;
                    }
                    if let Some(uptime) = data.get("uptime_seconds").and_then(|v| v.as_u64()) {
                        stats.uptime_seconds = Some(uptime);
                    }
                }
                
                log::trace!("Heartbeat received from worker {}", status.worker_id);
            }
            
            "Started" => {
                log::info!("Worker {} started", status.worker_id);
                *self.latest_heartbeat.write().await = Some(Instant::now());
                
                // Reset stats for new worker
                let mut stats = self.worker_stats.write().await;
                *stats = WorkerStats {
                    worker_id: Some(status.worker_id.clone()),
                    ..Default::default()
                };
            }
            
            "Error" => {
                log::error!("Worker {} reported error: {:?}", status.worker_id, status.status.data);
                
                let mut stats = self.worker_stats.write().await;
                stats.errors += 1;
                if let Ok(data) = serde_json::from_value::<serde_json::Map<String, serde_json::Value>>(status.status.data.clone()) {
                    if let Some(message) = data.get("message").and_then(|v| v.as_str()) {
                        stats.last_error = Some(message.to_string());
                    }
                }
            }
            
            "MessageCompleted" => {
                // Track successful message processing
                if let Ok(data) = serde_json::from_value::<serde_json::Map<String, serde_json::Value>>(status.status.data.clone()) {
                    if let Some(success) = data.get("success").and_then(|v| v.as_bool()) {
                        if success {
                            let mut stats = self.worker_stats.write().await;
                            stats.messages_processed += 1;
                        }
                    }
                }
            }
            
            "Stopping" => {
                log::info!("Worker {} is stopping", status.worker_id);
            }
            
            _ => {
                log::debug!("Received status type: {}", status.status.status_type);
            }
        }
        
        // Add to history
        let mut history = self.status_history.write().await;
        history.push_back(status);
        
        // Keep history size limited
        while history.len() > MAX_STATUS_HISTORY {
            history.pop_front();
        }
        
        Ok(())
    }
    
    /// Stop monitoring
    pub async fn stop(&self) {
        log::info!("Stopping control plane monitor");
        *self.running.write().await = false;
    }
    
    /// Check if the worker is healthy based on recent heartbeats
    pub async fn is_healthy(&self) -> bool {
        if let Some(last_heartbeat) = *self.latest_heartbeat.read().await {
            // Consider healthy if heartbeat received within last 60 seconds
            last_heartbeat.elapsed() < Duration::from_secs(60)
        } else {
            false
        }
    }
    
    /// Get detailed health information
    pub async fn get_health(&self) -> WorkerHealth {
        let last_heartbeat = *self.latest_heartbeat.read().await;
        let (is_healthy, last_heartbeat_seconds_ago) = if let Some(hb) = last_heartbeat {
            let elapsed = hb.elapsed();
            (elapsed < Duration::from_secs(60), Some(elapsed.as_secs()))
        } else {
            (false, None)
        };
        
        let stats = self.worker_stats.read().await;
        
        WorkerHealth {
            is_healthy,
            last_heartbeat_seconds_ago,
            uptime_seconds: stats.uptime_seconds,
            messages_processed: stats.messages_processed,
            errors: stats.errors,
            last_error: stats.last_error.clone(),
            worker_id: stats.worker_id.clone(),
        }
    }
    
    /// Get recent status messages
    pub async fn get_status_history(&self) -> Vec<StatusMessage> {
        self.status_history.read().await.iter().cloned().collect()
    }
    
    /// Clear status history
    pub async fn clear_history(&self) {
        self.status_history.write().await.clear();
    }
}


/// Global control plane monitor instance
pub static CONTROL_PLANE_MONITOR: once_cell::sync::Lazy<Arc<RwLock<Option<Arc<ControlPlaneMonitor>>>>> = 
    once_cell::sync::Lazy::new(|| Arc::new(RwLock::new(None)));

/// Initialize the global control plane monitor
pub async fn init_control_plane_monitor() -> Result<()> {
    let monitor = Arc::new(ControlPlaneMonitor::new()?);
    monitor.clone().start_monitoring().await;
    
    let mut global = CONTROL_PLANE_MONITOR.write().await;
    *global = Some(monitor);
    
    Ok(())
}

/// Get the global control plane monitor
pub async fn get_control_plane_monitor() -> Option<Arc<ControlPlaneMonitor>> {
    CONTROL_PLANE_MONITOR.read().await.clone()
}