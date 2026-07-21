import ScreenCaptureKit
import AppKit
import Foundation

// Just check the API surface compiles and permission state.
if #available(macOS 14.0, *) {
    print("SCK available at compile+runtime")
    let sema = DispatchSemaphore(value: 0)
    SCShareableContent.getWithCompletionHandler { content, err in
        if let err = err {
            print("PERMISSION_OR_ERROR: \(err.localizedDescription)")
        } else if let content = content {
            print("SHAREABLE_DISPLAYS: \(content.displays.count) WINDOWS: \(content.windows.count)")
        }
        sema.signal()
    }
    _ = sema.wait(timeout: .now() + 8)
} else {
    print("SCK not available")
}
