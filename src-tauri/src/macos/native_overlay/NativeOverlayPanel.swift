import Cocoa
import WebKit

// MARK: - UI Configuration Constants

private struct UIConfig {
    // Panel sizes
    static let expandedSize = CGSize(width: 100, height: 24)  // Slightly wider for cancel + stop buttons
    static let minimizedSize = CGSize(width: 40, height: 10)  // Even smaller
    static let processingSize = CGSize(width: 60, height: 12)
    
    // Animation timings
    static let panelAnimationDuration: TimeInterval = 0.2  // Slightly smoother
    static let processingDotInterval: TimeInterval = 0.5  // More elegant pace
    static let waveformUpdateInterval: TimeInterval = 0.05
    static let recordingPulseDuration: TimeInterval = 0.8
    
    // UI element sizes
    static let dotSize: CGFloat = 3  // Smaller, more refined
    static let dotSpacing: CGFloat = 5  // Better spacing
    static let buttonSize: CGFloat = 20  // Smaller button for compact view
    static let cornerRadius: CGFloat = 12  // More rounded for modern look
    static let minimizedCornerRadius: CGFloat = 5
    static let borderWidth: CGFloat = 0.5  // Thinner, more elegant
    static let contentPadding: CGFloat = 4  // Smaller padding for compact view
    
    // Modern color palette
    static let backgroundColor = NSColor(white: 0.08, alpha: 0.92)  // Darker, more transparent
    static let borderColor = NSColor(white: 1.0, alpha: 0.12)  // Very subtle border
    static let dotActiveColor = NSColor(white: 1.0, alpha: 0.8)  // Brighter dots
    static let dotInactiveColor = NSColor(white: 1.0, alpha: 0.2)  // More contrast
    static let recordButtonColor = NSColor(calibratedRed: 1.0, green: 0.231, blue: 0.188, alpha: 1.0)  // iOS red
    static let recordButtonHoverColor = NSColor(calibratedRed: 1.0, green: 0.3, blue: 0.25, alpha: 1.0)
}

// MARK: - Processing Dots View

class ProcessingDotsView: NSView {
    private var animationTimer: Timer?
    private var currentDot = 0
    private let dotCount = 3
    
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
    }
    
    required init?(coder: NSCoder) {
        super.init(coder: coder)
    }
    
    func startAnimating() {
        stopAnimating()
        currentDot = 0
        animationTimer = Timer.scheduledTimer(withTimeInterval: UIConfig.processingDotInterval, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            self.currentDot = (self.currentDot + 1) % self.dotCount
            self.needsDisplay = true
        }
    }
    
    func stopAnimating() {
        animationTimer?.invalidate()
        animationTimer = nil
        currentDot = 0
        needsDisplay = true
    }
    
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        
        let dotSize = UIConfig.dotSize
        let spacing = UIConfig.dotSpacing  // Still using the tighter spacing
        let totalWidth = CGFloat(dotCount) * dotSize + CGFloat(dotCount - 1) * spacing
        let startX = (bounds.width - totalWidth) / 2
        let y = bounds.midY - dotSize / 2
        
        for i in 0..<dotCount {
            let x = startX + CGFloat(i) * (dotSize + spacing)
            let dotRect = NSRect(x: x, y: y, width: dotSize, height: dotSize)
            let dotPath = NSBezierPath(ovalIn: dotRect)
            
            // Simple approach: one bright dot at a time
            if i == currentDot && animationTimer != nil {
                UIConfig.dotActiveColor.setFill()
            } else {
                UIConfig.dotInactiveColor.setFill()
            }
            
            dotPath.fill()
        }
    }
}

// MARK: - Waveform View

