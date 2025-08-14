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
        
        // Don't steal focus - the main window should remain active
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
            
            // Don't steal focus - the main window should remain active
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
        Logger.debug(.overlay, "setIdleState() called")
        Logger.info(.overlay, "Current state: \(currentState), isExpanded: \(isExpanded)")
        
        currentState = .idle
        isExpanded = false
        isHovering = false
        // Cancel any pending hover timer
        hoverTimer?.invalidate()
        hoverTimer = nil
        
        Logger.debug(.overlay, "State changed to: \(currentState)")
        updateState()
        minimize()
        
        Logger.info(.overlay, "setIdleState() completed")
        
        // Force update tracking areas and ensure panel accepts mouse events
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            
            // Ensure panel is configured correctly for hover
            if let panel = self.panel {
                panel.acceptsMouseMovedEvents = true
                panel.ignoresMouseEvents = false
            }
            
            // Force tracking area update
            self.view.updateTrackingAreas()
        }
    }
    
    func setVolumeLevel(_ level: CGFloat) {
        overlayView.setVolumeLevel(level)
    }
    
    func setWaveformStyle(_ style: WaveformStyle) {
        overlayView.setWaveformStyle(style)
    }
    
    func getCurrentState() -> String {
        switch currentState {
        case .idle:
            return "idle"
        case .recording:
            return "recording"
        case .processing:
            return "processing"
        case .hovered:
            return "hovered"
        case .complete:
            return "complete"
        }
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
            // If panel exists, just ensure it's in idle state
            // Don't orderFront to avoid stealing focus
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
    
    @objc func getCurrentState() -> String {
        return controller?.getCurrentState() ?? "unknown"
    }
    
    @objc func setPosition(_ position: String) {
        guard let panel = self.panel, let screen = NSScreen.main else { return }
        
        let screenFrame = screen.visibleFrame
        let panelWidth = panel.frame.width
        let panelHeight = panel.frame.height
        
        var x: CGFloat = 0
        var y: CGFloat = 0
        
        switch position {
        case "top-left":
            x = 5
            y = screenFrame.maxY - panelHeight - 5
        case "top-center":
            x = screenFrame.midX - panelWidth / 2
            y = screenFrame.maxY - panelHeight - 5
        case "top-right":
            x = screenFrame.maxX - panelWidth - 5
            y = screenFrame.maxY - panelHeight - 5
        case "bottom-left":
            x = 5
            y = screenFrame.minY + 5
        case "bottom-center":
            x = screenFrame.midX - panelWidth / 2
            y = screenFrame.minY + 5
        case "bottom-right":
            x = screenFrame.maxX - panelWidth - 5
            y = screenFrame.minY + 5
        case "left-center":
            x = 5
            y = screenFrame.midY - panelHeight / 2
        case "right-center":
            x = screenFrame.maxX - panelWidth - 5
            y = screenFrame.midY - panelHeight / 2
        default:
            // Default to top-center
            x = screenFrame.midX - panelWidth / 2
            y = screenFrame.maxY - panelHeight - 5
        }
        
        panel.setFrameOrigin(NSPoint(x: x, y: y))
        
        // Update the panel's position for proper anchor-based expansion
        panel.setPosition(position)
    }
    
    @objc func setWaveformStyle(_ style: String) {
        guard let contentView = panel?.contentView as? OverlayContentView else { return }
        
        switch style.lowercased() {
        case "classic":
            panel?.isWideParticlesMode = false
            contentView.setWaveformStyle(.classic)
        case "enhanced":
            panel?.isWideParticlesMode = false
            contentView.setWaveformStyle(.enhanced)
        case "particles":
            panel?.isWideParticlesMode = false
            contentView.setWaveformStyle(.particles)
        case "wide-particles":
            // Just set the flag and use particles style
            panel?.isWideParticlesMode = true
            contentView.setWaveformStyle(.particles)
        default:
            // Default to enhanced
            panel?.isWideParticlesMode = false
            contentView.setWaveformStyle(.enhanced)
        }
    }
}