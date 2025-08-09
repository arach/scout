mod audio;
pub mod commands;
pub mod strategies;
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
mod file_based_ring_buffer_monitor;
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
mod dictionary_processor;
pub mod benchmarking;
mod llm;
mod whisper_logger;
mod whisper_log_interceptor;
pub mod services;
mod performance_tracker;
pub mod model_state;
mod webhooks;
mod foundation_models;
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
use crate::model_state::ModelStateManager;
use std::sync::OnceLock;

/// Global storage for the current device sample rate
static DEVICE_SAMPLE_RATE: OnceLock<Arc<Mutex<Option<u32>>>> = OnceLock::new();

/// Global storage for the current device channel count
static DEVICE_CHANNELS: OnceLock<Arc<Mutex<Option<u16>>>> = OnceLock::new();

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

/// Get the current device channel count from the global cache
/// This is used by transcription strategies to avoid hardcoding channel count
pub fn get_current_device_channels() -> Option<u16> {
    let channels_storage = DEVICE_CHANNELS.get_or_init(|| Arc::new(Mutex::new(None)));
    
    // Use try_lock to avoid blocking if the mutex is held
    if let Ok(channels) = channels_storage.try_lock() {
        *channels
    } else {
        None
    }
}

/// Update the cached device channel count (called from the audio recorder)
pub fn update_device_channels(channels: u16) {
    let channels_storage = DEVICE_CHANNELS.get_or_init(|| Arc::new(Mutex::new(None)));
    
    if let Ok(mut ch) = channels_storage.try_lock() {
        *ch = Some(channels);
        info(Component::Recording, &format!("Updated global device channels to: {}", channels));
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
    pub model_state_manager: Arc<ModelStateManager>,
    #[cfg(target_os = "macos")]
    pub native_overlay: Arc<Mutex<macos::MacOSOverlay>>,
    #[cfg(target_os = "macos")]
    pub native_panel_overlay: Arc<Mutex<macos::NativeOverlay>>,
}


// Cleaned: moved command implementations to commands/* modules

#[tauri::command]
async fn download_model(
    app: tauri::AppHandle,
    model_name: String,
    model_url: String,
) -> Result<(), String> {
    
    
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
        info(Component::Transcription, &format!("Model {} already exists, skipping download", model_name));
        return Ok(());
    }
    
    // Download the GGML model
    download_file_with_progress(&app, &model_url, &dest_path, "model").await?;
    
    // Get model state manager from app state
    let state: State<AppState> = app.state();
    
    // Mark model as downloaded (CoreML can be downloaded separately later)
    state.model_state_manager.mark_model_downloaded(&model_name, false).await;
    
    info(Component::Transcription, &format!("Model {} downloaded successfully", model_name));
    
    Ok(())
}

// moved to commands::models
#[cfg(target_os = "macos")]
async fn download_coreml_model(
    app: &tauri::AppHandle,
    model_name: &str,
    models_dir: &std::path::Path,
) -> Result<(), String> {
    
    
    // Construct Core ML URL based on model name
    let coreml_url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}-encoder.mlmodelc.zip?download=true",
        model_name
    );
    
    let coreml_filename = format!("ggml-{}-encoder.mlmodelc", model_name);
    let coreml_path = models_dir.join(&coreml_filename);
    
    // Check if Core ML model already exists
    if coreml_path.exists() {
        info(Component::Transcription, &format!("Core ML model already exists: {}", coreml_filename));
        return Ok(());
    }
    
    info(Component::Transcription, &format!("Downloading Core ML model for {}", model_name));
    
    // Download the zip file
    let zip_path = models_dir.join(format!("{}.zip", coreml_filename));
    download_file_with_progress(app, &coreml_url, &zip_path, "coreml").await?;
    
    // Extract the zip file
    extract_coreml_model(&zip_path, &coreml_path)?;
    
    // Clean up zip file
    let _ = std::fs::remove_file(&zip_path);
    
    info(Component::Transcription, &format!("Core ML model downloaded and extracted: {}", coreml_filename));
    
    Ok(())
}

