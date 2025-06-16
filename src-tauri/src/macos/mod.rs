#[cfg(target_os = "macos")]
use std::ffi::c_void;

#[cfg(target_os = "macos")]
#[link(name = "Foundation", kind = "framework")]
#[link(name = "Cocoa", kind = "framework")]
#[link(name = "WebKit", kind = "framework")]
extern "C" {
    fn create_overlay_window() -> *mut c_void;
    fn show_overlay_window(overlay: *mut c_void);
    fn hide_overlay_window(overlay: *mut c_void);
    fn position_overlay_window(overlay: *mut c_void, x: f64, y: f64);
    fn ensure_overlay_visible(overlay: *mut c_void);
    fn set_overlay_position(overlay: *mut c_void, position: *const i8);
    fn update_overlay_progress(overlay: *mut c_void, progress_state: *const i8);
    fn destroy_overlay_window(overlay: *mut c_void);
}

#[cfg(target_os = "macos")]
pub struct MacOSOverlay {
    overlay: *mut c_void,
}

#[cfg(target_os = "macos")]
impl MacOSOverlay {
    pub fn new() -> Self {
        unsafe {
            let overlay = create_overlay_window();
            Self { overlay }
        }
    }
    
    pub fn show(&self) {
        unsafe {
            show_overlay_window(self.overlay);
        }
    }
    
    pub fn hide(&self) {
        unsafe {
            hide_overlay_window(self.overlay);
        }
    }
    
    pub fn position_at(&self, x: f64, y: f64) {
        unsafe {
            position_overlay_window(self.overlay, x, y);
        }
    }
    
    pub fn ensure_visible(&self) {
        unsafe {
            ensure_overlay_visible(self.overlay);
        }
    }
    
    pub fn set_position(&self, position: &str) {
        unsafe {
            let c_string = std::ffi::CString::new(position).unwrap();
            set_overlay_position(self.overlay, c_string.as_ptr());
        }
    }
    
    pub fn update_progress(&self, progress_state: &str) {
        unsafe {
            let c_string = std::ffi::CString::new(progress_state).unwrap();
            update_overlay_progress(self.overlay, c_string.as_ptr());
        }
    }
}

#[cfg(target_os = "macos")]
impl Drop for MacOSOverlay {
    fn drop(&mut self) {
        unsafe {
            destroy_overlay_window(self.overlay);
        }
    }
}

#[cfg(target_os = "macos")]
unsafe impl Send for MacOSOverlay {}
#[cfg(target_os = "macos")]
unsafe impl Sync for MacOSOverlay {}

// Stub implementation for non-macOS platforms
#[cfg(not(target_os = "macos"))]
pub struct MacOSOverlay;

#[cfg(not(target_os = "macos"))]
impl MacOSOverlay {
    pub fn new() -> Self { Self }
    pub fn show(&self) {}
    pub fn hide(&self) {}
    pub fn position_at(&self, _x: f64, _y: f64) {}
    pub fn set_position(&self, _position: &str) {}
    pub fn ensure_visible(&self) {}
    pub fn update_progress(&self, _progress_state: &str) {}
}