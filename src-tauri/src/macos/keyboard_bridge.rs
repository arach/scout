use crate::logger::{debug, error, info, Component};
use std::ffi::CString;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

// External Swift functions
extern "C" {
    fn keyboard_monitor_create() -> *mut std::ffi::c_void;
    fn keyboard_monitor_set_shortcut(shortcut: *const std::ffi::c_char);
    fn keyboard_monitor_request_permissions() -> bool;
    fn keyboard_monitor_has_permissions() -> bool;
    fn keyboard_monitor_destroy();
}

pub struct MacOSKeyboardMonitor {
    _handle: *mut std::ffi::c_void,
    app_handle: AppHandle,
}

// Global instance
static KEYBOARD_MONITOR: OnceLock<Arc<Mutex<Option<MacOSKeyboardMonitor>>>> = OnceLock::new();

impl MacOSKeyboardMonitor {
    pub fn new(app_handle: AppHandle) -> Result<Self, String> {
        info(Component::UI, "Creating macOS keyboard monitor");
        
        unsafe {
            let handle = keyboard_monitor_create();
            if handle.is_null() {
                error(Component::UI, "Swift keyboard_monitor_create returned null pointer");
                return Err("Failed to create keyboard monitor - Swift returned null".to_string());
            }
            
            let monitor = MacOSKeyboardMonitor {
                _handle: handle,
                app_handle,
            };
            
            // Set up notification observer for events from Swift
            monitor.setup_notification_observer()?;
            
            info(Component::UI, "macOS keyboard monitor created successfully");
            Ok(monitor)
        }
    }
    
    pub fn set_push_to_talk_shortcut(&self, shortcut: &str) -> Result<(), String> {
        info(Component::UI, &format!("Setting push-to-talk shortcut: {}", shortcut));
        
        let c_shortcut = CString::new(shortcut)
            .map_err(|e| format!("Failed to convert shortcut to C string: {}", e))?;
        
        unsafe {
            keyboard_monitor_set_shortcut(c_shortcut.as_ptr());
        }
        
        Ok(())
    }
    
    pub fn request_accessibility_permissions(&self) -> bool {
        info(Component::UI, "Requesting accessibility permissions");
        unsafe { keyboard_monitor_request_permissions() }
    }
    
    pub fn has_accessibility_permissions(&self) -> bool {
        unsafe { keyboard_monitor_has_permissions() }
    }
    
    fn setup_notification_observer(&self) -> Result<(), String> {
        info(Component::UI, "Setting up notification observer for keyboard events");
        
        // The Swift code will call back directly through keyboard_event_callback
        // No additional setup needed here
        
        Ok(())
    }
    
    pub fn emit_event(&self, event: &str) {
        // Emit events directly without tokio::spawn to avoid runtime context issues
        match event {
            "push-to-talk-pressed" => {
                info(Component::UI, "🎯 [macOS] Emitting push-to-talk-pressed event");
                if let Err(e) = self.app_handle.emit("push-to-talk-pressed", ()) {
                    error(Component::UI, &format!("Failed to emit push-to-talk-pressed: {}", e));
                }
            }
            "push-to-talk-released" => {
                info(Component::UI, "🎯 [macOS] Emitting push-to-talk-released event");
                if let Err(e) = self.app_handle.emit("push-to-talk-released", ()) {
                    error(Component::UI, &format!("Failed to emit push-to-talk-released: {}", e));
                }
            }
            _ => {
                debug(Component::UI, &format!("Unknown keyboard event: {}", event));
            }
        }
    }
}

impl Drop for MacOSKeyboardMonitor {
    fn drop(&mut self) {
        info(Component::UI, "Destroying macOS keyboard monitor");
        unsafe {
            keyboard_monitor_destroy();
        }
    }
}

unsafe impl Send for MacOSKeyboardMonitor {}
unsafe impl Sync for MacOSKeyboardMonitor {}

