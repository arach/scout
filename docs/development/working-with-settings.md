# Working with Settings in Scout

This guide helps developers understand and work with Scout's settings system, avoiding common pitfalls and following best practices.

## Quick Reference

### ✅ Correct Usage

```typescript
// Always use 'newSettings' as the parameter name
await invoke('update_settings', { newSettings: updatedSettings })
```

### ❌ Common Mistakes

```typescript
// Wrong parameter name - will fail silently
await invoke('update_settings', { settings: updatedSettings })

// Wrong casing - will fail
await invoke('update_settings', { new_settings: updatedSettings })

// Missing await - settings won't be saved
invoke('update_settings', { newSettings: updatedSettings })  // No await!
```

## Understanding the Settings Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   React UI   │────▶│ Tauri Bridge │────▶│ Rust Backend │
│              │     │              │     │              │
│ useSettings  │     │   invoke()   │     │update_settings│
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                     │
       │                    │                     ▼
       │                    │              ┌──────────────┐
       │                    │              │settings.json │
       │                    │              └──────────────┘
       │                    │                     │
       └────────────────────┴─────────────────────┘
                     (Settings Flow)
```

## Step-by-Step: Adding a New Setting

### 1. Update the Settings Type (Frontend)

**File:** `src/types/settings.ts`

```typescript
export interface Settings {
  transcription: {
    mode: 'integrated' | 'advanced'
    model: string
    language: string
    // Add your new setting here
    myNewFeature: boolean  // NEW
    external: {
      enabled: boolean
      host: string
      port: number
      workers: number
    }
  }
  // ... other settings
}
```

### 2. Update the Settings Struct (Backend)

**File:** `src-tauri/src/settings.rs`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionSettings {
    pub mode: TranscriptionMode,
    pub model: String,
    pub language: String,
    pub my_new_feature: bool,  // NEW - note snake_case in Rust
    pub external: ExternalSettings,
}
```

### 3. Add Default Value

**File:** `src-tauri/src/settings.rs`

```rust
impl Default for TranscriptionSettings {
    fn default() -> Self {
        Self {
            mode: TranscriptionMode::Integrated,
            model: "tiny.en".to_string(),
            language: "en".to_string(),
            my_new_feature: false,  // NEW - provide default
            external: ExternalSettings::default(),
        }
    }
}
```

### 4. Create UI Component

**File:** `src/components/settings/MyNewFeatureSettings.tsx`

```typescript
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useSettings } from '@/hooks/useSettings'
import { invoke } from '@tauri-apps/api/tauri'

export function MyNewFeatureSettings() {
  const { settings, loading, refetch } = useSettings()
  
  const handleToggle = async (enabled: boolean) => {
    const updatedSettings = {
      ...settings,
      transcription: {
        ...settings.transcription,
        myNewFeature: enabled
      }
    }
    
    try {
      // CRITICAL: Use 'newSettings' parameter name
      await invoke('update_settings', { newSettings: updatedSettings })
      await refetch()  // Refresh settings from backend
    } catch (error) {
      console.error('Failed to update settings:', error)
      // Show error toast or handle error appropriately
    }
  }
  
  if (loading) return <div>Loading...</div>
  
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="my-new-feature"
        checked={settings.transcription.myNewFeature}
        onCheckedChange={handleToggle}
      />
      <Label htmlFor="my-new-feature">
        Enable My New Feature
      </Label>
    </div>
  )
}
```

## Common Patterns

### Pattern 1: Grouped Settings Update

When updating multiple related settings at once:

```typescript
const updateTranscriptionSettings = async (updates: Partial<TranscriptionSettings>) => {
  const updatedSettings = {
    ...settings,
    transcription: {
      ...settings.transcription,
      ...updates
    }
  }
  
  await invoke('update_settings', { newSettings: updatedSettings })
}

// Usage
await updateTranscriptionSettings({
  mode: 'advanced',
  model: 'medium.en',
  language: 'es'
})
```

### Pattern 2: Settings with Side Effects

When a setting change requires additional actions:

```typescript
const handleModeChange = async (newMode: 'integrated' | 'advanced') => {
  // Update the setting
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
  
  await invoke('update_settings', { newSettings: updatedSettings })
  
  // Perform side effects
  if (newMode === 'advanced') {
    // Start external service
    await invoke('start_external_service')
  } else {
    // Stop external service
    await invoke('stop_external_service')
  }
  
  await refetch()
}
```

