import Cocoa

// MARK: - Animation Timing Constants

private struct AnimationTiming {
    static let panelExpandDuration: TimeInterval = 0.15
    static let hoverExpandDelay: TimeInterval = 0.1
    static let hoverMinimizeDelay: TimeInterval = 0.3
}

// MARK: - Overlay View Controller

class OverlayViewController: NSViewController {
    private var overlayView: OverlayContentView!
    private var panel: NativeOverlayPanel? {
        return view.window as? NativeOverlayPanel
    }
    
    // State
    private var isExpanded = false
    private var currentState: OverlayContentView.State = .idle
    
    // Hover debouncing
    private var hoverTimer: Timer?
    private var isHovering = false
    
    // Callbacks to Rust
    var onStartRecording: (() -> Void)?
    var onStopRecording: (() -> Void)?
    var onCancelRecording: (() -> Void)?
    
    override func loadView() {
        overlayView = OverlayContentView(frame: NSRect(x: 0, y: 0, width: 48, height: 16))
        self.view = overlayView
        
        // Set up callbacks
        overlayView.onStartRecording = { [weak self] in
            self?.handleStartRecording()
        }
        
        overlayView.onStopRecording = { [weak self] in
            self?.handleStopRecording()
        }
        
        overlayView.onCancelRecording = { [weak self] in
            self?.handleCancelRecording()
        }
        
        overlayView.onHoverChanged = { [weak self] hovered in
            self?.handleHoverChanged(hovered)
        }
    }
    
    override func viewDidLoad() {
        super.viewDidLoad()
        updateState()
    }
    
    // MARK: - Hover Handling
    
    private func handleHoverChanged(_ hovered: Bool) {
        guard currentState == .idle else { return }
        
        // Cancel any existing timer
        hoverTimer?.invalidate()
        hoverTimer = nil
        
        if hovered {
            // Delay expansion to avoid twitchiness
            if !isExpanded && !isHovering {
                isHovering = true
                hoverTimer = Timer.scheduledTimer(withTimeInterval: AnimationTiming.hoverExpandDelay, repeats: false) { [weak self] _ in
                    guard let self = self else { return }
                    if self.isHovering && self.currentState == .idle {
                        self.expand()
                    }
                }
            }
        } else {
            isHovering = false
            // Delay minimize to avoid twitchiness
            if isExpanded && currentState == .idle {
                hoverTimer = Timer.scheduledTimer(withTimeInterval: AnimationTiming.hoverMinimizeDelay, repeats: false) { [weak self] _ in
                    guard let self = self else { return }
                    if !self.isHovering && self.currentState == .idle && self.isExpanded {
                        self.minimize()
                    }
                }
            }
        }
    }
    
    private func expand() {
        isExpanded = true
        panel?.expand()
        updateState()
    }
    
    private func minimize() {
        isExpanded = false
        panel?.minimize()
        updateState()
    }
    
    // MARK: - Recording Control
    
    private func handleStartRecording() {
        currentState = .recording
        updateState()
        onStartRecording?()
        
        // Make the overlay take keyboard focus for shortcuts
        if let panel = panel {
            panel.makeKeyAndOrderFront(nil)
            view.window?.makeFirstResponder(view)
        }
    }
    
    private func handleStopRecording() {
        currentState = .processing
        updateState()
        onStopRecording?()
    }
    
    private func handleCancelRecording() {
        // Cancel goes straight to idle without processing
        setIdleState()
        onCancelRecording?()
    }
    
    // MARK: - Public API
    
    func setRecordingState(_ recording: Bool) {
        if recording {
            currentState = .recording
            isExpanded = true
            panel?.expand()
            
            // Make the overlay take keyboard focus for shortcuts
            if let panel = panel {
                panel.makeKeyAndOrderFront(nil)
                view.window?.makeFirstResponder(view)
            }
        } else {
            // When recording stops, transition to processing with smaller size
            currentState = .processing
            isExpanded = false
            panel?.showProcessing()
        }
        updateState()
    }
    
