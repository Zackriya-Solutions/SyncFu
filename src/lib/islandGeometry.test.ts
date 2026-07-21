import { describe, it, expect } from "vitest";
import {
  MIN_WING,
  NOTCH_UNDERHANG,
  effectiveCompactWidth,
  effectiveCompactHeight,
  effectiveIslandSettings,
  type NotchGeometry,
} from "./islandMorph";
import { DEFAULT_ISLAND_SETTINGS } from "@/types/islandSettings";

// BUG A geometry math: the compact pill must widen to seat a visible wing on each
// side of the physical cutout so its content never renders behind the notch. The
// G1 hardware measurement is a 183 x 32 cutout.
const G1: NotchGeometry = { widthLogical: 183, heightLogical: 32 };

describe("effective compact geometry (notch wings)", () => {
  it("width seats a MIN_WING wing on each side of the cutout (G1 183pt)", () => {
    // 183 + 2*60 = 303, well past the 218 default, so wings actually exist.
    expect(effectiveCompactWidth(218, G1)).toBe(183 + 2 * MIN_WING);
    expect(effectiveCompactWidth(218, G1)).toBeGreaterThan(218);
  });

  it("never shrinks below the user's own compact width", () => {
    // A user who set an extra-wide pill keeps it (the max wins).
    expect(effectiveCompactWidth(400, G1)).toBe(400);
  });

  it("height overhangs the cutout by NOTCH_UNDERHANG", () => {
    // 32 + 4 = 36 > the 34 default, so the pill hangs slightly below the cutout.
    expect(effectiveCompactHeight(34, G1)).toBe(32 + NOTCH_UNDERHANG);
    expect(effectiveCompactHeight(34, G1)).toBeGreaterThan(32);
  });

  it("keeps a taller user height", () => {
    expect(effectiveCompactHeight(50, G1)).toBe(50);
  });
});

describe("effectiveIslandSettings", () => {
  it("adjusts compact width/height in notch mode WITH geometry", () => {
    const eff = effectiveIslandSettings(DEFAULT_ISLAND_SETTINGS, "notch", G1);
    expect(eff.compactWidth).toBe(183 + 2 * MIN_WING);
    expect(eff.height).toBe(32 + NOTCH_UNDERHANG);
    // Everything else is untouched (expanded width, radii, accent, ...).
    expect(eff.expandedWidth).toBe(DEFAULT_ISLAND_SETTINGS.expandedWidth);
    expect(eff.topRadius).toBe(DEFAULT_ISLAND_SETTINGS.topRadius);
  });

  it("is a byte-identical passthrough in float mode (geometry ignored)", () => {
    expect(effectiveIslandSettings(DEFAULT_ISLAND_SETTINGS, "float", G1)).toBe(
      DEFAULT_ISLAND_SETTINGS
    );
  });

  it("is a byte-identical passthrough with no geometry (jsdom / pre-event)", () => {
    // The critical invariant: getNotchGeometry === null keeps every existing
    // baseline exactly as-is.
    expect(effectiveIslandSettings(DEFAULT_ISLAND_SETTINGS, "notch", null)).toBe(
      DEFAULT_ISLAND_SETTINGS
    );
  });
});
