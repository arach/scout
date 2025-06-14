#import <Foundation/Foundation.h>
#import <Cocoa/Cocoa.h>
#import "overlay-Swift.h"

// C interface for Rust FFI
void* create_overlay_window() {
    MacOSOverlay* overlay = [[MacOSOverlay alloc] init];
    return (__bridge_retained void*)overlay;
}

void show_overlay_window(void* overlay) {
    MacOSOverlay* obj = (__bridge MacOSOverlay*)overlay;
    dispatch_async(dispatch_get_main_queue(), ^{
        [obj showOverlay];
    });
}

void hide_overlay_window(void* overlay) {
    MacOSOverlay* obj = (__bridge MacOSOverlay*)overlay;
    dispatch_async(dispatch_get_main_queue(), ^{
        [obj hideOverlay];
    });
}

void position_overlay_window(void* overlay, double x, double y) {
    MacOSOverlay* obj = (__bridge MacOSOverlay*)overlay;
    dispatch_async(dispatch_get_main_queue(), ^{
        [obj positionOverlay:x y:y];
    });
}

void destroy_overlay_window(void* overlay) {
    // Release the retained reference
    MacOSOverlay* obj = (__bridge_transfer MacOSOverlay*)overlay;
    // The assignment consumes the reference, preventing the warning
    (void)obj;
}