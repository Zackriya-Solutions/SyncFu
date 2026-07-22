//! Cursor-tracking for the under-notch island pill (T13): click-through interactivity toggle plus
//! the hover-reveal that slides the collapsed second-notch pill down when the physical notch is
//! hovered.
//!
//! The island frame is created click-through (`ignore_cursor_events(true)`) so the transparent
//! envelope never eats clicks. This module polls the cursor at ~10Hz WHILE notifications exist and
//! flips the window interactive only while the cursor is inside the frontend-reported shape hitbox,
//! restoring click-through otherwise. It ALSO drives the reveal: in notch mode the collapsed pill is
//! concealed - the frontend shows a minimal AMBIENT WINGS indicator in its place (T14) - until the
//! cursor enters the backend-computed hover region (the physical cutout PLUS the ambient wings that
//! flank it, grown by a margin), then the pill slides down; leaving both the region AND the pill for
//! `GRACE` conceals it back to the ambient wings (`island:reveal` event).
//!
//! Lifecycle (R-PERF): the poll is spawned by `show_island` and stopped by `hide_island`. The island
//! window is shown for exactly as long as a notification exists (reveal is CSS-only and NEVER hides
//! the window), so "poll while the window is shown" == "poll while snapshot count > 0". A hidden
//! (count 0) island costs zero idle CPU.
//!
//! COORDINATE CONVENTION (T13 fix, empirically verified on real hardware - see the probe numbers in
//! the tests below). `panel::get_cursor_position` returns `CGEvent::location`, which is in Quartz
//! GLOBAL DISPLAY POINTS (logical, top-left origin) - NOT physical pixels. `window.outer_position()`
//! returns PHYSICAL pixels. The T12 code compared `(cursor - origin_physical) / scale`, mixing a
//! logical cursor with a physical origin; on any Retina (2x) display the result was wrong and the
//! window never became interactive ("still not touchable"). The fix converts the window origin to
//! LOGICAL (`outer_position / scale`) and compares everything in logical points, end to end - the
//! same space the frontend's `getBoundingClientRect` hitbox already lives in.
//!
//! NOTE (fixed in T17): `panel::get_cursor_monitor_info` used to compare this same logical-points
//! cursor against `monitor.position()`/`size()` (PHYSICAL pixels); on a Retina secondary monitor
//! those spaces disagreed and cursor->monitor selection could pick the wrong display. It now divides
//! each monitor's bounds by its own scale and compares in logical points, the same convention proven
//! here.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use super::island::{set_island_interactive, ISLAND_LABEL};
use super::panel::get_cursor_position;

/// Poll interval (~10Hz). Cheap while notifications exist; never runs while the island is hidden.
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Grace after the cursor leaves both the notch region and the pill before the reveal conceals, so a
/// brief overshoot on the way to the pill does not flicker it away.
const REVEAL_GRACE: Duration = Duration::from_millis(400);

/// Slop (logical px) added around the physical cutout so the reveal triggers a touch before the
/// cursor is exactly over the ~183x32 cutout (fat-finger / fast-cursor margin).
pub const NOTCH_MARGIN: f64 = 8.0;

/// Half-width (logical px) of ONE ambient wing that flanks the physical cutout while the pill is
/// concealed (T14). The visible ambient shape is `cutout_width + 2 * AMBIENT_WING` wide, so the hover
/// region must span the wings too - hovering the visible thing is what triggers the reveal. MUST stay
/// in sync with the frontend `AMBIENT_WING` in `src/lib/islandMorph.ts` (they size the same shape).
pub const AMBIENT_WING: f64 = 24.0;

/// Event the backend emits (scoped to the island window) when the reveal state flips. Payload is a
/// bool: true == slide the collapsed pill down (revealed), false == slide it back up (concealed, the
/// frontend then shows the ambient wings indicator instead).
const REVEAL_EVENT: &str = "island:reveal";

/// Event the backend emits (scoped to the island window) when the cursor enters/leaves the visible
/// shape (the pill/card hitbox). Payload is a bool: true == hovering the island. The frontend uses it
/// to PAUSE auto-dismiss while the island is hovered, matching the card's JS hover-pause (the card
/// polls the cursor against its own rect; the island reuses this already-running backend tracker
/// because its click-through envelope makes DOM hover unreliable, T13).
const HOVER_EVENT: &str = "island:hover";

