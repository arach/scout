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
    
    pub fn set_position(&self, x: f64, y: f64) {
        unsafe {
            position_overlay_window(self.overlay, x, y);
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
    pub fn set_position(&self, _x: f64, _y: f64) {}
}