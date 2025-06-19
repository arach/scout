# Overlay Hover Behavior

## Current Implementation

The Scout overlay window supports hover interactions to show recording controls. Due to macOS system limitations, the hover behavior has the following characteristics:

### Initial Setup
- When Scout first starts, the overlay appears as a small pill at the top of your screen
- **First interaction**: Click the overlay once to enable hover detection
- After the initial click, hover will work even when Scout is not the active application

### Hover Behavior
- Hover over the minimized overlay to expand it and show the recording controls
- Move your mouse away to collapse it back to the minimized state
- The overlay only expands when in idle state (not recording or processing)

### Technical Limitations

macOS restricts mouse event handling for windows that don't have focus. Regular NSWindow objects (which Tauri uses) cannot receive mouse events when the application is not active. Only NSPanel windows with specific configurations can achieve true hover-without-focus behavior.

### Workarounds Attempted

1. **Native Window Configuration**: Modified the NSWindow properties using Objective-C runtime
   - Set window level to floating
   - Configured collection behavior for mouse events
   - Result: Partial improvement but still requires initial click

2. **Global Mouse Tracking**: JavaScript-based mouse position monitoring
   - Tracks mouse movement globally
   - Compares position with window bounds
   - Result: Limited by browser security restrictions

3. **Custom Mouse Event Handling**: Enhanced mouse event detection
   - Uses both standard mouse events and custom tracking
   - Provides fallback for better reliability

### Future Improvements

To achieve true hover-without-focus behavior would require:
- Creating a custom NSPanel window type instead of NSWindow
- Deep integration with Tauri's window management system
- Or using a native companion app for the overlay

For now, the single-click activation provides a good balance between functionality and implementation complexity.