mod audio;
pub mod db;
pub mod transcription;
mod recording_progress;
mod recording_workflow;
mod processing_queue;
mod overlay_position;
mod sound;
mod models;
mod settings;
mod clipboard;
mod ring_buffer_monitor;
mod transcription_context;
mod performance_logger;
mod keyboard_monitor;
mod logger;
mod lazy_model;
mod env;
mod post_processing;
mod profanity_filter;
mod performance_metrics_service;
pub mod benchmarking;
mod llm;
mod whisper_logger;
mod whisper_log_interceptor;
mod performance_tracker;
#[cfg(target_os = "macos")]
mod macos;

use audio::AudioRecorder;
use db::Database;
use processing_queue::{ProcessingQueue, ProcessingStatus};
use recording_progress::ProgressTracker;
use recording_workflow::{RecordingWorkflow, RecordingResult};
use settings::SettingsManager;
use keyboard_monitor::KeyboardMonitor;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, State, WindowEvent};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, MenuItemBuilder};
use tokio::sync::Mutex;
use chrono;
use audio::converter::AudioConverter;
use std::path::Path;
use crate::logger::{info, debug, warn, error, Component};
use crate::transcription::Transcriber;
use crate::performance_tracker::PerformanceTracker;
use std::sync::OnceLock;

/// Global storage for the current device sample rate
static DEVICE_SAMPLE_RATE: OnceLock<Arc<Mutex<Option<u32>>>> = OnceLock::new();

/// Get the current device sample rate from the global cache
/// This is used by transcription strategies to avoid hardcoding 48kHz
pub fn get_current_device_sample_rate() -> Option<u32> {
    let rate_storage = DEVICE_SAMPLE_RATE.get_or_init(|| Arc::new(Mutex::new(None)));
    
    // Use try_lock to avoid blocking if the mutex is held
    if let Ok(rate) = rate_storage.try_lock() {
        *rate
    } else {
        None
    }
}

/// Update the cached device sample rate (called from the audio recorder)
pub fn update_device_sample_rate(sample_rate: u32) {
    let rate_storage = DEVICE_SAMPLE_RATE.get_or_init(|| Arc::new(Mutex::new(None)));
    
    if let Ok(mut rate) = rate_storage.try_lock() {
        *rate = Some(sample_rate);
        info(Component::Recording, &format!("Updated global device sample rate to: {} Hz", sample_rate));
    }
}

// Overlay dimensions configuration
const OVERLAY_EXPANDED_WIDTH: f64 = 220.0;
const OVERLAY_EXPANDED_HEIGHT: f64 = 48.0;
const OVERLAY_MINIMIZED_WIDTH: f64 = 48.0;
const OVERLAY_MINIMIZED_HEIGHT: f64 = 16.0;

pub struct AppState {
    pub recorder: Arc<Mutex<AudioRecorder>>,
    pub database: Arc<Database>,
    pub app_data_dir: PathBuf,
    pub recordings_dir: PathBuf,
    pub models_dir: PathBuf,
    pub settings: Arc<Mutex<SettingsManager>>,
    pub is_recording_overlay_active: Arc<AtomicBool>,
    pub current_recording_file: Arc<Mutex<Option<String>>>,
    pub progress_tracker: Arc<ProgressTracker>,
    pub recording_workflow: Arc<RecordingWorkflow>,
    pub processing_queue: Arc<ProcessingQueue>,
    pub keyboard_monitor: Arc<KeyboardMonitor>,
    pub transcriber: Arc<Mutex<Option<Transcriber>>>,
    pub current_model_path: Arc<Mutex<Option<PathBuf>>>,
    pub performance_tracker: Arc<PerformanceTracker>,
    #[cfg(target_os = "macos")]
    pub native_overlay: Arc<Mutex<macos::MacOSOverlay>>,
    #[cfg(target_os = "macos")]
    pub native_panel_overlay: Arc<Mutex<macos::NativeOverlay>>,
}


#[tauri::command]
async fn start_recording(state: State<'_, AppState>, app: tauri::AppHandle, device_name: Option<String>) -> Result<String, String> {
    // Check if already recording
    if state.progress_tracker.is_busy() {
        warn(Component::Recording, "Attempted to start recording while already recording");
        return Err("Recording already in progress".to_string());
    }
    
    // Double-check with the audio recorder
    let recorder = state.recorder.lock().await;
    if recorder.is_recording() {
        drop(recorder);
        warn(Component::Recording, "Audio recorder is already recording");
        return Err("Audio recorder is already active".to_string());
    }
    drop(recorder);
    // Play start sound
    sound::SoundPlayer::play_start();
    
    
    // Use the recording workflow to start recording
    let filename = state.recording_workflow.start_recording(device_name).await?;
    
    // Progress is already updated by recording_workflow, no need to update again
    
    // Store the current recording filename
    *state.current_recording_file.lock().await = Some(filename.clone());

    // Update tray menu item text
    if let Some(menu_item) = app.try_state::<MenuItem<tauri::Wry>>() {
        let _ = menu_item.set_text("Stop Recording");
    }

    // Show native NSPanel overlay and immediately set recording state
    #[cfg(target_os = "macos")]
    {
        let overlay = state.native_panel_overlay.lock().await;
        overlay.show();
        overlay.set_recording_state(true);
        drop(overlay);
        
        // Start audio level monitoring for native overlay AFTER recording has started
        let overlay_clone = state.native_panel_overlay.clone();
        let recorder_clone = state.recorder.clone();
        
        // Start audio level monitoring task
        
        tauri::async_runtime::spawn(async move {
            // Audio level monitoring task started
            
            // Wait for recording to stabilize
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
            
            let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(200)); // Reduced frequency to avoid lock contention
            let mut tick_count = 0;
            let mut consecutive_not_recording = 0;
            
            loop {
                interval.tick().await;
                tick_count += 1;
                
                let recorder = recorder_clone.lock().await;
                let is_recording = recorder.is_recording();
                let level = recorder.get_current_audio_level();
                drop(recorder);
                
                // Only exit if we've seen multiple "not recording" states
                if !is_recording {
                    consecutive_not_recording += 1;
                    if consecutive_not_recording > 5 {
                        // Recording stopped - end monitoring
                        break;
                    }
                } else {
                    consecutive_not_recording = 0;
                }
                
                // Log every 20th tick (every second) for debugging
                if tick_count % 20 == 0 {
                    // Periodic audio level check
                }
                
                let overlay = overlay_clone.lock().await;
                overlay.set_volume_level(level);
                drop(overlay);
            }
            
            // Audio level monitoring task ended
        });
    }

    // Broadcast recording state change to ALL windows
    let _ = app.emit("recording-state-changed", serde_json::json!({
        "state": "recording",
        "filename": &filename
    }));

    Ok(filename)
}

#[tauri::command]
async fn cancel_recording(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    
    // Cancel recording without queueing for processing
    state.recording_workflow.cancel_recording().await?;
    
    // Clear the current recording file
    state.current_recording_file.lock().await.take();
    
    // Update tray menu item text
    if let Some(menu_item) = app.try_state::<MenuItem<tauri::Wry>>() {
        let _ = menu_item.set_text("Start Recording");
    }
    
    // Stop recording overlay updates
    state.is_recording_overlay_active.store(false, Ordering::Relaxed);
    
    // Native overlay will be updated to idle by progress tracker listener
    
    Ok(())
}

