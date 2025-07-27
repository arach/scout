# Scout Production Hardening Plan

## Executive Summary

This document outlines a comprehensive plan to harden Scout's audio and transcription pipelines for production use. The plan addresses critical areas including error handling, memory optimization, performance tuning, and observability.

## Priority Rankings

- **P0 (Critical)**: Must be fixed before production - system stability issues
- **P1 (High)**: Should be fixed soon - affects reliability and user experience  
- **P2 (Medium)**: Important for long-term maintainability
- **P3 (Low)**: Nice to have optimizations

---

## 1. Remove VAD (Voice Activity Detection) Code [P0]

### Current State
The codebase references VAD functionality but the actual `vad` module is missing, causing compilation issues.

### Required Changes

#### File: `/src-tauri/src/audio/recorder.rs`

1. **Remove VAD import** (line 7):
```rust
// DELETE THIS LINE:
use super::vad::VoiceActivityDetector;
```

2. **Remove VAD fields from AudioRecorder** (lines 16, 45):
```rust
pub struct AudioRecorder {
    control_tx: Option<mpsc::Sender<RecorderCommand>>,
    is_recording: Arc<Mutex<bool>>,
    // DELETE: vad_enabled: Arc<Mutex<bool>>,
    current_audio_level: Arc<Mutex<f32>>,
    current_device_info: Arc<Mutex<Option<DeviceInfo>>>,
    sample_callback: Arc<Mutex<Option<SampleCallback>>>,
    recording_state_changed: Arc<Condvar>,
}
```

3. **Update AudioRecorder::new()** (line 45):
```rust
pub fn new() -> Self {
    Self {
        control_tx: None,
        is_recording: Arc::new(Mutex::new(false)),
        // DELETE: vad_enabled: Arc::new(Mutex::new(false)),
        current_audio_level: Arc::new(Mutex::new(0.0)),
        current_device_info: Arc::new(Mutex::new(None)),
        sample_callback: Arc::new(Mutex::new(None)),
        recording_state_changed: Arc::new(Condvar::new()),
    }
}
```

4. **Remove VAD from init()** (lines 75, 82):
```rust
pub fn init(&mut self) {
    let (tx, rx) = mpsc::channel();
    self.control_tx = Some(tx);
    let is_recording = self.is_recording.clone();
    // DELETE: let vad_enabled = self.vad_enabled.clone();
    let audio_level = self.current_audio_level.clone();
    let device_info = self.current_device_info.clone();
    let sample_callback = self.sample_callback.clone();
    let recording_state_changed = self.recording_state_changed.clone();

    thread::spawn(move || {
        // UPDATE: Remove vad_enabled parameter
        let mut recorder = AudioRecorderWorker::new(
            is_recording, 
            audio_level, 
            device_info, 
            sample_callback, 
            recording_state_changed
        );
        // ... rest of code
    });
}
```

5. **Remove VAD command handling** (lines 34, 96-98):
```rust
enum RecorderCommand {
    StartRecording(String, Option<String>),
    StopRecording,
    // DELETE: SetVadEnabled(bool),
    StartAudioLevelMonitoring(Option<String>),
    StopAudioLevelMonitoring,
    SetSampleCallback(Option<SampleCallback>),
}

// DELETE entire match arm (lines 96-98):
// RecorderCommand::SetVadEnabled(enabled) => {
//     *recorder.vad_enabled.lock().unwrap() = enabled;
// }
```

6. **Remove VAD public methods** (lines 189-203):
```rust
// DELETE THESE METHODS:
// pub fn set_vad_enabled(&self, enabled: bool) -> Result<(), String> { ... }
// pub fn is_vad_enabled(&self) -> bool { ... }
```

