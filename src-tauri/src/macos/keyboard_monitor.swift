import Cocoa
import Foundation
import CoreGraphics

// External Rust function for callbacks
@_silgen_name("keyboard_event_callback")
func keyboard_event_callback(_ event: UnsafePointer<CChar>)

@objc class KeyboardMonitor: NSObject {
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var currentShortcut: KeyboardShortcut?
    private var isPushToTalkActive = false
    
    struct KeyboardShortcut {
        let keyCode: UInt16
        let modifierFlags: NSEvent.ModifierFlags
        
        init?(from shortcutString: String) {
            // Parse shortcut string like "Cmd+Shift+Space" or "Hyper P"
            print("[KeyboardShortcut] Parsing shortcut: \(shortcutString)")
            
            // Handle both "Hyper+P" and "Hyper P" formats
            var normalizedString = shortcutString
            
            // Special handling for space-separated format like "Hyper P"
            if shortcutString.contains(" ") && !shortcutString.contains("+") {
                normalizedString = shortcutString.replacingOccurrences(of: " ", with: "+")
                print("[KeyboardShortcut] Normalized space-separated format: \(normalizedString)")
            }
            
            let parts = normalizedString.components(separatedBy: "+")
            print("[KeyboardShortcut] Split into parts: \(parts)")
            
            var flags: NSEvent.ModifierFlags = []
            var keyString: String = ""
            
            for part in parts {
                let trimmedPart = part.trimmingCharacters(in: .whitespaces)
                switch trimmedPart.lowercased() {
                case "cmd", "command":
                    flags.insert(.command)
                case "ctrl", "control":
                    flags.insert(.control)
                case "shift":
                    flags.insert(.shift)
                case "alt", "option":
                    flags.insert(.option)
                case "hyper":
                    // Hyper key = Cmd + Ctrl + Alt + Shift
                    flags.insert(.command)
                    flags.insert(.control)
                    flags.insert(.option)
                    flags.insert(.shift)
                case "cmdorctrl":
                    // Handle the CmdOrCtrl format that comes from Tauri
                    flags.insert(.command)  // On macOS, CmdOrCtrl = Cmd
                default:
                    keyString = trimmedPart
                }
            }
            
            print("[KeyboardShortcut] Final key string: '\(keyString)', flags: \(flags)")
            guard let keyCode = Self.keyCodeForString(keyString) else {
                print("[KeyboardShortcut] Failed to find keyCode for key: '\(keyString)'")
                return nil
            }
            
            print("[KeyboardShortcut] Successfully created shortcut - keyCode: \(keyCode), flags: \(flags)")
            self.keyCode = keyCode
            self.modifierFlags = flags
        }
        
        func matches(event: NSEvent) -> Bool {
            let eventModifiers = event.modifierFlags.intersection([.command, .control, .shift, .option])
            let keyMatches = event.keyCode == self.keyCode
            let modifierMatches = eventModifiers == self.modifierFlags
            
            print("[KeyboardShortcut] Matching - keyCode: \(event.keyCode) vs \(self.keyCode) (\(keyMatches)), modifiers: \(eventModifiers.rawValue) vs \(self.modifierFlags.rawValue) (\(modifierMatches))")
            
            return keyMatches && modifierMatches
        }
        
        private static func keyCodeForString(_ keyString: String) -> UInt16? {
            switch keyString.lowercased() {
            case "space":
                return 49
            case "a":
                return 0
            case "b":
                return 11
            case "c":
                return 8
            case "d":
                return 2
            case "e":
                return 14
            case "f":
                return 3
            case "g":
                return 5
            case "h":
                return 4
            case "i":
                return 34
            case "j":
                return 38
            case "k":
                return 40
            case "l":
                return 37
            case "m":
                return 46
            case "n":
                return 45
            case "o":
                return 31
            case "p":
                return 35
            case "q":
                return 12
            case "r":
                return 15
            case "s":
                return 1
            case "t":
                return 17
            case "u":
                return 32
            case "v":
                return 9
            case "w":
                return 13
            case "x":
                return 7
            case "y":
                return 16
            case "z":
                return 6
            case "1":
                return 18
            case "2":
                return 19
            case "3":
                return 20
            case "4":
                return 21
            case "5":
                return 23
            case "6":
                return 22
            case "7":
                return 26
            case "8":
                return 28
            case "9":
                return 25
            case "0":
                return 29
            case "return", "enter":
                return 36
            case "escape":
                return 53
            case "backspace":
                return 51
            case "tab":
                return 48
            default:
                return nil
            }
        }
    }
    
    override init() {
        super.init()
        print("[KeyboardMonitor] Initialized")
    }
    
    deinit {
        stopMonitoring()
    }
    
