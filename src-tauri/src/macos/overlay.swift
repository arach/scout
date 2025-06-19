import Cocoa
import WebKit
import AVFoundation

// Constants for overlay sizing - using CGFloat for proper type safety
struct OverlayConstants {
    static let MINIMIZED_WIDTH: CGFloat = 80
    static let EXPANDED_WIDTH: CGFloat = 180
    static let EXPANDED_HEIGHT: CGFloat = 40
    static let MINIMIZED_HEIGHT: CGFloat = 8
    static let VERTICAL_MENU_OFFSET: CGFloat = 5
}

class OverlayWindow: NSWindow {
    override init(contentRect: NSRect, styleMask style: NSWindow.StyleMask, backing backingStoreType: NSWindow.BackingStoreType, defer flag: Bool) {
        NSLog("OverlayWindow init called with rect: %@", NSStringFromRect(contentRect))
        NSLog("OverlayWindow init - width: %f, height: %f", contentRect.width, contentRect.height)
        
        // Force a minimum size if the rect is too small
        var adjustedRect = contentRect
        if contentRect.width < 1 || contentRect.height < 1 {
            NSLog("WARNING: Window rect too small, adjusting to minimum size")
            adjustedRect = NSRect(x: contentRect.origin.x, y: contentRect.origin.y, width: 80, height: 8)
        }
        
        super.init(contentRect: adjustedRect, styleMask: [.borderless], backing: .buffered, defer: false)
        NSLog("OverlayWindow super.init completed with frame: %@", NSStringFromRect(self.frame))
        
        // Configure window appearance
        self.isOpaque = false
        self.backgroundColor = NSColor.clear
        self.hasShadow = false
        self.level = .screenSaver  // Higher level to ensure visibility
        self.collectionBehavior = [.canJoinAllSpaces, .stationary, .transient, .ignoresCycle, .fullScreenAuxiliary]
        self.isMovableByWindowBackground = false
        self.titlebarAppearsTransparent = true
        self.titleVisibility = .hidden
        self.alphaValue = 1.0
        
        // This is crucial for transparency
        self.contentView?.wantsLayer = true
        self.contentView?.layer?.backgroundColor = NSColor.clear.cgColor
        self.contentView?.layer?.isOpaque = false
    }
    
    override var canBecomeKey: Bool {
        return false  // Don't steal keyboard focus
    }
    
    override var canBecomeMain: Bool {
        return false
    }
    
    override func makeKeyAndOrderFront(_ sender: Any?) {
        // Override to prevent becoming key window
        self.orderFront(sender)
    }
    
    // Track whether we should allow hiding
    var allowHiding = false
    
    // Prevent the window from being hidden unless we explicitly allow it
    override func orderOut(_ sender: Any?) {
        if allowHiding {
            super.orderOut(sender)
        } else {
            print("Attempt to hide overlay blocked")
        }
    }
}

class OverlayViewController: NSViewController {
    var webView: WKWebView!
    var recordingTimer: Timer?
    var startTime: Date?
    var isRecording: Bool = false
    
    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")
        configuration.setValue(false, forKey: "drawsBackground")
        
        // Debug: Log the constants
        NSLog("loadView - OverlayConstants.MINIMIZED_WIDTH = %f", OverlayConstants.MINIMIZED_WIDTH)
        NSLog("loadView - OverlayConstants.MINIMIZED_HEIGHT = %f", OverlayConstants.MINIMIZED_HEIGHT)
        
        // Create a container view with the correct size
        let containerView = NSView(frame: CGRect(x: 0, y: 0, width: OverlayConstants.MINIMIZED_WIDTH, height: OverlayConstants.MINIMIZED_HEIGHT))
        containerView.wantsLayer = true
        containerView.layer?.backgroundColor = NSColor.clear.cgColor
        