class WaveformView: NSView {
    private var bars: [CGFloat] = []
    private let barCount = 12  // Further reduced for compact view
    private var animationTimer: Timer?
    private var volumeLevel: CGFloat = 0.0
    private var targetBars: [CGFloat] = []
    
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setupBars()
    }
    
    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupBars()
    }
    
    private func setupBars() {
        // Initialize with minimal height
        bars = Array(repeating: 0.1, count: barCount)
        targetBars = bars
    }
    
    func startAnimating() {
        stopAnimating()
        print("WaveformView: Starting animation")
        // Set initial volume to show some movement
        if volumeLevel == 0 {
            volumeLevel = 0.1
        }
        animationTimer = Timer.scheduledTimer(withTimeInterval: UIConfig.waveformUpdateInterval, repeats: true) { [weak self] _ in
            self?.updateBars()
            self?.needsDisplay = true
        }
    }
    
    func stopAnimating() {
        animationTimer?.invalidate()
        animationTimer = nil
        // Reset to minimal movement
        volumeLevel = 0.0
        setupBars()
        needsDisplay = true
    }
    
    func setVolumeLevel(_ level: CGFloat) {
        volumeLevel = max(0, min(1, level))
        // Debug: log every 10th update to reduce noise
        if Int.random(in: 0..<10) == 0 && level > 0.01 {
            print("WaveformView volume level: \(level)")
        }
        
        // Force redraw
        needsDisplay = true
    }
    
    private func updateBars() {
        // Generate target heights based on volume
        for i in 0..<barCount {
            let centerDistance = abs(CGFloat(i) - CGFloat(barCount) / 2.0) / (CGFloat(barCount) / 2.0)
            let baseHeight = 1.0 - centerDistance * 0.5
            
            // Volume-based variation with better thresholds
            let variation: CGFloat
            if volumeLevel < 0.02 {
                // Silence - minimal movement
                variation = CGFloat.random(in: -0.05...0.05)
            } else if volumeLevel < 0.15 {
                // Quiet to normal volume
                variation = CGFloat.random(in: -0.4...0.4) * (volumeLevel * 3)
            } else {
                // Loud - expansive movement
                variation = CGFloat.random(in: -0.6...0.6) * volumeLevel
            }
            
            // Make sure we have a minimum height and scale with volume
            // Amplify the visual effect of the volume
            let amplifiedVolume = min(1.0, volumeLevel * 3.5)  // Increased from 3.0 to 3.5 for more responsiveness
            let height = (baseHeight + variation) * max(0.35, amplifiedVolume) + 0.1
            targetBars[i] = min(1.0, height)
        }
        
        // Faster response for better visual feedback
        for i in 0..<barCount {
            bars[i] = bars[i] * 0.6 + targetBars[i] * 0.4
        }
    }
    
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        
        let barWidth: CGFloat = 2.0  // Adjusted for compact view
        let spacing: CGFloat = 1.0   // Tighter for compact view
        let totalWidth = CGFloat(barCount) * (barWidth + spacing) - spacing
        let startX = (bounds.width - totalWidth) / 2
        
        for (index, height) in bars.enumerated() {
            let x = startX + CGFloat(index) * (barWidth + spacing)
            let barHeight = max(3, bounds.height * height * 0.8)  // Increased min height and scale
            let y = (bounds.height - barHeight) / 2
            
            let barRect = NSRect(x: x, y: y, width: barWidth, height: barHeight)
            let barPath = NSBezierPath(roundedRect: barRect, xRadius: barWidth / 2, yRadius: barWidth / 2)
            
            // Use gradient for bars
            let centerBar = barCount / 2
            let distance = abs(index - centerBar)
            let alpha = 0.4 + (1.0 - (CGFloat(distance) / CGFloat(centerBar))) * 0.6
            
            if animationTimer != nil {
                NSColor(white: 0.95, alpha: alpha).setFill()
            } else {
                NSColor(white: 0.7, alpha: alpha * 0.5).setFill()
            }
            
            barPath.fill()
        }
    }
}

// MARK: - Cancel Button

class CancelButton: NSButton {
    private var isHovering = false
    private var trackingArea: NSTrackingArea?
    
    override func draw(_ dirtyRect: NSRect) {
        // Draw X symbol - smaller and more refined
        let inset: CGFloat = 6
        let lineWidth: CGFloat = 1.5
        
        let path = NSBezierPath()
        path.lineWidth = lineWidth
        path.lineCapStyle = .round
        
        // Draw X
        path.move(to: NSPoint(x: inset, y: inset))
        path.line(to: NSPoint(x: bounds.width - inset, y: bounds.height - inset))
        path.move(to: NSPoint(x: bounds.width - inset, y: inset))
        path.line(to: NSPoint(x: inset, y: bounds.height - inset))
        
        if isHovering {
            NSColor(white: 1.0, alpha: 0.8).setStroke()
        } else {
            NSColor(white: 1.0, alpha: 0.4).setStroke()
        }
        
        path.stroke()
    }
    
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        
        if let area = trackingArea {
            removeTrackingArea(area)
        }
        
