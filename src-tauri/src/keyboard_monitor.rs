use rdev::{EventType, Key, Event};
use std::sync::{Arc, Mutex};
use std::collections::HashSet;
use std::panic::AssertUnwindSafe;
use tauri::{AppHandle, Emitter};

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
            println!("🎯 Push-to-talk key set to: {:?}", key);
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
        let monitor = self.clone();
        
        // Spawn a thread to handle keyboard events with panic catching
        std::thread::Builder::new()
            .name("keyboard-monitor".to_string())
            .spawn(move || {
                // Catch any panics to prevent app crash
                let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
                    if let Err(e) = rdev::listen(move |event: Event| {
                        // Wrap event handling in panic catch as well
                        let _ = std::panic::catch_unwind(AssertUnwindSafe(|| {
                            monitor.handle_event(event);
                        }));
                    }) {
                        eprintln!("❌ Failed to start keyboard monitoring: {:?}", e);
                    }
                }));
                
                if let Err(e) = result {
                    eprintln!("❌ Keyboard monitor thread panicked: {:?}", e);
                }
            })
            .unwrap_or_else(|e| {
                eprintln!("❌ Failed to spawn keyboard monitor thread: {}", e);
            });
    }

    fn handle_event(&self, event: Event) {
        match event.event_type {
            EventType::KeyPress(key) => {
                if let Ok(mut pressed) = self.pressed_keys.lock() {
                    pressed.insert(key);
                }
                
                // Check if this is the push-to-talk key
                if let (Ok(ptk), Ok(mut is_active)) = (self.push_to_talk_key.lock(), self.is_push_to_talk_active.lock()) {
                    if let Some(push_key) = *ptk {
                        if key == push_key && !*is_active {
                            *is_active = true;
                            println!("🎤 Push-to-talk key pressed: {:?}", key);
                            // Note: The actual recording start is handled by the existing global shortcut
                            // This just tracks the state for release detection
                        }
                    }
                }
            }
            EventType::KeyRelease(key) => {
                if let Ok(mut pressed) = self.pressed_keys.lock() {
                    pressed.remove(&key);
                }
                
                // Check if this is the push-to-talk key being released
                if let (Ok(ptk), Ok(mut is_active)) = (self.push_to_talk_key.lock(), self.is_push_to_talk_active.lock()) {
                    if let Some(push_key) = *ptk {
                        if key == push_key && *is_active {
                            *is_active = false;
                            println!("🎤 Push-to-talk key released: {:?}", key);
                            // Emit event to stop recording
                            let _ = self.app_handle.emit("push-to-talk-released", ());
                        }
                    }
                }
            }
            _ => {}
        }
    }

    pub fn is_push_to_talk_active(&self) -> bool {
        self.is_push_to_talk_active.lock().map(|active| *active).unwrap_or(false)
    }
}