7. **Remove VAD from AudioRecorderWorker** (lines 249-250, 268-269, 449-452):
```rust
struct AudioRecorderWorker {
    stream: Option<cpal::Stream>,
    monitoring_stream: Option<cpal::Stream>,
    writer: Arc<Mutex<Option<hound::WavWriter<std::io::BufWriter<std::fs::File>>>>>,
    is_recording: Arc<Mutex<bool>>,
    // DELETE: vad_enabled: Arc<Mutex<bool>>,
    // DELETE: vad: Option<VoiceActivityDetector>,
    sample_count: Arc<Mutex<u64>>,
    // ... rest of fields
}

// Update new() signature and implementation:
fn new(
    is_recording: Arc<Mutex<bool>>, 
    audio_level: Arc<Mutex<f32>>, 
    device_info: Arc<Mutex<Option<DeviceInfo>>>, 
    sample_callback: Arc<Mutex<Option<SampleCallback>>>, 
    recording_state_changed: Arc<Condvar>
) -> Self {
    Self {
        // ... other fields
        // DELETE: vad_enabled,
        // DELETE: vad: None,
        // ... rest of fields
    }
}

// DELETE VAD initialization in start_recording (lines 449-452):
// if *self.vad_enabled.lock().unwrap() {
//     self.vad = Some(VoiceActivityDetector::new(config.sample_rate.0)?);
// }
```

---

## 2. Replace unwrap() Calls with Proper Error Handling [P0]

### Summary
Found 79 unwrap() calls across 13 files. Each needs to be replaced with proper error handling.

### Critical Files to Fix First

#### `/src-tauri/src/audio/ring_buffer_recorder.rs` (16 occurrences)

**Line 53: Lock acquisition**
```rust
// BEFORE:
let mut samples = self.samples.lock().unwrap();

// AFTER:
let mut samples = self.samples.lock()
    .map_err(|_| "Failed to acquire samples lock - mutex poisoned")?;
```

**Line 79: Writer lock**
```rust
// BEFORE:
if let Some(ref mut writer) = *self.writer.lock().unwrap() {

// AFTER:
let mut writer_guard = self.writer.lock()
    .map_err(|_| "Failed to acquire writer lock")?;
if let Some(ref mut writer) = *writer_guard {
```

**Line 91: Samples lock in extract_chunk**
```rust
// BEFORE:
let samples = self.samples.lock().unwrap();

// AFTER:
let samples = self.samples.lock()
    .map_err(|_| "Failed to acquire samples lock for extraction")?;
```

**Lines 126, 171, 187, 191, 197, 205, 211, 215: Similar lock patterns**
```rust
// Pattern for all lock acquisitions:
self.some_mutex.lock()
    .map_err(|_| "Failed to acquire X lock")?
```

#### `/src-tauri/src/audio/recorder.rs` (34 occurrences)

**Critical lock patterns to fix:**

1. **Recording state locks** (multiple locations):
```rust
// BEFORE:
*self.is_recording.lock().unwrap() = false;

// AFTER:
match self.is_recording.lock() {
    Ok(mut guard) => *guard = false,
    Err(e) => {
        error(Component::Recording, &format!("Failed to update recording state: {}", e));
        return Err("Failed to update recording state".to_string());
    }
}
```

2. **Channel send operations**:
```rust
// BEFORE:
self.control_tx.as_ref().unwrap().send(command)

// AFTER:
self.control_tx.as_ref()
    .ok_or("Recorder not initialized")?
    .send(command)
    .map_err(|e| format!("Failed to send command: {}", e))?
```

3. **Audio callback locks** (performance critical):
```rust
// BEFORE (in audio callback):
if *is_recording.lock().unwrap() {

// AFTER:
if let Ok(recording) = is_recording.try_lock() {
    if *recording {
        // Process audio
    }
} else {
    // Skip this buffer if we can't acquire lock
    return;
}
```

### Complete List of Files to Fix

1. `/src-tauri/src/audio/ring_buffer_recorder.rs` - 16 unwraps
2. `/src-tauri/src/audio/recorder.rs` - 34 unwraps
3. `/src-tauri/src/sound.rs` - 9 unwraps
4. `/src-tauri/src/lib.rs` - 4 unwraps
5. `/src-tauri/src/lazy_model.rs` - 2 unwraps
6. `/src-tauri/src/processing_queue.rs` - 1 unwrap
7. `/src-tauri/src/transcription/mod.rs` - 1 unwrap
8. `/src-tauri/src/logger.rs` - 3 unwraps
9. `/src-tauri/src/llm/engine.rs` - 1 unwrap
10. `/src-tauri/src/llm/pipeline.rs` - 1 unwrap
11. `/src-tauri/src/bin/benchmark.rs` - 3 unwraps
12. `/src-tauri/src/macos/native_overlay.rs` - 2 unwraps
13. `/src-tauri/src/macos/mod.rs` - 2 unwraps

