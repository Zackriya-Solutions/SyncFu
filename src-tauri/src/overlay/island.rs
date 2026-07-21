//! Dynamic Island overlay window - a dedicated top-center capsule window, distinct from the
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
use serde::Serialize;
use tauri::{AppHandle, Manager};
#[cfg(target_os = "macos")]
use tauri::Emitter;

#[cfg(target_os = "macos")]
use tauri_nspanel::ManagerExt;

use super::panel::MonitorInfo;
use crate::notification::settings::{Mode, Position};

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

/// Physical notch cutout geometry surfaced to the island webview (BUG A). Logical points == CSS px
/// on macOS, so the frontend uses these directly to keep compact content in the visible wings beside
/// the cutout. `None` on non-notch / non-macOS (float capsule); serialized camelCase for the TS mirror.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotchGeometryDto {
    pub width_logical: f64,
    pub height_logical: f64,
}

/// Read the live notch cutout geometry for the built-in notched display, or `None` when there is no
/// notch (non-notch Mac / non-macOS / external target). Dispatches to the main thread (NSScreen is
/// `MainThreadOnly`, G1) and blocks briefly for the result, so this is safe to call from a Tauri
/// command worker thread but MUST NOT be called from the main thread itself.
pub fn notch_geometry_dto(app: &AppHandle) -> Option<NotchGeometryDto> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::mpsc;
        use std::time::Duration;
        let (tx, rx) = mpsc::channel();
        let _ = app.run_on_main_thread(move || {
            let _ = tx.send(read_notch_geometry_on_main());
        });
        rx.recv_timeout(Duration::from_millis(500)).ok().flatten()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        None
    }
}

/// Read the notch geometry DTO on the current thread (MUST already be the main thread). Off the main
/// thread `MainThreadMarker::new()` returns `None`, yielding a safe `None` rather than UB.
#[cfg(target_os = "macos")]
fn read_notch_geometry_on_main() -> Option<NotchGeometryDto> {
    use objc2_foundation::MainThreadMarker;
    let mtm = MainThreadMarker::new()?;
    crate::overlay::notch::notch_geometry(mtm).map(|g| NotchGeometryDto {
        width_logical: g.notch_width,
        height_logical: g.notch_height,
    })
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

/// Gap between the floating capsule frame and the monitor edge it anchors to (logical px). Matches
/// the mockup's float inset (~12px above the bottom edge / in from the side edges).
const FLOAT_EDGE_MARGIN: f64 = 12.0;

/// Float-mode anchor for the fixed envelope on `monitor`, per `position` (D4, T8). Notch mode never
/// reaches here (it always uses `calculate_island_anchor`); `Center` here is byte-identical to that
/// top-center anchor, so the two agree. `Left`/`Right` pin the frame `FLOAT_EDGE_MARGIN` in from the
/// side edge; `BottomCenter` pins the frame's BOTTOM edge `FLOAT_EDGE_MARGIN` above the monitor
/// bottom so the capsule (bottom-aligned inside the frame, CSS) sits just above the edge and expands
/// upward. Logical pixels throughout (scale-factor corrected), mirroring `calculate_island_anchor`.
pub fn calculate_island_float_anchor(
    monitor: MonitorInfo,
    envelope: IslandEnvelope,
    position: Position,
) -> IslandPosition {
    let logical_x = monitor.x / monitor.scale_factor;
    let logical_y = monitor.y / monitor.scale_factor;
    let logical_width = monitor.width / monitor.scale_factor;
    let logical_height = monitor.height / monitor.scale_factor;

    let x = match position {
        Position::Left => logical_x + FLOAT_EDGE_MARGIN,
        Position::Right => logical_x + logical_width - envelope.width - FLOAT_EDGE_MARGIN,
        Position::Center | Position::BottomCenter => {
            logical_x + (logical_width - envelope.width) / 2.0
        }
    };
    let y = match position {
        Position::BottomCenter => {
            logical_y + logical_height - envelope.height - FLOAT_EDGE_MARGIN
        }
        _ => logical_y,
    };

    IslandPosition { x, y }
}

/// Resolve the window anchor for the given mode + position (T8). Notch mode is ALWAYS top-center
/// (position is ignored - invariant e); float mode dispatches to `calculate_island_float_anchor`.
pub fn island_anchor_for(
    monitor: MonitorInfo,
    envelope: IslandEnvelope,
    mode: Mode,
    position: Position,
) -> IslandPosition {
    match mode {
        Mode::Notch => calculate_island_anchor(monitor, envelope.width),
        Mode::Float => calculate_island_float_anchor(monitor, envelope, position),
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
    // main-thread task always runs first. Defaults hide from capture (settings default true).
    set_island_capture_protected(app, true);
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
                // Track the cursor against the reported hitbox while the island is visible so the
                // shown capsule becomes interactive under the pointer (BUG B). No-op if already
                // running; stopped in hide_island (R-PERF: zero idle cost when hidden).
                crate::overlay::hover::start_tracking(&inner);
                return;
            }
        }

        if let Some(window) = inner.get_webview_window(ISLAND_LABEL) {
            let _ = window.show();
            crate::overlay::hover::start_tracking(&inner);
        }
    });
}