/// An axis-aligned rectangle in window-relative LOGICAL pixels (x, y from the window's top-left).
/// Used both for the frontend shape hitbox and the backend-computed physical-notch region.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Hitbox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// The frontend-reported shape hitbox (the true morphing-shape bounds). `None` until first reported.
static HITBOX: Mutex<Option<Hitbox>> = Mutex::new(None);
/// The backend-computed physical-notch region (window-relative logical). `Some` only in notch mode
/// with a known cutout; `None` in float / non-notch mode (no reveal there - the pill stays visible).
static NOTCH_REGION: Mutex<Option<Hitbox>> = Mutex::new(None);
/// Whether the poll loop is running (tied to island visibility == count > 0). Guards double-spawn.
static POLLING: AtomicBool = AtomicBool::new(false);
/// The last interactive state we applied, so we only dispatch a main-thread toggle on a real change.
static INTERACTIVE: AtomicBool = AtomicBool::new(false);
/// The reveal state machine (notch mode). Starts concealed; a fresh arrival announces EXPANDED, which
/// the frontend keeps visible regardless of this flag, so a concealed start never hides an arrival.
static REVEAL: Mutex<RevealMachine> = Mutex::new(RevealMachine::CONCEALED);

/// Reveal state: whether the pill is currently revealed, plus a pending conceal deadline once the
/// cursor has left the hot zone (the notch region ∪ the pill).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RevealMachine {
    pub revealed: bool,
    pub deadline: Option<Instant>,
}

impl RevealMachine {
    const CONCEALED: RevealMachine = RevealMachine {
        revealed: false,
        deadline: None,
    };
}

/// Pure containment test in logical, window-relative space.
pub fn point_in_rect(point: (f64, f64), r: Hitbox) -> bool {
    // Half-open interval [x, x+w): the far/bottom edges are exclusive.
    point.0 >= r.x && point.0 < r.x + r.w && point.1 >= r.y && point.1 < r.y + r.h
}

/// Convert a global-logical cursor and a PHYSICAL window origin into a window-relative LOGICAL point.
/// This is the T13 coordinate-convention fix: `cursor` is already logical (Quartz points), so only
/// the window origin needs dividing by `scale`; the difference is then logical. A non-positive scale
/// (never expected) yields `None` and the caller fails closed (stays click-through / concealed).
pub fn window_relative(
    cursor_logical: (f64, f64),
    window_origin_physical: (f64, f64),
    scale: f64,
) -> Option<(f64, f64)> {
    if scale <= 0.0 {
        return None;
    }
    Some((
        cursor_logical.0 - window_origin_physical.0 / scale,
        cursor_logical.1 - window_origin_physical.1 / scale,
    ))
}

/// Compute the physical-notch hover region in window-relative LOGICAL px. The island window is
/// horizontally centered on the monitor, so the cutout center is exactly `envelope_width / 2`. The
/// region spans the cutout PLUS one ambient `wing` on each side (so hovering the visible ambient
/// wings that flank the cutout triggers the reveal, T14), all grown by `margin` on the sides and
/// bottom, with its top at the window top (y = 0, the screen top edge - no point extending above it).
/// The wings are the same height as the cutout, so `notch_height + margin` already covers them.
pub fn notch_region(
    envelope_width: f64,
    notch_width: f64,
    notch_height: f64,
    wing: f64,
    margin: f64,
) -> Hitbox {
    let center_x = envelope_width / 2.0;
    let half = notch_width / 2.0 + wing + margin;
    Hitbox {
        x: center_x - half,
        y: 0.0,
        w: notch_width + 2.0 * (wing + margin),
        h: notch_height + margin,
    }
}