    @objc func setPushToTalkShortcut(_ shortcutString: String) {
        print("[KeyboardMonitor] Setting push-to-talk shortcut: \(shortcutString)")
        currentShortcut = KeyboardShortcut(from: shortcutString)
        
        if let shortcut = currentShortcut {
            print("[KeyboardMonitor] Parsed shortcut successfully - keyCode: \(shortcut.keyCode), modifiers: \(shortcut.modifierFlags)")
            startMonitoring()
        } else {
            print("[KeyboardMonitor] Failed to parse shortcut: \(shortcutString)")
            stopMonitoring()
        }
    }
    
    private func startMonitoring() {
        stopMonitoring() // Stop any existing monitoring
        
        guard let shortcut = currentShortcut else { return }
        
        print("[KeyboardMonitor] Starting CGEvent keyboard monitoring for keyCode: \(shortcut.keyCode), modifiers: \(shortcut.modifierFlags)")
        
        // Create event tap callback
        let callback: CGEventTapCallBack = { proxy, type, event, refcon in
            guard let refcon = refcon else { return Unmanaged.passUnretained(event) }
            let monitor = Unmanaged<KeyboardMonitor>.fromOpaque(refcon).takeUnretainedValue()
            
            // Handle key events
            if type == .keyDown || type == .keyUp {
                let shouldConsume = monitor.handleCGKeyEvent(event, type: type)
                if shouldConsume {
                    // Consume the event (don't pass it through to the system)
                    return nil
                }
            }
            
            // Pass the event through for non-matching events
            return Unmanaged.passUnretained(event)
        }
        
        // Create event tap using modern API
        let eventMask = CGEventMask((1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue))
        eventTap = CGEvent.tapCreate(
            tap: .cghidEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: eventMask,
            callback: callback,
            userInfo: UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
        )
        
        guard let eventTap = eventTap else {
            print("[KeyboardMonitor] Failed to create event tap")
            return
        }
        
        // Create run loop source and add to current run loop
        runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
        
        // Enable the event tap using modern API
        CGEvent.tapEnable(tap: eventTap, enable: true)
        
        print("[KeyboardMonitor] CGEvent keyboard monitoring started")
    }
    
    func stopMonitoring() {
        if let runLoopSource = runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
            self.runLoopSource = nil
        }
        
        if let eventTap = eventTap {
            CGEvent.tapEnable(tap: eventTap, enable: false)
            self.eventTap = nil
        }
        
        isPushToTalkActive = false
        print("[KeyboardMonitor] CGEvent keyboard monitoring stopped")
    }
    
    private func handleCGKeyEvent(_ event: CGEvent, type: CGEventType) -> Bool {
        guard let shortcut = currentShortcut else { return false }
        
        let keyCode = UInt16(event.getIntegerValueField(.keyboardEventKeycode))
        let flags = event.flags
        
        let eventType = type == .keyDown ? "keyDown" : "keyUp"
        
        // Convert CGEventFlags to NSEvent.ModifierFlags for compatibility with existing shortcut matching
        var nsFlags: NSEvent.ModifierFlags = []
        if flags.contains(.maskCommand) { nsFlags.insert(.command) }
        if flags.contains(.maskControl) { nsFlags.insert(.control) }
        if flags.contains(.maskShift) { nsFlags.insert(.shift) }
        if flags.contains(.maskAlternate) { nsFlags.insert(.option) }
        
        let keyMatches = keyCode == shortcut.keyCode
        let modifierMatches = nsFlags == shortcut.modifierFlags
        
        // Check if this is a modifier key that's part of our shortcut
        let isShortcutModifier = (shortcut.modifierFlags.contains(.command) && (keyCode == 54 || keyCode == 55)) || // Cmd keys
                               (shortcut.modifierFlags.contains(.control) && (keyCode == 59 || keyCode == 62)) || // Ctrl keys  
                               (shortcut.modifierFlags.contains(.shift) && (keyCode == 56 || keyCode == 60)) ||   // Shift keys
                               (shortcut.modifierFlags.contains(.option) && (keyCode == 58 || keyCode == 61))     // Option keys
        
        // Only process events that are directly related to our shortcut
        let isRelevantEvent = keyMatches || (isPushToTalkActive && isShortcutModifier)
        
        if !isRelevantEvent {
            return false // Immediately pass through unrelated events
        }
        
        // Separate keydown and keyup logic for better reliability
        if type == .keyDown {
            // For keydown, only consume when we have the exact complete shortcut
            if keyMatches && modifierMatches && !isPushToTalkActive {
                isPushToTalkActive = true
                print("[KeyboardMonitor] Push-to-talk PRESSED - consuming complete shortcut")
                notifyRust("push-to-talk-pressed", data: [:])
                return true // Consume this event
            }
        } else if type == .keyUp && isPushToTalkActive {
            // For keyup, check if either the main key or any essential modifier key was released
            let isMainKey = keyCode == shortcut.keyCode
            let isEssentialModifier = isShortcutModifier
            
            if isMainKey || isEssentialModifier {
                isPushToTalkActive = false
                let releaseReason = isMainKey ? "main key released" : "modifier key released"
                print("[KeyboardMonitor] Push-to-talk RELEASED (\(releaseReason)) - consuming release")
                notifyRust("push-to-talk-released", data: [:])
                
                // Only consume the main key release to be more conservative
                return isMainKey
            }
        }
        
        return false // Don't consume events that don't trigger actions
    }
    
    private func notifyRust(_ event: String, data: [String: Any]) {
        // Call Rust callback function directly
        print("[KeyboardMonitor] Calling Rust callback with event: \(event)")
        
        // Ensure we're calling from a safe thread context
        DispatchQueue.global(qos: .userInteractive).async {
            let cString = event.cString(using: .utf8)
            cString?.withUnsafeBufferPointer { buffer in
                if let baseAddress = buffer.baseAddress {
                    // Use a barrier to ensure thread safety
                    keyboard_event_callback(baseAddress)
                    print("[KeyboardMonitor] Successfully called Rust callback for: \(event)")
                } else {
                    print("[KeyboardMonitor] ERROR: Failed to get buffer base address for event: \(event)")
                }
            }
        }
    }
    
    @objc func requestAccessibilityPermissions() -> Bool {
        let options: NSDictionary = [kAXTrustedCheckOptionPrompt.takeRetainedValue() as String: true]
        let accessEnabled = AXIsProcessTrustedWithOptions(options)
        
        print("[KeyboardMonitor] Accessibility permissions: %@", accessEnabled ? "granted" : "not granted")
        return accessEnabled
    }
    
    @objc func hasAccessibilityPermissions() -> Bool {
        let accessEnabled = AXIsProcessTrusted()
        print("[KeyboardMonitor] Accessibility permissions check: %@", accessEnabled ? "granted" : "not granted")
        return accessEnabled
    }
}

