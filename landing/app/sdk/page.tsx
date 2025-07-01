"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { 
  Code, 
  Zap, 
  Lock, 
  Palette, 
  Brain, 
  Package,
  Terminal,
  Sparkles,
  Mic,
  Command
} from "lucide-react"
import Link from "next/link"
import { SDKNav } from "@/components/sdk-nav"

export default function SDKPage() {
  const [activeTab, setActiveTab] = useState<'react' | 'swift' | 'tauri'>('react')

  const codeExamples = {
    react: `import Scout from '@scout/react';

export function App() {
  useEffect(() => {
    Scout.init({
      apiKey: 'your-api-key',
      theme: 'claude',
      onTranscribe: (text) => {
        console.log('User said:', text);
        // Send to your LLM
      },
      onCommand: (command) => {
        // Handle voice commands
      }
    });
  }, []);
  
  return <YourApp />;
}`,
    swift: `import ScoutKit

class AppDelegate: NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        Scout.shared.configure(
            apiKey: "your-api-key",
            theme: .claude
        )
        
        Scout.shared.onTranscribe = { text in
            // Handle transcription
        }
        
        Scout.shared.start()
    }
}`,
    tauri: `// tauri.conf.json
{
  "plugins": {
    "scout": {
      "theme": "claude",
      "hotkey": "Cmd+Shift+Space"
    }
  }
}

// main.rs
use scout_tauri::Scout;

fn main() {
    tauri::Builder::default()
        .plugin(Scout::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}`
  }

  return (
    <>
      <SDKNav />
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-background pt-20 pb-32">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-600/10 via-transparent to-purple-600/10 opacity-50" />
        
        <div className="container relative mx-auto px-6 max-w-6xl">
          <div className="text-center space-y-6">
            <Badge variant="secondary" className="mb-4">
              <Sparkles className="w-3 h-3 mr-1" />
              Developer Preview
            </Badge>
            
            <h1 className="text-5xl md:text-7xl font-bold leading-tight">
              Your Voice,{" "}
              <span className="bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                Built In
              </span>
            </h1>
            
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
              Scout lets apps like Claude, Cursor, and Raycast ship native voice UX with zero friction. 
              Local-first, model-agnostic, and beautifully integrated.
            </p>
            
            <div className="flex items-center justify-center gap-4 pt-4">
              <div className="bg-card border rounded-lg px-6 py-3 font-mono text-sm">
                npx @scout/create-app
              </div>
              <Button size="lg" asChild>
                <Link href="#get-started">
                  Get Started
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Visual Demo Section */}
      <section className="py-20 px-6 bg-secondary/20">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">See Scout in Action</h2>
            <p className="text-muted-foreground">
              One SDK. Native voice input. Any app.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Command className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">Global Hotkey Activation</h3>
                  <p className="text-sm text-muted-foreground">
                    User presses Cmd+Shift+Space anywhere in your app
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Mic className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">Beautiful Native Overlay</h3>
                  <p className="text-sm text-muted-foreground">
                    Themed to match your app's design language
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">Instant Transcription</h3>
                  <p className="text-sm text-muted-foreground">
                    Real-time Whisper processing with callbacks to your app
                  </p>
                </div>
              </div>
            </div>
            
            <div className="bg-card rounded-lg p-8 border">
              <div className="aspect-video bg-secondary/50 rounded-lg flex items-center justify-center">
                <span className="text-muted-foreground">Demo Video Coming Soon</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 px-6">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Built for Modern Apps</h2>
            <p className="text-muted-foreground">
              Everything you need to add voice to your desktop app
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-6">
            <FeatureCard
              icon={<Code className="w-5 h-5" />}
              title="One-Line Integration"
              description="Drop Scout into your React, Swift, or Tauri app with a single import"
            />
            <FeatureCard
              icon={<Lock className="w-5 h-5" />}
              title="Local-First Processing"
              description="Ring buffer recording + Whisper transcription. No cloud required."
            />
            <FeatureCard
              icon={<Palette className="w-5 h-5" />}
              title="Themeable UI"
              description="Match your app's design. Custom overlays, sounds, and animations."
            />
            <FeatureCard
              icon={<Brain className="w-5 h-5" />}
              title="Model Agnostic"
              description="Works with Claude, GPT, local LLMs, or as standalone transcription."
            />
            <FeatureCard
              icon={<Zap className="w-5 h-5" />}
              title="Native Performance"
              description="Built on Tauri with Swift bindings. Small footprint, zero lag."
            />
            <FeatureCard
              icon={<Package className="w-5 h-5" />}
              title="Modular Architecture"
              description="Use only what you need: core, UI, or full SDK."
            />
          </div>
        </div>
      </section>

      {/* Code Examples */}
      <section id="get-started" className="py-20 px-6 bg-secondary/20">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Integrate in Minutes</h2>
            <p className="text-muted-foreground">
              Choose your platform and get started
            </p>
          </div>
          
          <div className="max-w-4xl mx-auto">
            <div className="flex gap-2 mb-6">
              <Button
                variant={activeTab === 'react' ? 'default' : 'outline'}
                onClick={() => setActiveTab('react')}
                size="sm"
              >
                React
              </Button>
              <Button
                variant={activeTab === 'swift' ? 'default' : 'outline'}
                onClick={() => setActiveTab('swift')}
                size="sm"
              >
                Swift
              </Button>
              <Button
                variant={activeTab === 'tauri' ? 'default' : 'outline'}
                onClick={() => setActiveTab('tauri')}
                size="sm"
              >
                Tauri
              </Button>
            </div>
            
            <Card>
              <CardContent className="p-0">
                <pre className="p-6 overflow-x-auto">
                  <code className="text-sm">{codeExamples[activeTab]}</code>
                </pre>
              </CardContent>
            </Card>
            
            <div className="mt-8 text-center">
              <Button size="lg" className="gap-2">
                <Terminal className="w-4 h-4" />
                View Documentation
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Partner Showcase */}
      <section className="py-20 px-6">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Perfect For</h2>
            <p className="text-muted-foreground">
              Apps that want native voice without the complexity
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <PartnerCard
              name="Claude"
              description="Voice-powered AI conversations"
              useCase="Natural dialogue input"
            />
            <PartnerCard
              name="Cursor"
              description="Code with voice commands"
              useCase="'Generate a React component'"
            />
            <PartnerCard
              name="Raycast"
              description="Voice-driven launcher"
              useCase="'Open Slack and message team'"
            />
            <PartnerCard
              name="Reflect"
              description="Think out loud"
              useCase="Voice notes & journaling"
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6 bg-gradient-to-r from-violet-600/10 to-purple-600/10">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="text-3xl font-bold mb-4">
            Ready to Add Voice to Your App?
          </h2>
          <p className="text-muted-foreground mb-8">
            Join the developer preview and ship voice UX your users will love
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <div className="bg-card border rounded-lg px-6 py-3 font-mono text-sm">
              npm install @scout/sdk
            </div>
            <Button size="lg" variant="outline" asChild>
              <Link href="https://github.com/arach/scout-sdk" target="_blank">
                View on GitHub
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <Card className="border hover:border-primary/50 transition-colors">
      <CardContent className="p-6">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
          {icon}
        </div>
        <h3 className="font-semibold mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

function PartnerCard({ name, description, useCase }: { name: string; description: string; useCase: string }) {
  return (
    <Card className="border">
      <CardContent className="p-6 text-center">
        <div className="w-16 h-16 rounded-lg bg-secondary flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl font-bold">{name[0]}</span>
        </div>
        <h3 className="font-semibold mb-1">{name}</h3>
        <p className="text-sm text-muted-foreground mb-3">{description}</p>
        <Badge variant="secondary" className="text-xs">
          {useCase}
        </Badge>
      </CardContent>
    </Card>
  )
}