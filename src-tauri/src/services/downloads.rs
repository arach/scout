use std::path::Path;

pub async fn download_file_with_progress(
    app: &tauri::AppHandle,
    url: &str,
    dest_path: &Path,
    file_type: &str,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use std::io::Write;
    use tauri::Emitter;

    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to download {}: {}", file_type, e))?;

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded = 0u64;
    let mut file = std::fs::File::create(dest_path).map_err(|e| format!("Failed to create file: {}", e))?;
    let mut stream = response.bytes_stream();
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
        app.emit(
            "download-progress",
            serde_json::json!({
                "url": url,
                "progress": progress,
                "downloaded": downloaded,
                "total": total_size,
                "fileType": file_type,
            }),
        )
        .ok();
    }
    Ok(())
}

