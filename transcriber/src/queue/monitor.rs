use anyhow::{Context, Result};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

/// Queue health metrics
#[derive(Debug, Clone)]
pub struct QueueHealth {
    /// Estimated queue depth (messages waiting)
    pub queue_depth: usize,
    /// Messages received per second
    pub ingress_rate: f64,
    /// Messages processed per second  
    pub egress_rate: f64,
    /// Queue is experiencing backpressure
    pub has_backpressure: bool,
    /// Number of active workers
    pub active_workers: usize,
    /// Last update time
    pub last_updated: Instant,
}

impl Default for QueueHealth {
    fn default() -> Self {
        Self {
            queue_depth: 0,
            ingress_rate: 0.0,
            egress_rate: 0.0,
            has_backpressure: false,
            active_workers: 0,
            last_updated: Instant::now(),
        }
    }
}

impl QueueHealth {
    /// Check if queue is healthy
    pub fn is_healthy(&self) -> bool {
        !self.has_backpressure && self.active_workers > 0
    }
    
    /// Calculate queue pressure (0.0 = empty, 1.0+ = full/overloaded)
    pub fn pressure(&self) -> f64 {
        if self.egress_rate == 0.0 {
            if self.ingress_rate > 0.0 {
                return 1.0; // Queue filling with no processing
            }
            return 0.0;
        }
        self.ingress_rate / self.egress_rate
    }
}

/// Monitors queue health without consuming messages
pub struct QueueMonitor {
    /// Current health metrics
    health: Arc<RwLock<QueueHealth>>,
    /// Window for rate calculations
    window_size: Duration,
    /// Message count tracking
    ingress_count: Arc<RwLock<(u64, Instant)>>,
    egress_count: Arc<RwLock<(u64, Instant)>>,
}

impl QueueMonitor {
    /// Create a new queue monitor
    pub fn new(window_size: Duration) -> Self {
        let now = Instant::now();
        Self {
            health: Arc::new(RwLock::new(QueueHealth::default())),
            window_size,
            ingress_count: Arc::new(RwLock::new((0, now))),
            egress_count: Arc::new(RwLock::new((0, now))),
        }
    }
    
    /// Record a message entering the queue
    pub async fn record_ingress(&self) {
        let mut count = self.ingress_count.write().await;
        count.0 += 1;
        self.update_rates().await;
    }
    
    /// Record a message leaving the queue
    pub async fn record_egress(&self) {
        let mut count = self.egress_count.write().await;
        count.0 += 1;
        self.update_rates().await;
    }
    
    /// Update worker count
    pub async fn update_workers(&self, active: usize) {
        let mut health = self.health.write().await;
        health.active_workers = active;
        health.last_updated = Instant::now();
    }
    
    /// Update queue depth estimate
    pub async fn update_depth(&self, depth: usize) {
        let mut health = self.health.write().await;
        health.queue_depth = depth;
        
        // Check for backpressure
        let old_backpressure = health.has_backpressure;
        health.has_backpressure = depth > 1000 || health.pressure() > 0.9;
        
        if health.has_backpressure && !old_backpressure {
            warn!("Queue experiencing backpressure (depth: {}, pressure: {:.2})", 
                  depth, health.pressure());
        } else if !health.has_backpressure && old_backpressure {
            info!("Queue backpressure resolved");
        }
        
        health.last_updated = Instant::now();
    }
    
    /// Calculate current rates
    async fn update_rates(&self) {
        let now = Instant::now();
        
        // Calculate ingress rate
        let ingress = {
            let count = self.ingress_count.read().await;
            let elapsed = now.duration_since(count.1).as_secs_f64();
            if elapsed > 0.0 {
                count.0 as f64 / elapsed
            } else {
                0.0
            }
        };
        
        // Calculate egress rate
        let egress = {
            let count = self.egress_count.read().await;
            let elapsed = now.duration_since(count.1).as_secs_f64();
            if elapsed > 0.0 {
                count.0 as f64 / elapsed
            } else {
                0.0
            }
        };
        
        // Update health metrics
        let mut health = self.health.write().await;
        health.ingress_rate = ingress;
        health.egress_rate = egress;
        health.last_updated = now;
        
        // Reset counters if window exceeded
        if now.duration_since(self.ingress_count.read().await.1) > self.window_size {
            *self.ingress_count.write().await = (0, now);
        }
        if now.duration_since(self.egress_count.read().await.1) > self.window_size {
            *self.egress_count.write().await = (0, now);
        }
    }
    
    /// Get current health metrics
    pub async fn health(&self) -> QueueHealth {
        self.health.read().await.clone()
    }
    
    /// Get health summary string
    pub async fn health_summary(&self) -> String {
        let health = self.health.read().await;
        format!(
            "Queue Health: depth={}, in={:.1}/s, out={:.1}/s, pressure={:.2}, workers={}, healthy={}",
            health.queue_depth,
            health.ingress_rate,
            health.egress_rate,
            health.pressure(),
            health.active_workers,
            health.is_healthy()
        )
    }
}

