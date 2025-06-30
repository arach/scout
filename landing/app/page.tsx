"use client"

import { useState, useEffect } from "react"
import { Download, Github, Lock, Zap, Gift, PartyPopper } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Image from "next/image"
import Link from "next/link"

export default function Home() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 100)
    }
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  const handleDownload = () => {
    window.open("https://github.com/arach/scout/releases/download/v0.1.0/Scout_0.1.0_aarch64.dmg", "_blank")
  }

  return (
    <>
      {/* Header */}
      <header className={`fixed top-0 w-full z-50 transition-all duration-300 ${
        scrolled ? "bg-background/95 backdrop-blur-sm border-b" : "bg-background/80"
      }`}>
        <nav className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-primary-foreground font-bold">S</span>
              </div>
              <span className="text-xl font-semibold">Scout</span>
            </div>
            <div className="hidden md:flex items-center gap-6">
              <Link href="#features" className="text-muted-foreground hover:text-foreground transition-colors">
                Features
              </Link>
              <Link href="#download" className="text-muted-foreground hover:text-foreground transition-colors">
                Download
              </Link>
              <Link href="https://github.com/arach/scout" target="_blank" className="text-muted-foreground hover:text-foreground transition-colors">
                GitHub
              </Link>
            </div>
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center space-y-6">
            <h1 className="text-5xl md:text-7xl font-bold leading-tight">
              Local-First Voice Recording<br />
              <span className="bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                & Transcription
              </span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
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

      {/* Features Section */}
      <section id="features" className="py-20 px-6 bg-secondary/20">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Why Scout?</h2>
            <p className="text-muted-foreground">
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
              icon="📂"
              title="Transcript Database"
              description="All transcriptions saved locally with search, export, and management."
            />
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
              features={["Global hotkeys", "Auto-copy to clipboard", "Search transcripts"]}
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
    <div className="bg-card p-6 rounded-lg border hover:border-primary/50 transition-colors">
      <div className="text-3xl mb-4">{icon}</div>
      <h3 className="font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

function UseCase({ title, description, features }: { title: string; description: string; features: string[] }) {
  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
      <ul className="space-y-2">
        {features.map((feature, index) => (
          <li key={index} className="flex items-start gap-2 text-sm">
            <span className="text-primary mt-0.5">✓</span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}