#[tauri::command]
async fn stop_recording(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<RecordingResult, String> {
    
    // Use the recording workflow to stop recording
    let result = state.recording_workflow.stop_recording().await?;
    
    // Play stop sound
    sound::SoundPlayer::play_stop();
    
    // Set native overlay to processing state instead of idle
    #[cfg(target_os = "macos")]
    {
        use crate::logger::{info, debug, Component};
        
        info(Component::Overlay, "Setting native overlay to processing state for transcription");
        
        let overlay = state.native_panel_overlay.lock().await;
        overlay.set_processing_state(true);
        debug(Component::Overlay, "Native overlay set to processing state");
        drop(overlay);
    }
    
    // Get the filename for background processing
    let filename = state.current_recording_file.lock().await.take();
    
    // Spawn a background task to ensure file is ready
    if let Some(filename) = filename {
        let recordings_dir = state.recordings_dir.clone();
        
        tokio::spawn(async move {
            // Wait for the audio file to be fully written
            tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
            
            // Verify file exists and has content
            let file_path = recordings_dir.join(&filename);
            match tokio::fs::metadata(&file_path).await {
                Ok(_metadata) => {
                }
                Err(e) => {
                    error(Component::Recording, &format!("Failed to verify recording file: {}", e));
                }
            }
        });
    }
    
    // Update tray menu item text
    if let Some(menu_item) = app.try_state::<MenuItem<tauri::Wry>>() {
        let _ = menu_item.set_text("Start Recording");
    }
    
    // Stop recording overlay updates
    state.is_recording_overlay_active.store(false, Ordering::Relaxed);
    
    // Native overlay state will be managed by the progress tracker and processing status events
    // Don't set it to processing here - let the workflow handle state transitions
    
    // Broadcast recording state change to ALL windows
    let _ = app.emit("recording-state-changed", serde_json::json!({
        "state": "stopped"
    }));
    
    Ok(result)
}

#[tauri::command]
async fn is_recording(state: State<'_, AppState>) -> Result<bool, String> {
    // Check progress tracker state first - it's the most authoritative source
    let progress = state.progress_tracker.current_state();
    match progress {
        recording_progress::RecordingProgress::Recording { .. } => Ok(true),
        recording_progress::RecordingProgress::Stopping { .. } => Ok(true),
        recording_progress::RecordingProgress::Idle => {
            // Only check recorder state if progress tracker is idle
            // This prevents race conditions where recorder state hasn't been cleared yet
            let recorder = state.recorder.lock().await;
            let is_recording = recorder.is_recording();
            drop(recorder);
            
            // Log if there's a mismatch for debugging
            if is_recording {
                warn(Component::Recording, "is_recording mismatch: recorder says true but progress tracker is idle");
            }
            
            Ok(is_recording)
        }
    }
}

#[tauri::command]
async fn log_from_overlay(_message: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
async fn get_audio_devices() -> Result<Vec<String>, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    
    let host = cpal::default_host();
    let mut device_names = Vec::new();
    
    // Get input devices
    let devices = host.input_devices()
        .map_err(|e| format!("Failed to enumerate input devices: {}", e))?;
    
    for device in devices {
        match device.name() {
            Ok(name) => {
                device_names.push(name);
            },
            Err(e) => {
                error(Component::Recording, &format!("Failed to get device name: {}", e));
            }
        }
    }
    
    if device_names.is_empty() {
        device_names.push("No input devices found".to_string());
    }
    
    Ok(device_names)
}

#[derive(serde::Serialize)]
struct AudioDeviceInfo {
    name: String,
    index: usize,
    sample_rates: Vec<u32>,
    channels: u16,
}

#[tauri::command]
async fn get_audio_devices_detailed() -> Result<Vec<AudioDeviceInfo>, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    
    let host = cpal::default_host();
    let mut device_infos = Vec::new();
    
    // Get input devices
    let devices = host.input_devices()
        .map_err(|e| format!("Failed to enumerate input devices: {}", e))?;
    
    for (index, device) in devices.enumerate() {
        let name = device.name().unwrap_or_else(|_| format!("Unknown Device {}", index));
        
        // Try to get the default input config
        let (sample_rates, channels) = match device.default_input_config() {
            Ok(config) => {
                // Get supported sample rates
                let mut rates = vec![config.sample_rate().0];
                
                // Try common sample rates to see what's supported
                for &rate in &[16000, 44100, 48000, 96000] {
                    if rate != config.sample_rate().0 {
                        rates.push(rate);
                    }
                }
                
                (rates, config.channels())
            },
            Err(_) => {
                // Fallback values if we can't get config
                (vec![48000], 2)
            }
        };
        
        device_infos.push(AudioDeviceInfo {
            name,
            index,
            sample_rates,
            channels,
        });
    }
    
    Ok(device_infos)
}

#[tauri::command]
async fn start_audio_level_monitoring(state: State<'_, AppState>, device_name: Option<String>) -> Result<(), String> {
    let recorder = state.recorder.lock().await;
    recorder.start_audio_level_monitoring(device_name.as_deref())
}

#[tauri::command]
async fn stop_audio_level_monitoring(state: State<'_, AppState>) -> Result<(), String> {
    let recorder = state.recorder.lock().await;
    recorder.stop_audio_level_monitoring()
}

#[tauri::command]
async fn get_current_audio_level(state: State<'_, AppState>) -> Result<f32, String> {
    let recorder = state.recorder.lock().await;
    Ok(recorder.get_current_audio_level())
}


#[tauri::command]
async fn get_current_recording_file(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let file = state.current_recording_file.lock().await;
    Ok(file.clone())
}

#[tauri::command]
async fn transcribe_audio(
    state: State<'_, AppState>,
    audio_filename: String,
) -> Result<String, String> {
    let audio_path = state.recordings_dir.join(&audio_filename);
    
    // Check if audio file exists
    if !audio_path.exists() {
        return Err(format!("Audio file not found at path: {:?}", audio_path));
    }
    
    // Check file size to ensure it's not empty
    let metadata = std::fs::metadata(&audio_path)
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;
    
    if metadata.len() < 1024 {  // Less than 1KB is probably an empty or corrupted file
        return Err(format!("Audio file appears to be empty or corrupted (size: {} bytes)", metadata.len()));
    }
    
    // Get the active model path
    let settings = state.settings.lock().await;
    let model_path = models::WhisperModel::get_active_model_path(&state.models_dir, settings.get());
    drop(settings); // Release the lock early
    
    if !model_path.exists() {
        error(Component::Transcription, &format!("Model file does not exist at: {:?}", model_path));
        debug(Component::Transcription, "Models directory contents:");
        if let Ok(entries) = std::fs::read_dir(&state.models_dir) {
            for entry in entries.filter_map(Result::ok) {
                debug(Component::Transcription, &format!("  - {:?}", entry.path()));
            }
        }
        return Err("No Whisper model found. Please download a model from Settings.".to_string());
    } else {
        
        // Extract model name from path for logging
        let _model_name = model_path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("unknown");
    }
    
    // Get or create singleton transcriber for this model
    let result = {
        let mut current_model = state.current_model_path.lock().await;
        let mut transcriber_opt = state.transcriber.lock().await;
        
        // Check if we need to create a new transcriber (model changed or first time)
        let needs_new_transcriber = match (&*current_model, &*transcriber_opt) {
            (Some(current_path), Some(_)) if current_path == &model_path => false,
            _ => true
        };
        
        if needs_new_transcriber {
            info(Component::Transcription, &format!("Creating new singleton transcriber for model: {:?}", model_path));
            match transcription::Transcriber::new(&model_path) {
                Ok(new_transcriber) => {
                    *transcriber_opt = Some(new_transcriber);
                    *current_model = Some(model_path.clone());
                }
                Err(e) => return Err(e)
            }
        }
        
        // Use the singleton transcriber
        let transcriber = transcriber_opt.as_ref().unwrap();
        transcriber.transcribe(&audio_path)?
    };
    
    Ok(result)
}

