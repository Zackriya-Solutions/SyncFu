//! G1 spike probe (throwaway, not shipped). Reads physical notch geometry from
//! NSScreen on the MAIN THREAD and prints boring.notch's derived notchWidth.
//!
//! Run: CARGO_TARGET_DIR=/Users/sujith/work/2025/syncfu/target \
//!      cargo run --example notch_probe -p syncfu
//!
//! `main()` runs on the process main thread, so MainThreadMarker::new() succeeds
//! without any Tauri/AppKit event loop. This mirrors the run_on_main_thread
//! discipline in src-tauri/src/overlay/panel.rs (NSScreen is MainThreadOnly).

#[cfg(target_os = "macos")]
fn main() {
    use objc2_app_kit::NSScreen;
    use objc2_foundation::MainThreadMarker;

    let mtm = MainThreadMarker::new()
        .expect("notch_probe must run on the main thread (NSScreen is MainThreadOnly)");

    let screens = NSScreen::screens(mtm);
    println!("NSScreen count: {}", screens.len());

    for (i, screen) in screens.iter().enumerate() {
        let frame = screen.frame();
        let insets = screen.safeAreaInsets();
        // objc2 returns a plain NSRect here, NOT Swift's `NSRect?`. On a non-notch
        // display these are NSZeroRect (all zeros), so nil is observed as width==0.
        let aux_left = screen.auxiliaryTopLeftArea();
        let aux_right = screen.auxiliaryTopRightArea();

        let has_notch = insets.top > 0.0;
        // boring.notch: notchWidth = screen.width - auxLeft - auxRight + 4
        let notch_width = frame.size.width - aux_left.size.width - aux_right.size.width + 4.0;

        println!("--- screen[{i}] ---");
        println!("  frame:            {:.0} x {:.0}", frame.size.width, frame.size.height);
        println!(
            "  safeAreaInsets:   top={:.1} left={:.1} right={:.1} bottom={:.1}",
            insets.top, insets.left, insets.right, insets.bottom
        );
        println!(
            "  auxTopLeftArea:   {:.1} x {:.1} @ ({:.1},{:.1})",
            aux_left.size.width, aux_left.size.height, aux_left.origin.x, aux_left.origin.y
        );
        println!(
            "  auxTopRightArea:  {:.1} x {:.1} @ ({:.1},{:.1})",
            aux_right.size.width, aux_right.size.height, aux_right.origin.x, aux_right.origin.y
        );
        println!("  has_notch:        {has_notch}");
        if has_notch {
            println!("  => notchWidth:    {notch_width:.1} pt");
        } else {
            println!("  => no notch; fallback capsule ~185 x 32");
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("notch_probe: macOS only. On Windows/Linux use the floating-capsule fallback (~185 x 32).");
}
