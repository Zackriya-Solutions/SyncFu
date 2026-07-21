import { describe, it, expect, beforeEach } from "vitest";
import { useIslandSettingsStore } from "./islandSettingsStore";
import {
  DEFAULT_ISLAND_SETTINGS,
  type IslandCaptureStatus,
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

  it("capture status starts null (never inferred client-side, G2)", () => {
    expect(useIslandSettingsStore.getState().captureStatus).toBeNull();
  });

  it("mirrors the OS-derived capture status from get_island_capture_status", () => {
    const status: IslandCaptureStatus = {
      status: "best-effort",
      reason: "Best effort only: macOS 15 and later can still capture this window.",
      enabled: true,
    };

    useIslandSettingsStore.getState().setCaptureStatus(status);

    expect(useIslandSettingsStore.getState().captureStatus).toEqual(status);
  });

  it("reset clears the capture status back to null", () => {
    useIslandSettingsStore.getState().setCaptureStatus({
      status: "on",
      reason: "Hidden from screen capture on this macOS version.",
      enabled: true,
    });
    useIslandSettingsStore.getState().reset();

    expect(useIslandSettingsStore.getState().captureStatus).toBeNull();
  });
});
