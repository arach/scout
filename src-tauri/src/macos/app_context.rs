use std::ffi::{c_char, CStr};
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppContext {
    pub name: String,
    pub bundle_id: String,
    pub path: Option<String>,
    pub process_id: Option<i32>,
}

#[cfg(target_os = "macos")]
extern "C" {
    fn get_active_app_name() -> *const c_char;
    fn get_active_app_bundle_id() -> *const c_char;
    fn free_app_string(ptr: *const c_char);
}

#[cfg(target_os = "macos")]
pub fn get_active_app_context() -> Option<AppContext> {
    unsafe {
        let name_ptr = get_active_app_name();
        let bundle_id_ptr = get_active_app_bundle_id();
        
        if name_ptr.is_null() || bundle_id_ptr.is_null() {
            return None;
        }
        
        let name = CStr::from_ptr(name_ptr)
            .to_string_lossy()
            .to_string();
        
        let bundle_id = CStr::from_ptr(bundle_id_ptr)
            .to_string_lossy()
            .to_string();
        
        // Free the allocated strings
        free_app_string(name_ptr);
        free_app_string(bundle_id_ptr);
        
        Some(AppContext {
            name,
            bundle_id,
            path: None,
            process_id: None,
        })
    }
}

#[cfg(not(target_os = "macos"))]
pub fn get_active_app_context() -> Option<AppContext> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_active_app_context() {
        // This test will only work on macOS
        #[cfg(target_os = "macos")]
        {
            let context = get_active_app_context();
            // We should get some app context (even if it's the test runner)
            assert!(context.is_some());
            
            if let Some(ctx) = context {
                assert!(!ctx.name.is_empty());
                assert!(!ctx.bundle_id.is_empty());
            }
        }
    }
}