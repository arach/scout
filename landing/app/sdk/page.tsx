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
      <section className="relative overflow-hidden pt-20 pb-16" style={{
        background: `linear-gradient(135deg, rgba(245,240,230,0.92) 0%, rgba(250,247,240,0.92) 50%, rgba(240,232,220,0.92) 100%), url('/japanese-paper-texture.png')`,
        backgroundSize: 'auto, 800px 800px',
        backgroundRepeat: 'repeat',
        backgroundBlendMode: 'normal'
      }}>
        <div className="absolute inset-0 bg-gradient-to-t from-[#FDFCF8] via-transparent to-transparent" />
        
        <div className="container relative mx-auto px-6 max-w-6xl">
          <div className="text-center space-y-4">
            <Badge variant="secondary" className="mb-2 animate-pulse">
              <Sparkles className="w-3 h-3 mr-1" />
              Developer Preview
            </Badge>
            
            <h1 className="font-serif text-5xl md:text-7xl font-semibold leading-tight animate-fade-in" style={{ color: '#2A2520' }}>
              Add Voice to Your App{" "}
              <span className="text-primary">
                in Minutes
              </span>
            </h1>
            
            <p className="font-sans text-lg text-muted-foreground max-w-3xl mx-auto font-light">
              Scout SDK is a local-first, white-label voice interface for desktop apps.
              Drop in voice commands and dictation with just a few lines of code.
            </p>
            
            <div className="flex flex-col items-center gap-3 pt-3">
              <div className="flex items-center justify-center gap-4">
                <div className="rounded-lg px-6 py-3 shadow-sm hover:shadow-md transition-all duration-200" style={{
                  backgroundColor: '#FDFBF7',
                  border: '1px solid #D4C4B0'
                }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = '#C2996C'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = '#D4C4B0'}>
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
      <section className="py-12 px-6" style={{ backgroundColor: '#FFFEF9' }}>
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-8">
            <h2 className="font-serif text-3xl font-semibold mb-4 text-foreground">What is Scout SDK?</h2>
            <p className="font-sans text-sm text-muted-foreground max-w-2xl mx-auto font-light">
              Scout SDK is a white-label voice interface that integrates seamlessly into your desktop app. 
              Handle voice commands, dictation, and natural language input without building audio infrastructure from scratch.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="rounded-xl transition-all hover:shadow-lg group p-6 text-center" style={{
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
              <Package className="w-8 h-8 mx-auto mb-3 transition-colors" style={{ color: '#C2996C' }} />
              <div className="font-serif text-3xl font-bold mb-2 text-foreground">~5MB</div>
              <p className="font-sans text-sm text-muted-foreground">Tiny binary footprint</p>
            </div>
            <div className="rounded-xl transition-all hover:shadow-lg group p-6 text-center" style={{
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
              <Zap className="w-8 h-8 mx-auto mb-3 transition-colors" style={{ color: '#C2996C' }} />
              <div className="font-serif text-3xl font-bold mb-2 text-foreground">&lt;300ms</div>
              <p className="font-sans text-sm text-muted-foreground">End-to-end latency</p>
            </div>
            <div className="rounded-xl transition-all hover:shadow-lg group p-6 text-center" style={{
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
              <Lock className="w-8 h-8 mx-auto mb-3 transition-colors" style={{ color: '#C2996C' }} />
              <div className="font-serif text-3xl font-bold mb-2 text-foreground">100%</div>
              <p className="font-sans text-sm text-muted-foreground">Local processing</p>
            </div>
            <div className="rounded-xl transition-all hover:shadow-lg group p-6 text-center" style={{
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
              <Brain className="w-8 h-8 mx-auto mb-3 transition-colors" style={{ color: '#C2996C' }} />
              <div className="font-serif text-3xl font-bold mb-2 text-foreground">0</div>
              <p className="font-sans text-sm text-muted-foreground">Cloud dependencies</p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-12 px-6" style={{
        background: `linear-gradient(to bottom, rgba(255,254,249,0.95), rgba(255,254,249,0.95)), url('/japanese-paper-texture.png')`,
        backgroundSize: 'auto, 1200px 1200px',
        backgroundRepeat: 'repeat',
        borderTop: '1px solid #E8DDD0'
      }}>
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-8">
            <h2 className="font-serif text-3xl font-semibold mb-3 text-foreground">How It Works</h2>
            <p className="font-sans text-sm text-muted-foreground font-light">
              Voice-enable your app in three simple steps
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center group">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 transition-colors duration-200 relative" style={{
                backgroundColor: 'rgba(194, 154, 108, 0.1)'
              }}>
                <Mic className="w-8 h-8 absolute group-hover:scale-110 transition-transform" style={{ color: '#C2996C' }} />
                <span className="font-serif text-2xl font-bold relative z-10" style={{ color: '#C2996C' }}>1</span>
              </div>
              <h3 className="font-serif font-semibold mb-2 text-foreground">User Activates Voice</h3>
              <p className="font-sans text-sm text-muted-foreground">
                Press hotkey or click button to start recording. Ring buffer captures audio before activation.
              </p>
            </div>
            
            <div className="text-center group">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 transition-colors duration-200 relative" style={{
                backgroundColor: 'rgba(194, 154, 108, 0.1)'
              }}>
                <Brain className="w-8 h-8 absolute group-hover:scale-110 transition-transform" style={{ color: '#C2996C' }} />
                <span className="font-serif text-2xl font-bold relative z-10" style={{ color: '#C2996C' }}>2</span>
              </div>
              <h3 className="font-serif font-semibold mb-2 text-foreground">Scout Processes Audio</h3>
              <p className="font-sans text-sm text-muted-foreground">
                Local transcription with Whisper or stream to your preferred ASR service.
              </p>
            </div>
            
            <div className="text-center group">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 transition-colors duration-200 relative" style={{
                backgroundColor: 'rgba(194, 154, 108, 0.1)'
              }}>
                <Code className="w-8 h-8 absolute group-hover:scale-110 transition-transform" style={{ color: '#C2996C' }} />
                <span className="font-serif text-2xl font-bold relative z-10" style={{ color: '#C2996C' }}>3</span>
              </div>
              <h3 className="font-serif font-semibold mb-2 text-foreground">Your App Handles Text</h3>
              <p className="font-sans text-sm text-muted-foreground">
                Receive transcribed text via callback. Process commands or send to your LLM.
              </p>
            </div>
          </div>
          
          <div className="mt-8 space-y-4">
            <h3 className="font-serif text-xl font-semibold text-center text-foreground">Key Features</h3>
            <div className="grid md:grid-cols-3 gap-4 max-w-4xl mx-auto">
              <div className="flex items-start gap-4 p-4 rounded-lg transition-colors duration-200" style={{
                backgroundColor: 'rgba(194, 154, 108, 0.05)'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(194, 154, 108, 0.1)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(194, 154, 108, 0.05)'}>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors" style={{
                  backgroundColor: 'rgba(194, 154, 108, 0.1)'
                }}>
                  <Command className="w-5 h-5" style={{ color: '#C2996C' }} />
                </div>
                <div>
                  <h4 className="font-serif font-semibold mb-1 text-foreground">Never Miss a Word</h4>
                  <p className="font-sans text-sm text-muted-foreground">
                    Ring buffer recording captures audio before you hit record
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-4 p-4 rounded-lg transition-colors duration-200" style={{
                backgroundColor: 'rgba(194, 154, 108, 0.05)'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(194, 154, 108, 0.1)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(194, 154, 108, 0.05)'}>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors" style={{
                  backgroundColor: 'rgba(194, 154, 108, 0.1)'
                }}>
                  <Palette className="w-5 h-5" style={{ color: '#C2996C' }} />
                </div>
                <div>
                  <h4 className="font-serif font-semibold mb-1 text-foreground">White-Label UI</h4>
                  <p className="font-sans text-sm text-muted-foreground">
                    Fully customizable interface that matches your app's design
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-4 p-4 rounded-lg transition-colors duration-200" style={{
                backgroundColor: 'rgba(194, 154, 108, 0.05)'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(194, 154, 108, 0.1)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(194, 154, 108, 0.05)'}>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors" style={{
                  backgroundColor: 'rgba(194, 154, 108, 0.1)'
                }}>
                  <Lock className="w-5 h-5" style={{ color: '#C2996C' }} />
                </div>
                <div>
                  <h4 className="font-serif font-semibold mb-1 text-foreground">100% On-Device</h4>
                  <p className="font-sans text-sm text-muted-foreground">
                    Complete privacy with local processing. No cloud required.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-12 px-6" style={{
        backgroundColor: '#FBF9F5',
        borderTop: '1px solid #E8DDD0'
      }}>
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-8">
            <h2 className="font-serif text-3xl font-semibold mb-3 text-foreground">Everything You Need</h2>
            <p className="font-sans text-sm text-muted-foreground font-light">
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
      <section id="get-started" className="py-12 px-6" style={{
        background: `linear-gradient(to bottom, rgba(255,254,249,0.95), rgba(255,254,249,0.95)), url('/japanese-paper-texture.png')`,
        backgroundSize: 'auto, 1200px 1200px',
        backgroundRepeat: 'repeat',
        borderTop: '1px solid #E8DDD0'
      }}>
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-8">
            <h2 className="font-serif text-3xl font-semibold mb-3 text-foreground">Integrate in Minutes</h2>
            <p className="font-sans text-sm text-muted-foreground font-light">
              Choose your platform and get started
            </p>
          </div>
          
          <div className="max-w-4xl mx-auto">
            <div className="inline-flex gap-1 mb-6 p-1 bg-muted rounded-lg">
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
            
            <div className="shadow-lg rounded-xl" style={{
              backgroundColor: '#FDFBF7',
              border: '1px solid #D4C4B0',
              boxShadow: '0 10px 40px rgba(139, 105, 87, 0.08)'
            }}>
              <div className="p-0">
                <div className="p-6 overflow-x-auto rounded-lg" style={{
                  backgroundColor: '#F5F0E6'
                }}>
                  <PrismCode 
                    code={codeExamples[activeTab]} 
                    language={activeTab === 'react' ? 'typescript' : activeTab === 'swift' ? 'swift' : 'rust'}
                    className="text-xs"
                  />
                </div>
              </div>
            </div>
            
            <div className="mt-6 text-center">
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
      <section className="py-12 px-6" style={{
        backgroundColor: '#FBF9F5',
        borderTop: '1px solid #E8DDD0'
      }}>
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-8">
            <h2 className="font-serif text-3xl font-semibold mb-3 text-foreground">Perfect For</h2>
            <p className="font-sans text-sm text-muted-foreground font-light">
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
      <section className="py-12 px-6 relative overflow-hidden" style={{
        background: `linear-gradient(to right, rgba(255,254,249,0.93), rgba(255,254,249,0.97)), url('/japanese-paper-texture.png')`,
        backgroundSize: 'auto, 1000px 1000px',
        backgroundRepeat: 'repeat',
        backgroundPosition: 'center',
        borderTop: '1px solid #E8DDD0'
      }}>
        <div className="container relative mx-auto max-w-4xl text-center">
          <h2 className="font-serif text-3xl font-semibold mb-3 text-foreground">
            Ship Voice Today
          </h2>
          <p className="font-sans text-sm text-muted-foreground mb-6 font-light">
            Your UI, your experience — just with better ears. Join leading apps using Scout.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <div className="rounded-lg px-6 py-3 shadow-sm hover:shadow-md transition-all duration-200" style={{
              backgroundColor: '#FDFBF7',
              border: '1px solid #D4C4B0'
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderColor = '#C2996C'}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = '#D4C4B0'}>
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
    <div className="rounded-xl transition-all hover:shadow-lg group h-full p-6" style={{
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
      <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4 transition-colors" style={{
        backgroundColor: 'rgba(194, 154, 108, 0.1)'
      }}>
        <div className="group-hover:scale-110 transition-transform" style={{ color: '#C2996C' }}>
          {icon}
        </div>
      </div>
      <h3 className="font-serif font-semibold mb-2 text-foreground">{title}</h3>
      <p className="font-sans text-sm text-muted-foreground">{description}</p>
    </div>
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
    <div className="rounded-xl transition-all hover:shadow-lg group h-full p-6" style={{
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
      <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4 transition-colors" style={{
        backgroundColor: 'rgba(194, 154, 108, 0.1)'
      }}>
        <div className="group-hover:scale-110 transition-transform" style={{ color: '#C2996C' }}>
          {icon}
        </div>
      </div>
      <h3 className="font-serif font-semibold mb-2 text-foreground">{category}</h3>
      <p className="font-sans text-sm text-muted-foreground mb-4">{description}</p>
      <div className="space-y-1">
        <p className="font-sans text-xs text-muted-foreground font-medium">Examples:</p>
        <p className="font-sans text-xs text-muted-foreground">
          {examples.map((example, i) => (
            <span key={example}>
              <span className="hover:text-foreground transition-colors cursor-default">{example}</span>
              {i < examples.length - 1 && ", "}
            </span>
          ))}
        </p>
      </div>
    </div>
  )
}