        // Create webview with minimal pill size
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: OverlayConstants.MINIMIZED_WIDTH, height: OverlayConstants.MINIMIZED_HEIGHT), configuration: configuration)
        
        // Make webview fully transparent
        webView.layer?.backgroundColor = NSColor.clear.cgColor
        
        if webView.responds(to: Selector(("setDrawsBackground:"))) {
            webView.setValue(false, forKey: "drawsBackground")
        }
        if webView.responds(to: Selector(("setDrawsTransparentBackground:"))) {
            webView.setValue(true, forKey: "drawsTransparentBackground")
        }
        print("WebView initial size - width: \(webView.frame.width), height: \(webView.frame.height)")
        print("WebView background color: \(String(describing: webView.layer?.backgroundColor))")
        // Add webview to container
        containerView.addSubview(webView)
        
        // Set the container as the main view
        self.view = containerView
        
        print("OverlayViewController loadView - Container frame: \(containerView.frame)")
        print("OverlayViewController loadView - WebView frame: \(webView.frame)")
    }
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        print("OverlayViewController viewDidLoad called")
        
        // Load the overlay HTML
        let html = """
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
            <meta http-equiv="Pragma" content="no-cache">
            <meta http-equiv="Expires" content="0">
            <style>
                /* Cache buster: \(Date().timeIntervalSince1970) */
                html, body {
                    height: 100%;
                    width: 100%;
                    margin: 0;
                    padding: 0;
                    overflow: hidden;
                }
                
                body {
                    background: transparent;
                    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
                    -webkit-font-smoothing: antialiased;
                    user-select: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-sizing: border-box;
                }
                
                /* Pill container - always fills 100% of window */
                .pill {
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.9); /* Black with slight transparency */
                    border-radius: 4px;
                    position: relative;
                    cursor: pointer;
                    border: 1px solid rgba(200, 200, 200, 0.5); /* Light gray border */
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
                    /* No transitions - Swift handles animations */
                }
                
                .pill.idle {
                    animation: pulse 3s ease-in-out infinite;
                }
                
                /* Expanded recording state - just visual changes, no size/position */
                .pill.recording {
                    background: rgba(20, 20, 20, 0.85);
                    backdrop-filter: blur(24px) saturate(200%);
                    -webkit-backdrop-filter: blur(24px) saturate(200%);
                    border: 0.5px solid rgba(255, 255, 255, 0.15);
                    border-radius: 12px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4),
                                0 2px 8px rgba(0, 0, 0, 0.2),
                                inset 0 1px 0 rgba(255, 255, 255, 0.1);
                }
                
                /* Content container */
                .content {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    width: 100%;
                    padding: 0 12px;
                    box-sizing: border-box;
                    justify-content: center;
                    opacity: 0;
                }
                
                .pill.recording .content {
                    opacity: 1;
                }
                
                /* Visualizer inside the box */
                .visualizer {
                    display: flex;
                    align-items: center;
                    gap: 2px;
                    height: 20px;
                }
                
                .bar {
                    width: 3px;
                    background: linear-gradient(to top, #ff453a, #ff8a80);
                    border-radius: 1.5px;
                    box-shadow: 0 0 6px rgba(255, 69, 58, 0.6);
                    animation: wave 0.8s ease-in-out infinite;
                    transform-origin: bottom;
                }
                
                .bar:nth-child(1) { animation-delay: 0s; height: 8px; }
                .bar:nth-child(2) { animation-delay: 0.1s; height: 14px; }
                .bar:nth-child(3) { animation-delay: 0.2s; height: 11px; }
                .bar:nth-child(4) { animation-delay: 0.3s; height: 16px; }
                .bar:nth-child(5) { animation-delay: 0.4s; height: 12px; }
                
                .recording-info {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                
                .recording-info .recording-dot {
                    width: 8px;
                    height: 8px;
                    background: #ff453a !important;
                    background-color: #ff453a !important;
                    border-radius: 50%;
                    box-shadow: 0 0 10px rgba(255, 69, 58, 0.9);
                    animation: glow 1.5s ease-in-out infinite;
                }
                
                .recording-text {
                    color: rgba(255, 255, 255, 0.9);
                    font-size: 12px;
                    font-weight: 600;
                    letter-spacing: 0.5px;
                    text-transform: uppercase;
                }
                
                .duration {
                    color: rgba(255, 255, 255, 0.65);
                    font-size: 11px;
                    font-weight: 500;
                    font-family: "SF Mono", monospace;
                    letter-spacing: 0.3px;
                    font-variant-numeric: tabular-nums;
                }
                
                @keyframes pulse {
                    0%, 100% { 
                        opacity: 0.7;
                        transform: scaleX(1);
                        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
                    }
                    50% { 
                        opacity: 1;
                        transform: scaleX(1.1);
                        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.5);
                    }
                }
                
                @keyframes wave {
                    0%, 100% { 
                        transform: scaleY(0.5);
                    }
                    50% { 
                        transform: scaleY(1);
                    }
                }
                
                @keyframes glow {
                    0%, 100% { 
                        opacity: 1;
                        transform: scale(1);
                    }
                    50% { 
                        opacity: 0.7;
                        transform: scale(1.2);
                    }
                }
            </style>
        </head>
        <body>
            <div class="pill idle" id="pill">
                <div class="content">
                    <div class="visualizer">
                        <div class="bar"></div>
                        <div class="bar"></div>
                        <div class="bar"></div>
                        <div class="bar"></div>
                        <div class="bar"></div>
                    </div>
                    <div class="recording-info">
                        <div class="recording-dot"></div>
                        <span class="recording-text">REC</span>
                        <span class="duration" id="duration">0:00</span>
                    </div>
                </div>
            </div>
            <script>
                // Simple class toggling - no animation expectations
                window.startRecording = function() {
                    console.log('startRecording called');
                    document.getElementById('pill').classList.remove('idle');
                    document.getElementById('pill').classList.add('recording');
                    console.log('Pill classes after start:', document.getElementById('pill').className);
                };
                
                window.stopRecording = function() {
                    console.log('stopRecording called');
                    document.getElementById('pill').classList.remove('recording');
                    document.getElementById('pill').classList.add('idle');
                    document.getElementById('duration').textContent = '0:00';
                    console.log('Pill classes after stop:', document.getElementById('pill').className);
                };
                
                window.updateStatus = function(status) {
                    const recordingText = document.querySelector('.recording-text');
                    
                    if (status === 'Processing...') {
                        recordingText.textContent = 'PROCESSING';
                        recordingText.style.color = 'rgba(255, 204, 0, 0.9)';
                    } else if (status === 'Transcribing...') {
                        recordingText.textContent = 'TRANSCRIBING';
                        recordingText.style.color = 'rgba(50, 215, 75, 0.9)';
                    } else if (status === 'Complete') {
                        recordingText.textContent = 'COMPLETE';
                        recordingText.style.color = 'rgba(50, 215, 75, 0.9)';
                    } else if (status === 'Failed') {
                        recordingText.textContent = 'FAILED';
                        recordingText.style.color = 'rgba(100, 100, 100, 0.9)';
                    }
                };
            </script>
        </body>
        </html>
        """
        
        webView.loadHTMLString(html, baseURL: nil)
        
        // Force a redraw after loading
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.view.setNeedsDisplay(self?.view.bounds ?? .zero)
            print("WebView content loaded and forced redraw")
        }
    }
    
    func startRecording() {
        isRecording = true
        startTime = Date()
        
        // Resize container and webview to accommodate expanded content
        self.view.frame = CGRect(x: 0, y: 0, width: OverlayConstants.EXPANDED_WIDTH, height: OverlayConstants.EXPANDED_HEIGHT)
        webView.frame = CGRect(x: 0, y: 0, width: OverlayConstants.EXPANDED_WIDTH, height: OverlayConstants.EXPANDED_HEIGHT)
        
        // Call the JavaScript function that's already defined in the HTML
        webView.evaluateJavaScript("if (window.startRecording) window.startRecording();") { _, error in
            if let error = error {
                print("Error calling startRecording: \(error)")
            } else {
                print("Successfully called startRecording in WebView")
            }
        }
        
        // Force a redraw of the view
        self.view.setNeedsDisplay(self.view.bounds)
        
        // Start updating duration
        recordingTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            self?.updateDuration()
        }
    }
    
    func stopRecording() {
        isRecording = false
        recordingTimer?.invalidate()
        recordingTimer = nil
        startTime = nil
        
        // Call the JavaScript function that's already defined in the HTML
        webView.evaluateJavaScript("if (window.stopRecording) window.stopRecording();") { _, error in
            if let error = error {
                print("Error calling stopRecording: \(error)")
            }
        }
        
        // Don't resize the view here - let hideOverlay handle the animation
        // The view will be resized as part of the window shrink animation
    }
    
    private func updateDuration() {
        guard let startTime = startTime else { return }
        
        let elapsed = Date().timeIntervalSince(startTime)
        let minutes = Int(elapsed) / 60
        let seconds = Int(elapsed) % 60
        let durationString = String(format: "%d:%02d", minutes, seconds)
        
        webView.evaluateJavaScript("document.getElementById('duration').textContent = '\(durationString)'")
    }
}