        trackingArea = NSTrackingArea(
            rect: bounds,
            options: [.mouseEnteredAndExited, .activeAlways],
            owner: self,
            userInfo: nil
        )
        
        if let area = trackingArea {
            addTrackingArea(area)
        }
    }
    
    override func mouseEntered(with event: NSEvent) {
        isHovering = true
        needsDisplay = true
    }
    
    override func mouseExited(with event: NSEvent) {
        isHovering = false
        needsDisplay = true
    }
}

// MARK: - Custom Button Classes

class CircleButton: NSButton {
    var fillColor: NSColor = NSColor(calibratedRed: 0.93, green: 0.27, blue: 0.18, alpha: 1.0) // #EE4539
    var hoverColor: NSColor = NSColor(calibratedRed: 0.95, green: 0.35, blue: 0.28, alpha: 1.0)
    private var isHovering = false
    private var trackingArea: NSTrackingArea?
    
    override func draw(_ dirtyRect: NSRect) {
        // Modern design - no border, just the filled circle
        let circleSize: CGFloat = 10  // Slightly larger
        let circleRect = NSRect(
            x: bounds.midX - circleSize / 2,
            y: bounds.midY - circleSize / 2,
            width: circleSize,
            height: circleSize
        )
        let circlePath = NSBezierPath(ovalIn: circleRect)
        
        if isHovering {
            hoverColor.setFill()
            // Add subtle glow on hover
            circlePath.lineWidth = 0
            let glowColor = hoverColor.withAlphaComponent(0.3)
            glowColor.setStroke()
            let glowPath = NSBezierPath(ovalIn: circleRect.insetBy(dx: -2, dy: -2))
            glowPath.lineWidth = 4
            glowPath.stroke()
        } else {
            fillColor.setFill()
        }
        
        circlePath.fill()
    }
    
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        
        if let area = trackingArea {
            removeTrackingArea(area)
        }
        
        trackingArea = NSTrackingArea(
            rect: bounds,
            options: [.mouseEnteredAndExited, .activeAlways],
            owner: self,
            userInfo: nil
        )
        
        if let area = trackingArea {
            addTrackingArea(area)
        }
    }
    
    override func mouseEntered(with event: NSEvent) {
        isHovering = true
        needsDisplay = true
    }
    
    override func mouseExited(with event: NSEvent) {
        isHovering = false
        needsDisplay = true
    }
}

class SquareButton: NSButton {
    private var isHovering = false
    private var trackingArea: NSTrackingArea?
    
    override func draw(_ dirtyRect: NSRect) {
        // Modern stop button - filled square, no border
        let squareSize: CGFloat = 8
        let squareRect = NSRect(
            x: bounds.midX - squareSize / 2,
            y: bounds.midY - squareSize / 2,
            width: squareSize,
            height: squareSize
        )
        let squarePath = NSBezierPath(roundedRect: squareRect, xRadius: 2, yRadius: 2)
        
        if isHovering {
            NSColor(white: 1.0, alpha: 0.9).setFill()
            // Add subtle glow
            let glowColor = NSColor(white: 1.0, alpha: 0.2)
            glowColor.setStroke()
            let glowPath = NSBezierPath(roundedRect: squareRect.insetBy(dx: -2, dy: -2), xRadius: 3, yRadius: 3)
            glowPath.lineWidth = 3
            glowPath.stroke()
        } else {
            NSColor(white: 1.0, alpha: 0.7).setFill()
        }
        
        squarePath.fill()
    }
    
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        
        if let area = trackingArea {
            removeTrackingArea(area)
        }
        
        trackingArea = NSTrackingArea(
            rect: bounds,
            options: [.mouseEnteredAndExited, .activeAlways],
            owner: self,
            userInfo: nil
        )
        
        if let area = trackingArea {
            addTrackingArea(area)
        }
    }
    
    override func mouseEntered(with event: NSEvent) {
        isHovering = true
        needsDisplay = true
    }
    
    override func mouseExited(with event: NSEvent) {
        isHovering = false
        needsDisplay = true
    }
}