### Pattern 3: Validation Before Save

```typescript
const updateSettingsWithValidation = async (newSettings: Settings) => {
  // Validate settings
  if (newSettings.transcription.external.port < 1024) {
    throw new Error('Port must be >= 1024')
  }
  
  if (!isValidHost(newSettings.transcription.external.host)) {
    throw new Error('Invalid host address')
  }
  
  // Save if valid
  await invoke('update_settings', { newSettings })
}
```

## Testing Settings

### Unit Testing (Frontend)

```typescript
// Mock the Tauri invoke function
jest.mock('@tauri-apps/api/tauri', () => ({
  invoke: jest.fn()
}))

describe('Settings Update', () => {
  it('should use correct parameter name', async () => {
    const mockSettings = { /* ... */ }
    
    await updateSettings(mockSettings)
    
    expect(invoke).toHaveBeenCalledWith('update_settings', {
      newSettings: mockSettings  // Verify correct parameter name
    })
  })
})
```

### Integration Testing

```typescript
// Test that settings persist across app restarts
it('should persist settings after restart', async () => {
  // Update setting
  await updateSettings({ 
    transcription: { mode: 'advanced' } 
  })
  
  // Simulate app restart
  await restartApp()
  
  // Verify setting persisted
  const settings = await getSettings()
  expect(settings.transcription.mode).toBe('advanced')
})
```

## Debugging Settings Issues

### 1. Check Browser Console

Look for Tauri errors:
```
[Error] Command update_settings failed: missing field `newSettings`
```

### 2. Enable Backend Logging

In `src-tauri/src/commands/settings.rs`:

```rust
use log::debug;

#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppState>,
    newSettings: Settings,
) -> Result<()> {
    debug!("Received settings update: {:?}", newSettings);
    // ... rest of implementation
}
```

### 3. Inspect Settings File

```bash
# View current settings
cat ~/Library/Application\ Support/com.scout.transcriber/settings.json | jq '.'

# Watch for changes
fswatch ~/Library/Application\ Support/com.scout.transcriber/settings.json
```

### 4. Use Developer Tools

```typescript
// Add temporary debug logging
const debugUpdateSettings = async (settings: Settings) => {
  console.log('Updating settings:', settings)
  const result = await invoke('update_settings', { newSettings: settings })
  console.log('Update result:', result)
  return result
}
```

## Troubleshooting Checklist

If settings aren't working as expected, check:

- [ ] Parameter name is exactly `newSettings` (camelCase)
- [ ] Using `await` with the invoke call
- [ ] Settings object structure matches TypeScript interface
- [ ] Backend Rust struct matches frontend TypeScript type
- [ ] Default values are provided for new settings
- [ ] Settings file has correct permissions
- [ ] No JSON parsing errors in settings file
- [ ] Component calls `refetch()` after update
- [ ] Error handling is in place

## Migration Guide for Existing Code

If you're fixing existing settings code:

1. **Find all update_settings calls:**
   ```bash
   rg "invoke.*update_settings" --type ts --type tsx
   ```

2. **Check parameter names:**
   ```bash
   # Find potentially incorrect usage
   rg "invoke.*update_settings.*\{.*settings:" --type ts
   ```

3. **Update to use newSettings:**
   ```diff
   - await invoke('update_settings', { settings: mySettings })
   + await invoke('update_settings', { newSettings: mySettings })
   ```

## Best Practices Summary

1. **Always use `newSettings` as the parameter name** when calling `update_settings`
2. **Await all invoke calls** to ensure settings are saved
3. **Call `refetch()`** after updates to sync UI with backend
4. **Handle errors gracefully** with try-catch blocks
5. **Validate settings** before saving
6. **Test both happy path and error cases**
7. **Document any setting dependencies** or side effects
8. **Use TypeScript** for type safety
9. **Keep settings structure flat** when possible for easier updates
10. **Version your settings schema** for future migrations

## Related Resources

- [Settings Management Architecture](../architecture/settings-management.md)
- [Tauri Command Reference](./tauri-commands.md)
- [Frontend Components Guide](./frontend-components.md)
- [Testing Guide](./testing-guide.md)

---

*Remember: The parameter name `newSettings` is critical for the update_settings command to work correctly!*