//! Dynamic Island overlay window — a dedicated top-center capsule window, distinct from the
//! top-right notification panel (`panel.rs`).
//!
//! Platform strategy (mirrors `panel.rs`):
//! - macOS: NSPanel via tauri-nspanel (non-activating, joins all Spaces, full-screen auxiliary),
//!   anchored on the built-in notched display when a notch exists, else the cursor monitor.
//! - Windows/Linux: always-on-top WebviewWindow, floating capsule centered on the cursor monitor.
//!
//! Fixed-envelope invariant (D3): the OS window frame is held at the maximum size any morph state
//! can occupy and is NEVER resized during the compact<->expanded morph. The visible capsule and its
//! shape/content animate INSIDE this transparent frame (frontend, T4a+). This module only plumbs
//! the window and its placement; the window is hidden by default and blank until T4a.
//!
//! R-TWOWIN: this window uses the `island` label and its own placement logic. `panel.rs`'s
//! `show_panel`/`hide_panel` operate on the `overlay` label and never touch this window, and vice
//! versa.

use log::info;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "macos")]
use tauri_nspanel::ManagerExt;

use super::panel::MonitorInfo;

// NSPanel type for the island, configured identically to the notification panel:
// non-activating, never key/main, floating.
#[cfg(target_os = "macos")]
tauri_nspanel::tauri_panel! {
    panel!(IslandPanel {
        config: {
            can_become_key_window: false,
            can_become_main_window: false,
            is_floating_panel: true
        }
    })
}

/// Tauri window label for the island. Distinct from the panel's `overlay` label (R-TWOWIN).
pub const ISLAND_LABEL: &str = "island";

/// The fixed OS-frame envelope for the island window (logical pixels).
///
/// Held at the maximum size any morph state can occupy so the frame never resizes during the
/// compact<->expanded morph (D3). Chosen from the persistent-settings ranges (D4) plus the Model B
/// expanded-list cap (D5):
/// - `WIDTH`  = max(compactWidth range max 600, expandedWidth range max 560) = 600
/// - `HEIGHT` = maxExpH, the expanded Model B list cap (6 rows / 560px) = 560
///
/// The visible capsule is far smaller and centered inside this transparent, click-through frame;
/// the surrounding area is fully transparent. Per-notification sizing and the actual morph live in
/// the frontend (T4a+); this constant only bounds the never-resized OS window.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct IslandEnvelope {
    pub width: f64,
    pub height: f64,
}

impl IslandEnvelope {
    pub const FIXED: IslandEnvelope = IslandEnvelope {
        width: 600.0,
        height: 560.0,
    };
}

/// Top-center anchor for the island window (logical pixels).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct IslandPosition {
    pub x: f64,
    pub y: f64,
}

/// Center the fixed envelope on the target monitor's top edge.
///
/// Position is in logical (not physical) pixels, accounting for scale factor. The window's top edge
/// sits at the monitor top (`y`); the capsule hugs the notch / top there, with its own inner
/// top-anchored layout handled by the frontend. Mirrors `calculate_panel_position` but centers
/// horizontally instead of right-aligning.
pub fn calculate_island_anchor(monitor: MonitorInfo, envelope_width: f64) -> IslandPosition {
    let logical_x = monitor.x / monitor.scale_factor;
    let logical_y = monitor.y / monitor.scale_factor;
    let logical_width = monitor.width / monitor.scale_factor;

    IslandPosition {
        x: logical_x + (logical_width - envelope_width) / 2.0,
        y: logical_y,
    }
}

/// Create the island window (hidden). Called once in `.setup()` after the panel is created.
///
/// The window is created at the fixed envelope size, positioned at its initial top-center anchor,
/// content-protected before it is ever shown (G2 ordering), and click-through while idle.
pub fn create_island(app: &AppHandle) -> Result<(), String> {
    let envelope = IslandEnvelope::FIXED;
    let position = island_target_monitor(app)
        .map(|m| calculate_island_anchor(m, envelope.width))
        // No monitor info: center-ish default (mirrors panel.rs's default fallback).
        .unwrap_or(IslandPosition { x: 660.0, y: 0.0 });

    info!(
        "Creating island window at ({}, {}), fixed envelope {}x{}",
        position.x, position.y, envelope.width, envelope.height
    );

    #[cfg(target_os = "macos")]
    create_macos_island(app, position, envelope)?;

    #[cfg(not(target_os = "macos"))]
    create_standard_island(app, position, envelope)?;

    // G2 (binding): apply capture protection on the exact island window BEFORE it is first shown.
    // create runs in `.setup()`; the first show happens later on an island notify, so this queued
    // main-thread task always runs first.
    set_island_capture_protected(app);
    // Idle click-through: the transparent envelope must not intercept clicks. Per-region
    // interactivity when a notification is shown is the frontend's job (pointer-events, T4a).
    set_island_idle_click_through(app);

    Ok(())
}

