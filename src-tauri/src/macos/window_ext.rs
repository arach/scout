#[cfg(target_os = "macos")]
use cocoa::base::{id, nil, YES, NO};
use cocoa::appkit::NSWindowCollectionBehavior;
use cocoa::foundation::NSUInteger;
use objc::{msg_send, sel, sel_impl};
use tauri::{Runtime, WebviewWindow};

pub trait MacOSWindowExt {
    fn setup_overlay_window(&self) -> Result<(), String>;
}

#[cfg(target_os = "macos")]
impl<R: Runtime> MacOSWindowExt for WebviewWindow<R> {
    fn setup_overlay_window(&self) -> Result<(), String> {
        let ns_win = match self.ns_window() {
            Ok(win) => win,
            Err(e) => return Err(format!("Failed to get NS window: {:?}", e)),
        };
        
        unsafe {
            let ns_window: id = ns_win as *const _ as id;
            
            // Check if window is valid
            if ns_window == nil {
                return Err("NS window is nil".to_string());
            }
            
            // Use cocoa constants instead of raw values
            let floating_level = 3i64; // NSFloatingWindowLevel
            
            // Try each operation separately
            
            // 1. Set window level to floating
            let _: () = msg_send![ns_window, setLevel: floating_level];
            
            // 2. Set collection behavior for hover without activation
            // NSWindowCollectionBehaviorCanJoinAllSpaces = 1 << 0
            // NSWindowCollectionBehaviorStationary = 1 << 4  
            // NSWindowCollectionBehaviorIgnoresCycle = 1 << 6
            // NSWindowCollectionBehaviorFullScreenAuxiliary = 1 << 8
            let collection_behavior: NSUInteger = (1 << 0) | (1 << 4) | (1 << 6) | (1 << 8);
            let _: () = msg_send![ns_window, setCollectionBehavior: collection_behavior];
            
            // 3. Configure mouse event handling
            let _: () = msg_send![ns_window, setAcceptsMouseMovedEvents: YES];
            let _: () = msg_send![ns_window, setIgnoresMouseEvents: NO];
            
            // Note: setBecomesKeyOnlyIfNeeded and setHidesOnDeactivate are NSPanel-only
            // methods and will cause errors on NSWindow
            
            Ok(())
        }
    }
}

#[cfg(not(target_os = "macos"))]
impl<R: Runtime> MacOSWindowExt for WebviewWindow<R> {
    fn setup_overlay_window(&self) -> Result<(), String> {
        // No-op on non-macOS platforms
        Ok(())
    }
}