/// Hide the island window. Dispatches to the main thread for NSPanel safety.
pub fn hide_island(app: &AppHandle) {
    // Stop the cursor tracker and restore idle click-through (BUG B): a hidden window must never
    // stay interactive, and polling must cost nothing while nothing is shown (R-PERF).
    crate::overlay::hover::stop_tracking(app);
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
        // Push the current notch geometry to the island webview (BUG A) so a monitor/display change
        // reflows the wing-aware compact layout. Already on the main thread here. Emits `None`
        // (null) on non-notch displays; the frontend keeps the float layout then.
        #[cfg(target_os = "macos")]
        {
            let dto = read_notch_geometry_on_main();
            let _ = inner.emit_to(ISLAND_LABEL, "island:geometry", &dto);
        }
    });
}

/// Apply or clear screen-capture exclusion on the island window, in place (never resizes or rebuilds
/// the frame - G2). G2 seam for T9's OS-aware status logic; T3 applies it before first show as
/// documented defense-in-depth (harmless where the OS does not honor it). T7a's settings set-path
/// calls this with the `hideFromScreenCapture` toggle. Dispatches to the main thread.
pub fn set_island_capture_protected(app: &AppHandle, protected: bool) {
    let inner = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = inner.get_webview_window(ISLAND_LABEL) {
            let _ = window.set_content_protected(protected);
        }
    });
}

/// First Windows 10 build that honors `WDA_EXCLUDEFROMCAPTURE` (2004 / 20H1). Earlier builds only
/// offer `WDA_MONITOR`, which does not reliably exclude a window from capture (G2 / MS docs).
const WINDOWS_EXCLUDE_FROM_CAPTURE_BUILD: u32 = 19041;

/// First macOS product major where ScreenCaptureKit ignores `sharingType = .none`, so exclusion is
/// best-effort only (Sequoia = macOS 15 = Darwin 24). Documented by A1 / proven-scope by G2. This
/// boundary is exactly the G2 "Darwin >= 24" boundary expressed in product-version terms
/// (macOS 15 = Darwin 24, macOS 26 = Darwin 25).
const MACOS_BEST_EFFORT_MAJOR: u32 = 15;

/// The screen-capture exclusion status the OS actually delivers for the island window. Derived ONLY
/// from the OS + version, NEVER from a `sharingType` read-back (G2: read-back is false safety, it
/// passes while ScreenCaptureKit may still capture). Serialized kebab-case to mirror the TS enum in
/// `src/types/islandSettings.ts` for T7b.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureStatus {
    /// OS is known to honor exclusion: macOS <= 14, or Windows build >= 19041. When the toggle is on,
    /// the window is genuinely hidden from capture.
    On,
    /// The flag is applied but the OS may still capture the window: macOS 15+ (post-15 SCK). Applied
    /// as harmless defense-in-depth; the UI must NOT claim a guarantee (invariant b).
    BestEffort,
    /// The OS lacks a reliable exclusion mechanism: Linux (no API), Windows < 19041.
    Unsupported,
    /// The OS or version could not be determined. Fail-safe: assume the window is visible.
    Unknown,
}