---

## 3. Memory Optimization Strategies [P0]

### Audio Callback Optimization

**Current Issues:**
- Allocating vectors in hot path
- Unnecessary data copying
- No pre-allocated buffers

**Optimizations:**

1. **Pre-allocate conversion buffers**:
```rust
struct AudioRecorderWorker {
    // Add pre-allocated buffers
    mono_conversion_buffer: Vec<f32>,
    callback_buffer: Vec<f32>,
    // ... existing fields
}

impl AudioRecorderWorker {
    fn new(...) -> Self {
        Self {
            // Pre-allocate with reasonable capacity
            mono_conversion_buffer: Vec::with_capacity(4096),
            callback_buffer: Vec::with_capacity(4096),
            // ... other fields
        }
    }
}
```

2. **Reuse buffers in audio callback**:
```rust
// In build_input_stream callback:
move |data: &[T], _: &cpal::InputCallbackInfo| {
    // Try lock with timeout to avoid blocking
    if let Ok(recording) = is_recording.try_lock() {
        if !*recording {
            return;
        }
    } else {
        return; // Skip if can't acquire lock
    }
    
    // Reuse pre-allocated buffers instead of creating new ones
    // ... processing code
}
```

### Ring Buffer Optimization

1. **Use power-of-2 sizes for efficient modulo operations**:
```rust
impl RingBufferRecorder {
    pub fn new(spec: WavSpec, output_path: &Path) -> Result<Self, String> {
        // Use power-of-2 for efficient wraparound
        let max_duration_secs = 300; // 5 minutes
        let total_samples = spec.sample_rate as usize * spec.channels as usize * max_duration_secs;
        let max_samples = total_samples.next_power_of_two();
        
        // Pre-allocate to avoid resizing
        let mut samples = VecDeque::with_capacity(max_samples);
        // ... rest of initialization
    }
}
```

2. **Batch operations to reduce lock contention**:
```rust
pub fn add_samples(&self, new_samples: &[f32]) -> Result<(), String> {
    // Process in larger chunks to reduce lock frequency
    const CHUNK_SIZE: usize = 1024;
    
    for chunk in new_samples.chunks(CHUNK_SIZE) {
        let mut samples = self.samples.lock()
            .map_err(|_| "Failed to acquire samples lock")?;
        
        // Batch add operations
        samples.extend(chunk.iter().copied());
        
        // Batch remove operations
        let overflow = samples.len().saturating_sub(self.max_samples);
        if overflow > 0 {
            samples.drain(..overflow);
        }
    }
    // ... WAV writing
}
```

---

## 4. Retry Mechanisms and Circuit Breakers [P1]

### Transcription Service Circuit Breaker

