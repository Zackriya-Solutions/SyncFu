import { describe, it, expect } from "vitest";
import {
  effectiveIslandSettings,
  shouldReveal,
  type NotchGeometry,
} from "./islandMorph";
import { DEFAULT_ISLAND_SETTINGS } from "@/types/islandSettings";

// T13 under-notch geometry: the collapsed pill renders as a SECOND NOTCH directly
// below the physical cutout, so its compact width equals the cutout width (reads as
// an extension of the notch) and its height is at least the cutout height. The G1
// hardware measurement is a 183 x 32 cutout.
const G1: NotchGeometry = { widthLogical: 183, heightLogical: 32 };

describe("effectiveIslandSettings (under-notch sizing)", () => {
  it("takes the cutout width and at least the cutout height in notch mode", () => {
    const eff = effectiveIslandSettings(DEFAULT_ISLAND_SETTINGS, "notch", G1);
    // Width is EXACTLY the cutout width so the pill reads as a second notch.
    expect(eff.compactWidth).toBe(183);
    // Height is max(userHeight, cutoutHeight); the 34 default already clears 32.
    expect(eff.height).toBe(Math.max(DEFAULT_ISLAND_SETTINGS.height, 32));
    // Everything else is untouched (expanded width, radii, accent, ...).
    expect(eff.expandedWidth).toBe(DEFAULT_ISLAND_SETTINGS.expandedWidth);
    expect(eff.topRadius).toBe(DEFAULT_ISLAND_SETTINGS.topRadius);
  });

  it("keeps a taller user height (max wins)", () => {
    const tall = { ...DEFAULT_ISLAND_SETTINGS, height: 48 };
    expect(effectiveIslandSettings(tall, "notch", G1).height).toBe(48);
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

describe("shouldReveal (hover-reveal decision)", () => {
  it("float / non-notch is ALWAYS visible (no reveal semantics)", () => {
    expect(shouldReveal(false, false, false)).toBe(true);
    expect(shouldReveal(false, true, false)).toBe(true);
  });

  it("under-notch collapsed pill is concealed until the notch is hovered", () => {
    expect(shouldReveal(true, false, false)).toBe(false); // collapsed, no hover -> hidden
    expect(shouldReveal(true, false, true)).toBe(true); // collapsed, hovered -> revealed
  });

  it("an EXPANDED island is always visible and never auto-conceals on cursor exit", () => {
    // Arrival announce / a decision / a manual expand: expanded ignores the hover
    // signal entirely, so a cursor leaving the notch never hides it.
    expect(shouldReveal(true, true, false)).toBe(true);
    expect(shouldReveal(true, true, true)).toBe(true);
  });
});