// Thread-safe global instance management
private let globalMonitorLock = NSLock()
private var globalKeyboardMonitor: KeyboardMonitor?

@_cdecl("keyboard_monitor_create")
func keyboard_monitor_create() -> UnsafeRawPointer? {
    globalMonitorLock.lock()
    defer { globalMonitorLock.unlock() }
    
    print("[KeyboardMonitor] Creating shared instance")
    
    // Clean up any existing instance
    if globalKeyboardMonitor != nil {
        print("[KeyboardMonitor] Warning: Replacing existing instance")
        globalKeyboardMonitor = nil
    }
    
    let monitor = KeyboardMonitor()
    globalKeyboardMonitor = monitor
    
    // Use passUnretained since we're keeping a reference in globalKeyboardMonitor
    return UnsafeRawPointer(Unmanaged.passUnretained(monitor).toOpaque())
}

@_cdecl("keyboard_monitor_set_shortcut")
func keyboard_monitor_set_shortcut(shortcut: UnsafePointer<CChar>?) {
    guard let shortcut = shortcut else {
        print("[KeyboardMonitor] Error: Null shortcut pointer")
        return
    }
    
    globalMonitorLock.lock()
    defer { globalMonitorLock.unlock() }
    
    guard let monitor = globalKeyboardMonitor else {
        print("[KeyboardMonitor] Error: No monitor instance")
        return
    }
    
    let shortcutString = String(cString: shortcut)
    print("[KeyboardMonitor] Setting shortcut from Rust: \(shortcutString)")
    monitor.setPushToTalkShortcut(shortcutString)
}

@_cdecl("keyboard_monitor_request_permissions")
func keyboard_monitor_request_permissions() -> Bool {
    globalMonitorLock.lock()
    defer { globalMonitorLock.unlock() }
    
    guard let monitor = globalKeyboardMonitor else {
        print("[KeyboardMonitor] Error: No monitor instance for permissions")
        return false
    }
    
    return monitor.requestAccessibilityPermissions()
}

@_cdecl("keyboard_monitor_has_permissions")
func keyboard_monitor_has_permissions() -> Bool {
    globalMonitorLock.lock()
    defer { globalMonitorLock.unlock() }
    
    guard let monitor = globalKeyboardMonitor else {
        print("[KeyboardMonitor] Error: No monitor instance for permissions check")
        return false
    }
    
    return monitor.hasAccessibilityPermissions()
}

@_cdecl("keyboard_monitor_destroy")
func keyboard_monitor_destroy() {
    globalMonitorLock.lock()
    defer { globalMonitorLock.unlock() }
    
    print("[KeyboardMonitor] Destroying shared instance")
    
    // Explicitly stop monitoring before deallocating
    if let monitor = globalKeyboardMonitor {
        monitor.stopMonitoring()
        print("[KeyboardMonitor] Explicitly stopped monitoring")
    }
    
    globalKeyboardMonitor = nil
}