#[tauri::command]
async fn transcribe_file(
    state: State<'_, AppState>,
    file_path: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    use std::path::Path;
    
    let path = Path::new(&file_path);
    
    // Validate file exists
    if !path.exists() {
        return Err("File not found".to_string());
    }
    
    // Check file size (limit to ~100MB for 10 minute files)
    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;
    
    let file_size_mb = metadata.len() as f64 / (1024.0 * 1024.0);
    if file_size_mb > 100.0 {
        return Err(format!("File too large: {:.1}MB (max 100MB)", file_size_mb));
    }
    
    // Get file extension
    let extension = path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    
    // Support common audio formats
    let supported_formats = ["wav", "mp3", "m4a", "flac", "ogg", "webm"];
    if !supported_formats.contains(&extension.as_str()) {
        return Err(format!("Unsupported file format: .{}", extension));
    }
    
    // Copy file to our recordings directory with timestamp
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let filename = format!("upload_{}_{}", timestamp, path.file_name().unwrap().to_string_lossy());
    let dest_path = state.recordings_dir.join(&filename);
    
    std::fs::copy(&path, &dest_path)
        .map_err(|e| format!("Failed to copy file: {}", e))?;
    
    // Estimate duration (rough estimate based on file size)
    let estimated_duration_ms = (file_size_mb * 60000.0) as i32; // Rough: 1MB ≈ 1 minute
    
    // Queue for processing
    let job = processing_queue::ProcessingJob {
        filename: filename.clone(),
        audio_path: dest_path,
        duration_ms: estimated_duration_ms,
        app_handle: Some(app.clone()),
        queue_entry_time: tokio::time::Instant::now(),
        user_stop_time: None, // File upload doesn't have user stop time
        #[cfg(target_os = "macos")]
        app_context: None, // No app context for file uploads
        #[cfg(not(target_os = "macos"))]
        app_context: None,
    };
    
    let _ = state.processing_queue.queue_job(job).await;
    
    // Emit status update
    app.emit("file-upload-complete", serde_json::json!({
        "filename": filename,
        "originalName": path.file_name().unwrap().to_string_lossy(),
        "size": metadata.len(),
    })).map_err(|e| format!("Failed to emit event: {}", e))?;
    
    Ok(filename)
}

#[tauri::command]
async fn save_transcript(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    text: String,
    duration_ms: i32,
) -> Result<i64, String> {
    // Get current active model for metadata
    let settings = state.settings.lock().await;
    let active_model = settings.get().models.active_model_id.clone();
    drop(settings);
    
    let metadata = serde_json::json!({
        "model_used": active_model,
        "processing_type": "manual_save"
    }).to_string();
    
    let transcript = state.database.save_transcript(&text, duration_ms, Some(&metadata), None, None).await?;
    
    // Emit transcript-created event
    let _ = app.emit("transcript-created", &transcript);
    
    Ok(transcript.id)
}

#[tauri::command]
async fn get_recent_transcripts(
    state: State<'_, AppState>,
    limit: i32,
) -> Result<Vec<db::Transcript>, String> {
    state.database.get_recent_transcripts(limit).await
}

#[tauri::command]
async fn get_performance_metrics(
    state: State<'_, AppState>,
    limit: i32,
) -> Result<Vec<db::PerformanceMetrics>, String> {
    state.database.get_recent_performance_metrics(limit).await
}

#[tauri::command]
async fn get_performance_metrics_for_transcript(
    state: State<'_, AppState>,
    transcript_id: i64,
) -> Result<Option<db::PerformanceMetrics>, String> {
    state.database.get_performance_metrics_for_transcript(transcript_id).await
}

#[tauri::command]
async fn get_performance_timeline(
    state: State<'_, AppState>,
) -> Result<Option<performance_tracker::PerformanceTimeline>, String> {
    Ok(state.performance_tracker.get_current_timeline().await)
}

#[tauri::command]
async fn get_transcript(
    state: State<'_, AppState>,
    transcript_id: i64,
) -> Result<Option<db::Transcript>, String> {
    state.database.get_transcript(transcript_id).await
}

#[tauri::command]
async fn search_transcripts(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<db::Transcript>, String> {
    state.database.search_transcripts(&query).await
}

#[tauri::command]
async fn read_audio_file(audio_path: String) -> Result<Vec<u8>, String> {
    let path = Path::new(&audio_path);
    if path.extension().and_then(|s| s.to_str()) == Some("wav") {
        return std::fs::read(&audio_path).map_err(|e| e.to_string());
    }
    AudioConverter::convert_to_wav_bytes(path)
}

#[tauri::command]
async fn set_vad_enabled(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    let recorder = state.recorder.lock().await;
    recorder.set_vad_enabled(enabled)
}

#[tauri::command]
async fn subscribe_to_progress(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    let mut receiver = state.progress_tracker.subscribe();
    
    tauri::async_runtime::spawn(async move {
        while receiver.changed().await.is_ok() {
            let progress = receiver.borrow().clone();
            let _ = app.emit("recording-progress", &progress);
        }
    });
    
    Ok(())
}

#[tauri::command]
async fn get_overlay_position(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.settings.lock().await;
    Ok(settings.get().ui.overlay_position.clone())
}

#[tauri::command]
async fn set_overlay_position(state: State<'_, AppState>, position: String) -> Result<(), String> {
    // Update the settings
    let mut settings = state.settings.lock().await;
    settings.update(|s| s.ui.overlay_position = position.clone())
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    drop(settings);
    
    // Update the native overlay position immediately
    #[cfg(target_os = "macos")]
    {
        let overlay = state.native_panel_overlay.lock().await;
        overlay.set_position(&position);
    }
    
    Ok(())
}

#[tauri::command]
async fn set_overlay_treatment(state: State<'_, AppState>, treatment: String) -> Result<(), String> {
    // Update the native overlay waveform style
    #[cfg(target_os = "macos")]
    {
        let overlay = state.native_panel_overlay.lock().await;
        overlay.set_waveform_style(&treatment);
    }
    
    Ok(())
}

#[tauri::command]
async fn download_model(
    app: tauri::AppHandle,
    model_name: String,
    model_url: String,
) -> Result<(), String> {
    use tauri::Emitter;
    use std::path::Path;
    
    let models_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("models");
    
    // Create models directory if it doesn't exist
    std::fs::create_dir_all(&models_dir)
        .map_err(|e| format!("Failed to create models directory: {}", e))?;
    
    let model_filename = format!("ggml-{}.bin", model_name);
    let dest_path = models_dir.join(&model_filename);
    
    // Check if model already exists
    if dest_path.exists() {
        return Ok(());
    }
    
    // Download the model
    let response = reqwest::get(&model_url).await
        .map_err(|e| format!("Failed to download model: {}", e))?;
    
    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded = 0u64;
    
    let mut file = std::fs::File::create(&dest_path)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    
    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    use std::io::Write;
    
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Failed to read chunk: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write chunk: {}", e))?;
        
        downloaded += chunk.len() as u64;
        let progress = if total_size > 0 {
            (downloaded as f32 / total_size as f32 * 100.0) as u32
        } else {
            0
        };
        
        // Emit download progress
        app.emit("model-download-progress", serde_json::json!({
            "progress": progress,
            "downloaded": downloaded,
            "total": total_size,
        })).ok();
    }
    
    Ok(())
}