```rust
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, Instant};

pub struct CircuitBreaker {
    failure_count: AtomicU32,
    last_failure_time: AtomicU64,
    state: AtomicU32, // 0 = Closed, 1 = Open, 2 = Half-Open
    failure_threshold: u32,
    recovery_timeout: Duration,
}

impl CircuitBreaker {
    pub fn new(failure_threshold: u32, recovery_timeout: Duration) -> Self {
        Self {
            failure_count: AtomicU32::new(0),
            last_failure_time: AtomicU64::new(0),
            state: AtomicU32::new(0), // Start closed
            failure_threshold,
            recovery_timeout,
        }
    }
    
    pub fn call<F, T, E>(&self, f: F) -> Result<T, E>
    where
        F: FnOnce() -> Result<T, E>,
        E: From<&'static str>,
    {
        match self.state.load(Ordering::Relaxed) {
            1 => { // Open
                let last_failure = Duration::from_millis(
                    self.last_failure_time.load(Ordering::Relaxed)
                );
                let now = Instant::now();
                
                if now.duration_since(Instant::now() - last_failure) > self.recovery_timeout {
                    self.state.store(2, Ordering::Relaxed); // Half-open
                } else {
                    return Err(E::from("Circuit breaker is open"));
                }
            }
            _ => {} // Closed or Half-open, proceed
        }
        
        match f() {
            Ok(result) => {
                self.failure_count.store(0, Ordering::Relaxed);
                self.state.store(0, Ordering::Relaxed); // Closed
                Ok(result)
            }
            Err(e) => {
                let failures = self.failure_count.fetch_add(1, Ordering::Relaxed) + 1;
                self.last_failure_time.store(
                    Instant::now().elapsed().as_millis() as u64,
                    Ordering::Relaxed
                );
                
                if failures >= self.failure_threshold {
                    self.state.store(1, Ordering::Relaxed); // Open
                }
                
                Err(e)
            }
        }
    }
}
```

### Retry with Exponential Backoff

```rust
pub async fn retry_with_backoff<F, Fut, T, E>(
    mut f: F,
    max_retries: u32,
    initial_delay: Duration,
) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
{
    let mut delay = initial_delay;
    let mut retries = 0;
    
    loop {
        match f().await {
            Ok(result) => return Ok(result),
            Err(e) if retries >= max_retries => return Err(e),
            Err(_) => {
                retries += 1;
                tokio::time::sleep(delay).await;
                delay = delay.saturating_mul(2).min(Duration::from_secs(60));
            }
        }
    }
}
```

---

## 5. Observability and Monitoring System [P1]

### Metrics Collection

```rust
use prometheus::{Counter, Histogram, IntGauge, Registry};
use once_cell::sync::Lazy;

pub struct AudioMetrics {
    pub recording_duration: Histogram,
    pub recording_errors: Counter,
    pub buffer_overruns: Counter,
    pub active_recordings: IntGauge,
    pub audio_level: Histogram,
    pub samples_processed: Counter,
}

pub struct TranscriptionMetrics {
    pub transcription_duration: Histogram,
    pub transcription_errors: Counter,
    pub queue_size: IntGauge,
    pub model_load_time: Histogram,
    pub words_transcribed: Counter,
}

static METRICS: Lazy<(AudioMetrics, TranscriptionMetrics)> = Lazy::new(|| {
    let audio = AudioMetrics {
        recording_duration: Histogram::new(prometheus::HistogramOpts::new(
            "scout_recording_duration_seconds",
            "Duration of audio recordings"
        )).unwrap(),
        recording_errors: Counter::new(
            "scout_recording_errors_total",
            "Total number of recording errors"
        ).unwrap(),
        buffer_overruns: Counter::new(
            "scout_buffer_overruns_total",
            "Total number of buffer overruns"
        ).unwrap(),
        active_recordings: IntGauge::new(
            "scout_active_recordings",
            "Number of active recordings"
        ).unwrap(),
        audio_level: Histogram::new(prometheus::HistogramOpts::new(
            "scout_audio_level",
            "Audio input levels"
        )).unwrap(),
        samples_processed: Counter::new(
            "scout_samples_processed_total",
            "Total audio samples processed"
        ).unwrap(),
    };
    
    let transcription = TranscriptionMetrics {
        transcription_duration: Histogram::new(prometheus::HistogramOpts::new(
            "scout_transcription_duration_seconds",
            "Duration of transcriptions"
        )).unwrap(),
        transcription_errors: Counter::new(
            "scout_transcription_errors_total",
            "Total number of transcription errors"
        ).unwrap(),
        queue_size: IntGauge::new(
            "scout_transcription_queue_size",
            "Current transcription queue size"
        ).unwrap(),
        model_load_time: Histogram::new(prometheus::HistogramOpts::new(
            "scout_model_load_seconds",
            "Model loading time"
        )).unwrap(),
        words_transcribed: Counter::new(
            "scout_words_transcribed_total",
            "Total words transcribed"
        ).unwrap(),
    };
    
    (audio, transcription)
});

// Usage in code:
impl AudioRecorder {
    pub fn start_recording(&self, output_path: &Path, device_name: Option<&str>) -> Result<(), String> {
        METRICS.0.active_recordings.inc();
        let start_time = Instant::now();
        
        let result = self.start_recording_internal(output_path, device_name);
        
        if result.is_err() {
            METRICS.0.recording_errors.inc();
            METRICS.0.active_recordings.dec();
        }
        
        result
    }
}
```

