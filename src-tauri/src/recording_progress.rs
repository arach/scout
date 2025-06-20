use std::sync::Arc;
use tokio::sync::watch;

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub enum RecordingState {
    Idle,
    Recording { filename: String, start_time: u64 },
    Stopping { filename: String },  // Brief state while stopping
}

// Keep the old enum name for compatibility but simplify it
pub type RecordingProgress = RecordingState;

pub struct ProgressTracker {
    sender: Arc<watch::Sender<RecordingProgress>>,
    receiver: watch::Receiver<RecordingProgress>,
}

impl ProgressTracker {
    pub fn new() -> Self {
        let (sender, receiver) = watch::channel(RecordingProgress::Idle);
        Self {
            sender: Arc::new(sender),
            receiver,
        }
    }
    
    pub fn update(&self, progress: RecordingProgress) {
        let _ = self.sender.send(progress);
    }
    
    pub fn subscribe(&self) -> watch::Receiver<RecordingProgress> {
        self.receiver.clone()
    }
    
    pub fn get_sender(&self) -> Arc<watch::Sender<RecordingProgress>> {
        self.sender.clone()
    }
    
    pub fn current_state(&self) -> RecordingProgress {
        self.receiver.borrow().clone()
    }
    
    pub fn is_recording(&self) -> bool {
        matches!(self.receiver.borrow().clone(), RecordingProgress::Recording { .. })
    }
    
    pub fn is_busy(&self) -> bool {
        !matches!(self.receiver.borrow().clone(), RecordingProgress::Idle)
    }
}