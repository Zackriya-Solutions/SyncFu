import { describe, it, expect, vi, afterEach } from "vitest";
import {
  Spring,
  SPRING,
  SPRING_EPS,
  pickSpring,
  createSpringLoop,
} from "./spring";

/** Step a spring at 60fps until it rests; return the frame count (capped). */
function framesToRest(s: Spring, cap = 2000): number {
  for (let i = 1; i <= cap; i++) {
    s.step(1 / 60);
    if (s.resting) return i;
  }
  return cap;
}

describe("Spring integrator", () => {
  it("settles at the target and snaps exactly (x=target, v=0)", () => {
    const s = new Spring(0, SPRING.CONTAINER);
    s.to(100);
    const frames = framesToRest(s);
    expect(frames).toBeLessThan(2000);
    expect(s.x).toBe(100); // eps guard snaps exactly, no residual drift
    expect(s.v).toBe(0);
  });

  it("reduced-motion (1000/100) is overdamped (no overshoot); container overshoots", () => {
    const peak = (s: Spring): number => {
      let max = -Infinity;
      for (let i = 0; i < 600; i++) {
        s.step(1 / 60);
        if (s.x > max) max = s.x;
        if (s.resting) break;
      }
      return max;
    };
    // Reduced motion must not bounce past the target; the container spring does.
    expect(peak(new Spring(0, SPRING.REDUCED).to(300))).toBeLessThanOrEqual(300 + SPRING_EPS);
    expect(peak(new Spring(0, SPRING.CONTAINER).to(300))).toBeGreaterThan(300);
  });

  it("rests via the eps guard (A6): within eps of target with tiny velocity", () => {
    const s = new Spring(100, SPRING.CONTAINER);
    s.to(100);
    s.x = 100 - SPRING_EPS / 2;
    s.v = SPRING_EPS / 2;
    expect(s.resting).toBe(true);
    expect(s.step(1 / 60)).toBe(100); // snaps
    expect(s.v).toBe(0);
  });

  it("retarget() ignores changes that round to the current target (R-PERF guard)", () => {
    const s = new Spring(0, SPRING.CONTAINER);
    s.to(100);
    s.retarget(100.4); // rounds to 100 -> ignored
    expect(s.target).toBe(100);
    s.retarget(100.6); // rounds to 101 -> applied
    expect(s.target).toBe(100.6);
  });

  it("to() stays exact so sub-pixel pop/radius targets are honored", () => {
    const s = new Spring(1, SPRING.POP);
    s.to(1.04); // retarget() would have dropped this (rounds to 1)
    expect(s.target).toBe(1.04);
  });
});

describe("pickSpring / reduced swap", () => {
  it("swaps to REDUCED when reduced is true", () => {
    expect(pickSpring(SPRING.CONTAINER, true)).toBe(SPRING.REDUCED);
    expect(pickSpring(SPRING.CONTAINER, false)).toBe(SPRING.CONTAINER);
  });
});

describe("createSpringLoop (A6 dispose + rest parking)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("dispose() cancels the pending rAF", () => {
    let nextId = 1;
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", () => nextId++); // never invokes cb
    vi.stubGlobal("cancelAnimationFrame", cancel);

    const loop = createSpringLoop(() => true); // always "still animating"
    loop.kick();
    expect(loop.running).toBe(true);
    loop.dispose();
    expect(cancel).toHaveBeenCalledWith(1);
    expect(loop.running).toBe(false);
  });

  it("parks itself the frame onFrame reports rest", () => {
    let cb: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
      cb = fn;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const onFrame = vi.fn(() => false); // rests immediately
    const loop = createSpringLoop(onFrame);
    loop.kick();
    expect(loop.running).toBe(true);
    cb!(16); // pump one frame
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(loop.running).toBe(false);
  });
});
