import Cocoa

// MARK: - Wide Particle Overlay View
// A wider, more spacious particle animation that flows horizontally

class ParticleOverlayView: NSView {
    private struct Particle {
        var x: CGFloat
        var y: CGFloat
        var velocityX: CGFloat
        var velocityY: CGFloat
        var size: CGFloat
        var life: CGFloat
        var maxLife: CGFloat
        var color: NSColor
        
        mutating func update(deltaTime: CGFloat) {
            // Update position
            x += velocityX * deltaTime * 60  // Normalize for 60fps
            y += velocityY * deltaTime * 60
            
            // Apply very subtle gravity/drift
            velocityY += 0.01 * deltaTime * 60
            
            // Reduce horizontal velocity slightly over time
            velocityX *= 0.995
            
            // Update life
            life -= deltaTime
        }
        
        var opacity: CGFloat {
            // Fade in and out smoothly
            let lifeRatio = life / maxLife
            if lifeRatio > 0.8 {
                // Fade in for first 20% of life
                return (1.0 - lifeRatio) * 5.0 * 0.6
            } else {
                // Fade out for rest of life
                return lifeRatio * 0.75
            }
        }
    }
    
    private var particles: [Particle] = []
    private var animationTimer: Timer?
    private var volumeLevel: CGFloat = 0.0
    private var lastUpdateTime: TimeInterval = 0
    private let maxParticles = 250  // Even more particles for denser effect
    private var isAnimating = false
    
