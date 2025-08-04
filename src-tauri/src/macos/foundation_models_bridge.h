#ifndef foundation_models_bridge_h
#define foundation_models_bridge_h

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

// Check if Foundation Models is available on this system
bool check_foundation_models_availability(void);

// Enhance transcript text (grammar, punctuation, cleanup)
// Returns allocated string that must be freed with free_foundation_models_string
const char* enhance_text_sync(const char* text);

// Clean speech patterns (remove filler words, fix structure)
// Returns allocated string that must be freed with free_foundation_models_string
const char* clean_speech_sync(const char* text);

// Summarize text
// Returns allocated string that must be freed with free_foundation_models_string
const char* summarize_text_sync(const char* text, int max_sentences);

// Free string returned by Foundation Models functions
void free_foundation_models_string(const char* ptr);

#ifdef __cplusplus
}
#endif

#endif /* foundation_models_bridge_h */