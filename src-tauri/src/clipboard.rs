use arboard::Clipboard;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use crate::logger::{info, error, Component};

static CLIPBOARD: Lazy<Mutex<Option<Clipboard>>> = Lazy::new(|| {
    match Clipboard::new() {
        Ok(clipboard) => Mutex::new(Some(clipboard)),
        Err(e) => {
            error(Component::UI, &format!("Failed to initialize clipboard: {}", e));
            Mutex::new(None)
        }
    }
});

pub fn copy_to_clipboard(text: &str) -> Result<(), String> {
    let mut clipboard_guard = CLIPBOARD.lock().map_err(|e| format!("Clipboard lock error: {}", e))?;
    
    if let Some(ref mut clipboard) = clipboard_guard.as_mut() {
        clipboard.set_text(text).map_err(|e| format!("Failed to copy to clipboard: {}", e))?;
        info(Component::UI, &format!("Copied to clipboard: {} characters", text.len()));
        Ok(())
    } else {
        Err("Clipboard not available".to_string())
    }
}

pub fn paste_from_clipboard() -> Result<String, String> {
    let mut clipboard_guard = CLIPBOARD.lock().map_err(|e| format!("Clipboard lock error: {}", e))?;
    
    if let Some(ref mut clipboard) = clipboard_guard.as_mut() {
        clipboard.get_text().map_err(|e| format!("Failed to paste from clipboard: {}", e))
    } else {
        Err("Clipboard not available".to_string())
    }
}

// Simulate paste by sending keyboard events
#[cfg(target_os = "macos")]
pub fn simulate_paste() -> Result<(), String> {
    use std::process::Command;
    
    // Use AppleScript to simulate Cmd+V
    let output = Command::new("osascript")
        .arg("-e")
        .arg("tell application \"System Events\" to keystroke \"v\" using command down")
        .output()
        .map_err(|e| format!("Failed to execute AppleScript: {}", e))?;
    
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(format!("AppleScript failed: {}", error));
    }
    
    info(Component::UI, "Simulated paste command");
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn simulate_paste() -> Result<(), String> {
    // For other platforms, we would use different approaches
    // This is a placeholder implementation
    Err("Auto-paste not implemented for this platform".to_string())
}