"use client"

import { useState } from "react"
import Link from "next/link"
import type { Metadata } from "next"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { 
  ArrowRight, 
  Download, 
  Terminal, 
  Cpu, 
  Zap, 
  Shield,
  BookOpen,
  ChevronRight,
  AlertCircle,
  CheckCircle,
  Copy,
  Check
} from "lucide-react"
import { PrismCode } from "@/components/prism-code"

// Code block component with copy functionality
function CodeBlock({ code, language = "bash", className = "" }: { code: string; language?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  
  return (
    <div className={`relative group ${className}`}>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={handleCopy}
      >
        {copied ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </Button>
      <PrismCode code={code} language={language} />
    </div>
  )
}

export default function TranscriberDocsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 py-4">
          <nav className="flex items-center space-x-4 text-sm">
            <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
              Home
            </Link>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <Link href="/docs" className="text-muted-foreground hover:text-foreground transition-colors">
              Docs
            </Link>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <span className="text-foreground font-medium">Transcriber Service</span>
          </nav>
        </div>
      </div>

      {/* Hero Section */}
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2 mb-4">
            <Badge variant="outline" className="text-blue-600 border-blue-600 bg-blue-600/10 hover:bg-blue-600/20 transition-colors">
              Advanced
            </Badge>
            <Badge variant="outline" className="text-green-600 border-green-600 bg-green-600/10 hover:bg-green-600/20 transition-colors">
              Optional Service
            </Badge>
          </div>
          
          <h1 className="text-4xl font-bold tracking-tight mb-4">
            Scout Transcriber Service
          </h1>
          
          <p className="text-xl text-muted-foreground mb-8">
            Extend Scout's built-in transcription with advanced AI models including Parakeet (NVIDIA), 
            Wav2Vec2 (Facebook), and distributed processing via ZeroMQ.
          </p>

          {/* Quick Install */}
          <Card className="mb-8 border-2 border-blue-500/30 bg-gradient-to-br from-blue-500/10 to-blue-600/5 shadow-lg shadow-blue-500/10 hover:shadow-xl hover:shadow-blue-500/20 transition-all duration-300">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5" />
                Quick Install
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CodeBlock 
                code="curl -sSf https://scout.arach.dev/transcriber-install.sh | bash"
                language="bash"
                className="mb-4"
              />
              <div className="flex gap-4">
                <Button variant="outline" size="sm" asChild>
                  <a href="/transcriber-install.txt" target="_blank">
                    <BookOpen className="h-4 w-4 mr-2" />
                    View Script
                  </a>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href="/transcriber-readme.txt" target="_blank">
                    <Download className="h-4 w-4 mr-2" />
                    README
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Features Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <Card className="border border-border/50 hover:border-blue-500/30 transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/10 bg-gradient-to-br from-background to-muted/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Cpu className="h-5 w-5 text-blue-500 animate-pulse" />
                  Multiple AI Models
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                    <span><strong>Whisper</strong> - OpenAI's multilingual model</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                    <span><strong>Parakeet</strong> - NVIDIA's low-latency model</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                    <span><strong>Wav2Vec2</strong> - Facebook's noise-robust model</span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border border-border/50 hover:border-green-500/30 transition-all duration-300 hover:shadow-lg hover:shadow-green-500/10 bg-gradient-to-br from-background to-muted/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Zap className="h-5 w-5 text-yellow-500 animate-pulse" />
                  Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>MLX acceleration on Apple Silicon</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>ZeroMQ distributed processing</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>0.03x RTF (30s audio in ~1s)</span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>

          {/* Architecture */}
          <Card className="mb-8 border border-border/50 shadow-md hover:shadow-lg transition-shadow duration-300">
            <CardHeader>
              <CardTitle>Architecture</CardTitle>
              <CardDescription>
                Control Plane / Data Plane Separation with ZeroMQ
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CodeBlock 
                code={`┌────────────┐        ┌─────────────────┐        ┌──────────────┐
│   Scout    │        │   Transcriber   │        │   Python     │
│    App     │◀──────▶│     Service     │◀──────▶│   Workers    │
└────────────┘        └─────────────────┘        └──────────────┘
      │                        │                         │
   Port 5556              Port 5557                  Port 5555
   (Pull)                 (Control)                   (Push)
      │                        │                         │
      ▼                        ▼                         ▼
┌────────────┐        ┌─────────────────┐        ┌──────────────┐
│ Transcripts│        │  Health Status  │        │ Audio Chunks │
└────────────┘        └─────────────────┘        └──────────────┘`}
                language="text"
              />
            </CardContent>
          </Card>

          {/* Configuration */}
          <Card className="mb-8 border border-purple-500/20 bg-gradient-to-br from-purple-500/5 to-transparent shadow-md hover:shadow-lg transition-all duration-300">
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>
                Use with Scout or standalone
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">In Scout Settings</h4>
                <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Open Settings (⌘,)</li>
                  <li>Navigate to Transcription tab</li>
                  <li>Select "External Service" mode</li>
                  <li>Configure model and workers</li>
                  <li>Click "Test Connection"</li>
                </ol>
              </div>
              
              <div>
                <h4 className="font-medium mb-2">Environment Variables</h4>
                <CodeBlock 
                  code={`# Custom ports (defaults: 5555, 5556, 5557)
export ZMQ_PUSH_PORT=6000
export ZMQ_PULL_PORT=6001
export ZMQ_CONTROL_PORT=6002

# Run with custom settings
scout-transcriber --workers 4 --model parakeet`}
                  language="bash"
                />
              </div>
            </CardContent>
          </Card>

          {/* Security Note */}
          <Card className="mb-8 border-2 border-green-500/30 bg-gradient-to-br from-green-500/10 to-green-600/5 shadow-lg shadow-green-500/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-green-500" />
                Privacy & Security
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                  <span>All processing happens locally on your device</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                  <span>No data is sent to external servers</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                  <span>Service binds to localhost only (127.0.0.1)</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                  <span>Open source and auditable</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          {/* Troubleshooting */}
          <Card className="mb-8 border border-orange-500/20 bg-gradient-to-br from-orange-500/5 to-transparent shadow-md hover:shadow-lg transition-all duration-300">
            <CardHeader>
              <CardTitle>Troubleshooting</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                  Service Not Starting
                </h4>
                <CodeBlock 
                  code={`# Check if ports are in use
lsof -i :5555

# View logs
tail -f ~/.scout-transcriber/logs/transcriber.log`}
                  language="bash"
                />
              </div>

              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                  Connection Failed
                </h4>
                <CodeBlock 
                  code={`# Check if service is running
ps aux | grep scout-transcriber

# Restart service
scout-transcriber --workers 2`}
                  language="bash"
                />
              </div>
            </CardContent>
          </Card>

          {/* Uninstall */}
          <Card className="mb-8 border border-slate-500/20 bg-gradient-to-br from-slate-500/5 to-transparent">
            <CardHeader>
              <CardTitle>Uninstallation</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                To completely remove the transcriber service and all associated files:
              </p>
              <CodeBlock 
                code="curl -sSf https://scout.arach.dev/transcriber-uninstall.sh | bash"
                language="bash"
              />
            </CardContent>
          </Card>

          {/* Resources */}
          <Card className="border border-indigo-500/20 bg-gradient-to-br from-indigo-500/5 to-transparent shadow-md hover:shadow-lg transition-all duration-300">
            <CardHeader>
              <CardTitle>Resources</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Button variant="outline" asChild>
                  <a href="https://github.com/arach/scout/tree/master/transcriber" target="_blank">
                    Source Code
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </a>
                </Button>
                <Button variant="outline" asChild>
                  <a href="https://github.com/arach/scout/issues" target="_blank">
                    Report Issues
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}