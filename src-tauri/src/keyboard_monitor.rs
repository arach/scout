use crate::logger::{debug, error, info, warn, Component};
use rdev::{Event, EventType, Key};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[cfg(not(target_os = "macos"))]
use std::thread;

pub struct KeyboardMonitor {
    app_handle: AppHandle,
    pressed_keys: Arc<Mutex<HashSet<Key>>>,
    push_to_talk_key: Arc<Mutex<Option<Key>>>,
    is_push_to_talk_active: Arc<Mutex<bool>>,
}

impl KeyboardMonitor {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            pressed_keys: Arc::new(Mutex::new(HashSet::new())),
            push_to_talk_key: Arc::new(Mutex::new(None)),
            is_push_to_talk_active: Arc::new(Mutex::new(false)),
        }
    }

    pub fn set_push_to_talk_key(&self, shortcut: &str) {
        // Parse the shortcut string to extract the main key
        // Format is like "CmdOrCtrl+Shift+P" or "Ctrl+Alt+R"
        let key = Self::parse_shortcut_to_key(shortcut);
        if let Ok(mut ptk) = self.push_to_talk_key.lock() {
            *ptk = key;
            info(
                Component::UI,
                &format!("Push-to-talk key set to: {:?}", key),
            );
        }
    }

    fn parse_shortcut_to_key(shortcut: &str) -> Option<Key> {
        // Extract the main key from the shortcut string
        let parts: Vec<&str> = shortcut.split('+').collect();
        if let Some(key_str) = parts.last() {
            match key_str.to_uppercase().as_str() {
                "A" => Some(Key::KeyA),
                "B" => Some(Key::KeyB),
                "C" => Some(Key::KeyC),
                "D" => Some(Key::KeyD),
                "E" => Some(Key::KeyE),
                "F" => Some(Key::KeyF),
                "G" => Some(Key::KeyG),
                "H" => Some(Key::KeyH),
                "I" => Some(Key::KeyI),
                "J" => Some(Key::KeyJ),
                "K" => Some(Key::KeyK),
                "L" => Some(Key::KeyL),
                "M" => Some(Key::KeyM),
                "N" => Some(Key::KeyN),
                "O" => Some(Key::KeyO),
                "P" => Some(Key::KeyP),
                "Q" => Some(Key::KeyQ),
                "R" => Some(Key::KeyR),
                "S" => Some(Key::KeyS),
                "T" => Some(Key::KeyT),
                "U" => Some(Key::KeyU),
                "V" => Some(Key::KeyV),
                "W" => Some(Key::KeyW),
                "X" => Some(Key::KeyX),
                "Y" => Some(Key::KeyY),
                "Z" => Some(Key::KeyZ),
                "SPACE" => Some(Key::Space),
                "1" => Some(Key::Num1),
                "2" => Some(Key::Num2),
                "3" => Some(Key::Num3),
                "4" => Some(Key::Num4),
                "5" => Some(Key::Num5),
                "6" => Some(Key::Num6),
                "7" => Some(Key::Num7),
                "8" => Some(Key::Num8),
                "9" => Some(Key::Num9),
                "0" => Some(Key::Num0),
                _ => None,
            }
        } else {
            None
        }
    }

    pub fn start_monitoring(self: Arc<Self>) {
        #[cfg(target_os = "macos")]
        {
            // On macOS, we need to handle keyboard events more carefully
            // to avoid dispatch queue assertion failures
            self.start_monitoring_macos();
        }

        #[cfg(not(target_os = "macos"))]
        {
            // On other platforms, use the original implementation
            self.start_monitoring_other();
        }
    }

    #[cfg(target_os = "macos")]
    fn start_monitoring_macos(self: Arc<Self>) {
        // On macOS, rdev has threading issues that can cause crashes
        // For now, we'll disable keyboard monitoring and rely on global shortcuts only
        warn(
            Component::UI,
            "Keyboard event monitoring temporarily disabled on macOS due to threading issues",
        );
        warn(
            Component::UI,
            "Push-to-talk will work but key release detection is not available",
        );
        warn(
            Component::UI,
            "You'll need to use the same shortcut or stop button to end recording",
        );

        // Emit a warning event to the frontend
        let _ = self.app_handle.emit("keyboard-monitor-unavailable",
            "Push-to-talk key release detection is temporarily disabled on macOS. Use the same shortcut or stop button to end recording.");
    }

    #[cfg(not(target_os = "macos"))]
    fn start_monitoring_other(self: Arc<Self>) {
        let monitor = self.clone();
        let app_handle_for_emit = self.app_handle.clone();

        // Spawn a thread to handle keyboard events with panic catching
        match thread::Builder::new()
            .name("keyboard-monitor".to_string())
            .spawn(move || {
                info(Component::UI, "Keyboard monitor thread started");

                // Catch any panics to prevent app crash
                let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
                    debug(Component::UI, "Attempting to start keyboard event listener...");

                    // Try to start the listener
                    let monitor_for_listen = monitor.clone();
                    match rdev::listen(move |event: Event| {
                        // Wrap event handling in panic catch as well
                        let _ = std::panic::catch_unwind(AssertUnwindSafe(|| {
                            monitor_for_listen.handle_event(event);
                        }));
                    }) {
                        Ok(_) => {
                            info(Component::UI, "Keyboard event listener ended normally");
                        }
                        Err(e) => {
                            warn(Component::UI, &format!("Keyboard monitoring not available: {:?}", e));
                            warn(Component::UI, "Push-to-talk will work but won't auto-stop on key release.");

                            // Emit a warning event to the frontend
                            let _ = app_handle_for_emit.emit("keyboard-monitor-unavailable",
                                "Push-to-talk key release detection is not available. Grant accessibility permissions to enable.");
                        }
                    }
                }));

                if let Err(e) = result {
                    error(Component::UI, &format!("Keyboard monitor error: {:?}", e));
                    warn(Component::UI, "Push-to-talk key release detection disabled.");
                }

                info(Component::UI, "Keyboard monitor thread ending");
            }) {
            Ok(handle) => {
                info(Component::UI, &format!("Keyboard monitor thread spawned successfully (ID: {:?})", handle.thread().id()));
            }
            Err(e) => {
                error(Component::UI, &format!("Failed to spawn keyboard monitor thread: {}", e));
                warn(Component::UI, "Push-to-talk key release detection disabled.");
            }
        }
    }

    fn handle_event(&self, event: Event) {
        // Don't log the actual event details on macOS to avoid triggering the crash
        #[cfg(all(debug_assertions, not(target_os = "macos")))]
        {
            match &event.event_type {
                EventType::KeyPress(key) => {
                    debug(Component::UI, &format!("Key press detected: {:?}", key))
                }
                EventType::KeyRelease(key) => {
                    debug(Component::UI, &format!("Key release detected: {:?}", key))
                }
                _ => {}
            }
        }

        #[cfg(all(debug_assertions, target_os = "macos"))]
        {
            match &event.event_type {
                EventType::KeyPress(_) => debug(Component::UI, "Key press detected"),
                EventType::KeyRelease(_) => debug(Component::UI, "Key release detected"),
                _ => {}
            }
        }

        match event.event_type {
            EventType::KeyPress(key) => {
                if let Ok(mut pressed) = self.pressed_keys.lock() {
                    pressed.insert(key);
                } else {
                    error(Component::UI, "Failed to lock pressed_keys for press");
                    return;
                }

                // Check if this is the push-to-talk key
                match (
                    self.push_to_talk_key.lock(),
                    self.is_push_to_talk_active.lock(),
                ) {
                    (Ok(ptk), Ok(mut is_active)) => {
                        if let Some(push_key) = *ptk {
                            if key == push_key && !*is_active {
                                *is_active = true;
                                info(
                                    Component::UI,
                                    &format!("Push-to-talk key pressed: {:?}", key),
                                );
                                // Note: The actual recording start is handled by the existing global shortcut
                                // This just tracks the state for release detection
                            }
                        }
                    }
                    _ => {
                        error(Component::UI, "Failed to lock push-to-talk state for press");
                    }
                }
            }
            EventType::KeyRelease(key) => {
                if let Ok(mut pressed) = self.pressed_keys.lock() {
                    pressed.remove(&key);
                } else {
                    error(Component::UI, "Failed to lock pressed_keys for release");
                    return;
                }

                // Check if this is the push-to-talk key being released
                match (
                    self.push_to_talk_key.lock(),
                    self.is_push_to_talk_active.lock(),
                ) {
                    (Ok(ptk), Ok(mut is_active)) => {
                        if let Some(push_key) = *ptk {
                            if key == push_key && *is_active {
                                *is_active = false;
                                info(
                                    Component::UI,
                                    &format!("Push-to-talk key released: {:?}", key),
                                );
                                // Emit event to stop recording
                                if let Err(e) = self.app_handle.emit("push-to-talk-released", ()) {
                                    error(
                                        Component::UI,
                                        &format!(
                                            "Failed to emit push-to-talk-released event: {}",
                                            e
                                        ),
                                    );
                                }
                            }
                        }
                    }
                    _ => {
                        error(
                            Component::UI,
                            "Failed to lock push-to-talk state for release",
                        );
                    }
                }
            }
            _ => {}
        }
    }

    pub fn is_push_to_talk_active(&self) -> bool {
        self.is_push_to_talk_active
            .lock()
            .map(|active| *active)
            .unwrap_or(false)
    }
}
