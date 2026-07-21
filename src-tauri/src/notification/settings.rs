//! Persistent island customization settings (D4).
//!
//! These are APP settings, never per-notification payload (guard G12: the notification payload
//! schema is not extended with geometry). Stored as plain serde JSON in the app config dir - no
//! SQLite, no tauri-plugin-store (guard G6).
//!
//! On-disk shape is the mockup playground's `island.settings.json` block verbatim (the exact
//! schema): a top-level `island` object wrapping the 13 keys, so a file copied out of the playground
//! loads as-is:
//!
//! ```json
//! { "island": { "compactWidth": 218, "expandedWidth": 380, ... } }
//! ```
//!
//! `surfaceOpacity` is a CSS fill alpha in 0.0..=1.0 (the mockup persists `0.94`); the "0-100" in
//! the spec is the UI percent domain, not the stored unit.
//!
//! Robustness (R-SETTINGS-WRITE):
//! - `load_settings` never panics - a missing, corrupt, or truncated file falls back to defaults,
//!   and numeric knobs are clamped to their valid ranges after parse.
//! - `save_settings` is atomic - it writes a sibling `.tmp` file then renames it over the target, so
//!   a crashed write leaves the previous valid file intact.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Compact-pill width clamp (logical px).
const COMPACT_WIDTH_RANGE: (u32, u32) = (150, 600);
/// Expanded-card width clamp (logical px).
const EXPANDED_WIDTH_RANGE: (u32, u32) = (320, 560);
/// Capsule height clamp (logical px).
const HEIGHT_RANGE: (u32, u32) = (24, 60);
/// Top-corner radius clamp (logical px) - FR-8 amendment range.
const TOP_RADIUS_RANGE: (u32, u32) = (0, 24);
/// Bottom-corner radius clamp (logical px) - FR-8 amendment range.
const BOTTOM_RADIUS_RANGE: (u32, u32) = (0, 40);
/// Surface fill alpha clamp (0.0..=1.0).
const SURFACE_OPACITY_RANGE: (f64, f64) = (0.0, 1.0);

/// Basename of the settings file in the app config dir.
const SETTINGS_FILE_NAME: &str = "island.settings.json";

/// Island presentation mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Hug the physical notch (macOS) / top-center floating capsule elsewhere.
    #[default]
    Notch,
    /// Detached floating capsule, positioned via `position` (float only).
    Float,
}

/// Float-mode anchor position (ignored in notch mode; T8 renders these).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Position {
    Left,
    #[default]
    Center,
    Right,
    /// Anchored above the bottom edge, expanding upward (float only).
    BottomCenter,
}

/// Color scheme for the expanded card and float compact pill. The notch compact pill stays black
/// in every mode (D4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    #[default]
    Dark,
    Light,
    Auto,
}

/// The 13 persistent island settings (D4). camelCase on the wire to match the mockup schema and the
/// TS mirror in `src/types/islandSettings.ts`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IslandSettings {
    pub compact_width: u32,
    pub expanded_width: u32,
    pub height: u32,
    /// Fill alpha, 0.0..=1.0 (mockup default 0.94).
    pub surface_opacity: f64,
    pub top_radius: u32,
    pub bottom_radius: u32,
    pub corner_scaling: bool,
    pub accent: String,
    pub mode: Mode,
    pub position: Position,
    pub appearance: Appearance,
    pub reduced_motion: bool,
    pub hide_from_screen_capture: bool,
}

impl Default for IslandSettings {
    /// Mockup DEFAULTS (the `DEFAULTS` object in `tasks/dynamic-island-mockup.html`).
    fn default() -> Self {
        Self {
            compact_width: 218,
            expanded_width: 380,
            height: 34,
            surface_opacity: 0.94,
            top_radius: 6,
            bottom_radius: 14,
            corner_scaling: true,
            accent: "#4a9eff".to_string(),
            mode: Mode::Notch,
            position: Position::Center,
            appearance: Appearance::Dark,
            reduced_motion: false,
            hide_from_screen_capture: true,
        }
    }
}

