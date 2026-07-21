// Dynamic Island motion primitives - ported from the approved mockup
// (Spring class ~L781, SPRING configs ~L800, hover ~L108/114). Hand-rolled
// rAF damped spring, no motion library (guard G2); spring, not linear tween
// (guard G7). ZERO Tauri / React deps.

export interface SpringConfig {
  readonly stiffness: number;
  readonly damping: number;
}

/** Named spring configs (D3). Reduced-motion swaps every spring to 1000/100. */
export const SPRING = {
  CONTAINER: { stiffness: 220, damping: 25 },
  CONTENT: { stiffness: 400, damping: 30 },
  POP: { stiffness: 260, damping: 18 },
  REDUCED: { stiffness: 1000, damping: 100 },
} as const satisfies Record<string, SpringConfig>;

/**
 * Resolve a config under reduced-motion (near-instant 1000/100 swap). The caller
 * owns the reduced flag (app setting OR OS prefers-reduced-motion); this module
 * stays free of window/matchMedia so it remains a pure motion primitive.
 */
export function pickSpring(config: SpringConfig, reduced: boolean): SpringConfig {
  return reduced ? SPRING.REDUCED : config;
}

/** Resting epsilon (A6 binding): the loop rests via this guard, not by luck. */
export const SPRING_EPS = 0.02;

/**
 * rAF-driven damped-spring integrator (semi-implicit Euler, fixed 240Hz
 * substeps). Stateful, so a class: x/target/v carry across frames. Pure math -
 * the caller owns the rAF loop and DOM writes.
 */
export class Spring {
  x: number;
  target: number;
  v = 0;
  private k: number;
  private c: number;
  private readonly m = 1;
  readonly eps = SPRING_EPS;

  constructor(value: number, cfg: SpringConfig) {
    this.x = value;
    this.target = value;
    this.k = cfg.stiffness;
    this.c = cfg.damping;
  }

  setConfig(cfg: SpringConfig): this {
    this.k = cfg.stiffness;
    this.c = cfg.damping;
    return this;
  }

  /** Retarget (exact). Use for radii/width/pop; sub-pixel targets are intended. */
  to(target: number): this {
    this.target = target;
    return this;
  }

  /**
   * Retarget from a MEASURED dimension (R-PERF rounding guard, A6). Ignores
   * retargets that round to the current target so an unrounded resize/measure
   * feedback path can never perpetually re-animate. `to()` stays exact.
   */
  retarget(value: number): this {
    if (Math.round(value) === Math.round(this.target)) return this;
    this.target = value;
    return this;
  }

  /** Snap to a value (no motion). */
  set(v: number): this {
    this.x = v;
    this.target = v;
    this.v = 0;
    return this;
  }

  get resting(): boolean {
    return Math.abs(this.x - this.target) < this.eps && Math.abs(this.v) < this.eps;
  }

  step(dt: number): number {
    if (this.resting) {
      this.x = this.target;
      this.v = 0;
      return this.x;
    }
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = (-this.k * (this.x - this.target) - this.c * this.v) / this.m;
      this.v += a * h;
      this.x += this.v * h;
    }
    if (this.resting) {
      this.x = this.target;
      this.v = 0;
    }
    return this.x;
  }
}

export interface SpringLoop {
  /** Start the rAF loop if idle. */
  kick(): void;
  /** Cancel any pending rAF (A6: dispose cancels the frame; call on unmount). */
  dispose(): void;
  readonly running: boolean;
}

/**
 * Generic rAF driver. `onFrame(dt)` steps the springs and applies them; it
 * returns whether animation should continue (i.e. any spring is still moving).
 * The loop parks itself the frame everything rests (A6 eps-guarded rest) and
 * `dispose()` cancels a pending frame. `onFrame` must NOT trigger a DOM measure
 * (A6: measure() is one-shot, never wired into the per-frame loop).
 */
export function createSpringLoop(onFrame: (dt: number) => boolean): SpringLoop {
  let raf: number | null = null;
  let last = 0;
  const tick = (ts: number): void => {
    const dt = last ? Math.min((ts - last) / 1000, 0.05) : 1 / 60;
    last = ts;
    if (onFrame(dt)) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = null;
      last = 0;
    }
  };
  return {
    kick(): void {
      if (raf == null) {
        last = 0;
        raf = requestAnimationFrame(tick);
      }
    },
    dispose(): void {
      if (raf != null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      last = 0;
    },
    get running(): boolean {
      return raf != null;
    },
  };
}

// --- Hover (FR-6) ------------------------------------------------------------
// The island lifts on hover: scale 1.028, top-anchored, 150ms transition after
// a 150ms open delay (mockup .di-island ~L108/114). Closes the FR-6 gap.
export const HOVER = {
  scale: 1.028,
  origin: "top center",
  durationMs: 150,
  delayMs: 150,
  easing: "cubic-bezier(0.22,1,0.36,1)",
} as const;

/** Hover scale factor: 1.028 when hovered, 1 at rest. Top-anchored (see HOVER). */
export function hoverScale(hovered: boolean): number {
  return hovered ? HOVER.scale : 1;
}
