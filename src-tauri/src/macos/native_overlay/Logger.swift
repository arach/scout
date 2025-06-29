import Foundation

enum LogLevel: String {
    case debug = "🔍"
    case info = "📊"
    case warn = "⚠️"
    case error = "❌"
}

enum Component: String {
    case overlay = "OVERLAY"
    case recording = "RECORDING"
    case transcription = "TRANSCRIPTION"
    case ringBuffer = "RINGBUFFER"
    case processing = "PROCESSING"
    case ffi = "FFI"
    case ui = "UI"
}

class Logger {
    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss.SSS"
        return formatter
    }()
    
    static func log(_ component: Component, _ level: LogLevel, _ message: String) {
        let timestamp = dateFormatter.string(from: Date())
        print("[\(timestamp)] \(level.rawValue) [\(component.rawValue)] \(message)")
    }
    
    static func logWithContext(_ component: Component, _ level: LogLevel, _ message: String, context: String) {
        let timestamp = dateFormatter.string(from: Date())
        print("[\(timestamp)] \(level.rawValue) [\(component.rawValue)] \(message) - \(context)")
    }
    
    // Convenience functions
    static func debug(_ component: Component, _ message: String) {
        log(component, .debug, message)
    }
    
    static func info(_ component: Component, _ message: String) {
        log(component, .info, message)
    }
    
    static func warn(_ component: Component, _ message: String) {
        log(component, .warn, message)
    }
    
    static func error(_ component: Component, _ message: String) {
        log(component, .error, message)
    }
}