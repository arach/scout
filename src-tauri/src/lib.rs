// Public API modules
pub mod benchmarking;
pub mod commands;
pub mod db;
pub mod services;
pub mod transcription;

// Re-export commonly used types for backward compatibility
pub use models::model_state;
pub use monitoring::performance_tracker;
pub use monitoring::performance_logger;
pub use monitoring::performance_metrics_service;
pub use core::recording_progress;
pub use core::transcription_context;
pub use monitoring::whisper_log_interceptor;
pub use monitoring::whisper_logger;
pub use post_processing::{dictionary_processor, profanity_filter, PostProcessingHooks};

// Internal modules - organized by domain
mod audio;

// Core functionality - kept at root for wide usage
mod processing_queue;
mod recording_workflow;
mod settings;
mod logger;

// Core functionality - organized
mod core;

// External integrations
mod integrations;

// Model management
mod models;
mod foundation_models;

// Monitoring and logging
mod monitoring;

// Post-processing pipeline
mod post_processing;
mod llm;

// UI components
mod ui;

// Utilities
mod utils;

// External services
mod webhooks;

#[cfg(target_os = "macos")]
mod macos;

use std::{
    path::PathBuf,
    sync::{atomic::AtomicBool, Arc, OnceLock},
};

use tauri::{
    menu::{Menu, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tokio::sync::Mutex;

use crate::{
    audio::AudioRecorder,
    db::Database,
    integrations::keyboard_monitor::KeyboardMonitor,
    processing_queue::{ProcessingQueue, ProcessingStatus},
    core::recording_progress::ProgressTracker,
    recording_workflow::RecordingWorkflow,
    settings::SettingsManager,
    logger::{debug, error, info, warn, Component},
    models::model_state::ModelStateManager,
    monitoring::performance_tracker::PerformanceTracker,
    transcription::Transcriber,
};

static DEVICE_SAMPLE_RATE: OnceLock<Arc<Mutex<Option<u32>>>> = OnceLock::new();
static DEVICE_CHANNELS: OnceLock<Arc<Mutex<Option<u16>>>> = OnceLock::new();

pub fn get_current_device_sample_rate() -> Option<u32> {
    let rate_storage = DEVICE_SAMPLE_RATE.get_or_init(|| Arc::new(Mutex::new(None)));
    if let Ok(rate) = rate_storage.try_lock() {
        *rate
    } else {
        None
    }
}

pub fn update_device_sample_rate(sample_rate: u32) {
    let rate_storage = DEVICE_SAMPLE_RATE.get_or_init(|| Arc::new(Mutex::new(None)));
    if let Ok(mut rate) = rate_storage.try_lock() {
        *rate = Some(sample_rate);
        info(Component::Recording, &format!("Updated global device sample rate to: {} Hz", sample_rate));
    }
}

pub fn get_current_device_channels() -> Option<u16> {
    let channels_storage = DEVICE_CHANNELS.get_or_init(|| Arc::new(Mutex::new(None)));
    if let Ok(channels) = channels_storage.try_lock() {
        *channels
    } else {
        None
    }
}

pub fn update_device_channels(channels: u16) {
    let channels_storage = DEVICE_CHANNELS.get_or_init(|| Arc::new(Mutex::new(None)));
    if let Ok(mut ch) = channels_storage.try_lock() {
        *ch = Some(channels);
        info(Component::Recording, &format!("Updated global device channels to: {}", channels));
    }
}

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
    pub native_panel_overlay: Arc<Mutex<macos::NativeOverlay>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::env::set_var("RUST_LOG", "scout=info,whisper=debug,whisper_rs=debug");

    let env_logger = env_logger::Builder::from_default_env()
        .target(env_logger::Target::Stdout)
        .build();

    let interceptor = whisper_log_interceptor::WhisperLogInterceptor::new(Box::new(env_logger));

    log::set_boxed_logger(Box::new(interceptor))
        .expect("Failed to set logger");
    log::set_max_level(log::LevelFilter::Debug);

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

            if let Err(e) = logger::init_logger(&app_data_dir) {
                eprintln!("Failed to initialize file logger: {}", e);
            } else {
                info(Component::UI, &format!("Scout application starting - logs available at: {:?}", logger::get_log_file_path()));
            }

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

            let models_dir = app_data_dir.join("models");
            std::fs::create_dir_all(&models_dir).expect("Failed to create models directory");
            #[cfg(target_os = "macos")]
            {
                use std::os::unix::fs::PermissionsExt;
                let permissions = std::fs::Permissions::from_mode(0o700);
                let _ = std::fs::set_permissions(&models_dir, permissions);
            }

            if !(models_dir.exists() && models_dir.is_dir()) {
                error(Component::Transcription, "Models directory was not created properly!");
            }

            let model_state_manager = Arc::new(ModelStateManager::new(&app_data_dir));

            if let Err(e) = whisper_logger::init_whisper_logger(&app_data_dir) {
                error(Component::Transcription, &format!("Failed to initialize whisper logger: {}", e));
            }

            let settings_manager = SettingsManager::new(&app_data_dir)
                .expect("Failed to initialize settings manager");
            let settings_arc = Arc::new(Mutex::new(settings_manager));

            let recorder_arc = Arc::new(Mutex::new(recorder));
            let database_arc = Arc::new(database);
            let progress_tracker = Arc::new(ProgressTracker::new());
            let progress_tracker_clone = progress_tracker.clone();

            let transcriber = Arc::new(Mutex::new(None::<Transcriber>));
            let current_model_path = Arc::new(Mutex::new(None::<PathBuf>));

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

                overlay.set_on_start_recording(move || {
                    if let Err(e) = app_handle.emit("native-overlay-start-recording", ()) {
                        error(Component::UI, &format!("Failed to emit native-overlay-start-recording event: {}", e));
                    }
                });

                let app_handle = app.handle().clone();
                overlay.set_on_stop_recording(move || {
                    if let Err(e) = app_handle.emit("native-overlay-stop-recording", ()) {
                        error(Component::UI, &format!("Failed to emit native-overlay-stop-recording event: {}", e));
                    }
                });

                let app_handle = app.handle().clone();
                overlay.set_on_cancel_recording(move || {
                    if let Err(e) = app_handle.emit("native-overlay-cancel-recording", ()) {
                        error(Component::UI, &format!("Failed to emit native-overlay-cancel-recording event: {}", e));
                    }
                });

                overlay.show();

                Arc::new(Mutex::new(overlay))
            };

            let keyboard_monitor = Arc::new(KeyboardMonitor::new(app.handle().clone()));
            keyboard_monitor.clone().start_monitoring();
            
            // Set the initial push-to-talk key from settings
            {
                let settings = tauri::async_runtime::block_on(settings_arc.lock());
                let push_to_talk_key = &settings.get().ui.push_to_talk_hotkey;
                if !push_to_talk_key.is_empty() {
                    keyboard_monitor.set_push_to_talk_key(push_to_talk_key);
                    info(Component::UI, &format!("Set initial push-to-talk key: {}", push_to_talk_key));
                }
            }

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
                native_panel_overlay: native_panel_overlay.clone(),
            };

            app.manage(state);

            ui::sound::SoundPlayer::preload_sounds();
            
            // Warm up audio system to avoid first-record delay
            {
                use cpal::traits::{DeviceTrait, HostTrait};
                if let Some(device) = cpal::default_host().default_input_device() {
                    let _ = device.name(); // Just accessing device warms up the audio subsystem
                    info(Component::Recording, "Audio system warmed up");
                }
            }

            {
                let model_state_manager_clone = model_state_manager.clone();
                let models_dir_clone = models_dir.clone();
                tauri::async_runtime::spawn(async move {
                    model_state::warm_coreml_models(model_state_manager_clone, models_dir_clone).await;
                });
            }

            {
                let mut receiver = progress_tracker_clone.subscribe();
                #[cfg(target_os = "macos")]
                let native_panel_clone = native_panel_overlay.clone();

                tauri::async_runtime::spawn(async move {
                    while receiver.changed().await.is_ok() {
                        let progress = receiver.borrow().clone();
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
                                }
                            }
                            drop(overlay);
                        }
                    }
                });
            }

            {
                let app_handle = app.handle().clone();
                #[cfg(target_os = "macos")]
                let _native_overlay_clone = native_panel_overlay.clone();

                tauri::async_runtime::spawn(async move {
                    while let Some(status) = processing_status_rx.recv().await {
                        let _ = app_handle.emit("processing-status", &status);

                        #[cfg(target_os = "macos")]
                        {
                            match &status {
                                ProcessingStatus::Complete { .. } | ProcessingStatus::Failed { .. } => {
                                    debug(Component::UI, "Processing complete/failed - setting native overlay to idle");
                                    let overlay = _native_overlay_clone.lock().await;
                                    overlay.set_idle_state();
                                    drop(overlay);
                                }
                                ProcessingStatus::Transcribing { .. } => {
                                    debug(Component::UI, "Transcription started - setting native overlay to processing");
                                    let overlay = _native_overlay_clone.lock().await;
                                    overlay.set_processing_state(true);
                                    drop(overlay);
                                }
                                _ => {}
                            }
                        }

                        match &status {
                            ProcessingStatus::Queued { position: _ } => {}
                            ProcessingStatus::Processing { filename: _ } => {}
                            ProcessingStatus::Converting { filename: _ } => {}
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

            #[cfg(target_os = "macos")]
            {
                let overlay = tauri::async_runtime::block_on(native_panel_overlay.lock());
                overlay.show();
            }

            let app_handle = app.app_handle().clone();
            let (toggle_hotkey, push_to_talk_hotkey) = {
                let settings_lock = settings_arc.lock();
                let settings = tauri::async_runtime::block_on(settings_lock);
                (
                    settings.get().ui.hotkey.clone(),
                    settings.get().ui.push_to_talk_hotkey.clone()
                )
            };

            let app_handle_toggle = app_handle.clone();
            if let Err(e) = app.global_shortcut().on_shortcut(toggle_hotkey.as_str(), move |_app, _event, _shortcut| {
                if let Err(e) = app_handle_toggle.emit("toggle-recording", ()) {
                    error(Component::UI, &format!("Failed to emit toggle-recording event: {}", e));
                }
            }) {
                error(Component::UI, &format!("Failed to register toggle shortcut '{}': {:?}", toggle_hotkey, e));
            }

            let app_handle_ptt = app_handle.clone();
            if let Err(e) = app.global_shortcut().on_shortcut(push_to_talk_hotkey.as_str(), move |_app, _event, _shortcut| {
                if let Err(e) = app_handle_ptt.emit("push-to-talk-pressed", ()) {
                    error(Component::UI, &format!("Failed to emit push-to-talk-pressed event: {}", e));
                }
            }) {
                error(Component::UI, &format!("Failed to register push-to-talk shortcut '{}': {:?}", push_to_talk_hotkey, e));
            }

            keyboard_monitor.set_push_to_talk_key(&push_to_talk_hotkey);

            info(Component::UI, "Keyboard monitoring disabled - using frontend key detection");
            info(Component::UI, "Push-to-talk will work when Scout window has focus");

            if std::env::var("SCOUT_ENABLE_KEYBOARD_MONITOR").is_ok() {
                info(Component::UI, "Keyboard monitoring force-enabled via SCOUT_ENABLE_KEYBOARD_MONITOR");
                keyboard_monitor.clone().start_monitoring();
            }

            let toggle_recording_item = MenuItemBuilder::with_id("toggle_recording", "Start Recording")
                .accelerator(&toggle_hotkey)
                .build(app)?;

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

            let tray_icon = {
                #[cfg(debug_assertions)]
                {
                    // In development, load from the icons directory
                    let icon_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("icons/tray-icon.png");
                    tauri::image::Image::from_path(icon_path)
                        .unwrap_or_else(|_| app.default_window_icon().unwrap().clone())
                }
                
                #[cfg(not(debug_assertions))]
                {
                    // In production, load from bundled resources
                    use tauri::path::BaseDirectory;
                    app.path()
                        .resolve("icons/tray-icon.png", BaseDirectory::Resource)
                        .ok()
                        .and_then(|path| tauri::image::Image::from_path(path).ok())
                        .unwrap_or_else(|| app.default_window_icon().unwrap().clone())
                }
            };

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

            if let Some(main_window) = app.get_webview_window("main") {
                let window_for_events = main_window.clone();
                main_window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = &event {
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
            crate::commands::read_audio_file,
            crate::commands::start_recording,
            crate::commands::stop_recording,
            crate::commands::cancel_recording,
            crate::commands::force_reset_recording,
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
            crate::commands::mark_onboarding_complete,
            crate::commands::get_processing_status,
            crate::commands::paste_text,
            crate::commands::play_success_sound,
            crate::commands::play_loading_sound,
            crate::commands::play_transition_sound,
            crate::commands::play_save_sound,
            crate::commands::set_overlay_waveform_style,
            crate::commands::download_file,
            crate::commands::get_current_shortcut,
            crate::commands::get_current_model,
            crate::commands::get_dictionary_entries,
            crate::commands::save_dictionary_entry,
            crate::commands::update_dictionary_entry,
            crate::commands::delete_dictionary_entry,
            crate::commands::get_dictionary_matches_for_transcript,
            crate::commands::test_dictionary_replacement,
            webhooks::get_webhooks,
            webhooks::create_webhook,
            webhooks::update_webhook,
            webhooks::delete_webhook,
            webhooks::test_webhook,
            webhooks::get_webhook_logs,
            webhooks::cleanup_webhook_logs,
            crate::commands::get_recording_stats,
            crate::commands::generate_sample_data,
            crate::commands::get_performance_metrics_for_transcript,
            crate::commands::get_performance_timeline_for_transcript,
            foundation_models::enhance_transcript,
            foundation_models::summarize_transcript,
            foundation_models::clean_speech_patterns,
            foundation_models::extract_structured_data,
            foundation_models::format_transcript,
            foundation_models::check_foundation_models_availability,
            crate::commands::check_transcriber_installed,
            crate::commands::get_transcriber_version,
            crate::commands::check_external_service_status,
            crate::commands::test_external_service,
            crate::commands::test_external_service_with_audio,
            crate::commands::start_external_service,
            crate::commands::stop_external_service,
            crate::commands::open_url,
            crate::commands::kill_orphaned_processes,
            crate::commands::get_process_status,
            crate::commands::get_process_stats,
            crate::commands::force_kill_process,
            crate::commands::check_service_health,
            crate::commands::get_control_plane_status,
            crate::commands::restart_unhealthy_services,
            crate::commands::get_dev_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