impl IslandSettings {
    /// Return a copy with every numeric knob clamped to its valid range (immutable). Non-finite
    /// opacity (unreachable from valid JSON, which cannot encode NaN/Infinity) falls back to the
    /// default. Enums and booleans are already constrained by the type system.
    pub fn clamped(&self) -> Self {
        let surface_opacity = if self.surface_opacity.is_finite() {
            self.surface_opacity
                .clamp(SURFACE_OPACITY_RANGE.0, SURFACE_OPACITY_RANGE.1)
        } else {
            IslandSettings::default().surface_opacity
        };
        Self {
            compact_width: self
                .compact_width
                .clamp(COMPACT_WIDTH_RANGE.0, COMPACT_WIDTH_RANGE.1),
            expanded_width: self
                .expanded_width
                .clamp(EXPANDED_WIDTH_RANGE.0, EXPANDED_WIDTH_RANGE.1),
            height: self.height.clamp(HEIGHT_RANGE.0, HEIGHT_RANGE.1),
            surface_opacity,
            top_radius: self.top_radius.clamp(TOP_RADIUS_RANGE.0, TOP_RADIUS_RANGE.1),
            bottom_radius: self
                .bottom_radius
                .clamp(BOTTOM_RADIUS_RANGE.0, BOTTOM_RADIUS_RANGE.1),
            corner_scaling: self.corner_scaling,
            accent: self.accent.clone(),
            mode: self.mode,
            position: self.position,
            appearance: self.appearance,
            reduced_motion: self.reduced_motion,
            hide_from_screen_capture: self.hide_from_screen_capture,
        }
    }

    /// Whether any window-geometry / placement field differs from `other`. Drives the conditional
    /// in-place reflow on set (appearance-only changes must not reflow). Size and placement fields
    /// only; accent / opacity / appearance / reducedMotion / capture are not geometry.
    pub fn geometry_differs(&self, other: &Self) -> bool {
        self.compact_width != other.compact_width
            || self.expanded_width != other.expanded_width
            || self.height != other.height
            || self.top_radius != other.top_radius
            || self.bottom_radius != other.bottom_radius
            || self.corner_scaling != other.corner_scaling
            || self.mode != other.mode
            || self.position != other.position
    }
}

/// On-disk wrapper preserving the mockup's `{ "island": { ... } }` envelope (the exact schema).
#[derive(Serialize, Deserialize)]
struct SettingsFile {
    #[serde(default)]
    island: IslandSettings,
}

/// Absolute path to the settings file in the app config dir.
pub fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no app config dir: {e}"))?;
    Ok(dir.join(SETTINGS_FILE_NAME))
}

/// Load settings from `path`, clamped. A missing, unreadable, corrupt, or truncated file yields
/// defaults - never panics (R-SETTINGS-WRITE). Missing individual keys fall back to their default
/// (via `#[serde(default)]`); present-but-invalid values fail the parse and yield full defaults.
pub fn load_settings(path: &Path) -> IslandSettings {
    match std::fs::read_to_string(path) {
        Ok(contents) => match serde_json::from_str::<SettingsFile>(&contents) {
            Ok(file) => file.island.clamped(),
            Err(_) => IslandSettings::default(),
        },
        Err(_) => IslandSettings::default(),
    }
}

