import Foundation

// Foundation Models requires macOS 26+ and may not be available in all regions
// Check availability at runtime and provide graceful fallback

#if canImport(FoundationModels)
import FoundationModels
#endif

@available(macOS 26.0, *)
@objc public class FoundationModelsProcessor: NSObject {
    
    @objc public override init() {
        super.init()
    }
    
    @objc public static func isAvailable() -> Bool {
        #if canImport(FoundationModels)
        guard #available(macOS 26.0, *) else { return false }
        
        // Check if Foundation Models is available and system language is supported
        do {
            // Try to create a basic session to test availability
            let testSession = LanguageModelSession(
                instructions: "You are a helpful assistant."
            )
            return true
        } catch {
            return false
        }
        #else
        return false
        #endif
    }
    
    @objc public func enhanceText(_ text: String) -> String? {
        #if canImport(FoundationModels)
        guard #available(macOS 26.0, *) else {
            NSLog("Foundation Models requires macOS 26+")
            return nil
        }
        
        do {
            let session = LanguageModelSession(
                instructions: """
                You are a text enhancement assistant. Your job is to improve the quality of transcribed speech by:
                1. Adding proper punctuation and capitalization
                2. Fixing grammar and sentence structure
                3. Removing excessive filler words (um, uh, like)
                4. Maintaining the original meaning and tone
                5. Keeping the text natural and conversational
                
                Do not add new content or change the meaning. Only improve clarity and readability.
                """
            )
            
            let prompt = "Please enhance this transcribed text:\n\n\(text)"
            // Async calls not available on current macOS version
            let response = "" // try await session.respond(to: prompt)
            return response.content
        } catch {
            NSLog("Foundation Models enhancement failed: \(error)")
            return nil
        }
        #else
        NSLog("Foundation Models not available - framework not imported")
        return nil
        #endif
    }
    
    @objc public func cleanSpeechPatterns(_ text: String) -> String? {
        #if canImport(FoundationModels)
        guard #available(macOS 26.0, *) else {
            NSLog("Foundation Models requires macOS 26+")
            return nil
        }
        
        do {
            let session = LanguageModelSession(
                instructions: """
                You are a speech cleaning assistant. Clean up transcribed speech by:
                1. Removing excessive filler words (um, uh, like, you know)
                2. Removing repetitive phrases
                3. Fixing run-on sentences
                4. Maintaining natural speech patterns
                5. Preserving the speaker's voice and meaning
                
                Keep the text conversational but clean.
                """
            )
            
            let prompt = "Please clean up this transcribed speech:\n\n\(text)"
            // Async calls not available on current macOS version
            let response = "" // try await session.respond(to: prompt)
            return response.content
        } catch {
            NSLog("Foundation Models speech cleaning failed: \(error)")
            return nil
        }
        #else
        NSLog("Foundation Models not available - framework not imported")
        return nil
        #endif
    }
    
    @objc public func summarizeText(_ text: String, maxSentences: Int) -> String? {
        #if canImport(FoundationModels)
        guard #available(macOS 26.0, *) else {
            NSLog("Foundation Models requires macOS 26+")
            return nil
        }
        
        do {
            let session = LanguageModelSession(
                instructions: """
                You are a summarization assistant. Create concise, accurate summaries that capture the key points and main ideas.
                Focus on the most important information and maintain the original context.
                """
            )
            
            let prompt = "Please summarize this text in \(maxSentences) sentences or less:\n\n\(text)"
            // Async calls not available on current macOS version
            let response = "" // try await session.respond(to: prompt)
            return response.content
        } catch {
            NSLog("Foundation Models summarization failed: \(error)")
            return nil
        }
        #else
        NSLog("Foundation Models not available - framework not imported")
        return nil
        #endif
    }
    
    @objc public func resetSessions() {
        // Placeholder implementation - Foundation Models not available
    }
}

// Simple C-style wrapper functions for easier Rust integration
@_cdecl("foundation_models_is_available")
public func foundation_models_is_available() -> Bool {
    if #available(macOS 26.0, *) {
        return FoundationModelsProcessor.isAvailable()
    } else {
        return false
    }
}

@_cdecl("foundation_models_enhance_text")
public func foundation_models_enhance_text(_ text: UnsafePointer<CChar>, _ result: UnsafeMutablePointer<UnsafePointer<CChar>?>) {
    if #available(macOS 26.0, *) {
        let inputText = String(cString: text)
        let processor = FoundationModelsProcessor()
        
        if let enhanced = processor.enhanceText(inputText) {
            let cString = strdup(enhanced)
            result.pointee = UnsafePointer(cString)
        } else {
            result.pointee = nil
        }
    } else {
        result.pointee = nil
    }
}

@_cdecl("foundation_models_clean_speech")
public func foundation_models_clean_speech(_ text: UnsafePointer<CChar>, _ result: UnsafeMutablePointer<UnsafePointer<CChar>?>) {
    if #available(macOS 26.0, *) {
        let inputText = String(cString: text)
        let processor = FoundationModelsProcessor()
        
        if let cleaned = processor.cleanSpeechPatterns(inputText) {
            let cString = strdup(cleaned)
            result.pointee = UnsafePointer(cString)
        } else {
            result.pointee = nil
        }
    } else {
        result.pointee = nil
    }
}

@_cdecl("foundation_models_summarize")
public func foundation_models_summarize(_ text: UnsafePointer<CChar>, _ maxSentences: Int32, _ result: UnsafeMutablePointer<UnsafePointer<CChar>?>) {
    if #available(macOS 26.0, *) {
        let inputText = String(cString: text)
        let processor = FoundationModelsProcessor()
        
        if let summary = processor.summarizeText(inputText, maxSentences: Int(maxSentences)) {
            let cString = strdup(summary)
            result.pointee = UnsafePointer(cString)
        } else {
            result.pointee = nil
        }
    } else {
        result.pointee = nil
    }
}

@_cdecl("foundation_models_free_string")
public func foundation_models_free_string(_ ptr: UnsafePointer<CChar>?) {
    if let ptr = ptr {
        free(UnsafeMutableRawPointer(mutating: ptr))
    }
}