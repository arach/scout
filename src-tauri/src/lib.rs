mod audio;
mod db;
mod transcription;
mod recording_progress;
mod recording_workflow;
mod processing_queue;
mod overlay_position;
mod sound;
mod models;
mod settings;
#[cfg(target_os = "macos")]
mod macos;

use audio::AudioRecorder;
use db::Database;
use overlay_position::OverlayPosition;
use processing_queue::{ProcessingQueue, ProcessingStatus};
use recording_progress::ProgressTracker;
use recording_workflow::RecordingWorkflow;
use settings::SettingsManager;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, State, WindowEvent};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, MenuItemBuilder};
use tokio::sync::Mutex;
use chrono;

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
    #[cfg(target_os = "macos")]
    pub native_overlay: Arc<Mutex<macos::MacOSOverlay>>,
}

fn calculate_overlay_position(position: &OverlayPosition, window: &tauri::WebviewWindow) -> (f64, f64) {
    // Get the primary monitor to calculate position
    let monitor = window.primary_monitor().unwrap_or_default();
    let (screen_width, screen_height) = if let Some(m) = monitor {
        let size = m.size();
        let scale = m.scale_factor();
        (size.width as f64 / scale, size.height as f64 / scale)
    } else {
        (1920.0, 1080.0) // Default fallback
    };
    
    let window_width = 180.0;
    let window_height = 40.0;
    let padding = 20.0;
    let top_padding = 5.0; // Closer to top edge
    
    match position {
        OverlayPosition::TopLeft => (padding, top_padding),
        OverlayPosition::TopCenter => ((screen_width - window_width) / 2.0, top_padding),
        OverlayPosition::TopRight => (screen_width - window_width - padding, top_padding),
        OverlayPosition::BottomLeft => (padding, screen_height - window_height - padding),
        OverlayPosition::BottomCenter => ((screen_width - window_width) / 2.0, screen_height - window_height - padding),
        OverlayPosition::BottomRight => (screen_width - window_width - padding, screen_height - window_height - padding),
        OverlayPosition::LeftCenter => (padding, (screen_height - window_height) / 2.0),
        OverlayPosition::RightCenter => (screen_width - window_width - padding, (screen_height - window_height) / 2.0),
    }
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
    // Play start sound
    sound::SoundPlayer::play_start();
    
    // Use the recording workflow to start recording
    let filename = state.recording_workflow.start_recording().await?;
    
    // Progress is already updated by recording_workflow, no need to update again
    
    // Store the current recording filename
    *state.current_recording_file.lock().await = Some(filename.clone());

    // Update tray menu item text
    if let Some(menu_item) = app.try_state::<MenuItem<tauri::Wry>>() {
        let _ = menu_item.set_text("Stop Recording");
    }

    // Show overlay window
    if let Some(overlay_window) = app.get_webview_window("overlay") {
        println!("DEBUG: Found overlay window, showing it");
        // Position the window (native code controls position)
        // Use saved position from settings
        let settings = state.settings.lock().await;
        let position_str = &settings.get().ui.overlay_position;
        let overlay_position = match position_str.as_str() {
            "top-left" => OverlayPosition::TopLeft,
            "top-center" => OverlayPosition::TopCenter,
            "top-right" => OverlayPosition::TopRight,
            "bottom-left" => OverlayPosition::BottomLeft,
            "bottom-center" => OverlayPosition::BottomCenter,
            "bottom-right" => OverlayPosition::BottomRight,
            "left-center" => OverlayPosition::LeftCenter,
            "right-center" => OverlayPosition::RightCenter,
            _ => OverlayPosition::TopCenter,
        };
        drop(settings);
        let (x, y) = calculate_overlay_position(&overlay_position, &overlay_window);
        println!("DEBUG: Setting overlay position to ({}, {})", x, y);
        let _ = overlay_window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
        
        // Make sure window is properly sized for expanded state
        let _ = overlay_window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(180.0, 40.0)));
        
        // Show the window without focusing it
        match overlay_window.show() {
            Ok(_) => println!("DEBUG: Overlay window shown successfully"),
            Err(e) => println!("DEBUG: Failed to show overlay window: {:?}", e),
        }
        
        // Ensure main window retains focus after overlay operations
        if let Some(main_window) = app.get_webview_window("main") {
            let _ = main_window.set_focus();
        }
        
        match overlay_window.emit("recording-state-update", serde_json::json!({
            "isRecording": true,
            "duration": 0
        })) {
            Ok(_) => println!("DEBUG: Sent recording-state-update (isRecording: true) to overlay"),
            Err(e) => println!("DEBUG: Failed to send event to overlay: {:?}", e),
        }
        
        // Set recording active flag and start duration updates
        state.is_recording_overlay_active.store(true, Ordering::Relaxed);
        
        // Start a task to periodically update the duration and audio levels
        let overlay_window_clone = overlay_window.clone();
        let start_time = std::time::Instant::now();
        let is_recording = state.is_recording_overlay_active.clone();
        let recorder_clone = state.recorder.clone();
        
        tauri::async_runtime::spawn(async move {
            while is_recording.load(Ordering::Relaxed) {
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await; // Faster updates for responsiveness
                let duration = start_time.elapsed().as_millis() as u64;
                
                // Get current audio level from recorder
                let audio_level = {
                    let recorder = recorder_clone.lock().await;
                    recorder.get_current_audio_level()
                };
                
                if overlay_window_clone.emit("recording-state-update", serde_json::json!({
                    "isRecording": true,
                    "duration": duration,
                    "audioLevel": audio_level
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
    
    // Use the recording workflow to stop recording
    let _result = state.recording_workflow.stop_recording().await?;
    
    // Play stop sound
    sound::SoundPlayer::play_stop();
    
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
    
    // Handle overlay window
    if let Some(overlay_window) = app.get_webview_window("overlay") {
        let _ = overlay_window.emit("recording-stopped", ());
        let _ = overlay_window.emit("recording-state-update", serde_json::json!({
            "isRecording": false,
            "duration": 0
        }));
        
        // Ensure main window retains focus after overlay events
        if let Some(main_window) = app.get_webview_window("main") {
            let _ = main_window.set_focus();
        }
        
        // Don't hide the overlay - let the frontend handle the minimize animation
        // The window stays visible but the content animates to minimized state
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
    
    // Get the active model path
    let settings = state.settings.lock().await;
    let model_path = models::WhisperModel::get_active_model_path(&state.models_dir, settings.get());
    drop(settings); // Release the lock early
    println!("Attempting to use model at: {:?}", model_path);
    
    if !model_path.exists() {
        eprintln!("Model file does not exist at: {:?}", model_path);
        eprintln!("Models directory contents:");
        if let Ok(entries) = std::fs::read_dir(&state.models_dir) {
            for entry in entries.filter_map(Result::ok) {
                eprintln!("  - {:?}", entry.path());
            }
        }
        return Err("No Whisper model found. Please download a model from Settings.".to_string());
    } else {
        println!("✓ Model file exists at: {:?}", model_path);
    }
    
    // Create transcriber and transcribe
    let transcriber = transcription::Transcriber::new(&model_path)?;
    let result = transcriber.transcribe(&audio_path)?;
    
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
    };
    
    state.processing_queue.queue_job(job).await;
    
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
    let settings = state.settings.lock().await;
    Ok(settings.get().ui.overlay_position.clone())
}

#[tauri::command]
async fn set_overlay_position(state: State<'_, AppState>, position: String, app: tauri::AppHandle) -> Result<(), String> {
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
    
    // Update the settings
    let mut settings = state.settings.lock().await;
    settings.update(|s| s.ui.overlay_position = position.clone())
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    
    // Update the actual window position
    if let Some(overlay_window) = app.get_webview_window("overlay") {
        let (x, y) = calculate_overlay_position(&overlay_position, &overlay_window);
        let _ = overlay_window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
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
        "stopSound": sound::SoundPlayer::get_stop_sound()
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
async fn get_current_shortcut(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.settings.lock().await;
    Ok(settings.get().ui.hotkey.clone())
}

#[tauri::command]
async fn get_available_models(state: State<'_, AppState>) -> Result<Vec<models::WhisperModel>, String> {
    let settings = state.settings.lock().await;
    Ok(models::WhisperModel::all(&state.models_dir, settings.get()))
}

#[tauri::command]
async fn has_any_model(state: State<'_, AppState>) -> Result<bool, String> {
    println!("Checking for models in: {:?}", state.models_dir);
    
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
                    println!("Found model: {:?}", path);
                    found_models = true;
                }
            }
            found_models
        }
        Err(e) => {
            eprintln!("Error reading models directory: {}", e);
            false
        }
    };
    
    println!("has_any_model result: {}", has_models);
    Ok(has_models)
}

#[tauri::command]
async fn set_active_model(state: State<'_, AppState>, model_id: String) -> Result<(), String> {
    let mut settings = state.settings.lock().await;
    settings.update(|s| s.models.active_model_id = model_id.clone())
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    println!("Active model set to: {}", model_id);
    Ok(())
}

#[tauri::command]
async fn get_models_dir(state: State<'_, AppState>) -> Result<String, String> {
    let path = state.models_dir.to_string_lossy().to_string();
    println!("get_models_dir returning: {}", path);
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
    
    println!("=== DOWNLOAD START ===");
    println!("URL: {}", url);
    println!("Destination path: {}", dest_path);
    
    // Ensure parent directory exists
    if let Some(parent) = Path::new(&dest_path).parent() {
        println!("Creating parent directory: {:?}", parent);
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
        
        // Verify directory was created
        if parent.exists() && parent.is_dir() {
            println!("✓ Parent directory exists and is a directory");
        } else {
            eprintln!("✗ Parent directory was not created properly!");
        }
    }
    
    // Start download
    println!("Starting HTTP request...");
    let client = reqwest::Client::new();
    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;
    
    let total_size = response.content_length().unwrap_or(0);
    println!("Total file size: {} bytes ({:.2} MB)", total_size, total_size as f64 / 1_048_576.0);
    
    // Create the file
    println!("Creating file at: {}", dest_path);
    let mut file = File::create(&dest_path).await
        .map_err(|e| format!("Failed to create file at {}: {}", dest_path, e))?;
    println!("✓ File created successfully");
    
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
    
    println!("=== DOWNLOAD COMPLETE ===");
    println!("Downloaded {} bytes to {}", downloaded, dest_path);
    
    // Verify the file exists
    if Path::new(&dest_path).exists() {
        let metadata = std::fs::metadata(&dest_path)
            .map_err(|e| format!("Failed to get file metadata: {}", e))?;
        println!("✓ File exists, size: {} bytes", metadata.len());
    } else {
        eprintln!("✗ File does not exist after download!");
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
        // Emit event to frontend to toggle recording
        app_handle.emit("toggle-recording", ()).unwrap();
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


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            println!("App data directory: {:?}", app_data_dir);
            
            let recordings_dir = app_data_dir.join("recordings");
            println!("Creating recordings directory: {:?}", recordings_dir);
            std::fs::create_dir_all(&recordings_dir).expect("Failed to create recordings directory");

            let db_path = app_data_dir.join("scout.db");
            println!("Database path: {:?}", db_path);
            let database = tauri::async_runtime::block_on(async {
                Database::new(&db_path).await.expect("Failed to initialize database")
            });

            let mut recorder = AudioRecorder::new();
            recorder.init();
            
            // Models directory in app data
            let models_dir = app_data_dir.join("models");
            println!("Models directory: {:?}", models_dir);
            println!("Creating models directory...");
            std::fs::create_dir_all(&models_dir).expect("Failed to create models directory");
            
            // Verify the directory was created
            if models_dir.exists() && models_dir.is_dir() {
                println!("✓ Models directory created successfully");
            } else {
                eprintln!("✗ Models directory was not created properly!");
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
                app_data_dir: app_data_dir.clone(),
                recordings_dir,
                models_dir,
                settings: settings_arc.clone(),
                is_recording_overlay_active: Arc::new(AtomicBool::new(false)),
                current_recording_file: Arc::new(Mutex::new(None)),
                progress_tracker,
                recording_workflow,
                processing_queue: processing_queue_arc,
                #[cfg(target_os = "macos")]
                native_overlay: native_overlay.clone(),
            };
            
            app.manage(state);
            
            // Set up progress tracking listener for overlay window
            {
                let app_handle = app.handle().clone();
                let mut receiver = progress_tracker_clone.subscribe();
                
                tauri::async_runtime::spawn(async move {
                    while receiver.changed().await.is_ok() {
                        let progress = receiver.borrow().clone();
                        
                        // Send progress to overlay window specifically
                        if let Some(overlay_window) = app_handle.get_webview_window("overlay") {
                            let _ = overlay_window.emit("recording-progress", &progress);
                        }
                    }
                });
            }
            
            // Set up processing status monitoring
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    while let Some(status) = processing_status_rx.recv().await {
                        // Emit processing status to frontend and overlay
                        let _ = app_handle.emit("processing-status", &status);
                        
                        // Also emit to overlay window specifically
                        if let Some(overlay_window) = app_handle.get_webview_window("overlay") {
                            let _ = overlay_window.emit("processing-status", &status);
                        }
                        
                        // Log the status
                        match &status {
                            ProcessingStatus::Queued { position } => {
                                println!("Processing queued at position {}", position);
                            }
                            ProcessingStatus::Processing { filename } => {
                                println!("Processing file: {}", filename);
                            }
                            ProcessingStatus::Converting { filename } => {
                                println!("Converting file to WAV: {}", filename);
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
            // Show the overlay window immediately but in minimized state
            if let Some(overlay_window) = app.get_webview_window("overlay") {
                println!("DEBUG: Overlay window found during setup");
                // Position it based on saved preference from settings
                let position_str = {
                    let settings_lock = settings_arc.lock();
                    let settings = tauri::async_runtime::block_on(settings_lock);
                    settings.get().ui.overlay_position.clone()
                };
                let position = match position_str.as_str() {
                    "top-left" => OverlayPosition::TopLeft,
                    "top-center" => OverlayPosition::TopCenter,
                    "top-right" => OverlayPosition::TopRight,
                    "bottom-left" => OverlayPosition::BottomLeft,
                    "bottom-center" => OverlayPosition::BottomCenter,
                    "bottom-right" => OverlayPosition::BottomRight,
                    "left-center" => OverlayPosition::LeftCenter,
                    "right-center" => OverlayPosition::RightCenter,
                    _ => OverlayPosition::TopCenter,
                };
                let (x, y) = calculate_overlay_position(&position, &overlay_window);
                println!("DEBUG: Initial overlay position: ({}, {})", x, y);
                let _ = overlay_window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
                
                // Start with minimal size to avoid blocking clicks
                let _ = overlay_window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(84.0, 12.0)));
                
                // Make the overlay ignore cursor events to prevent click issues
                let _ = overlay_window.set_ignore_cursor_events(true);
                
                match overlay_window.show() {
                    Ok(_) => println!("DEBUG: Initial overlay window show successful"),
                    Err(e) => println!("DEBUG: Failed to show overlay window initially: {:?}", e),
                }
                
                // Keep focus on main window
                if let Some(main_window) = app.get_webview_window("main") {
                    let _ = main_window.set_focus();
                }
            } else {
                println!("DEBUG: No overlay window found during setup!");
            }
            
            // Set up global hotkey from settings
            let app_handle = app.app_handle().clone();
            let hotkey = {
                let settings_lock = settings_arc.lock();
                let settings = tauri::async_runtime::block_on(settings_lock);
                settings.get().ui.hotkey.clone()
            };
            
            if let Err(e) = app.global_shortcut().on_shortcut(hotkey.as_str(), move |_app, _event, _shortcut| {
                // Emit event to frontend to toggle recording
                println!("Global shortcut triggered");
                app_handle.emit("toggle-recording", ()).unwrap();
            }) {
                eprintln!("Failed to register global shortcut '{}': {:?}", hotkey, e);
            }
            
            // Set up system tray
            let toggle_recording_item = MenuItemBuilder::with_id("toggle_recording", "Start Recording")
                .accelerator(&hotkey)
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
            get_processing_status,
            set_sound_enabled,
            is_sound_enabled,
            get_available_sounds,
            get_sound_settings,
            set_start_sound,
            set_stop_sound,
            get_current_shortcut,
            transcribe_file,
            get_available_models,
            has_any_model,
            set_active_model,
            get_models_dir,
            open_models_folder,
            download_file,
            get_settings,
            update_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
