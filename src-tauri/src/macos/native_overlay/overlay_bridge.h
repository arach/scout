#ifndef OVERLAY_BRIDGE_H
#define OVERLAY_BRIDGE_H

#ifdef __cplusplus
extern "C" {
#endif

// Show the native overlay window
void native_overlay_show(void);

// Hide the native overlay window
void native_overlay_hide(void);

// Set recording state (true = recording, false = not recording)
void native_overlay_set_recording_state(bool recording);

// Set processing state (true = processing, false = not processing)
void native_overlay_set_processing_state(bool processing);

// Set idle state
void native_overlay_set_idle_state(void);

// Set callback for when recording starts
void native_overlay_set_start_recording_callback(void (*callback)(void));

// Set callback for when recording stops
void native_overlay_set_stop_recording_callback(void (*callback)(void));

// Set callback for when recording is cancelled
void native_overlay_set_cancel_recording_callback(void (*callback)(void));

// Set volume level for waveform display
void native_overlay_set_volume_level(float level);

#ifdef __cplusplus
}
#endif

#endif /* OVERLAY_BRIDGE_H */