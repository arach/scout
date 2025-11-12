"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScoutLogo } from "@/components/scout-logo"
import Header from "@/components/header"
import { ClientDevBar } from "@/components/client-devbar"
import { Mic, Download, Github, Shield, Zap, Infinity, Star } from "lucide-react"

export default function LandingPage() {
  const [showBackdrop, setShowBackdrop] = useState(true)
  const [opacity, setOpacity] = useState(90)
  const [blur, setBlur] = useState(15)
  const [videoOpacity, setVideoOpacity] = useState(40)
  const [shadowOpacity, setShadowOpacity] = useState(40)
  const [theme, setTheme] = useState<'cream' | 'dark' | 'blue'>('cream')
  const [mounted, setMounted] = useState(false)
  const [isHoveringWhyScout, setIsHoveringWhyScout] = useState(false)
  const [isHoveringReady, setIsHoveringReady] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const themes = {
    cream: {
      bg: 'rgb(251,248,241)',
      shadow: 'rgba(194,154,108,0.15)',
    },
    dark: {
      bg: 'rgb(42,39,35)',
      shadow: 'rgba(28,25,22,0.4)',
    },
    blue: {
      bg: 'rgb(243,244,246)',
      shadow: 'rgba(147,157,173,0.2)',
    },
  }

  const handleDownload = () => {
    window.open("https://github.com/arach/scout/releases/download/v0.1.0/Scout_0.1.0_aarch64.dmg", "_blank")
  }

  // Return minimal shell during SSR to avoid hydration issues with icons
  if (!mounted) {
    return <div className="min-h-screen bg-background" />
  }

  return (
    <div className="min-h-screen" style={{
      backgroundColor: '#FDFCF8'
    }}>
      <Header />

      {/* Hero Section */}
      <section className="relative h-[400px] lg:h-[500px]" style={{
        background: `linear-gradient(135deg, rgba(245,240,230,0.92) 0%, rgba(250,247,240,0.92) 50%, rgba(240,232,220,0.92) 100%), url('/japanese-paper-texture.png')`,
        backgroundSize: 'auto, 800px 800px',
        backgroundRepeat: 'repeat',
        backgroundBlendMode: 'normal'
      }}>
        <div className="relative container mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20 h-full flex items-center">
          {/* Backdrop blur behind content */}
          {showBackdrop && (
            <div
              className="absolute inset-x-0 top-12 bottom-12 max-w-5xl mx-auto rounded-2xl"
              style={{
                backgroundColor: themes[theme].bg,
                opacity: opacity / 100,
                backdropFilter: `blur(${blur}px)`,
                WebkitBackdropFilter: `blur(${blur}px)`,
                boxShadow: `0 20px 40px ${themes[theme].shadow.replace('0.4', String(shadowOpacity/100))}`
              }}
            />
          )}

          <div className="text-center max-w-4xl mx-auto relative z-10 pt-8">
            <h1 className="font-serif font-semibold text-4xl sm:text-5xl lg:text-6xl text-foreground mb-6">
              Private Dictation <span className="text-primary">for macOS</span>
            </h1>
            <p className="font-sans text-xs sm:text-sm text-muted-foreground mb-8 max-w-2xl mx-auto font-light">
              Professional-grade transcription that runs entirely on your Mac. No cloud, no subscriptions, no data collection. Just accurate, local speech-to-text that respects your privacy.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
              <Button
                size="lg"
                onClick={handleDownload}
                className="font-sans font-medium text-sm px-8 bg-foreground text-background hover:bg-foreground/90 cursor-pointer"
              >
                <Download className="w-4 h-4 mr-2" suppressHydrationWarning />
                Download for macOS
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="font-sans font-normal text-sm px-8 bg-background border-foreground text-foreground hover:bg-foreground hover:text-background cursor-pointer"
                onClick={() => window.open('https://github.com/arach/scout', '_blank')}
              >
                <Github className="w-4 h-4 mr-2" suppressHydrationWarning />
                View on GitHub
              </Button>
            </div>

            <div className="flex flex-wrap justify-center gap-3 mb-16">
              <Badge variant="outline" className="font-sans text-xs px-3 py-1.5 font-normal border-muted-foreground/20 bg-muted/30 rounded-full">
                <Shield className="w-3 h-3 mr-1.5" suppressHydrationWarning />
                100% Private
              </Badge>
              <Badge variant="outline" className="font-sans text-xs px-3 py-1.5 font-normal border-muted-foreground/20 bg-muted/30 rounded-full">
                <Zap className="w-3 h-3 mr-1.5" suppressHydrationWarning />
                Sub-300ms Latency
              </Badge>
              <Badge variant="outline" className="font-sans text-xs px-3 py-1.5 font-normal border-muted-foreground/20 bg-muted/30 rounded-full">
                <Infinity className="w-3 h-3 mr-1.5" suppressHydrationWarning />
                Open Weights Forever
              </Badge>
              <Badge variant="outline" className="font-sans text-xs px-3 py-1.5 font-normal border-muted-foreground/20 bg-muted/30 rounded-full">
                <Star className="w-3 h-3 mr-1.5" suppressHydrationWarning />
                v0.1.0 Released
              </Badge>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 relative" style={{
        backgroundColor: '#FFFEF9',
        borderTop: '1px solid #E8DDD0',
        position: 'relative'
      }}>
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: `url('/japanese-paper-two.png')`,
          backgroundSize: 'cover',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
          opacity: 0.08,
          filter: 'saturate(0.3)',
          pointerEvents: 'none'
        }} />
        <div className="relative container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="font-serif font-semibold text-3xl sm:text-4xl text-foreground mb-4">Built for Mac Users Who Value Privacy</h2>
            <p className="font-sans text-xs sm:text-sm text-muted-foreground max-w-2xl mx-auto font-light">
              Swift modules for deep macOS integration. Tauri runtime for performance. Whisper models for accuracy. System-wide hotkeys, menu bar access, fully offline.
            </p>
          </div>

          <div className="max-w-6xl mx-auto">
            <div className="grid md:grid-cols-2 gap-8">
              {/* Main Recording Interface */}
              <div className="rounded-2xl h-80" style={{
                backgroundColor: '#FDFBF7',
                border: '1px solid #D4C4B0',
                boxShadow: '0 10px 40px rgba(139, 105, 87, 0.08)',
                paddingTop: '6px'
              }}>
                <div className="flex items-center gap-1.5 px-4 pb-4">
                  <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                  <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <span className="font-sans text-sm text-muted-foreground ml-3"><ScoutLogo size="sm" showIcon={false} className="inline" /> - Recording</span>
                </div>

                <div className="flex items-center justify-center px-8" style={{ height: 'calc(100% - 40px)' }}>
                  <div className="text-center">
                    <div className="w-16 h-16 bg-muted rounded-xl flex items-center justify-center mx-auto mb-4">
                      <Mic className="w-8 h-8 text-muted-foreground" suppressHydrationWarning />
                    </div>
                    <p className="font-sans text-muted-foreground text-sm">Main Recording Interface</p>
                  </div>
                </div>
              </div>

              {/* Recording Notification */}
              <div className="rounded-2xl h-80" style={{
                backgroundColor: '#FDFBF7',
                border: '1px solid #D4C4B0',
                boxShadow: '0 10px 40px rgba(139, 105, 87, 0.08)',
                paddingTop: '6px'
              }}>
                <div className="flex items-center gap-1.5 px-4 pb-4">
                  <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                  <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <span className="font-sans text-sm text-muted-foreground ml-3"><ScoutLogo size="sm" showIcon={false} className="inline" /> - Recording Indicator</span>
                </div>

                <div className="flex items-center justify-center px-8" style={{ height: 'calc(100% - 40px)' }}>
                  <div className="text-center">
                    <div className="w-16 h-16 bg-primary/20 rounded-xl flex items-center justify-center mx-auto mb-4">
                      <ScoutLogo size="base" showIcon={true} className="justify-center" textClassName="hidden" />
                    </div>
                    <p className="font-sans text-muted-foreground text-sm">Recording Notification</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Why Scout Section */}
      <section
        className="py-20 px-6 relative"
        style={{
          backgroundColor: '#FBF9F5',
          borderTop: '1px solid #E8DDD0',
          position: 'relative'
        }}
        onMouseEnter={() => setIsHoveringWhyScout(true)}
        onMouseLeave={() => setIsHoveringWhyScout(false)}
      >
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: `url('/japanese-paper-two.png')`,
          backgroundSize: 'cover',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center top',
          opacity: 0.01,
          filter: 'saturate(0.2)',
          pointerEvents: 'none'
        }} />
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '5%',
          transform: 'translateY(-50%)',
          width: '450px',
          height: '450px',
          backgroundImage: `url('/scout-assistant-drawing.png')`,
          backgroundSize: 'contain',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
          opacity: isHoveringWhyScout ? 0.08 : 0,
          filter: 'saturate(0.3)',
          pointerEvents: 'none',
          transition: 'opacity 3s cubic-bezier(0.25, 0.1, 0.25, 1)'
        }} />
        <div className="container mx-auto max-w-5xl relative z-10">
          <div className="text-center mb-12">
            <h2 className="font-serif font-semibold text-3xl sm:text-4xl text-foreground mb-4">Why Scout?</h2>
            <p className="font-sans text-xs sm:text-sm text-muted-foreground max-w-2xl mx-auto font-light">
              The voice transcription app that respects your privacy and your time.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: '🔒', title: '100% Private', description: 'Everything runs locally on your device. Your voice never leaves your Mac.' },
              { icon: '⚡', title: 'Lightning Fast', description: 'Sub-300ms latency with optimized processing. Real-time transcription that keeps up.' },
              { icon: '🎯', title: 'Power User Ready', description: 'Global shortcuts, file upload, export options. Built for professionals.' },
              { icon: '🎙️', title: 'Push-to-Talk', description: 'Simple global hotkey (Cmd+Shift+Space) for instant recording anywhere.' },
              { icon: '🧠', title: 'Whisper AI', description: 'Powered by OpenAI\'s Whisper models. Choose from tiny to large-v3.' },
              { icon: '📖', title: 'Custom Dictionary', description: 'Auto-correct technical terms, acronyms, and names with smart replacements.' },
            ].map((feature, index) => (
              <div key={index} className="p-6 rounded-xl transition-all hover:shadow-lg hover:scale-105 transform" style={{
                backgroundColor: '#FDFBF7',
                border: '1px solid #D4C4B0',
                boxShadow: '0 4px 20px rgba(139, 105, 87, 0.05)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#C2996C';
                e.currentTarget.style.boxShadow = '0 8px 30px rgba(139, 105, 87, 0.12)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#D4C4B0';
                e.currentTarget.style.boxShadow = '0 4px 20px rgba(139, 105, 87, 0.05)';
              }}>
                <div className="text-3xl mb-4">{feature.icon}</div>
                <h3 className="font-serif font-semibold text-lg mb-2 text-foreground">{feature.title}</h3>
                <p className="font-sans text-xs text-muted-foreground leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Your Words Your Way Section */}
      <section className="py-20 px-6" style={{
        background: `linear-gradient(to bottom, rgba(255,254,249,0.95), rgba(255,254,249,0.95)), url('/japanese-paper-texture.png')`,
        backgroundSize: 'auto, 1200px 1200px',
        backgroundRepeat: 'repeat',
        borderTop: '1px solid #E8DDD0'
      }}>
        <div className="container mx-auto max-w-6xl">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="font-serif font-semibold text-3xl sm:text-4xl text-foreground mb-4">
                Your Words, Your Way
              </h2>
              <p className="font-sans text-sm text-muted-foreground mb-6 font-light">
                Teach Scout your vocabulary. Custom dictionaries ensure technical terms, company names, and industry jargon are always transcribed perfectly.
              </p>

              <div className="space-y-4 mb-8">
                <div className="flex items-start gap-3">
                  <div className="text-2xl mt-1">⚡</div>
                  <div>
                    <h3 className="font-sans font-semibold text-foreground mb-1">Instant Updates</h3>
                    <p className="font-sans text-xs text-muted-foreground">No training required. Add a word, and it works immediately.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="text-2xl mt-1">📊</div>
                  <div>
                    <h3 className="font-sans font-semibold text-foreground mb-1">Usage Analytics</h3>
                    <p className="font-sans text-xs text-muted-foreground">Track which corrections matter most with detailed replacement history.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="text-2xl mt-1">🎯</div>
                  <div>
                    <h3 className="font-sans font-semibold text-foreground mb-1">Smart Matching</h3>
                    <p className="font-sans text-xs text-muted-foreground">Four match types: exact, word boundaries, phrases, and regex patterns.</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                {['Medical Terms', 'Legal Jargon', 'Tech Acronyms', 'Brand Names'].map((tag) => (
                  <span key={tag} className="px-3 py-1 rounded-full text-xs" style={{
                    backgroundColor: '#F5F0E6',
                    color: '#8B6F47',
                    border: '1px solid #E8DDD0'
                  }}>{tag}</span>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="rounded-xl shadow-xl p-6" style={{
                backgroundColor: '#FDFBF7',
                border: '1px solid #D4C4B0',
                boxShadow: '0 10px 40px rgba(139, 105, 87, 0.08)'
              }}>
                <h3 className="font-serif font-semibold text-foreground mb-4">Dictionary Examples</h3>
                <div className="space-y-3 font-mono text-sm">
                  {[
                    { from: '"api"', to: '"API"' },
                    { from: '"acme"', to: '"ACME Corporation"' },
                    { from: '"ml"', to: '"machine learning"' },
                    { from: '"dx"', to: '"diagnosis"' }
                  ].map((example, index) => (
                    <div key={index} className="flex items-center justify-between p-3 rounded-lg" style={{
                      backgroundColor: '#F5F0E6'
                    }}>
                      <span style={{ color: '#A68B5B' }}>{example.from}</span>
                      <span style={{ color: '#C2996C' }}>→</span>
                      <span className="font-semibold text-foreground">{example.to}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-6 p-4 rounded-lg" style={{
                  backgroundColor: 'rgba(194, 154, 108, 0.1)',
                  border: '1px solid rgba(194, 154, 108, 0.3)'
                }}>
                  <p className="text-xs" style={{ color: '#8B6F47' }}>
                    <strong>Before:</strong> "The new api for acme is ready"<br/>
                    <strong>After:</strong> "The new API for ACME Corporation is ready"
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Who is Scout for Section */}
      <section className="py-20 px-6 relative" style={{
        backgroundColor: '#FBF9F5',
        borderTop: '1px solid #E8DDD0',
        position: 'relative'
      }}>
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: `url('/japanese-paper-two.png')`,
          backgroundSize: 'cover',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center bottom',
          opacity: 0.05,
          filter: 'saturate(0.1)',
          pointerEvents: 'none'
        }} />
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="font-serif font-semibold text-3xl sm:text-4xl text-foreground mb-4">Who is Scout for?</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: 'Content Creators',
                description: 'Quickly transcribe ideas for videos, podcasts, or social media posts.',
                features: ['Voice-to-text for scripts', 'Export to markdown', 'Batch file processing']
              },
              {
                title: 'Professionals',
                description: 'Capture meeting notes, dictate emails, and document thoughts instantly.',
                features: ['Global hotkeys', 'Auto-copy to clipboard', 'Custom dictionaries']
              },
              {
                title: 'Writers & Students',
                description: 'Transform spoken thoughts into written words for essays, notes, or brainstorming.',
                features: ['Real-time transcription', 'Multiple export formats', 'Offline access']
              }
            ].map((useCase, index) => (
              <div key={index} className="space-y-4">
                <h3 className="font-serif font-semibold text-xl text-foreground">{useCase.title}</h3>
                <p className="font-sans text-xs text-muted-foreground leading-relaxed">{useCase.description}</p>
                <ul className="space-y-2">
                  {useCase.features.map((feature, fIndex) => (
                    <li key={fIndex} className="flex items-start gap-2 font-sans text-xs text-muted-foreground">
                      <span style={{ color: '#C2996C' }} className="mt-0.5">✓</span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-6" style={{
        background: `linear-gradient(to bottom, rgba(255,254,249,0.95), rgba(255,254,249,0.95)), url('/japanese-paper-texture.png')`,
        backgroundSize: 'auto, 1200px 1200px',
        backgroundRepeat: 'repeat',
        borderTop: '1px solid #E8DDD0'
      }}>
        <div className="container mx-auto max-w-4xl">
          <div className="text-center mb-12">
            <h2 className="font-serif font-semibold text-3xl sm:text-4xl text-foreground mb-4">Simple, Honest Pricing</h2>
            <p className="font-sans text-xs sm:text-sm text-muted-foreground max-w-2xl mx-auto font-light">
              Pay once, own forever. No subscriptions, no hidden fees, no data harvesting.
            </p>
          </div>

          <div className="max-w-md mx-auto">
            <div className="rounded-2xl p-8 shadow-xl" style={{
              backgroundColor: '#FDFBF7',
              border: '2px solid #C2996C',
              boxShadow: '0 20px 60px rgba(139, 105, 87, 0.15)'
            }}>
              <div className="text-center mb-6">
                <h3 className="font-serif font-semibold text-2xl text-foreground mb-2">Scout</h3>
                <div className="flex items-baseline justify-center gap-2 mb-4">
                  <span className="font-serif font-bold text-5xl text-foreground">$29</span>
                  <span className="font-sans text-sm text-muted-foreground">one-time</span>
                </div>
                <p className="font-sans text-xs text-muted-foreground">Lifetime updates included</p>
              </div>

              <div className="space-y-3 mb-8">
                {[
                  'Unlimited transcriptions',
                  'All Whisper models (tiny to large-v3)',
                  'Custom dictionaries',
                  'System-wide hotkeys',
                  'Export to multiple formats',
                  'Lifetime updates',
                  'No recurring fees',
                  '100% private & offline'
                ].map((feature, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <span style={{ color: '#C2996C' }} className="mt-0.5">✓</span>
                    <span className="font-sans text-sm text-foreground">{feature}</span>
                  </div>
                ))}
              </div>

              <Button
                size="lg"
                onClick={handleDownload}
                className="w-full font-sans font-medium text-sm bg-foreground text-background hover:bg-foreground/90 cursor-pointer"
              >
                <Download className="w-4 h-4 mr-2" suppressHydrationWarning />
                Buy Scout for $29
              </Button>

              <p className="font-sans text-xs text-center text-muted-foreground mt-4">
                30-day money-back guarantee
              </p>
            </div>

            <div className="mt-8 p-4 rounded-lg text-center" style={{
              backgroundColor: 'rgba(194, 154, 108, 0.1)',
              border: '1px solid rgba(194, 154, 108, 0.3)'
            }}>
              <p className="font-sans text-xs" style={{ color: '#8B6F47' }}>
                <strong>Early Access:</strong> Get Scout at $29 during beta. Price increases to $39 at v1.0 launch.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Ready to Start Section */}
      <section
        className="py-20 px-6 relative"
        style={{
          background: `linear-gradient(to right, rgba(255,254,249,0.93), rgba(255,254,249,0.97)), url('/japanese-paper-texture.png')`,
          backgroundSize: 'auto, 1000px 1000px',
          backgroundRepeat: 'repeat',
          backgroundPosition: 'center',
          borderTop: '1px solid #E8DDD0',
          position: 'relative'
        }}
        onMouseEnter={() => setIsHoveringReady(true)}
        onMouseLeave={() => setIsHoveringReady(false)}
      >
        <video
          autoPlay
          loop
          muted
          playsInline
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: isHoveringReady ? 0.08 : 0,
            filter: 'saturate(0.5)',
            pointerEvents: 'none',
            transition: 'opacity 3s cubic-bezier(0.25, 0.1, 0.25, 1)',
            zIndex: 0
          }}
        >
          <source src="/scout-ink.mp4" type="video/mp4" />
        </video>
        <div className="container mx-auto max-w-4xl text-center relative z-10">
          <h2 className="font-serif font-semibold text-3xl sm:text-4xl text-foreground mb-4">Ready to Start?</h2>
          <p className="font-sans text-xs sm:text-sm text-muted-foreground mb-8 font-light">
            Download Scout v0.1.0 and experience the future of voice transcription
          </p>
          <div className="mb-8">
            <Button
              size="lg"
              onClick={handleDownload}
              className="font-sans font-medium text-sm px-8 bg-foreground text-background hover:bg-foreground/90 cursor-pointer"
            >
              <Download className="w-4 h-4 mr-2" suppressHydrationWarning />
              Download for macOS (v0.1.0)
            </Button>
          </div>
          <div className="inline-block text-left p-6 rounded-lg" style={{
            backgroundColor: '#FDFBF7',
            border: '1px solid #D4C4B0'
          }}>
            <h4 className="font-sans font-semibold mb-3 text-foreground">System Requirements</h4>
            <ul className="space-y-1 font-sans text-xs text-muted-foreground">
              <li>• macOS 11.0 or later</li>
              <li>• Apple Silicon or Intel Mac</li>
              <li>• 4GB RAM minimum</li>
              <li>• 500MB-5GB storage (depending on models)</li>
            </ul>
            <p className="font-sans text-xs mt-3" style={{ color: '#A68B5B' }}>
              Current release: v0.1.0 (Apple Silicon)
            </p>
          </div>
        </div>
      </section>

      {/* Footer section */}
      <footer className="py-16" style={{
        background: `linear-gradient(to top, rgba(250,248,243,0.98), rgba(250,248,243,0.92)), url('/japanese-paper-texture.png')`,
        backgroundSize: 'auto, 1300px 1300px',
        backgroundRepeat: 'repeat',
        borderTop: '1px solid #E8DDD0'
      }}>
        <div className="relative container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-center space-y-4">
            <ScoutLogo size="lg" />
            <p className="font-sans text-xs" style={{ color: '#8B6F47' }}>
              © 2025 Scout. Dictation without compromise.
            </p>
            <div className="flex space-x-6">
              <a href="#" className="font-sans text-xs transition-colors" style={{
                color: '#A68B5B'
              }} onMouseEnter={(e) => e.currentTarget.style.color = '#6B5D4F'}
                 onMouseLeave={(e) => e.currentTarget.style.color = '#A68B5B'}>
                Privacy
              </a>
              <a href="#" className="font-sans text-xs transition-colors" style={{
                color: '#A68B5B'
              }} onMouseEnter={(e) => e.currentTarget.style.color = '#6B5D4F'}
                 onMouseLeave={(e) => e.currentTarget.style.color = '#A68B5B'}>
                Terms
              </a>
              <a href="#" className="font-sans text-xs transition-colors" style={{
                color: '#A68B5B'
              }} onMouseEnter={(e) => e.currentTarget.style.color = '#6B5D4F'}
                 onMouseLeave={(e) => e.currentTarget.style.color = '#A68B5B'}>
                Documentation
              </a>
              <a href="https://github.com/arach/scout" target="_blank" rel="noopener noreferrer" className="font-sans text-xs transition-colors" style={{
                color: '#A68B5B'
              }} onMouseEnter={(e) => e.currentTarget.style.color = '#6B5D4F'}
                 onMouseLeave={(e) => e.currentTarget.style.color = '#A68B5B'}>
                GitHub
              </a>
            </div>
          </div>
        </div>
      </footer>

      <ClientDevBar
        opacity={opacity}
        setOpacity={setOpacity}
        blur={blur}
        setBlur={setBlur}
        showBackdrop={showBackdrop}
        setShowBackdrop={setShowBackdrop}
        videoOpacity={videoOpacity}
        setVideoOpacity={setVideoOpacity}
        shadowOpacity={shadowOpacity}
        setShadowOpacity={setShadowOpacity}
        theme={theme}
        setTheme={setTheme}
      />
    </div>
  )
}