/// Injected OS facts for capture-status derivation. A pure input keeps the full per-OS matrix
/// unit-testable without touching the real OS. macOS carries the product major version
/// (`NSProcessInfo.operatingSystemVersion.majorVersion`): 14 = Sonoma (Darwin 23), 15 = Sequoia
/// (Darwin 24), 26 = Tahoe (Darwin 25).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OsCaptureFacts {
    Macos { major: u32 },
    Windows { build: u32 },
    Linux,
    /// OS/version could not be read (or an unclassified target). Maps to the fail-safe UNKNOWN.
    Undetectable,
}

/// The full status report the IPC surfaces to T7b: the OS-capability tri-state, an honest reason,
/// and the live `hideFromScreenCapture` toggle (whether the flag is applied at all). camelCase on
/// the wire to match the TS mirror.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandCaptureStatus {
    pub status: CaptureStatus,
    pub reason: String,
    pub enabled: bool,
}

impl IslandCaptureStatus {
    fn from_facts(facts: OsCaptureFacts, enabled: bool) -> Self {
        let (status, reason) = derive_capture_status(facts);
        IslandCaptureStatus {
            status,
            reason: reason.to_string(),
            enabled,
        }
    }
}

/// Pure derivation: OS facts -> (status, honest reason). Fail-safe: anything undetectable, or any
/// macOS major at or beyond the best-effort boundary, never returns `On` (invariant b). NEVER
/// inspects a `sharingType` read-back (G2).
pub fn derive_capture_status(facts: OsCaptureFacts) -> (CaptureStatus, &'static str) {
    match facts {
        OsCaptureFacts::Macos { major } if major < MACOS_BEST_EFFORT_MAJOR => (
            CaptureStatus::On,
            "Hidden from screen capture on this macOS version.",
        ),
        OsCaptureFacts::Macos { .. } => (
            CaptureStatus::BestEffort,
            "Best effort only: macOS 15 and later can still capture this window.",
        ),
        OsCaptureFacts::Windows { build } if build >= WINDOWS_EXCLUDE_FROM_CAPTURE_BUILD => (
            CaptureStatus::On,
            "Hidden from screen capture (Windows 10 build 19041 or newer).",
        ),
        OsCaptureFacts::Windows { .. } => (
            CaptureStatus::Unsupported,
            "Not supported: requires Windows 10 build 19041 or newer.",
        ),
        OsCaptureFacts::Linux => (CaptureStatus::Unsupported, "Not supported on Linux."),
        OsCaptureFacts::Undetectable => (
            CaptureStatus::Unknown,
            "Unverified OS: assume this window is visible to screen capture.",
        ),
    }
}

/// Gather the real OS facts and derive the live capture status for `enabled`. Thin runtime seam; all
/// classification lives in the pure `derive_capture_status`. Detection uses only public OS APIs
/// (R-MACOS-PRIVATE): `NSProcessInfo` on macOS, `cmd /C ver` on Windows.
pub fn current_capture_status(enabled: bool) -> IslandCaptureStatus {
    IslandCaptureStatus::from_facts(detect_os_facts(), enabled)
}

/// macOS: product major via `NSProcessInfo.operatingSystemVersion` (public API, not the private
/// SkyLight/CoreGraphics surface). A zero or absent major falls back to the fail-safe UNKNOWN.
#[cfg(target_os = "macos")]
fn detect_os_facts() -> OsCaptureFacts {
    use objc2_foundation::NSProcessInfo;

    let version = NSProcessInfo::processInfo().operatingSystemVersion();
    let major = version.majorVersion;
    if major > 0 {
        OsCaptureFacts::Macos {
            major: major as u32,
        }
    } else {
        OsCaptureFacts::Undetectable
    }
}

/// Windows: build number from `cmd /C ver` (e.g. `Microsoft Windows [Version 10.0.19045.3803]`). No
/// new dependency; any parse failure falls back to the fail-safe UNKNOWN. Unit-tested only via the
/// pure derivation (no Windows machine in this run).
#[cfg(target_os = "windows")]
fn detect_os_facts() -> OsCaptureFacts {
    match windows_build_number() {
        Some(build) => OsCaptureFacts::Windows { build },
        None => OsCaptureFacts::Undetectable,
    }
}

