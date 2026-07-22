import { useEffect } from "react";
import { core } from "@tauri-apps/api";
import { useIslandSettingsStore } from "@/stores/islandSettingsStore";
import {
  DEFAULT_ISLAND_SETTINGS,
  type IslandAppearance,
  type IslandCaptureStatus,
  type IslandMode,
  type IslandPosition,
  type IslandSettings,
} from "@/types/islandSettings";

// Island settings surface (T7b). Ports the approved mockup playground's controls
// (approved design mockup, section 02) into the main window - a tray
// menu cannot host 13 controls (documented layout-slot decision). Every control
// writes optimistically to the store AND persists via set_island_settings; the
// backend re-emits island:settings so the LIVE island restyles with no restart
// or resend (D4). The UI domain is percent (0-100) for the fill alpha; the store
// and backend keep 0.0..=1.0 (T7a decision). Position is float-only: notch mode
// disables it (bottom-center included but only valid when floating).

// UI slider ranges mirror the Rust clamps (settings.rs) exactly, so the panel
// never shows a value the backend would silently clamp away.
const RANGES = {
  compactWidth: { min: 150, max: 600 },
  expandedWidth: { min: 320, max: 560 },
  height: { min: 24, max: 60 },
  topRadius: { min: 0, max: 24 },
  bottomRadius: { min: 0, max: 40 },
} as const;

// The mockup's eight accent swatches; the first four map to notification
// priority (low / normal / high / critical).
const ACCENT_SWATCHES = [
  "#2ed573",
  "#4a9eff",
  "#ffa502",
  "#ff3b30",
  "#af52de",
  "#ff2d92",
  "#5ac8fa",
  "#ffd60a",
] as const;

// Presets from the mockup (opacity converted to the 0..=1 store domain). Applied
// as a MERGE over the current settings, matching the mockup's Object.assign - so
// placement/appearance/behavior the preset does not name are preserved.
const PRESETS: Record<string, Partial<IslandSettings>> = {
  apple: {
    compactWidth: 218,
    expandedWidth: 380,
    height: 34,
    surfaceOpacity: 0.94,
    topRadius: 6,
    bottomRadius: 14,
    cornerScaling: true,
    accent: "#4a9eff",
    mode: "notch",
  },
  slim: {
    compactWidth: 172,
    expandedWidth: 340,
    height: 27,
    surfaceOpacity: 0.9,
    topRadius: 4,
    bottomRadius: 10,
    cornerScaling: false,
    accent: "#2ed573",
    mode: "notch",
  },
  big: {
    compactWidth: 300,
    expandedWidth: 520,
    height: 48,
    surfaceOpacity: 0.98,
    topRadius: 10,
    bottomRadius: 22,
    cornerScaling: true,
    accent: "#ffa502",
    mode: "notch",
  },
};

const APPEARANCES: readonly { value: IslandAppearance; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "auto", label: "Auto" },
];

const MODES: readonly { value: IslandMode; label: string }[] = [
  { value: "notch", label: "Notch · macOS" },
  { value: "float", label: "Float · Win/Linux" },
];

const POSITIONS: readonly { value: IslandPosition; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "bottom-center", label: "Bottom center" },
];

/** Store alpha (0..=1) -> UI percent (0-100). */
const toPercent = (alpha: number): number => Math.round(alpha * 100);
/** UI percent (0-100) -> store alpha (0..=1), 2-dp like the mockup JSON. */
const fromPercent = (percent: number): number => Number((percent / 100).toFixed(2));

interface CaptureView {
  readonly on: boolean;
  readonly label: string;
}

/** Honest capture-status label + whether it may render as guaranteed-on (green).
 *  Green ON only when the OS guarantees exclusion AND the toggle is enabled;
 *  best-effort / unsupported / unknown / disabled never read as guaranteed. */
function captureView(status: IslandCaptureStatus): CaptureView {
  if (!status.enabled) {
    return { on: false, label: "Screen-sharing protection is off" };
  }
  switch (status.status) {
    case "on":
      return { on: true, label: "Hidden from screen sharing" };
    case "best-effort":
      return { on: false, label: "Best effort on this OS" };
    case "unsupported":
      return { on: false, label: "Not supported on this OS" };
    default:
      return { on: false, label: "Screen-sharing status unknown" };
  }
}

