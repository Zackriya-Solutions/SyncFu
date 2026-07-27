//! Notification panel window - a small positioned overlay instead of fullscreen.
//!
//! Platform strategy:
//! - macOS: NSPanel via tauri-nspanel (non-activating, joins all Spaces, proper z-order)
//! - Windows: WebviewWindow with always_on_top + focused(false) (Meetily pattern)
//! - Linux: Deferred (basic WebviewWindow for now)

use log::{error, info};
use tauri::{AppHandle, Manager};

#[cfg(target_os = "macos")]
use tauri_nspanel::ManagerExt;

/// Tauri window label for the notification panel. A plain string used on EVERY
/// platform (the macOS NSPanel and the non-macOS fallback WebviewWindow share it),
/// so it must NOT be macOS-gated - the router in `overlay/mod.rs` reads it
/// unconditionally.
pub(crate) const PANEL_LABEL: &str = "overlay";

// NSPanel type for macOS notification overlay (macOS-only - `tauri_nspanel` is a
// macOS dependency, so both the macro and the crate path must be gated):
// - can_become_key_window: false (never steals keyboard focus)
// - can_become_main_window: false (never becomes the main window)
// - is_floating_panel: true (floats above regular windows)
#[cfg(target_os = "macos")]
tauri_nspanel::tauri_panel! {
    panel!(NotificationPanel {
        config: {
            can_become_key_window: false,
            can_become_main_window: false,
            is_floating_panel: true
        }
    })
}

/// Panel dimensions in logical pixels.
/// Width matches the notification card max-width.
/// Height starts minimal - frontend resizes dynamically to fit content.
pub const PANEL_WIDTH: f64 = 400.0;
pub const PANEL_INITIAL_HEIGHT: f64 = 10.0;

/// Margin from the top-right corner of the work area.
pub const MARGIN_TOP: f64 = 12.0;
pub const MARGIN_RIGHT: f64 = 12.0;

/// Position for the notification panel (logical pixels).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PanelPosition {
    pub x: f64,
    pub y: f64,
}

/// Monitor dimensions needed for position calculation.
#[derive(Debug, Clone, Copy)]
pub struct MonitorInfo {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale_factor: f64,
}

/// Calculate the top-right position for the notification panel.
///
/// Position is in logical (not physical) pixels, accounting for scale factor.
/// The panel sits at `(right_edge - panel_width - margin, top + margin)`.
pub fn calculate_panel_position(monitor: MonitorInfo) -> PanelPosition {
    let logical_x = monitor.x / monitor.scale_factor;
    let logical_y = monitor.y / monitor.scale_factor;
    let logical_width = monitor.width / monitor.scale_factor;

    PanelPosition {
        x: logical_x + logical_width - PANEL_WIDTH - MARGIN_RIGHT,
        y: logical_y + MARGIN_TOP,
    }
}

/// Create the notification panel window.
///
/// On macOS, creates an NSPanel for proper floating panel behavior.
/// On other platforms, creates a standard WebviewWindow with always-on-top.
/// The panel starts hidden and should be shown when the first notification arrives.
pub fn create_panel(app: &AppHandle) -> Result<(), String> {
    let position = match get_cursor_monitor_info(app)
        .or_else(|| get_primary_monitor_info(app))
    {
        Some(monitor) => calculate_panel_position(monitor),
        None => {
            info!("No monitor info - using default panel position");
            PanelPosition { x: 1508.0, y: 12.0 }
        }
    };

    info!(
        "Creating notification panel at ({}, {}), size {}x{}",
        position.x, position.y, PANEL_WIDTH, PANEL_INITIAL_HEIGHT
    );

    #[cfg(target_os = "macos")]
    create_macos_panel(app, position)?;

    #[cfg(not(target_os = "macos"))]
    create_standard_panel(app, position)?;

    Ok(())
}

/// macOS: Create an NSPanel via tauri-nspanel.
///
/// NSPanel provides:
/// - Non-activating (doesn't steal focus from the frontmost app)
/// - Joins all Spaces (visible on every macOS desktop)
/// - Proper z-order (above windows, below system UI)
/// - Full-screen auxiliary (visible over fullscreen apps)
#[cfg(target_os = "macos")]
fn create_macos_panel(
    app: &AppHandle,
    position: PanelPosition,
) -> Result<(), String> {
    use tauri_nspanel::PanelBuilder;

    let _panel = PanelBuilder::<_, NotificationPanel>::new(app, PANEL_LABEL)
        .url(tauri::WebviewUrl::App("index.html".into()))
        .level(tauri_nspanel::PanelLevel::Status)
        .no_activate(true)
        .floating(true)
        .collection_behavior(
            tauri_nspanel::CollectionBehavior::new()
                .can_join_all_spaces()
                .full_screen_auxiliary(),
        )
        .has_shadow(true)
        .transparent(true)
        .size(tauri::Size::Logical(tauri::LogicalSize::new(PANEL_WIDTH, PANEL_INITIAL_HEIGHT)))
        .position(tauri::Position::Logical(tauri::LogicalPosition::new(position.x, position.y)))
        .with_window(|builder| {
            builder
                .transparent(true)
                .background_color(tauri::window::Color(0, 0, 0, 0))
                .decorations(false)
                .skip_taskbar(true)
                .resizable(false)
                .visible(false)
                .title("syncfu overlay")
        })
        .build()
        .map_err(|e| format!("Failed to create macOS panel: {e}"))?;

    info!("macOS NSPanel created (non-activating, joins all Spaces)");
    Ok(())
}