/// Pure reveal transition. `in_hot` is "cursor inside the notch region OR the pill". Entering the hot
/// zone reveals immediately and clears any pending conceal; leaving it starts (or continues) the
/// grace countdown and only conceals once `now` reaches the deadline. Concealed + out-of-zone stays
/// concealed. Deterministic in `now`, so the grace is unit-testable without real time.
pub fn reveal_step(m: RevealMachine, in_hot: bool, now: Instant, grace: Duration) -> RevealMachine {
    if in_hot {
        RevealMachine {
            revealed: true,
            deadline: None,
        }
    } else if m.revealed {
        let deadline = m.deadline.unwrap_or(now + grace);
        if now >= deadline {
            RevealMachine::CONCEALED
        } else {
            RevealMachine {
                revealed: true,
                deadline: Some(deadline),
            }
        }
    } else {
        RevealMachine::CONCEALED
    }
}

/// Store the latest shape hitbox reported by the frontend. Replaces any previous value.
pub fn set_hitbox(hb: Hitbox) {
    if let Ok(mut guard) = HITBOX.lock() {
        *guard = Some(hb);
    }
}

/// Set (or clear) the physical-notch hover region. `Some` in notch mode with a known cutout enables
/// the reveal; `None` (float / non-notch) disables it so the pill stays visible there. Called from
/// `island.rs` on show / reflow, after settings + geometry are read on the main thread.
pub fn set_notch_region(region: Option<Hitbox>) {
    if let Ok(mut guard) = NOTCH_REGION.lock() {
        *guard = region;
    }
}

/// Start the cursor tracker if it is not already running. Called by `show_island`.
pub fn start_tracking(app: &AppHandle) {
    if POLLING.swap(true, Ordering::SeqCst) {
        return; // already running
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while POLLING.load(Ordering::SeqCst) {
            tick(&app);
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });
}

/// Stop the cursor tracker and restore idle click-through + a concealed reveal state. Called by
/// `hide_island`. Idempotent.
pub fn stop_tracking(app: &AppHandle) {
    POLLING.store(false, Ordering::SeqCst);
    // If we left the window interactive under the cursor, restore click-through now so a re-show
    // never starts stuck-interactive over the (now empty) envelope.
    if INTERACTIVE.swap(false, Ordering::SeqCst) {
        set_island_interactive(app, false);
    }
    // Reset the reveal machine so the next arrival starts from a clean concealed baseline.
    if let Ok(mut guard) = REVEAL.lock() {
        *guard = RevealMachine::CONCEALED;
    }
}

/// Read the cursor in window-relative LOGICAL px (the T13 convention), or `None` if any input is
/// missing / degenerate (caller then stays click-through and concealed).
fn cursor_window_relative(app: &AppHandle) -> Option<(f64, f64)> {
    let cursor = get_cursor_position()?; // logical points, top-left origin (CGEvent::location)
    let window = app.get_webview_window(ISLAND_LABEL)?;
    let origin = window.outer_position().ok()?; // PHYSICAL pixels
    let scale = window.scale_factor().unwrap_or(1.0);
    window_relative(cursor, (origin.x as f64, origin.y as f64), scale)
}

