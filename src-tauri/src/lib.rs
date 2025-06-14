mod audio;
mod db;
mod transcription;

use audio::AudioRecorder;
use db::Database;
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
}

#[tauri::command]
async fn start_recording(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<String, String> {
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let filename = format!("recording_{}.wav", timestamp);
    let path = state.recordings_dir.join(&filename);

    let recorder = state.recorder.lock().await;
    recorder.start_recording(&path)?;

    // Update tray menu item text
    if let Some(menu_item) = app.try_state::<MenuItem<tauri::Wry>>() {
        let _ = menu_item.set_text("Stop Recording");
    }

    // Show overlay window and emit recording state
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

    Ok(filename)
}

#[tauri::command]
async fn stop_recording(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    let recorder = state.recorder.lock().await;
    recorder.stop_recording()?;
    
    // Give the worker thread time to finalize the file
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    
    // Update tray menu item text
    if let Some(menu_item) = app.try_state::<MenuItem<tauri::Wry>>() {
        let _ = menu_item.set_text("Start Recording");
    }
    
    // Stop recording overlay updates and hide window
    state.is_recording_overlay_active.store(false, Ordering::Relaxed);
    
    if let Some(overlay_window) = app.get_webview_window("overlay") {
        let _ = overlay_window.emit("recording-stopped", ());
        let _ = overlay_window.emit("recording-state-update", serde_json::json!({
            "isRecording": false,
            "duration": 0
        }));
    }
    
    Ok(())
}

#[tauri::command]
async fn is_recording(state: State<'_, AppState>) -> Result<bool, String> {
    let recorder = state.recorder.lock().await;
    Ok(recorder.is_recording())
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
            
            let state = AppState {
                recorder: Arc::new(Mutex::new(recorder)),
                database: Arc::new(database),
                recordings_dir,
                models_dir,
                current_shortcut: Arc::new(Mutex::new("CmdOrCtrl+Shift+Space".to_string())),
                is_recording_overlay_active: Arc::new(AtomicBool::new(false)),
            };

            app.manage(state);
            
            // Position overlay window in top-center when showing
            if let Some(overlay_window) = app.get_webview_window("overlay") {
                // Store a reference to position the window when it's shown
                let overlay_for_positioning = overlay_window.clone();
                
                // Position window whenever it becomes visible
                overlay_window.on_window_event(move |event| {
                    use tauri::{LogicalPosition, Position, WindowEvent};
                    
                    if let WindowEvent::Visible = event {
                        // Get primary monitor to calculate position
                        if let Some(monitor) = overlay_for_positioning.primary_monitor().ok().flatten() {
                            let monitor_size = monitor.size();
                            let scale_factor = monitor.scale_factor();
                            let window_width = 280.0;
                            let padding = 20.0;
                            
                            // Position in top-center with padding
                            let screen_width = monitor_size.width as f64 / scale_factor;
                            let x = (screen_width - window_width) / 2.0;
                            let y = padding;
                            
                            let _ = overlay_for_positioning.set_position(Position::Logical(LogicalPosition::new(x, y)));
                        }
                    }
                });
            }
            
            // Set up global hotkey
            let app_handle = app.app_handle().clone();
            app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+Space", move |_app, _event, _shortcut| {
                // Emit event to frontend to toggle recording
                app_handle.emit("toggle-recording", ()).unwrap();
            }).unwrap();
            
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
            transcribe_audio,
            save_transcript,
            get_recent_transcripts,
            search_transcripts,
            set_vad_enabled,
            is_vad_enabled,
            delete_transcript,
            delete_transcripts,
            export_transcripts,
            update_global_shortcut
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