### Structured Logging Enhancement

```rust
use serde::Serialize;
use tracing::{info, error, warn, debug, span, Level};

#[derive(Serialize)]
struct RecordingEvent {
    device: String,
    sample_rate: u32,
    channels: u16,
    buffer_size: String,
    duration_ms: u64,
}

// Replace current logging with structured events:
let span = span!(Level::INFO, "recording", device = %device_name);
let _enter = span.enter();

info!(
    event = "recording_started",
    recording = serde_json::to_string(&RecordingEvent {
        device: device_name.to_string(),
        sample_rate: config.sample_rate.0,
        channels: config.channels,
        buffer_size: buffer_size_used,
        duration_ms: 0,
    }).unwrap()
);
```

---

## 6. Performance Optimizations [P1]

### Critical Path Optimizations

1. **Lock-free audio level updates**:
```rust
use std::sync::atomic::{AtomicU32, Ordering};

// Store audio level as atomic
struct AudioRecorderWorker {
    current_audio_level: Arc<AtomicU32>, // Store as fixed-point
    // ... other fields
}

// In audio callback:
let level_fixed = (amplified_rms * 1000.0) as u32;
audio_level.store(level_fixed, Ordering::Relaxed);

// To read:
let level = audio_level.load(Ordering::Relaxed) as f32 / 1000.0;
```

2. **SIMD optimizations for audio processing**:
```rust
#[cfg(target_arch = "x86_64")]
use std::arch::x86_64::*;

unsafe fn calculate_rms_simd(samples: &[f32]) -> f32 {
    let mut sum = _mm256_setzero_ps();
    
    for chunk in samples.chunks_exact(8) {
        let vals = _mm256_loadu_ps(chunk.as_ptr());
        let squared = _mm256_mul_ps(vals, vals);
        sum = _mm256_add_ps(sum, squared);
    }
    
    // Sum all lanes
    let mut result = [0.0f32; 8];
    _mm256_storeu_ps(result.as_mut_ptr(), sum);
    let total: f32 = result.iter().sum();
    
    // Handle remaining samples
    let remainder_sum: f32 = samples[samples.len() - samples.len() % 8..]
        .iter()
        .map(|&x| x * x)
        .sum();
    
    ((total + remainder_sum) / samples.len() as f32).sqrt()
}
```

3. **Zero-copy audio conversion**:
```rust
// Use bytemuck for zero-copy conversions where possible
use bytemuck::{cast_slice, Pod, Zeroable};

#[repr(transparent)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct F32Sample(f32);

// Convert without allocation
let f32_view: &[F32Sample] = cast_slice(i16_samples);
```

---

## 7. Resource Usage Constraints [P2]

### Memory Limits

```rust
use sysinfo::{System, SystemExt};

pub struct ResourceMonitor {
    system: System,
    memory_limit: usize,
    cpu_limit: f32,
}

impl ResourceMonitor {
    pub fn new(memory_limit_mb: usize, cpu_limit_percent: f32) -> Self {
        Self {
            system: System::new_all(),
            memory_limit: memory_limit_mb * 1024 * 1024,
            cpu_limit: cpu_limit_percent,
        }
    }
    
    pub fn check_resources(&mut self) -> ResourceStatus {
        self.system.refresh_memory();
        self.system.refresh_cpu();
        
        let used_memory = self.system.used_memory() * 1024; // Convert to bytes
        let cpu_usage = self.system.global_cpu_info().cpu_usage();
        
        if used_memory > self.memory_limit {
            return ResourceStatus::MemoryExceeded;
        }
        
        if cpu_usage > self.cpu_limit {
            return ResourceStatus::CpuExceeded;
        }
        
        ResourceStatus::Ok
    }
}

pub enum ResourceStatus {
    Ok,
    MemoryExceeded,
    CpuExceeded,
}
```

