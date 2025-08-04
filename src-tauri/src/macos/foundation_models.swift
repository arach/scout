import Foundation
import FoundationModels

@available(macOS 14.0, *)
@objc public class FoundationModelsProcessor: NSObject {
    
    private var enhanceSession: LanguageModelSession?
    private var cleanSession: LanguageModelSession?
    private var summarizeSession: LanguageModelSession?
    
    @objc public override init() {
        super.init()
        setupSessions()
    }
    
    private func setupSessions() {
        // Enhancement session for improving grammar and clarity
        enhanceSession = LanguageModelSession(
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
        
        // Speech cleaning session for removing filler words
        cleanSession = LanguageModelSession(
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
        
        // Summarization session
        summarizeSession = LanguageModelSession(
            instructions: """
            You are a summarization assistant. Create concise, accurate summaries that capture the key points and main ideas.
            Focus on the most important information and maintain the original context.
            """
        )
    }
    
    @objc public static func isAvailable() -> Bool {
        guard #available(macOS 14.0, *) else { return false }
        return SystemLanguageModel.default.supportedLanguages.contains(Locale.current.language)
    }
    
    @objc public func enhanceText(_ text: String) async -> String? {
        guard #available(macOS 14.0, *), let session = enhanceSession else { return nil }
        
        do {
            let prompt = "Please enhance this transcribed text:\n\n\(text)"
            let options = GenerationOptions(temperature: 0.1)
            let response = try await session.respond(to: prompt, options: options)
            return response.content
        } catch {
            NSLog("Foundation Models enhancement failed: \(error)")
            return nil
        }
    }
    
    @objc public func cleanSpeechPatterns(_ text: String) async -> String? {
        guard #available(macOS 14.0, *), let session = cleanSession else { return nil }
        
        do {
            let prompt = "Please clean up this transcribed speech:\n\n\(text)"
            let options = GenerationOptions(temperature: 0.1)
            let response = try await session.respond(to: prompt, options: options)
            return response.content
        } catch {
            NSLog("Foundation Models speech cleaning failed: \(error)")
            return nil
        }
    }
    
    @objc public func summarizeText(_ text: String, maxSentences: Int) async -> String? {
        guard #available(macOS 14.0, *), let session = summarizeSession else { return nil }
        
        do {
            let prompt = "Please summarize this text in \(maxSentences) sentences or less:\n\n\(text)"
            let options = GenerationOptions(temperature: 0.3)
            let response = try await session.respond(to: prompt, options: options)
            return response.content
        } catch {
            NSLog("Foundation Models summarization failed: \(error)")
            return nil
        }
    }
    
    @objc public func resetSessions() {
        setupSessions()
    }
}

// Simple C-style wrapper functions for easier Rust integration
@_cdecl("foundation_models_is_available")
public func foundation_models_is_available() -> Bool {
    return FoundationModelsProcessor.isAvailable()
}

@_cdecl("foundation_models_enhance_text")
public func foundation_models_enhance_text(_ text: UnsafePointer<CChar>, _ result: UnsafeMutablePointer<UnsafePointer<CChar>?>) {
    guard #available(macOS 14.0, *) else {
        result.pointee = nil
        return
    }
    
    let inputText = String(cString: text)
    let processor = FoundationModelsProcessor()
    
    Task {
        if let enhanced = await processor.enhanceText(inputText) {
            let cString = strdup(enhanced)
            result.pointee = cString
        } else {
            result.pointee = nil
        }
    }
}

@_cdecl("foundation_models_clean_speech")
public func foundation_models_clean_speech(_ text: UnsafePointer<CChar>, _ result: UnsafeMutablePointer<UnsafePointer<CChar>?>) {
    guard #available(macOS 14.0, *) else {
        result.pointee = nil
        return
    }
    
    let inputText = String(cString: text)
    let processor = FoundationModelsProcessor()
    
    Task {
        if let cleaned = await processor.cleanSpeechPatterns(inputText) {
            let cString = strdup(cleaned)
            result.pointee = cString
        } else {
            result.pointee = nil
        }
    }
}

@_cdecl("foundation_models_summarize")
public func foundation_models_summarize(_ text: UnsafePointer<CChar>, _ maxSentences: Int32, _ result: UnsafeMutablePointer<UnsafePointer<CChar>?>) {
    guard #available(macOS 14.0, *) else {
        result.pointee = nil
        return
    }
    
    let inputText = String(cString: text)
    let processor = FoundationModelsProcessor()
    
    Task {
        if let summary = await processor.summarizeText(inputText, maxSentences: Int(maxSentences)) {
            let cString = strdup(summary)
            result.pointee = cString
        } else {
            result.pointee = nil
        }
    }
}

@_cdecl("foundation_models_free_string")
public func foundation_models_free_string(_ ptr: UnsafePointer<CChar>?) {
    if let ptr = ptr {
        free(UnsafeMutableRawPointer(mutating: ptr))
    }
}