export function IslandSettingsPanel() {
  const settings = useIslandSettingsStore((s) => s.settings);
  const captureStatus = useIslandSettingsStore((s) => s.captureStatus);
  const setSettings = useIslandSettingsStore((s) => s.setSettings);
  const setCaptureStatus = useIslandSettingsStore((s) => s.setCaptureStatus);

  // Read the persisted settings + honest capture status once on mount, so the
  // panel reflects the real backend state rather than the store defaults.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const persisted = await core.invoke<IslandSettings>("get_island_settings");
        if (active && persisted) setSettings(persisted);
      } catch {
        // No backend (browser harness) or read failure: keep the store value.
      }
      void refreshCaptureStatus(active);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshCaptureStatus(active = true): Promise<void> {
    try {
      const status = await core.invoke<IslandCaptureStatus>(
        "get_island_capture_status"
      );
      if (active && status) setCaptureStatus(status);
    } catch {
      // Never infer client-side (G2): leave the status as-is on failure.
    }
  }

  // Optimistic write + persist. Build `next` from the LIVE store (not a possibly
  // stale render closure) so rapid consecutive edits compose correctly. We do NOT
  // reconcile the backend's clamped return into the store: the UI ranges mirror
  // the Rust clamps exactly (and the color input yields valid hex), so an in-range
  // value is never changed - and reconciling a slow earlier response after a later
  // edit would clobber the newer value. The store stays the single writer.
  function update(patch: Partial<IslandSettings>): void {
    const next: IslandSettings = {
      ...useIslandSettingsStore.getState().settings,
      ...patch,
    };
    setSettings(next);
    const persisted = core.invoke("set_island_settings", { settings: next });
    // The honest capture status depends on the persisted `hideFromScreenCapture`;
    // re-read it only after the write lands, and only when that toggle moved.
    if (patch.hideFromScreenCapture !== undefined) {
      persisted.then(() => refreshCaptureStatus()).catch(() => {});
    } else {
      persisted.catch(() => {});
    }
  }

  const notchMode = settings.mode === "notch";
  const capture = captureStatus ? captureView(captureStatus) : null;

  return (
    <div data-testid="island-settings-panel" className="island-settings">
      <header className="island-settings-head">
        <h2>Island</h2>
        <p>
          Persistent appearance for the Dynamic Island. Changes restyle the live
          island instantly - nothing here is per-notification.
        </p>
      </header>

      <section className="settings-group">
        <div className="settings-group-label">Geometry</div>
        <SliderRow
          id="compactWidth"
          label="Compact width"
          value={settings.compactWidth}
          range={RANGES.compactWidth}
          format={(v) => `${v} px`}
          onChange={(v) => update({ compactWidth: v })}
        />
        <SliderRow
          id="expandedWidth"
          label="Expanded width"
          value={settings.expandedWidth}
          range={RANGES.expandedWidth}
          format={(v) => `${v} px`}
          onChange={(v) => update({ expandedWidth: v })}
        />
        <SliderRow
          id="height"
          label="Height"
          value={settings.height}
          range={RANGES.height}
          format={(v) => `${v} px`}
          onChange={(v) => update({ height: v })}
        />
      </section>

      <section className="settings-group">
        <div className="settings-group-label">Surface</div>
        <SliderRow
          id="surfaceOpacity"
          label="Transparency"
          caption="Alpha of the pill fill only - sender, timers and text stay opaque."
          value={toPercent(settings.surfaceOpacity)}
          range={{ min: 0, max: 100 }}
          format={(v) => `${v}%`}
          onChange={(v) => update({ surfaceOpacity: fromPercent(v) })}
        />
        <SegmentedRow
          id="appearance"
          label="Appearance"
          caption="Light re-skins the expanded card & float pills only. In notch mode the compact pill stays pure black. Auto follows the OS."
          value={settings.appearance}
          options={APPEARANCES}
          onChange={(v) => update({ appearance: v })}
        />
      </section>

      <section className="settings-group">
        <div className="settings-group-label">Corners</div>
        <SliderRow
          id="topRadius"
          label="Shoulder / top radius"
          value={settings.topRadius}
          range={RANGES.topRadius}
          format={(v) => `${v} px`}
          onChange={(v) => update({ topRadius: v })}
        />
        <SliderRow
          id="bottomRadius"
          label="Bottom radius"
          value={settings.bottomRadius}
          range={RANGES.bottomRadius}
          format={(v) => `${v} px`}
          onChange={(v) => update({ bottomRadius: v })}
        />
        <ToggleRow
          id="cornerScaling"
          label="Grow radii on expand"
          caption="6 / 14 grow to 19 / 24 when the pill opens."
          checked={settings.cornerScaling}
          onChange={(v) => update({ cornerScaling: v })}
        />
      </section>

      <section className="settings-group">
        <div className="settings-group-label">Accent</div>
        <div className="settings-row">
          <span className="settings-label">
            Preset
            <span className="settings-caption">
              First four map to notification priority - low 6s / normal 8s / high
              12s / critical never. Accent tints indicators only.
            </span>
          </span>
        </div>
        <div className="settings-swatches" data-testid="island-set-accent">
          {ACCENT_SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              className={`settings-swatch${
                settings.accent.toLowerCase() === hex ? " on" : ""
              }`}
              style={{ background: hex }}
              aria-label={`Accent ${hex}`}
              aria-pressed={settings.accent.toLowerCase() === hex}
              onClick={() => update({ accent: hex })}
            />
          ))}
          <input
            type="color"
            className="settings-swatch-custom"
            aria-label="Custom accent color"
            value={settings.accent}
            onChange={(e) => update({ accent: e.target.value.toLowerCase() })}
          />
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group-label">Placement</div>
        <SegmentedRow
          id="mode"
          label="Mode"
          caption="Concave shoulders are macOS-only."
          value={settings.mode}
          options={MODES}
          onChange={(v) => update({ mode: v })}
        />
        <SegmentedRow
          id="position"
          label="Position"
          caption="Float mode only. Bottom center expands upward."
          value={settings.position}
          options={POSITIONS}
          disabled={notchMode}
          onChange={(v) => update({ position: v })}
        />
      </section>

      <section className="settings-group">
        <div className="settings-group-label">Behavior</div>
        <ToggleRow
          id="reducedMotion"
          label="Reduced motion"
          caption="Near-instant spring (1000 / 100)."
          checked={settings.reducedMotion}
          onChange={(v) => update({ reducedMotion: v })}
        />
        <ToggleRow
          id="hideFromScreenCapture"
          label="Hide from screen sharing"
          checked={settings.hideFromScreenCapture}
          onChange={(v) => update({ hideFromScreenCapture: v })}
        />
        <div
          data-testid="island-capture-status"
          data-status={captureStatus ? captureStatus.status : "pending"}
          className={`settings-capture${capture?.on ? " on" : ""}`}
        >
          <span className="settings-capture-dot" aria-hidden="true" />
          <div>
            <div className="settings-capture-label">
              {capture ? capture.label : "Checking screen-sharing protection..."}
            </div>
            {captureStatus && (
              <div className="settings-capture-reason">{captureStatus.reason}</div>
            )}
          </div>
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group-label">Presets</div>
        <div className="settings-presets">
          <button
            type="button"
            data-testid="island-preset-apple"
            className="settings-preset"
            onClick={() => update(PRESETS.apple)}
          >
            Apple default
          </button>
          <button
            type="button"
            data-testid="island-preset-slim"
            className="settings-preset"
            onClick={() => update(PRESETS.slim)}
          >
            Slim bar
          </button>
          <button
            type="button"
            data-testid="island-preset-big"
            className="settings-preset"
            onClick={() => update(PRESETS.big)}
          >
            Big status
          </button>
          <button
            type="button"
            data-testid="island-reset"
            className="settings-preset reset"
            onClick={() => update(DEFAULT_ISLAND_SETTINGS)}
          >
            Reset to defaults
          </button>
        </div>
      </section>
    </div>
  );
}

