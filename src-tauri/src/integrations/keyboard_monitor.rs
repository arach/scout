use crate::logger::{debug, error, info, warn, Component};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

pub struct KeyboardMonitor {
    app_handle: AppHandle,
    is_push_to_talk_active: Arc<Mutex<bool>>,
}

impl KeyboardMonitor {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            is_push_to_talk_active: Arc::new(Mutex::new(false)),
        }
    }

    pub fn set_push_to_talk_key(&self, shortcut: &str) {
        info(
            Component::UI,
            &format!("Setting push-to-talk key: {}", shortcut),
        );
        
        #[cfg(target_os = "macos")]
        {
            // Use the global keyboard monitor instance
            if let Err(e) = crate::macos::set_push_to_talk_shortcut(shortcut) {
                error(Component::UI, &format!("Failed to set push-to-talk shortcut: {}", e));
            }
        }
        
        #[cfg(not(target_os = "macos"))]
        {
            warn(Component::UI, "Push-to-talk key release detection not available on this platform");
        }
    }

    pub fn start_monitoring(self: Arc<Self>) {
        #[cfg(target_os = "macos")]
        {
            self.start_monitoring_macos();
        }

        #[cfg(not(target_os = "macos"))]
        {
            warn(
                Component::UI,
                "Keyboard monitoring not available on this platform",
            );
            let _ = self.app_handle.emit("keyboard-monitor-unavailable",
                "Push-to-talk key release detection is not available on this platform.");
        }
    }

    #[cfg(target_os = "macos")]
    fn start_monitoring_macos(self: Arc<Self>) {
        info(Component::UI, "Starting macOS keyboard monitor");
        
        // Initialize the global keyboard monitor instance
        match crate::macos::initialize_keyboard_monitor(self.app_handle.clone()) {
            Ok(()) => {
                info(Component::UI, "macOS keyboard monitor initialized successfully");
            }
            Err(e) => {
                error(Component::UI, &format!("Failed to initialize macOS keyboard monitor: {}", e));
                let _ = self.app_handle.emit("keyboard-monitor-unavailable",
                    &format!("Failed to initialize keyboard monitoring: {}", e));
            }
        }
    }

    pub fn is_push_to_talk_active(&self) -> bool {
        self.is_push_to_talk_active
            .lock()
            .map(|active| *active)
            .unwrap_or(false)
    }
}