#[tauri::command]
pub async fn check_microphone_permission() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use cpal::traits::HostTrait;
        let host = cpal::default_host();
        return Ok(match host.default_input_device() { Some(_) => "granted", None => "denied" }.to_string());
    }
    #[cfg(not(target_os = "macos"))]
    { Ok("granted".to_string()) }
}

#[tauri::command]
pub async fn request_microphone_permission() -> Result<String, String> {
    check_microphone_permission().await
}

#[tauri::command]
pub async fn open_system_preferences_audio() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .spawn()
            .map_err(|e| format!("Failed to open system preferences: {}", e))?;
    }
    Ok(())
}

