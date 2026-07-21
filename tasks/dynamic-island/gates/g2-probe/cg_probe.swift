import CoreGraphics
import AppKit
import Foundation
// Legacy CoreGraphics capture path (pre-SCK). Deprecated on macOS 14/15+. Does it still yield pixels?
let img = CGWindowListCreateImage(CGRect(x:0,y:0,width:200,height:200), .optionOnScreenOnly, kCGNullWindowID, .bestResolution)
if let img = img {
    let w = img.width, h = img.height
    // pull a pixel or two
    let ns = NSBitmapImageRep(cgImage: img)
    let p = ns.colorAt(x: 10, y: 10)
    print("CGWindowListCreateImage: image \(w)x\(h) pixel(10,10)=\(String(describing: p))")
} else {
    print("CGWindowListCreateImage: nil (blocked or empty)")
}
