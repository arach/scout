use crate::logger::{error, info, Component};
use arboard::Clipboard;
use once_cell::sync::Lazy;
use std::sync::Mutex;

static CLIPBOARD: Lazy<Mutex<Option<Clipboard>>> = Lazy::new(|| match Clipboard::new() {
    Ok(clipboard) => Mutex::new(Some(clipboard)),
    Err(e) => {
        error(
            Component::UI,
            &format!("Failed to initialize clipboard: {}", e),
        );
        Mutex::new(None)
    }
});

pub fn copy_to_clipboard(text: &str) -> Result<(), String> {
    info(
        Component::UI,
        &format!(
            "🔄 Starting copy operation for text: {} characters",
            text.len()
        ),
    );

    if text.is_empty() {
        error(
            Component::UI,
            "❌ Copy operation failed: Cannot copy empty text to clipboard",
        );
        return Err("Cannot copy empty text to clipboard".to_string());
    }

    info(Component::UI, "🔒 Acquiring clipboard lock...");
    let mut clipboard_guard = CLIPBOARD.lock().map_err(|e| {
        error(
            Component::UI,
            &format!("❌ Failed to acquire clipboard lock: {}", e),
        );
        format!("Clipboard lock error: {}", e)
    })?;
    info(Component::UI, "✅ Clipboard lock acquired successfully");

    if let Some(ref mut clipboard) = clipboard_guard.as_mut() {
        info(Component::UI, "📝 Writing text to clipboard...");
        clipboard.set_text(text).map_err(|e| {
            error(
                Component::UI,
                &format!("❌ Failed to write to clipboard: {}", e),
            );
            format!("Failed to copy to clipboard: {}", e)
        })?;
        info(
            Component::UI,
            &format!("✅ Text written to clipboard: {} characters", text.len()),
        );

        // Verify the text was actually copied
        info(Component::UI, "🔍 Verifying clipboard content...");
        match clipboard.get_text() {
            Ok(clipboard_content) => {
                if clipboard_content == text {
                    info(Component::UI, "✅ Clipboard content verified successfully");
                    Ok(())
                } else {
                    error(Component::UI, &format!("❌ Clipboard verification failed - content mismatch. Expected: {} chars, Got: {} chars", text.len(), clipboard_content.len()));
                    Err("Clipboard content verification failed".to_string())
                }
            }
            Err(e) => {
                error(
                    Component::UI,
                    &format!("❌ Failed to verify clipboard content: {}", e),
                );
                Err(format!("Failed to verify clipboard content: {}", e))
            }
        }
    } else {
        error(
            Component::UI,
            "❌ Clipboard not available - initialization failed",
        );
        Err("Clipboard not available".to_string())
    }
}

pub fn paste_from_clipboard() -> Result<String, String> {
    let mut clipboard_guard = CLIPBOARD
        .lock()
        .map_err(|e| format!("Clipboard lock error: {}", e))?;

    if let Some(ref mut clipboard) = clipboard_guard.as_mut() {
        clipboard
            .get_text()
            .map_err(|e| format!("Failed to paste from clipboard: {}", e))
    } else {
        Err("Clipboard not available".to_string())
    }
}

// Simulate paste by sending keyboard events
#[cfg(target_os = "macos")]
pub fn simulate_paste() -> Result<(), String> {
    use std::process::Command;

    info(Component::UI, "🖱️ Starting paste simulation...");

    // Check if we have accessibility permissions first
    info(Component::UI, "🔍 Checking accessibility permissions...");
    let permission_check = Command::new("osascript")
        .arg("-e")
        .arg("tell application \"System Events\" to get name of first application process whose frontmost is true")
        .output()
        .map_err(|e| {
            error(Component::UI, &format!("❌ Failed to check accessibility permissions: {}", e));
            format!("Failed to check accessibility permissions: {}", e)
        })?;

    if !permission_check.status.success() {
        let error_msg = String::from_utf8_lossy(&permission_check.stderr);
        error(
            Component::UI,
            &format!("❌ Accessibility permissions check failed: {}", error_msg),
        );
        return Err(format!("Accessibility permissions required for auto-paste. Please enable accessibility permissions for Scout in System Preferences > Security & Privacy > Privacy > Accessibility"));
    }

    info(Component::UI, "✅ Accessibility permissions check passed");

    let frontmost_app = String::from_utf8_lossy(&permission_check.stdout)
        .trim()
        .to_string();
    info(
        Component::UI,
        &format!("🖥️ Frontmost application detected: '{}'", frontmost_app),
    );

    // Skip auto-paste if Scout itself is the frontmost app (to avoid pasting into Scout)
    if frontmost_app.contains("scout") || frontmost_app.contains("Scout") {
        info(
            Component::UI,
            "⏭️ Skipping auto-paste because Scout is the frontmost application",
        );
        return Ok(());
    }

    info(
        Component::UI,
        &format!("🎯 Attempting to paste to application: '{}'", frontmost_app),
    );

    // Use AppleScript to simulate Cmd+V
    info(Component::UI, "⌨️ Executing AppleScript paste command...");
    let output = Command::new("osascript")
        .arg("-e")
        .arg("tell application \"System Events\" to keystroke \"v\" using command down")
        .output()
        .map_err(|e| {
            error(
                Component::UI,
                &format!("❌ Failed to execute AppleScript: {}", e),
            );
            format!("Failed to execute AppleScript: {}", e)
        })?;

    if !output.status.success() {
        let error_msg = String::from_utf8_lossy(&output.stderr);
        error(
            Component::UI,
            &format!("❌ AppleScript paste command failed: {}", error_msg),
        );
        return Err(format!("AppleScript failed: {}", error_msg));
    }

    info(
        Component::UI,
        &format!(
            "✅ Successfully simulated paste command to '{}'",
            frontmost_app
        ),
    );
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn simulate_paste() -> Result<(), String> {
    // For other platforms, we would use different approaches
    // This is a placeholder implementation
    Err("Auto-paste not implemented for this platform".to_string())
}