// MARK: - Native Overlay Panel

final class NativeOverlayPanel: NSPanel {
    private let expandedSize = UIConfig.expandedSize
    private let minimizedSize = UIConfig.minimizedSize
    private let processingSize = UIConfig.processingSize
    
    init() {
        // Start with minimized size
        let frame = NSRect(origin: .zero, size: minimizedSize)
        
        super.init(
            contentRect: frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        
        // Configure panel for hover without focus
        self.level = .floating
        self.collectionBehavior = [
            .canJoinAllSpaces,
            .stationary,
            .ignoresCycle,
            .fullScreenAuxiliary
        ]
        
        // Visual properties
        self.isOpaque = false
        self.backgroundColor = .clear
        self.hasShadow = false
        
        // Critical for hover without focus
        self.isFloatingPanel = true
        self.becomesKeyOnlyIfNeeded = true
        self.hidesOnDeactivate = false
        self.acceptsMouseMovedEvents = true
        
        // Allow mouse events without activating
        self.ignoresMouseEvents = false
        self.isMovableByWindowBackground = false
    }
    
    // Override to prevent stealing focus
    override var canBecomeKey: Bool {
        return false  // Never become key to prevent focus stealing
    }
    
    override var canBecomeMain: Bool {
        return false  // Never become the main window
    }
    
    // Handle keyboard events
    override func keyDown(with event: NSEvent) {
        if let contentView = self.contentView as? OverlayContentView {
            contentView.handleKeyDown(event)
        } else {
            super.keyDown(with: event)
        }
    }
    
    // Animate size changes
    func animateToSize(_ newSize: CGSize, centered: Bool = false) {
        NSAnimationContext.runAnimationGroup { context in
            context.duration = UIConfig.panelAnimationDuration
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            
            // Keep the panel at its current position, just change size
            var frame = self.frame
            
            // Adjust position to keep it centered at the same point
            let widthDiff = newSize.width - frame.width
            let heightDiff = newSize.height - frame.height
            
            frame.origin.x -= widthDiff / 2
            frame.origin.y -= heightDiff / 2
            frame.size = newSize
            
            self.animator().setFrame(frame, display: true)
            
            // Animate corner radius change
            if let contentView = self.contentView as? OverlayContentView {
                contentView.updateCornerRadius(isExpanded: newSize.width > minimizedSize.width * 1.5)
            }
        }
    }
    
    func expand() {
        animateToSize(expandedSize)
    }
    
    func minimize() {
        animateToSize(minimizedSize)
    }
    
    func showProcessing() {
        animateToSize(processingSize)
    }
}

// MARK: - Overlay Content View

class OverlayContentView: NSView {
    enum State {
        case idle
        case hovered
        case recording
        case processing
        case complete
    }
    
    private var state: State = .idle
    private var isExpanded = false
    private var trackingArea: NSTrackingArea?
    
    // UI Elements
    private let backgroundView = NSView()
    private let recordButton = CircleButton()
    private let cancelButton = CancelButton()
    private let stopButton = SquareButton()
    private let statusLabel = NSTextField()
    private let activityIndicator = NSProgressIndicator()
    private let waveformView = WaveformView()
    private let processingDotsView = ProcessingDotsView()
    
