use once_cell::sync::Lazy;
#[cfg(target_os = "macos")]
use std::sync::Mutex;

// FFI declarations for Swift functions
#[cfg(target_os = "macos")]
extern "C" {
    fn native_overlay_show();
    fn native_overlay_hide();
    fn native_overlay_set_recording_state(recording: bool);
    fn native_overlay_set_stopping_state();
    fn native_overlay_set_processing_state(processing: bool);
    fn native_overlay_set_idle_state();
    fn native_overlay_set_start_recording_callback(callback: extern "C" fn());
    fn native_overlay_set_stop_recording_callback(callback: extern "C" fn());
    fn native_overlay_set_cancel_recording_callback(callback: extern "C" fn());
    fn native_overlay_set_volume_level(level: f32);
    fn native_overlay_set_position(position: *const std::os::raw::c_char);
    fn native_overlay_get_current_state() -> *const std::os::raw::c_char;
    fn native_overlay_set_waveform_style(style: *const std::os::raw::c_char);
}

// Global callbacks storage
#[cfg(target_os = "macos")]
static CALLBACKS: Lazy<Mutex<NativeOverlayCallbacks>> = Lazy::new(|| {
    Mutex::new(NativeOverlayCallbacks {
        on_start_recording: None,
        on_stop_recording: None,
        on_cancel_recording: None,
    })
});

#[cfg(target_os = "macos")]
struct NativeOverlayCallbacks {
    on_start_recording: Option<Box<dyn Fn() + Send + Sync>>,
    on_stop_recording: Option<Box<dyn Fn() + Send + Sync>>,
    on_cancel_recording: Option<Box<dyn Fn() + Send + Sync>>,
}

// C callback functions that will be called from Swift
#[cfg(target_os = "macos")]
extern "C" fn start_recording_callback() {
    if let Ok(callbacks) = CALLBACKS.lock() {
        if let Some(callback) = &callbacks.on_start_recording {
            callback();
        }
    }
}

#[cfg(target_os = "macos")]
extern "C" fn stop_recording_callback() {
    if let Ok(callbacks) = CALLBACKS.lock() {
        if let Some(callback) = &callbacks.on_stop_recording {
            callback();
        }
    }
}

#[cfg(target_os = "macos")]
extern "C" fn cancel_recording_callback() {
    if let Ok(callbacks) = CALLBACKS.lock() {
        if let Some(callback) = &callbacks.on_cancel_recording {
            callback();
        }
    }
}

// Public API
pub struct NativeOverlay;

impl NativeOverlay {
    pub fn new() -> Self {
        // Set up callbacks
        #[cfg(target_os = "macos")]
        unsafe {
            native_overlay_set_start_recording_callback(start_recording_callback);
            native_overlay_set_stop_recording_callback(stop_recording_callback);
            native_overlay_set_cancel_recording_callback(cancel_recording_callback);
        }

        NativeOverlay
    }

    pub fn show(&self) {
        #[cfg(target_os = "macos")]
        unsafe {
            native_overlay_show();
        }
    }

    pub fn hide(&self) {
        #[cfg(target_os = "macos")]
        unsafe {
            native_overlay_hide();
        }
    }

    pub fn set_recording_state(&self, recording: bool) {
        #[cfg(target_os = "macos")]
        unsafe {
            native_overlay_set_recording_state(recording);
        }
    }

    pub fn set_stopping_state(&self) {
        #[cfg(target_os = "macos")]
        unsafe {
            native_overlay_set_stopping_state();
        }
    }

    pub fn set_processing_state(&self, processing: bool) {
        #[cfg(target_os = "macos")]
        unsafe {
            native_overlay_set_processing_state(processing);
        }
    }

    pub fn set_idle_state(&self) {
        #[cfg(target_os = "macos")]
        unsafe {
            native_overlay_set_idle_state();
        }
    }

    pub fn set_on_start_recording<F>(&self, callback: F)
    where
        F: Fn() + Send + Sync + 'static,
    {
        #[cfg(target_os = "macos")]
        {
            if let Ok(mut callbacks) = CALLBACKS.lock() {
                callbacks.on_start_recording = Some(Box::new(callback));
            }
        }
    }

    pub fn set_on_stop_recording<F>(&self, callback: F)
    where
        F: Fn() + Send + Sync + 'static,
    {
        #[cfg(target_os = "macos")]
        {
            if let Ok(mut callbacks) = CALLBACKS.lock() {
                callbacks.on_stop_recording = Some(Box::new(callback));
            }
        }
    }

    pub fn set_on_cancel_recording<F>(&self, callback: F)
    where
        F: Fn() + Send + Sync + 'static,
    {
        #[cfg(target_os = "macos")]
        {
            if let Ok(mut callbacks) = CALLBACKS.lock() {
                callbacks.on_cancel_recording = Some(Box::new(callback));
            }
        }
    }

    pub fn set_volume_level(&self, level: f32) {
        #[cfg(target_os = "macos")]
        unsafe {
            native_overlay_set_volume_level(level.clamp(0.0, 1.0));
        }
    }

    pub fn set_position(&self, position: &str) {
        #[cfg(target_os = "macos")]
        unsafe {
            let c_string = std::ffi::CString::new(position).unwrap();
            native_overlay_set_position(c_string.as_ptr());
        }
    }

    pub fn get_current_state(&self) -> String {
        #[cfg(target_os = "macos")]
        unsafe {
            let state_ptr = native_overlay_get_current_state();
            if state_ptr.is_null() {
                return "unknown".to_string();
            }
            let c_str = std::ffi::CStr::from_ptr(state_ptr);
            let state = c_str.to_string_lossy().to_string();
            // Free the memory allocated by strdup
            libc::free(state_ptr as *mut libc::c_void);
            state
        }
        #[cfg(not(target_os = "macos"))]
        "unknown".to_string()
    }

    pub fn set_waveform_style(&self, style: &str) {
        #[cfg(target_os = "macos")]
        unsafe {
            let c_string = std::ffi::CString::new(style).unwrap();
            native_overlay_set_waveform_style(c_string.as_ptr());
        }
    }
}

// Stub implementation for non-macOS platforms
#[cfg(not(target_os = "macos"))]
impl NativeOverlay {
    pub fn new() -> Self {
        NativeOverlay
    }

    pub fn show(&self) {}
    pub fn hide(&self) {}
    pub fn set_recording_state(&self, _recording: bool) {}
    pub fn set_stopping_state(&self) {}
    pub fn set_processing_state(&self, _processing: bool) {}
    pub fn set_idle_state(&self) {}
    pub fn set_on_start_recording<F>(&self, _callback: F)
    where
        F: Fn() + Send + Sync + 'static,
    {
    }
    pub fn set_on_stop_recording<F>(&self, _callback: F)
    where
        F: Fn() + Send + Sync + 'static,
    {
    }
    pub fn set_on_cancel_recording<F>(&self, _callback: F)
    where
        F: Fn() + Send + Sync + 'static,
    {
    }
    pub fn set_volume_level(&self, _level: f32) {}
    pub fn set_position(&self, _position: &str) {}
    pub fn get_current_state(&self) -> String {
        "unknown".to_string()
    }
    pub fn set_waveform_style(&self, _style: &str) {}
}
