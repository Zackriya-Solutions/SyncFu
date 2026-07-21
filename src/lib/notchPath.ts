// Dynamic Island shape generator - ported verbatim from the approved mockup
// (tasks/dynamic-island-mockup.html, notchPath ~L753, capsulePath ~L770,
// --di-wall publication ~L887). Pure geometry: ZERO Tauri / React / DOM deps.
//
// Concave top shoulders (quadratic-Bezier control point AT the outer top corner,
// on the top edge) + convex bottom rounds. Guard G3 (SVG path, not CSS mask),
// G4 (no canvas). Geometry matches boring.notch / DynamicNotchKit.

/** Compact -> expanded default radii (D3: 6/14 -> 19/24). Consumed by callers. */
export const RADII = {
  compactTop: 6,
  compactBottom: 14,
  expandedTop: 19,
  expandedBottom: 24,
} as const;

export interface NotchDims {
  readonly W: number;
  readonly H: number;
  /** top shoulder radius (concave) */
  readonly t: number;
  /** bottom corner radius (convex) */
  readonly b: number;
}

/** Round to 2 decimals - the mockup's path-precision quantum (parity TOL 0.01). */
const n = (v: number): number => Math.round(v * 100) / 100;

/** Clamp the shoulders so content can never invert them regardless of input. */
function clampRadii(W: number, H: number, t: number, b: number): [number, number] {
  t = Math.max(0, Math.min(t, W / 4, H / 4));
  b = Math.max(0, Math.min(b, W / 4, H / 2));
  return [t, b];
}

/**
 * The single notch segment generator. `fy` maps each y in `[0, H]` to the emitted
 * y coordinate: `notchPath` passes the identity (concave shoulders on top);
 * `notchPathMirrored` passes `y => H - y` (a pure vertical flip - concave
 * shoulders on the BOTTOM, for the flush bottom-center island). Both callers reuse
 * this ONE segment math, so the mirror is a y-flip, not a second generator.
 */
function buildNotch(
  W: number,
  H: number,
  t: number,
  b: number,
  fy: (y: number) => number
): string {
  return (
    `M 0 ${n(fy(0))}` +
    ` Q ${n(t)} ${n(fy(0))} ${n(t)} ${n(fy(t))}` +
    ` L ${n(t)} ${n(fy(H - b))}` +
    ` Q ${n(t)} ${n(fy(H))} ${n(t + b)} ${n(fy(H))}` +
    ` L ${n(W - t - b)} ${n(fy(H))}` +
    ` Q ${n(W - t)} ${n(fy(H))} ${n(W - t)} ${n(fy(H - b))}` +
    ` L ${n(W - t)} ${n(fy(t))}` +
    ` Q ${n(W - t)} ${n(fy(0))} ${n(W)} ${n(fy(0))}` +
    ` Z`
  );
}

/**
 * SVG path `d` for the notch shape. Clamps `t<=min(W/4,H/4)`, `b<=min(W/4,H/2)`,
 * both `>=0`, so content can never invert the shoulder regardless of caller input.
 */
export function notchPath({ W, H, t, b }: NotchDims): string {
  const [ct, cb] = clampRadii(W, H, t, b);
  return buildNotch(W, H, ct, cb, (y) => y);
}

/**
 * Vertically-mirrored notch shape for the flush bottom-center island (T8). The
 * concave shoulders sit on the BOTTOM edge (hugging the bottom the way the notch
 * hugs the top), the convex rounds on top - a "bottom notch" / volume-OSD form.
 * Reuses `notchPath`'s exact segment math via a `y => H - y` flip (same clamps,
 * same precision), so parity with the top notch is structural.
 */
export function notchPathMirrored({ W, H, t, b }: NotchDims): string {
  const [ct, cb] = clampRadii(W, H, t, b);
  return buildNotch(W, H, ct, cb, (y) => H - y);
}

/**
 * Convex rounded-rect for float mode (Windows/Linux). Every corner rounds
 * outward (no concave shoulders). `r` defaults to a full capsule (H/2) and is
 * clamped to `min(H/2, W/2)`.
 */
export function capsulePath(W: number, H: number, r?: number): string {
  r = Math.min(r == null ? H / 2 : r, H / 2, W / 2);
  return (
    `M ${n(r)} 0` +
    ` L ${n(W - r)} 0 Q ${n(W)} 0 ${n(W)} ${n(r)}` +
    ` L ${n(W)} ${n(H - r)} Q ${n(W)} ${n(H)} ${n(W - r)} ${n(H)}` +
    ` L ${n(r)} ${n(H)} Q 0 ${n(H)} 0 ${n(H - r)}` +
    ` L 0 ${n(r)} Q 0 0 ${n(r)} 0 Z`
  );
}

// --- Wall inset (--di-wall) + content padding rule (R-WALL) ------------------
// The published --di-wall value equals the shoulder inset: `t` in notch mode,
// the corner radius in float mode. Content padding derives from it so text/icons
// can never reach the walls or corner curves (R-WALL, the 3x-recurring bug).

/**
 * Float-mode wall radius. DRIFT RESOLUTION: the mockup's live controller uses
 * 24 for the expanded float pill (createIsland ~L883/887) while the static
 * screenshot path uses 22 (mountStatic ~L985/986). We canonicalize to 24 -
 * it matches the interactive controller and the locked D3 `expBotR: 24`
 * ("radii 6/14 -> 19/24 expanded"); the static 22 is the drift.
 */
export const EXPANDED_FLOAT_RADIUS = 24;

export function floatWallRadius(H: number, expanded: boolean): number {
  return expanded ? EXPANDED_FLOAT_RADIUS : H / 2;
}

export type ContentKind = "compact" | "card" | "list";

// DRIFT RESOLUTION: the mockup drifts the additive margin across presets
// (+4 compact, +5 / +4 expanded card, +2 list). We canonicalize to ONE margin
// per content type - the dominant (larger) value, since a larger inset is
// strictly safer for R-WALL. Base floors are the compact/card/list defaults.
export const WALL_MARGIN: Record<ContentKind, number> = { compact: 4, card: 5, list: 2 };
export const WALL_BASE: Record<ContentKind, number> = { compact: 14, card: 16, list: 8 };

/**
 * Horizontal content padding for a given wall inset + content type, mirroring
 * the mockup's `max(base, calc(var(--di-wall) + margin))`. Always `>= wall`, so
 * content never crosses the concave shoulder (R-WALL).
 */
export function wallPadding(wall: number, kind: ContentKind): number {
  return Math.max(WALL_BASE[kind], wall + WALL_MARGIN[kind]);
}
