use anyhow::Result;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// State of a message in the processing pipeline
#[derive(Debug, Clone, PartialEq)]
pub enum MessageState {
    /// Message has been seen in the queue but not yet picked up
    Pending,
    /// Message has been picked up by a worker
    Processing { worker_id: String },
    /// Message has been successfully processed
    Completed { worker_id: String },
    /// Message processing failed
    Failed { worker_id: String, error: String },
    /// Message has been retried
    Retrying { attempt: u32 },
}

/// Metadata about a message being tracked
#[derive(Debug, Clone)]
pub struct MessageInfo {
    /// Unique message ID
    pub id: Uuid,
    /// Current state of the message
    pub state: MessageState,
    /// When the message was first seen
    pub first_seen: DateTime<Utc>,
    /// When the message was last updated
    pub last_updated: DateTime<Utc>,
    /// Size of the message in bytes
    pub size_bytes: usize,
    /// Number of retry attempts
    pub retry_count: u32,
    /// Maximum retries allowed
    pub max_retries: u32,
    /// Timeout for processing (in seconds)
    pub timeout_seconds: u64,
}

impl MessageInfo {
    /// Create a new message info
    pub fn new(id: Uuid, size_bytes: usize, max_retries: u32, timeout_seconds: u64) -> Self {
        let now = Utc::now();
        Self {
            id,
            state: MessageState::Pending,
            first_seen: now,
            last_updated: now,
            size_bytes,
            retry_count: 0,
            max_retries,
            timeout_seconds,
        }
    }

    /// Check if the message has timed out
    pub fn is_timed_out(&self) -> bool {
        if let MessageState::Processing { .. } = self.state {
            let elapsed = Utc::now() - self.last_updated;
            elapsed.num_seconds() as u64 > self.timeout_seconds
        } else {
            false
        }
    }

    /// Check if the message can be retried
    pub fn can_retry(&self) -> bool {
        self.retry_count < self.max_retries
    }

    /// Update the message state
    pub fn update_state(&mut self, new_state: MessageState) {
        self.state = new_state;
        self.last_updated = Utc::now();
    }

    /// Mark message as being processed by a worker
    pub fn mark_processing(&mut self, worker_id: String) {
        self.update_state(MessageState::Processing { worker_id });
    }

    /// Mark message as completed
    pub fn mark_completed(&mut self, worker_id: String) {
        self.update_state(MessageState::Completed { worker_id });
    }

    /// Mark message as failed
    pub fn mark_failed(&mut self, worker_id: String, error: String) {
        self.update_state(MessageState::Failed { worker_id, error });
    }

    /// Mark message for retry
    pub fn mark_retrying(&mut self) {
        self.retry_count += 1;
        self.update_state(MessageState::Retrying {
            attempt: self.retry_count,
        });
    }

    /// Get processing duration if completed
    pub fn processing_duration(&self) -> Option<chrono::Duration> {
        match self.state {
            MessageState::Completed { .. } => Some(self.last_updated - self.first_seen),
            _ => None,
        }
    }
}

/// Tracks messages through their lifecycle
pub struct MessageTracker {
    /// Map of message ID to message info
    messages: Arc<RwLock<HashMap<Uuid, MessageInfo>>>,
    /// Map of worker ID to currently processing message IDs
    worker_assignments: Arc<RwLock<HashMap<String, Vec<Uuid>>>>,
    /// Configuration
    max_retries: u32,
    timeout_seconds: u64,
}

impl MessageTracker {
    /// Create a new message tracker
    pub fn new(max_retries: u32, timeout_seconds: u64) -> Self {
        Self {
            messages: Arc::new(RwLock::new(HashMap::new())),
            worker_assignments: Arc::new(RwLock::new(HashMap::new())),
            max_retries,
            timeout_seconds,
        }
    }

    /// Track a new message
    pub async fn track_message(&self, id: Uuid, size_bytes: usize) -> Result<()> {
        let mut messages = self.messages.write().await;
        let info = MessageInfo::new(id, size_bytes, self.max_retries, self.timeout_seconds);
        
        info!("Tracking new message {}: {} bytes", id, size_bytes);
        messages.insert(id, info);
        
        Ok(())
    }

    /// Mark a message as being processed by a worker
    pub async fn assign_to_worker(&self, message_id: Uuid, worker_id: String) -> Result<()> {
        let mut messages = self.messages.write().await;
        let mut assignments = self.worker_assignments.write().await;

        if let Some(info) = messages.get_mut(&message_id) {
            info.mark_processing(worker_id.clone());
            
            // Update worker assignments
            assignments
                .entry(worker_id.clone())
                .or_insert_with(Vec::new)
                .push(message_id);
            
            info!("Message {} assigned to worker {}", message_id, worker_id);
        } else {
            warn!("Attempted to assign unknown message {} to worker {}", message_id, worker_id);
        }

        Ok(())
    }

    /// Mark a message as completed
    pub async fn mark_completed(&self, message_id: Uuid, worker_id: String) -> Result<()> {
        let mut messages = self.messages.write().await;
        let mut assignments = self.worker_assignments.write().await;

        if let Some(info) = messages.get_mut(&message_id) {
            info.mark_completed(worker_id.clone());
            
            // Remove from worker assignments
            if let Some(worker_messages) = assignments.get_mut(&worker_id) {
                worker_messages.retain(|&id| id != message_id);
            }
            
            if let Some(duration) = info.processing_duration() {
                info!(
                    "Message {} completed by {} in {}ms",
                    message_id,
                    worker_id,
                    duration.num_milliseconds()
                );
            }
        }

        Ok(())
    }