    // Visual effects layer for blur
    private var blurView: NSVisualEffectView?
    
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setupView()
    }
    
    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupView()
    }
    
    private func setupView() {
        // Set up the blur background
        let blur = NSVisualEffectView(frame: bounds)
        blur.autoresizingMask = [.width, .height]
        blur.blendingMode = .behindWindow
        blur.material = .hudWindow
        blur.state = .active
        blur.alphaValue = 0.15  // Even more subtle blur
        addSubview(blur, positioned: .below, relativeTo: nil)
        self.blurView = blur
        
        // Make the view layer-backed for better performance
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
    }
    
    func startAnimating() {
        guard !isAnimating else { return }
        isAnimating = true
        lastUpdateTime = Date.timeIntervalSinceReferenceDate
        animationTimer = Timer.scheduledTimer(withTimeInterval: 1.0/60.0, repeats: true) { [weak self] _ in
            self?.updateAnimation()
        }
    }
    
    func stopAnimating() {
        isAnimating = false
        animationTimer?.invalidate()
        animationTimer = nil
        
        // Let particles fade out naturally
        Timer.scheduledTimer(withTimeInterval: 1.0/60.0, repeats: true) { [weak self] timer in
            guard let self = self else {
                timer.invalidate()
                return
            }
            
            self.updateParticles(deltaTime: 1.0/60.0)
            self.needsDisplay = true
            
            if self.particles.isEmpty {
                timer.invalidate()
            }
        }
    }
    
    func setVolumeLevel(_ level: CGFloat) {
        volumeLevel = max(0, min(1, level))
    }
    
    @objc private func updateAnimation() {
        let currentTime = Date.timeIntervalSinceReferenceDate
        let deltaTime = currentTime - lastUpdateTime
        lastUpdateTime = currentTime
        
        // Generate new particles based on volume
        // Spawn from center and flow outward horizontally
        if volumeLevel > 0.02 {  // Lower threshold for more particles
            let particleCount = Int(2 + volumeLevel * 6)  // 2-8 particles per frame
            
            for _ in 0..<particleCount {
                if particles.count < maxParticles {
                    createParticle()
                }
            }
        } else if particles.count < 40 {  // More baseline particles
            // Always have some minimal particle flow
            if CGFloat.random(in: 0...1) < 0.4 {  // Higher chance to create particles
                createParticle()
            }
        }
        
        updateParticles(deltaTime: CGFloat(deltaTime))
        needsDisplay = true
    }
    
    private func createParticle() {
        let centerX = bounds.width / 2
        let centerY = bounds.height / 2
        
        // Spawn particles from center area with some spread
        let spawnX = centerX + CGFloat.random(in: -30...30)
        let spawnY = centerY + CGFloat.random(in: -5...5)
        
        // Particles flow outward horizontally - FASTER
        let direction = CGFloat.random(in: 0...1) > 0.5 ? 1.0 : -1.0
        let baseSpeed = 1.5 + volumeLevel * 3.0  // Increased base speed
        let velocityX = direction * baseSpeed * CGFloat.random(in: 0.8...1.5)
        
        // Calculate time needed to reach edge (distance / speed)
        // Add extra margin to ensure particles reach the edge
        let distanceToEdge = direction > 0 ? (bounds.width - spawnX + 20) : (spawnX + 20)
        let timeToEdge = distanceToEdge / abs(velocityX * 60)  // Convert to seconds (60fps normalized)
        
        // Set life to ensure particle reaches edge and a bit beyond
        let particleLife = timeToEdge * CGFloat.random(in: 1.0...1.2)  // 100-120% of time to edge
        
        let particle = Particle(
            x: spawnX,
            y: spawnY,
            velocityX: velocityX,
            velocityY: CGFloat.random(in: -0.2...0.2),  // Minimal vertical movement
            size: 1.5 + volumeLevel * 2.5 + CGFloat.random(in: 0...1),
            life: particleLife,
            maxLife: particleLife,
            color: isAnimating 
                ? NSColor(calibratedRed: 1.0, green: 0.231, blue: 0.188, alpha: 0.8)  // Semi-transparent red for recording
                : NSColor(calibratedWhite: 0.95, alpha: 0.8)  // Semi-transparent white for idle
        )
        particles.append(particle)
    }
    
    private func updateParticles(deltaTime: CGFloat) {
        // Update existing particles
        particles = particles.compactMap { particle in
            var p = particle
            p.update(deltaTime: deltaTime)
            
            // Only remove particles that are well past the edges or truly dead
            if p.life <= 0 || p.x < -50 || p.x > bounds.width + 50 {
                return nil
            }
            return p
        }
    }
    
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        
        // Draw particles with glow effect
        let context = NSGraphicsContext.current?.cgContext
        context?.saveGState()
        
        // Set up shadow for glow effect
        context?.setShadow(offset: .zero, blur: 3, color: NSColor.white.withAlphaComponent(0.3).cgColor)
        
        // Draw particles
        for particle in particles {
            let particleRect = NSRect(
                x: particle.x - particle.size / 2,
                y: particle.y - particle.size / 2,
                width: particle.size,
                height: particle.size
            )
            
            let particlePath = NSBezierPath(ovalIn: particleRect)
            particle.color.withAlphaComponent(particle.opacity).setFill()
            particlePath.fill()
        }
        
        context?.restoreGState()
        
        // Draw subtle connection lines between nearby particles
        let connectionDistance: CGFloat = 50.0  // Wider connections
        
        for i in 0..<particles.count {
            for j in (i + 1)..<particles.count {
                let p1 = particles[i]
                let p2 = particles[j]
                
                let distance = hypot(p2.x - p1.x, p2.y - p1.y)
                if distance < connectionDistance {
                    let connectionOpacity = (1.0 - distance / connectionDistance) * 0.1 * min(p1.opacity, p2.opacity)
                    
                    let path = NSBezierPath()
                    path.move(to: NSPoint(x: p1.x, y: p1.y))
                    path.line(to: NSPoint(x: p2.x, y: p2.y))
                    path.lineWidth = 0.5
                    
                    NSColor(white: 0.95, alpha: connectionOpacity).setStroke()
                    path.stroke()
                }
            }
        }
    }
}

// MARK: - Wide Overlay Panel Configuration

extension NativeOverlayPanel {
    // Configuration for wider particle overlay
    struct WideOverlayConfig {
        static let expandedWidth: CGFloat = 400  // Much wider
        static let expandedHeight: CGFloat = 60   // Slightly taller
        static let minimizedWidth: CGFloat = 300
        static let minimizedHeight: CGFloat = 40
        static let animationDuration: TimeInterval = 0.3
    }
    
    func configureForWideParticles() {
        // Set flag for wide particles mode
        isWideParticlesMode = true
        
        // Remove borders and background
        backgroundColor = NSColor.clear
        isOpaque = false
        hasShadow = false
        
        // Set wider frame (start minimized)
        setFrame(NSRect(
            x: frame.origin.x - (WideOverlayConfig.minimizedWidth - frame.width) / 2,
            y: frame.origin.y,
            width: WideOverlayConfig.minimizedWidth,
            height: WideOverlayConfig.minimizedHeight
        ), display: true)
    }
}