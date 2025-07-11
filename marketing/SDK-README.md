# Scout SDK - Voice UX for Desktop Apps

Scout is an embeddable voice layer that brings intelligent, model-agnostic voice capabilities to any desktop application. Built for AI-native tools like Claude, Cursor, and Raycast.

## 🚀 Quick Start

```bash
npm install @scout/sdk
# or
yarn add @scout/sdk
# or
pnpm add @scout/sdk
```

## 💻 Integration Examples

### React/Electron

```typescript
import { Scout } from '@scout/sdk';

function App() {
  useEffect(() => {
    Scout.init({
      theme: 'minimal', // or 'claude', 'cursor', 'custom'
      hotkey: 'CommandOrControl+Shift+Space',
      onTranscribe: async (text, metadata) => {
        console.log('Transcribed:', text);
        // Send to your LLM or process locally
      },
      onStateChange: (state) => {
        console.log('Scout state:', state); // 'idle', 'listening', 'processing'
      }
    });
  }, []);

  return <YourApp />;
}
```

### Swift/macOS

```swift
import ScoutKit

@main
struct MyApp: App {
    @StateObject private var scout = Scout.shared
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .onAppear {
                    scout.configure(
                        theme: .claude,
                        hotkey: .init(key: .space, modifiers: [.command, .shift])
                    )
                    
                    scout.onTranscribe = { transcription in
                        // Handle voice input
                    }
                }
        }
    }
}
```

### Tauri

```rust
use scout_tauri::Scout;

fn main() {
    tauri::Builder::default()
        .plugin(
            Scout::builder()
                .theme("claude")
                .on_transcribe(|text| {
                    // Handle transcription
                })
                .build()
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## 🎨 Themes

Scout comes with pre-built themes that match popular apps:

- `minimal` - Clean, distraction-free overlay
- `claude` - Matches Claude's design language
- `cursor` - Cursor-style command palette
- `raycast` - Raycast-inspired quick actions
- `custom` - Build your own theme

## 🛠 API Reference

### Core Methods

```typescript
// Initialize Scout
Scout.init(config: ScoutConfig): Promise<void>

// Programmatic control
Scout.startListening(): void
Scout.stopListening(): void
Scout.destroy(): void

// State
Scout.isListening: boolean
Scout.isProcessing: boolean

// Events
Scout.on('transcribe', callback)
Scout.on('error', callback)
Scout.on('stateChange', callback)
```

### Configuration

```typescript
interface ScoutConfig {
  // Appearance
  theme?: 'minimal' | 'claude' | 'cursor' | 'raycast' | 'custom'
  position?: 'top' | 'bottom' | 'center'
  
  // Behavior
  hotkey?: string
  autoStop?: boolean // Stop on silence
  ringBuffer?: boolean // Capture pre-hotkey audio
  
  // Processing
  model?: 'whisper-tiny' | 'whisper-base' | 'whisper-small'
  language?: string
  
  // Callbacks
  onTranscribe?: (text: string, metadata: TranscriptMetadata) => void
  onCommand?: (command: ParsedCommand) => void
  onError?: (error: Error) => void
  onStateChange?: (state: ScoutState) => void
}
```

## 🏗 Architecture

Scout is built with:
- **Tauri** - Native window management and system integration
- **Swift** (macOS) - Native overlay and hotkey handling
- **Whisper.cpp** - Local transcription engine
- **Ring Buffer** - Capture audio before activation

## 📦 Package Structure

```
@scout/sdk          # Full SDK with UI
@scout/core         # Core functionality only
@scout/react        # React components and hooks
@scout/swift        # Swift package
@scout/tauri        # Tauri plugin
```

## 🤝 Examples

### Claude-style Assistant

```typescript
Scout.init({
  theme: 'claude',
  position: 'bottom',
  onTranscribe: async (text) => {
    const response = await callClaude(text);
    displayResponse(response);
  }
});
```

### Code Generation with Cursor

```typescript
Scout.init({
  theme: 'cursor',
  onCommand: (command) => {
    if (command.intent === 'generate') {
      generateCode(command.parameters);
    }
  }
});
```

### Raycast Quick Actions

```typescript
Scout.init({
  theme: 'raycast',
  onTranscribe: (text) => {
    const action = parseAction(text);
    executeAction(action);
  }
});
```

## 🔐 Privacy

- All processing happens locally
- No telemetry or analytics
- Audio never leaves the device
- Open source and auditable

## 📄 License

MIT License - use Scout in your commercial applications!

## 🤔 Why Scout?

Building voice UX is hard. Scout handles:
- ✅ Native overlay UI
- ✅ Global hotkeys
- ✅ Ring buffer recording
- ✅ Whisper transcription
- ✅ Beautiful animations
- ✅ Cross-platform support

So you can focus on what makes your app unique.

---

Ready to add voice to your app? [Get started →](https://scout-app.dev/sdk)