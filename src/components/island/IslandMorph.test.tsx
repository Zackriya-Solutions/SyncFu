import { createRef } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { Island, type IslandHandle } from "./Island";
import type { NotificationPayload } from "@/types/notification";

// T4b morph-engine behavior. The static anatomy + styleVars wiring live in
// Island.test.tsx; this file exercises the spring-driven morph, the A6 rest /
// dispose guarantees on the LIVE loop, reduced motion, and the T5 trigger
// surface. Geometry writes are imperative (path.setAttribute), so a controllable
// rAF scheduler lets us step frames deterministically and spy on the DOM writes.

function makeNotification(
  overrides: Partial<NotificationPayload> = {}
): NotificationPayload {
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
    ...overrides,
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
    /** Run one frame: drain the queue (a running frame re-queues the next). */
    flush(frames = 1) {
      for (let f = 0; f < frames; f++) {
        const entries = [...queued.entries()];
        queued.clear();
        now += 16;
        for (const [, cb] of entries) cb(now);
      }
    },
    get pending() {
      return queued.size;
    },
  };
}

/** Force prefers-reduced-motion to a fixed value (jsdom has no matchMedia). */
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

afterEach(() => {
  // Unmount (which disposes the loop via cancelAnimationFrame) BEFORE restoring
  // globals, so teardown never hits an unstubbed cancelAnimationFrame.
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Island morph - lifecycle + trigger surface (invariant c)", () => {
  it("arrives expanded then auto-collapses to the compact pill (OQ-2)", () => {
    stubReducedMotion(false);
    vi.stubGlobal("requestAnimationFrame", () => 1); // loop is inert here
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.useFakeTimers();

    render(<Island notification={makeNotification()} />);
    // Arrives EXPANDED.
    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();
    expect(screen.getByTestId("island")).toHaveAttribute("data-state", "expanded");

    // Holds, then auto-collapses to the compact pill.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId("island-compact")).toBeInTheDocument();
    expect(screen.getByTestId("island")).toHaveAttribute("data-state", "compact");
  });

  it("exposes an expand/collapse trigger surface for T5", () => {
    stubReducedMotion(false);
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const ref = createRef<IslandHandle>();

    render(<Island ref={ref} notification={makeNotification()} />);
    expect(ref.current?.state).toBe("expanded");

    act(() => ref.current!.collapse());
    expect(ref.current?.state).toBe("compact");
    expect(screen.getByTestId("island-compact")).toBeInTheDocument();
    expect(screen.queryByTestId("island-expanded")).not.toBeInTheDocument();

    act(() => ref.current!.expand());
    expect(ref.current?.state).toBe("expanded");
    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();
  });
});

describe("Island morph - A6 rest / dispose guarantees on the live loop", () => {
  it("dispose() during a non-resting spring cancels the pending frame and stops path writes", () => {
    stubReducedMotion(false); // full motion -> springs stay non-resting for many frames
    const raf = installFakeRaf();
    const ref = createRef<IslandHandle>();

    const { container, unmount } = render(
      <Island ref={ref} notification={makeNotification()} />
    );
    const path = container.querySelector(".di-shape path") as SVGPathElement;
    const setAttr = vi.spyOn(path, "setAttribute");
    const dWrites = () => setAttr.mock.calls.filter((c) => c[0] === "d").length;

    // Kick a morph, then run ONE frame: the path `d` is rewritten and the loop
    // (still animating) re-queues the next frame.
    act(() => ref.current!.collapse());
    raf.flush(1);
    const writesWhileAnimating = dWrites();
    expect(writesWhileAnimating).toBeGreaterThanOrEqual(1);
    expect(raf.pending).toBe(1); // a next frame is queued (spring not at rest)

    // Unmount mid-morph -> dispose() cancels the queued frame.
    act(() => unmount());
    expect(raf.pending).toBe(0);

    // No further path writes can fire: the frame was cancelled, not merely idle.
    raf.flush(3);
    expect(dWrites()).toBe(writesWhileAnimating);
  });

  it("beforeunload (window-close) disposes the pending frame", () => {
    stubReducedMotion(false);
    const raf = installFakeRaf();
    const ref = createRef<IslandHandle>();

    render(<Island ref={ref} notification={makeNotification()} />);
    act(() => ref.current!.collapse());
    raf.flush(1);
    expect(raf.pending).toBe(1);

    act(() => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    expect(raf.pending).toBe(0);
  });

  it("parks the loop at rest: no frames scheduled once settled (idle cost 0%)", () => {
    stubReducedMotion(false); // full motion -> the loop runs, then must park
    const raf = installFakeRaf();
    const ref = createRef<IslandHandle>();

    render(<Island ref={ref} notification={makeNotification()} />);
    act(() => ref.current!.collapse());
    // Drain frames until the loop parks itself (a settled loop queues nothing).
    let guard = 0;
    while (raf.pending > 0 && guard++ < 300) raf.flush(1);
    expect(window.__islandSettled).toBe(true);
    expect(raf.pending).toBe(0);

    const framesAtRest = window.__islandFrames ?? 0;
    raf.flush(5); // nothing queued -> no callbacks run
    expect(window.__islandFrames ?? 0).toBe(framesAtRest);
  });
});

describe("Island morph - reduced motion (invariant e)", () => {
  it("collapses instantly with no scheduled frames and snaps geometry to the compact target", () => {
    stubReducedMotion(true);
    const raf = installFakeRaf();
    const ref = createRef<IslandHandle>();

    const { container } = render(
      <Island ref={ref} notification={makeNotification()} />
    );
    const island = container.querySelector(".di-island") as HTMLElement;

    act(() => ref.current!.collapse());
    // No animation frames are scheduled at all - the morph is snapped in place.
    expect(raf.pending).toBe(0);
    expect(window.__islandSettled).toBe(true);
    // Snapped exactly to the compact geometry (218 = D4 compact width default).
    expect(island.style.width).toBe("218px");
    expect(island.style.getPropertyValue("--di-wall")).toBe("6.0px");
  });
});