/// Windows/Linux: Create a standard WebviewWindow with always-on-top.
///
/// Uses the Meetily pattern:
/// - always_on_top(true) for z-order
/// - focused(false) to avoid focus theft
/// - transparent + no decorations for floating appearance
#[cfg(not(target_os = "macos"))]
fn create_standard_panel(
    app: &AppHandle,
    position: PanelPosition,
) -> Result<(), String> {
    let _window = tauri::WebviewWindowBuilder::new(
        app,
        PANEL_LABEL,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .focused(false)
    .resizable(false)
    .visible(false)
    .inner_size(PANEL_WIDTH, PANEL_INITIAL_HEIGHT)
    .position(position.x, position.y)
    .title("syncfu overlay")
    .build()
    .map_err(|e| format!("Failed to create panel: {e}"))?;

    info!("Standard panel created (always-on-top, non-focusing)");
    Ok(())
}

/// Show the panel window (e.g. when a notification arrives).
///
/// Repositions the panel to the monitor where the mouse cursor is,
/// then shows it. This ensures notifications appear on the active display.
///
/// IMPORTANT: On macOS, NSPanel operations MUST run on the main thread.
/// This function dispatches to the main thread to avoid crashes.
pub fn show_panel(app: &AppHandle) {
    // Calculate position for the monitor under the cursor BEFORE dispatching
    // to the main thread (monitor queries work from any thread).
    let position = get_cursor_monitor_info(app)
        .or_else(|| get_primary_monitor_info(app))
        .map(|m| calculate_panel_position(m));

    let handle = app.clone();
    let inner = app.clone();
    let _ = handle.run_on_main_thread(move || {
        // Reposition the overlay window to the cursor's monitor.
        // The underlying WebviewWindow is used for positioning on all platforms,
        // since NSPanel doesn't expose set_position directly.
        if let Some(pos) = position {
            if let Some(window) = inner.get_webview_window(PANEL_LABEL) {
                let _ = window.set_position(tauri::Position::Logical(
                    tauri::LogicalPosition::new(pos.x, pos.y),
                ));
            }
        }

        #[cfg(target_os = "macos")]
        {
            if let Ok(panel) = inner.get_webview_panel(PANEL_LABEL) {
                panel.show();
                return;
            }
        }

        if let Some(window) = inner.get_webview_window(PANEL_LABEL) {
            let _ = window.show();
        }
    });
}

/// Hide the panel window (e.g. when all notifications are dismissed).
///
/// IMPORTANT: On macOS, NSPanel operations MUST run on the main thread.
/// This function dispatches to the main thread to avoid crashes.
pub fn hide_panel(app: &AppHandle) {
    let handle = app.clone();
    let inner = app.clone();
    let _ = handle.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        {
            if let Ok(panel) = inner.get_webview_panel(PANEL_LABEL) {
                panel.hide();
                return;
            }
        }

        if let Some(window) = inner.get_webview_window(PANEL_LABEL) {
            let _ = window.hide();
        }
    });
}

/// Find the monitor containing the mouse cursor and return its info.
///
/// Iterates all available monitors and checks which one contains the
/// current cursor position. Falls back to None if cursor position
/// can't be determined or no monitor matches.
pub(crate) fn get_cursor_monitor_info(app: &AppHandle) -> Option<MonitorInfo> {
    let cursor_pos = get_cursor_position()?;
    let monitors = app.available_monitors().ok()?;

    for monitor in monitors {
        let pos = monitor.position();
        let size = monitor.size();
        let info = MonitorInfo {
            x: pos.x as f64,
            y: pos.y as f64,
            width: size.width as f64,
            height: size.height as f64,
            scale_factor: monitor.scale_factor(),
        };

        if cursor_in_monitor_logical(cursor_pos, info) {
            info!(
                "Cursor at ({}, {}) is on monitor at ({}, {}), size {}x{}",
                cursor_pos.0, cursor_pos.1, pos.x, pos.y, size.width, size.height
            );
            return Some(info);
        }
    }

    info!("Cursor at ({}, {}) - no matching monitor found", cursor_pos.0, cursor_pos.1);
    None
}

