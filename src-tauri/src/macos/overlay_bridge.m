#import <Foundation/Foundation.h>
#import <Cocoa/Cocoa.h>
#import "overlay-Swift.h"

// C interface for Rust FFI
void* create_overlay_window() {
    NSLog(@"create_overlay_window called from Rust");
    MacOSOverlay* overlay = [[MacOSOverlay alloc] init];
    NSLog(@"MacOSOverlay created: %@", overlay);
    return (__bridge_retained void*)overlay;
}

void show_overlay_window(void* overlay) {
    NSLog(@"show_overlay_window called from Rust");
    MacOSOverlay* obj = (__bridge MacOSOverlay*)overlay;
    dispatch_async(dispatch_get_main_queue(), ^{
        NSLog(@"Calling showOverlay on MacOSOverlay object");
        [obj showOverlay];
    });
}

void minimize_overlay_window(void* overlay) {
    MacOSOverlay* obj = (__bridge MacOSOverlay*)overlay;
    dispatch_async(dispatch_get_main_queue(), ^{
        [obj minimizeOverlay];
    });
}

void position_overlay_window(void* overlay, double x, double y) {
    MacOSOverlay* obj = (__bridge MacOSOverlay*)overlay;
    dispatch_async(dispatch_get_main_queue(), ^{
        [obj positionOverlay:x y:y];
    });
}

void ensure_overlay_visible(void* overlay) {
    MacOSOverlay* obj = (__bridge MacOSOverlay*)overlay;
    dispatch_async(dispatch_get_main_queue(), ^{
        [obj ensureVisible];
    });
}

void set_overlay_position(void* overlay, const char* position) {
    MacOSOverlay* obj = (__bridge MacOSOverlay*)overlay;
    NSString* pos = [NSString stringWithUTF8String:position];
    dispatch_async(dispatch_get_main_queue(), ^{
        [obj setOverlayPosition:pos];
    });
}

void update_overlay_progress(void* overlay, const char* progress_state) {
    MacOSOverlay* obj = (__bridge MacOSOverlay*)overlay;
    NSString* state = [NSString stringWithUTF8String:progress_state];
    dispatch_async(dispatch_get_main_queue(), ^{
        [obj updateProgress:state];
    });
}

void destroy_overlay_window(void* overlay) {
    // Release the retained reference
    MacOSOverlay* obj = (__bridge_transfer MacOSOverlay*)overlay;
    // The assignment consumes the reference, preventing the warning
    (void)obj;
}