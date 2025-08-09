use std::path::Path;

#[tauri::command]
pub async fn serve_audio_file(file_path: String) -> Result<Vec<u8>, String> {
    use std::fs;
    fs::read(&file_path).map_err(|e| format!("Failed to read audio file: {}", e))
}

#[tauri::command]
pub async fn read_audio_file(audio_path: String) -> Result<Vec<u8>, String> {
    let path = Path::new(&audio_path);
    if path.extension().and_then(|s| s.to_str()) == Some("wav") {
        return std::fs::read(&audio_path).map_err(|e| e.to_string());
    }
    crate::audio::converter::AudioConverter::convert_to_wav_bytes(path)
}

