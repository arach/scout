"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { 
  BookOpen,
  Download,
  Settings,
  Code,
  Zap,
  Mic,
  Palette,
  Command,
  Database,
  Shield,
  Layers,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  Terminal,
  Globe,
  Cpu,
  Users
} from "lucide-react"
import Link from "next/link"
import { SDKNav } from "@/components/sdk-nav"
import { PrismCode } from "@/components/prism-code"

const navSections = [
  {
    title: "Getting Started",
    items: [
      { id: "overview", title: "Overview" },
      { id: "installation", title: "Installation" },  
      { id: "quick-start", title: "Quick Start" },
      { id: "configuration", title: "Configuration" }
    ]
  },
  {
    title: "Integration Guides", 
    items: [
      { id: "react", title: "React Integration" },
      { id: "swift", title: "Swift/macOS" },
      { id: "tauri", title: "Tauri Apps" },
      { id: "electron", title: "Electron Apps" }
    ]
  },
  {
    title: "Core Features",
    items: [
      { id: "voice-commands", title: "Voice Commands" },
      { id: "transcription", title: "Transcription" },
      { id: "theming", title: "Theming" },
      { id: "hotkeys", title: "Global Hotkeys" }
    ]
  },
  {
    title: "Advanced",
    items: [
      { id: "architecture", title: "Architecture" },
      { id: "performance", title: "Performance" },
      { id: "troubleshooting", title: "Troubleshooting" },
      { id: "migration", title: "Migration Guide" }
    ]
  },
  {
    title: "Reference",
    items: [
      { id: "api", title: "API Reference" },
      { id: "models", title: "Whisper Models" },
      { id: "examples", title: "Examples" }
    ]
  }
]

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("overview")

  return (
    <>
      <SDKNav />
      <div className="flex min-h-screen bg-background pt-16">
        {/* Sidebar Navigation */}
        <div className="w-64 border-r bg-card/50 p-6 pt-8 hidden lg:block fixed h-full top-16">
          <div className="space-y-6">
            {navSections.map((section) => (
              <div key={section.title}>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                  {section.title}
                </h3>
                <div className="space-y-1">
                  {section.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setActiveSection(item.id)}
                      className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
                        activeSection === item.id
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent hover:text-accent-foreground"
                      }`}
                    >
                      {item.title}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 p-6 lg:p-12 max-w-4xl lg:ml-64">
          <DocSection activeSection={activeSection} />
        </div>
      </div>
    </>
  )
}

function DocSection({ activeSection }: { activeSection: string }) {
  const sections = {
    overview: <OverviewSection />,
    installation: <InstallationSection />,
    "quick-start": <QuickStartSection />,
    configuration: <ConfigurationSection />,
    react: <ReactSection />,
    swift: <SwiftSection />,
    tauri: <TauriSection />,
    electron: <ElectronSection />,
    "voice-commands": <VoiceCommandsSection />,
    transcription: <TranscriptionSection />,
    theming: <ThemingSection />,
    hotkeys: <HotkeysSection />,
    architecture: <ArchitectureSection />,
    performance: <PerformanceSection />,
    troubleshooting: <TroubleshootingSection />,
    migration: <MigrationSection />,
    api: <APIReferenceSection />,
    models: <ModelsSection />,
    examples: <ExamplesSection />
  }

  return sections[activeSection as keyof typeof sections] || <OverviewSection />
}

function OverviewSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">Scout SDK Documentation</h1>
        <p className="text-xl text-muted-foreground">
          Add native voice input to your desktop app with zero friction
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5" />
              Quick Integration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Get started in minutes with our platform-specific SDKs
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-500" />
                One-line initialization
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-500" />
                Zero external dependencies
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-500" />
                Works offline
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Privacy First
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              All processing happens locally on device
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-500" />
                Local Whisper processing
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-500" />
                No cloud dependencies
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-500" />
                Ring buffer recording
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="text-2xl font-semibold mb-4">What is Scout?</h2>
        <p className="text-muted-foreground mb-6">
          Scout is a native voice input SDK that enables desktop applications to add voice capabilities 
          with minimal setup. Built on Tauri v2 with Rust performance, Scout provides beautiful 
          themed overlays, real-time transcription, and seamless integration with your existing app.
        </p>
        
        <div className="bg-card border rounded-lg p-6">
          <h3 className="font-semibold mb-3">Key Features</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-3">
              <Mic className="w-5 h-5 text-primary mt-0.5" />
              <div>
                <div className="font-medium">Voice Activity Detection</div>
                <div className="text-sm text-muted-foreground">Automatic start/stop recording</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Command className="w-5 h-5 text-primary mt-0.5" />
              <div>
                <div className="font-medium">Global Hotkeys</div>
                <div className="text-sm text-muted-foreground">System-wide push-to-talk</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Palette className="w-5 h-5 text-primary mt-0.5" />
              <div>
                <div className="font-medium">Themeable UI</div>
                <div className="text-sm text-muted-foreground">Match your app's design</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Database className="w-5 h-5 text-primary mt-0.5" />
              <div>
                <div className="font-medium">Local Storage</div>
                <div className="text-sm text-muted-foreground">SQLite transcript history</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-semibold mb-4">Platform Support</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="bg-card border rounded-lg p-4 text-center">
            <Code className="w-8 h-8 mx-auto mb-2 text-primary" />
            <div className="font-medium">React</div>
            <div className="text-sm text-muted-foreground">Web & Desktop</div>
          </div>
          <div className="bg-card border rounded-lg p-4 text-center">
            <Cpu className="w-8 h-8 mx-auto mb-2 text-primary" />
            <div className="font-medium">Swift</div>
            <div className="text-sm text-muted-foreground">macOS Native</div>
          </div>
          <div className="bg-card border rounded-lg p-4 text-center">
            <Layers className="w-8 h-8 mx-auto mb-2 text-primary" />
            <div className="font-medium">Tauri</div>
            <div className="text-sm text-muted-foreground">Cross-platform</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function InstallationSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">Installation</h1>
        <p className="text-xl text-muted-foreground">
          Get Scout up and running in your project
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-4">Prerequisites</h2>
          <div className="bg-card border rounded-lg p-6">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                <div>
                  <div className="font-medium">Node.js 18+</div>
                  <div className="text-sm text-muted-foreground">For React and Tauri projects</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                <div>
                  <div className="font-medium">Rust 1.70+</div>
                  <div className="text-sm text-muted-foreground">Required for Tauri backend</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                <div>
                  <div className="font-medium">Xcode 14+</div>
                  <div className="text-sm text-muted-foreground">For Swift/macOS development</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Package Installation</h2>
          
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-medium mb-2">React/TypeScript</h3>
              <Card>
                <CardContent className="p-4">
                  <PrismCode
                    code={`# Using npm
npm install @scout/react

# Using pnpm (recommended)
pnpm add @scout/react

# Using yarn
yarn add @scout/react`}
                    language="bash"
                  />
                </CardContent>
              </Card>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Swift Package Manager</h3>
              <Card>
                <CardContent className="p-4">
                  <PrismCode
                    code={`// Package.swift
dependencies: [
    .package(url: "https://github.com/arach/scout-swift", from: "1.0.0")
]

// In Xcode: File → Add Package Dependencies
// https://github.com/arach/scout-swift`}
                    language="swift"
                  />
                </CardContent>
              </Card>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Tauri Plugin</h3>
              <Card>
                <CardContent className="p-4">
                  <PrismCode
                    code={`# Frontend dependencies
pnpm add @scout/tauri

# Rust dependencies (src-tauri/Cargo.toml)
[dependencies]
scout-tauri = "1.0.0"`}
                    language="bash"
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Model Downloads</h2>
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5" />
              <div>
                <div className="font-medium text-amber-600 dark:text-amber-400">Important</div>
                <div className="text-sm text-amber-700 dark:text-amber-300">
                  Scout requires Whisper models to be downloaded before first use
                </div>
              </div>
            </div>
          </div>
          
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`# Download recommended models (base + small)
npx @scout/models download

# Download specific model
npx @scout/models download --model tiny
npx @scout/models download --model base
npx @scout/models download --model small

# List available models
npx @scout/models list`}
                language="bash"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Verification</h2>
          <p className="text-muted-foreground mb-4">
            Test your installation with our verification script:
          </p>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`npx @scout/verify`}
                language="bash"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function QuickStartSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">Quick Start</h1>
        <p className="text-xl text-muted-foreground">
          Get Scout running in your app in under 5 minutes
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-4">Step 1: Initialize Scout</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`import Scout from '@scout/react';

function App() {
  useEffect(() => {
    Scout.init({
      // Basic configuration
      theme: 'claude', // or 'cursor', 'raycast', 'custom'
      model: 'base',   // Whisper model size
      
      // Callbacks
      onTranscribe: (text: string) => {
        console.log('Transcribed:', text);
        // Send to your LLM or process the text
      },
      
      onError: (error: Error) => {
        console.error('Scout error:', error);
      }
    });
  }, []);

  return <YourApp />;
}`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Step 2: Add Voice Controls</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`function ChatInterface() {
  const [isRecording, setIsRecording] = useState(false);
  
  const startRecording = async () => {
    setIsRecording(true);
    await Scout.startRecording();
  };
  
  const stopRecording = async () => {
    const result = await Scout.stopRecording();
    setIsRecording(false);
    
    if (result.text) {
      // Process the transcribed text
      handleUserInput(result.text);
    }
  };

  return (
    <div>
      <button 
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        className="voice-btn"
      >
        {isRecording ? 'Recording...' : 'Hold to Speak'}
      </button>
    </div>
  );
}`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Step 3: Configure Global Hotkey</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`Scout.init({
  theme: 'claude',
  model: 'base',
  
  // Global hotkey configuration
  hotkey: {
    enabled: true,
    combination: 'Cmd+Shift+Space', // macOS
    // combination: 'Ctrl+Shift+Space', // Windows/Linux
  },
  
  onTranscribe: (text) => {
    // This will be called when hotkey is used
    handleVoiceInput(text);
  }
});`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Complete Example</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`import React, { useEffect, useState } from 'react';
import Scout from '@scout/react';

function VoiceEnabledApp() {
  const [messages, setMessages] = useState([]);
  const [isListening, setIsListening] = useState(false);

  useEffect(() => {
    Scout.init({
      theme: 'claude',
      model: 'base',
      hotkey: {
        enabled: true,
        combination: 'Cmd+Shift+Space'
      },
      
      onTranscribe: (text) => {
        // Add user message
        setMessages(prev => [...prev, { 
          role: 'user', 
          content: text 
        }]);
        
        // Send to your AI service
        sendToAI(text);
      },
      
      onRecordingStart: () => setIsListening(true),
      onRecordingStop: () => setIsListening(false),
      
      onError: (error) => {
        console.error('Voice error:', error);
      }
    });
  }, []);

  const sendToAI = async (text) => {
    // Your AI integration here
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    
    const result = await response.json();
    setMessages(prev => [...prev, { 
      role: 'assistant', 
      content: result.reply 
    }]);
  };

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={msg.role}>
            {msg.content}
          </div>
        ))}
      </div>
      
      {isListening && (
        <div className="listening-indicator">
          🎙️ Listening...
        </div>
      )}
    </div>
  );
}

