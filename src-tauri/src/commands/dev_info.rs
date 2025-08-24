use std::process::Command;

/// Get development environment information
#[tauri::command]
pub async fn get_dev_info() -> Result<serde_json::Value, String> {
    // Get current git branch
    let git_branch = Command::new("git")
        .args(&["branch", "--show-current"])
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                String::from_utf8(output.stdout).ok()
            } else {
                None
            }
        })
        .unwrap_or_else(|| "unknown".to_string())
        .trim()
        .to_string();
    
    // Get current commit hash (short)
    let git_commit = Command::new("git")
        .args(&["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                String::from_utf8(output.stdout).ok()
            } else {
                None
            }
        })
        .unwrap_or_else(|| "unknown".to_string())
        .trim()
        .to_string();
    
    Ok(serde_json::json!({
        "branch": git_branch,
        "commit": git_commit,
        "rust_env": std::env::var("RUST_ENV").unwrap_or_else(|_| "development".to_string()),
    }))
}