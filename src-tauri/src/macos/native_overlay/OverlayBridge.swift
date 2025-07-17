import Foundation

// MARK: - C Bridge Functions

// Global callbacks from Rust
private var globalStartRecordingCallback: (@convention(c) () -> Void)?
private var globalStopRecordingCallback: (@convention(c) () -> Void)?
private var globalCancelRecordingCallback: (@convention(c) () -> Void)?

@_cdecl("native_overlay_show")
public func nativeOverlayShow() {
    DispatchQueue.main.async {
        NativeOverlayManager.shared.showOverlay()
    }
}

@_cdecl("native_overlay_hide")
public func nativeOverlayHide() {
    DispatchQueue.main.async {
        NativeOverlayManager.shared.hideOverlay()
    }
}

@_cdecl("native_overlay_set_recording_state")
public func nativeOverlaySetRecordingState(_ recording: Bool) {
    DispatchQueue.main.async {
        NativeOverlayManager.shared.setRecordingState(recording)
    }
}

@_cdecl("native_overlay_set_processing_state")
public func nativeOverlaySetProcessingState(_ processing: Bool) {
    DispatchQueue.main.async {
        NativeOverlayManager.shared.setProcessingState(processing)
    }
}

@_cdecl("native_overlay_set_idle_state")
public func nativeOverlaySetIdleState() {
    Logger.debug(.ffi, "native_overlay_set_idle_state called from Rust")
    Logger.debug(.ffi, "Current thread: \(Thread.current)")
    
    DispatchQueue.main.async {
        Logger.debug(.ffi, "Now on main queue, calling setIdleState()")
        NativeOverlayManager.shared.setIdleState()
        Logger.debug(.ffi, "setIdleState() completed")
    }
    
    Logger.debug(.ffi, "native_overlay_set_idle_state function returning")
}

@_cdecl("native_overlay_set_start_recording_callback")
public func nativeOverlaySetStartRecordingCallback(_ callback: @escaping @convention(c) () -> Void) {
    globalStartRecordingCallback = callback
    
    DispatchQueue.main.async {
        NativeOverlayManager.shared.setStartRecordingCallback {
            // Call back to Rust
            globalStartRecordingCallback?()
        }
    }
}

@_cdecl("native_overlay_set_stop_recording_callback")
public func nativeOverlaySetStopRecordingCallback(_ callback: @escaping @convention(c) () -> Void) {
    globalStopRecordingCallback = callback
    
    DispatchQueue.main.async {
        NativeOverlayManager.shared.setStopRecordingCallback {
            // Call back to Rust
            globalStopRecordingCallback?()
        }
    }
}

@_cdecl("native_overlay_set_cancel_recording_callback")
public func nativeOverlaySetCancelRecordingCallback(_ callback: @escaping @convention(c) () -> Void) {
    globalCancelRecordingCallback = callback
    
    DispatchQueue.main.async {
        NativeOverlayManager.shared.setCancelRecordingCallback {
            // Call back to Rust
            globalCancelRecordingCallback?()
        }
    }
}

@_cdecl("native_overlay_set_volume_level")
public func nativeOverlaySetVolumeLevel(_ level: Float) {
    DispatchQueue.main.async {
        NativeOverlayManager.shared.setVolumeLevel(CGFloat(level))
    }
}

@_cdecl("native_overlay_set_position")
public func nativeOverlaySetPosition(_ position: UnsafePointer<CChar>) {
    let positionString = String(cString: position)
    DispatchQueue.main.async {
        NativeOverlayManager.shared.setPosition(positionString)
    }
}

@_cdecl("native_overlay_get_current_state")
public func nativeOverlayGetCurrentState() -> UnsafePointer<CChar>? {
    let state = NativeOverlayManager.shared.getCurrentState()
    return UnsafePointer(strdup(state))
}

@_cdecl("native_overlay_set_waveform_style")
public func nativeOverlaySetWaveformStyle(_ stylePtr: UnsafePointer<CChar>) {
    let style = String(cString: stylePtr)
    DispatchQueue.main.async {
        NativeOverlayManager.shared.setWaveformStyle(style)
    }
}