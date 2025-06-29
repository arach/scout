#import <Foundation/Foundation.h>
#import "app_context-Swift.h"

const char* get_active_app_name() {
    @autoreleasepool {
        NSString *appName = [ActiveAppDetector getActiveAppName];
        if (appName) {
            return strdup([appName UTF8String]);
        }
        return NULL;
    }
}

const char* get_active_app_bundle_id() {
    @autoreleasepool {
        NSString *bundleId = [ActiveAppDetector getActiveAppBundleId];
        if (bundleId) {
            return strdup([bundleId UTF8String]);
        }
        return NULL;
    }
}

void free_app_string(const char* ptr) {
    if (ptr) {
        free((void*)ptr);
    }
}