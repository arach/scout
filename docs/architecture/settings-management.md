# Scout Settings Management Architecture

This document describes the settings management system in Scout, including frontend-backend communication, persistence, and common integration patterns.

## Overview

Scout uses a centralized settings system that synchronizes configuration between the frontend React application and the Rust backend via Tauri commands. Settings are persisted to disk and automatically loaded on application startup.

## Architecture Components

### Backend (Rust/Tauri)

**Core Module:** `src-tauri/src/commands/settings.rs`

The backend provides the following Tauri commands for settings management:

```rust
// Get current settings
#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<Settings>

// Update settings - IMPORTANT: Parameter is named `newSettings` not `settings`
#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppState>,
    newSettings: Settings  // Note the camelCase parameter name
) -> Result<()>
```

**Key Implementation Details:**
- Settings are stored in `AppState` using `Arc<RwLock<Settings>>`
- Persistence is handled via `settings.json` in the app's config directory
- The `update_settings` command expects a parameter named `newSettings` (camelCase)

### Frontend (React/TypeScript)

**Core Hook:** `src/hooks/useSettings.ts`

The frontend manages settings through a custom React hook that:
1. Fetches initial settings on mount
2. Provides methods to update settings
3. Handles loading and error states

```typescript
// Correct usage - parameter must be named 'newSettings'
await invoke('update_settings', { newSettings: updatedSettings })

// INCORRECT - this will fail silently
await invoke('update_settings', { settings: updatedSettings })  // ❌ Wrong parameter name
```

## Settings Structure

```typescript
interface Settings {
  transcription: {
    mode: 'integrated' | 'advanced'  // Integrated = Whisper, Advanced = External service
    model: string
    language: string
    external: {
      enabled: boolean
      host: string
      port: number
      workers: number
    }
  }
  audio: {
    vad_enabled: boolean
    min_recording_duration_ms: number
    sample_rate: number
  }
  ui: {
    auto_copy: boolean
    auto_paste: boolean
    profanity_filter_enabled: boolean
    profanity_filter_aggressive: boolean
  }
  shortcuts: {
    record: string
    stop: string
  }
}
```

## Common Integration Patterns

### Updating Settings from Components

```typescript
// Example from TranscriptionSettings.tsx
const handleModeChange = async (newMode: 'integrated' | 'advanced') => {
  const updatedSettings = {
    ...settings,
    transcription: {
      ...settings.transcription,
      mode: newMode,
      external: {
        ...settings.transcription.external,
        enabled: newMode === 'advanced'
      }
    }
  }
  
  // CRITICAL: Use 'newSettings' as the parameter name
  await invoke('update_settings', { newSettings: updatedSettings })
}
```

### Parameter Naming Convention

Due to how Tauri serializes parameters between JavaScript and Rust, the parameter names must match exactly:

- **Frontend (JavaScript):** Uses camelCase (`newSettings`)
- **Backend (Rust):** Parameter defined as `newSettings` in snake_case context
- **Tauri Bridge:** Expects exact match of parameter name

## Known Issues and Solutions

### Issue: Settings Not Persisting When Switching Modes

**Problem:** When users switched between "Integrated" (internal Whisper) and "Advanced" (external transcriber) modes, the settings weren't persisting.

**Root Cause:** Parameter name mismatch in the `invoke` call. Components were using `{ settings: ... }` instead of `{ newSettings: ... }`.

**Solution:** Ensure all `update_settings` invocations use the correct parameter name:

```typescript
// ✅ Correct
await invoke('update_settings', { newSettings: updatedSettings })

// ❌ Incorrect (will fail silently)
await invoke('update_settings', { settings: updatedSettings })
```

**Affected Files Fixed:**
- `src/components/TranscriptionSettings.tsx`
- `src/components/settings/FoundationModelsSettings.tsx`

## Debugging Settings Issues

### Enable Debug Logging

In `src-tauri/src/commands/settings.rs`, debug logging has been added:

```rust
#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppState>,
    newSettings: Settings,
) -> Result<()> {
    debug!("Updating settings: {:?}", newSettings);
    // ... rest of implementation
}
```

### Check Browser Console

Look for Tauri command errors:
```javascript
// Browser DevTools Console
[Error] Failed to invoke 'update_settings': missing field 'newSettings'
```

### Verify Settings File

Check the persisted settings file:
```bash
# macOS
cat ~/Library/Application\ Support/com.scout.transcriber/settings.json

# Linux
cat ~/.config/scout/settings.json

# Windows
type %APPDATA%\scout\settings.json
```

## Best Practices

### 1. Always Use the Correct Parameter Name

When calling `update_settings`, always use `newSettings`:

```typescript
// Create a wrapper function to enforce correct usage
async function updateSettings(settings: Settings) {
  return await invoke('update_settings', { newSettings: settings })
}
```

### 2. Validate Settings Before Saving

```typescript
const isValidSettings = (settings: Settings): boolean => {
  // Validate required fields
  if (!settings.transcription?.mode) return false
  if (!settings.audio?.sample_rate) return false
  return true
}

if (isValidSettings(updatedSettings)) {
  await invoke('update_settings', { newSettings: updatedSettings })
}
```

### 3. Handle Errors Gracefully

```typescript
try {
  await invoke('update_settings', { newSettings: updatedSettings })
  toast.success('Settings saved successfully')
} catch (error) {
  console.error('Failed to save settings:', error)
  toast.error('Failed to save settings. Please try again.')
}
```

### 4. Use TypeScript for Type Safety

Define types for Tauri commands:

```typescript
// src/lib/tauri-commands.ts
import { invoke as tauriInvoke } from '@tauri-apps/api/tauri'

export const updateSettings = (settings: Settings) => 
  tauriInvoke('update_settings', { newSettings: settings })

export const getSettings = () => 
  tauriInvoke<Settings>('get_settings')
```

## Migration Guide

If you're updating existing code that uses settings:

1. **Search for all `update_settings` invocations:**
   ```bash
   grep -r "invoke.*update_settings" src/
   ```

2. **Update parameter name from `settings` to `newSettings`:**
   ```diff
   - await invoke('update_settings', { settings: mySettings })
   + await invoke('update_settings', { newSettings: mySettings })
   ```

3. **Test the changes:**
   - Switch between Integrated and Advanced modes
   - Verify settings persist after app restart
   - Check settings.json file for updates

## Future Improvements

1. **Type-safe Tauri bindings:** Generate TypeScript definitions from Rust commands
2. **Settings validation:** Add schema validation on both frontend and backend
3. **Settings migration:** Handle version upgrades and schema changes
4. **Settings profiles:** Allow users to save and switch between different configurations
5. **Settings sync:** Cloud backup and sync across devices (opt-in)

## Related Documentation

- [Transcription Architecture](./transcription-architecture.md) - Details on transcription modes
- [Frontend Components Guide](../development/frontend-components.md) - Component patterns
- [Tauri Commands Reference](../development/tauri-commands.md) - All available commands

---

*Last updated: 2025-08-22 - Added documentation for settings persistence fix and parameter naming requirements*