export default VoiceEnabledApp;`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function ConfigurationSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">Configuration</h1>
        <p className="text-xl text-muted-foreground">
          Customize Scout to match your app's needs
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-4">Basic Configuration</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`interface ScoutConfig {
  // Theme settings
  theme: 'claude' | 'cursor' | 'raycast' | 'custom';
  customTheme?: ThemeConfig;
  
  // Model settings
  model: 'tiny' | 'base' | 'small' | 'medium' | 'large';
  modelPath?: string; // Custom model path
  
  // Recording settings
  sampleRate: number;        // Default: 16000
  channels: number;          // Default: 1 (mono)
  bufferDuration: number;    // Ring buffer size in seconds
  
  // Voice Activity Detection
  vad: {
    enabled: boolean;        // Default: true
    threshold: number;       // 0-1, default: 0.5
    minSilence: number;      // ms, default: 1000
    maxRecording: number;    // ms, default: 30000
  };
  
  // Global hotkey
  hotkey: {
    enabled: boolean;
    combination: string;     // e.g., 'Cmd+Shift+Space'
    mode: 'push-to-talk' | 'toggle';
  };
  
  // Storage
  storage: {
    enabled: boolean;        // Save transcripts
    maxEntries: number;      // Default: 1000
    path?: string;          // Custom database path
  };
  
  // Callbacks
  onTranscribe: (text: string, metadata: TranscribeMetadata) => void;
  onRecordingStart: () => void;
  onRecordingStop: () => void;
  onError: (error: Error) => void;
  onModelLoad: (model: string) => void;
}`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Theme Configuration</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// Built-in themes
Scout.init({
  theme: 'claude',    // Anthropic's Claude style
  theme: 'cursor',    // Cursor editor style
  theme: 'raycast',   // Raycast launcher style
});

// Custom theme
Scout.init({
  theme: 'custom',
  customTheme: {
    colors: {
      primary: '#8B5CF6',
      background: '#1F2937',
      surface: '#374151',
      text: '#F9FAFB',
      textSecondary: '#D1D5DB',
      accent: '#10B981',
      danger: '#EF4444'
    },
    
    overlay: {
      borderRadius: 12,
      backdropBlur: 20,
      shadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      padding: 24,
      maxWidth: 400
    },
    
    animations: {
      duration: 200,
      easing: 'ease-out',
      pulseScale: 1.05
    },
    
    fonts: {
      family: 'Inter, system-ui, sans-serif',
      sizes: {
        title: 18,
        body: 14,
        caption: 12
      }
    }
  }
});`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Voice Activity Detection</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`Scout.init({
  vad: {
    enabled: true,
    
    // Sensitivity (0-1, lower = more sensitive)
    threshold: 0.5,
    
    // Minimum silence before stopping (ms)
    minSilence: 1000,
    
    // Maximum recording duration (ms)
    maxRecording: 30000,
    
    // Minimum recording duration (ms)
    minRecording: 500,
    
    // Pre-recording buffer (ms)
    preRecording: 200,
    
    // Post-recording buffer (ms)  
    postRecording: 300
  }
});`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Environment Variables</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`# .env.local
SCOUT_MODEL_PATH=/path/to/custom/models
SCOUT_LOG_LEVEL=debug
SCOUT_STORAGE_PATH=/path/to/scout/data
SCOUT_DISABLE_TELEMETRY=true
SCOUT_VAD_THRESHOLD=0.6
SCOUT_MAX_RECORDING_DURATION=45000`}
                language="bash"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Runtime Configuration</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// Update configuration at runtime