// moved to commands::models
#[cfg(target_os = "macos")]
fn extract_coreml_model(zip_path: &std::path::Path, dest_path: &std::path::Path) -> Result<(), String> {
    use std::process::Command;
    
    // Use system unzip command for simplicity
    let output = Command::new("unzip")
        .arg("-q") // Quiet mode
        .arg("-o") // Overwrite
        .arg(zip_path)
        .arg("-d")
        .arg(dest_path.parent().unwrap())
        .output()
        .map_err(|e| format!("Failed to run unzip: {}", e))?;
    
    if !output.status.success() {
        return Err(format!("Failed to extract Core ML model: {}", 
            String::from_utf8_lossy(&output.stderr)));
    }
    
    Ok(())
}

// moved to services::downloads

#[tauri::command]
async fn check_and_download_missing_coreml_models(
    app: tauri::AppHandle,
    state: State<'_, AppState>
) -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let models_dir = state.models_dir.clone();
        let settings_manager = state.settings.lock().await;
        let settings = settings_manager.get();
        let models = models::WhisperModel::all(&models_dir, settings);
        drop(settings_manager);
        
        let mut downloaded_models = Vec::new();
        
        for model in models {
            // Check if GGML model is downloaded but Core ML is not
            if model.downloaded && !model.coreml_downloaded && model.coreml_url.is_some() {
                info(Component::Models, &format!("Found model {} with missing Core ML, downloading...", model.id));
                
                // Download the Core ML model
                if let Err(e) = download_coreml_model(&app, &model.id, &models_dir).await {
                    error(Component::Models, &format!("Failed to download Core ML for {}: {}", model.id, e));
                } else {
                    downloaded_models.push(model.id.clone());
                }
            }
        }
        
        Ok(downloaded_models)
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }
}

#[tauri::command]
async fn download_coreml_for_model(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    model_id: String
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let models_dir = state.models_dir.clone();
        download_coreml_model(&app, &model_id, &models_dir).await?;
        
        // Update model state to reflect CoreML availability
        state.model_state_manager.mark_coreml_downloaded(&model_id).await;
        
        Ok(())
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        Err("Core ML is only supported on macOS".to_string())
    }
}

