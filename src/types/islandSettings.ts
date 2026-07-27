// Persistent island customization settings (D4). Mirror of the Rust `IslandSettings`
// (src-tauri/src/notification/settings.rs) and the mockup playground's island.settings.json schema.
// These are APP settings, never part of the notification payload (guard G12).

export type IslandMode = "notch" | "float";

// Float-mode anchor position (ignored in notch mode).
export type IslandPosition = "left" | "center" | "right" | "bottom-center";

export type IslandAppearance = "dark" | "light" | "auto";

export interface IslandSettings {
  readonly compactWidth: number;
  readonly expandedWidth: number;
  readonly height: number;
  // Fill alpha, 0.0..=1.0 (default 0.94).
  readonly surfaceOpacity: number;
  readonly topRadius: number;
  readonly bottomRadius: number;
  readonly cornerScaling: boolean;
  readonly accent: string;
  readonly mode: IslandMode;
  readonly position: IslandPosition;
  readonly appearance: IslandAppearance;
  readonly reducedMotion: boolean;
  readonly hideFromScreenCapture: boolean;
}

// Honest, OS-derived screen-capture status (T9). Mirror of the Rust `CaptureStatus`
// (src-tauri/src/overlay/island.rs), serialized kebab-case. Derived only from the OS + version,
// never from a sharingType read-back (G2). `best-effort` on macOS 15+ must NEVER render as a
// guaranteed "hidden" (invariant b).
export type IslandCaptureStatusKind =
  | "on"
  | "best-effort"
  | "unsupported"
  | "unknown";

// Mirror of the Rust `IslandCaptureStatus` returned by the `get_island_capture_status` command.
export interface IslandCaptureStatus {
  readonly status: IslandCaptureStatusKind;
  readonly reason: string;
  // The live `hideFromScreenCapture` setting (whether the exclusion flag is applied at all).
  readonly enabled: boolean;
}

// Mockup DEFAULTS - must match the Rust `IslandSettings::default()` exactly.
export const DEFAULT_ISLAND_SETTINGS: IslandSettings = {
  compactWidth: 218,
  expandedWidth: 380,
  height: 34,
  surfaceOpacity: 0.94,
  topRadius: 6,
  bottomRadius: 14,
  cornerScaling: true,
  accent: "#4a9eff",
  mode: "notch",
  position: "center",
  appearance: "dark",
  reducedMotion: false,
  hideFromScreenCapture: true,
};
