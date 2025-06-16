mod audio;
mod db;
mod transcription;
mod recording_progress;
mod recording_workflow;
mod processing_queue;
mod overlay_position;
#[cfg(target_os = "macos")]
mod macos;

use audio::AudioRecorder;
use db::Database;
use overlay_position::OverlayPosition;
use processing_queue::{ProcessingQueue, ProcessingStatus};
use recording_progress::ProgressTracker;
use recording_workflow::RecordingWorkflow;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, State, WindowEvent};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, MenuItemBuilder};
use tokio::sync::Mutex;

pub struct AppState {
    pub recorder: Arc<Mutex<AudioRecorder>>,
    pub database: Arc<Database>,
    pub recordings_dir: PathBuf,
    pub models_dir: PathBuf,
    pub current_shortcut: Arc<Mutex<String>>,
    pub is_recording_overlay_active: Arc<AtomicBool>,
    pub current_recording_file: Arc<Mutex<Option<String>>>,
    pub progress_tracker: Arc<ProgressTracker>,
    pub recording_workflow: Arc<RecordingWorkflow>,
    pub processing_queue: Arc<ProcessingQueue>,
    pub overlay_position: Arc<Mutex<OverlayPosition>>,
    #[cfg(target_os = "macos")]
    pub native_overlay: Arc<Mutex<macos::MacOSOverlay>>,
}

#[tauri::command]
async fn start_recording(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<String, String> {
    // Check if already recording
    if state.progress_tracker.is_busy() {
        println!("WARNING: Attempted to start recording while already recording");
        return Err("Recording already in progress".to_string());
    }
    
    // Double-check with the audio recorder
    let recorder = state.recorder.lock().await;
    if recorder.is_recording() {
        drop(recorder);
        println!("WARNING: Audio recorder is already recording");
        return Err("Audio recorder is already active".to_string());
    }
    drop(recorder);
    // Use the recording workflow to start recording
    let filename = state.recording_workflow.start_recording().await?;
    
    // Progress is already updated by recording_workflow, no need to update again
    
    // Store the current recording filename
    *state.current_recording_file.lock().await = Some(filename.clone());

    // Update tray menu item text
    if let Some(menu_item) = app.try_state::<MenuItem<tauri::Wry>>() {
        let _ = menu_item.set_text("Stop Recording");
    }

    // Show native overlay on macOS
    #[cfg(target_os = "macos")]
    {
        let overlay = state.native_overlay.lock().await;
        overlay.show();
        
        // Set recording active flag
        state.is_recording_overlay_active.store(true, Ordering::Relaxed);
    }
    
    // Fallback to Tauri overlay on other platforms
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(overlay_window) = app.get_webview_window("overlay") {
            let _ = overlay_window.show();
            let _ = overlay_window.emit("recording-state-update", serde_json::json!({
                "isRecording": true,
                "duration": 0
            }));
            
            // Set recording active flag and start duration updates
            state.is_recording_overlay_active.store(true, Ordering::Relaxed);
            
            // Start a task to periodically update the duration
            let overlay_window_clone = overlay_window.clone();
            let start_time = std::time::Instant::now();
            let is_recording = state.is_recording_overlay_active.clone();
            
            tauri::async_runtime::spawn(async move {
                while is_recording.load(Ordering::Relaxed) {
                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                    let duration = start_time.elapsed().as_millis() as u64;
                    if overlay_window_clone.emit("recording-state-update", serde_json::json!({
                        "isRecording": true,
                        "duration": duration
                    })).is_err() {
                        break;
                    }
                }
            });
        }
    }

    Ok(filename)
}

#[tauri::command]
async fn stop_recording(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    
    // Use the recording workflow to stop recording
    let _result = state.recording_workflow.stop_recording().await?;
    
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
                Ok(metadata) => {
                    println!("Recording file {} ready, size: {} bytes", filename, metadata.len());
                }
                Err(e) => {
                    eprintln!("Failed to verify recording file: {}", e);
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
    
    // Don't immediately hide overlay - let the progress state handle it
    // The overlay will be minimized when we reach Complete or Failed state
    
    // Fallback to Tauri overlay on other platforms
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(overlay_window) = app.get_webview_window("overlay") {
            let _ = overlay_window.emit("recording-stopped", ());
            let _ = overlay_window.emit("recording-state-update", serde_json::json!({
                "isRecording": false,
                "duration": 0
            }));
            
            // Hide the overlay after a short delay
            let overlay_to_hide = overlay_window.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
                let _ = overlay_to_hide.hide();
            });
        }
    }
    
    Ok(())
}

