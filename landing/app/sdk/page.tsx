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
import { PrismCode } from "@/components/prism-code"

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
      <section className="relative overflow-hidden bg-background pt-24 pb-32">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-600/5 via-transparent to-gray-600/5" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
        
        <div className="container relative mx-auto px-6 max-w-6xl">
          <div className="text-center space-y-6">
            <Badge variant="secondary" className="mb-4 animate-pulse">
              <Sparkles className="w-3 h-3 mr-1" />
              Developer Preview
            </Badge>
            
            <h1 className="text-5xl md:text-7xl font-bold leading-tight animate-fade-in">
              Add Voice to Your App{" "}
              <span className="text-gray-900 dark:text-white">
                in Minutes
              </span>
            </h1>
            
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
              Scout SDK is a local-first, white-label voice interface for desktop apps. 
              Drop in voice commands and dictation with just a few lines of code.
            </p>
            
            <div className="flex flex-col items-center gap-4 pt-4">
              <div className="flex items-center justify-center gap-4">
                <div className="bg-card border border-primary/20 rounded-lg px-6 py-3 shadow-sm hover:shadow-md transition-all duration-200 hover:border-primary/40">
                  <PrismCode 
                    code="npx scout init" 
                    language="bash"
                    className="text-xs !m-0 !p-0 !bg-transparent"
                  />
                </div>
                <Button size="lg" asChild>
                  <Link href="#get-started">
                    Get Started
                  </Link>
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                  <Zap className="w-4 h-4 text-yellow-500" />
                  3-4x faster than typing
                </span>
                <span className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                  <Lock className="w-4 h-4 text-green-500" />
                  100% on-device
                </span>
                <span className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                  <Package className="w-4 h-4 text-blue-500" />
                  ~5MB binary
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What is Scout SDK Section */}
      <section className="py-20 px-6">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">What is Scout SDK?</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Scout SDK is a white-label voice interface that integrates seamlessly into your desktop app. 
              Handle voice commands, dictation, and natural language input without building audio infrastructure from scratch.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card className="border-2 border-primary/20 hover:border-primary/40 transition-all duration-200 hover:shadow-lg group">
              <CardContent className="p-6 text-center">
                <Package className="w-8 h-8 text-primary/40 mx-auto mb-3 group-hover:text-primary/60 transition-colors" />
                <div className="text-3xl font-bold mb-2 group-hover:text-primary transition-colors">~5MB</div>
                <p className="text-sm text-muted-foreground">Tiny binary footprint</p>
              </CardContent>
            </Card>
            <Card className="border-2 border-primary/20 hover:border-primary/40 transition-all duration-200 hover:shadow-lg group">
              <CardContent className="p-6 text-center">
                <Zap className="w-8 h-8 text-primary/40 mx-auto mb-3 group-hover:text-primary/60 transition-colors" />
                <div className="text-3xl font-bold mb-2 group-hover:text-primary transition-colors">&lt;300ms</div>
                <p className="text-sm text-muted-foreground">End-to-end latency</p>
              </CardContent>
            </Card>
            <Card className="border-2 border-primary/20 hover:border-primary/40 transition-all duration-200 hover:shadow-lg group">
              <CardContent className="p-6 text-center">
                <Lock className="w-8 h-8 text-primary/40 mx-auto mb-3 group-hover:text-primary/60 transition-colors" />
                <div className="text-3xl font-bold mb-2 group-hover:text-primary transition-colors">100%</div>
                <p className="text-sm text-muted-foreground">Local processing</p>
              </CardContent>
            </Card>
            <Card className="border-2 border-primary/20 hover:border-primary/40 transition-all duration-200 hover:shadow-lg group">
              <CardContent className="p-6 text-center">
                <Brain className="w-8 h-8 text-primary/40 mx-auto mb-3 group-hover:text-primary/60 transition-colors" />
                <div className="text-3xl font-bold mb-2 group-hover:text-primary transition-colors">0</div>
                <p className="text-sm text-muted-foreground">Cloud dependencies</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-24 px-6 bg-gradient-to-b from-secondary/10 to-secondary/5">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">How It Works</h2>
            <p className="text-muted-foreground">
              Voice-enable your app in three simple steps
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center group">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 group-hover:bg-primary/20 transition-colors duration-200 relative">
                <Mic className="w-8 h-8 text-primary/60 absolute group-hover:scale-110 transition-transform" />
                <span className="text-2xl font-bold text-primary relative z-10">1</span>
              </div>
              <h3 className="font-semibold mb-2 group-hover:text-primary transition-colors">User Activates Voice</h3>
              <p className="text-sm text-muted-foreground">
                Press hotkey or click button to start recording. Ring buffer captures audio before activation.
              </p>
            </div>
            
            <div className="text-center group">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 group-hover:bg-primary/20 transition-colors duration-200 relative">
                <Brain className="w-8 h-8 text-primary/60 absolute group-hover:scale-110 transition-transform" />
                <span className="text-2xl font-bold text-primary relative z-10">2</span>
              </div>
              <h3 className="font-semibold mb-2 group-hover:text-primary transition-colors">Scout Processes Audio</h3>
              <p className="text-sm text-muted-foreground">
                Local transcription with Whisper or stream to your preferred ASR service.
              </p>
            </div>
            
            <div className="text-center group">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 group-hover:bg-primary/20 transition-colors duration-200 relative">
                <Code className="w-8 h-8 text-primary/60 absolute group-hover:scale-110 transition-transform" />
                <span className="text-2xl font-bold text-primary relative z-10">3</span>
              </div>
              <h3 className="font-semibold mb-2 group-hover:text-primary transition-colors">Your App Handles Text</h3>
              <p className="text-sm text-muted-foreground">
                Receive transcribed text via callback. Process commands or send to your LLM.
              </p>
            </div>
          </div>
          
          <div className="mt-12 space-y-6">
            <h3 className="text-xl font-semibold text-center">Key Features</h3>
            <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
              <div className="flex items-start gap-4 p-4 rounded-lg hover:bg-secondary/50 transition-colors duration-200">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                  <Command className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-semibold mb-1">Never Miss a Word</h4>
                  <p className="text-sm text-muted-foreground">
                    Ring buffer recording captures audio before you hit record
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-4 p-4 rounded-lg hover:bg-secondary/50 transition-colors duration-200">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                  <Palette className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-semibold mb-1">White-Label UI</h4>
                  <p className="text-sm text-muted-foreground">
                    Fully customizable interface that matches your app's design
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-4 p-4 rounded-lg hover:bg-secondary/50 transition-colors duration-200">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                  <Lock className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-semibold mb-1">100% On-Device</h4>
                  <p className="text-sm text-muted-foreground">
                    Complete privacy with local processing. No cloud required.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24 px-6">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Everything You Need</h2>
            <p className="text-muted-foreground">
              A complete voice OS for your desktop app
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
              title="Never Miss a Word"
              description="Ring buffer recording captures audio before users hit record."
            />
            <FeatureCard
              icon={<Palette className="w-5 h-5" />}
              title="White-Label UI"
              description="Fully customizable voice interface that matches your app's brand."
            />
            <FeatureCard
              icon={<Brain className="w-5 h-5" />}
              title="Model Agnostic"
              description="Works with Claude, GPT, local LLMs, or as standalone transcription."
            />
            <FeatureCard
              icon={<Zap className="w-5 h-5" />}
              title="3-4x Faster Than Typing"
              description="~5MB binary with <300ms latency. Ships directly with your app."
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
      <section id="get-started" className="py-24 px-6 bg-gradient-to-b from-secondary/20 to-secondary/10">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Integrate in Minutes</h2>
            <p className="text-muted-foreground">
              Choose your platform and get started
            </p>
          </div>
          
          <div className="max-w-4xl mx-auto">
            <div className="inline-flex gap-1 mb-8 p-1 bg-muted rounded-lg">
              <Button
                variant={activeTab === 'react' ? 'default' : 'ghost'}
                onClick={() => setActiveTab('react')}
                size="sm"
                className="transition-all duration-200"
              >
                React
              </Button>
              <Button
                variant={activeTab === 'swift' ? 'default' : 'ghost'}
                onClick={() => setActiveTab('swift')}
                size="sm"
                className="transition-all duration-200"
              >
                Swift
              </Button>
              <Button
                variant={activeTab === 'tauri' ? 'default' : 'ghost'}
                onClick={() => setActiveTab('tauri')}
                size="sm"
                className="transition-all duration-200"
              >
                Tauri
              </Button>
            </div>
            
            <Card className="shadow-lg border-2">
              <CardContent className="p-0">
                <div className="p-6 overflow-x-auto bg-gradient-to-br from-secondary/20 to-secondary/10 rounded-lg">
                  <PrismCode 
                    code={codeExamples[activeTab]} 
                    language={activeTab === 'react' ? 'typescript' : activeTab === 'swift' ? 'swift' : 'rust'}
                    className="text-xs"
                  />
                </div>
              </CardContent>
            </Card>
            
            <div className="mt-8 text-center">
              <Button size="lg" className="gap-2" asChild>
                <Link href="/docs">
                  <Terminal className="w-4 h-4" />
                  View Documentation
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section className="py-24 px-6">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Perfect For</h2>
            <p className="text-muted-foreground">
              Scout SDK powers voice experiences across categories
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <UseCaseCard
              category="AI Assistants"
              description="Natural voice conversations with LLMs"
              examples={["Claude", "ChatGPT Desktop", "Perplexity"]}
              icon={<Brain className="w-5 h-5" />}
            />
            <UseCaseCard
              category="Coding Copilots"
              description="Voice commands for code generation"
              examples={["Cursor", "GitHub Copilot", "Codeium"]}
              icon={<Code className="w-5 h-5" />}
            />
            <UseCaseCard
              category="Productivity Tools"
              description="Hands-free app control and navigation"
              examples={["Raycast", "Alfred", "Notion"]}
              icon={<Zap className="w-5 h-5" />}
            />
            <UseCaseCard
              category="Note-Taking Apps"
              description="Voice memos and dictation"
              examples={["Obsidian", "Reflect", "Bear"]}
              icon={<Terminal className="w-5 h-5" />}
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-gray-600/10 via-gray-600/5 to-gray-600/10" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/50 to-background" />
        <div className="container relative mx-auto max-w-4xl text-center">
          <h2 className="text-3xl font-bold mb-4">
            Ship Voice Today
          </h2>
          <p className="text-muted-foreground mb-8">
            Your UI, your experience — just with better ears. Join leading apps using Scout.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <div className="bg-card border border-primary/20 rounded-lg px-6 py-3 shadow-sm hover:shadow-md transition-all duration-200 hover:border-primary/40">
              <PrismCode 
                code="npm install @scout/sdk" 
                language="bash"
                className="text-xs !m-0 !p-0 !bg-transparent"
              />
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
    <Card className="border hover:border-primary/50 transition-all duration-200 hover:shadow-lg group h-full">
      <CardContent className="p-6">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
          <div className="group-hover:scale-110 transition-transform">
            {icon}
          </div>
        </div>
        <h3 className="font-semibold mb-2 group-hover:text-primary transition-colors">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

function UseCaseCard({ 
  category, 
  description, 
  examples, 
  icon 
}: { 
  category: string; 
  description: string; 
  examples: string[];
  icon: React.ReactNode;
}) {
  return (
    <Card className="border hover:border-primary/50 transition-all duration-200 hover:shadow-lg group h-full">
      <CardContent className="p-6">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
          <div className="group-hover:scale-110 transition-transform">
            {icon}
          </div>
        </div>
        <h3 className="font-semibold mb-2 group-hover:text-primary transition-colors">{category}</h3>
        <p className="text-sm text-muted-foreground mb-4">{description}</p>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Examples:</p>
          <p className="text-xs text-muted-foreground">
            {examples.map((example, i) => (
              <span key={example}>
                <span className="hover:text-foreground transition-colors cursor-default">{example}</span>
                {i < examples.length - 1 && ", "}
              </span>
            ))}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}