@objc class MacOSOverlay: NSObject {
    private var overlayWindow: OverlayWindow?
    private var overlayController: OverlayViewController?
    private var audioPlayer: AVAudioPlayer?
    private var currentPosition: String = "top-center"
    
    override init() {
        super.init()
        NSLog("MacOSOverlay init called")
        // Initialize overlay immediately so it's always visible as a pill
        // Delay slightly to ensure app is ready
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            NSLog("Setting up overlay after delay...")
            self?.setupOverlay()
        }
    }
    
    private func setupOverlay() {
        NSLog("setupOverlay called")
        // Get screen dimensions
        guard let screen = NSScreen.main else { 
            NSLog("ERROR: No main screen found!")
            return 
        }
        let screenFrame = screen.frame
        NSLog("Screen frame: %@", NSStringFromRect(screenFrame))
        
        // Debug: Log raw constant values
        NSLog("DEBUG: Raw OverlayConstants.MINIMIZED_WIDTH = %f", OverlayConstants.MINIMIZED_WIDTH)
        NSLog("DEBUG: Raw OverlayConstants.MINIMIZED_HEIGHT = %f", OverlayConstants.MINIMIZED_HEIGHT)
        
        // Calculate position based on current position setting
        let windowWidth = OverlayConstants.MINIMIZED_WIDTH
        let windowHeight = OverlayConstants.MINIMIZED_HEIGHT
        NSLog("Window dimensions: width=%f, height=%f", windowWidth, windowHeight)
        let padding: CGFloat = 10
        let menuBarHeight = NSStatusBar.system.thickness
        
        var x: CGFloat = 0
        var y: CGFloat = 0
        
        let screenWidth = screenFrame.width
        let screenHeight = screenFrame.height
        
        switch currentPosition {
        case "top-left":
            x = padding
            y = screenHeight - windowHeight - padding
        case "top-center":
            x = (screenWidth - windowWidth) / 2
            // Position at top of screen with minimal gap
            y = screenHeight - windowHeight - 10
        case "top-right":
            x = screenWidth - windowWidth - padding
            y = screenHeight - windowHeight - padding
        case "bottom-left":
            x = padding
            y = padding
        case "bottom-center":
            x = (screenWidth - windowWidth) / 2
            y = padding
        case "bottom-right":
            x = screenWidth - windowWidth - padding
            y = padding
        case "left-center":
            x = padding
            y = (screenHeight - windowHeight) / 2
        case "right-center":
            x = screenWidth - windowWidth - padding
            y = (screenHeight - windowHeight) / 2
        default:
            // Default to top-center
            x = (screenWidth - windowWidth) / 2
            y = screenHeight - windowHeight - 5
        }
        
        let contentRect = NSRect(x: x, y: y, width: windowWidth, height: windowHeight)
        
        NSLog("DEBUG: Screen height: %f, Menu bar height: %f, Window height: %f", 
              screenHeight, menuBarHeight, windowHeight)
        NSLog("DEBUG: Calculated position - x: %f, y: %f", x, y)
        NSLog("DEBUG: Creating window with rect: %@", NSStringFromRect(contentRect))
        
        // Create window with explicit size
        NSLog("DEBUG: About to create OverlayWindow...")
        NSLog("DEBUG: Creating with x=%f, y=%f, width=%f, height=%f", x, y, windowWidth, windowHeight)
        
        // Force values and ensure they're not zero
        let finalWidth = max(80, windowWidth)
        let finalHeight = max(4, windowHeight)
        let finalRect = NSRect(x: x, y: y, width: finalWidth, height: finalHeight)
        
        NSLog("DEBUG: Final rect for window creation: %@", NSStringFromRect(finalRect))
        
        overlayWindow = OverlayWindow(
            contentRect: finalRect,
            styleMask: [],
            backing: .buffered,
            defer: false
        )
        NSLog("DEBUG: OverlayWindow init completed")
        
        NSLog("DEBUG: Window created: %@", overlayWindow != nil ? "YES" : "NO")
        
        // Set the frame origin after creation
        overlayWindow?.setFrameOrigin(NSPoint(x: x, y: y))
        
        NSLog("DEBUG: Window created with frame: %@", NSStringFromRect(overlayWindow?.frame ?? .zero))
        
        // Create view controller
        overlayController = OverlayViewController()
        NSLog("DEBUG: OverlayViewController created")
        
        // Force the webview to be the correct size BEFORE setting it as content
        overlayController?.view.frame = NSRect(x: 0, y: 0, width: windowWidth, height: windowHeight)
        overlayController?.webView.frame = NSRect(x: 0, y: 0, width: windowWidth, height: windowHeight)
        
        NSLog("DEBUG: Before setting controller - view frame: %@, webView frame: %@", 
              NSStringFromRect(overlayController?.view.frame ?? .zero),
              NSStringFromRect(overlayController?.webView.frame ?? .zero))
        
        // Now set the controller
        overlayWindow?.contentViewController = overlayController
        
        // Double-check the sizes after setting controller
        overlayWindow?.contentView?.frame = NSRect(x: 0, y: 0, width: windowWidth, height: windowHeight)
        overlayController?.view.frame = NSRect(x: 0, y: 0, width: windowWidth, height: windowHeight)
        overlayController?.webView.frame = NSRect(x: 0, y: 0, width: windowWidth, height: windowHeight)
        
        print("DEBUG: After setting controller, window frame: \(overlayWindow?.frame ?? .zero)")
        print("DEBUG: WebView frame: \(overlayController?.webView.frame ?? .zero)")
        print("DEBUG: View frame: \(overlayController?.view.frame ?? .zero)")
        
        // Configure window
        overlayWindow?.isReleasedWhenClosed = false
        overlayWindow?.hidesOnDeactivate = false
        overlayWindow?.ignoresMouseEvents = true // Ignore mouse for the minimal pill
        overlayWindow?.contentView?.wantsLayer = true
        overlayWindow?.contentView?.layer?.backgroundColor = NSColor.clear.cgColor
        
        // Final size enforcement before showing
        overlayWindow?.setFrame(NSRect(x: x, y: y, width: windowWidth, height: windowHeight), display: false)
        
        // Show the window immediately as a minimal pill
        overlayWindow?.orderFrontRegardless() // Force to front
        overlayWindow?.orderFront(nil)  // Use orderFront instead of makeKeyAndOrderFront
        overlayWindow?.level = .screenSaver // Higher than floating
        
        // Force display
        overlayWindow?.display()
        overlayWindow?.setIsVisible(true)
        
        print("=== OVERLAY SETUP DEBUG ===")
        print("Window frame: \(overlayWindow?.frame ?? .zero)")
        print("Window visible: \(overlayWindow?.isVisible ?? false)")
        print("Window on screen: \(overlayWindow?.isOnActiveSpace ?? false)")
        print("Window level: \(overlayWindow?.level.rawValue ?? 0)")
        print("WebView frame: \(overlayController?.webView.frame ?? .zero)")
        print("Content view frame: \(overlayWindow?.contentView?.frame ?? .zero)")
        print("Expected size: \(windowWidth)x\(windowHeight)")
        print("===========================")
    }
    
    private func playStartSound() {
        // Create a higher pitched "ding" sound for start
        let systemSound = NSSound(named: NSSound.Name("Hero"))
        systemSound?.volume = 0.8
        systemSound?.play()
    }
    
    private func playStopSound() {
        // Create a lower pitched "done" sound for stop
        let systemSound = NSSound(named: NSSound.Name("Submarine"))
        systemSound?.volume = 0.8
        systemSound?.play()
    }
    
    @objc func showOverlay() {
        // DISABLED: Using Tauri overlay window instead of native overlay
        return
        
        /*
        // If overlay doesn't exist, create it
        if overlayWindow == nil {
            setupOverlay()
        }
        
        // Play start recording sound
        playStartSound()
        
        guard let window = overlayWindow, let screen = NSScreen.main else { return }
        
        // Get current pill position for smooth animation
        let currentFrame = window.frame
        
        // Calculate expanded size and position
        let expandedWidth = OverlayConstants.EXPANDED_WIDTH
        */
        
        /*
        let expandedHeight = OverlayConstants.EXPANDED_HEIGHT
        
        // Use helper function to calculate position
        let (x, y) = calculatePositionForSize(width: expandedWidth, height: expandedHeight, position: currentPosition, screen: screen)
        
        // Make sure window is visible first
        window.setIsVisible(true)
        window.orderFrontRegardless()
        window.level = .screenSaver // Ensure high window level
        
        // Debug: Check window state before animation
        print("=== SHOW OVERLAY DEBUG ===")
        print("Window visible before animation: \(window.isVisible)")
        print("Window on screen: \(window.isOnActiveSpace)")
        print("Window level: \(window.level.rawValue)")
        print("Window alpha: \(window.alphaValue)")
        
        // If this is the first show, set the frame immediately to avoid offset
        if currentFrame.width <= OverlayConstants.MINIMIZED_WIDTH {
            print("Starting from minimal pill, current position: \(currentPosition)")
            // Use the current position to set initial pill location
            let (pillX, pillY) = calculatePositionForSize(width: OverlayConstants.MINIMIZED_WIDTH, height: OverlayConstants.MINIMIZED_HEIGHT, position: currentPosition, screen: screen)
            window.setFrame(NSRect(x: pillX, y: pillY, width: OverlayConstants.MINIMIZED_WIDTH, height: OverlayConstants.MINIMIZED_HEIGHT), display: false)
        }
        
        // First, start recording in the controller to resize the webview
        print("Calling startRecording on controller BEFORE animation...")
        overlayController?.startRecording()
        
        // Animate window expansion
        print("Animating to expanded state at position: \(x), \(y), size: \(expandedWidth)x\(expandedHeight)")
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.4
            context.timingFunction = CAMediaTimingFunction(controlPoints: 0.34, 1.56, 0.64, 1)
            window.animator().setFrame(NSRect(x: x, y: y, width: expandedWidth, height: expandedHeight), display: true)
            // Also animate content view
            window.contentView?.animator().frame = NSRect(x: 0, y: 0, width: expandedWidth, height: expandedHeight)
        }, completionHandler: { [weak self] in
            // Ensure window is still visible after animation
            window.setIsVisible(true)
            window.orderFrontRegardless()
            window.level = .screenSaver
            
            // Double-check all views are properly sized after animation
            window.contentView?.frame = NSRect(x: 0, y: 0, width: expandedWidth, height: expandedHeight)
            self?.overlayController?.view.frame = NSRect(x: 0, y: 0, width: expandedWidth, height: expandedHeight)
            if let webView = self?.overlayController?.webView {
                webView.frame = NSRect(x: 0, y: 0, width: expandedWidth, height: expandedHeight)
                print("WebView frame updated after animation: \(webView.frame)")
                
                // Force the webview to redraw
                webView.setNeedsDisplay(webView.bounds)
                webView.display()
            }
            
            print("=== POST-ANIMATION STATE ===")
            print("Window visible: \(window.isVisible)")
            print("Window frame: \(window.frame)")
            print("Content view frame: \(window.contentView?.frame ?? .zero)")
            print("Controller isRecording: \(self?.overlayController?.isRecording ?? false)")
            print("========================")
        })
        
        // Allow interaction during recording
        window.ignoresMouseEvents = false
        
        print("Recording started, overlay expanded from \(currentFrame) to target \(expandedWidth)x\(expandedHeight)")
        print("Controller isRecording: \(overlayController?.isRecording ?? false)")
        print("WebView frame: \(overlayController?.webView.frame ?? .zero)")
        */
    }
    
    // Minimizes overlay to pill state - does NOT hide it completely
    @objc func minimizeOverlay() {
        // DISABLED: Using Tauri overlay window instead
        return
        /*
        overlayController?.stopRecording()
        
        guard let window = overlayWindow, let screen = NSScreen.main else { return }
        
        // Get the current frame to shrink from
        let currentFrame = window.frame
        */
        
        /*
        let currentCenter = NSPoint(x: currentFrame.midX, y: currentFrame.midY)
        
        // Calculate the final minimal size
        let minimalWidth = OverlayConstants.MINIMIZED_WIDTH
        let minimalHeight = OverlayConstants.MINIMIZED_HEIGHT
        
        // Calculate final position to keep the overlay centered during shrink
        let finalX = currentCenter.x - minimalWidth / 2
        let finalY = currentCenter.y - minimalHeight / 2
        
        // Animate window collapse with shrinking effect
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.4
            // Use a more dramatic easing for the shrink effect
            context.timingFunction = CAMediaTimingFunction(controlPoints: 0.25, 0.46, 0.45, 0.94)
            
            // Shrink from current size to minimal size, keeping it centered
            window.animator().setFrame(NSRect(x: finalX, y: finalY, width: minimalWidth, height: minimalHeight), display: true)
            
            // Also animate opacity for a fade effect during shrink
            window.animator().alphaValue = 0.6
        }, completionHandler: { [weak self] in
            // After shrinking animation, move to the proper position
            guard let self = self, let screen = NSScreen.main else { return }
            
            // Calculate the proper position for the minimal pill
            let (properX, properY) = self.calculatePositionForSize(
                width: minimalWidth, 
                height: minimalHeight, 
                position: self.currentPosition, 
                screen: screen
            )
            
            // Quick snap to the correct position
            window.setFrame(NSRect(x: properX, y: properY, width: minimalWidth, height: minimalHeight), display: false)
            
            // Restore full opacity
            window.alphaValue = 1.0
            
            // Ensure webview is properly sized after animation
            self.overlayController?.view.frame = NSRect(x: 0, y: 0, width: minimalWidth, height: minimalHeight)
        })
        
        // Disable interaction for minimal pill
        window.ignoresMouseEvents = true
        
        // Play stop recording sound
        playStopSound()
        
        print("Recording stopped, overlay minimized")
        */
    }
    
    @objc func positionOverlay(_ x: CGFloat, y: CGFloat) {
        guard let window = overlayWindow, let screen = NSScreen.main else { return }
        
        // Convert from top-left origin to bottom-left origin (macOS coordinate system)
        let screenHeight = screen.frame.height
        let macOSY = screenHeight - y - window.frame.height
        
        window.setFrameOrigin(NSPoint(x: x, y: macOSY))
        print("Overlay repositioned to: \(x), \(macOSY)")
    }
    
    @objc func ensureVisible() {
        if overlayWindow == nil {
            setupOverlay()
        }
        
        guard let window = overlayWindow, let screen = NSScreen.main else { return }
        
        // FORCE it to the correct size for minimal pill
        let expectedWidth: CGFloat = OverlayConstants.MINIMIZED_WIDTH
        let expectedHeight: CGFloat = OverlayConstants.MINIMIZED_HEIGHT
        let screenFrame = screen.frame
        let padding: CGFloat = 20
        
        var expectedX: CGFloat = 0
        var expectedY: CGFloat = 0
        
        switch currentPosition {
        case "top-left":
            expectedX = padding
            expectedY = screenFrame.height - expectedHeight - padding
        case "top-center":
            expectedX = (screenFrame.width - expectedWidth) / 2
            expectedY = screenFrame.height - expectedHeight - 5
        case "top-right":
            expectedX = screenFrame.width - expectedWidth - padding
            expectedY = screenFrame.height - expectedHeight - padding
        case "bottom-left":
            expectedX = padding
            expectedY = padding
        case "bottom-center":
            expectedX = (screenFrame.width - expectedWidth) / 2
            expectedY = padding
        case "bottom-right":
            expectedX = screenFrame.width - expectedWidth - padding
            expectedY = padding
        case "left-center":
            expectedX = padding
            expectedY = (screenFrame.height - expectedHeight) / 2
        case "right-center":
            expectedX = screenFrame.width - expectedWidth - padding
            expectedY = (screenFrame.height - expectedHeight) / 2
        default:
            // Default to top-center
            expectedX = (screenFrame.width - expectedWidth) / 2
            expectedY = screenFrame.height - expectedHeight - 5
        }
        
        let expectedFrame = NSRect(x: expectedX, y: expectedY, width: expectedWidth, height: expectedHeight)
        
        print("=== ENSURE VISIBLE DEBUG ===")
        print("Current window frame: \(window.frame)")
        print("Expected frame: \(expectedFrame)")
        print("isRecording: \(isRecording)")
        
        // ALWAYS force to minimal size when not recording
        if !isRecording {
            // Set frame without animation
            window.setFrame(expectedFrame, display: false)
            
            // Force webview to correct size
            overlayController?.webView.frame = NSRect(x: 0, y: 0, width: expectedWidth, height: expectedHeight)
            overlayController?.view.frame = NSRect(x: 0, y: 0, width: expectedWidth, height: expectedHeight)
            
            // Force content view to correct size
            window.contentView?.frame = NSRect(x: 0, y: 0, width: expectedWidth, height: expectedHeight)
            
            // Force display update
            window.display()
            window.contentView?.display()
            
            // Verify the change took effect
            print("After forcing - Window frame: \(window.frame)")
            print("After forcing - WebView frame: \(overlayController?.webView.frame ?? .zero)")
            print("After forcing - Content view frame: \(window.contentView?.frame ?? .zero)")
        }
        
        window.setIsVisible(true)
        window.orderFrontRegardless()
        print("===========================")
    }
    
    private var isRecording: Bool {
        return overlayController?.isRecording ?? false
    }
    
    private func calculatePositionForSize(width: CGFloat, height: CGFloat, position: String, screen: NSScreen) -> (CGFloat, CGFloat) {
        let screenFrame = screen.frame
        let padding: CGFloat = 20
        let menuBarHeight: CGFloat = NSStatusBar.system.thickness
        
        var x: CGFloat = 0
        var y: CGFloat = 0
        
        // Determine if this is for expanded state (height > 10)
        let isExpanded = height > 10
        
        switch position {
        case "top-left":
            x = padding
            y = screenFrame.height - height - (isExpanded ? padding + menuBarHeight : padding)
        case "top-center":
            x = (screenFrame.width - width) / 2
            y = screenFrame.height - height - 5
        case "top-right":
            x = screenFrame.width - width - padding
            y = screenFrame.height - height - (isExpanded ? padding + menuBarHeight : padding)
        case "bottom-left":
            x = padding
            y = padding
        case "bottom-center":
            x = (screenFrame.width - width) / 2
            y = padding
        case "bottom-right":
            x = screenFrame.width - width - padding
            y = padding
        case "left-center":
            x = padding
            y = (screenFrame.height - height) / 2
        case "right-center":
            x = screenFrame.width - width - padding
            y = (screenFrame.height - height) / 2
        default:
            // Default to top-center
            x = (screenFrame.width - width) / 2
            y = screenFrame.height - height - 5
        }
        
        return (x, y)
    }
    
    @objc func setOverlayPosition(_ position: String) {
        currentPosition = position
        
        guard let window = overlayWindow, let screen = NSScreen.main else { return }
        
        let screenFrame = screen.frame
        let windowWidth = window.frame.width
        let windowHeight = window.frame.height
        let menuBarHeight: CGFloat = NSStatusBar.system.thickness
        
        // Calculate position based on string
        var x: CGFloat = 0
        var y: CGFloat = 0
        let padding: CGFloat = 20
        
        // Adjust for expanded vs minimal state
        let isExpanded = windowWidth > OverlayConstants.MINIMIZED_WIDTH
        
        switch position {
        case "top-left":
            x = padding
            y = screenFrame.height - windowHeight - (isExpanded ? padding + menuBarHeight : padding)
        case "top-center":
            x = (screenFrame.width - windowWidth) / 2
            y = screenFrame.height - windowHeight - (isExpanded ? menuBarHeight : menuBarHeight + padding)
        case "top-right":
            x = screenFrame.width - windowWidth - padding
            y = screenFrame.height - windowHeight - (isExpanded ? padding + menuBarHeight : padding)
        case "bottom-left":
            x = padding
            y = padding
        case "bottom-center":
            x = (screenFrame.width - windowWidth) / 2
            y = padding
        case "bottom-right":
            x = screenFrame.width - windowWidth - padding
            y = padding
        case "left-center":
            x = padding
            y = (screenFrame.height - windowHeight) / 2
        case "right-center":
            x = screenFrame.width - windowWidth - padding
            y = (screenFrame.height - windowHeight) / 2
        default:
            // Default to top-center
            x = (screenFrame.width - windowWidth) / 2
            y = screenFrame.height - windowHeight - (isExpanded ? menuBarHeight : menuBarHeight + padding)
        }
        
        window.setFrameOrigin(NSPoint(x: x, y: y))
        print("Overlay repositioned to \(position): \(x), \(y)")
    }
    
    @objc func updateProgress(_ progressState: String) {
        DispatchQueue.main.async { [weak self] in
            guard let webView = self?.overlayController?.webView else { return }
            
            // Update the overlay UI based on progress state
            let script: String
            
            switch progressState {
            case "recording":
                script = "if (window.startRecording) window.startRecording();"
            case "processing":
                script = "if (window.updateStatus) window.updateStatus('Processing...');"
            case "transcribing":
                script = "if (window.updateStatus) window.updateStatus('Transcribing...');"
            case "complete":
                script = "if (window.updateStatus) window.updateStatus('Complete');"
            case "failed":
                script = "if (window.updateStatus) window.updateStatus('Failed');"
            default:
                script = "if (window.stopRecording) window.stopRecording();"
            }
            
            webView.evaluateJavaScript(script) { _, error in
                if let error = error {
                    print("Error updating overlay progress: \(error)")
                }
            }
        }
    }
    
    // MARK: - Future hide/show functionality
    // These methods completely hide/show the overlay window (remove from screen)
    
    @objc func hideOverlay() {
        // Future implementation: completely hide the overlay window
        guard let window = overlayWindow else { return }
        window.orderOut(nil)
        print("Overlay hidden (removed from screen)")
    }
    
    @objc func showOverlayAgain() {
        // Future implementation: restore a previously hidden overlay
        guard let window = overlayWindow else { return }
        window.orderFront(nil)
        window.setIsVisible(true)
        print("Overlay shown again")
    }
}