Scout.updateConfig({
  theme: 'cursor',
  vad: { threshold: 0.7 }
});

// Get current configuration
const config = Scout.getConfig();

// Reset to defaults
Scout.resetConfig();

// Check if Scout is initialized
if (Scout.isInitialized()) {
  // Scout is ready to use
}`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function ReactSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">React Integration</h1>
        <p className="text-xl text-muted-foreground">
          Add voice capabilities to your React applications
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-4">Installation</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`pnpm add @scout/react`}
                language="bash"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Basic Setup</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`import React from 'react';
import { ScoutProvider, useScout } from '@scout/react';

function App() {
  return (
    <ScoutProvider
      config={{
        theme: 'claude',
        model: 'base',
        hotkey: {
          enabled: true,
          combination: 'Cmd+Shift+Space'
        }
      }}
    >
      <ChatApp />
    </ScoutProvider>
  );
}

function ChatApp() {
  const { isListening, transcript, error } = useScout();
  
  return (
    <div>
      {isListening && <div>🎙️ Listening...</div>}
      {transcript && <div>You said: {transcript}</div>}
      {error && <div>Error: {error.message}</div>}
    </div>
  );
}`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">useScout Hook</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`const {
  // State
  isListening,
  isRecording,
  transcript,
  error,
  isInitialized,
  
  // Actions
  startRecording,
  stopRecording,
  toggleRecording,
  
  // Configuration
  updateConfig,
  getConfig,
  
  // History
  getTranscripts,
  clearTranscripts,
  
  // Models
  loadModel,
  getAvailableModels
} = useScout();`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Voice Button Component</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`import { useScout } from '@scout/react';

