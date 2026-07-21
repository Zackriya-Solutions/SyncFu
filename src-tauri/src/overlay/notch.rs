//! macOS notch geometry, read from public `NSScreen` APIs (notarization-safe).
//!
//! Verified on real hardware by gate G1 (see `tasks/dynamic-island/gates/G1-verdict.md`):
//! on a built-in notched panel `safeAreaInsets().top > 0` signals a notch, and the physical
//! cutout width follows boring.notch's formula
//! `frame.width - auxiliaryTopLeftArea.width - auxiliaryTopRightArea.width + 4`.
//! Non-notch displays surface `NSZeroRect` (all zeros), not a panic and not `None`, so notch
//! presence is a value check, never an unwrap.
//!
//! `NSScreen` is `MainThreadOnly`; every accessor is gated by a `MainThreadMarker`. Callers MUST
//! be on the main thread (obtain the marker inside `AppHandle::run_on_main_thread`, mirroring the
//! NSPanel dispatch in `panel.rs`). Off the main thread `MainThreadMarker::new()` returns `None`.

/// Notch geometry for a single built-in notched display, in AppKit points.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NotchGeometry {
    pub screen_width: f64,
    /// Physical cutout width in points (boring.notch formula).
    pub notch_width: f64,
}

/// Pure boring.notch formula: the physical cutout width from the display frame width and the two
/// menu-bar strips flanking the notch. The `+ 4` fudge widens the value so a capsule slightly
/// overhangs the cutout (matches boring.notch). Verified against G1's hardware measurement:
/// `1470 - 646 - 645 + 4 = 183`.
pub fn notch_width_from(screen_width: f64, aux_left_width: f64, aux_right_width: f64) -> f64 {
    screen_width - aux_left_width - aux_right_width + 4.0
}

/// Read the geometry of the built-in notched display, or `None` when no attached display has a
/// notch (non-notch Mac, external-only, or the target is an external monitor). Callers use the
/// floating-capsule fallback on `None`.
///
/// Iterates `screens(mtm)` and selects the display whose `safeAreaInsets().top > 0.0`. Never uses
/// `mainScreen()`, which follows key-window focus and can be the external monitor (G1).
pub fn notch_geometry(mtm: objc2_foundation::MainThreadMarker) -> Option<NotchGeometry> {
    use objc2_app_kit::NSScreen;

    NSScreen::screens(mtm).iter().find_map(|screen| {
        if screen.safeAreaInsets().top <= 0.0 {
            return None; // non-notch display -> caller uses the floating-capsule fallback
        }
        let frame = screen.frame();
        let l = screen.auxiliaryTopLeftArea().size.width;
        let r = screen.auxiliaryTopRightArea().size.width;
        Some(NotchGeometry {
            screen_width: frame.size.width,
            notch_width: notch_width_from(frame.size.width, l, r),
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_notch_width_matches_g1_hardware_measurement() {
        // G1 measured on a real MacBook built-in panel: 1470-wide frame, aux strips 646 and 645.
        assert_eq!(notch_width_from(1470.0, 646.0, 645.0), 183.0);
    }

    #[test]
    fn test_notch_width_zero_aux_is_frame_plus_fudge() {
        // A degenerate all-zero (NSZeroRect) input yields only the +4 fudge; presence is gated by
        // safeAreaInsets upstream, so this value is never anchored on for a non-notch display.
        assert_eq!(notch_width_from(1920.0, 0.0, 0.0), 1924.0);
    }
}
