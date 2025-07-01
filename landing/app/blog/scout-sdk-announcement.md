# Introducing Scout SDK: The Voice Layer for Desktop Apps

*January 30, 2025*

Today we're excited to announce Scout SDK — an embeddable voice layer that brings intelligent, local-first voice capabilities to any desktop application. 

## The Problem

Every modern productivity app needs voice input. Users expect to talk to their tools like they talk to Siri or Alexa. But building good voice UX is incredibly hard:

- Recording audio with proper buffering
- Managing system permissions and hotkeys  
- Creating beautiful, responsive UI overlays
- Integrating transcription engines
- Handling errors gracefully
- Making it feel native to YOUR app

Most teams either skip voice entirely or ship a subpar experience.

## Enter Scout SDK

Scout SDK is a complete voice layer you can embed in your app in minutes. One line of code gives you:

- 🎙️ **Beautiful native overlay** themed to match your app
- ⌨️ **Global hotkey activation** (Cmd+Shift+Space by default)
- 🔄 **Ring buffer recording** to capture speech before activation
- 🧠 **Local Whisper transcription** with <300ms latency
- 🎨 **Customizable everything** — UI, sounds, behaviors

```typescript
import Scout from '@scout/sdk';

Scout.init({
  theme: 'claude',
  onTranscribe: (text) => {
    // Send to your LLM or process locally
  }
});
```

That's it. Your app now has world-class voice input.

## Built for Modern Apps

Scout is designed for the new generation of AI-native desktop apps:

### For AI Assistants like Claude
- Natural conversation input
- Context-aware transcription  
- Ring buffer captures full thoughts
- Beautiful overlay that matches Claude's aesthetic

### For Developer Tools like Cursor
- Voice-driven code generation
- Command parsing ("generate a React component")
- IDE-native feel
- Zero configuration

### For Launchers like Raycast
- Quick voice commands
- Action dispatching
- Instant activation
- Minimal UI footprint

## Local First, Privacy Always

Scout processes everything on-device:
- Audio never leaves your machine
- Works offline
- No cloud dependencies
- Open source and auditable

## Model Agnostic Architecture

Scout handles the voice layer. You handle the intelligence:
- Works with any LLM (Claude, GPT, Llama)
- Or use standalone for transcription
- Pluggable command parsing
- Flexible integration points

## Available Today

Scout SDK is available in developer preview:

```bash
npm install @scout/sdk
```

Check out:
- [Documentation](https://scout-app.dev/docs)
- [Integration Guide](https://scout-app.dev/sdk)  
- [Example Apps](https://github.com/scout-voice/examples)

## What's Next

We're working with amazing partners to bring Scout to apps you use every day. If you're building a desktop app and want to add voice, we'd love to chat: partnerships@scout-app.dev

Voice is the future of computer interaction. Scout makes that future accessible to every developer, today.

---

*Scout started as a standalone transcription app. As we talked to users, we realized the real opportunity: helping every desktop app add voice. Scout SDK is our answer to that challenge.*

Ready to add voice to your app? [Get started →](https://scout-app.dev/sdk)