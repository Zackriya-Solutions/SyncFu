import { describe, it, expect } from "vitest";
import { resolveTimeout, TIMEOUTS } from "./timeout";

// Shared timeout resolution (card + island parity). The load-bearing invariant is
// that an EXPLICIT null (critical = never) survives, so critical never
// auto-dismisses in either presentation.
describe("resolveTimeout", () => {
  it("maps priority defaults to the documented table (6s/8s/12s)", () => {
    expect(resolveTimeout("default", "low")).toBe(6000);
    expect(resolveTimeout("default", "normal")).toBe(8000);
    expect(resolveTimeout("default", "high")).toBe(12000);
  });

  it("returns null for critical (never auto-dismisses) - the ?? bug fix", () => {
    expect(TIMEOUTS.critical).toBeNull();
    expect(resolveTimeout("default", "critical")).toBeNull();
  });

  it("honors an explicit 'never'", () => {
    expect(resolveTimeout("never", "normal")).toBeNull();
    expect(resolveTimeout({ never: true }, "high")).toBeNull();
  });

  it("honors an explicit seconds override (converted to ms)", () => {
    expect(resolveTimeout({ seconds: 15 }, "normal")).toBe(15000);
  });

  it("falls back to 8s for an unknown priority", () => {
    expect(resolveTimeout("default", "bogus")).toBe(8000);
  });
});