/// Half-open containment test in LOGICAL points - the T13 coordinate convention (see
/// `overlay/hover.rs`, empirically verified on real hardware). `cursor` is Quartz global DISPLAY
/// POINTS (logical, top-left origin - what `get_cursor_position` returns via `CGEvent::location`),
/// while `monitor.position()`/`size()` are PHYSICAL pixels; each monitor bound is divided by that
/// monitor's own `scale_factor` to reach the same logical space before comparing.
///
/// The pre-T17 code compared the logical cursor against the raw physical bounds. On a Retina (2x)
/// multi-display setup a monitor's physical width overlaps the LOGICAL origin of the display placed
/// to its right (e.g. a 1470-logical / 2940-physical built-in overlaps a second display that starts
/// at logical x=1470), so a cursor on the right-hand display was mis-selected onto the built-in and
/// the overlay opened on the wrong screen. This also fixes the CARD's monitor-following on Retina.
fn cursor_in_monitor_logical(cursor_logical: (f64, f64), m: MonitorInfo) -> bool {
    let scale = if m.scale_factor > 0.0 { m.scale_factor } else { 1.0 };
    let left = m.x / scale;
    let top = m.y / scale;
    let right = left + m.width / scale;
    let bottom = top + m.height / scale;
    cursor_logical.0 >= left
        && cursor_logical.0 < right
        && cursor_logical.1 >= top
        && cursor_logical.1 < bottom
}

/// Get the current mouse cursor position in physical pixels.
/// Returns (x, y) or None if unavailable.
#[cfg(target_os = "macos")]
pub(crate) fn get_cursor_position() -> Option<(f64, f64)> {
    use core_graphics::event::CGEvent;
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState).ok()?;
    let event = CGEvent::new(source).ok()?;
    let point = event.location();
    Some((point.x, point.y))
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn get_cursor_position() -> Option<(f64, f64)> {
    // TODO: Implement for Windows/Linux
    None
}