#[tauri::command]
async fn check_microphone_permission() -> Result<String, String> {
    // For now, just check if we can access audio devices
    // If we can enumerate devices, we likely have permission
    #[cfg(target_os = "macos")]
    {
        use cpal::traits::{HostTrait, DeviceTrait};
        
        let host = cpal::default_host();
        match host.default_input_device() {
            Some(_) => Ok("granted".to_string()),
            None => Ok("denied".to_string()),
        }
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        Ok("granted".to_string())
    }
}

#[tauri::command]
async fn request_microphone_permission() -> Result<String, String> {
    // The actual permission request happens when we try to use the microphone
    // For now, we'll trigger a check by trying to access the device
    check_microphone_permission().await
}

#[tauri::command]
async fn open_system_preferences_audio() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .spawn()
            .map_err(|e| format!("Failed to open system preferences: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn mark_onboarding_complete(state: State<'_, AppState>) -> Result<(), String> {
    // Could store this in settings if needed
    Ok(())
}

#[tauri::command]
async fn is_vad_enabled(state: State<'_, AppState>) -> Result<bool, String> {
    let recorder = state.recorder.lock().await;
    Ok(recorder.is_vad_enabled())
}

#[tauri::command]
async fn delete_transcript(
    state: State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    let result = state.database.delete_transcript(id).await;
    result
}

#[tauri::command]
async fn delete_transcripts(
    state: State<'_, AppState>,
    ids: Vec<i64>,
) -> Result<(), String> {
    state.database.delete_transcripts(&ids).await
}

#[tauri::command]
async fn export_transcripts(
    transcripts: Vec<db::Transcript>,
    format: String,
) -> Result<String, String> {
    match format.as_str() {
        "json" => {
            serde_json::to_string_pretty(&transcripts)
                .map_err(|e| format!("Failed to serialize to JSON: {}", e))
        }
        "markdown" => {
            let mut output = String::from("# Scout Transcripts\n\n");
            for transcript in transcripts {
                output.push_str(&format!(
                    "## {}\n\n{}\n\n*Duration: {}*\n\n---\n\n",
                    transcript.created_at,
                    transcript.text,
                    format_duration(transcript.duration_ms)
                ));
            }
            Ok(output)
        }
        "text" => {
            let mut output = String::new();
            for transcript in transcripts {
                output.push_str(&format!(
                    "[{}] ({}):\n{}\n\n",
                    transcript.created_at,
                    format_duration(transcript.duration_ms),
                    transcript.text
                ));
            }
            Ok(output)
        }
        _ => Err("Invalid export format".to_string())
    }
}

fn format_duration(ms: i32) -> String {
    let seconds = ms / 1000;
    let minutes = seconds / 60;
    let remaining_seconds = seconds % 60;
    format!("{}:{:02}", minutes, remaining_seconds)
}

#[tauri::command]
async fn get_processing_status() -> Result<Vec<String>, String> {
    // This could be enhanced to return actual queue status
    Ok(vec!["Processing queue is active".to_string()])
}

#[tauri::command]
async fn set_sound_enabled(enabled: bool) -> Result<(), String> {
    sound::SoundPlayer::set_enabled(enabled);
    Ok(())
}

#[tauri::command]
async fn is_sound_enabled() -> Result<bool, String> {
    Ok(sound::SoundPlayer::is_enabled())
}

#[tauri::command]
async fn get_available_sounds() -> Result<Vec<String>, String> {
    Ok(sound::SoundPlayer::get_available_sounds())
}

#[tauri::command]
async fn get_sound_settings() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "startSound": sound::SoundPlayer::get_start_sound(),
        "stopSound": sound::SoundPlayer::get_stop_sound(),
        "successSound": sound::SoundPlayer::get_success_sound()
    }))
}

#[tauri::command]
async fn set_start_sound(sound: String) -> Result<(), String> {
    sound::SoundPlayer::set_start_sound(sound);
    Ok(())
}

#[tauri::command]
async fn set_stop_sound(sound: String) -> Result<(), String> {
    sound::SoundPlayer::set_stop_sound(sound);
    Ok(())
}

#[tauri::command]
async fn set_success_sound(sound: String) -> Result<(), String> {
    sound::SoundPlayer::set_success_sound(sound);
    Ok(())
}

#[tauri::command]
async fn preview_sound_flow() -> Result<(), String> {
    sound::SoundPlayer::preview_sound_flow().await;
    Ok(())
}

#[tauri::command]
async fn get_current_shortcut(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.settings.lock().await;
    Ok(settings.get().ui.hotkey.clone())
}

#[tauri::command]
async fn get_current_model(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.settings.lock().await;
    Ok(settings.get().models.active_model_id.clone())
}

#[tauri::command]
async fn get_available_models(state: State<'_, AppState>) -> Result<Vec<models::WhisperModel>, String> {
    let settings = state.settings.lock().await;
    Ok(models::WhisperModel::all(&state.models_dir, settings.get()))
}

#[tauri::command]
async fn has_any_model(state: State<'_, AppState>) -> Result<bool, String> {
    
    let has_models = match std::fs::read_dir(&state.models_dir) {
        Ok(entries) => {
            let mut found_models = false;
            for entry in entries.filter_map(Result::ok) {
                let path = entry.path();
                if path.extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext == "bin")
                    .unwrap_or(false) 
                {
                    found_models = true;
                }
            }
            found_models
        }
        Err(e) => {
            error(Component::Transcription, &format!("Error reading models directory: {}", e));
            false
        }
    };
    
    Ok(has_models)
}

