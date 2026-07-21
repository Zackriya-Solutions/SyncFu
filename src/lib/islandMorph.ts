// Dynamic Island morph controller - ported from the approved mockup's
// createIsland controller (tasks/dynamic-island-mockup.html ~L810-950:
// setTargets / measure / frame / kick). Drives the compact<->expanded morph by
// writing the SVG path + box geometry every rAF frame, INSIDE the fixed OS frame
// (D3: the window is never resized here - the shape and content morph, not the
// panel). Framework-agnostic: takes DOM elements + reuses T2's Spring /
// createSpringLoop / pickSpring VERBATIM (no new spring code, guards G2/G7).
//
// A6 rest guarantees on the LIVE loop: springs rest via their eps guard so the
// loop parks itself the frame everything settles (idle cost 0%); measure() is a
// one-shot content read (rAF-scheduled, NEVER wired into frame()) whose retarget
// goes through Spring.retarget()'s rounding guard so an unrounded measure can
// never perpetually re-animate; dispose() cancels the pending frame.

import {
  Spring,
  SPRING,
  pickSpring,
  createSpringLoop,
  type SpringLoop,
} from "./spring";
import { notchPath, notchPathMirrored, RADII } from "./notchPath";
import {
  DEFAULT_ISLAND_SETTINGS,
  type IslandSettings,
  type IslandMode,
} from "@/types/islandSettings";

export type IslandState = "compact" | "expanded";

/** Physical notch cutout geometry (BUG A), mirror of the Rust `NotchGeometryDto`. Logical points ==
 *  CSS px on macOS. `null` on non-notch / non-macOS displays (the frontend keeps the float layout). */
export interface NotchGeometry {
  readonly widthLogical: number;
  readonly heightLogical: number;
}

/** Minimum visible wing (px) on EACH side of the cutout, so the leading glyph and the trailing
 *  live-activity slot fit fully beside the physical notch instead of behind it (BUG A). Measured:
 *  the trailing live-activity (16px ring + 6px gap + ~28px percent ~= 50px) plus the ~6px shoulder
 *  inset needs ~56px; 60 gives a few px of slack (see island.css notch wing layout). */
export const MIN_WING = 60;

/** Extra height (px) below the cutout so the pill overhangs it slightly (boring.notch overhang). */
export const NOTCH_UNDERHANG = 4;

/** Effective compact pill width in notch mode: at least wide enough to seat a MIN_WING wing on each
 *  side of the cutout, never narrower than the user's setting. */
export function effectiveCompactWidth(userWidth: number, geo: NotchGeometry): number {
  return Math.max(userWidth, geo.widthLogical + 2 * MIN_WING);
}

/** Effective compact pill height in notch mode: at least the cutout height plus the underhang. */
export function effectiveCompactHeight(userHeight: number, geo: NotchGeometry): number {
  return Math.max(userHeight, geo.heightLogical + NOTCH_UNDERHANG);
}

/** Adopt the physical notch geometry into the compact geometry the morph controller targets. Only
 *  notch mode WITH a known geometry is adjusted; float mode and the no-geometry case (jsdom/tests,
 *  pre-event) return the settings unchanged, so every existing baseline is byte-identical (BUG A).
 *  Threaded through the SAME configure/applySettings path settings take - never a parallel one. */
export function effectiveIslandSettings(
  settings: IslandSettings,
  mode: IslandMode,
  geo: NotchGeometry | null
): IslandSettings {
  if (mode !== "notch" || !geo) return settings;
  return {
    ...settings,
    compactWidth: effectiveCompactWidth(settings.compactWidth, geo),
    height: effectiveCompactHeight(settings.height, geo),
  };
}

/** Surface inputs the appearance/position layer (T8) feeds the controller:
 *  `light` (resolved dark/light/auto), `mode` (float compact pills go light too),
 *  and `mirrored` (bottom-center flips the notch path vertically). */
export interface IslandSurface {
  readonly light: boolean;
  readonly mode: IslandMode;
  readonly mirrored: boolean;
}

declare global {
  interface Window {
    /** Settle flag the 06 visual harness waits on (true == springs at rest). */
    __islandSettled?: boolean;
    /** Monotonic morph-frame counter the idle-cost probe reads (frames == 0
     *  growth after settle proves the loop parked, R-PERF). */
    __islandFrames?: number;
  }
}

/** D4 envelope defaults (compactWidth 218, height 34; expandedWidth 380) and the
 *  D3 expanded-height cap (560). Expanded height itself is measured from content. */