/// macOS: create the island as an NSPanel, using the same config as the notification panel.
#[cfg(target_os = "macos")]
fn create_macos_island(
    app: &AppHandle,
    position: IslandPosition,
    envelope: IslandEnvelope,
) -> Result<(), String> {
    use tauri_nspanel::PanelBuilder;

    let _panel = PanelBuilder::<_, IslandPanel>::new(app, ISLAND_LABEL)
        .url(tauri::WebviewUrl::App("index.html".into()))
        .level(tauri_nspanel::PanelLevel::Status)
        .no_activate(true)
        .floating(true)
        .collection_behavior(
            tauri_nspanel::CollectionBehavior::new()
                .can_join_all_spaces()
                .full_screen_auxiliary(),
        )
        .has_shadow(false)
        .transparent(true)
        .size(tauri::Size::Logical(tauri::LogicalSize::new(
            envelope.width,
            envelope.height,
        )))
        .position(tauri::Position::Logical(tauri::LogicalPosition::new(
            position.x, position.y,
        )))
        .with_window(|builder| {
            builder
                .transparent(true)
                .background_color(tauri::window::Color(0, 0, 0, 0))
                .decorations(false)
                .skip_taskbar(true)
                .resizable(false)
                .visible(false)
                .title("syncfu island")
        })
        .build()
        .map_err(|e| format!("Failed to create macOS island panel: {e}"))?;

    info!("macOS island NSPanel created (non-activating, joins all Spaces)");
    Ok(())
}

/// Windows/Linux: create the island as an always-on-top, non-focusing WebviewWindow.
#[cfg(not(target_os = "macos"))]
fn create_standard_island(
    app: &AppHandle,
    position: IslandPosition,
    envelope: IslandEnvelope,
) -> Result<(), String> {
    let _window = tauri::WebviewWindowBuilder::new(
        app,
        ISLAND_LABEL,
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
    .inner_size(envelope.width, envelope.height)
    .position(position.x, position.y)
    .title("syncfu island")
    .build()
    .map_err(|e| format!("Failed to create island window: {e}"))?;

    info!("Standard island window created (always-on-top, non-focusing)");
    Ok(())
}

/// Show the island window, repositioning it to its target monitor first.
///
/// IMPORTANT: on macOS, NSPanel operations MUST run on the main thread. This dispatches there.
pub fn show_island(app: &AppHandle) {
    let handle = app.clone();
    let inner = app.clone();
    let _ = handle.run_on_main_thread(move || {
        reposition_island_on_main(&inner);

        #[cfg(target_os = "macos")]
        {
            if let Ok(panel) = inner.get_webview_panel(ISLAND_LABEL) {
                panel.show();
                return;
            }
        }

        if let Some(window) = inner.get_webview_window(ISLAND_LABEL) {
            let _ = window.show();
        }
    });
}

/// Hide the island window. Dispatches to the main thread for NSPanel safety.
pub fn hide_island(app: &AppHandle) {
    let handle = app.clone();
    let inner = app.clone();
    let _ = handle.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        {
            if let Ok(panel) = inner.get_webview_panel(ISLAND_LABEL) {
                panel.hide();
                return;
            }
        }

        if let Some(window) = inner.get_webview_window(ISLAND_LABEL) {
            let _ = window.hide();
        }
    });
}

/// Reposition the island to its current target monitor without resizing (frame is fixed, D3).
/// Useful when the display layout changes. Dispatches to the main thread.
pub fn reflow_island(app: &AppHandle) {
    let handle = app.clone();
    let inner = app.clone();
    let _ = handle.run_on_main_thread(move || {
        reposition_island_on_main(&inner);
    });
}

/// Apply screen-capture exclusion to the island window. G2 seam for T9's OS-aware status logic;
/// T3 applies it unconditionally before first show as documented defense-in-depth (harmless where
/// the OS does not honor it). Dispatches to the main thread and never resizes the frame.
pub fn set_island_capture_protected(app: &AppHandle) {
    let inner = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = inner.get_webview_window(ISLAND_LABEL) {
            let _ = window.set_content_protected(true);
        }
    });
}

/// Make the idle island window click-through (transparent envelope must not eat clicks).
fn set_island_idle_click_through(app: &AppHandle) {
    let inner = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = inner.get_webview_window(ISLAND_LABEL) {
            let _ = window.set_ignore_cursor_events(true);
        }
    });
}

/// Reposition the island window to its target monitor's top-center anchor. MUST run on the main
/// thread (notch detection needs a `MainThreadMarker`). No-op if the window or monitor is missing.
fn reposition_island_on_main(app: &AppHandle) {
    if let Some(monitor) = island_target_monitor(app) {
        let pos = calculate_island_anchor(monitor, IslandEnvelope::FIXED.width);
        if let Some(window) = app.get_webview_window(ISLAND_LABEL) {
            let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
                pos.x, pos.y,
            )));
        }
    }
}

