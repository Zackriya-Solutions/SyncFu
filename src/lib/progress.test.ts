import { describe, it, expect } from "vitest";
import { clampProgress, progressPercent, ringDash } from "./progress";

describe("clampProgress", () => {
  it("clamps into [0, 1]", () => {
    expect(clampProgress(-0.5)).toBe(0);
    expect(clampProgress(0)).toBe(0);
    expect(clampProgress(0.42)).toBe(0.42);
    expect(clampProgress(1)).toBe(1);
    expect(clampProgress(1.7)).toBe(1);
  });

  it("degrades NaN to 0 (never renders junk geometry)", () => {
    expect(clampProgress(Number.NaN)).toBe(0);
  });
});

describe("progressPercent", () => {
  it("rounds a clamped value to an integer percent", () => {
    expect(progressPercent(0)).toBe(0);
    expect(progressPercent(0.5)).toBe(50);
    expect(progressPercent(0.666)).toBe(67);
    expect(progressPercent(2)).toBe(100);
  });
});

describe("ringDash", () => {
  it("dashArray is the circle circumference", () => {
    const r = 10;
    const { dashArray } = ringDash(0.5, r);
    expect(dashArray).toBeCloseTo(2 * Math.PI * r, 6);
  });

  it("offset is full circumference at 0 and 0 at 1 (invariant: fill arc)", () => {
    const r = 10;
    const c = 2 * Math.PI * r;
    expect(ringDash(0, r).dashOffset).toBeCloseTo(c, 6);
    expect(ringDash(1, r).dashOffset).toBeCloseTo(0, 6);
    // Half full -> half the circumference remains hidden.
    expect(ringDash(0.5, r).dashOffset).toBeCloseTo(c / 2, 6);
  });

  it("clamps an out-of-range value before computing the offset", () => {
    const r = 10;
    expect(ringDash(5, r).dashOffset).toBeCloseTo(0, 6);
    expect(ringDash(-1, r).dashOffset).toBeCloseTo(2 * Math.PI * r, 6);
  });
});
