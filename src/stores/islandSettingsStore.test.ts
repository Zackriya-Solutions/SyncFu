import { describe, it, expect, beforeEach } from "vitest";
import { useIslandSettingsStore } from "./islandSettingsStore";
import {
  DEFAULT_ISLAND_SETTINGS,
  type IslandSettings,
} from "@/types/islandSettings";

describe("islandSettingsStore", () => {
  beforeEach(() => {
    useIslandSettingsStore.getState().reset();
  });

  it("starts at the mockup defaults", () => {
    expect(useIslandSettingsStore.getState().settings).toEqual(
      DEFAULT_ISLAND_SETTINGS
    );
  });

  it("replaces settings on setSettings (as the island:settings event would)", () => {
    const next: IslandSettings = {
      ...DEFAULT_ISLAND_SETTINGS,
      compactWidth: 300,
      accent: "#ff3b30",
      mode: "float",
      position: "bottom-center",
      appearance: "light",
      reducedMotion: true,
      hideFromScreenCapture: false,
    };

    useIslandSettingsStore.getState().setSettings(next);

    expect(useIslandSettingsStore.getState().settings).toEqual(next);
  });

  it("swaps in a new object reference (immutable update)", () => {
    const before = useIslandSettingsStore.getState().settings;
    useIslandSettingsStore
      .getState()
      .setSettings({ ...DEFAULT_ISLAND_SETTINGS, height: 50 });
    const after = useIslandSettingsStore.getState().settings;

    expect(after).not.toBe(before);
    expect(after.height).toBe(50);
  });

  it("reset restores the defaults", () => {
    useIslandSettingsStore
      .getState()
      .setSettings({ ...DEFAULT_ISLAND_SETTINGS, compactWidth: 500 });
    useIslandSettingsStore.getState().reset();

    expect(useIslandSettingsStore.getState().settings).toEqual(
      DEFAULT_ISLAND_SETTINGS
    );
  });
});
