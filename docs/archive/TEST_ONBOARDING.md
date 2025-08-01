# Testing Onboarding Flow

## Quick Steps to Test:

1. **Open Scout** in development mode if not already running:
   ```bash
   pnpm tauri dev
   ```

2. **Open Browser DevTools** (Right-click → Inspect → Console)

3. **Clear the onboarding flag**:
   ```javascript
   localStorage.removeItem('scout-onboarding-complete')
   ```

4. **Refresh the app** (Cmd+R)

## What Was Fixed:

- **Event Listener Errors**: Fixed multiple issues with event listeners being created during onboarding
- **Conditional Hook Execution**: Hooks now skip initialization when onboarding is showing
- **Proper Cleanup**: All event listeners now have proper cleanup logic

## Expected Behavior:

- Onboarding flow should appear without errors
- You should see 4 steps: Model Download → Microphone Permission → Shortcuts → Tour
- No more "undefined is not an object" errors in the console

## If You Still See Errors:

1. Check the console for which specific events are failing
2. The errors might be from other parts of the app trying to communicate
3. Most importantly: The onboarding should still work despite any remaining console errors