#[tauri::command]
async fn set_active_model(state: State<'_, AppState>, model_id: String) -> Result<(), String> {
    let mut settings = state.settings.lock().await;
    let _previous_model = settings.get().models.active_model_id.clone();
    settings.update(|s| s.models.active_model_id = model_id.clone())
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn get_models_dir(state: State<'_, AppState>) -> Result<String, String> {
    let path = state.models_dir.to_string_lossy().to_string();
    Ok(path)
}

#[tauri::command]
async fn open_models_folder(state: State<'_, AppState>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&state.models_dir)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&state.models_dir)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&state.models_dir)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    Ok(())
}

#[tauri::command]
async fn download_file(
    url: String,
    dest_path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    use std::path::Path;
    use tokio::fs::File;
    use tokio::io::AsyncWriteExt;
    use futures_util::StreamExt;
    
    
    // Ensure parent directory exists
    if let Some(parent) = Path::new(&dest_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
        
        // Verify directory was created
        if parent.exists() && parent.is_dir() {
        } else {
            error(Component::Transcription, "Parent directory was not created properly!");
        }
    }
    
    // Start download
    let client = reqwest::Client::new();
    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;
    
    let total_size = response.content_length().unwrap_or(0);
    
    // Create the file
    let mut file = File::create(&dest_path).await
        .map_err(|e| format!("Failed to create file at {}: {}", dest_path, e))?;
    
    // Download with progress
    let mut downloaded = 0u64;
    let mut stream = response.bytes_stream();
    
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result
            .map_err(|e| format!("Download error: {}", e))?;
        
        file.write_all(&chunk).await
            .map_err(|e| format!("Failed to write chunk: {}", e))?;
        
        downloaded += chunk.len() as u64;
        
        // Emit progress event
        let progress = if total_size > 0 {
            (downloaded as f64 / total_size as f64) * 100.0
        } else {
            0.0
        };
        
        let _ = app.emit("download-progress", serde_json::json!({
            "url": url,
            "downloaded": downloaded,
            "total": total_size,
            "progress": progress
        }));
    }
    
    file.flush().await
        .map_err(|e| format!("Failed to flush file: {}", e))?;
    
    
    // Verify the file exists
    if Path::new(&dest_path).exists() {
        let _metadata = std::fs::metadata(&dest_path)
            .map_err(|e| format!("Failed to get file metadata: {}", e))?;
    } else {
        error(Component::Transcription, "File does not exist after download!");
    }
    
    Ok(())
}

#[tauri::command]
async fn update_global_shortcut(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    shortcut: String,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    
    // Get the current shortcut and unregister it
    let global_shortcut = app.global_shortcut();
    let mut settings = state.settings.lock().await;
    let current = settings.get().ui.hotkey.clone();
    let _ = global_shortcut.unregister(current.as_str());
    
    // Clone app handle for the closure
    let app_handle = app.clone();
    
    // Register the new shortcut
    global_shortcut.on_shortcut(shortcut.as_str(), move |_app, _event, _shortcut| {
        // Note: Dynamic shortcuts currently always use toggle mode
        // TODO: Support recording mode in dynamic shortcuts
        if let Err(e) = app_handle.emit("toggle-recording", ()) {
            error(Component::UI, &format!("Failed to emit toggle-recording event: {}", e));
        }
    }).map_err(|e| format!("Failed to register shortcut '{}': {}", shortcut, e))?;
    
    // Update the stored shortcut
    settings.update(|s| s.ui.hotkey = shortcut.clone())
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let settings = state.settings.lock().await;
    serde_json::to_value(settings.get())
        .map_err(|e| format!("Failed to serialize settings: {}", e))
}

#[tauri::command]
async fn update_settings(state: State<'_, AppState>, new_settings: serde_json::Value) -> Result<(), String> {
    let mut settings = state.settings.lock().await;
    
    // Parse the new settings
    let app_settings: settings::AppSettings = serde_json::from_value(new_settings)
        .map_err(|e| format!("Invalid settings format: {}", e))?;
    
    // Update the settings
    settings.update(|s| *s = app_settings)?;
    
    Ok(())
}

// LLM Commands

#[tauri::command]
async fn get_available_llm_models(state: State<'_, AppState>) -> Result<Vec<llm::models::LLMModel>, String> {
    let models_dir = state.models_dir.join("llm");
    let settings = state.settings.lock().await;
    let active_model_id = &settings.get().llm.model_id;
    let model_manager = llm::models::ModelManager::new(models_dir);
    Ok(model_manager.list_models(active_model_id))
}

#[tauri::command]
async fn get_llm_model_info(state: State<'_, AppState>, model_id: String) -> Result<Option<llm::models::LLMModel>, String> {
    let models_dir = state.models_dir.join("llm");
    let model_manager = llm::models::ModelManager::new(models_dir);
    Ok(model_manager.list_models(&model_id).into_iter().find(|m| m.id == model_id))
}