interface SliderRowProps {
  readonly id: string;
  readonly label: string;
  readonly caption?: string;
  readonly value: number;
  readonly range: { readonly min: number; readonly max: number };
  readonly format: (v: number) => string;
  readonly onChange: (v: number) => void;
}

function SliderRow({ id, label, caption, value, range, format, onChange }: SliderRowProps) {
  return (
    <div className="settings-row col">
      <div className="settings-row-head">
        <span className="settings-label">
          {label}
          {caption && <span className="settings-caption">{caption}</span>}
        </span>
        <span className="settings-value" data-testid={`island-val-${id}`}>
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        data-testid={`island-set-${id}`}
        min={range.min}
        max={range.max}
        step={1}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

interface SegmentedRowProps<T extends string> {
  readonly id: string;
  readonly label: string;
  readonly caption?: string;
  readonly value: T;
  readonly options: readonly { value: T; label: string }[];
  readonly disabled?: boolean;
  readonly onChange: (v: T) => void;
}

function SegmentedRow<T extends string>({
  id,
  label,
  caption,
  value,
  options,
  disabled = false,
  onChange,
}: SegmentedRowProps<T>) {
  return (
    <div className="settings-row">
      <span className="settings-label">
        {label}
        {caption && <span className="settings-caption">{caption}</span>}
      </span>
      <div className="settings-seg" role="group" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            data-testid={`island-set-${id}-${opt.value}`}
            className={`settings-seg-btn${value === opt.value ? " on" : ""}`}
            aria-pressed={value === opt.value}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ToggleRowProps {
  readonly id: string;
  readonly label: string;
  readonly caption?: string;
  readonly checked: boolean;
  readonly onChange: (v: boolean) => void;
}

function ToggleRow({ id, label, caption, checked, onChange }: ToggleRowProps) {
  return (
    <div className="settings-row">
      <span className="settings-label">
        {label}
        {caption && <span className="settings-caption">{caption}</span>}
      </span>
      <label className="settings-switch">
        <input
          type="checkbox"
          data-testid={`island-set-${id}`}
          checked={checked}
          aria-label={label}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="settings-switch-track" />
      </label>
    </div>
  );
}