/// Select the monitor to anchor the island on.
///
/// macOS: when any attached display has a notch, anchor on the primary monitor — the built-in
/// notched panel in the standard single-builtin config. Precise multi-display targeting of an
/// arbitrary notched screen (e.g. an external set as main display) is deferred; primary is the
/// documented proxy, and non-notch layouts fall through to the cursor monitor (floating capsule).
#[cfg(target_os = "macos")]
fn island_target_monitor(app: &AppHandle) -> Option<MonitorInfo> {
    use objc2_foundation::MainThreadMarker;

    if let Some(mtm) = MainThreadMarker::new() {
        if crate::overlay::notch::notch_geometry(mtm).is_some() {
            return super::panel::get_primary_monitor_info(app);
        }
    }
    super::panel::get_cursor_monitor_info(app).or_else(|| super::panel::get_primary_monitor_info(app))
}

/// Non-macOS: floating capsule follows the cursor monitor, like the panel.
#[cfg(not(target_os = "macos"))]
fn island_target_monitor(app: &AppHandle) -> Option<MonitorInfo> {
    super::panel::get_cursor_monitor_info(app).or_else(|| super::panel::get_primary_monitor_info(app))
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: f64 = 600.0; // IslandEnvelope::FIXED.width, pinned for the anchor tests

    #[test]
    fn test_island_anchor_standard_1080p() {
        let monitor = MonitorInfo {
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
            scale_factor: 1.0,
        };
        let pos = calculate_island_anchor(monitor, W);
        // Centered: (1920 - 600) / 2 = 660
        assert_eq!(pos.x, 660.0);
        assert_eq!(pos.y, 0.0);
    }

    #[test]
    fn test_island_anchor_retina_2x() {
        // MacBook Pro 14" — physical 3024x1964 @ 2.0 (the notched-display case).
        let monitor = MonitorInfo {
            x: 0.0,
            y: 0.0,
            width: 3024.0,
            height: 1964.0,
            scale_factor: 2.0,
        };
        let pos = calculate_island_anchor(monitor, W);
        // Logical width 1512; centered: (1512 - 600) / 2 = 456
        assert_eq!(pos.x, 456.0);
        assert_eq!(pos.y, 0.0);
    }

    #[test]
    fn test_island_anchor_4k_150_percent_scale() {
        let monitor = MonitorInfo {
            x: 0.0,
            y: 0.0,
            width: 3840.0,
            height: 2160.0,
            scale_factor: 1.5,
        };
        let pos = calculate_island_anchor(monitor, W);
        // Logical width 2560; centered: (2560 - 600) / 2 = 980
        assert_eq!(pos.x, 980.0);
        assert_eq!(pos.y, 0.0);
    }

    #[test]
    fn test_island_anchor_secondary_monitor_offset() {
        // Secondary monitor at physical (1920, 0).
        let monitor = MonitorInfo {
            x: 1920.0,
            y: 0.0,
            width: 2560.0,
            height: 1440.0,
            scale_factor: 1.0,
        };
        let pos = calculate_island_anchor(monitor, W);
        // 1920 + (2560 - 600) / 2 = 1920 + 980 = 2900
        assert_eq!(pos.x, 2900.0);
        assert_eq!(pos.y, 0.0);
    }

    #[test]
    fn test_island_anchor_secondary_monitor_retina() {
        // Secondary Retina at physical (3024, 0), 5120x2880 @ 2.0.
        let monitor = MonitorInfo {
            x: 3024.0,
            y: 0.0,
            width: 5120.0,
            height: 2880.0,
            scale_factor: 2.0,
        };
        let pos = calculate_island_anchor(monitor, W);
        // Logical x 1512, logical width 2560: 1512 + (2560 - 600) / 2 = 1512 + 980 = 2492
        assert_eq!(pos.x, 2492.0);
        assert_eq!(pos.y, 0.0);
    }

    #[test]
    fn test_island_anchor_is_horizontally_centered() {
        // Invariant: equal margin on both sides of the envelope.
        let monitor = MonitorInfo {
            x: 0.0,
            y: 0.0,
            width: 1440.0,
            height: 900.0,
            scale_factor: 1.0,
        };
        let pos = calculate_island_anchor(monitor, W);
        let left_margin = pos.x;
        let right_margin = 1440.0 - (pos.x + W);
        assert_eq!(left_margin, right_margin);
    }

    #[test]
    fn test_fixed_envelope_bounds_documented_maxima() {
        // The frame must contain the widest state (compactWidth max 600, expandedWidth max 560)
        // and the tallest (maxExpH 560) so it never resizes during morph (D3).
        assert!(IslandEnvelope::FIXED.width >= 600.0);
        assert!(IslandEnvelope::FIXED.height >= 560.0);
    }
}