    /// Mark a message as failed
    pub async fn mark_failed(
        &self,
        message_id: Uuid,
        worker_id: String,
        error: String,
    ) -> Result<bool> {
        let mut messages = self.messages.write().await;
        let mut assignments = self.worker_assignments.write().await;

        if let Some(info) = messages.get_mut(&message_id) {
            info.mark_failed(worker_id.clone(), error.clone());
            
            // Remove from worker assignments
            if let Some(worker_messages) = assignments.get_mut(&worker_id) {
                worker_messages.retain(|&id| id != message_id);
            }
            
            error!("Message {} failed on worker {}: {}", message_id, worker_id, error);
            
            // Check if we can retry
            if info.can_retry() {
                info.mark_retrying();
                info!(
                    "Message {} will be retried (attempt {}/{})",
                    message_id,
                    info.retry_count,
                    info.max_retries
                );
                return Ok(true); // Can retry
            } else {
                error!(
                    "Message {} has exceeded max retries ({})",
                    message_id, info.max_retries
                );
                return Ok(false); // Cannot retry
            }
        }

        Ok(false)
    }

    /// Check for timed out messages
    pub async fn check_timeouts(&self) -> Vec<Uuid> {
        let mut timed_out = Vec::new();
        let messages = self.messages.read().await;

        for (id, info) in messages.iter() {
            if info.is_timed_out() {
                warn!(
                    "Message {} has timed out (processing for {}s)",
                    id,
                    (Utc::now() - info.last_updated).num_seconds()
                );
                timed_out.push(*id);
            }
        }

        timed_out
    }

    /// Handle a timed out message
    pub async fn handle_timeout(&self, message_id: Uuid) -> Result<bool> {
        let mut messages = self.messages.write().await;
        let mut assignments = self.worker_assignments.write().await;

        if let Some(info) = messages.get_mut(&message_id) {
            if let MessageState::Processing { ref worker_id } = info.state {
                let worker = worker_id.clone();
                
                // Remove from worker assignments
                if let Some(worker_messages) = assignments.get_mut(&worker) {
                    worker_messages.retain(|&id| id != message_id);
                }
                
                error!("Message {} timed out on worker {}", message_id, worker);
                
                // Check if we can retry
                if info.can_retry() {
                    info.mark_retrying();
                    info!(
                        "Message {} will be retried after timeout (attempt {}/{})",
                        message_id,
                        info.retry_count,
                        info.max_retries
                    );
                    return Ok(true); // Can retry
                } else {
                    info.mark_failed(worker, "Processing timeout".to_string());
                    error!(
                        "Message {} has exceeded max retries after timeout",
                        message_id
                    );
                    return Ok(false); // Cannot retry
                }
            }
        }

        Ok(false)
    }

    /// Clean up completed or permanently failed messages
    pub async fn cleanup_old_messages(&self, max_age_seconds: u64) -> usize {
        let mut messages = self.messages.write().await;
        let now = Utc::now();
        let mut removed = 0;

        messages.retain(|id, info| {
            let age = (now - info.last_updated).num_seconds() as u64;
            
            // Keep if still processing or pending
            if matches!(info.state, MessageState::Pending | MessageState::Processing { .. }) {
                return true;
            }
            
            // Remove old completed or failed messages
            if age > max_age_seconds {
                debug!("Removing old message {} (age: {}s)", id, age);
                removed += 1;
                return false;
            }
            
            true
        });

        if removed > 0 {
            debug!("Cleaned up {} old messages", removed);
        }

        removed
    }

    /// Get statistics about tracked messages
    pub async fn get_stats(&self) -> MessageTrackerStats {
        let messages = self.messages.read().await;
        let mut stats = MessageTrackerStats::default();

        for info in messages.values() {
            stats.total += 1;
            
            match &info.state {
                MessageState::Pending => stats.pending += 1,
                MessageState::Processing { .. } => stats.processing += 1,
                MessageState::Completed { .. } => {
                    stats.completed += 1;
                    if let Some(duration) = info.processing_duration() {
                        stats.total_processing_time_ms += duration.num_milliseconds() as u64;
                    }
                }
                MessageState::Failed { .. } => stats.failed += 1,
                MessageState::Retrying { .. } => stats.retrying += 1,
            }
            
            stats.total_retries += info.retry_count as u64;
        }

        if stats.completed > 0 {
            stats.avg_processing_time_ms = stats.total_processing_time_ms / stats.completed as u64;
        }

        stats
    }

    /// Get messages assigned to a specific worker
    pub async fn get_worker_messages(&self, worker_id: &str) -> Vec<Uuid> {
        let assignments = self.worker_assignments.read().await;
        assignments
            .get(worker_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Remove all messages assigned to a worker (e.g., if worker died)
    pub async fn clear_worker_assignments(&self, worker_id: &str) -> Vec<Uuid> {
        let mut assignments = self.worker_assignments.write().await;
        assignments.remove(worker_id).unwrap_or_default()
    }
}

/// Statistics about tracked messages
#[derive(Debug, Default, Clone)]
pub struct MessageTrackerStats {
    pub total: usize,
    pub pending: usize,
    pub processing: usize,
    pub completed: usize,
    pub failed: usize,
    pub retrying: usize,
    pub total_retries: u64,
    pub total_processing_time_ms: u64,
    pub avg_processing_time_ms: u64,
}

impl std::fmt::Display for MessageTrackerStats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Messages: total={}, pending={}, processing={}, completed={}, failed={}, retrying={}, avg_time={}ms",
            self.total,
            self.pending,
            self.processing,
            self.completed,
            self.failed,
            self.retrying,
            self.avg_processing_time_ms
        )
    }
}