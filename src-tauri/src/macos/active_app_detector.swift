import Cocoa
import Foundation

@objc public class ActiveAppDetector: NSObject {
    @objc public static func getCurrentActiveApp() -> NSDictionary? {
        guard let workspace = NSWorkspace.shared.frontmostApplication else {
            return nil
        }
        
        let appInfo: [String: Any] = [
            "name": workspace.localizedName ?? "Unknown",
            "bundleId": workspace.bundleIdentifier ?? "",
            "path": workspace.bundleURL?.path ?? "",
            "processId": workspace.processIdentifier
        ]
        
        return appInfo as NSDictionary
    }
    
    @objc public static func getActiveAppName() -> String? {
        return NSWorkspace.shared.frontmostApplication?.localizedName
    }
    
    @objc public static func getActiveAppBundleId() -> String? {
        return NSWorkspace.shared.frontmostApplication?.bundleIdentifier
    }
}