    func setProcessingState(_ processing: Bool) {
        if processing {
            currentState = .processing
            // Use processing size
            isExpanded = false  // Not expanded, but showing processing animation
            panel?.showProcessing()
            updateState()
        } else {
            // Processing complete - go straight to idle
            setIdleState()
        }
    }
    
    func setIdleState() {
        print("Setting idle state - resetting all hover tracking")
        currentState = .idle
        isExpanded = false
        isHovering = false
        // Cancel any pending hover timer
        hoverTimer?.invalidate()
        hoverTimer = nil
        updateState()
        minimize()
        
        // Force update tracking areas and ensure panel accepts mouse events
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            
            // Ensure panel is configured correctly for hover
            if let panel = self.panel {
                panel.acceptsMouseMovedEvents = true
                panel.ignoresMouseEvents = false
                print("Panel mouse event settings restored - accepts: \(panel.acceptsMouseMovedEvents), ignores: \(panel.ignoresMouseEvents)")
            }
            
            // Force tracking area update
            self.view.updateTrackingAreas()
            print("Tracking areas updated for idle state")
        }
    }
    
    func setVolumeLevel(_ level: CGFloat) {
        overlayView.setVolumeLevel(level)
    }
    
    private func updateState() {
        overlayView.setState(currentState, expanded: isExpanded)
    }
}

// MARK: - Overlay Manager (Singleton)

@objc class NativeOverlayManager: NSObject {
    static let shared = NativeOverlayManager()
    
    private var panel: NativeOverlayPanel?
    private var controller: OverlayViewController?
    
    // Callbacks to Rust
    private var startRecordingCallback: (() -> Void)?
    private var stopRecordingCallback: (() -> Void)?
    private var cancelRecordingCallback: (() -> Void)?
    
    private override init() {
        super.init()
    }
    
    @objc func showOverlay() {
        guard panel == nil else {
            // If panel exists, just ensure it's visible and in idle state
            panel?.orderFront(nil)
            controller?.setIdleState()
            return
        }
        
        // Create panel
        let newPanel = NativeOverlayPanel()
        
        // Create controller
        let newController = OverlayViewController()
        newPanel.contentViewController = newController
        
        // Set up callbacks
        newController.onStartRecording = { [weak self] in
            self?.startRecordingCallback?()
        }
        
        newController.onStopRecording = { [weak self] in
            self?.stopRecordingCallback?()
        }
        
        newController.onCancelRecording = { [weak self] in
            self?.cancelRecordingCallback?()
        }
        
        // Position at top center
        if let screen = NSScreen.main {
            let screenFrame = screen.visibleFrame
            let x = screenFrame.midX - newPanel.frame.width / 2
            let y = screenFrame.maxY - newPanel.frame.height - 10
            newPanel.setFrameOrigin(NSPoint(x: x, y: y))
        }
        
        // Show panel
        newPanel.orderFrontRegardless()
        
        self.panel = newPanel
        self.controller = newController
        
        // Ensure it starts in idle/minimized state
        newController.setIdleState()
    }
    
    @objc func hideOverlay() {
        panel?.close()
        panel = nil
        controller = nil
    }
    
    @objc func setRecordingState(_ recording: Bool) {
        controller?.setRecordingState(recording)
    }
    
    @objc func setProcessingState(_ processing: Bool) {
        controller?.setProcessingState(processing)
    }
    
    @objc func setIdleState() {
        controller?.setIdleState()
    }
    
    @objc func setStartRecordingCallback(_ callback: @escaping () -> Void) {
        startRecordingCallback = callback
    }
    
    @objc func setStopRecordingCallback(_ callback: @escaping () -> Void) {
        stopRecordingCallback = callback
    }
    
    @objc func setCancelRecordingCallback(_ callback: @escaping () -> Void) {
        cancelRecordingCallback = callback
    }
    
    @objc func setVolumeLevel(_ level: CGFloat) {
        controller?.setVolumeLevel(level)
    }
}