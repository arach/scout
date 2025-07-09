use std::sync::Arc;
use tokio::time::{sleep, Duration};
use crate::settings::SettingsManager;
use crate::logger::{info, error, Component};

/// Post-processing hooks that run after successful transcription
pub struct PostProcessingHooks {
    settings: Arc<tokio::sync::Mutex<SettingsManager>>,
}

impl PostProcessingHooks {
    pub fn new(settings: Arc<tokio::sync::Mutex<SettingsManager>>) -> Self {
        Self { settings }
    }

    /// Execute all post-processing hooks for a completed transcription
    pub async fn execute_hooks(&self, transcript: &str, source: &str) {
        info(Component::Processing, &format!("🎯 {} transcription successful - executing post-processing hooks", source));
        
        // Execute auto-copy/paste hooks
        self.execute_clipboard_hooks(transcript).await;
        
        // Future: Add more hooks here (e.g., webhooks, integrations, etc.)
    }

    /// Handle auto-copy and auto-paste functionality
    async fn execute_clipboard_hooks(&self, transcript: &str) {
        let settings_guard = self.settings.lock().await;
        let auto_copy = settings_guard.get().ui.auto_copy;
        let auto_paste = settings_guard.get().ui.auto_paste;
        drop(settings_guard);
        
        info(Component::Processing, &format!("📋 Clipboard Settings - Auto-copy: {}, Auto-paste: {}", auto_copy, auto_paste));
        
        if auto_copy {
            info(Component::Processing, "📋 Auto-copy is enabled, copying transcript to clipboard");
            match crate::clipboard::copy_to_clipboard(transcript) {
                Ok(()) => {
                    info(Component::Processing, "✅ Auto-copy completed successfully");
                }
                Err(e) => {
                    error(Component::Processing, &format!("❌ Auto-copy failed: {}", e));
                }
            }
        } else {
            info(Component::Processing, "📋 Auto-copy is disabled");
        }
        
        if auto_paste {
            info(Component::Processing, "🖱️ Auto-paste is enabled, attempting to paste transcript");
            
            // Ensure transcript is not empty
            if transcript.trim().is_empty() {
                error(Component::Processing, "❌ Cannot auto-paste empty transcript");
            } else {
                info(Component::Processing, &format!("📝 Transcript ready for pasting: '{}' ({} characters)", transcript.trim(), transcript.len()));
                
                // Copy to clipboard first (required for paste)
                let copy_result = if !auto_copy {
                    info(Component::Processing, "📋 Auto-copy was disabled, copying transcript for auto-paste");
                    crate::clipboard::copy_to_clipboard(transcript)
                } else {
                    info(Component::Processing, "📋 Auto-copy already completed, proceeding with paste");
                    Ok(()) // Auto-copy already happened
                };
                
                match copy_result {
                    Ok(()) => {
                        // Longer delay to ensure clipboard is ready and system is responsive
                        info(Component::Processing, "⏱️ Waiting 500ms for clipboard to be ready...");
                        sleep(Duration::from_millis(500)).await;
                        
                        // Attempt to paste with retry logic
                        let mut paste_attempts = 0;
                        let max_attempts = 3;
                        
                        info(Component::Processing, &format!("🔄 Starting paste retry loop (max {} attempts)", max_attempts));
                        
                        while paste_attempts < max_attempts {
                            paste_attempts += 1;
                            info(Component::Processing, &format!("🖱️ Paste attempt {} of {}", paste_attempts, max_attempts));
                            
                            match crate::clipboard::simulate_paste() {
                                Ok(()) => {
                                    info(Component::Processing, "✅ Auto-paste completed successfully");
                                    break;
                                }
                                Err(e) => {
                                    if paste_attempts < max_attempts {
                                        error(Component::Processing, &format!("❌ Paste attempt {} failed: {}, retrying in 200ms...", paste_attempts, e));
                                        sleep(Duration::from_millis(200)).await;
                                    } else {
                                        error(Component::Processing, &format!("❌ Auto-paste failed after {} attempts: {}", max_attempts, e));
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error(Component::Processing, &format!("❌ Failed to copy transcript for auto-paste: {}", e));
                    }
                }
            }
        } else {
            info(Component::Processing, "🖱️ Auto-paste is disabled");
        }
    }
}