/// Persist `settings` to `path` atomically: write a sibling `.tmp` then rename it over the target.
/// A crashed or partial write only orphans the `.tmp`, leaving the previous valid file intact.
pub fn save_settings(path: &Path, settings: &IslandSettings) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "settings path has no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("create config dir: {e}"))?;

    let file = SettingsFile {
        island: settings.clone(),
    };
    let json = serde_json::to_string_pretty(&file).map_err(|e| format!("serialize: {e}"))?;

    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json.as_bytes()).map_err(|e| format!("write temp: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("rename temp: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Unique scratch dir under the system temp dir; removed on drop.
    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("syncfu-settings-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
        fn file(&self) -> PathBuf {
            self.0.join(SETTINGS_FILE_NAME)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn default_matches_mockup_exactly() {
        let d = IslandSettings::default();
        assert_eq!(d.compact_width, 218);
        assert_eq!(d.expanded_width, 380);
        assert_eq!(d.height, 34);
        assert_eq!(d.surface_opacity, 0.94);
        assert_eq!(d.top_radius, 6);
        assert_eq!(d.bottom_radius, 14);
        assert!(d.corner_scaling);
        assert_eq!(d.accent, "#4a9eff");
        assert_eq!(d.mode, Mode::Notch);
        assert_eq!(d.position, Position::Center);
        assert_eq!(d.appearance, Appearance::Dark);
        assert!(!d.reduced_motion);
        assert!(d.hide_from_screen_capture);
    }

    #[test]
    fn serializes_camelcase_under_island_wrapper() {
        let file = SettingsFile {
            island: IslandSettings::default(),
        };
        let json = serde_json::to_string(&file).unwrap();
        assert!(json.starts_with("{\"island\":{"));
        assert!(json.contains("\"compactWidth\":218"));
        assert!(json.contains("\"expandedWidth\":380"));
        assert!(json.contains("\"surfaceOpacity\":0.94"));
        assert!(json.contains("\"topRadius\":6"));
        assert!(json.contains("\"bottomRadius\":14"));
        assert!(json.contains("\"cornerScaling\":true"));
        assert!(json.contains("\"hideFromScreenCapture\":true"));
        // Enum wire values.
        assert!(json.contains("\"mode\":\"notch\""));
        assert!(json.contains("\"position\":\"center\""));
        assert!(json.contains("\"appearance\":\"dark\""));
    }

    #[test]
    fn position_bottom_center_is_kebab_case() {
        let s = IslandSettings {
            position: Position::BottomCenter,
            ..IslandSettings::default()
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"position\":\"bottom-center\""));
        let back: IslandSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.position, Position::BottomCenter);
    }

    #[test]
    fn clamp_below_minimum_raises_to_min() {
        let s = IslandSettings {
            compact_width: 10,
            expanded_width: 10,
            height: 1,
            surface_opacity: -0.5,
            top_radius: 0,
            bottom_radius: 0,
            ..IslandSettings::default()
        }
        .clamped();
        assert_eq!(s.compact_width, 150);
        assert_eq!(s.expanded_width, 320);
        assert_eq!(s.height, 24);
        assert_eq!(s.surface_opacity, 0.0);
        assert_eq!(s.top_radius, 0);
        assert_eq!(s.bottom_radius, 0);
    }

    #[test]
    fn clamp_above_maximum_lowers_to_max() {
        let s = IslandSettings {
            compact_width: 9999,
            expanded_width: 9999,
            height: 9999,
            surface_opacity: 5.0,
            top_radius: 9999,
            bottom_radius: 9999,
            ..IslandSettings::default()
        }
        .clamped();
        assert_eq!(s.compact_width, 600);
        assert_eq!(s.expanded_width, 560);
        assert_eq!(s.height, 60);
        assert_eq!(s.surface_opacity, 1.0);
        assert_eq!(s.top_radius, 24);
        assert_eq!(s.bottom_radius, 40);
    }

    #[test]
    fn clamp_within_range_is_unchanged() {
        let s = IslandSettings {
            compact_width: 300,
            expanded_width: 400,
            height: 40,
            surface_opacity: 0.5,
            top_radius: 12,
            bottom_radius: 20,
            ..IslandSettings::default()
        };
        assert_eq!(s.clamped(), s);
    }

    #[test]
    fn load_missing_file_returns_defaults() {
        let tmp = TempDir::new();
        assert_eq!(load_settings(&tmp.file()), IslandSettings::default());
    }

    #[test]
    fn load_corrupt_file_returns_defaults() {
        let tmp = TempDir::new();
        std::fs::write(tmp.file(), b"{ this is not json").unwrap();
        assert_eq!(load_settings(&tmp.file()), IslandSettings::default());
    }

    #[test]
    fn load_truncated_file_returns_defaults() {
        let tmp = TempDir::new();
        std::fs::write(tmp.file(), b"{\"island\":{\"compactWidth\":").unwrap();
        assert_eq!(load_settings(&tmp.file()), IslandSettings::default());
    }

    #[test]
    fn load_clamps_out_of_range_values_from_disk() {
        let tmp = TempDir::new();
        std::fs::write(
            tmp.file(),
            br#"{"island":{"compactWidth":9999,"height":1,"surfaceOpacity":3.0,"bottomRadius":999}}"#,
        )
        .unwrap();
        let s = load_settings(&tmp.file());
        assert_eq!(s.compact_width, 600);
        assert_eq!(s.height, 24);
        assert_eq!(s.surface_opacity, 1.0);
        assert_eq!(s.bottom_radius, 40);
        // Unspecified keys fall back to their defaults.
        assert_eq!(s.expanded_width, 380);
        assert_eq!(s.accent, "#4a9eff");
    }

    #[test]
    fn save_then_load_round_trips() {
        let tmp = TempDir::new();
        let s = IslandSettings {
            compact_width: 250,
            accent: "#ff3b30".to_string(),
            mode: Mode::Float,
            position: Position::BottomCenter,
            appearance: Appearance::Light,
            reduced_motion: true,
            hide_from_screen_capture: false,
            ..IslandSettings::default()
        };
        save_settings(&tmp.file(), &s).unwrap();
        assert_eq!(load_settings(&tmp.file()), s);
    }

    #[test]
    fn save_overwrites_previous_file() {
        let tmp = TempDir::new();
        let v1 = IslandSettings {
            compact_width: 200,
            ..IslandSettings::default()
        };
        let v2 = IslandSettings {
            compact_width: 500,
            ..IslandSettings::default()
        };
        save_settings(&tmp.file(), &v1).unwrap();
        save_settings(&tmp.file(), &v2).unwrap();
        assert_eq!(load_settings(&tmp.file()).compact_width, 500);
    }

    #[test]
    fn partial_temp_write_leaves_prior_file_intact() {
        // Atomic-write invariant: a crashed write lives only in the sibling `.tmp`; the canonical
        // file still loads the prior valid value.
        let tmp = TempDir::new();
        let path = tmp.file();
        let v1 = IslandSettings {
            compact_width: 222,
            ..IslandSettings::default()
        };
        save_settings(&path, &v1).unwrap();

        // Simulate an interrupted write: garbage in the `.tmp`, never renamed.
        let tmp_path = path.with_extension("json.tmp");
        std::fs::write(&tmp_path, b"{\"island\":{\"compactWidth\":").unwrap();

        // Canonical file is untouched and still valid.
        assert_eq!(load_settings(&path), v1);
    }

    #[test]
    fn save_creates_missing_config_dir() {
        let tmp = TempDir::new();
        let nested = tmp.0.join("a").join("b").join(SETTINGS_FILE_NAME);
        save_settings(&nested, &IslandSettings::default()).unwrap();
        assert!(nested.exists());
    }

    #[test]
    fn geometry_differs_only_on_size_and_placement() {
        let base = IslandSettings::default();
        // Appearance-only changes are not geometry.
        let appearance_only = IslandSettings {
            accent: "#ffffff".to_string(),
            surface_opacity: 0.5,
            appearance: Appearance::Light,
            reduced_motion: true,
            hide_from_screen_capture: false,
            ..base.clone()
        };
        assert!(!base.geometry_differs(&appearance_only));

        // Each geometry field flips the flag.
        assert!(base.geometry_differs(&IslandSettings {
            compact_width: 300,
            ..base.clone()
        }));
        assert!(base.geometry_differs(&IslandSettings {
            top_radius: 10,
            ..base.clone()
        }));
        assert!(base.geometry_differs(&IslandSettings {
            mode: Mode::Float,
            ..base.clone()
        }));
        assert!(base.geometry_differs(&IslandSettings {
            position: Position::Left,
            ..base.clone()
        }));
    }
}