#[cfg(target_os = "windows")]
fn windows_build_number() -> Option<u32> {
    let output = std::process::Command::new("cmd")
        .args(["/C", "ver"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    // "... [Version 10.0.19045.3803]" -> take "10.0.19045.3803" -> the build is the third field.
    let version = text.split('[').nth(1)?.split(']').next()?;
    let build = version.rsplit('.').nth(1)?;
    build.trim().parse().ok()
}

#[cfg(target_os = "linux")]
fn detect_os_facts() -> OsCaptureFacts {
    OsCaptureFacts::Linux
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn detect_os_facts() -> OsCaptureFacts {
    OsCaptureFacts::Undetectable
}

/// Toggle whether the island window receives pointer events. `interactive == false` restores the
/// idle click-through so the transparent envelope never eats clicks; `true` lets the shown capsule
/// take clicks (buttons). In place - never resizes or rebuilds the frame. Dispatches to the main
/// thread.
pub fn set_island_interactive(app: &AppHandle, interactive: bool) {
    let inner = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = inner.get_webview_window(ISLAND_LABEL) {
            let _ = window.set_ignore_cursor_events(!interactive);
        }
    });
}

/// Make the idle island window click-through (transparent envelope must not eat clicks).
fn set_island_idle_click_through(app: &AppHandle) {
    set_island_interactive(app, false);
}

/// Reposition the island window to its target monitor's top-center anchor. MUST run on the main
/// thread (notch detection needs a `MainThreadMarker`). No-op if the window or monitor is missing.
fn reposition_island_on_main(app: &AppHandle) {
    if let Some(monitor) = island_target_monitor(app) {
        // Read the persisted mode + position so a float position anchors the frame to the matching
        // edge. A missing/corrupt file yields defaults (notch/center == top-center). D3: this is an
        // instant `set_position`, never an animated frame move.
        let settings = crate::notification::settings::settings_path(app)
            .map(|p| crate::notification::settings::load_settings(&p))
            .unwrap_or_default();
        let pos = island_anchor_for(monitor, IslandEnvelope::FIXED, settings.mode, settings.position);
        if let Some(window) = app.get_webview_window(ISLAND_LABEL) {
            let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
                pos.x, pos.y,
            )));
        }
    }
}