function VoiceButton() {
  const { isRecording, startRecording, stopRecording } = useScout();
  
  return (
    <button
      className={\`voice-btn \$\{isRecording ? 'recording' : ''\}\`}
      onMouseDown={startRecording}
      onMouseUp={stopRecording}
      onMouseLeave={stopRecording} // Handle mouse leave
    >
      {isRecording ? (
        <>
          <span className="pulse" />
          Recording...
        </>
      ) : (
        <>
          🎙️ Hold to Speak
        </>
      )}
    </button>
  );
}

// CSS for pulse animation
const styles = \`
.voice-btn {
  position: relative;
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  background: #8B5CF6;
  color: white;
  cursor: pointer;
  transition: all 0.2s;
}

.voice-btn:hover {
  background: #7C3AED;
}

.voice-btn.recording {
  background: #EF4444;
}

.pulse {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 100%;
  height: 100%;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.3);
  transform: translate(-50%, -50%);
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0% { transform: translate(-50%, -50%) scale(1); }
  50% { transform: translate(-50%, -50%) scale(1.1); }
  100% { transform: translate(-50%, -50%) scale(1); }
}
\`;`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Advanced Example</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`import React, { useState, useCallback } from 'react';
import { useScout } from '@scout/react';

function AdvancedVoiceChat() {
  const [messages, setMessages] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const { 
    isListening, 
    transcript,
    startRecording,
    stopRecording,
    getTranscripts 
  } = useScout({
    onTranscribe: useCallback(async (text, metadata) => {
      setIsProcessing(true);
      
      // Add user message
      setMessages(prev => [...prev, {
        id: Date.now(),
        role: 'user',
        content: text,
        timestamp: new Date(),
        confidence: metadata.confidence,
        duration: metadata.duration
      }]);
      
      try {
        // Send to AI
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            message: text,
            history: messages.slice(-10) // Last 10 messages for context
          })
        });
        
        const result = await response.json();
        
        // Add AI response
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          role: 'assistant',
          content: result.reply,
          timestamp: new Date()
        }]);
        
      } catch (error) {
        console.error('AI request failed:', error);
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          role: 'error',
          content: 'Sorry, I had trouble processing that.',
          timestamp: new Date()
        }]);
      } finally {
        setIsProcessing(false);
      }
    }, [messages])
  });

  const handleKeyPress = useCallback((e) => {
    if (e.key === ' ' && e.ctrlKey) {
      e.preventDefault();
      if (isListening) {
        stopRecording();
      } else {
        startRecording();
      }
    }
  }, [isListening, startRecording, stopRecording]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((message) => (
          <div key={message.id} className={\`message \$\{message.role\}\`}>
            <div className="content">{message.content}</div>
            <div className="meta">
              {message.timestamp.toLocaleTimeString()}
              {message.confidence && (
                <span className="confidence">
                  {Math.round(message.confidence * 100)}%
                </span>
              )}
            </div>
          </div>
        ))}
        
        {isProcessing && (
          <div className="message processing">
            <div className="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}
      </div>

      <div className="input-area">
        {isListening && (
          <div className="listening-indicator">
            <div className="waveform">
              <span></span>
              <span></span>
              <span></span>
              <span></span>
            </div>
            <span>Listening... (release to send)</span>
          </div>
        )}
        
        <div className="controls">
          <button
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            className="voice-btn"
            disabled={isProcessing}
          >
            🎙️ Hold to Speak
          </button>
          
          <div className="help-text">
            Ctrl+Space to toggle • Cmd+Shift+Space for global hotkey
          </div>
        </div>
      </div>
    </div>
  );
}`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function SwiftSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">Swift/macOS Integration</h1>
        <p className="text-xl text-muted-foreground">
          Native Swift SDK for macOS applications
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-4">Installation</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// Package.swift
dependencies: [
    .package(url: "https://github.com/arach/scout-swift", from: "1.0.0")
],
targets: [
    .target(
        name: "YourApp",
        dependencies: [
            .product(name: "ScoutKit", package: "scout-swift")
        ]
    )
]`}
                language="swift"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Basic Setup</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`import SwiftUI
import ScoutKit

@main
struct YourApp: App {
    @StateObject private var scout = Scout.shared
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .onAppear {
                    configureScout()
                }
        }
    }
    
    private func configureScout() {
        scout.configure(
            theme: .claude,
            model: .base,
            hotkey: ScoutHotkey(
                enabled: true,
                combination: [.command, .shift],
                key: .space
            )
        )
        
        scout.onTranscribe = { text, metadata in
            // Handle transcription
            print("User said: \\(text)")
            handleUserInput(text)
        }
        
        scout.onError = { error in
            print("Scout error: \\(error)")
        }
    }
    
    private func handleUserInput(_ text: String) {
        // Send to your AI service or process the input
    }
}`}
                language="swift"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Voice Button Component</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`import SwiftUI
import ScoutKit

struct VoiceButton: View {
    @StateObject private var scout = Scout.shared
    @State private var isPressed = false
    
    var body: some View {
        Button(action: {}) {
            HStack {
                Image(systemName: scout.isRecording ? "mic.fill" : "mic")
                    .foregroundColor(scout.isRecording ? .red : .primary)
                
                Text(scout.isRecording ? "Recording..." : "Hold to Speak")
                    .font(.system(size: 14, weight: .medium))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(scout.isRecording ? Color.red.opacity(0.1) : Color.primary.opacity(0.1))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(scout.isRecording ? Color.red : Color.primary, lineWidth: 1)
            )
            .scaleEffect(isPressed ? 0.95 : 1.0)
        }
        .buttonStyle(PlainButtonStyle())
        .onLongPressGesture(
            minimumDuration: 0,
            maximumDistance: .infinity,
            pressing: { pressing in
                withAnimation(.easeInOut(duration: 0.1)) {
                    isPressed = pressing
                }
                
                if pressing {
                    scout.startRecording()
                } else {
                    scout.stopRecording()
                }
            },
            perform: {}
        )
    }
}`}
                language="swift"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Configuration Options</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// Theme configuration
Scout.shared.configure(
    theme: .custom(ScoutTheme(
        colors: ScoutColors(
            primary: NSColor.systemPurple,
            background: NSColor.controlBackgroundColor,
            surface: NSColor.controlColor,
            text: NSColor.labelColor,
            textSecondary: NSColor.secondaryLabelColor
        ),
        overlay: ScoutOverlay(
            borderRadius: 12,
            backdropMaterial: .hudWindow,
            shadow: NSShadow(),
            padding: 24,
            maxWidth: 400
        )
    ))
)

// Model configuration
Scout.shared.configure(
    model: .base,
    modelPath: "/custom/path/to/model"
)

// VAD configuration
Scout.shared.configure(
    vad: ScoutVAD(
        enabled: true,
        threshold: 0.5,
        minSilence: 1000,
        maxRecording: 30000
    )
)

// Storage configuration
Scout.shared.configure(
    storage: ScoutStorage(
        enabled: true,
        maxEntries: 1000,
        path: "/custom/path/to/db"
    )
)`}
                language="swift"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Advanced Usage</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`import SwiftUI
import ScoutKit

class ChatViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var isListening = false
    @Published var isProcessing = false
    
    private let scout = Scout.shared
    private let aiService = AIService()
    
    init() {
        setupScout()
    }
    
    private func setupScout() {
        scout.onTranscribe = { [weak self] text, metadata in
            Task { @MainActor in
                await self?.handleTranscription(text, metadata: metadata)
            }
        }
        
        scout.onRecordingStart = { [weak self] in
            Task { @MainActor in
                self?.isListening = true
            }
        }
        
        scout.onRecordingStop = { [weak self] in
            Task { @MainActor in
                self?.isListening = false
            }
        }
    }
    
    @MainActor
    private func handleTranscription(_ text: String, metadata: ScoutMetadata) async {
        // Add user message
        messages.append(ChatMessage(
            id: UUID(),
            role: .user,
            content: text,
            timestamp: Date(),
            confidence: metadata.confidence
        ))
        
        isProcessing = true
        
        do {
            // Send to AI service
            let response = try await aiService.sendMessage(
                text,
                history: Array(messages.suffix(10))
            )
            
            // Add AI response
            messages.append(ChatMessage(
                id: UUID(),
                role: .assistant,
                content: response.text,
                timestamp: Date()
            ))
            
        } catch {
            print("AI request failed: \\(error)")
            messages.append(ChatMessage(
                id: UUID(),
                role: .error,
                content: "Sorry, I had trouble processing that.",
                timestamp: Date()
            ))
        }
        
        isProcessing = false
    }
    
    func toggleRecording() {
        if scout.isRecording {
            scout.stopRecording()
        } else {
            scout.startRecording()
        }
    }
}

struct ChatView: View {
    @StateObject private var viewModel = ChatViewModel()
    
    var body: some View {
        VStack {
            ScrollView {
                LazyVStack(alignment: .leading) {
                    ForEach(viewModel.messages) { message in
                        MessageView(message: message)
                    }
                    
                    if viewModel.isProcessing {
                        TypingIndicatorView()
                    }
                }
                .padding()
            }
            
            HStack {
                if viewModel.isListening {
                    VoiceVisualizerView()
                    Text("Listening...")
                        .foregroundColor(.secondary)
                } else {
                    VoiceButton()
                        .onTapGesture {
                            viewModel.toggleRecording()
                        }
                }
            }
            .padding()
        }
    }
}`}
                language="swift"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Menu Bar Integration</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`import SwiftUI
import ScoutKit

class MenuBarController: NSObject {
    private var statusItem: NSStatusItem?
    private let scout = Scout.shared
    
    override init() {
        super.init()
        setupMenuBar()
        setupScout()
    }
    
    private func setupMenuBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        
        if let button = statusItem?.button {
            button.image = NSImage(systemSymbolName: "mic", accessibilityDescription: "Scout Voice")
            button.action = #selector(toggleRecording)
            button.target = self
        }
        
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Start Recording", action: #selector(startRecording), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Stop Recording", action: #selector(stopRecording), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Settings", action: #selector(openSettings), keyEquivalent: ","))
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q"))
        
        statusItem?.menu = menu
    }
    
    private func setupScout() {
        scout.configure(
            theme: .system,
            hotkey: ScoutHotkey(
                enabled: true,
                combination: [.command, .shift],
                key: .space
            )
        )
        
        scout.onRecordingStart = { [weak self] in
            self?.updateMenuBarIcon(recording: true)
        }
        
        scout.onRecordingStop = { [weak self] in
            self?.updateMenuBarIcon(recording: false)
        }
    }
    
    private func updateMenuBarIcon(recording: Bool) {
        DispatchQueue.main.async {
            self.statusItem?.button?.image = NSImage(
                systemSymbolName: recording ? "mic.fill" : "mic",
                accessibilityDescription: recording ? "Recording" : "Scout Voice"
            )
        }
    }
    
    @objc private func toggleRecording() {
        if scout.isRecording {
            scout.stopRecording()
        } else {
            scout.startRecording()
        }
    }
    
    @objc private func startRecording() {
        scout.startRecording()
    }
    
    @objc private func stopRecording() {
        scout.stopRecording()
    }
    
    @objc private func openSettings() {
        // Open settings window
    }
    
    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }
}`}
                language="swift"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function TauriSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">Tauri Integration</h1>
        <p className="text-xl text-muted-foreground">
          Cross-platform desktop apps with Scout
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-4">Installation</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`# Frontend
pnpm add @scout/tauri

# Backend (src-tauri/Cargo.toml)
[dependencies]
scout-tauri = "1.0.0"
tauri = { version = "2.0", features = ["api-all"] }`}
                language="bash"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Tauri Configuration</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// tauri.conf.json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; media-src 'self' data:"
    }
  },
  "bundle": {
    "resources": [
      "models/*"
    ]
  },
  "plugins": {
    "scout": {
      "theme": "claude",
      "model": "base",
      "hotkey": {
        "enabled": true,
        "combination": "CmdOrCtrl+Shift+Space"
      },
      "permissions": [
        "microphone",
        "global-shortcut"
      ]
    }
  },
  "tauri": {
    "allowlist": {
      "globalShortcut": {
        "all": true
      },
      "shell": {
        "all": false
      }
    }
  }
}`}
                language="json"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Rust Backend</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// src-tauri/src/main.rs