    // Callbacks
    var onStartRecording: (() -> Void)?
    var onStopRecording: (() -> Void)?
    var onCancelRecording: (() -> Void)?
    var onHoverChanged: ((Bool) -> Void)?
    
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setupView()
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    private func setupView() {
        // Dark background with border
        backgroundView.wantsLayer = true
        backgroundView.layer?.backgroundColor = UIConfig.backgroundColor.cgColor
        backgroundView.layer?.cornerRadius = UIConfig.minimizedCornerRadius
        backgroundView.layer?.borderWidth = UIConfig.borderWidth
        backgroundView.layer?.borderColor = UIConfig.borderColor.cgColor
        backgroundView.layer?.masksToBounds = true
        addSubview(backgroundView)
        
        // Record button - simple circle
        recordButton.bezelStyle = .smallSquare
        recordButton.title = ""
        recordButton.image = nil
        recordButton.target = self
        recordButton.action = #selector(startRecording)
        recordButton.isHidden = true
        recordButton.wantsLayer = true
        recordButton.isBordered = false
        addSubview(recordButton)
        
        // Cancel button - X symbol
        cancelButton.bezelStyle = .smallSquare
        cancelButton.title = ""
        cancelButton.image = nil
        cancelButton.target = self
        cancelButton.action = #selector(cancelRecording)
        cancelButton.isHidden = true
        cancelButton.wantsLayer = true
        cancelButton.isBordered = false
        addSubview(cancelButton)
        
        // Stop button - simple square
        stopButton.bezelStyle = .smallSquare
        stopButton.title = ""
        stopButton.image = nil
        stopButton.target = self
        stopButton.action = #selector(stopRecording)
        stopButton.isHidden = true
        stopButton.wantsLayer = true
        stopButton.isBordered = false
        addSubview(stopButton)
        
        // Status label
        statusLabel.isEditable = false
        statusLabel.isBordered = false
        statusLabel.backgroundColor = .clear
        statusLabel.alignment = .center
        statusLabel.font = .systemFont(ofSize: 11, weight: .medium)
        statusLabel.textColor = NSColor(white: 0.9, alpha: 1.0)
        statusLabel.isHidden = true
        addSubview(statusLabel)
        
        // Activity indicator
        activityIndicator.style = .spinning
        activityIndicator.controlSize = .small
        activityIndicator.isHidden = true
        activityIndicator.appearance = NSAppearance(named: .darkAqua)
        addSubview(activityIndicator)
        
        // Waveform view
        waveformView.isHidden = true
        waveformView.wantsLayer = true
        addSubview(waveformView)
        
        // Processing dots view
        processingDotsView.isHidden = true
        processingDotsView.wantsLayer = true
        addSubview(processingDotsView)
        
        // Setup tracking area for hover
        updateTrackingArea()
    }
    
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        updateTrackingArea()
    }
    
    private func updateTrackingArea() {
        if let existingArea = trackingArea {
            removeTrackingArea(existingArea)
        }
        
        trackingArea = NSTrackingArea(
            rect: bounds,
            options: [.mouseEnteredAndExited, .activeAlways],
            owner: self,
            userInfo: nil
        )
        
        if let area = trackingArea {
            addTrackingArea(area)
        }
    }
    
    override func layout() {
        super.layout()
        
        backgroundView.frame = bounds
        
        let padding = UIConfig.contentPadding
        let contentRect = bounds.insetBy(dx: padding, dy: padding)
        
        if !isExpanded {
            // Remove any existing dot indicator layer
            if let dotLayer = backgroundView.layer?.sublayers?.first(where: { $0.name == "dotIndicator" }) {
                dotLayer.removeFromSuperlayer()
            }
            
            statusLabel.isHidden = true
            recordButton.isHidden = true
            stopButton.isHidden = true
            activityIndicator.isHidden = true
            waveformView.isHidden = true
            
            // Special handling for processing state
            if state == .processing {
                // Show processing dots in minimized view
                processingDotsView.frame = bounds
                processingDotsView.isHidden = false
                processingDotsView.startAnimating()
            } else {
                processingDotsView.isHidden = true
                processingDotsView.stopAnimating()
            }
        } else if isExpanded {
            switch state {
            case .idle, .hovered:
                // Hide dot indicator when expanded
                if let dotLayer = backgroundView.layer?.sublayers?.first(where: { $0.name == "dotIndicator" }) {
                    dotLayer.isHidden = true
                }
                
                let buttonSize = UIConfig.buttonSize
                // Center the record button for idle/hovered state
                recordButton.frame = NSRect(
                    x: contentRect.midX - buttonSize / 2,
                    y: contentRect.midY - buttonSize / 2,
                    width: buttonSize,
                    height: buttonSize
                )
                
                // Hide waveform when just hovering
                waveformView.isHidden = true
                
            case .recording:
                // Hide dot indicator when expanded
                if let dotLayer = backgroundView.layer?.sublayers?.first(where: { $0.name == "dotIndicator" }) {
                    dotLayer.isHidden = true
                }
                
                let buttonSize = UIConfig.buttonSize
                
                // Cancel button on left
                cancelButton.frame = NSRect(
                    x: contentRect.minX,
                    y: contentRect.midY - buttonSize / 2,
                    width: buttonSize,
                    height: buttonSize
                )
                
                // Stop button on right
                stopButton.frame = NSRect(
                    x: contentRect.maxX - buttonSize,
                    y: contentRect.midY - buttonSize / 2,
                    width: buttonSize,
                    height: buttonSize
                )
                
                // Waveform in the middle between buttons
                waveformView.frame = NSRect(
                    x: contentRect.minX + buttonSize + 4,
                    y: contentRect.minY,
                    width: contentRect.width - (buttonSize * 2) - 8,
                    height: contentRect.height
                )
                waveformView.isHidden = false
                waveformView.startAnimating()
                
                statusLabel.isHidden = true
                
            case .processing:
                // Processing is handled in the minimized state
                // This case shouldn't happen but handle it gracefully
                waveformView.isHidden = true
                waveformView.stopAnimating()
                processingDotsView.isHidden = true
                
            case .complete:
                // Complete state transitions directly to idle
                waveformView.isHidden = true
                waveformView.stopAnimating()
                processingDotsView.isHidden = true
            }
        }
    }
    
