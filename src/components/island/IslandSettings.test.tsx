import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { Island } from "./Island";
import { useIslandSettingsStore } from "@/stores/islandSettingsStore";
import { DEFAULT_ISLAND_SETTINGS } from "@/types/islandSettings";
import type { NotificationPayload } from "@/types/notification";

// T7b live restyle: a settings change re-targets the island's geometry springs
// WITHOUT restart/resend and WITHOUT snapping (D3 - it animates to the new
// geometry). These tests drive the store the island subscribes to and assert the
// imperatively-written box geometry follows.

function makeNotification(): NotificationPayload {
  return {
    id: "isl-1",
    sender: "claude-code",
    title: "Approval needed",
    body: "Run migration 0042 before deploy?",
    priority: "normal",
    presentation: "island",
    timeout: "default",
    actions: [],
    createdAt: new Date().toISOString(),
  };
}

/** Deterministic rAF: callbacks queue and only run when we flush a frame. */
function installFakeRaf() {
  let id = 0;
  let now = 0;
  const queued = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const i = ++id;
    queued.set(i, cb);
    return i;
  });
  vi.stubGlobal("cancelAnimationFrame", (i: number) => {
    queued.delete(i);
  });
  return {
    flush(frames = 1) {
      for (let f = 0; f < frames; f++) {
        const entries = [...queued.entries()];
        queued.clear();
        now += 16;
        for (const [, cb] of entries) cb(now);
      }
    },
    drain(max = 400) {
      let guard = 0;
      while (queued.size > 0 && guard++ < max) this.flush(1);
    },
    get pending() {
      return queued.size;
    },
  };
}

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  }));
}

beforeEach(() => {
  useIslandSettingsStore.getState().reset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Island - live settings re-target (T7b)", () => {
  it("adopts the persisted settings at creation (creation-read path)", () => {
    stubReducedMotion(false);
    installFakeRaf();
    // Seed the store BEFORE the island mounts: a wider compact pill.
    useIslandSettingsStore.getState().setSettings({
      ...DEFAULT_ISLAND_SETTINGS,
      compactWidth: 300,
    });

    const { container } = render(
      <Island notification={makeNotification()} state="compact" />
    );
    const island = container.querySelector(".di-island") as HTMLElement;
    // The initial snap used the seeded envelope, not the 218 default.
    expect(island.style.width).toBe("300px");
  });

  it("ANIMATES (never snaps) to the new expanded width when settings change", () => {
    stubReducedMotion(false); // full motion -> spring, not snap
    const raf = installFakeRaf();

    const { container } = render(
      <Island notification={makeNotification()} state="expanded" />
    );
    const island = container.querySelector(".di-island") as HTMLElement;
    expect(island.style.width).toBe("380px"); // default expanded width

    // Change the expanded width live; the spring must move gradually toward it.
    act(() => {
      useIslandSettingsStore.getState().setSettings({
        ...DEFAULT_ISLAND_SETTINGS,
        expandedWidth: 520,
      });
    });
    // One frame in: partway there, proving it animates rather than snapping.
    raf.flush(1);
    const mid = parseFloat(island.style.width);
    expect(mid).toBeGreaterThan(380);
    expect(mid).toBeLessThan(520);

    // Settle: the loop parks exactly on the new target.
    raf.drain();
    expect(island.style.width).toBe("520px");
  });

  it("snaps instantly under reduced motion (D3 carve-out)", () => {
    stubReducedMotion(true);
    const raf = installFakeRaf();

    const { container } = render(
      <Island notification={makeNotification()} state="expanded" />
    );
    const island = container.querySelector(".di-island") as HTMLElement;

    act(() => {
      useIslandSettingsStore.getState().setSettings({
        ...DEFAULT_ISLAND_SETTINGS,
        expandedWidth: 520,
      });
    });
    // No frames scheduled: the new geometry is in place immediately.
    expect(raf.pending).toBe(0);
    expect(island.style.width).toBe("520px");
  });

  it("republishes the surface-opacity and accent CSS vars on change", () => {
    stubReducedMotion(true);
    installFakeRaf();

    const { container } = render(
      <Island notification={makeNotification()} state="expanded" />
    );
    const island = container.querySelector(".di-island") as HTMLElement;

    act(() => {
      useIslandSettingsStore.getState().setSettings({
        ...DEFAULT_ISLAND_SETTINGS,
        surfaceOpacity: 0.5,
        accent: "#ff3b30",
      });
    });
    expect(island.style.getPropertyValue("--di-surface-opacity")).toBe("0.5");
    expect(island.style.getPropertyValue("--di-accent")).toBe("#ff3b30");
  });
});