/// Extract monitor info from the primary monitor (fallback).
pub(crate) fn get_primary_monitor_info(app: &AppHandle) -> Option<MonitorInfo> {
    match app.primary_monitor() {
        Ok(Some(monitor)) => {
            let size = monitor.size();
            let position = monitor.position();
            let scale = monitor.scale_factor();
            Some(MonitorInfo {
                x: position.x as f64,
                y: position.y as f64,
                width: size.width as f64,
                height: size.height as f64,
                scale_factor: scale,
            })
        }
        Ok(None) => {
            error!("No primary monitor detected");
            None
        }
        Err(e) => {
            error!("Failed to get primary monitor: {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_panel_position_standard_1080p() {
        let monitor = MonitorInfo {
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
            scale_factor: 1.0,
        };

        let pos = calculate_panel_position(monitor);

        // Right edge: 1920 - 400 - 12 = 1508
        assert_eq!(pos.x, 1508.0);
        assert_eq!(pos.y, MARGIN_TOP);
    }

    #[test]
    fn test_panel_position_retina_display() {
        // MacBook Pro 14" - physical 3024×1964, scale 2.0
        let monitor = MonitorInfo {
            x: 0.0,
            y: 0.0,
            width: 3024.0,
            height: 1964.0,
            scale_factor: 2.0,
        };

        let pos = calculate_panel_position(monitor);

        // Logical width: 3024 / 2 = 1512
        // x: 1512 - 400 - 12 = 1100
        assert_eq!(pos.x, 1100.0);
        assert_eq!(pos.y, MARGIN_TOP);
    }

    #[test]
    fn test_panel_position_4k_150_percent_scale() {
        let monitor = MonitorInfo {
            x: 0.0,
            y: 0.0,
            width: 3840.0,
            height: 2160.0,
            scale_factor: 1.5,
        };

        let pos = calculate_panel_position(monitor);

        // Logical width: 3840 / 1.5 = 2560
        // x: 2560 - 400 - 12 = 2148
        assert_eq!(pos.x, 2148.0);
        assert_eq!(pos.y, MARGIN_TOP);
    }

    #[test]
    fn test_panel_position_secondary_monitor_offset() {
        // Secondary monitor at physical position (1920, 0)
        let monitor = MonitorInfo {
            x: 1920.0,
            y: 0.0,
            width: 2560.0,
            height: 1440.0,
            scale_factor: 1.0,
        };

        let pos = calculate_panel_position(monitor);

        // x: 1920 + 2560 - 400 - 12 = 4068
        assert_eq!(pos.x, 4068.0);
        assert_eq!(pos.y, MARGIN_TOP);
    }

    #[test]
    fn test_panel_position_secondary_monitor_retina() {
        // Secondary Retina at physical (3024, 0), 2560x1440 @ 2x
        let monitor = MonitorInfo {
            x: 3024.0,
            y: 0.0,
            width: 5120.0,
            height: 2880.0,
            scale_factor: 2.0,
        };

        let pos = calculate_panel_position(monitor);

        // Logical x: 3024 / 2 = 1512
        // Logical width: 5120 / 2 = 2560
        // x: 1512 + 2560 - 400 - 12 = 3660
        assert_eq!(pos.x, 3660.0);
        assert_eq!(pos.y, MARGIN_TOP);
    }

    #[test]
    fn test_panel_dimensions_are_reasonable() {
        assert!(PANEL_WIDTH > 300.0, "Panel too narrow for notifications");
        assert!(PANEL_WIDTH < 500.0, "Panel too wide");
        // Initial height is minimal - frontend resizes dynamically
        assert!(PANEL_INITIAL_HEIGHT <= 20.0, "Initial height should be tiny");
    }

    // --- Cursor->monitor selection in LOGICAL space (T17 fix for the T13-flagged latent bug) ---
    //
    // Fixtures encode the real dual-display Retina geometry the regression was reported on. The
    // library reports `monitor.position()`/`size()` in PHYSICAL pixels (== logical * scale, the same
    // convention hover.rs proved for `window.outer_position()`); the cursor from `CGEvent::location`
    // is in GLOBAL LOGICAL points. The built-in is 1470 logical / 2940 physical @ 2x at the origin;
    // an external sits to its RIGHT starting at global logical x=1470.

    /// Built-in MacBook panel: 1470x956 logical, 2x -> physical 2940x1912 at the origin.
    const BUILTIN: MonitorInfo = MonitorInfo {
        x: 0.0,
        y: 0.0,
        width: 2940.0,
        height: 1912.0,
        scale_factor: 2.0,
    };

    /// External to the right, starting at global logical x=1470 -> physical origin 1470 @ 1x.
    const EXTERNAL_1X: MonitorInfo = MonitorInfo {
        x: 1470.0,
        y: 0.0,
        width: 2560.0,
        height: 1440.0,
        scale_factor: 1.0,
    };

    #[test]
    fn cursor_on_external_is_not_claimed_by_the_retina_builtin() {
        // A cursor at global logical (1500, 300) is on the EXTERNAL. The corrected logical test
        // rejects the built-in (its logical right edge is 2940/2 = 1470, and 1500 >= 1470) and
        // selects the external. The OLD physical test would have matched the built-in first
        // (1500 < 2940 physical) and opened the overlay on the wrong screen.
        assert!(!cursor_in_monitor_logical((1500.0, 300.0), BUILTIN));
        assert!(cursor_in_monitor_logical((1500.0, 300.0), EXTERNAL_1X));
    }

    #[test]
    fn cursor_on_builtin_selects_the_builtin() {
        // A cursor at global logical (700, 300) is on the built-in; the external starts at 1470.
        assert!(cursor_in_monitor_logical((700.0, 300.0), BUILTIN));
        assert!(!cursor_in_monitor_logical((700.0, 300.0), EXTERNAL_1X));
    }

    #[test]
    fn cursor_containment_is_half_open() {
        // 1080p @ 1x: logical bounds [0,1920) x [0,1080). Origin inclusive, far/bottom edges
        // exclusive so adjacent displays never both claim the seam.
        let m = MonitorInfo { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0, scale_factor: 1.0 };
        assert!(cursor_in_monitor_logical((0.0, 0.0), m)); // top-left inclusive
        assert!(!cursor_in_monitor_logical((1920.0, 100.0), m)); // right edge exclusive
        assert!(!cursor_in_monitor_logical((100.0, 1080.0), m)); // bottom edge exclusive
    }

    #[test]
    fn cursor_containment_degenerate_scale_does_not_divide_by_zero() {
        // A non-positive scale (never expected) falls back to 1.0 rather than producing NaN bounds.
        let m = MonitorInfo { x: 0.0, y: 0.0, width: 800.0, height: 600.0, scale_factor: 0.0 };
        assert!(cursor_in_monitor_logical((400.0, 300.0), m));
    }

    #[test]
    fn test_panel_fits_on_small_screen() {
        // Minimum supported: 1366x768 laptop
        let monitor = MonitorInfo {
            x: 0.0,
            y: 0.0,
            width: 1366.0,
            height: 768.0,
            scale_factor: 1.0,
        };

        let pos = calculate_panel_position(monitor);

        assert!(pos.x >= 0.0, "Panel x must be on screen");
        assert!(pos.y >= 0.0, "Panel y must be on screen");
        assert!(
            pos.x + PANEL_WIDTH <= 1366.0,
            "Panel must fit horizontally"
        );
    }
}