#[tauri::command]
async fn is_recording(state: State<'_, AppState>) -> Result<bool, String> {
    let recorder = state.recorder.lock().await;
    Ok(recorder.is_recording())
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
    
    // Get the model path - using base.en model for good balance
    let model_path = state.models_dir.join("ggml-base.en.bin");
    
    if !model_path.exists() {
        return Err("Whisper model not found. Please run scripts/download-models.sh".to_string());
    }
    
    // Create transcriber and transcribe
    let transcriber = transcription::Transcriber::new(&model_path)?;
    let result = transcriber.transcribe(&audio_path)?;
    
    Ok(result)
}

#[tauri::command]
async fn save_transcript(
    state: State<'_, AppState>,
    text: String,
    duration_ms: i32,
) -> Result<i64, String> {
    state.database.save_transcript(&text, duration_ms, None).await
}

#[tauri::command]
async fn get_recent_transcripts(
    state: State<'_, AppState>,
    limit: i32,
) -> Result<Vec<db::Transcript>, String> {
    state.database.get_recent_transcripts(limit).await
}

#[tauri::command]
async fn search_transcripts(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<db::Transcript>, String> {
    state.database.search_transcripts(&query).await
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
    let position = state.overlay_position.lock().await;
    Ok(position.to_string().to_string())
}

#[tauri::command]
async fn set_overlay_position(state: State<'_, AppState>, position: String) -> Result<(), String> {
    let overlay_position = match position.as_str() {
        "top-left" => OverlayPosition::TopLeft,
        "top-center" => OverlayPosition::TopCenter,
        "top-right" => OverlayPosition::TopRight,
        "bottom-left" => OverlayPosition::BottomLeft,
        "bottom-center" => OverlayPosition::BottomCenter,
        "bottom-right" => OverlayPosition::BottomRight,
        "left-center" => OverlayPosition::LeftCenter,
        "right-center" => OverlayPosition::RightCenter,
        _ => return Err("Invalid overlay position".to_string()),
    };
    
    // Update the stored position
    *state.overlay_position.lock().await = overlay_position;
    
    // Update the native overlay position
    #[cfg(target_os = "macos")]
    {
        let overlay = state.native_overlay.lock().await;
        overlay.set_position(&position);
    }
    
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
    println!("Delete transcript called with id: {}", id);
    let result = state.database.delete_transcript(id).await;
    println!("Delete result: {:?}", result);
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
async fn update_global_shortcut(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    shortcut: String,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    
    // Get the current shortcut and unregister it
    let global_shortcut = app.global_shortcut();
    let current = state.current_shortcut.lock().await;
    let _ = global_shortcut.unregister(current.as_str());
    drop(current);
    
    // Clone app handle for the closure
    let app_handle = app.clone();
    
    // Register the new shortcut
    global_shortcut.on_shortcut(shortcut.as_str(), move |_app, _event, _shortcut| {
        // Emit event to frontend to toggle recording
        app_handle.emit("toggle-recording", ()).unwrap();
    }).map_err(|e| format!("Failed to register shortcut '{}': {}", shortcut, e))?;
    
    // Update the stored shortcut
    *state.current_shortcut.lock().await = shortcut;
    
    Ok(())
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            let recordings_dir = app_data_dir.join("recordings");
            std::fs::create_dir_all(&recordings_dir).expect("Failed to create recordings directory");

            let db_path = app_data_dir.join("scout.db");
            let database = tauri::async_runtime::block_on(async {
                Database::new(&db_path).await.expect("Failed to initialize database")
            });

            let mut recorder = AudioRecorder::new();
            recorder.init();
            
            // Get the base directory of the app
            let base_dir = std::env::current_dir().expect("Failed to get current directory");
            let models_dir = base_dir.join("models");
            
            // Initialize the native overlay (will show minimal pill immediately)
            #[cfg(target_os = "macos")]
            let native_overlay = Arc::new(Mutex::new(macos::MacOSOverlay::new()));
            
            // Force show the overlay pill after a short delay
            #[cfg(target_os = "macos")]
            {
                let overlay_clone = native_overlay.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
                    let overlay = overlay_clone.lock().await;
                    println!("Ensuring overlay is visible on startup");
                    // Set default position
                    overlay.set_position("top-center");
                    overlay.ensure_visible();
                });
            }
            
            let recorder_arc = Arc::new(Mutex::new(recorder));
            let database_arc = Arc::new(database);
            let progress_tracker = Arc::new(ProgressTracker::new());
            let progress_tracker_clone = progress_tracker.clone();
            
            // Create the processing queue
            let (processing_queue, mut processing_status_rx) = ProcessingQueue::new(
                database_arc.clone(),
                models_dir.clone(),
            );
            let processing_queue_arc = Arc::new(processing_queue);
            
            let recording_workflow = Arc::new(RecordingWorkflow::new(
                recorder_arc.clone(),
                recordings_dir.clone(),
                progress_tracker.clone(),
                processing_queue_arc.clone(),
            ));
            
            let state = AppState {
                recorder: recorder_arc,
                database: database_arc,
                recordings_dir,
                models_dir,
                current_shortcut: Arc::new(Mutex::new("CmdOrCtrl+Shift+Space".to_string())),
                is_recording_overlay_active: Arc::new(AtomicBool::new(false)),
                current_recording_file: Arc::new(Mutex::new(None)),
                progress_tracker,
                recording_workflow,
                processing_queue: processing_queue_arc,
                overlay_position: Arc::new(Mutex::new(OverlayPosition::default())),
                #[cfg(target_os = "macos")]
                native_overlay: native_overlay.clone(),
            };
            
            app.manage(state);
            
            // Set up progress tracking listener for macOS overlay
            #[cfg(target_os = "macos")]
            {
                let overlay_clone = native_overlay.clone();
                let mut receiver = progress_tracker_clone.subscribe();
                
                tauri::async_runtime::spawn(async move {
                    while receiver.changed().await.is_ok() {
                        let progress = receiver.borrow().clone();
                        let overlay = overlay_clone.lock().await;
                        
                        match progress {
                            recording_progress::RecordingProgress::Recording { .. } => {
                                overlay.update_progress("recording");
                            }
                            recording_progress::RecordingProgress::Stopping { .. } => {
                                // Immediately hide overlay when stopping
                                overlay.hide();
                            }
                            recording_progress::RecordingProgress::Idle => {
                                // Already hidden, just update state
                                overlay.update_progress("idle");
                            }
                        }
                    }
                });
            }
            
            // Set up processing status monitoring
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    while let Some(status) = processing_status_rx.recv().await {
                        // Emit processing status to frontend
                        let _ = app_handle.emit("processing-status", &status);
                        
                        // Log the status
                        match &status {
                            ProcessingStatus::Queued { position } => {
                                println!("Processing queued at position {}", position);
                            }
                            ProcessingStatus::Processing { filename } => {
                                println!("Processing file: {}", filename);
                            }
                            ProcessingStatus::Transcribing { filename } => {
                                println!("Transcribing file: {}", filename);
                            }
                            ProcessingStatus::Complete { filename, transcript } => {
                                println!("Transcription complete for {}: {} chars", filename, transcript.len());
                            }
                            ProcessingStatus::Failed { filename, error } => {
                                eprintln!("Processing failed for {}: {}", filename, error);
                            }
                        }
                    }
                });
            }
            
            // Setup overlay window positioning
            // We'll position it when it's shown in the start_recording command
            
            // Set up global hotkey
            let app_handle = app.app_handle().clone();
            if let Err(e) = app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+Space", move |_app, _event, _shortcut| {
                // Emit event to frontend to toggle recording
                println!("Global shortcut triggered");
                app_handle.emit("toggle-recording", ()).unwrap();
            }) {
                eprintln!("Failed to register default global shortcut: {:?}", e);
            }
            
            // Set up system tray
            let toggle_recording_item = MenuItemBuilder::with_id("toggle_recording", "Start Recording")
                .accelerator("CmdOrCtrl+Shift+Space")
                .build(app)?;
            
            // Store reference to the menu item
            app.manage(toggle_recording_item.clone());
            
            let tray_menu = Menu::with_items(app, &[
                &MenuItemBuilder::with_id("show", "Show/Hide Window")
                    .accelerator("CmdOrCtrl+Shift+S")
                    .build(app)?,
                &toggle_recording_item,
                &PredefinedMenuItem::separator(app)?,
                &MenuItemBuilder::with_id("quit", "Quit Scout")
                    .accelerator("CmdOrCtrl+Q")
                    .build(app)?
            ])?;
            
            // Load tray icon
            let icon_path = std::env::current_dir()
                .unwrap()
                .join("icons/tray-icon.png");
            
            let tray_icon = tauri::image::Image::from_path(&icon_path)
                .unwrap_or_else(|_| {
                    // Fallback to default icon if tray icon not found
                    println!("Warning: Could not load tray icon from {:?}, using default icon", icon_path);
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
                            app.emit("toggle-recording", ()).unwrap();
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
            let window_for_events = app.get_webview_window("main").unwrap().clone();
            app.get_webview_window("main").unwrap().on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = &event {
                    // Hide window instead of closing
                    api.prevent_close();
                    let _ = window_for_events.hide();
                }
            });
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            is_recording,
            get_current_recording_file,
            transcribe_audio,
            save_transcript,
            get_recent_transcripts,
            search_transcripts,
            set_vad_enabled,
            is_vad_enabled,
            delete_transcript,
            delete_transcripts,
            export_transcripts,
            update_global_shortcut,
            subscribe_to_progress,
            get_overlay_position,
            set_overlay_position,
            get_processing_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