#[tauri::command]
async fn download_llm_model(
    state: State<'_, AppState>,
    model_id: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let models_dir = state.models_dir.join("llm");
    let model_manager = llm::models::ModelManager::new(models_dir);
    
    // Find the model
    let models = model_manager.list_models(&model_id);
    let model = models.into_iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| format!("Model {} not found", model_id))?;
    
    // Download the model with progress updates
    model_manager.download_model_with_progress(&model, Some(&app)).await
        .map_err(|e| format!("Failed to download model: {}", e))?;
    
    // Emit success event
    app.emit("llm-model-downloaded", serde_json::json!({
        "model_id": model_id
    })).map_err(|e| format!("Failed to emit event: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn set_active_llm_model(state: State<'_, AppState>, model_id: String) -> Result<(), String> {
    let mut settings = state.settings.lock().await;
    settings.update(|s| s.llm.model_id = model_id.clone())
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn get_llm_outputs_for_transcript(
    state: State<'_, AppState>,
    transcript_id: i64,
) -> Result<Vec<db::LLMOutput>, String> {
    state.database.get_llm_outputs_for_transcript(transcript_id).await
}

#[tauri::command]
async fn get_whisper_logs_for_session(
    state: State<'_, AppState>,
    session_id: String,
    limit: Option<i32>,
) -> Result<Vec<serde_json::Value>, String> {
    state.database.get_whisper_logs_for_session(&session_id, limit).await
}

#[tauri::command]
async fn get_whisper_logs_for_transcript(
    state: State<'_, AppState>,
    transcript_id: i64,
    limit: Option<i32>,
) -> Result<Vec<serde_json::Value>, String> {
    state.database.get_whisper_logs_for_transcript(transcript_id, limit).await
}

#[tauri::command]
async fn get_performance_timeline_for_transcript(
    state: State<'_, AppState>,
    transcript_id: i64,
) -> Result<Vec<serde_json::Value>, String> {
    state.database.get_performance_timeline_for_transcript(transcript_id).await
}

#[tauri::command]
async fn get_llm_prompt_templates(
    state: State<'_, AppState>,
) -> Result<Vec<db::LLMPromptTemplate>, String> {
    state.database.get_llm_prompt_templates().await
}

#[tauri::command]
async fn save_llm_prompt_template(
    state: State<'_, AppState>,
    id: String,
    name: String,
    description: Option<String>,
    template: String,
    category: String,
    enabled: bool,
) -> Result<(), String> {
    state.database.save_llm_prompt_template(
        &id,
        &name,
        description.as_deref(),
        &template,
        &category,
        enabled,
    ).await
}

#[tauri::command]
async fn delete_llm_prompt_template(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.database.delete_llm_prompt_template(&id).await
}

#[tauri::command]
async fn update_llm_settings(
    state: State<'_, AppState>,
    enabled: bool,
    model_id: String,
    temperature: f32,
    max_tokens: u32,
    enabled_prompts: Vec<String>,
) -> Result<(), String> {
    let mut settings = state.settings.lock().await;
    settings.update(|s| {
        s.llm.enabled = enabled;
        s.llm.model_id = model_id;
        s.llm.temperature = temperature;
        s.llm.max_tokens = max_tokens;
        s.llm.enabled_prompts = enabled_prompts;
    }).map_err(|e| format!("Failed to save settings: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn set_auto_copy(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    let mut settings = state.settings.lock().await;
    settings.update(|s| s.ui.auto_copy = enabled)
}

#[tauri::command]
async fn is_auto_copy_enabled(state: State<'_, AppState>) -> Result<bool, String> {
    let settings = state.settings.lock().await;
    Ok(settings.get().ui.auto_copy)
}

#[tauri::command]
async fn set_auto_paste(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    let mut settings = state.settings.lock().await;
    settings.update(|s| s.ui.auto_paste = enabled)
}

#[tauri::command]
async fn is_auto_paste_enabled(state: State<'_, AppState>) -> Result<bool, String> {
    let settings = state.settings.lock().await;
    Ok(settings.get().ui.auto_paste)
}


#[tauri::command]
async fn get_push_to_talk_shortcut(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.settings.lock().await;
    Ok(settings.get().ui.push_to_talk_hotkey.clone())
}

#[tauri::command]
async fn update_push_to_talk_shortcut(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    shortcut: String,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    
    let global_shortcut = app.global_shortcut();
    let mut settings = state.settings.lock().await;
    
    // Unregister old push-to-talk shortcut
    let current = settings.get().ui.push_to_talk_hotkey.clone();
    let _ = global_shortcut.unregister(current.as_str());
    
    // Clone app handle for the closure
    let app_handle = app.clone();
    
    // Register the new push-to-talk shortcut
    global_shortcut.on_shortcut(shortcut.as_str(), move |_app, _event, _shortcut| {
        if let Err(e) = app_handle.emit("push-to-talk-pressed", ()) {
            error(Component::UI, &format!("Failed to emit push-to-talk-pressed event: {}", e));
        }
    }).map_err(|e| format!("Failed to register push-to-talk shortcut '{}': {}", shortcut, e))?;
    
    // Update keyboard monitor with new push-to-talk key
    state.keyboard_monitor.set_push_to_talk_key(&shortcut);
    
    // Update the stored shortcut
    settings.update(|s| s.ui.push_to_talk_hotkey = shortcut.clone())
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn paste_text() -> Result<(), String> {
    clipboard::simulate_paste()
}

#[tauri::command]
async fn play_success_sound() -> Result<(), String> {
    sound::SoundPlayer::play_success();
    Ok(())
}

#[tauri::command]
async fn set_overlay_waveform_style(state: State<'_, AppState>, style: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let overlay = state.native_panel_overlay.lock().await;
        overlay.set_waveform_style(&style);
    }
    Ok(())
}

#[tauri::command]
async fn get_log_file_path() -> Result<Option<String>, String> {
    Ok(logger::get_log_file_path().map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
async fn open_log_file() -> Result<(), String> {
    use std::process::Command;
    
    if let Some(log_path) = logger::get_log_file_path() {
        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .arg(&log_path)
                .spawn()
                .map_err(|e| format!("Failed to open log file: {}", e))?;
        }
        
        #[cfg(target_os = "windows")]
        {
            Command::new("notepad")
                .arg(&log_path)
                .spawn()
                .map_err(|e| format!("Failed to open log file: {}", e))?;
        }
        
        #[cfg(target_os = "linux")]
        {
            Command::new("xdg-open")
                .arg(&log_path)
                .spawn()
                .map_err(|e| format!("Failed to open log file: {}", e))?;
        }
        
        Ok(())
    } else {
        Err("No log file found".to_string())
    }
}

#[tauri::command]
async fn show_log_file_in_finder() -> Result<(), String> {
    use std::process::Command;
    
    if let Some(log_path) = logger::get_log_file_path() {
        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .arg("-R")  // Reveal in Finder
                .arg(&log_path)
                .spawn()
                .map_err(|e| format!("Failed to reveal log file in Finder: {}", e))?;
        }
        
        #[cfg(target_os = "windows")]
        {
            Command::new("explorer")
                .arg("/select,")
                .arg(&log_path)
                .spawn()
                .map_err(|e| format!("Failed to reveal log file in Explorer: {}", e))?;
        }
        
        #[cfg(target_os = "linux")]
        {
            // Try to reveal in file manager, fall back to opening directory
            if let Some(parent) = log_path.parent() {
                Command::new("xdg-open")
                    .arg(parent)
                    .spawn()
                    .map_err(|e| format!("Failed to open logs directory: {}", e))?;
            } else {
                return Err("Could not find logs directory".to_string());
            }
        }
        
        Ok(())
    } else {
        Err("No log file found".to_string())
    }
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize env_logger with our custom interceptor to capture whisper logs
    // Set RUST_LOG to capture whisper output at debug level
    std::env::set_var("RUST_LOG", "scout=info,whisper=debug,whisper_rs=debug");
    
    // Initialize env_logger as the base logger
    let env_logger = env_logger::Builder::from_default_env()
        .target(env_logger::Target::Stdout)
        .build();
    
    // Wrap it with our WhisperLogInterceptor
    let interceptor = whisper_log_interceptor::WhisperLogInterceptor::new(Box::new(env_logger));
    
    // Set the interceptor as the global logger
    log::set_boxed_logger(Box::new(interceptor))
        .expect("Failed to set logger");
    log::set_max_level(log::LevelFilter::Debug);
    
    // Install whisper-rs log trampoline to capture whisper.cpp logs
    whisper_rs::install_whisper_log_trampoline();
    info(Component::Transcription, "Installed whisper log trampoline for capturing whisper.cpp output");
    
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            
            // Initialize file-based logging
            if let Err(e) = logger::init_logger(&app_data_dir) {
                eprintln!("Failed to initialize file logger: {}", e);
            } else {
                info(Component::UI, &format!("Scout application starting - logs available at: {:?}", logger::get_log_file_path()));
            }
            
            let recordings_dir = app_data_dir.join("recordings");
            std::fs::create_dir_all(&recordings_dir).expect("Failed to create recordings directory");

            let db_path = app_data_dir.join("scout.db");
            let database = tauri::async_runtime::block_on(async {
                Database::new(&db_path).await.expect("Failed to initialize database")
            });

            let mut recorder = AudioRecorder::new();
            recorder.init();
            
            // Models directory in app data
            let models_dir = app_data_dir.join("models");
            std::fs::create_dir_all(&models_dir).expect("Failed to create models directory");
            
            // Verify the directory was created
            if models_dir.exists() && models_dir.is_dir() {
            } else {
                error(Component::Transcription, "Models directory was not created properly!");
            }
            
            // Initialize whisper logger
            if let Err(e) = whisper_logger::init_whisper_logger(&app_data_dir) {
                error(Component::Transcription, &format!("Failed to initialize whisper logger: {}", e));
            }
            
            // Initialize settings manager
            let settings_manager = SettingsManager::new(&app_data_dir)
                .expect("Failed to initialize settings manager");
            let settings_arc = Arc::new(Mutex::new(settings_manager));
            
            // Initialize the native overlay (disabled - using Tauri overlay window instead)
            #[cfg(target_os = "macos")]
            let native_overlay = Arc::new(Mutex::new(macos::MacOSOverlay::new()));
            // Don't show the native overlay since we're using the Tauri window
            
            let recorder_arc = Arc::new(Mutex::new(recorder));
            let database_arc = Arc::new(database);
            let progress_tracker = Arc::new(ProgressTracker::new());
            let progress_tracker_clone = progress_tracker.clone();
            
            // Create shared singleton transcriber instances
            let transcriber = Arc::new(Mutex::new(None::<Transcriber>));
            let current_model_path = Arc::new(Mutex::new(None::<PathBuf>));
            
            // Create the processing queue with shared transcriber
            let (processing_queue, mut processing_status_rx) = ProcessingQueue::new(
                database_arc.clone(),
                models_dir.clone(),
                app_data_dir.clone(),
                settings_arc.clone(),
                transcriber.clone(),
                current_model_path.clone(),
            );
            let processing_queue_arc = Arc::new(processing_queue);
            
            let performance_tracker = Arc::new(PerformanceTracker::new());
            
            let recording_workflow = Arc::new(RecordingWorkflow::new(
                recorder_arc.clone(),
                recordings_dir.clone(),
                progress_tracker.clone(),
                processing_queue_arc.clone(),
                database_arc.clone(),
                models_dir.clone(),
                app.handle().clone(),
                settings_arc.clone(),
                performance_tracker.clone(),
            ));
            
            // Audio level monitoring is done via polling from frontend, not events
            // This matches the original implementation in master branch
            
            // Initialize native NSPanel overlay
            #[cfg(target_os = "macos")]
            let native_panel_overlay = {
                let overlay = macos::NativeOverlay::new();
                let app_handle = app.handle().clone();
                
                // Set up callback for when recording starts from overlay
                overlay.set_on_start_recording(move || {
                    if let Err(e) = app_handle.emit("native-overlay-start-recording", ()) {
                        error(Component::UI, &format!("Failed to emit native-overlay-start-recording event: {}", e));
                    }
                });
                
                let app_handle = app.handle().clone();
                // Set up callback for when recording stops from overlay
                overlay.set_on_stop_recording(move || {
                    if let Err(e) = app_handle.emit("native-overlay-stop-recording", ()) {
                        error(Component::UI, &format!("Failed to emit native-overlay-stop-recording event: {}", e));
                    }
                });
                
                let app_handle = app.handle().clone();
                // Set up callback for when recording is cancelled from overlay
                overlay.set_on_cancel_recording(move || {
                    if let Err(e) = app_handle.emit("native-overlay-cancel-recording", ()) {
                        error(Component::UI, &format!("Failed to emit native-overlay-cancel-recording event: {}", e));
                    }
                });
                
                // Show the overlay at startup
                overlay.show();
                
                Arc::new(Mutex::new(overlay))
            };
            
            // Create keyboard monitor
            let keyboard_monitor = Arc::new(KeyboardMonitor::new(app.handle().clone()));
            
            let state = AppState {
                recorder: recorder_arc,
                database: database_arc,
                app_data_dir: app_data_dir.clone(),
                recordings_dir,
                models_dir,
                settings: settings_arc.clone(),
                is_recording_overlay_active: Arc::new(AtomicBool::new(false)),
                current_recording_file: Arc::new(Mutex::new(None)),
                progress_tracker,
                recording_workflow,
                processing_queue: processing_queue_arc,
                keyboard_monitor: keyboard_monitor.clone(),
                transcriber,
                current_model_path,
                performance_tracker,
                #[cfg(target_os = "macos")]
                native_overlay: native_overlay.clone(),
                #[cfg(target_os = "macos")]
                native_panel_overlay: native_panel_overlay.clone(),
            };
            
            app.manage(state);
            
            // Set up progress tracking listener to update native panel overlay
            {
                let mut receiver = progress_tracker_clone.subscribe();
                #[cfg(target_os = "macos")]
                let native_panel_clone = native_panel_overlay.clone();
                
                tauri::async_runtime::spawn(async move {
                    while receiver.changed().await.is_ok() {
                        let progress = receiver.borrow().clone();
                        
                        // Update native panel overlay based on progress state
                        #[cfg(target_os = "macos")]
                        {
                            let overlay = native_panel_clone.lock().await;
                            match &progress {
                                recording_progress::RecordingProgress::Idle => {
                                    debug(Component::Overlay, "Progress tracker → Idle: updating native overlay");
                                    overlay.set_idle_state();
                                }
                                recording_progress::RecordingProgress::Recording { .. } => {
                                    debug(Component::Overlay, "Progress tracker → Recording: updating native overlay");
                                    overlay.set_recording_state(true);
                                }
                                recording_progress::RecordingProgress::Stopping { .. } => {
                                    debug(Component::Overlay, "Progress tracker → Stopping: keeping native overlay in recording state");
                                    // Keep showing recording state during stopping
                                }
                            }
                            drop(overlay);
                        }
                    }
                });
            }
            
            // Set up processing status monitoring
            {
                let app_handle = app.handle().clone();
                #[cfg(target_os = "macos")]
                let _native_overlay_clone = native_panel_overlay.clone();
                
                tauri::async_runtime::spawn(async move {
                    while let Some(status) = processing_status_rx.recv().await {
                        // Emit processing status to frontend and overlay
                        let _ = app_handle.emit("processing-status", &status);
                        
                        
                        // Update native overlay based on processing status
                        #[cfg(target_os = "macos")]
                        {
                            match &status {
                                ProcessingStatus::Complete { .. } | ProcessingStatus::Failed { .. } => {
                                    // Processing is done - set overlay to idle
                                    debug(Component::UI, "Processing complete/failed - setting native overlay to idle");
                                    let overlay = _native_overlay_clone.lock().await;
                                    overlay.set_idle_state();
                                    drop(overlay);
                                }
                                ProcessingStatus::Transcribing { .. } => {
                                    // Transcription started - ensure overlay shows processing state
                                    debug(Component::UI, "Transcription started - setting native overlay to processing");
                                    let overlay = _native_overlay_clone.lock().await;
                                    overlay.set_processing_state(true);
                                    drop(overlay);
                                }
                                _ => {
                                    // Other states don't affect overlay
                                }
                            }
                        }
                        
                        // Log the status
                        match &status {
                            ProcessingStatus::Queued { position: _ } => {
                            }
                            ProcessingStatus::Processing { filename: _ } => {
                            }
                            ProcessingStatus::Converting { filename: _ } => {
                            }
                            ProcessingStatus::Transcribing { filename } => {
                                info(Component::Transcription, &format!("Transcribing file: {}", filename));
                            }
                            ProcessingStatus::Complete { filename, transcript } => {
                                info(Component::Transcription, &format!("Transcription complete for {}: {} chars", filename, transcript.len()));
                            }
                            ProcessingStatus::Failed { filename, error: err_msg } => {
                                error(Component::Processing, &format!("Processing failed for {}: {}", filename, err_msg));
                            }
                        }
                    }
                });
            }
            
            // Show native overlay on startup
            #[cfg(target_os = "macos")]
            {
                let overlay = tauri::async_runtime::block_on(native_panel_overlay.lock());
                overlay.show();
            }
            
            // Set up both global shortcuts from settings
            let app_handle = app.app_handle().clone();
            let (toggle_hotkey, push_to_talk_hotkey) = {
                let settings_lock = settings_arc.lock();
                let settings = tauri::async_runtime::block_on(settings_lock);
                (
                    settings.get().ui.hotkey.clone(),
                    settings.get().ui.push_to_talk_hotkey.clone()
                )
            };
            
            // Register toggle shortcut
            let app_handle_toggle = app_handle.clone();
            if let Err(e) = app.global_shortcut().on_shortcut(toggle_hotkey.as_str(), move |_app, _event, _shortcut| {
                if let Err(e) = app_handle_toggle.emit("toggle-recording", ()) {
                    error(Component::UI, &format!("Failed to emit toggle-recording event: {}", e));
                }
            }) {
                error(Component::UI, &format!("Failed to register toggle shortcut '{}': {:?}", toggle_hotkey, e));
            }
            
            // Register push-to-talk shortcut
            let app_handle_ptt = app_handle.clone();
            if let Err(e) = app.global_shortcut().on_shortcut(push_to_talk_hotkey.as_str(), move |_app, _event, _shortcut| {
                if let Err(e) = app_handle_ptt.emit("push-to-talk-pressed", ()) {
                    error(Component::UI, &format!("Failed to emit push-to-talk-pressed event: {}", e));
                }
            }) {
                error(Component::UI, &format!("Failed to register push-to-talk shortcut '{}': {:?}", push_to_talk_hotkey, e));
            }
            
            // Initialize keyboard monitor for push-to-talk key release detection
            // This is optional - if it fails, push-to-talk will still work but won't auto-stop
            keyboard_monitor.set_push_to_talk_key(&push_to_talk_hotkey);
            
            // Disable keyboard monitor to prevent crashes
            // The frontend-based solution will handle key release detection
            info(Component::UI, "Keyboard monitoring disabled - using frontend key detection");
            info(Component::UI, "Push-to-talk will work when Scout window has focus");
            
            // Only start if explicitly requested via environment variable
            if std::env::var("SCOUT_ENABLE_KEYBOARD_MONITOR").is_ok() {
                info(Component::UI, "Keyboard monitoring force-enabled via SCOUT_ENABLE_KEYBOARD_MONITOR");
                keyboard_monitor.clone().start_monitoring();
            }
            
            // Set up system tray
            let toggle_recording_item = MenuItemBuilder::with_id("toggle_recording", "Start Recording")
                .accelerator(&toggle_hotkey)
                .build(app)?;
            
            // Store reference to the menu item
            app.manage(toggle_recording_item.clone());
            
            let tray_menu = Menu::with_items(app, &[
                &MenuItemBuilder::with_id("show", "Show/Hide Window")
                    .accelerator("CmdOrCtrl+Shift+S")
                    .build(app)?,
                &toggle_recording_item,
                &PredefinedMenuItem::separator(app)?,
                &MenuItemBuilder::with_id("show_logs", "Show Logs")
                    .build(app)?,
                &MenuItemBuilder::with_id("quit", "Quit Scout")
                    .accelerator("CmdOrCtrl+Q")
                    .build(app)?
            ])?;
            
            // Load tray icon - try multiple paths to find the proper Scout icon
            let possible_paths = vec![
                "src-tauri/icons/scout-tray-icon.png",        // Development path - Scout logo
                "icons/scout-tray-icon.png",                  // Current directory - Scout logo
                "../src-tauri/icons/scout-tray-icon.png",     // Relative from target directory
                "../../src-tauri/icons/scout-tray-icon.png",  // Further relative
                "src-tauri/icons/tray-icon.png",              // Fallback to original (Tauri logo)
                "icons/tray-icon.png",                        // Fallback current directory
            ];
            
            let mut tray_icon = None;
            for path in possible_paths {
                if let Ok(icon) = tauri::image::Image::from_path(path) {
                    tray_icon = Some(icon);
                    info(Component::UI, &format!("Successfully loaded tray icon from: {}", path));
                    break;
                }
            }
            
            let tray_icon = tray_icon.unwrap_or_else(|| {
                warn(Component::UI, "Could not find Scout tray icon (scout-tray-icon.png), using default window icon");
                app.default_window_icon().unwrap().clone()
            });
            
            let _ = TrayIconBuilder::new()
                .icon(tray_icon)
                .tooltip("Scout - Local-first dictation")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                        "toggle_recording" => {
                            if let Err(e) = app.emit("toggle-recording", ()) {
                                error(Component::UI, &format!("Failed to emit toggle-recording event: {}", e));
                            }
                        }
                        "show_logs" => {
                            use std::process::Command;
                            
                            if let Some(log_path) = logger::get_log_file_path() {
                                #[cfg(target_os = "macos")]
                                {
                                    if let Err(e) = Command::new("open").arg("-R").arg(&log_path).spawn() {
                                        error(Component::UI, &format!("Failed to reveal log file from menu: {}", e));
                                    }
                                }
                                
                                #[cfg(target_os = "windows")]
                                {
                                    if let Err(e) = Command::new("explorer").arg("/select,").arg(&log_path).spawn() {
                                        error(Component::UI, &format!("Failed to reveal log file from menu: {}", e));
                                    }
                                }
                                
                                #[cfg(target_os = "linux")]
                                {
                                    if let Some(parent) = log_path.parent() {
                                        if let Err(e) = Command::new("xdg-open").arg(parent).spawn() {
                                            error(Component::UI, &format!("Failed to open logs directory from menu: {}", e));
                                        }
                                    }
                                }
                            } else {
                                error(Component::UI, "No log file found to show from menu");
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    match event {
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } => {
                            if let Some(window) = tray.app_handle().get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                        _ => {}
                    }
                })
                .build(app)?;
            
            // Handle window events to hide instead of close
            if let Some(main_window) = app.get_webview_window("main") {
                let window_for_events = main_window.clone();
                main_window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = &event {
                    // Hide window instead of closing
                    api.prevent_close();
                    let _ = window_for_events.hide();
                }
            });
            } else {
                warn(Component::UI, "Could not find main window for event handling");
            }
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            cancel_recording,
            is_recording,
            get_audio_devices,
            get_audio_devices_detailed,
            start_audio_level_monitoring,
            stop_audio_level_monitoring,
            get_current_audio_level,
            log_from_overlay,
            get_current_recording_file,
            transcribe_audio,
            save_transcript,
            get_performance_metrics,
            get_performance_metrics_for_transcript,
            get_performance_timeline,
            get_transcript,
            get_recent_transcripts,
            search_transcripts,
            read_audio_file,
            set_vad_enabled,
            is_vad_enabled,
            delete_transcript,
            delete_transcripts,
            export_transcripts,
            update_global_shortcut,
            subscribe_to_progress,
            get_overlay_position,
            set_overlay_position,
            set_overlay_treatment,
            download_model,
            check_microphone_permission,
            request_microphone_permission,
            open_system_preferences_audio,
            mark_onboarding_complete,
            get_processing_status,
            set_sound_enabled,
            is_sound_enabled,
            get_available_sounds,
            get_sound_settings,
            set_start_sound,
            set_stop_sound,
            set_success_sound,
            preview_sound_flow,
            get_current_shortcut,
            transcribe_file,
            get_available_models,
            has_any_model,
            set_active_model,
            get_models_dir,
            open_models_folder,
            download_file,
            get_settings,
            update_settings,
            // LLM commands
            get_available_llm_models,
            get_llm_model_info,
            download_llm_model,
            set_active_llm_model,
            get_llm_outputs_for_transcript,
            get_whisper_logs_for_session,
            get_whisper_logs_for_transcript,
            get_performance_timeline_for_transcript,
            get_llm_prompt_templates,
            save_llm_prompt_template,
            delete_llm_prompt_template,
            update_llm_settings,
            get_current_model,
            set_auto_copy,
            is_auto_copy_enabled,
            set_auto_paste,
            is_auto_paste_enabled,
            get_push_to_talk_shortcut,
            update_push_to_talk_shortcut,
            paste_text,
            play_success_sound,
            set_overlay_waveform_style,
            get_log_file_path,
            open_log_file,
            show_log_file_in_finder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    // ... existing code ...
}
