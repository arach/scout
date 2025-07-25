# How to Open DevTools for the Overlay Window

The overlay window is a separate window from the main app, so it has its own console. Here are several ways to access it:

## Method 1: Keyboard Shortcut (If enabled)
- Focus the overlay window (click on it)
- Try Cmd+Option+I (Mac) or Ctrl+Shift+I (Windows/Linux)

## Method 2: Enable DevTools in Development
Add this to your overlay window initialization in Rust:

```rust
// In src-tauri/src/lib.rs, after showing the overlay window
#[cfg(debug_assertions)]
overlay_window.open_devtools();
```

## Method 3: Right-click Context Menu
- When the overlay is visible, try right-clicking on it
- Select "Inspect Element" if available

## Method 4: Programmatically Open DevTools
We can add a temporary command to open the overlay DevTools.

## Method 5: Use Terminal Logs Instead
Since backend logs work, we can emit events to the backend and log there.

## Quick Test Without DevTools

If you see a red border appear on the overlay for 2 seconds after starting the app, then the code changes are working but you just can't see the console output.

The red border test I added will:
1. Show a 2px solid red border on the overlay window
2. Remove it after 2 seconds

This will confirm if the new code is running.