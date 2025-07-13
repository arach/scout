use chrono::{DateTime, Local};
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::logger::{info, Component};
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceEvent {
    pub timestamp: DateTime<Local>,
    pub event_type: String,
    pub details: String,
    pub duration_from_start_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceTimeline {
    pub session_id: String,
    pub events: Vec<PerformanceEvent>,
    pub start_time: DateTime<Local>,
}

impl PerformanceTimeline {
    pub fn new(session_id: String) -> Self {
        let start_time = Local::now();
        let mut timeline = Self {
            session_id: session_id.clone(),
            events: Vec::new(),
            start_time,
        };
        
        timeline.add_event("session_started", &format!("Performance tracking started for session {}", session_id));
        timeline
    }
    
    pub fn add_event(&mut self, event_type: &str, details: &str) {
        let now = Local::now();
        let duration_from_start = now.signed_duration_since(self.start_time);
        let duration_ms = duration_from_start.num_milliseconds();
        
        let event = PerformanceEvent {
            timestamp: now,
            event_type: event_type.to_string(),
            details: details.to_string(),
            duration_from_start_ms: Some(duration_ms),
        };
        
        // Log immediately for debugging
        info(Component::Recording, &format!(
            "[{}] +{}ms: {}",
            event_type,
            duration_ms,
            details
        ));
        
        self.events.push(event);
    }
    
    pub fn get_summary(&self) -> String {
        let mut summary = format!("=== Performance Timeline for {} ===\n", self.session_id);
        summary.push_str(&format!("Start: {}\n", self.start_time.format("%H:%M:%S%.3f")));
        summary.push_str("\n");
        
        let mut last_time = 0i64;
        for event in &self.events {
            let elapsed = event.duration_from_start_ms.unwrap_or(0);
            let delta = elapsed - last_time;
            last_time = elapsed;
            
            summary.push_str(&format!(
                "[{:>4}ms] +{:>3}ms {} - {}\n",
                elapsed,
                delta,
                event.event_type,
                event.details
            ));
        }
        
        if let Some(last_event) = self.events.last() {
            if let Some(total_ms) = last_event.duration_from_start_ms {
                summary.push_str(&format!("\nTotal time: {}ms\n", total_ms));
            }
        }
        
        summary.push_str("================================\n");
        summary
    }
}

pub struct PerformanceTracker {
    timelines: Arc<Mutex<Vec<PerformanceTimeline>>>,
    current_session: Arc<Mutex<Option<String>>>,
}

impl PerformanceTracker {
    pub fn new() -> Self {
        Self {
            timelines: Arc::new(Mutex::new(Vec::new())),
            current_session: Arc::new(Mutex::new(None)),
        }
    }
    
    pub async fn start_session(&self, session_id: String) {
        let timeline = PerformanceTimeline::new(session_id.clone());
        let mut timelines = self.timelines.lock().await;
        timelines.push(timeline);
        
        let mut current = self.current_session.lock().await;
        *current = Some(session_id);
    }
    
    pub async fn track_event(&self, event_type: &str, details: &str) {
        let current = self.current_session.lock().await;
        if let Some(session_id) = current.as_ref() {
            let mut timelines = self.timelines.lock().await;
            if let Some(timeline) = timelines.iter_mut().find(|t| &t.session_id == session_id) {
                timeline.add_event(event_type, details);
            }
        }
    }
    
    pub async fn end_session(&self) -> Option<String> {
        let mut current = self.current_session.lock().await;
        if let Some(session_id) = current.take() {
            let mut timelines = self.timelines.lock().await;
            if let Some(timeline) = timelines.iter_mut().find(|t| t.session_id == session_id) {
                timeline.add_event("session_ended", "Performance tracking complete");
                return Some(timeline.get_summary());
            }
        }
        None
    }
    
    pub async fn get_current_timeline(&self) -> Option<PerformanceTimeline> {
        let current = self.current_session.lock().await;
        if let Some(session_id) = current.as_ref() {
            let timelines = self.timelines.lock().await;
            return timelines.iter().find(|t| &t.session_id == session_id).cloned();
        }
        None
    }
    
    pub async fn get_timeline_for_database(&self, session_id: &str) -> Option<Vec<(String, String, String, Option<i64>)>> {
        let timelines = self.timelines.lock().await;
        if let Some(timeline) = timelines.iter().find(|t| t.session_id == session_id) {
            let events: Vec<(String, String, String, Option<i64>)> = timeline.events.iter().map(|event| {
                (
                    event.timestamp.to_rfc3339(),
                    event.event_type.clone(),
                    event.details.clone(),
                    event.duration_from_start_ms,
                )
            }).collect();
            return Some(events);
        }
        None
    }
}