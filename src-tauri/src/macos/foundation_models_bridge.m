#import <Foundation/Foundation.h>

// C function declarations from Swift
extern bool foundation_models_is_available(void);
extern void foundation_models_enhance_text(const char* text, const char** result);
extern void foundation_models_clean_speech(const char* text, const char** result);
extern void foundation_models_summarize(const char* text, int max_sentences, const char** result);
extern void foundation_models_free_string(const char* ptr);

// Synchronous wrapper functions for Rust FFI
bool check_foundation_models_availability(void) {
    return foundation_models_is_available();
}

const char* enhance_text_sync(const char* text) {
    @autoreleasepool {
        if (!text) return NULL;
        
        const char* result = NULL;
        foundation_models_enhance_text(text, &result);
        
        // Note: Caller must free the returned string using free_foundation_models_string
        return result;
    }
}

const char* clean_speech_sync(const char* text) {
    @autoreleasepool {
        if (!text) return NULL;
        
        const char* result = NULL;
        foundation_models_clean_speech(text, &result);
        
        return result;
    }
}

const char* summarize_text_sync(const char* text, int max_sentences) {
    @autoreleasepool {
        if (!text) return NULL;
        
        const char* result = NULL;
        foundation_models_summarize(text, max_sentences, &result);
        
        return result;
    }
}

void free_foundation_models_string(const char* ptr) {
    if (ptr) {
        foundation_models_free_string(ptr);
    }
}