// Global functions for managing the keyboard monitor
pub fn initialize_keyboard_monitor(app_handle: AppHandle) -> Result<(), String> {
    let monitor_mutex = KEYBOARD_MONITOR.get_or_init(|| Arc::new(Mutex::new(None)));
    let mut monitor_guard = monitor_mutex.lock().map_err(|e| format!("Failed to lock monitor: {}", e))?;
    
    if monitor_guard.is_some() {
        debug(Component::UI, "macOS keyboard monitor already initialized, skipping");
        return Ok(());
    }
    
    // Check accessibility permissions first
    info(Component::UI, "Checking macOS accessibility permissions for keyboard monitoring");
    let monitor = MacOSKeyboardMonitor::new(app_handle)?;
    
    if !monitor.has_accessibility_permissions() {
        info(Component::UI, "⚠️  Accessibility permissions not granted, requesting...");
        let permission_granted = monitor.request_accessibility_permissions();
        if !permission_granted {
            return Err("Accessibility permissions required for macOS keyboard monitoring. Please grant permissions in System Preferences > Security & Privacy > Privacy > Accessibility".to_string());
        }
        info(Component::UI, "✅ Accessibility permissions granted");
    }
    
    *monitor_guard = Some(monitor);
    
    info(Component::UI, "✅ macOS keyboard monitor initialized successfully");
    Ok(())
}

pub fn set_push_to_talk_shortcut(shortcut: &str) -> Result<(), String> {
    let monitor_mutex = KEYBOARD_MONITOR.get()
        .ok_or_else(|| "Keyboard monitor not initialized".to_string())?;
    let monitor_guard = monitor_mutex.lock()
        .map_err(|e| format!("Failed to lock monitor: {}", e))?;
    
    if let Some(monitor) = monitor_guard.as_ref() {
        monitor.set_push_to_talk_shortcut(shortcut)
    } else {
        Err("Keyboard monitor not available".to_string())
    }
}

pub fn request_accessibility_permissions() -> Result<bool, String> {
    let monitor_mutex = KEYBOARD_MONITOR.get()
        .ok_or_else(|| "Keyboard monitor not initialized".to_string())?;
    let monitor_guard = monitor_mutex.lock()
        .map_err(|e| format!("Failed to lock monitor: {}", e))?;
    
    if let Some(monitor) = monitor_guard.as_ref() {
        Ok(monitor.request_accessibility_permissions())
    } else {
        Err("Keyboard monitor not available".to_string())
    }
}

pub fn has_accessibility_permissions() -> Result<bool, String> {
    let monitor_mutex = KEYBOARD_MONITOR.get()
        .ok_or_else(|| "Keyboard monitor not initialized".to_string())?;
    let monitor_guard = monitor_mutex.lock()
        .map_err(|e| format!("Failed to lock monitor: {}", e))?;
    
    if let Some(monitor) = monitor_guard.as_ref() {
        Ok(monitor.has_accessibility_permissions())
    } else {
        Err("Keyboard monitor not available".to_string())
    }
}

// This function can be called from Swift via a callback mechanism
#[no_mangle]
pub extern "C" fn keyboard_event_callback(event_name: *const std::ffi::c_char) {
    // Wrap the entire callback in a panic catch to prevent app crashes
    let result = std::panic::catch_unwind(|| {
        info(Component::UI, "🎯 keyboard_event_callback called from Swift!");
        
        if event_name.is_null() {
            error(Component::UI, "❌ keyboard_event_callback received null event_name");
            return;
        }
        
        let event_str = unsafe {
            match std::ffi::CStr::from_ptr(event_name).to_str() {
                Ok(s) => s,
                Err(_) => {
                    error(Component::UI, "Failed to convert event name from C string");
                    return;
                }
            }
        };
        
        info(Component::UI, &format!("🎯 Swift keyboard event received: '{}'", event_str));
        
        let monitor_mutex = match KEYBOARD_MONITOR.get() {
            Some(m) => m,
            None => {
                error(Component::UI, "Keyboard monitor not initialized for callback");
                return;
            }
        };
        
        let monitor_guard = match monitor_mutex.lock() {
            Ok(guard) => guard,
            Err(e) => {
                error(Component::UI, &format!("Failed to lock monitor for callback: {}", e));
                return;
            }
        };
        
        if let Some(monitor) = monitor_guard.as_ref() {
            monitor.emit_event(event_str);
        }
    });
    
    if let Err(panic_info) = result {
        error(Component::UI, &format!("❌ PANIC in keyboard_event_callback: {:?}", panic_info));
    }
}