"use client"

import { Download, Github, Lock, Zap, Gift, PartyPopper } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"

export default function Home() {
  const handleDownload = () => {
    window.open("https://github.com/arach/scout/releases/download/v0.1.0/Scout_0.1.0_aarch64.dmg", "_blank")
  }

  return (
    <>
      {/* Hero Section */}
      <section className="pt-16 pb-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center space-y-6">
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-tight text-gray-900 dark:text-white">
              Local-First Voice Recording<br />
              <span className="text-gray-900 dark:text-white">
                & Transcription
              </span>
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto leading-relaxed">
              Privacy-focused dictation that works entirely on your Mac.<br />
              No cloud, no subscriptions, no compromise.
            </p>
            <div className="flex items-center justify-center gap-4 pt-4">
              <Button size="lg" onClick={handleDownload}>
                <Download className="mr-2 h-4 w-4" />
                Download for macOS
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="https://github.com/arach/scout" target="_blank">
                  <Github className="mr-2 h-4 w-4" />
                  View on GitHub
                </Link>
              </Button>
            </div>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Badge variant="secondary" className="gap-1">
                <Lock className="h-3 w-3" />
                100% Private
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <Zap className="h-3 w-3" />
                Sub-300ms Latency
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <Gift className="h-3 w-3" />
                Open Weights Forever
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <PartyPopper className="h-3 w-3" />
                v0.1.0 Released
              </Badge>
            </div>
          </div>
        </div>
      </section>

      {/* Screenshot Showcase */}
      <section className="py-16 px-6 bg-gradient-to-b from-white to-gray-50 dark:from-gray-900 dark:to-gray-950">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight mb-4 text-gray-900 dark:text-white">See Scout in Action</h2>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              A powerful, native macOS experience designed for productivity
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 gap-8">
            {/* Main Window Screenshot */}
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-gray-600 to-gray-800 rounded-2xl blur opacity-10 group-hover:opacity-20 transition duration-300" />
              <div className="relative bg-white dark:bg-gray-900 rounded-2xl overflow-hidden h-96 border border-gray-200 dark:border-gray-800 shadow-2xl">
                {/* Window Chrome */}
                <div className="bg-gray-100 dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <div className="w-3 h-3 rounded-full bg-yellow-500" />
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <div className="flex-1 text-center">
                      <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Scout - Recording</span>
                    </div>
                  </div>
                </div>
                {/* Content Area */}
                <div className="p-8 h-full flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900">
                  <div className="text-center">
                    <div className="w-24 h-24 bg-gradient-to-br from-gray-700 to-gray-900 dark:from-gray-200 dark:to-gray-400 rounded-3xl mx-auto mb-6 flex items-center justify-center shadow-lg animate-pulse">
                      <span className="text-4xl text-white">🎙️</span>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Main Recording Interface</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Push-to-talk recording with real-time feedback</p>
                    <div className="mt-6 inline-flex items-center gap-2 px-3 py-1.5 bg-gray-200 dark:bg-gray-700 rounded-full">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      <span className="text-xs text-gray-600 dark:text-gray-300">Ready to record</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Overlay Screenshot */}
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-gray-800 to-gray-600 rounded-2xl blur opacity-10 group-hover:opacity-20 transition duration-300" />
              <div className="relative bg-white dark:bg-gray-900 rounded-2xl overflow-hidden h-96 border border-gray-200 dark:border-gray-800 shadow-2xl">
                {/* Desktop Background Simulation */}
                <div className="relative h-full bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 dark:from-gray-800 dark:via-gray-900 dark:to-gray-800">
                  {/* Floating Overlay Window */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transform">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 w-80">
                      {/* Recording Status */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-red-600 rounded-xl flex items-center justify-center animate-pulse">
                            <span className="text-2xl text-white">🎤</span>
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">Recording...</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">00:00:03</p>
                          </div>
                        </div>
                        <button className="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                          <span className="text-sm">✕</span>
                        </button>
                      </div>
                      {/* Waveform Visualization */}
                      <div className="flex items-center justify-center gap-1 h-12">
                        {[...Array(20)].map((_, i) => (
                          <div
                            key={i}
                            className="w-1 bg-gray-600 dark:bg-gray-400 rounded-full animate-pulse"
                            style={{
                              height: `${30 + (i % 3) * 20 + ((i % 5) * 10)}%`,
                              animationDelay: `${i * 0.05}s`
                            }}
                          />
                        ))}
                      </div>
                      {/* Shortcut Hint */}
                      <div className="mt-4 text-center">
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Press <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">⌘⇧Space</kbd> to stop
                        </p>
                      </div>
                    </div>
                  </div>
                  {/* Background App Icons */}
                  <div className="absolute top-8 left-8 opacity-20">
                    <div className="w-16 h-16 bg-gray-400 dark:bg-gray-600 rounded-2xl" />
                  </div>
                  <div className="absolute top-8 right-8 opacity-20">
                    <div className="w-16 h-16 bg-gray-400 dark:bg-gray-600 rounded-2xl" />
                  </div>
                  <div className="absolute bottom-8 left-8 opacity-20">
                    <div className="w-16 h-16 bg-gray-400 dark:bg-gray-600 rounded-2xl" />
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Feature highlights */}
          <div className="grid md:grid-cols-3 gap-6 mt-12">
            <div className="group cursor-pointer">
              <div className="relative">
                <div className="absolute -inset-0.5 bg-gray-400 rounded-xl blur opacity-0 group-hover:opacity-10 transition duration-300" />
                <div className="relative w-48 h-32 bg-white dark:bg-gray-800 rounded-xl mx-auto mb-4 flex items-center justify-center border border-gray-200 dark:border-gray-700 group-hover:border-gray-400 dark:group-hover:border-gray-600 transition-colors">
                  <div className="text-center">
                    <span className="text-3xl mb-2 block">📝</span>
                    <div className="flex items-center gap-1 justify-center">
                      <div className="w-8 h-0.5 bg-gray-300 dark:bg-gray-600 rounded" />
                      <div className="w-12 h-0.5 bg-gray-300 dark:bg-gray-600 rounded" />
                      <div className="w-6 h-0.5 bg-gray-300 dark:bg-gray-600 rounded" />
                    </div>
                  </div>
                </div>
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">Transcript Management</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Search, edit, and export your transcripts</p>
            </div>
            
            <div className="group cursor-pointer">
              <div className="relative">
                <div className="absolute -inset-0.5 bg-gray-400 rounded-xl blur opacity-0 group-hover:opacity-10 transition duration-300" />
                <div className="relative w-48 h-32 bg-white dark:bg-gray-800 rounded-xl mx-auto mb-4 flex items-center justify-center border border-gray-200 dark:border-gray-700 group-hover:border-gray-400 dark:group-hover:border-gray-600 transition-colors">
                  <div className="flex items-center gap-0.5">
                    {[...Array(5)].map((_, i) => (
                      <div
                        key={i}
                        className="w-1.5 bg-gradient-to-t from-gray-500 to-gray-700 dark:from-gray-400 dark:to-gray-300 rounded-full"
                        style={{
                          height: `${20 + Math.sin(i) * 15}px`,
                          opacity: 0.6 + (i * 0.1)
                        }}
                      />
                    ))}
                    <span className="text-2xl ml-2">⚡</span>
                  </div>
                </div>
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">Real-time Processing</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">See your words appear as you speak</p>
            </div>
            
            <div className="group cursor-pointer">
              <div className="relative">
                <div className="absolute -inset-0.5 bg-gray-400 rounded-xl blur opacity-0 group-hover:opacity-10 transition duration-300" />
                <div className="relative w-48 h-32 bg-white dark:bg-gray-800 rounded-xl mx-auto mb-4 flex items-center justify-center border border-gray-200 dark:border-gray-700 group-hover:border-gray-400 dark:group-hover:border-gray-600 transition-colors">
                  <div className="grid grid-cols-3 gap-1">
                    <div className="w-4 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
                    <div className="w-4 h-4 bg-gray-300 dark:bg-gray-600 rounded" />
                    <div className="w-4 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
                    <div className="w-4 h-4 bg-gray-300 dark:bg-gray-600 rounded" />
                    <div className="w-4 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
                    <div className="w-4 h-4 bg-gray-300 dark:bg-gray-600 rounded" />
                  </div>
                </div>
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">Native Design</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Feels right at home on your Mac</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-16 px-6 bg-gray-50 dark:bg-gray-900/50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold tracking-tight mb-4 text-gray-900 dark:text-white">Why Scout?</h2>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              The voice transcription app that respects your privacy and your time.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            <FeatureCard
              icon="🔒"
              title="100% Private"
              description="Everything runs locally on your device. Your voice never leaves your Mac."
            />
            <FeatureCard
              icon="⚡"
              title="Lightning Fast"
              description="Sub-300ms latency with optimized processing. Real-time transcription that keeps up."
            />
            <FeatureCard
              icon="🎯"
              title="Power User Ready"
              description="Global shortcuts, file upload, export options. Built for professionals."
            />
            <FeatureCard
              icon="🎙️"
              title="Push-to-Talk"
              description="Simple global hotkey (Cmd+Shift+Space) for instant recording anywhere."
            />
            <FeatureCard
              icon="🧠"
              title="Whisper AI"
              description="Powered by OpenAI's Whisper models. Choose from tiny to large-v3."
            />
            <FeatureCard
              icon="📖"
              title="Custom Dictionary"
              description="Auto-correct technical terms, acronyms, and names with smart replacements."
            />
            <FeatureCard
              icon="📂"
              title="Transcript Database"
              description="All transcriptions saved locally with search, export, and management."
            />
          </div>
        </div>
      </section>

      {/* Dictionary Feature Section */}
      <section className="py-20 px-6 bg-gradient-to-b from-white to-gray-50 dark:from-gray-950 dark:to-gray-900">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-4xl font-bold mb-4 text-gray-900 dark:text-white">
                Your Words, Your Way
              </h2>
              <p className="text-xl text-gray-600 dark:text-gray-400 mb-6">
                Teach Scout your vocabulary. Custom dictionaries ensure technical terms, company names, and industry jargon are always transcribed perfectly.
              </p>
              
              <div className="space-y-4 mb-8">
                <div className="flex items-start gap-3">
                  <div className="text-2xl mt-1">⚡</div>
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Instant Updates</h3>
                    <p className="text-gray-600 dark:text-gray-400">No training required. Add a word, and it works immediately.</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <div className="text-2xl mt-1">📊</div>
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Usage Analytics</h3>
                    <p className="text-gray-600 dark:text-gray-400">Track which corrections matter most with detailed replacement history.</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <div className="text-2xl mt-1">🎯</div>
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Smart Matching</h3>
                    <p className="text-gray-600 dark:text-gray-400">Four match types: exact, word boundaries, phrases, and regex patterns.</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-sm text-gray-700 dark:text-gray-300">Medical Terms</span>
                <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-sm text-gray-700 dark:text-gray-300">Legal Jargon</span>
                <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-sm text-gray-700 dark:text-gray-300">Tech Acronyms</span>
                <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-sm text-gray-700 dark:text-gray-300">Brand Names</span>
              </div>
            </div>
            
            <div className="relative">
              <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl p-6 border border-gray-200 dark:border-gray-800">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Dictionary Examples</h3>
                <div className="space-y-3 font-mono text-sm">
                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <span className="text-gray-600 dark:text-gray-400">"api"</span>
                    <span className="text-gray-400 dark:text-gray-500">→</span>
                    <span className="text-gray-900 dark:text-white font-semibold">"API"</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <span className="text-gray-600 dark:text-gray-400">"acme"</span>
                    <span className="text-gray-400 dark:text-gray-500">→</span>
                    <span className="text-gray-900 dark:text-white font-semibold">"ACME Corporation"</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <span className="text-gray-600 dark:text-gray-400">"ml"</span>
                    <span className="text-gray-400 dark:text-gray-500">→</span>
                    <span className="text-gray-900 dark:text-white font-semibold">"machine learning"</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <span className="text-gray-600 dark:text-gray-400">"dx"</span>
                    <span className="text-gray-400 dark:text-gray-500">→</span>
                    <span className="text-gray-900 dark:text-white font-semibold">"diagnosis"</span>
                  </div>
                </div>
                
                <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-sm text-blue-800 dark:text-blue-300">
                    <strong>Before:</strong> "The new api for acme is ready"<br/>
                    <strong>After:</strong> "The new API for ACME Corporation is ready"
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section className="py-20 px-6">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Who is Scout for?</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <UseCase
              title="Content Creators"
              description="Quickly transcribe ideas for videos, podcasts, or social media posts."
              features={["Voice-to-text for scripts", "Export to markdown", "Batch file processing"]}
            />
            <UseCase
              title="Professionals"
              description="Capture meeting notes, dictate emails, and document thoughts instantly."
              features={["Global hotkeys", "Auto-copy to clipboard", "Custom dictionaries"]}
            />
            <UseCase
              title="Writers & Students"
              description="Transform spoken thoughts into written words for essays, notes, or brainstorming."
              features={["Real-time transcription", "Multiple export formats", "Offline access"]}
            />
          </div>
        </div>
      </section>

      {/* Download Section */}
      <section id="download" className="py-20 px-6 bg-secondary/20">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to Start?</h2>
          <p className="text-muted-foreground mb-8">
            Download Scout v0.1.0 and experience the future of voice transcription
          </p>
          <div className="mb-8">
            <Button size="lg" onClick={handleDownload} className="gap-2">
              <Download className="h-5 w-5" />
              Download for macOS (v0.1.0)
            </Button>
          </div>
          <div className="bg-card rounded-lg p-6 inline-block text-left">
            <h4 className="font-semibold mb-3">System Requirements</h4>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>• macOS 11.0 or later</li>
              <li>• Apple Silicon or Intel Mac</li>
              <li>• 4GB RAM minimum</li>
              <li>• 500MB-5GB storage (depending on models)</li>
            </ul>
            <p className="text-xs text-muted-foreground mt-3">
              Current release: v0.1.0 (Apple Silicon)
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t">
        <div className="container mx-auto max-w-6xl">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-sm text-muted-foreground">
              © 2025 Scout. Privacy-first voice transcription.
            </div>
            <div className="flex items-center gap-6">
              <Link href="https://github.com/arach/scout" target="_blank" className="text-muted-foreground hover:text-foreground transition-colors">
                <Github className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </>
  )
}

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-gray-400 dark:hover:border-gray-600 transition-all hover:shadow-md">
      <div className="text-3xl mb-4">{icon}</div>
      <h3 className="font-semibold text-lg mb-2 text-gray-900 dark:text-white">{title}</h3>
      <p className="text-gray-600 dark:text-gray-400 leading-relaxed">{description}</p>
    </div>
  )
}

function UseCase({ title, description, features }: { title: string; description: string; features: string[] }) {
  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold text-gray-900 dark:text-white">{title}</h3>
      <p className="text-gray-600 dark:text-gray-400 leading-relaxed">{description}</p>
      <ul className="space-y-2">
        {features.map((feature, index) => (
          <li key={index} className="flex items-start gap-2 text-gray-600 dark:text-gray-400">
            <span className="text-gray-700 dark:text-gray-300 mt-0.5">✓</span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}