### Graceful Degradation

```rust
pub struct DegradationStrategy {
    quality_levels: Vec<QualityLevel>,
    current_level: usize,
}

#[derive(Clone)]
struct QualityLevel {
    name: &'static str,
    sample_rate: u32,
    buffer_size: usize,
    transcription_model: &'static str,
}

impl DegradationStrategy {
    pub fn new() -> Self {
        Self {
            quality_levels: vec![
                QualityLevel {
                    name: "high",
                    sample_rate: 48000,
                    buffer_size: 256,
                    transcription_model: "medium.en",
                },
                QualityLevel {
                    name: "medium",
                    sample_rate: 16000,
                    buffer_size: 512,
                    transcription_model: "small.en",
                },
                QualityLevel {
                    name: "low",
                    sample_rate: 8000,
                    buffer_size: 1024,
                    transcription_model: "tiny.en",
                },
            ],
            current_level: 0,
        }
    }
    
    pub fn degrade(&mut self) -> Option<&QualityLevel> {
        if self.current_level < self.quality_levels.len() - 1 {
            self.current_level += 1;
            warn(Component::System, &format!(
                "Degrading quality to: {}", 
                self.quality_levels[self.current_level].name
            ));
            Some(&self.quality_levels[self.current_level])
        } else {
            None
        }
    }
    
    pub fn current(&self) -> &QualityLevel {
        &self.quality_levels[self.current_level]
    }
}
```

---

## 8. Health Check Implementation [P2]

### Comprehensive Health Check System