/// One poll step: read the cursor once, then (1) toggle interactivity when the cursor enters/leaves
/// the pill hitbox, and (2) drive the reveal machine from the notch region ∪ pill hot zone.
fn tick(app: &AppHandle) {
    let rel = match cursor_window_relative(app) {
        Some(p) => p,
        None => return,
    };

    // (1) Interactivity: the window receives clicks only while the cursor is over the shape.
    let hitbox = HITBOX.lock().ok().and_then(|g| *g);
    let in_pill = hitbox.map_or(false, |hb| point_in_rect(rel, hb));
    if in_pill != INTERACTIVE.swap(in_pill, Ordering::SeqCst) {
        set_island_interactive(app, in_pill);
        // Notify the webview so it pauses/resumes auto-dismiss on hover (card parity). Emitted only
        // on a real transition, so it costs nothing while the cursor sits still.
        let _ = app.emit_to(ISLAND_LABEL, HOVER_EVENT, in_pill);
    }

    // (2) Reveal (notch mode only - a set notch region gates it). The hot zone is the notch region
    // plus the pill itself, so hovering the revealed pill keeps it revealed.
    let region = NOTCH_REGION.lock().ok().and_then(|g| *g);
    if let Some(region) = region {
        let in_hot = in_pill || point_in_rect(rel, region);
        let prev = REVEAL.lock().map(|g| *g).unwrap_or(RevealMachine::CONCEALED);
        let next = reveal_step(prev, in_hot, Instant::now(), REVEAL_GRACE);
        if let Ok(mut guard) = REVEAL.lock() {
            *guard = next;
        }
        if next.revealed != prev.revealed {
            let _ = app.emit_to(ISLAND_LABEL, REVEAL_EVENT, next.revealed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Coordinate convention, encoding the T13 hardware probe (this machine, macOS 26.5) ---
    //
    // Real probe output (scratchpad/probe.swift against the live CGEvent/NSScreen APIs):
    //   CGEvent.location            = (752.098, 711.063)   <- what get_cursor_position() returns
    //   NSEvent.mouseLocation       = (752.098, 244.938)   <- x IDENTICAL, y flipped (956 - 711.063)
    //   NSScreen.main frame         = 1470 x 956 POINTS
    //   NSScreen.main backing frame = 2940 x 1912 PIXELS,  backingScaleFactor = 2.0
    //
    // The cursor x (752) lies inside the LOGICAL width [0, 1470], not the physical [0, 2940], and it
    // matches NSEvent.mouseLocation.x exactly (documented points). => CGEvent::location is in LOGICAL
    // points, top-left origin. window.outer_position() is PHYSICAL pixels. So the window origin must
    // be divided by scale before differencing; the cursor must NOT be.

    #[test]
    fn window_relative_converts_physical_origin_to_logical_before_differencing() {
        // 600-wide envelope centered on the 1470-logical built-in panel => window logical x =
        // (1470-600)/2 = 435, i.e. PHYSICAL outer_position x = 870 at scale 2.0. A cursor at global
        // logical (735, 40) - right over the centered pill - is window-relative logical (300, 40).
        let rel = window_relative((735.0, 40.0), (870.0, 0.0), 2.0).unwrap();
        assert_eq!(rel, (300.0, 40.0));
    }

    #[test]
    fn window_relative_bug_repro_old_formula_would_be_wrong() {
        // The T12 formula was (cursor - origin_physical) / scale. With the numbers above that is
        // (735 - 870) / 2 = -67.5, a NEGATIVE window-relative x that no hitbox contains -> the window
        // never turned interactive ("still not touchable"). The corrected value is +300.
        let wrong = (735.0 - 870.0) / 2.0;
        let right = window_relative((735.0, 40.0), (870.0, 0.0), 2.0).unwrap().0;
        assert!(wrong < 0.0);
        assert_eq!(right, 300.0);
        assert_ne!(wrong, right);
    }

    #[test]
    fn window_relative_at_1x_is_a_plain_difference() {
        // Non-Retina: scale 1.0, so physical == logical and the origin divide is a no-op.
        assert_eq!(
            window_relative((735.0, 40.0), (435.0, 0.0), 1.0).unwrap(),
            (300.0, 40.0)
        );
    }

    #[test]
    fn window_relative_non_positive_scale_fails_closed() {
        assert_eq!(window_relative((735.0, 40.0), (870.0, 0.0), 0.0), None);
    }

    // --- Rectangle containment (half-open) ---
    const PILL: Hitbox = Hitbox {
        x: 208.5, // under-notch pill: 183 wide, centered in the 600 envelope, below the cutout
        y: 32.0,
        w: 183.0,
        h: 34.0,
    };

    #[test]
    fn point_inside_pill_hitbox() {
        assert!(point_in_rect((300.0, 40.0), PILL)); // dead center under the cutout
    }

    #[test]
    fn point_left_of_pill_is_out() {
        assert!(!point_in_rect((100.0, 40.0), PILL));
    }

    #[test]
    fn point_edges_are_half_open() {
        assert!(point_in_rect((208.5, 32.0), PILL)); // top-left inclusive
        assert!(!point_in_rect((208.5 + 183.0, 40.0), PILL)); // right edge exclusive
        assert!(!point_in_rect((300.0, 32.0 + 34.0), PILL)); // bottom edge exclusive
    }

    // --- Notch region geometry ---
    #[test]
    fn ambient_wing_is_pinned_to_the_frontend_constant() {
        // Pin the shared ambient wing half-width (T14/T15 follow-up). This const and
        // the frontend `AMBIENT_WING` in src/lib/islandMorph.ts size the SAME visible
        // shape AND its hover region; a silent change to either desyncs the wings from
        // the hot zone. Changing the value forces updating this literal, which is the
        // deliberate cross-file drift tripwire (the region tests below also feed 24.0).
        assert_eq!(AMBIENT_WING, 24.0);
    }

    #[test]
    fn notch_region_covers_the_cutout_plus_both_ambient_wings_and_the_margin() {
        // G1 hardware: 183 x 32 cutout, 600 envelope, 24px ambient wing, 8px margin. Center x = 300.
        let r = notch_region(600.0, 183.0, 32.0, 24.0, 8.0);
        assert_eq!(r.x, 300.0 - 183.0 / 2.0 - 24.0 - 8.0); // 175.5
        assert_eq!(r.y, 0.0);
        assert_eq!(r.w, 183.0 + 2.0 * (24.0 + 8.0)); // 247
        assert_eq!(r.h, 32.0 + 8.0); // 40 (the wings are the cutout height, so the margin covers them)
        // The cutout center is inside the region; a point far below the cutout+margin is not.
        assert!(point_in_rect((300.0, 5.0), r));
        assert!(!point_in_rect((300.0, 45.0), r));
    }

    #[test]
    fn notch_region_extends_over_the_ambient_wings_beside_the_cutout() {
        // A point in the RIGHT wing (just past the cutout's right edge, inside the wing) is hot, so
        // hovering the visible ambient wings triggers the reveal. The same point WITHOUT the wing
        // (the T13 cutout-only region) would have been outside.
        let with_wings = notch_region(600.0, 183.0, 32.0, 24.0, 8.0);
        let cutout_only = notch_region(600.0, 183.0, 32.0, 0.0, 8.0);
        let in_right_wing = (300.0 + 183.0 / 2.0 + 12.0, 16.0); // 12px into the 24px right wing
        assert!(point_in_rect(in_right_wing, with_wings));
        assert!(!point_in_rect(in_right_wing, cutout_only));
    }

    // --- Reveal state machine: hidden -> hover -> revealed -> grace -> hidden ---
    fn t0() -> Instant {
        Instant::now()
    }

    #[test]
    fn reveal_hover_reveals_immediately() {
        let m = reveal_step(RevealMachine::CONCEALED, true, t0(), REVEAL_GRACE);
        assert!(m.revealed);
        assert_eq!(m.deadline, None);
    }

    #[test]
    fn reveal_leaving_starts_grace_then_conceals_after_deadline() {
        let start = t0();
        let revealed = RevealMachine {
            revealed: true,
            deadline: None,
        };
        // Cursor just left: still revealed, a deadline is now armed.
        let arming = reveal_step(revealed, false, start, REVEAL_GRACE);
        assert!(arming.revealed);
        let deadline = arming.deadline.expect("grace armed");

        // Before the deadline: still revealed, same deadline (no reset each tick).
        let mid = reveal_step(arming, false, deadline - Duration::from_millis(1), REVEAL_GRACE);
        assert!(mid.revealed);
        assert_eq!(mid.deadline, Some(deadline));

        // At/after the deadline: concealed.
        let done = reveal_step(mid, false, deadline, REVEAL_GRACE);
        assert!(!done.revealed);
        assert_eq!(done.deadline, None);
    }

    #[test]
    fn reveal_reentering_during_grace_cancels_conceal() {
        let start = t0();
        let armed = reveal_step(
            RevealMachine {
                revealed: true,
                deadline: None,
            },
            false,
            start,
            REVEAL_GRACE,
        );
        assert!(armed.deadline.is_some());
        // Cursor comes back before the deadline -> revealed, deadline cleared.
        let back = reveal_step(armed, true, start + Duration::from_millis(100), REVEAL_GRACE);
        assert!(back.revealed);
        assert_eq!(back.deadline, None);
    }

    #[test]
    fn reveal_concealed_and_out_stays_concealed() {
        // The arrival-announce case at the machine level: while concealed and not hovering, the
        // machine stays concealed every tick (the frontend keeps an EXPANDED arrival visible itself;
        // this flag only governs the COLLAPSED pill).
        let m = reveal_step(RevealMachine::CONCEALED, false, t0(), REVEAL_GRACE);
        assert_eq!(m, RevealMachine::CONCEALED);
    }
}