    // MARK: - Mouse Events
    
    override func mouseEntered(with event: NSEvent) {
        print("Mouse entered - state: \(state)")
        if state == .idle {
            onHoverChanged?(true)
        }
    }
    
    override func mouseExited(with event: NSEvent) {
        print("Mouse exited - state: \(state)")
        if state == .idle || state == .hovered {
            onHoverChanged?(false)
        }
    }
    
    // Accept first responder to receive keyboard events
    override var acceptsFirstResponder: Bool {
        return true
    }
    
    // MARK: - Actions
    
    @objc private func startRecording() {
        onStartRecording?()
    }
    
    @objc private func stopRecording() {
        onStopRecording?()
    }
    
    @objc private func cancelRecording() {
        onCancelRecording?()
    }
    
    // MARK: - State Management
    
    func updateCornerRadius(isExpanded: Bool) {
        NSAnimationContext.runAnimationGroup { context in
            context.duration = UIConfig.panelAnimationDuration
            backgroundView.animator().layer?.cornerRadius = isExpanded ? UIConfig.cornerRadius : UIConfig.minimizedCornerRadius
        }
    }
    
    func setVolumeLevel(_ level: CGFloat) {
        waveformView.setVolumeLevel(level)
        // Ensure waveform redraws immediately
        waveformView.needsDisplay = true
    }
    
    func setState(_ newState: State, expanded: Bool) {
        state = newState
        isExpanded = expanded
        
        // Update UI based on state
        recordButton.isHidden = !(isExpanded && (state == .idle || state == .hovered))
        cancelButton.isHidden = !(isExpanded && state == .recording)
        stopButton.isHidden = !(isExpanded && state == .recording)
        activityIndicator.isHidden = true  // Always hidden now
        // Processing dots are handled in layout based on isExpanded
        statusLabel.isHidden = true  // Never show status label anymore
        
        switch state {
        case .idle:
            statusLabel.stringValue = ""
            activityIndicator.stopAnimation(nil)
            waveformView.stopAnimating()
            processingDotsView.stopAnimating()
            
        case .hovered:
            statusLabel.stringValue = ""
            processingDotsView.stopAnimating()
            
        case .recording:
            statusLabel.stringValue = "Recording..."
            statusLabel.textColor = NSColor.systemRed
            activityIndicator.stopAnimation(nil)
            waveformView.startAnimating()
            processingDotsView.stopAnimating()
            print("setState: Recording - waveform should be animating")
            
        case .processing:
            // Processing state only shows dots, no text
            waveformView.stopAnimating()
            // processingDotsView animation is handled in layout
            
        case .complete:
            statusLabel.stringValue = "✓ Complete"
            statusLabel.textColor = NSColor.systemGreen
            activityIndicator.stopAnimation(nil)
            waveformView.stopAnimating()
            processingDotsView.stopAnimating()
        }
        
        needsLayout = true
    }
    
    // MARK: - Keyboard Handling
    
    func handleKeyDown(_ event: NSEvent) {
        switch event.keyCode {
        case 53: // Escape key
            if state == .recording {
                cancelRecording()
            }
        case 36: // Enter/Return key
            if state == .recording {
                stopRecording()
            }
        default:
            break
        }
    }
}