/// Select the monitor to anchor the island on.
///
/// macOS: when any attached display has a notch, anchor on the primary monitor - the built-in
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
        // MacBook Pro 14" - physical 3024x1964 @ 2.0 (the notched-display case).
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

    // --- Float-mode position anchors (T8) ---
    const ENV: IslandEnvelope = IslandEnvelope::FIXED; // 600 x 560

    #[test]
    fn float_center_equals_top_center_anchor() {
        // Float Center must be byte-identical to the notch top-center anchor so the two never drift.
        for (w, h, sf) in [(1920.0, 1080.0, 1.0), (3024.0, 1964.0, 2.0), (3840.0, 2160.0, 1.5)] {
            let m = MonitorInfo { x: 0.0, y: 0.0, width: w, height: h, scale_factor: sf };
            assert_eq!(
                calculate_island_float_anchor(m, ENV, Position::Center),
                calculate_island_anchor(m, ENV.width),
            );
        }
    }

    #[test]
    fn float_left_hugs_left_edge_with_margin() {
        // 1x @ origin: left edge + 12px margin, top of monitor.
        let m = MonitorInfo { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0, scale_factor: 1.0 };
        let pos = calculate_island_float_anchor(m, ENV, Position::Left);
        assert_eq!(pos.x, 12.0);
        assert_eq!(pos.y, 0.0);

        // 2x retina: logical origin still 0; margin is a logical value, not scaled twice.
        let r = MonitorInfo { x: 0.0, y: 0.0, width: 3024.0, height: 1964.0, scale_factor: 2.0 };
        let rp = calculate_island_float_anchor(r, ENV, Position::Left);
        assert_eq!(rp.x, 12.0);
        assert_eq!(rp.y, 0.0);

        // Secondary monitor offset (physical x 1920 @ 1x) -> logical left edge + margin.
        let s = MonitorInfo { x: 1920.0, y: 0.0, width: 2560.0, height: 1440.0, scale_factor: 1.0 };
        assert_eq!(calculate_island_float_anchor(s, ENV, Position::Left).x, 1932.0);
    }

    #[test]
    fn float_right_hugs_right_edge_with_margin() {
        // 1x: right edge - envelope width - margin = 1920 - 600 - 12 = 1308.
        let m = MonitorInfo { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0, scale_factor: 1.0 };
        let pos = calculate_island_float_anchor(m, ENV, Position::Right);
        assert_eq!(pos.x, 1308.0);
        assert_eq!(pos.y, 0.0);

        // 4k @ 1.5x -> logical width 2560: 2560 - 600 - 12 = 1948.
        let k = MonitorInfo { x: 0.0, y: 0.0, width: 3840.0, height: 2160.0, scale_factor: 1.5 };
        assert_eq!(calculate_island_float_anchor(k, ENV, Position::Right).x, 1948.0);

        // The frame stays fully on-screen: right edge (x + width) <= logical width.
        assert!(pos.x + ENV.width <= 1920.0);
    }

    #[test]
    fn float_bottom_center_anchors_frame_bottom_above_edge() {
        // Horizontally centered like Center; frame bottom sits 12px above the monitor bottom.
        // 1x 1080p: x = (1920-600)/2 = 660; y = 1080 - 560 - 12 = 508.
        let m = MonitorInfo { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0, scale_factor: 1.0 };
        let pos = calculate_island_float_anchor(m, ENV, Position::BottomCenter);
        assert_eq!(pos.x, 660.0);
        assert_eq!(pos.y, 508.0);
        // Frame bottom is exactly FLOAT_EDGE_MARGIN above the monitor bottom.
        assert_eq!(pos.y + ENV.height, 1080.0 - FLOAT_EDGE_MARGIN);

        // 2x retina (logical 1512 x 982): x = (1512-600)/2 = 456; y = 982 - 560 - 12 = 410.
        let r = MonitorInfo { x: 0.0, y: 0.0, width: 3024.0, height: 1964.0, scale_factor: 2.0 };
        let rp = calculate_island_float_anchor(r, ENV, Position::BottomCenter);
        assert_eq!(rp.x, 456.0);
        assert_eq!(rp.y, 410.0);
    }

    #[test]
    fn notch_mode_ignores_position_and_stays_top_center() {
        // Invariant e: in notch mode every position resolves to the top-center anchor.
        let m = MonitorInfo { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0, scale_factor: 1.0 };
        let top_center = calculate_island_anchor(m, ENV.width);
        for position in [Position::Left, Position::Center, Position::Right, Position::BottomCenter] {
            assert_eq!(island_anchor_for(m, ENV, Mode::Notch, position), top_center);
        }
    }

    #[test]
    fn float_mode_dispatch_matches_the_float_anchor() {
        let m = MonitorInfo { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0, scale_factor: 1.0 };
        for position in [Position::Left, Position::Center, Position::Right, Position::BottomCenter] {
            assert_eq!(
                island_anchor_for(m, ENV, Mode::Float, position),
                calculate_island_float_anchor(m, ENV, position),
            );
        }
    }

    #[test]
    fn test_fixed_envelope_bounds_documented_maxima() {
        // The frame must contain the widest state (compactWidth max 600, expandedWidth max 560)
        // and the tallest (maxExpH 560) so it never resizes during morph (D3).
        assert!(IslandEnvelope::FIXED.width >= 600.0);
        assert!(IslandEnvelope::FIXED.height >= 560.0);
    }

    // --- Capture-status derivation matrix (T9) ---
    // macOS product major <-> Darwin kernel major: 13=Darwin22, 14=Darwin23, 15=Darwin24, 26=Darwin25.

    fn status(facts: OsCaptureFacts) -> CaptureStatus {
        derive_capture_status(facts).0
    }

    #[test]
    fn macos_sonoma_and_earlier_is_on() {
        // macOS 13 (Darwin 22) and 14 (Darwin 23): SCK honors sharingType exclusion -> ON.
        assert_eq!(status(OsCaptureFacts::Macos { major: 13 }), CaptureStatus::On);
        assert_eq!(status(OsCaptureFacts::Macos { major: 14 }), CaptureStatus::On);
    }

    #[test]
    fn macos_sequoia_is_best_effort() {
        // macOS 15 (Darwin 24): the boundary case. Post-15 SCK ignores the flag -> BEST_EFFORT.
        assert_eq!(
            status(OsCaptureFacts::Macos { major: 15 }),
            CaptureStatus::BestEffort
        );
    }

    #[test]
    fn macos_tahoe_is_best_effort() {
        // macOS 26 (Darwin 25): the live G2 machine (26.5) -> BEST_EFFORT, never a false ON.
        assert_eq!(
            status(OsCaptureFacts::Macos { major: 26 }),
            CaptureStatus::BestEffort
        );
    }

    #[test]
    fn macos_15_plus_never_reports_on() {
        // Hard invariant (b): NO macOS at or beyond the boundary, present or future, ever claims a
        // silent "hidden" (A1 false-safety is the catastrophic case).
        for major in MACOS_BEST_EFFORT_MAJOR..=40 {
            assert_ne!(
                status(OsCaptureFacts::Macos { major }),
                CaptureStatus::On,
                "macOS major {major} must never report ON"
            );
        }
    }

    #[test]
    fn windows_below_19041_is_unsupported() {
        assert_eq!(
            status(OsCaptureFacts::Windows { build: 19040 }),
            CaptureStatus::Unsupported
        );
    }

    #[test]
    fn windows_19041_and_newer_is_on() {
        assert_eq!(
            status(OsCaptureFacts::Windows { build: 19041 }),
            CaptureStatus::On
        );
        assert_eq!(
            status(OsCaptureFacts::Windows { build: 22631 }),
            CaptureStatus::On
        );
    }

    #[test]
    fn linux_is_unsupported() {
        assert_eq!(status(OsCaptureFacts::Linux), CaptureStatus::Unsupported);
    }

    #[test]
    fn undetectable_fails_safe_to_unknown() {
        // Fail-safe: cannot determine the OS -> assume visible (UNKNOWN), never ON.
        assert_eq!(
            status(OsCaptureFacts::Undetectable),
            CaptureStatus::Unknown
        );
    }

    #[test]
    fn report_mirrors_enabled_flag_without_changing_status() {
        // Toggle round-trip at the pure layer: `enabled` flips in the report while the OS-capability
        // status is unchanged (the OS does not change when the user toggles the setting). The actual
        // set_content_protected re-apply is wired in set_island_settings (T7a) and needs a live app.
        for major in [13u32, 15, 26] {
            let facts = OsCaptureFacts::Macos { major };
            let on = IslandCaptureStatus::from_facts(facts, true);
            let off = IslandCaptureStatus::from_facts(facts, false);
            assert!(on.enabled);
            assert!(!off.enabled);
            assert_eq!(on.status, off.status);
            assert_eq!(on.reason, off.reason);
        }
    }

    #[test]
    fn status_serializes_kebab_case_for_ts_mirror() {
        let report = IslandCaptureStatus::from_facts(OsCaptureFacts::Macos { major: 26 }, true);
        let json = serde_json::to_string(&report).unwrap();
        assert!(json.contains("\"status\":\"best-effort\""));
        assert!(json.contains("\"enabled\":true"));
        assert!(json.contains("\"reason\":\""));
        // The other wire values.
        assert_eq!(
            serde_json::to_string(&CaptureStatus::On).unwrap(),
            "\"on\""
        );
        assert_eq!(
            serde_json::to_string(&CaptureStatus::Unsupported).unwrap(),
            "\"unsupported\""
        );
        assert_eq!(
            serde_json::to_string(&CaptureStatus::Unknown).unwrap(),
            "\"unknown\""
        );
    }
}

#[cfg(test)]
mod capability_tests {
    /// Regression guard for the blank-island ACL bug: the island webview's IPC
    /// (event.listen, window.hide, invokes) is silently denied unless the window
    /// is listed in the default capability. A missing entry renders the island
    /// as an empty transparent envelope with a fully working backend.
    #[test]
    fn island_window_is_in_default_capability() {
        let caps = include_str!("../../capabilities/default.json");
        let parsed: serde_json::Value = serde_json::from_str(caps).unwrap();
        let windows = parsed["windows"].as_array().unwrap();
        assert!(
            windows.iter().any(|w| w == "island"),
            "capabilities/default.json must list the island window or its webview IPC is denied"
        );
    }
}
