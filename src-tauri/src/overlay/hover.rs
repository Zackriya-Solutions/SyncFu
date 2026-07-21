//! Cursor-tracking click-through toggle for the island window (BUG B).
//!
//! The island frame is created click-through (`ignore_cursor_events(true)`) so the transparent
//! envelope never eats clicks. That left the visible capsule permanently unclickable. This module
//! polls the cursor at ~10Hz WHILE THE ISLAND IS VISIBLE and flips the window interactive only while
//! the cursor is inside the frontend-reported hitbox (the true morphing-shape bounds), restoring
//! click-through otherwise. Envelope area outside the shape stays click-through at all times.
//!
//! Lifecycle (R-PERF): the poll is spawned by `show_island` and stopped by `hide_island`, so a
//! hidden island costs zero idle CPU. The `true -> false` (interactive) toggle is driven from here
//! because only the backend always knows the cursor position; the shape bounds come from the
//! frontend via `set_island_hitbox` (reported on morph settle + show/hide, not per frame).
//!
//! Coordinate convention mirrors `calculate_island_anchor`: the cursor and the window origin are
//! read in PHYSICAL pixels (same space as `panel::get_cursor_position` / `outer_position`), and the
//! difference is divided by the window scale factor to get window-relative LOGICAL px, which is the
//! space the frontend's `getBoundingClientRect` hitbox lives in.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use super::island::{set_island_interactive, ISLAND_LABEL};
use super::panel::get_cursor_position;

/// Poll interval (~10Hz). Cheap while visible, and only runs while an island is shown.
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// The visible-shape hitbox, in window-relative LOGICAL pixels (x, y from the window's top-left).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Hitbox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// The frontend-reported hitbox (the true morphing-shape bounds). `None` until first reported.
static HITBOX: Mutex<Option<Hitbox>> = Mutex::new(None);
/// Whether the poll loop is running (tied to island visibility). Guards against double-spawn.
static POLLING: AtomicBool = AtomicBool::new(false);
/// The last interactive state we applied, so we only dispatch a main-thread toggle on a real change.
static INTERACTIVE: AtomicBool = AtomicBool::new(false);

/// Pure containment test: is the cursor inside the hitbox? `cursor` and `window_origin` are physical
/// pixels; `scale` converts their difference to the window-relative logical space the hitbox uses.
/// A non-positive scale (never expected) fails closed to `false` (stay click-through).
pub fn cursor_in_hitbox(
    cursor: (f64, f64),
    window_origin: (f64, f64),
    scale: f64,
    hb: Hitbox,
) -> bool {
    if scale <= 0.0 {
        return false;
    }
    let rel_x = (cursor.0 - window_origin.0) / scale;
    let rel_y = (cursor.1 - window_origin.1) / scale;
    rel_x >= hb.x && rel_x < hb.x + hb.w && rel_y >= hb.y && rel_y < hb.y + hb.h
}

/// Store the latest hitbox reported by the frontend (BUG B). Replaces any previous value.
pub fn set_hitbox(hb: Hitbox) {
    if let Ok(mut guard) = HITBOX.lock() {
        *guard = Some(hb);
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

/// Stop the cursor tracker and restore idle click-through. Called by `hide_island`. Idempotent.
pub fn stop_tracking(app: &AppHandle) {
    POLLING.store(false, Ordering::SeqCst);
    // If we left the window interactive under the cursor, restore click-through now so a re-show
    // never starts stuck-interactive over the (now empty) envelope.
    if INTERACTIVE.swap(false, Ordering::SeqCst) {
        set_island_interactive(app, false);
    }
}

/// One poll step: read the cursor + window origin, test containment, and toggle interactivity only
/// when it changed (so an unchanged state costs no main-thread dispatch).
fn tick(app: &AppHandle) {
    let hb = match HITBOX.lock() {
        Ok(guard) => match *guard {
            Some(hb) => hb,
            None => return, // nothing reported yet -> stay click-through
        },
        Err(_) => return,
    };
    let cursor = match get_cursor_position() {
        Some(c) => c,
        None => return,
    };
    let window = match app.get_webview_window(ISLAND_LABEL) {
        Some(w) => w,
        None => return,
    };
    let origin = match window.outer_position() {
        Ok(p) => (p.x as f64, p.y as f64),
        Err(_) => return,
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let inside = cursor_in_hitbox(cursor, origin, scale, hb);
    if inside != INTERACTIVE.swap(inside, Ordering::SeqCst) {
        set_island_interactive(app, inside);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HB: Hitbox = Hitbox {
        x: 191.0, // (600 envelope - 218 pill) / 2, the compact pill's left edge inside the frame
        y: 0.0,
        w: 218.0,
        h: 34.0,
    };

    #[test]
    fn cursor_inside_hitbox_at_1x() {
        // Window origin at physical (660, 0), 1x: a cursor at (860, 20) is 200,20 window-relative,
        // inside [191..409] x [0..34].
        assert!(cursor_in_hitbox((860.0, 20.0), (660.0, 0.0), 1.0, HB));
    }

    #[test]
    fn cursor_left_of_hitbox_is_out() {
        // Window-relative x = 700-660 = 40 < 191 -> click-through (the transparent left wing).
        assert!(!cursor_in_hitbox((700.0, 10.0), (660.0, 0.0), 1.0, HB));
    }

    #[test]
    fn cursor_below_hitbox_is_out() {
        // Window-relative y = 50 > 34 -> below the pill, in the empty envelope -> click-through.
        assert!(!cursor_in_hitbox((860.0, 50.0), (660.0, 0.0), 1.0, HB));
    }

    #[test]
    fn scale_factor_converts_physical_to_logical() {
        // 2x retina: window origin physical (1320, 0). A physical cursor at (1320 + 2*200, 2*20) =
        // (1720, 40) maps to window-relative logical (200, 20), inside the hitbox. The SAME physical
        // point would be OUTSIDE if we forgot to divide by scale (400 > 409-191 wing math).
        assert!(cursor_in_hitbox((1720.0, 40.0), (1320.0, 0.0), 2.0, HB));
        // Without scale handling the raw delta 400,40 lands past the 218-wide hitbox -> proves the
        // divide matters.
        assert!(!cursor_in_hitbox((1720.0, 40.0), (1320.0, 0.0), 1.0, HB));
    }

    #[test]
    fn right_and_bottom_edges_are_exclusive() {
        // Half-open interval [x, x+w): the far edge is NOT inside (matches monitor-bounds convention
        // in panel.rs get_cursor_monitor_info).
        let origin = (0.0, 0.0);
        assert!(cursor_in_hitbox((191.0, 0.0), origin, 1.0, HB)); // left/top edge inclusive
        assert!(!cursor_in_hitbox((409.0, 0.0), origin, 1.0, HB)); // right edge exclusive (191+218)
        assert!(!cursor_in_hitbox((300.0, 34.0), origin, 1.0, HB)); // bottom edge exclusive
    }

    #[test]
    fn non_positive_scale_fails_closed() {
        // A degenerate scale never leaves the window stuck interactive.
        assert!(!cursor_in_hitbox((200.0, 10.0), (0.0, 0.0), 0.0, HB));
    }
}