export const MORPH = {
  compactW: 218,
  compactH: 34,
  expandedW: 380,
  /** Floor so the expanded shape never collapses before content is measured
   *  (jsdom reports offsetHeight 0; the real browser measures the true box). */
  expandedMinH: 72,
  /** D3 expanded-height ceiling - the panel never grows past this. */
  maxExpandedH: 560,
} as const;

/** The compact notch pill is PURE BLACK in every appearance (invariant d): it
 *  hugs the physical, opaque notch cutout. The expanded surface honors the
 *  shared `--s-card-bg` override, defaulting to the mockup's frosted charcoal. */
const COMPACT_FILL = "#000000";
// The expanded default fill honors the `--s-card-bg` per-notification override
// first; failing that it uses the frosted charcoal at the live surface-opacity
// (T7b). `--di-surface-opacity` is republished on the island root when the
// setting changes, so the surface restyles with ZERO spring work (the alpha is
// a paint-time CSS var, not a geometry target). Neither var set -> the mockup's
// rgba(13,13,15,0.94), so every existing baseline is pixel-identical.
const EXPANDED_FILL =
  "var(--s-card-bg, rgba(13,13,15, var(--di-surface-opacity, 0.94)))";

/** Light-appearance surfaces (D4), ported from the mockup's applyFill: the frosted
 *  light card (rgb 244,244,246 == #f4f4f6) and the light float compact pill
 *  (rgb 233,233,238 == #e9e9ee), both at the default 0.94 fill alpha. The notch
 *  compact pill NEVER uses these - it stays literal `#000000` (invariant d). */
// Light fills honor the live surface-opacity var (post-merge polish: T7b's
// opacity knob must restyle light surfaces too, matching the mockup applyFill).
const EXPANDED_LIGHT_FILL = "rgba(244,244,246, var(--di-surface-opacity, 0.94))";
const COMPACT_FLOAT_LIGHT_FILL = "rgba(233,233,238, var(--di-surface-opacity, 0.94))";

export interface MorphElements {
  readonly island: HTMLElement;
  readonly svg: SVGSVGElement;
  readonly path: SVGPathElement;
  /** In-flow content node - its offsetHeight drives the expanded shape height. */
  readonly content: HTMLElement;
}

export interface MorphController {
  /** Current logical state (which anatomy the caller should be rendering). */
  readonly state: IslandState;
  /** Adopt a settings envelope WITHOUT re-targeting (no motion, no kick). Called
   *  once at creation, BEFORE the first snap, so the arrival geometry already
   *  reflects the persisted settings (T7b creation-read path). */
  configure(settings: IslandSettings): void;
  /** Live restyle (T7b): adopt a new settings envelope and ANIMATE the current
   *  state's springs toward the new geometry (never snap - D3), unless `reduced`
   *  (then snap). Surface opacity + accent are republished as CSS vars. */
  applySettings(settings: IslandSettings, reduced: boolean): void;
  /** Arrive at a state INSTANTLY (springs snapped, no motion). The lifecycle
   *  entry uses this to "arrive expanded" before the animated auto-collapse. */
  snap(next: IslandState, reduced: boolean): void;
  /** Animate toward a state (retarget + kick). Reduced-motion swaps every spring
   *  to 1000/100 via pickSpring, collapsing the morph to ~1 frame. */
  animateTo(next: IslandState, reduced: boolean): void;
  /** One-shot content measure -> rounding-guarded sH retarget (expanded only).
   *  Safe to call from a ResizeObserver; the rounding guard stops feedback. */
  measure(): void;
  /** Update the appearance/position surface (T8): re-fills the shape (light card /
   *  light float pill vs the untouched dark path) and, when `mirrored` changes,
   *  repaints the current geometry with the flipped notch generator. Never morphs. */
  setSurface(surface: IslandSurface): void;
  /** Cancel the pending frame AND the pending one-shot measure (R-RAF-DISPOSE). */
  dispose(): void;
}

/**
 * Publish the settle flag the 06 visual harness mandates (invariant f) and a
 * frame counter the idle-cost probe reads. Guarded so a non-DOM host is a no-op.
 */
function publishSettled(settled: boolean): void {
  if (typeof window === "undefined") return;
  window.__islandSettled = settled;
}
function countFrame(): void {
  if (typeof window === "undefined") return;
  window.__islandFrames = (window.__islandFrames ?? 0) + 1;
}

/** Optional hooks the host wires into the controller. `onSettle` fires once each time the springs
 *  reach rest (and on every snap), so the host can report the settled shape bounds as the click-
 *  through hitbox (BUG B) - on settle, not per frame. */
