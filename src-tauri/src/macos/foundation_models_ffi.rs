use std::ffi::{CStr, CString};
use std::os::raw::c_char;

#[cfg(target_os = "macos")]
extern "C" {
    fn check_foundation_models_availability() -> bool;
    fn enhance_text_sync(text: *const c_char) -> *const c_char;
    fn clean_speech_sync(text: *const c_char) -> *const c_char;
    fn summarize_text_sync(text: *const c_char, max_sentences: i32) -> *const c_char;
    fn free_foundation_models_string(ptr: *const c_char);
}

pub struct FoundationModels;

impl FoundationModels {
    /// Check if Foundation Models is available on this system
    pub fn is_available() -> bool {
        #[cfg(target_os = "macos")]
        {
            unsafe { check_foundation_models_availability() }
        }
        #[cfg(not(target_os = "macos"))]
        {
            false
        }
    }

    /// Enhance transcript text with proper grammar, punctuation, and cleanup
    pub fn enhance_text(text: &str) -> Result<String, String> {
        #[cfg(target_os = "macos")]
        {
            let c_text = CString::new(text).map_err(|e| format!("Invalid text: {}", e))?;
            
            unsafe {
                let result_ptr = enhance_text_sync(c_text.as_ptr());
                if result_ptr.is_null() {
                    return Err("Foundation Models enhancement failed".to_string());
                }
                
                let result_cstr = CStr::from_ptr(result_ptr);
                let result = result_cstr.to_str()
                    .map_err(|e| format!("Invalid UTF-8: {}", e))?
                    .to_string();
                
                // Free the allocated string
                free_foundation_models_string(result_ptr);
                
                Ok(result)
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            Err("Foundation Models not available on this platform".to_string())
        }
    }

    /// Clean speech patterns by removing filler words and improving structure
    pub fn clean_speech_patterns(text: &str) -> Result<String, String> {
        #[cfg(target_os = "macos")]
        {
            let c_text = CString::new(text).map_err(|e| format!("Invalid text: {}", e))?;
            
            unsafe {
                let result_ptr = clean_speech_sync(c_text.as_ptr());
                if result_ptr.is_null() {
                    return Err("Foundation Models speech cleaning failed".to_string());
                }
                
                let result_cstr = CStr::from_ptr(result_ptr);
                let result = result_cstr.to_str()
                    .map_err(|e| format!("Invalid UTF-8: {}", e))?
                    .to_string();
                
                // Free the allocated string
                free_foundation_models_string(result_ptr);
                
                Ok(result)
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            Err("Foundation Models not available on this platform".to_string())
        }
    }

    /// Summarize text in the specified number of sentences
    pub fn summarize_text(text: &str, max_sentences: u32) -> Result<String, String> {
        #[cfg(target_os = "macos")]
        {
            let c_text = CString::new(text).map_err(|e| format!("Invalid text: {}", e))?;
            
            unsafe {
                let result_ptr = summarize_text_sync(c_text.as_ptr(), max_sentences as i32);
                if result_ptr.is_null() {
                    return Err("Foundation Models summarization failed".to_string());
                }
                
                let result_cstr = CStr::from_ptr(result_ptr);
                let result = result_cstr.to_str()
                    .map_err(|e| format!("Invalid UTF-8: {}", e))?
                    .to_string();
                
                // Free the allocated string
                free_foundation_models_string(result_ptr);
                
                Ok(result)
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            Err("Foundation Models not available on this platform".to_string())
        }
    }
}