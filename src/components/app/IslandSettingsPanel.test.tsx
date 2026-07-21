import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { IslandSettingsPanel } from "./IslandSettingsPanel";
import { useIslandSettingsStore } from "@/stores/islandSettingsStore";
import { invoke } from "@/__mocks__/tauri-api";
import { DEFAULT_ISLAND_SETTINGS } from "@/types/islandSettings";

// T7b settings panel. Proves the panel renders the 13 mockup controls, the
// percent<->alpha conversion, optimistic store writes paired with a
// set_island_settings persist, preset/reset application, the notch-mode position
// lock, and honest capture-status rendering (green ON only when guaranteed on).

describe("IslandSettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(null);
    useIslandSettingsStore.getState().reset();
  });

  it("renders the 13 mockup controls across the six groups", () => {
    render(<IslandSettingsPanel />);
    for (const id of [
      "compactWidth",
      "expandedWidth",
      "height",
      "surfaceOpacity",
      "topRadius",
      "bottomRadius",
      "cornerScaling",
      "accent",
      "reducedMotion",
      "hideFromScreenCapture",
    ]) {
      expect(screen.getByTestId(`island-set-${id}`)).toBeInTheDocument();
    }
    // Appearance, mode, and position are segmented (rendered as their options).
    expect(screen.getByTestId("island-set-appearance-dark")).toBeInTheDocument();
    expect(screen.getByTestId("island-set-mode-notch")).toBeInTheDocument();
    expect(screen.getByTestId("island-set-position-bottom-center")).toBeInTheDocument();
  });

  it("shows the fill alpha as a percent (0.94 store -> 94%) and stores back as an alpha", () => {
    render(<IslandSettingsPanel />);
    expect(screen.getByTestId("island-val-surfaceOpacity")).toHaveTextContent("94%");

    const slider = screen.getByTestId("island-set-surfaceOpacity");
    fireEvent.change(slider, { target: { value: "50" } });

    // Store keeps the 0..=1 alpha (percent domain is UI-only).
    expect(useIslandSettingsStore.getState().settings.surfaceOpacity).toBe(0.5);
    // Optimistic write is persisted with the alpha, not the percent.
    expect(invoke).toHaveBeenCalledWith("set_island_settings", {
      settings: expect.objectContaining({ surfaceOpacity: 0.5 }),
    });
  });

  it("writes optimistically to the store BEFORE the persist resolves", () => {
    // A never-resolving invoke proves the store update does not await the backend.
    vi.mocked(invoke).mockReturnValue(new Promise(() => {}));
    render(<IslandSettingsPanel />);

    fireEvent.change(screen.getByTestId("island-set-compactWidth"), {
      target: { value: "400" },
    });

    expect(useIslandSettingsStore.getState().settings.compactWidth).toBe(400);
  });

  it("applies the Slim bar preset (merged over current settings) and persists it", () => {
    render(<IslandSettingsPanel />);
    fireEvent.click(screen.getByTestId("island-preset-slim"));

    const s = useIslandSettingsStore.getState().settings;
    expect(s.compactWidth).toBe(172);
    expect(s.surfaceOpacity).toBe(0.9);
    expect(s.cornerScaling).toBe(false);
    expect(s.accent).toBe("#2ed573");
    // Fields the preset does not name are preserved (mockup Object.assign).
    expect(s.position).toBe(DEFAULT_ISLAND_SETTINGS.position);
    expect(invoke).toHaveBeenCalledWith("set_island_settings", {
      settings: expect.objectContaining({ compactWidth: 172, cornerScaling: false }),
    });
  });

  it("resets every field back to the defaults", () => {
    useIslandSettingsStore.getState().setSettings({
      ...DEFAULT_ISLAND_SETTINGS,
      compactWidth: 555,
      accent: "#ff3b30",
    });
    render(<IslandSettingsPanel />);

    fireEvent.click(screen.getByTestId("island-reset"));

    expect(useIslandSettingsStore.getState().settings).toEqual(DEFAULT_ISLAND_SETTINGS);
  });

  it("disables the position control in notch mode and enables it when floating", () => {
    render(<IslandSettingsPanel />);
    // Default is notch: every position button is disabled (incl bottom-center).
    for (const pos of ["left", "center", "right", "bottom-center"]) {
      expect(screen.getByTestId(`island-set-position-${pos}`)).toBeDisabled();
    }

    fireEvent.click(screen.getByTestId("island-set-mode-float"));

    for (const pos of ["left", "center", "right", "bottom-center"]) {
      expect(screen.getByTestId(`island-set-position-${pos}`)).not.toBeDisabled();
    }
  });

  it("renders capture status honestly: green ON only when the OS guarantees it", () => {
    useIslandSettingsStore.getState().setCaptureStatus({
      status: "on",
      reason: "Hidden from screen capture on this macOS version.",
      enabled: true,
    });
    const { rerender } = render(<IslandSettingsPanel />);
    const on = screen.getByTestId("island-capture-status");
    expect(on).toHaveAttribute("data-status", "on");
    expect(on.className).toContain("on");
    expect(on).toHaveTextContent("Hidden from screen sharing");

    // best-effort must NEVER read as a guaranteed hide (invariant b).
    act(() => {
      useIslandSettingsStore.getState().setCaptureStatus({
        status: "best-effort",
        reason: "Best effort only: macOS 15 and later can still capture this window.",
        enabled: true,
      });
    });
    rerender(<IslandSettingsPanel />);
    const be = screen.getByTestId("island-capture-status");
    expect(be).toHaveAttribute("data-status", "best-effort");
    expect(be.className).not.toContain("on");
    expect(be).toHaveTextContent("Best effort on this OS");
    expect(be).toHaveTextContent(/macOS 15/);
  });

  it("reads persisted settings + capture status from the backend on mount", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_island_settings") {
        return Promise.resolve({ ...DEFAULT_ISLAND_SETTINGS, compactWidth: 480 });
      }
      if (cmd === "get_island_capture_status") {
        return Promise.resolve({
          status: "unsupported",
          reason: "Not supported on Linux.",
          enabled: true,
        });
      }
      return Promise.resolve(null);
    });

    render(<IslandSettingsPanel />);

    await waitFor(() => {
      expect(useIslandSettingsStore.getState().settings.compactWidth).toBe(480);
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("island-capture-status")
      ).toHaveAttribute("data-status", "unsupported");
    });
  });
});