use tauri::Manager;
use scout_tauri::{Scout, ScoutConfig, ScoutTheme};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(Scout::init())
        .setup(|app| {
            let scout = app.state::<Scout>();
            
            // Configure Scout
            scout.configure(ScoutConfig {
                theme: ScoutTheme::Claude,
                model: scout_tauri::Model::Base,
                vad_enabled: true,
                vad_threshold: 0.5,
                hotkey_enabled: true,
                hotkey_combination: "CmdOrCtrl+Shift+Space".to_string(),
                storage_enabled: true,
                ..Default::default()
            })?;
            
            // Set up callbacks
            scout.on_transcribe(|text, metadata| {
                println!("Transcribed: {} (confidence: {:.2})", text, metadata.confidence);
                // Handle transcription
            });
            
            scout.on_error(|error| {
                eprintln!("Scout error: {}", error);
            });
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            get_transcript_history,
            update_scout_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Custom commands
#[tauri::command]
async fn start_recording(scout: tauri::State<'_, Scout>) -> Result<(), String> {
    scout.start_recording().await
        .map_err(|e| e.to_string())
}

#[tauri::command] 
async fn stop_recording(scout: tauri::State<'_, Scout>) -> Result<String, String> {
    let result = scout.stop_recording().await
        .map_err(|e| e.to_string())?;
    Ok(result.text)
}

#[tauri::command]
async fn get_transcript_history(scout: tauri::State<'_, Scout>) -> Result<Vec<scout_tauri::Transcript>, String> {
    scout.get_transcripts(100).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_scout_config(
    scout: tauri::State<'_, Scout>,
    config_update: scout_tauri::ConfigUpdate
) -> Result<(), String> {
    scout.update_config(config_update).await
        .map_err(|e| e.to_string())
}`}
                language="rust"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Frontend Integration</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// src/App.tsx
import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface TranscriptEvent {
  text: string;
  confidence: number;
  timestamp: string;
}

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Listen for transcription events
    const unlisten = listen<TranscriptEvent>('scout://transcribe', (event) => {
      setTranscript(event.payload.text);
      console.log('Transcribed:', event.payload);
    });

    // Listen for recording state changes
    const unlistenRecording = listen<{ recording: boolean }>('scout://recording', (event) => {
      setIsRecording(event.payload.recording);
    });

    // Listen for errors
    const unlistenError = listen<{ error: string }>('scout://error', (event) => {
      setError(event.payload.error);
    });

    return () => {
      unlisten.then(f => f());
      unlistenRecording.then(f => f());
      unlistenError.then(f => f());
    };
  }, []);

  const startRecording = async () => {
    try {
      await invoke('start_recording');
      setError(null);
    } catch (err) {
      setError(err as string);
    }
  };

  const stopRecording = async () => {
    try {
      const result = await invoke<string>('stop_recording');
      setTranscript(result);
    } catch (err) {
      setError(err as string);
    }
  };

  const getHistory = async () => {
    try {
      const history = await invoke<Array<{ text: string; timestamp: string }>>('get_transcript_history');
      console.log('Transcript history:', history);
    } catch (err) {
      setError(err as string);
    }
  };

  return (
    <div className="app">
      <h1>Scout Voice App</h1>
      
      {error && (
        <div className="error">
          Error: {error}
        </div>
      )}
      
      <div className="recording-area">
        {isRecording ? (
          <div className="recording">
            <div className="pulse" />
            <span>Recording... Release to stop</span>
          </div>
        ) : (
          <button
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            className="record-btn"
          >
            🎙️ Hold to Record
          </button>
        )}
      </div>
      
      {transcript && (
        <div className="transcript">
          <h3>Last Transcript:</h3>
          <p>{transcript}</p>
        </div>
      )}
      
      <div className="controls">
        <button onClick={getHistory}>
          View History
        </button>
      </div>
    </div>
  );
}

export default App;`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Custom Commands</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// Additional Tauri commands for Scout
#[tauri::command]
async fn configure_voice_commands(
    scout: tauri::State<'_, Scout>,
    commands: Vec<scout_tauri::VoiceCommand>
) -> Result<(), String> {
    scout.set_voice_commands(commands).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_available_models() -> Result<Vec<String>, String> {
    scout_tauri::get_available_models()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn switch_model(
    scout: tauri::State<'_, Scout>,
    model: String
) -> Result<(), String> {
    scout.switch_model(&model).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_recording_devices() -> Result<Vec<scout_tauri::AudioDevice>, String> {
    scout_tauri::get_audio_devices()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_recording_device(
    scout: tauri::State<'_, Scout>,
    device_id: String
) -> Result<(), String> {
    scout.set_audio_device(&device_id).await
        .map_err(|e| e.to_string())
}

// Frontend usage
const switchModel = async (model: string) => {
  try {
    await invoke('switch_model', { model });
    console.log(\`Switched to model: \$\{model\}\`);
  } catch (error) {
    console.error('Failed to switch model:', error);
  }
};

const configureCommands = async () => {
  await invoke('configure_voice_commands', {
    commands: [
      {
        phrase: "open settings",
        action: "open_settings",
        confidence_threshold: 0.8
      },
      {
        phrase: "clear chat",
        action: "clear_chat", 
        confidence_threshold: 0.7
      }
    ]
  });
};`}
                language="rust"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function ElectronSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">Electron Integration</h1>
        <p className="text-xl text-muted-foreground">
          Add Scout to your Electron applications
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-4">Installation</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`pnpm add @scout/electron`}
                language="bash"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Main Process Setup</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const { Scout } = require('@scout/electron');

let mainWindow;
let scout;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Initialize Scout
  scout = new Scout({
    theme: 'claude',
    model: 'base',
    hotkey: {
      enabled: true,
      combination: 'CommandOrControl+Shift+Space'
    }
  });

  // Set up Scout callbacks
  scout.onTranscribe((text, metadata) => {
    mainWindow.webContents.send('scout-transcribe', { text, metadata });
  });

  scout.onError((error) => {
    mainWindow.webContents.send('scout-error', { error: error.message });
  });

  scout.onRecordingStart(() => {
    mainWindow.webContents.send('scout-recording-start');
  });

  scout.onRecordingStop(() => {
    mainWindow.webContents.send('scout-recording-stop');
  });

  await scout.initialize();
  mainWindow.loadFile('index.html');
}

// IPC handlers
ipcMain.handle('scout-start-recording', async () => {
  try {
    await scout.startRecording();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('scout-stop-recording', async () => {
  try {
    const result = await scout.stopRecording();
    return { success: true, text: result.text };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('scout-get-transcripts', async (event, limit = 100) => {
  try {
    const transcripts = await scout.getTranscripts(limit);
    return { success: true, transcripts };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});`}
                language="javascript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Preload Script</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Expose Scout API to renderer process
contextBridge.exposeInMainWorld('scout', {
  // Methods
  startRecording: () => ipcRenderer.invoke('scout-start-recording'),
  stopRecording: () => ipcRenderer.invoke('scout-stop-recording'),
  getTranscripts: (limit) => ipcRenderer.invoke('scout-get-transcripts', limit),
  
  // Event listeners
  onTranscribe: (callback) => {
    ipcRenderer.on('scout-transcribe', (event, data) => callback(data));
  },
  
  onError: (callback) => {
    ipcRenderer.on('scout-error', (event, data) => callback(data));
  },
  
  onRecordingStart: (callback) => {
    ipcRenderer.on('scout-recording-start', callback);
  },
  
  onRecordingStop: (callback) => {
    ipcRenderer.on('scout-recording-stop', callback);
  },
  
  // Cleanup
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('scout-transcribe');
    ipcRenderer.removeAllListeners('scout-error');
    ipcRenderer.removeAllListeners('scout-recording-start');
    ipcRenderer.removeAllListeners('scout-recording-stop');
  }
});`}
                language="javascript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Renderer Process</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// renderer.js
class VoiceInterface {
  constructor() {
    this.isRecording = false;
    this.setupEventListeners();
    this.setupUI();
  }

  setupEventListeners() {
    // Scout events
    window.scout.onTranscribe(({ text, metadata }) => {
      this.handleTranscription(text, metadata);
    });

    window.scout.onError(({ error }) => {
      this.showError(error);
    });

    window.scout.onRecordingStart(() => {
      this.isRecording = true;
      this.updateUI();
    });

    window.scout.onRecordingStop(() => {
      this.isRecording = false;
      this.updateUI();
    });
  }

  setupUI() {
    const recordButton = document.getElementById('record-btn');
    
    recordButton.addEventListener('mousedown', async () => {
      const result = await window.scout.startRecording();
      if (!result.success) {
        this.showError(result.error);
      }
    });

    recordButton.addEventListener('mouseup', async () => {
      const result = await window.scout.stopRecording();
      if (!result.success) {
        this.showError(result.error);
      }
    });

    // Prevent context menu on record button
    recordButton.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  }

  handleTranscription(text, metadata) {
    console.log(\`Transcribed: \$\{text\} (confidence: \$\{metadata.confidence\})\`);
    
    // Add to chat or process the text
    this.addMessage('user', text);
    
    // Send to AI service
    this.processWithAI(text);
  }

  async processWithAI(text) {
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      
      const result = await response.json();
      this.addMessage('assistant', result.reply);
      
    } catch (error) {
      this.showError('Failed to process with AI: ' + error.message);
    }
  }

  addMessage(role, content) {
    const messagesContainer = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = \`message \$\{role\}\`;
    messageDiv.textContent = content;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  updateUI() {
    const recordButton = document.getElementById('record-btn');
    const statusIndicator = document.getElementById('status');
    
    if (this.isRecording) {
      recordButton.classList.add('recording');
      recordButton.textContent = '🔴 Recording...';
      statusIndicator.textContent = 'Listening...';
    } else {
      recordButton.classList.remove('recording');
      recordButton.textContent = '🎙️ Hold to Speak';
      statusIndicator.textContent = 'Ready';
    }
  }

  showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    
    setTimeout(() => {
      errorDiv.style.display = 'none';
    }, 5000);
  }

  async loadTranscriptHistory() {
    const result = await window.scout.getTranscripts(50);
    if (result.success) {
      result.transcripts.forEach(transcript => {
        this.addMessage('user', transcript.text);
      });
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const voiceInterface = new VoiceInterface();
  
  // Load transcript history
  voiceInterface.loadTranscriptHistory();
});

// Clean up on window unload
window.addEventListener('beforeunload', () => {
  window.scout.removeAllListeners();
});`}
                language="javascript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">HTML Template</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Scout Voice App</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background: #1a1a1a;
      color: #ffffff;
    }
    
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    
    #messages {
      height: 400px;
      overflow-y: auto;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 20px;
      background: #2a2a2a;
    }
    
    .message {
      margin-bottom: 12px;
      padding: 8px 12px;
      border-radius: 6px;
    }
    
    .message.user {
      background: #3b82f6;
      margin-left: 20%;
    }
    
    .message.assistant {
      background: #6366f1;
      margin-right: 20%;
    }
    
    .controls {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    
    #record-btn {
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      background: #8b5cf6;
      color: white;
      cursor: pointer;
      font-size: 16px;
      transition: all 0.2s;
    }
    
    #record-btn:hover {
      background: #7c3aed;
    }
    
    #record-btn.recording {
      background: #ef4444;
      animation: pulse 1s infinite;
    }
    
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.05); }
    }
    
    #status {
      font-size: 14px;
      color: #9ca3af;
    }
    
    #error {
      display: none;
      background: #ef4444;
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Scout Voice Chat</h1>
    
    <div id="messages"></div>
    
    <div class="controls">
      <button id="record-btn">🎙️ Hold to Speak</button>
      <span id="status">Ready</span>
    </div>
    
    <div id="error"></div>
  </div>
  
  <script src="renderer.js"></script>
</body>
</html>`}
                language="html"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

// Continue with other sections...
function VoiceCommandsSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">Voice Commands</h1>
        <p className="text-xl text-muted-foreground">
          Configure custom voice commands and actions
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-4">Basic Commands</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`Scout.configureCommands([
  {
    phrase: "clear chat",
    action: "clear_messages",
    confidence: 0.8
  },
  {
    phrase: "open settings", 
    action: "open_settings",
    confidence: 0.7
  },
  {
    phrase: "switch to dark mode",
    action: "toggle_theme",
    confidence: 0.8
  }
]);

// Handle command actions
Scout.onCommand((command, metadata) => {
  switch (command.action) {
    case 'clear_messages':
      clearChatMessages();
      break;
    case 'open_settings':
      openSettingsPanel();
      break;
    case 'toggle_theme':
      toggleAppTheme();
      break;
  }
});`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Dynamic Commands</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// Commands with parameters
Scout.configureCommands([
  {
    phrase: "switch to {theme}",
    action: "switch_theme",
    parameters: {
      theme: ["light", "dark", "auto"]
    }
  },
  {
    phrase: "set volume to {level}",
    action: "set_volume", 
    parameters: {
      level: ["low", "medium", "high", "max"]
    }
  },
  {
    phrase: "open {app}",
    action: "open_application",
    parameters: {
      app: ["finder", "terminal", "browser", "notes"]
    }
  }
]);

Scout.onCommand((command, metadata) => {
  console.log('Command:', command.action);
  console.log('Parameters:', command.parameters);
  
  switch (command.action) {
    case 'switch_theme':
      setTheme(command.parameters.theme);
      break;
    case 'set_volume':
      adjustVolume(command.parameters.level);
      break;
    case 'open_application':
      launchApp(command.parameters.app);
      break;
  }
});`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Context-Aware Commands</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// Commands that depend on application state
class CommandManager {
  private currentContext: string = 'general';
  
  updateContext(context: 'general' | 'chat' | 'settings' | 'editor') {
    this.currentContext = context;
    this.refreshCommands();
  }
  
  private refreshCommands() {
    const commands = this.getCommandsForContext(this.currentContext);
    Scout.configureCommands(commands);
  }
  
  private getCommandsForContext(context: string) {
    const baseCommands = [
      { phrase: "help", action: "show_help" },
      { phrase: "go back", action: "navigate_back" }
    ];
    
    switch (context) {
      case 'chat':
        return [
          ...baseCommands,
          { phrase: "clear chat", action: "clear_messages" },
          { phrase: "export chat", action: "export_conversation" },
          { phrase: "new conversation", action: "new_chat" }
        ];
        
      case 'editor':
        return [
          ...baseCommands,
          { phrase: "save file", action: "save_document" },
          { phrase: "find and replace", action: "open_find_replace" },
          { phrase: "format code", action: "format_document" }
        ];
        
      case 'settings':
        return [
          ...baseCommands,
          { phrase: "reset settings", action: "reset_preferences" },
          { phrase: "import settings", action: "import_config" },
          { phrase: "export settings", action: "export_config" }
        ];
        
      default:
        return baseCommands;
    }
  }
}

const commandManager = new CommandManager();

// Update context when navigating
function navigateToChat() {
  commandManager.updateContext('chat');
  // Navigate to chat view
}

function navigateToEditor() {
  commandManager.updateContext('editor'); 
  // Navigate to editor view
}`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Advanced Command Processing</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// Custom command processor with fuzzy matching
class AdvancedCommandProcessor {
  private commands: Map<string, CommandHandler> = new Map();
  
  registerCommand(phrase: string, handler: CommandHandler) {
    this.commands.set(phrase.toLowerCase(), handler);
  }
  
  processTranscription(text: string): boolean {
    const normalizedText = text.toLowerCase().trim();
    
    // Try exact match first
    if (this.commands.has(normalizedText)) {
      const handler = this.commands.get(normalizedText)!;
      handler.execute();
      return true;
    }
    
    // Try fuzzy matching
    const fuzzyMatch = this.findFuzzyMatch(normalizedText);
    if (fuzzyMatch && fuzzyMatch.confidence > 0.7) {
      fuzzyMatch.handler.execute();
      return true;
    }
    
    // Try intent classification
    const intent = this.classifyIntent(normalizedText);
    if (intent) {
      this.handleIntent(intent, normalizedText);
      return true;
    }
    
    return false; // No command found
  }
  
  private findFuzzyMatch(text: string) {
    let bestMatch = null;
    let bestScore = 0;
    
    for (const [phrase, handler] of this.commands) {
      const score = this.calculateSimilarity(text, phrase);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { handler, confidence: score };
      }
    }
    
    return bestMatch;
  }
  
  private calculateSimilarity(a: string, b: string): number {
    // Simple Levenshtein distance similarity
    const matrix = [];
    
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    const maxLength = Math.max(a.length, b.length);
    return (maxLength - matrix[b.length][a.length]) / maxLength;
  }
  
  private classifyIntent(text: string) {
    const intents = {
      navigation: /\b(go to|open|navigate|show me)\b/i,
      action: /\b(create|make|add|delete|remove)\b/i,
      query: /\b(what|how|when|where|why|find|search)\b/i,
      control: /\b(stop|start|pause|resume|play)\b/i
    };
    
    for (const [intent, pattern] of Object.entries(intents)) {
      if (pattern.test(text)) {
        return intent;
      }
    }
    
    return null;
  }
  
  private handleIntent(intent: string, text: string) {
    switch (intent) {
      case 'navigation':
        this.handleNavigation(text);
        break;
      case 'action':
        this.handleAction(text);
        break;
      case 'query':
        this.handleQuery(text);
        break;
      case 'control':
        this.handleControl(text);
        break;
    }
  }
  
  private handleNavigation(text: string) {
    // Extract destination from text and navigate
    console.log('Navigation intent:', text);
  }
  
  private handleAction(text: string) {
    // Extract action and perform it
    console.log('Action intent:', text);
  }
  
  private handleQuery(text: string) {
    // Process query and provide answer
    console.log('Query intent:', text);
  }
  
  private handleControl(text: string) {
    // Handle media/app control
    console.log('Control intent:', text);
  }
}

interface CommandHandler {
  execute(): void;
}

// Usage
const processor = new AdvancedCommandProcessor();

processor.registerCommand("clear chat", {
  execute: () => clearChatMessages()
});

processor.registerCommand("open settings", {
  execute: () => openSettingsPanel()
});

// Process transcriptions through the command processor
Scout.onTranscribe((text, metadata) => {
  const handled = processor.processTranscription(text);
  
  if (!handled) {
    // Fall back to regular transcription handling
    handleRegularTranscription(text, metadata);
  }
});`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

// I'll create a few more key sections, but will truncate for brevity
function TranscriptionSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">Transcription</h1>
        <p className="text-xl text-muted-foreground">
          Configure and optimize Whisper transcription
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-4">Model Selection</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// Available Whisper models
const models = {
  tiny: { size: '39MB', speed: 'fastest', accuracy: 'basic' },
  base: { size: '74MB', speed: 'fast', accuracy: 'good' },
  small: { size: '244MB', speed: 'medium', accuracy: 'better' },
  medium: { size: '769MB', speed: 'slow', accuracy: 'excellent' },
  large: { size: '1550MB', speed: 'slowest', accuracy: 'best' }
};

// Configure model
Scout.init({
  model: 'base', // Recommended for most apps
  modelOptions: {
    language: 'auto', // or 'en', 'es', 'fr', etc.
    temperature: 0.0, // Lower = more deterministic
    beamSize: 5,      // Higher = more accurate, slower
    patience: 1.0     // Early stopping patience
  }
});`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Quality Optimization</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// Optimize for your use case
Scout.configure({
  transcription: {
    // For conversations
    conversation: {
      model: 'base',
      temperature: 0.2,
      suppressTokens: [-1], // Remove silence tokens
      initialPrompt: "This is a casual conversation."
    },
    
    // For technical content
    technical: {
      model: 'small',
      temperature: 0.0,
      vocabulary: ['API', 'JavaScript', 'React', 'component'],
      initialPrompt: "Technical discussion about software development."
    },
    
    // For dictation
    dictation: {
      model: 'base',
      temperature: 0.1,
      wordTimestamps: true,
      punctuation: true,
      initialPrompt: "Dictating text with proper punctuation."
    }
  }
});`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function ThemingSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">Theming</h1>
        <p className="text-xl text-muted-foreground">
          Customize Scout's appearance to match your app
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-4">Built-in Themes</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-orange-600 rounded-lg mx-auto mb-3"></div>
                <h3 className="font-semibold">Claude</h3>
                <p className="text-sm text-muted-foreground">Anthropic's design language</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-400 to-blue-600 rounded-lg mx-auto mb-3"></div>
                <h3 className="font-semibold">Cursor</h3>
                <p className="text-sm text-muted-foreground">Editor-inspired theme</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-red-400 to-red-600 rounded-lg mx-auto mb-3"></div>
                <h3 className="font-semibold">Raycast</h3>
                <p className="text-sm text-muted-foreground">Launcher-style UI</p>
              </CardContent>
            </Card>
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Custom Theme</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`Scout.init({
  theme: 'custom',
  customTheme: {
    colors: {
      primary: '#8B5CF6',
      primaryHover: '#7C3AED',
      background: '#1F2937',
      surface: '#374151',
      text: '#F9FAFB',
      textSecondary: '#D1D5DB',
      accent: '#10B981',
      danger: '#EF4444',
      warning: '#F59E0B',
      success: '#10B981'
    },
    
    overlay: {
      borderRadius: 12,
      backdropBlur: 20,
      shadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)',
      padding: 24,
      maxWidth: 400,
      border: '1px solid rgba(255, 255, 255, 0.1)'
    },
    
    animations: {
      duration: 250,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      pulseScale: 1.05,
      slideDistance: 20
    },
    
    typography: {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: {
        title: 18,
        body: 14,
        caption: 12,
        button: 14
      },
      fontWeight: {
        normal: 400,
        medium: 500,
        semibold: 600,
        bold: 700
      }
    },
    
    spacing: {
      xs: 4,
      sm: 8,
      md: 16,
      lg: 24,
      xl: 32
    }
  }
});`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function APIReferenceSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">API Reference</h1>
        <p className="text-xl text-muted-foreground">
          Complete Scout SDK API documentation
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-4">Core Methods</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// Initialize Scout
Scout.init(config: ScoutConfig): Promise<void>

// Recording control
Scout.startRecording(): Promise<void>
Scout.stopRecording(): Promise<TranscriptionResult>
Scout.isRecording(): boolean

// Configuration
Scout.updateConfig(config: Partial<ScoutConfig>): void
Scout.getConfig(): ScoutConfig
Scout.resetConfig(): void

// Models
Scout.loadModel(model: WhisperModel): Promise<void>
Scout.getAvailableModels(): Promise<string[]>
Scout.switchModel(model: string): Promise<void>

// Storage
Scout.getTranscripts(limit?: number): Promise<Transcript[]>
Scout.searchTranscripts(query: string): Promise<Transcript[]>
Scout.clearTranscripts(): Promise<void>

// State
Scout.isInitialized(): boolean
Scout.getStatus(): ScoutStatus`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Type Definitions</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`interface ScoutConfig {
  theme: 'claude' | 'cursor' | 'raycast' | 'custom';
  customTheme?: ThemeConfig;
  model: 'tiny' | 'base' | 'small' | 'medium' | 'large';
  modelPath?: string;
  
  // Audio settings
  sampleRate: number; // Default: 16000
  channels: number;   // Default: 1
  bufferDuration: number; // Default: 30
  
  // VAD settings
  vad: {
    enabled: boolean;
    threshold: number;     // 0-1
    minSilence: number;    // ms
    maxRecording: number;  // ms
  };
  
  // Hotkey settings
  hotkey: {
    enabled: boolean;
    combination: string;
    mode: 'push-to-talk' | 'toggle';
  };
  
  // Callbacks
  onTranscribe: (text: string, metadata: TranscribeMetadata) => void;
  onRecordingStart: () => void;
  onRecordingStop: () => void;
  onError: (error: Error) => void;
}

interface TranscriptionResult {
  text: string;
  confidence: number;
  duration: number;
  timestamp: Date;
  segments?: Segment[];
}

interface TranscribeMetadata {
  confidence: number;
  duration: number;
  language: string;
  segments: Segment[];
}

interface Segment {
  start: number;
  end: number;
  text: string;
  confidence: number;
}`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function ExamplesSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">Examples</h1>
        <p className="text-xl text-muted-foreground">
          Real-world integration examples and code samples
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-4">AI Chat App</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// Complete AI chat application with Scout
import React, { useState, useEffect } from 'react';
import Scout from '@scout/react';

function AIChatApp() {
  const [messages, setMessages] = useState([]);
  const [isThinking, setIsThinking] = useState(false);

  useEffect(() => {
    Scout.init({
      theme: 'claude',
      model: 'base',
      hotkey: { enabled: true, combination: 'Cmd+Shift+Space' },
      
      onTranscribe: async (text, metadata) => {
        // Add user message
        const userMessage = {
          id: Date.now(),
          role: 'user',
          content: text,
          timestamp: new Date()
        };
        
        setMessages(prev => [...prev, userMessage]);
        setIsThinking(true);

        try {
          // Send to Claude API
          const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: text,
              history: messages.slice(-10)
            })
          });

          const result = await response.json();
          
          // Add AI response
          setMessages(prev => [...prev, {
            id: Date.now() + 1,
            role: 'assistant',
            content: result.content,
            timestamp: new Date()
          }]);

        } catch (error) {
          console.error('AI request failed:', error);
        } finally {
          setIsThinking(false);
        }
      }
    });
  }, [messages]);

  return (
    <div className="chat-app">
      <div className="messages">
        {messages.map(msg => (
          <div key={msg.id} className={\`message \$\{msg.role\}\`}>
            {msg.content}
          </div>
        ))}
        {isThinking && <div className="thinking">AI is thinking...</div>}
      </div>
    </div>
  );
}`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Code Editor Integration</h2>
          <Card>
            <CardContent className="p-4">
              <PrismCode
                code={`// Voice-controlled code editor
class VoiceCodeEditor {
  constructor() {
    this.editor = monaco.editor.create(document.getElementById('editor'));
    this.setupScout();
  }

  setupScout() {
    Scout.init({
      theme: 'cursor',
      model: 'small', // Better for technical terms
      
      onTranscribe: (text) => {
        this.processVoiceCommand(text);
      }
    });

    Scout.configureCommands([
      { phrase: "new function", action: "create_function" },
      { phrase: "add comment", action: "add_comment" },
      { phrase: "format code", action: "format_code" },
      { phrase: "find {term}", action: "find_text" }
    ]);

    Scout.onCommand((command) => {
      this.executeEditorCommand(command);
    });
  }

  processVoiceCommand(text) {
    // Check if it's a code generation request
    if (text.includes('create') || text.includes('generate')) {
      this.generateCode(text);
    } else {
      // Insert as comment or code
      this.insertText(text);
    }
  }

  generateCode(description) {
    // Send to code generation API
    fetch('/api/generate-code', {
      method: 'POST',
      body: JSON.stringify({ description })
    })
    .then(response => response.json())
    .then(result => {
      this.editor.executeEdits('voice-insert', [{
        range: this.editor.getSelection(),
        text: result.code
      }]);
    });
  }
}`}
                language="typescript"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

// Placeholder sections for completeness
function HotkeysSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">Global Hotkeys</h1>
        <p className="text-xl text-muted-foreground">
          Configure system-wide voice activation
        </p>
      </div>
      
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">
            Detailed hotkey configuration documentation would go here...
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function ArchitectureSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">Architecture</h1>
        <p className="text-xl text-muted-foreground">
          Understanding Scout's internal architecture
        </p>
      </div>
      
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">
            Architecture overview and diagrams would go here...
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function PerformanceSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">Performance</h1>
        <p className="text-xl text-muted-foreground">
          Optimization tips and benchmarks
        </p>
      </div>
      
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">
            Performance optimization guide would go here...
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function TroubleshootingSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">Troubleshooting</h1>
        <p className="text-xl text-muted-foreground">
          Common issues and solutions
        </p>
      </div>
      
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">
            Troubleshooting guide would go here...
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function MigrationSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">Migration Guide</h1>
        <p className="text-xl text-muted-foreground">
          Upgrading between Scout versions
        </p>
      </div>
      
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">
            Migration guide would go here...
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function ModelsSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-4">Whisper Models</h1>
        <p className="text-xl text-muted-foreground">
          Available models and their characteristics
        </p>
      </div>
      
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">
            Model comparison and selection guide would go here...
          </p>
        </CardContent>
      </Card>
    </div>
  )
}