```rust
use std::collections::HashMap;
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum HealthStatus {
    Healthy,
    Degraded(String),
    Unhealthy(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentHealth {
    pub name: String,
    pub status: HealthStatus,
    pub last_check: chrono::DateTime<chrono::Utc>,
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemHealth {
    pub overall_status: HealthStatus,
    pub components: Vec<ComponentHealth>,
    pub uptime: Duration,
    pub version: String,
}

pub trait HealthCheck: Send + Sync {
    fn check(&self) -> ComponentHealth;
    fn name(&self) -> &str;
}

pub struct AudioHealthCheck {
    recorder: Arc<AudioRecorder>,
}

impl HealthCheck for AudioHealthCheck {
    fn check(&self) -> ComponentHealth {
        let mut metadata = HashMap::new();
        
        // Check if we can access audio devices
        match cpal::default_host().default_input_device() {
            Some(device) => {
                metadata.insert("default_device".to_string(), 
                    device.name().unwrap_or_else(|_| "Unknown".to_string()));
                
                // Check device configuration
                match device.default_input_config() {
                    Ok(config) => {
                        metadata.insert("sample_rate".to_string(), 
                            config.sample_rate().0.to_string());
                        metadata.insert("channels".to_string(), 
                            config.channels().to_string());
                    }
                    Err(e) => {
                        return ComponentHealth {
                            name: self.name().to_string(),
                            status: HealthStatus::Unhealthy(format!("Cannot access device config: {}", e)),
                            last_check: chrono::Utc::now(),
                            metadata,
                        };
                    }
                }
            }
            None => {
                return ComponentHealth {
                    name: self.name().to_string(),
                    status: HealthStatus::Unhealthy("No audio input device available".to_string()),
                    last_check: chrono::Utc::now(),
                    metadata,
                };
            }
        }
        
        ComponentHealth {
            name: self.name().to_string(),
            status: HealthStatus::Healthy,
            last_check: chrono::Utc::now(),
            metadata,
        }
    }
    
    fn name(&self) -> &str {
        "audio"
    }
}

pub struct TranscriptionHealthCheck {
    model_path: PathBuf,
}

impl HealthCheck for TranscriptionHealthCheck {
    fn check(&self) -> ComponentHealth {
        let mut metadata = HashMap::new();
        
        // Check if model file exists
        if !self.model_path.exists() {
            return ComponentHealth {
                name: self.name().to_string(),
                status: HealthStatus::Unhealthy("Model file not found".to_string()),
                last_check: chrono::Utc::now(),
                metadata,
            };
        }
        
        // Check file size
        match std::fs::metadata(&self.model_path) {
            Ok(meta) => {
                metadata.insert("model_size".to_string(), meta.len().to_string());
            }
            Err(e) => {
                return ComponentHealth {
                    name: self.name().to_string(),
                    status: HealthStatus::Degraded(format!("Cannot read model metadata: {}", e)),
                    last_check: chrono::Utc::now(),
                    metadata,
                };
            }
        }
        
        ComponentHealth {
            name: self.name().to_string(),
            status: HealthStatus::Healthy,
            last_check: chrono::Utc::now(),
            metadata,
        }
    }
    
    fn name(&self) -> &str {
        "transcription"
    }
}

pub struct HealthCheckService {
    checks: Vec<Box<dyn HealthCheck>>,
    start_time: Instant,
}

impl HealthCheckService {
    pub fn new() -> Self {
        Self {
            checks: Vec::new(),
            start_time: Instant::now(),
        }
    }
    
    pub fn register(&mut self, check: Box<dyn HealthCheck>) {
        self.checks.push(check);
    }
    
    pub fn check_all(&self) -> SystemHealth {
        let component_results: Vec<ComponentHealth> = self.checks
            .iter()
            .map(|check| check.check())
            .collect();
        
        let overall_status = if component_results.iter().all(|c| matches!(c.status, HealthStatus::Healthy)) {
            HealthStatus::Healthy
        } else if component_results.iter().any(|c| matches!(c.status, HealthStatus::Unhealthy(_))) {
            HealthStatus::Unhealthy("One or more components unhealthy".to_string())
        } else {
            HealthStatus::Degraded("One or more components degraded".to_string())
        };
        
        SystemHealth {
            overall_status,
            components: component_results,
            uptime: self.start_time.elapsed(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

// Tauri command for health checks
#[tauri::command]
pub async fn health_check(
    health_service: tauri::State<'_, Arc<Mutex<HealthCheckService>>>,
) -> Result<SystemHealth, String> {
    let service = health_service.lock()
        .map_err(|_| "Failed to acquire health service lock")?;
    Ok(service.check_all())
}
```

---

## Implementation Timeline

### Phase 1: Critical Fixes (Week 1)
- [ ] Remove all VAD code
- [ ] Fix all unwrap() calls in audio path
- [ ] Implement basic retry mechanism for transcription

### Phase 2: Performance & Reliability (Week 2)
- [ ] Implement circuit breakers
- [ ] Add memory optimizations
- [ ] Set up basic metrics collection

### Phase 3: Observability (Week 3)
- [ ] Complete metrics implementation
- [ ] Add structured logging
- [ ] Implement health checks

### Phase 4: Advanced Optimizations (Week 4)
- [ ] SIMD optimizations
- [ ] Lock-free implementations
- [ ] Resource monitoring and graceful degradation

## Testing Strategy

1. **Unit Tests**: Test each component in isolation
2. **Integration Tests**: Test audio pipeline end-to-end
3. **Stress Tests**: Run with high load for extended periods
4. **Chaos Tests**: Simulate failures and resource constraints
5. **Performance Tests**: Benchmark critical paths

## Monitoring Checklist

- [ ] Audio recording success/failure rates
- [ ] Transcription success/failure rates
- [ ] Memory usage over time
- [ ] CPU usage patterns
- [ ] Buffer underrun/overrun counts
- [ ] API response times
- [ ] Queue depths
- [ ] Error rates by type

## Success Criteria

1. **Reliability**: 99.9% uptime for audio recording
2. **Performance**: <300ms latency for audio processing
3. **Memory**: <215MB baseline memory usage
4. **Error Handling**: Zero panics in production
5. **Observability**: Complete metrics coverage of critical paths