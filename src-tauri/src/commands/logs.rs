#[tauri::command]
pub async fn get_log_file_path() -> Result<Option<String>, String> {
    Ok(crate::logger::get_log_file_path().map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn open_log_file() -> Result<(), String> {
    use std::process::Command;
    if let Some(log_path) = crate::logger::get_log_file_path() {
        #[cfg(target_os = "macos")]
        { Command::new("open").arg(&log_path).spawn().map_err(|e| format!("Failed to open log file: {}", e))?; }
        #[cfg(target_os = "windows")]
        { Command::new("notepad").arg(&log_path).spawn().map_err(|e| format!("Failed to open log file: {}", e))?; }
        #[cfg(target_os = "linux")]
        { Command::new("xdg-open").arg(&log_path).spawn().map_err(|e| format!("Failed to open log file: {}", e))?; }
        Ok(())
    } else {
        Err("No log file found".to_string())
    }
}

#[tauri::command]
pub async fn show_log_file_in_finder() -> Result<(), String> {
    use std::process::Command;
    if let Some(log_path) = crate::logger::get_log_file_path() {
        #[cfg(target_os = "macos")]
        { Command::new("open").arg("-R").arg(&log_path).spawn().map_err(|e| format!("Failed to reveal log file in Finder: {}", e))?; }
        #[cfg(target_os = "windows")]
        { Command::new("explorer").arg("/select,").arg(&log_path).spawn().map_err(|e| format!("Failed to reveal log file in Explorer: {}", e))?; }
        #[cfg(target_os = "linux")]
        {
            if let Some(parent) = log_path.parent() {
                Command::new("xdg-open").arg(parent).spawn().map_err(|e| format!("Failed to open logs directory: {}", e))?;
            } else {
                return Err("Could not find logs directory".to_string());
            }
        }
        Ok(())
    } else {
        Err("No log file found".to_string())
    }
}