export interface MorphOptions {
  readonly onSettle?: () => void;
}

export function createMorphController(
  els: MorphElements,
  opts: MorphOptions = {}
): MorphController {
  const { island, svg, path, content } = els;
  const { onSettle } = opts;
  // The live settings the geometry springs target. Seeded from the D4 defaults
  // (identical to the MORPH/RADII spring seeds below), then replaced by
  // configure()/applySettings() so a settings change re-targets without
  // recreating the controller. Expanded radii stay the fixed D3 19/24 while
  // corner-scaling is on; off, the pill keeps its compact radii in both states
  // (mockup `cornerScaling ? expTopR : topR`).
  let settings: IslandSettings = DEFAULT_ISLAND_SETTINGS;

  // Four geometry springs (W, H, top-radius, bottom-radius), all on the CONTAINER
  // config like the mockup's cc(). Initialized to compact; snap()/animateTo() set
  // real targets before the first paint.
  const sW = new Spring(MORPH.compactW, SPRING.CONTAINER);
  const sH = new Spring(MORPH.compactH, SPRING.CONTAINER);
  const sT = new Spring(RADII.compactTop, SPRING.CONTAINER);
  const sB = new Spring(RADII.compactBottom, SPRING.CONTAINER);
  const springs = [sW, sH, sT, sB];

  let state: IslandState = "compact";
  let pendingMeasure: number | null = null;
  // Whether the springs were at rest on the previous frame, so onSettle fires exactly once on the
  // non-resting -> resting edge (never every idle frame - the loop parks itself at rest anyway).
  let wasResting = true;

  // Appearance/position surface (T8), defaulting to the dark top notch so the very
  // first paint (before setSurface) matches the pre-T8 behavior exactly.
  let light = false;
  let surfaceMode: IslandMode = "notch";
  let mirrored = false;

  /** Write the live geometry to the DOM. Path `d` + `--di-wall` are the wall
   *  inset content padding derives from (R-WALL), republished every frame.
   *  `autoHeight` leaves the box height to the in-flow content (expanded AT
   *  REST) so the settled box matches the content's fractional height exactly -
   *  the T4a static layout - instead of an integer snap; the animating frames
   *  and the fixed compact pill use the explicit spring height. */
  function paint(
    W: number,
    H: number,
    t: number,
    b: number,
    autoHeight: boolean
  ): void {
    island.style.width = `${W}px`;
    island.style.height = autoHeight ? "" : `${H}px`;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", `${W}`);
    svg.setAttribute("height", `${H}`);
    // Bottom-center flips the notch vertically (concave shoulders on the bottom);
    // every other position/mode uses the top notch. The `--di-wall` inset is `t`
    // either way (the shoulders are inset by `t` horizontally in both).
    path.setAttribute("d", (mirrored ? notchPathMirrored : notchPath)({ W, H, t, b }));
    island.style.setProperty("--di-wall", `${t.toFixed(1)}px`);
  }

  /** Choose the shape fill for a state. The compact notch pill stays literal
   *  `#000000` in EVERY appearance (invariant d - do not touch that path); light
   *  restyles ONLY the expanded card and the float compact pill. */
  function applyFill(next: IslandState): void {
    const lightSurface = light && (next === "expanded" || surfaceMode === "float");
    let fill: string;
    if (lightSurface) {
      fill = next === "expanded" ? EXPANDED_LIGHT_FILL : COMPACT_FLOAT_LIGHT_FILL;
    } else {
      fill = next === "expanded" ? EXPANDED_FILL : COMPACT_FILL;
    }
    path.setAttribute("fill", fill);
  }

  const loop: SpringLoop = createSpringLoop((dt) => {
    countFrame();
    const W = sW.step(dt);
    const H = sH.step(dt);
    const t = sT.step(dt);
    const b = sB.step(dt);
    const resting =
      sW.resting && sH.resting && sT.resting && sB.resting;
    // Hand the height back to in-flow content only once expanded has settled.
    paint(W, H, t, b, resting && state === "expanded");
    publishSettled(resting);
    // Fire the settle hook once on the non-resting -> resting edge (BUG B hitbox report).
    if (resting && !wasResting) onSettle?.();
    wasResting = resting;
    return !resting; // false parks the loop (A6 eps-rest -> idle cost 0%)
  });

  /** Measured expanded height, floored and capped (D3). Read from in-flow
   *  content, which the caller has already committed to the DOM. */
  function measuredHeight(): number {
    const raw = Math.max(content.offsetHeight, MORPH.expandedMinH);
    return Math.min(raw, MORPH.maxExpandedH);
  }

  /** Retarget ALL four springs for a state. Callers run this from a layout
   *  effect (content already laid out), so the expanded height target is read
   *  synchronously here - no per-frame or deferred measure is needed for the
   *  morph itself; measure() only refines a LATER content-size change. */
  function setTargets(next: IslandState, reduced: boolean): void {
    const cfg = pickSpring(SPRING.CONTAINER, reduced);
    for (const s of springs) s.setConfig(cfg);
    if (next === "expanded") {
      sW.to(settings.expandedWidth);
      sH.to(measuredHeight());
      sT.to(settings.cornerScaling ? RADII.expandedTop : settings.topRadius);
      sB.to(settings.cornerScaling ? RADII.expandedBottom : settings.bottomRadius);
    } else {
      sW.to(settings.compactWidth);
      sH.to(settings.height);
      sT.to(settings.topRadius);
      sB.to(settings.bottomRadius);
    }
  }

  /** One-shot content re-measure (rAF-scheduled, NEVER inside frame()). Retargets
   *  the height spring through the rounding guard so an unrounded resize can never
   *  perpetually re-animate; only kicks the loop when the target actually moved,
   *  so a spurious ResizeObserver fire costs 0 frames (R-PERF). */
  function applyMeasure(): void {
    pendingMeasure = null;
    if (state !== "expanded") return;
    sH.retarget(measuredHeight());
    if (!sH.resting) {
      publishSettled(false);
      loop.kick();
    }
  }

  function measure(): void {
    if (pendingMeasure != null) return;
    pendingMeasure = requestAnimationFrame(applyMeasure);
  }

  /** Adopt a settings envelope: update the geometry targets' source-of-truth and
   *  republish the surface vars. Pure state update - callers decide whether to
   *  snap or animate afterward. */
  function configure(next: IslandSettings): void {
    settings = next;
    // Fill alpha + accent are paint-time CSS vars, not geometry - a change
    // restyles the surface with no spring work. Compact stays pure black
    // (invariant d): it reads neither var.
    island.style.setProperty("--di-surface-opacity", String(next.surfaceOpacity));
    island.style.setProperty("--di-accent", next.accent);
  }

  /** Arrive at a state instantly - springs snapped, no motion. */
  function snap(next: IslandState, reduced: boolean): void {
    state = next;
    applyFill(next);
    setTargets(next, reduced);
    for (const s of springs) s.set(s.target);
    paint(sW.x, sH.x, sT.x, sB.x, next === "expanded");
    publishSettled(true);
    wasResting = true;
    onSettle?.();
  }

  return {
    get state() {
      return state;
    },
    configure,
    applySettings(next, reduced) {
      configure(next);
      // Re-target the CURRENT state toward the new geometry. Reduced motion snaps
      // (D3 carve-out); otherwise the same spring path animateTo uses drives the
      // live morph to the new size/radii - the OS frame is never touched (D3).
      setTargets(state, reduced);
      if (reduced) {
        for (const s of springs) s.set(s.target);
        paint(sW.x, sH.x, sT.x, sB.x, state === "expanded");
        publishSettled(true);
        wasResting = true;
        onSettle?.();
        return;
      }
      publishSettled(false);
      wasResting = false;
      loop.kick();
    },
    snap,
    animateTo(next, reduced) {
      // Reduced motion collapses the morph to ~1 frame: pickSpring (inside
      // setTargets) swaps to the REDUCED config AND we snap to the target instead
      // of running the loop, so a prefers-reduced-motion user sees no animation
      // at all (invariant e) - the accessibility-correct outcome, not a slow
      // overdamped tail.
      if (reduced) {
        snap(next, reduced);
        return;
      }
      state = next;
      applyFill(next);
      setTargets(next, reduced);
      publishSettled(false);
      loop.kick();
    },
    measure,
    setSurface(surface) {
      light = surface.light;
      surfaceMode = surface.mode;
      const mirrorChanged = mirrored !== surface.mirrored;
      mirrored = surface.mirrored;
      applyFill(state);
      // A mirror flip changes the path generator, so repaint the current geometry
      // (no morph - D3). Fill-only changes need no repaint; applyFill did the work.
      if (mirrorChanged) {
        const resting = sW.resting && sH.resting && sT.resting && sB.resting;
        paint(sW.x, sH.x, sT.x, sB.x, resting && state === "expanded");
      }
    },
    dispose() {
      loop.dispose();
      if (pendingMeasure != null) {
        cancelAnimationFrame(pendingMeasure);
        pendingMeasure = null;
      }
    },
  };
}