/// Status message from worker to control plane
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WorkerStatus {
    /// Worker ID
    pub worker_id: String,
    /// Status type
    pub status: WorkerStatusType,
    /// Timestamp
    pub timestamp: chrono::DateTime<chrono::Utc>,
    /// Additional metadata
    pub metadata: Option<serde_json::Value>,
}

/// Types of worker status updates
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type")]
pub enum WorkerStatusType {
    /// Worker started
    Started,
    /// Worker picked up a message
    MessageReceived { message_id: String },
    /// Worker completed processing
    MessageCompleted { 
        message_id: String,
        success: bool,
        duration_ms: u64,
    },
    /// Worker heartbeat
    Heartbeat { 
        messages_processed: u64,
        uptime_seconds: u64,
    },
    /// Worker shutting down
    Stopping,
    /// Worker error
    Error { message: String },
}

#[cfg(feature = "zeromq-queue")]
pub mod zeromq {
    use super::*;
    use ::zeromq::{PullSocket, Socket, SocketRecv};
    
    /// Monitor ZeroMQ queue health without consuming messages
    pub async fn monitor_zmq_queue_health(
        _endpoint: &str,
        monitor: &QueueMonitor,
    ) -> Result<()> {
        // This is a challenge with ZeroMQ - we can't easily peek at queue depth
        // without consuming messages. Some options:
        
        // Option 1: Use ZMQ monitoring socket (ZMQ_EVENT_*)
        // This gives us events but not queue depth
        
        // Option 2: Use a SUB socket to monitor a separate stats channel
        // Workers would need to publish stats
        
        // Option 3: Estimate based on rate difference
        // If ingress > egress, queue is growing
        
        // For now, we'll estimate queue depth based on rate differences
        let health = monitor.health().await;
        let rate_diff = health.ingress_rate - health.egress_rate;
        
        if rate_diff > 0.0 {
            // Queue is growing
            let estimated_growth = (rate_diff * 10.0) as usize; // 10 second estimate
            monitor.update_depth(health.queue_depth + estimated_growth).await;
        } else if rate_diff < 0.0 && health.queue_depth > 0 {
            // Queue is shrinking
            let estimated_shrink = (rate_diff.abs() * 10.0) as usize;
            let new_depth = health.queue_depth.saturating_sub(estimated_shrink);
            monitor.update_depth(new_depth).await;
        }
        
        Ok(())
    }
    
    /// Create a control plane receiver for worker status updates
    pub async fn create_control_plane_receiver(
        endpoint: &str,
    ) -> Result<PullSocket> {
        let mut socket = PullSocket::new();
        socket.bind(endpoint).await
            .with_context(|| format!("Failed to bind control plane to {}", endpoint))?;
        
        info!("Control plane listening for worker status on {}", endpoint);
        Ok(socket)
    }
    
    /// Process worker status update
    pub async fn process_worker_status(
        status: WorkerStatus,
        monitor: &QueueMonitor,
        tracker: &crate::tracker::MessageTracker,
    ) -> Result<()> {
        
        match status.status {
            WorkerStatusType::Started => {
                info!("Worker {} started", status.worker_id);
                // Increment active worker count
                let health = monitor.health().await;
                monitor.update_workers(health.active_workers + 1).await;
            }
            
            WorkerStatusType::MessageReceived { ref message_id } => {
                debug!("Worker {} received message {}", status.worker_id, message_id);
                monitor.record_egress().await; // Message left the queue
                
                // Track in message tracker
                if let Ok(id) = uuid::Uuid::parse_str(message_id) {
                    tracker.assign_to_worker(id, status.worker_id.clone()).await?;
                }
            }
            
            WorkerStatusType::MessageCompleted { ref message_id, success, duration_ms } => {
                if success {
                    debug!("Worker {} completed message {} in {}ms", 
                           status.worker_id, message_id, duration_ms);
                } else {
                    warn!("Worker {} failed message {}", status.worker_id, message_id);
                }
                
                // Update tracker
                if let Ok(id) = uuid::Uuid::parse_str(message_id) {
                    if success {
                        tracker.mark_completed(id, status.worker_id.clone()).await?;
                    } else {
                        tracker.mark_failed(
                            id, 
                            status.worker_id.clone(),
                            "Processing failed".to_string()
                        ).await?;
                    }
                }
            }
            
            WorkerStatusType::Heartbeat { messages_processed, uptime_seconds } => {
                debug!("Worker {} heartbeat: {} messages in {}s", 
                       status.worker_id, messages_processed, uptime_seconds);
            }
            
            WorkerStatusType::Stopping => {
                info!("Worker {} stopping", status.worker_id);
                // Decrement active worker count
                let health = monitor.health().await;
                monitor.update_workers(health.active_workers.saturating_sub(1)).await;
            }
            
            WorkerStatusType::Error { ref message } => {
                error!("Worker {} error: {}", status.worker_id, message);
            }
        }
        
        Ok(())
    }
}