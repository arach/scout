// Overlay dimensions configuration
// These should match the values in src-tauri/src/lib.rs
export const OVERLAY_DIMENSIONS = {
  expanded: {
    width: 180,
    height: 44,
  },
  minimized: {
    width: 48,
    height: 16,
  },
} as const;

// Overlay animation durations
export const OVERLAY_ANIMATION = {
  transitionDuration: 400, // milliseconds
  completeDisplayDuration: 1000, // milliseconds
} as const;