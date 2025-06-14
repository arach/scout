import Cocoa
import WebKit

class OverlayWindow: NSWindow {
    override init(contentRect: NSRect, styleMask style: NSWindow.StyleMask, backing backingStoreType: NSWindow.BackingStoreType, defer flag: Bool) {
        super.init(contentRect: contentRect, styleMask: style, backing: backingStoreType, defer: flag)
        
        // Configure window appearance
        self.isOpaque = false
        self.backgroundColor = .clear
        self.level = .floating
        self.collectionBehavior = [.canJoinAllSpaces, .stationary]
        self.isMovableByWindowBackground = false
        self.titlebarAppearsTransparent = true
        self.titleVisibility = .hidden
        self.styleMask = [.borderless]
        
        // Ensure window stays on top
        self.level = .statusBar
    }
    
    override var canBecomeKey: Bool {
        return true
    }
    
    override var canBecomeMain: Bool {
        return false
    }
}

class OverlayViewController: NSViewController {
    var webView: WKWebView!
    var recordingTimer: Timer?
    var startTime: Date?
    
    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")
        
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 320, height: 80), configuration: configuration)
        // Make webview transparent
        if webView.responds(to: Selector(("setDrawsBackground:"))) {
            webView.setValue(false, forKey: "drawsBackground")
        }
        
        self.view = webView
    }
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        // Load the overlay HTML
        let html = """
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    background: transparent;
                    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                }
                .overlay-content {
                    background: rgba(220, 38, 38, 0.95);
                    border: 3px solid rgba(255, 255, 255, 0.9);
                    border-radius: 16px;
                    padding: 16px 24px;
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    box-shadow: 0 10px 40px rgba(220, 38, 38, 0.8);
                    animation: slideIn 0.4s ease-out;
                }
                .recording-dot {
                    width: 20px;
                    height: 20px;
                    background-color: #ffffff;
                    border-radius: 50%;
                    animation: pulse 1.5s ease-in-out infinite;
                }
                .recording-text {
                    color: #ffffff;
                    font-size: 18px;
                    font-weight: 700;
                    letter-spacing: 1px;
                    text-transform: uppercase;
                }
                .duration {
                    color: #ffffff;
                    font-size: 20px;
                    font-weight: 700;
                    font-family: "SF Mono", monospace;
                }
                @keyframes pulse {
                    0%, 100% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.2); opacity: 0.8; }
                }
                @keyframes slideIn {
                    from { transform: translateY(-100%); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            </style>
        </head>
        <body>
            <div class="overlay-content">
                <div class="recording-dot"></div>
                <span class="recording-text">Recording</span>
                <span class="duration" id="duration">0:00</span>
            </div>
        </body>
        </html>
        """
        
        webView.loadHTMLString(html, baseURL: nil)
    }
    
    func startRecording() {
        startTime = Date()
        recordingTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            self?.updateDuration()
        }
    }
    
    func stopRecording() {
        recordingTimer?.invalidate()
        recordingTimer = nil
        startTime = nil
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
    
    @objc func showOverlay() {
        if overlayWindow == nil {
            // Get screen dimensions
            guard let screen = NSScreen.main else { return }
            let screenFrame = screen.frame
            
            // Calculate center position at top
            let windowWidth: CGFloat = 320
            let windowHeight: CGFloat = 80
            let x = (screenFrame.width - windowWidth) / 2
            let y = screenFrame.height - windowHeight - 40 // 40px from top
            
            let contentRect = NSRect(x: x, y: y, width: windowWidth, height: windowHeight)
            
            // Create window
            overlayWindow = OverlayWindow(
                contentRect: contentRect,
                styleMask: [.borderless],
                backing: .buffered,
                defer: false
            )
            
            // Create view controller
            overlayController = OverlayViewController()
            overlayWindow?.contentViewController = overlayController
            
            // Configure window
            overlayWindow?.isReleasedWhenClosed = false
            overlayWindow?.hidesOnDeactivate = false
        }
        
        // Show and start recording
        overlayWindow?.makeKeyAndOrderFront(nil)
        overlayController?.startRecording()
        
        print("Overlay shown at position: \(overlayWindow?.frame ?? .zero)")
    }
    
    @objc func hideOverlay() {
        overlayController?.stopRecording()
        overlayWindow?.orderOut(nil)
        print("Overlay hidden")
    }
    
    @objc func positionOverlay(x: CGFloat, y: CGFloat) {
        guard let window = overlayWindow, let screen = NSScreen.main else { return }
        
        // Convert from top-left origin to bottom-left origin (macOS coordinate system)
        let screenHeight = screen.frame.height
        let macOSY = screenHeight - y - window.frame.height
        
        window.setFrameOrigin(NSPoint(x: x, y: macOSY))
        print("Overlay repositioned to: \(x), \(macOSY)")
    }
}