#[tauri::command]
async fn check_microphone_permission() -> Result<String, String> {
    // For now, just check if we can access audio devices
    // If we can enumerate devices, we likely have permission
    #[cfg(target_os = "macos")]
    {
        use cpal::traits::HostTrait;
        
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

// moved to commands::misc

// Moved to commands/transcripts.rs

// moved to commands::transcripts

// moved to commands::transcripts

fn format_duration(ms: i32) -> String {
    let seconds = ms / 1000;
    let minutes = seconds / 60;
    let remaining_seconds = seconds % 60;
    format!("{}:{:02}", minutes, remaining_seconds)
}

// moved to commands::misc

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
async fn update_completion_sound_threshold(state: State<'_, AppState>, threshold_ms: i32) -> Result<(), String> {
    let mut settings = state.settings.lock().await;
    settings.update(|s| s.ui.completion_sound_threshold_ms = threshold_ms as u64)
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    Ok(())
}

// moved to commands::shortcuts

// moved to commands::models

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
async fn get_model_coreml_status(state: State<'_, AppState>, model_id: String) -> Result<crate::model_state::CoreMLState, String> {
    if let Some(model_state) = state.model_state_manager.get_state(&model_id).await {
        Ok(model_state.coreml_state)
    } else {
        Ok(crate::model_state::CoreMLState::NotDownloaded)
    }
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

// moved to commands::downloads

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

// moved to commands::settings

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

// moved to commands::settings


// moved to commands::shortcuts

// moved to commands::shortcuts

// moved to commands::misc

// moved to commands::sounds

// moved to commands::overlay

// moved to commands::logs

// moved to commands::logs

// moved to commands::logs


// moved to commands::dictionary



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
            
            // Create app data directory with secure permissions (700 - owner only)
            if !app_data_dir.exists() {
                std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data directory");
                #[cfg(target_os = "macos")]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let permissions = std::fs::Permissions::from_mode(0o700);
                    std::fs::set_permissions(&app_data_dir, permissions)
                        .expect("Failed to set secure permissions on app data directory");
                }
            }
            
            // Initialize file-based logging
            if let Err(e) = logger::init_logger(&app_data_dir) {
                eprintln!("Failed to initialize file logger: {}", e);
            } else {
                info(Component::UI, &format!("Scout application starting - logs available at: {:?}", logger::get_log_file_path()));
            }
            
            // Create subdirectories with secure permissions
            let recordings_dir = app_data_dir.join("recordings");
            std::fs::create_dir_all(&recordings_dir).expect("Failed to create recordings directory");
            #[cfg(target_os = "macos")]
            {
                use std::os::unix::fs::PermissionsExt;
                let permissions = std::fs::Permissions::from_mode(0o700);
                let _ = std::fs::set_permissions(&recordings_dir, permissions);
            }

            let db_path = app_data_dir.join("scout.db");
            let database = tauri::async_runtime::block_on(async {
                Database::new(&db_path).await.expect("Failed to initialize database")
            });

            let mut recorder = AudioRecorder::new();
            recorder.init();
            
            // Models directory in app data with secure permissions
            let models_dir = app_data_dir.join("models");
            std::fs::create_dir_all(&models_dir).expect("Failed to create models directory");
            #[cfg(target_os = "macos")]
            {
                use std::os::unix::fs::PermissionsExt;
                let permissions = std::fs::Permissions::from_mode(0o700);
                let _ = std::fs::set_permissions(&models_dir, permissions);
            }
            
            // Verify the directory was created
            if models_dir.exists() && models_dir.is_dir() {
            } else {
                error(Component::Transcription, "Models directory was not created properly!");
            }
            
            // Initialize model state manager
            let model_state_manager = Arc::new(ModelStateManager::new(&app_data_dir));
            
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
                model_state_manager.clone(),
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
                models_dir: models_dir.clone(),
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
                model_state_manager: model_state_manager.clone(),
                #[cfg(target_os = "macos")]
                native_overlay: native_overlay.clone(),
                #[cfg(target_os = "macos")]
                native_panel_overlay: native_panel_overlay.clone(),
            };
            
            app.manage(state);
            
            // Preload sounds to avoid first-play delay
            sound::SoundPlayer::preload_sounds();
            
            // Warm up audio system to avoid first-record delay
            {
                use cpal::traits::{DeviceTrait, HostTrait};
                if let Some(device) = cpal::default_host().default_input_device() {
                    let _ = device.name(); // Just accessing device warms up the audio subsystem
                    info(Component::Recording, "Audio system warmed up");
                }
            }
            
            // Start background Core ML model warming
            {
                let model_state_manager_clone = model_state_manager.clone();
                let models_dir_clone = models_dir.clone();
                tauri::async_runtime::spawn(async move {
                    // Start CoreML warming immediately - no artificial delay needed
                    model_state::warm_coreml_models(model_state_manager_clone, models_dir_clone).await;
                });
            }
            
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
            // Moved/organized commands first (clarity on what remains below)
            crate::commands::get_settings,
            crate::commands::update_settings,
            crate::commands::set_auto_copy,
            crate::commands::is_auto_copy_enabled,
            crate::commands::set_auto_paste,
            crate::commands::is_auto_paste_enabled,
            crate::commands::get_overlay_position,
            crate::commands::set_overlay_position,
            crate::commands::set_overlay_treatment,
            crate::commands::get_audio_devices,
            crate::commands::get_audio_devices_detailed,
            crate::commands::start_audio_level_monitoring,
            crate::commands::stop_audio_level_monitoring,
            crate::commands::get_current_audio_level,
            crate::commands::transcribe_audio,
            crate::commands::transcribe_file,
            crate::commands::save_transcript,
            crate::commands::get_transcript,
            crate::commands::get_transcript_with_audio_details,
            crate::commands::get_recent_transcripts,
            crate::commands::search_transcripts,
            crate::commands::delete_transcript,
            crate::commands::delete_transcripts,
            crate::commands::export_transcripts,
            crate::commands::export_audio_file,
            crate::commands::start_recording_no_transcription,
            crate::commands::stop_recording_no_transcription,
            crate::commands::start_recording_classic_strategy,
            crate::commands::start_recording_ring_buffer_no_callbacks,
            crate::commands::start_recording_simple_callback_test,
            crate::commands::test_simple_recording,
            crate::commands::test_device_config_consistency,
            crate::commands::test_voice_with_sample_rate_mismatch,
            crate::commands::test_sample_rate_mismatch_reproduction,
            crate::commands::test_multiple_scout_recordings,
            crate::commands::test_scout_pipeline_recording,
            crate::commands::analyze_audio_corruption,
            crate::commands::serve_audio_file,
            crate::commands::start_recording,
            crate::commands::stop_recording,
            crate::commands::cancel_recording,
            crate::commands::is_recording,
            crate::commands::log_from_overlay,
            crate::commands::get_current_recording_file,
            crate::commands::update_global_shortcut,
            crate::commands::subscribe_to_progress,
            crate::commands::download_model,
            crate::commands::check_and_download_missing_coreml_models,
            crate::commands::download_coreml_for_model,
            crate::commands::get_model_coreml_status,
            crate::commands::check_microphone_permission,
            crate::commands::request_microphone_permission,
            crate::commands::open_system_preferences_audio,
            crate::commands::set_sound_enabled,
            crate::commands::is_sound_enabled,
            crate::commands::get_available_sounds,
            crate::commands::get_sound_settings,
            crate::commands::set_start_sound,
            crate::commands::set_stop_sound,
            crate::commands::set_success_sound,
            crate::commands::preview_sound_flow,
            crate::commands::update_completion_sound_threshold,
            crate::commands::get_available_models,
            crate::commands::has_any_model,
            crate::commands::set_active_model,
            crate::commands::get_models_dir,
            crate::commands::open_models_folder,
            // LLM commands
            crate::commands::get_available_llm_models,
            crate::commands::get_llm_model_info,
            crate::commands::download_llm_model,
            crate::commands::set_active_llm_model,
            crate::commands::get_llm_outputs_for_transcript,
            crate::commands::get_whisper_logs_for_session,
            crate::commands::get_whisper_logs_for_transcript,
            crate::commands::get_llm_prompt_templates,
            crate::commands::save_llm_prompt_template,
            crate::commands::delete_llm_prompt_template,
            crate::commands::update_llm_settings,
            crate::commands::get_push_to_talk_shortcut,
            crate::commands::update_push_to_talk_shortcut,
            crate::commands::get_log_file_path,
            crate::commands::open_log_file,
            crate::commands::show_log_file_in_finder,
            // Misc and utility
            crate::commands::mark_onboarding_complete,
            crate::commands::get_processing_status,
            crate::commands::paste_text,
            crate::commands::play_success_sound,
            crate::commands::set_overlay_waveform_style,
            crate::commands::download_file,
            crate::commands::get_current_shortcut,
            crate::commands::get_current_model,
            // Dictionary commands
            crate::commands::get_dictionary_entries,
            crate::commands::save_dictionary_entry,
            crate::commands::update_dictionary_entry,
            crate::commands::delete_dictionary_entry,
            crate::commands::get_dictionary_matches_for_transcript,
            crate::commands::test_dictionary_replacement,
            // Webhook commands
            webhooks::get_webhooks,
            webhooks::create_webhook,
            webhooks::update_webhook,
            webhooks::delete_webhook,
            webhooks::test_webhook,
            webhooks::get_webhook_logs,
            webhooks::cleanup_webhook_logs,
            crate::commands::get_recording_stats,
            crate::commands::generate_sample_data,
            // Foundation Models commands
            foundation_models::enhance_transcript,
            foundation_models::summarize_transcript,
            foundation_models::clean_speech_patterns,
            foundation_models::extract_structured_data,
            foundation_models::format_transcript,
            foundation_models::check_foundation_models_availability
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    // ... existing code ...
}
