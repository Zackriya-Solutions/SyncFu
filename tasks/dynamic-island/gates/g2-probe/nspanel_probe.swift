import AppKit
import Foundation

// Mirror overlay/panel.rs NSPanel config: nonactivating, floating, canJoinAllSpaces+fullScreenAuxiliary.
// Apply sharingType BEFORE first show (apply-first ordering guard). Read it back.

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let protectOn = CommandLine.arguments.contains("--protect")
let rect = NSRect(x: 200, y: 400, width: 400, height: 120)

let panel = NSPanel(
    contentRect: rect,
    styleMask: [.nonactivatingPanel, .borderless],
    backing: .buffered,
    defer: false
)
panel.isFloatingPanel = true
panel.level = .statusBar
panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
panel.hidesOnDeactivate = false
panel.isOpaque = true
panel.backgroundColor = NSColor(red: 1, green: 0, blue: 1, alpha: 1) // magenta

let v = NSView(frame: NSRect(origin: .zero, size: rect.size))
v.wantsLayer = true
v.layer?.backgroundColor = NSColor(red: 1, green: 0, blue: 1, alpha: 1).cgColor
panel.contentView = v

// APPLY-FIRST: set sharing type before ordering the window on screen
func stName(_ t: NSWindow.SharingType) -> String {
    switch t { case .none: return "none(0)"; case .readOnly: return "readOnly(1)"; case .readWrite: return "readWrite(2)"; @unknown default: return "unknown" }
}
print("default sharingType (fresh NSPanel): \(stName(panel.sharingType))")
if protectOn {
    panel.sharingType = .none   // == set_content_protected(true) mechanism
}
print("applied protect=\(protectOn) -> sharingType now: \(stName(panel.sharingType))")

panel.orderFrontRegardless()
print("panel shown: isVisible=\(panel.isVisible) frame=\(panel.frame) onActiveSpace=\(panel.isOnActiveSpace)")
print("post-show read-back sharingType: \(stName(panel.sharingType))  <-- READ-BACK IS INSUFFICIENT AS PROOF")
print("collectionBehavior raw: \(panel.collectionBehavior.rawValue)")

// keep it up briefly so an external capture could run
RunLoop.main.run(until: Date().addingTimeInterval(1.5))
print("done")
