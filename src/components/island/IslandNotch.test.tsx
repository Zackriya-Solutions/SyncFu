import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Island } from "./Island";
import type { NotchGeometry } from "@/lib/islandMorph";
import type { NotificationPayload } from "@/types/notification";

// T13/T14 cover-the-notch layout (jsdom; option A). With a real cutout geometry in
// notch mode the island COVERS the cutout: the compact pill takes the cutout WIDTH
// and is grown by the cutout HEIGHT (the notch cap) so its top band sits over the
// notch, with the cutout height published as `--di-notch-h` on the `.di-reveal`
// wrapper (it feeds the content's below-cutout top padding). The compact content lays
// out NORMALLY - the sender label is back (no wing layout). While collapsed and NOT
// hovered the pill is concealed and a minimal AMBIENT WINGS indicator shows in its
// place (T14). Reveal follows `notchHover` even for controlled fixtures, so tests
// pick the ambient vs revealed state explicitly. Without geometry (the default
// jsdom path) nothing changes.
const G1: NotchGeometry = { widthLogical: 183, heightLogical: 32 };

function makeNotification(
  overrides: Partial<NotificationPayload> = {}
): NotificationPayload {
  return {
    id: "isl-1",
    sender: "claude-code",
    title: "Approval needed",
    body: "Run migration 0042?",
    priority: "normal",
    presentation: "island",
    timeout: "default",
    actions: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Island under-notch layout (T13/T14)", () => {
  it("keeps the sender label and marks the revealed reveal wrapper when hovered", () => {
    render(
      <Island
        notification={makeNotification()}
        state="compact"
        mode="notch"
        notchGeometry={G1}
        notchHover
      />
    );
    // Normal compact layout: glyph + sender label all present (no wing omission).
    expect(screen.getByTestId("island-compact-glyph")).toBeInTheDocument();
    expect(screen.getByText("claude-code")).toBeInTheDocument();

    // The reveal wrapper carries the under-notch offset var + notch marker.
    const wrapper = screen.getByTestId("island-reveal");
    expect(wrapper).toHaveAttribute("data-notch", "true");
    expect(wrapper.style.getPropertyValue("--di-notch-h")).toBe("32px");
    // Hovered -> the pill is revealed.
    expect(wrapper).toHaveAttribute("data-revealed", "true");
  });

  it("shows the ambient wings indicator when collapsed and NOT hovered (T14)", () => {
    render(
      <Island
        notification={makeNotification({ priority: "high" })}
        state="compact"
        mode="notch"
        notchGeometry={G1}
      />
    );
    // The pill wrapper is concealed (not revealed) - the ambient indicator takes its place.
    expect(screen.getByTestId("island-reveal")).toHaveAttribute("data-revealed", "false");

    const ambient = screen.getByTestId("island-ambient");
    expect(ambient).toHaveAttribute("data-visible", "true");
    // Sized like T12's wing pill: cutout width + 2 wings, at the cutout height.
    expect(ambient.style.width).toBe(`${183 + 2 * 24}px`);
    expect(ambient.style.height).toBe("32px");
    // The priority accent hint is a dot (no progress) carrying the notification's priority.
    expect(ambient).toHaveAttribute("data-priority", "high");
    expect(screen.getByTestId("island-ambient-dot")).toBeInTheDocument();
    // No glyph/label content in the ambient indicator (T12 taught us they do not fit).
    expect(screen.queryByTestId("island-ambient-ring")).not.toBeInTheDocument();
  });

  it("uses the progress ring in the ambient indicator when progress exists (T14)", () => {
    render(
      <Island
        notification={makeNotification({ progress: { value: 0.5, style: "bar" } })}
        state="compact"
        mode="notch"
        notchGeometry={G1}
      />
    );
    expect(screen.getByTestId("island-ambient-ring")).toBeInTheDocument();
    expect(screen.queryByTestId("island-ambient-dot")).not.toBeInTheDocument();
  });

  it("hides the ambient indicator once revealed (hover) or expanded (T14)", () => {
    const { rerender } = render(
      <Island
        notification={makeNotification()}
        state="compact"
        mode="notch"
        notchGeometry={G1}
        notchHover
      />
    );
    // Hovered compact -> revealed pill, ambient hidden (still mounted for the cross-fade).
    expect(screen.getByTestId("island-ambient")).toHaveAttribute("data-visible", "false");

    rerender(
      <Island
        notification={makeNotification()}
        state="expanded"
        mode="notch"
        notchGeometry={G1}
      />
    );
    // Expanded is always visible -> no ambient.
    expect(screen.getByTestId("island-ambient")).toHaveAttribute("data-visible", "false");
  });

  it("takes the ambient-wings width for the compact pill (seamless hover-reveal)", () => {
    // The controller writes the effective width imperatively; the pill matches the
    // ambient wings (cutout 183 + 2*24 = 231), NOT the bare cutout width, so the
    // idle wings and the revealed pill share the top band (no sideways jump on hover).
    render(
      <Island
        notification={makeNotification()}
        state="compact"
        mode="notch"
        notchGeometry={G1}
      />
    );
    expect(screen.getByTestId("island").style.width).toBe("231px");
  });

  it("covers the notch: compact height is the strip + the cutout cap (option A)", () => {
    // The controller grows the compact shape by the cutout height so its top band
    // covers the physical notch; the strip below is the configured height.
    // effective height max(34,32)=34 + cutout cap 32 = 66.
    render(
      <Island
        notification={makeNotification()}
        state="compact"
        mode="notch"
        notchGeometry={G1}
      />
    );
    expect(screen.getByTestId("island").style.height).toBe("66px");
  });

  it("stays float layout (no notch marker / offset) without geometry", () => {
    render(
      <Island notification={makeNotification()} state="compact" mode="notch" />
    );
    expect(screen.getByText("claude-code")).toBeInTheDocument();
    const wrapper = screen.getByTestId("island-reveal");
    expect(wrapper).not.toHaveAttribute("data-notch");
    expect(wrapper.style.getPropertyValue("--di-notch-h")).toBe("");
  });

  it("does NOT enter under-notch layout in float mode even with geometry", () => {
    render(
      <Island
        notification={makeNotification()}
        state="compact"
        mode="float"
        notchGeometry={G1}
      />
    );
    expect(screen.getByText("claude-code")).toBeInTheDocument();
    expect(screen.getByTestId("island-reveal")).not.toHaveAttribute("data-notch");
    // Float never shows the ambient wings indicator (no ambient state off the notched panel).
    expect(screen.queryByTestId("island-ambient")).not.toBeInTheDocument();
  });

  it("a critical no-action notification NEVER auto-collapses (stays expanded)", () => {
    // Documented invariant: any critical notification stays expanded and never
    // auto-collapses (parity with the card that never auto-dismisses critical).
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.useFakeTimers();
    try {
      render(
        <Island
          notification={makeNotification({ priority: "critical" })}
          mode="notch"
          notchGeometry={G1}
        />
      );
      expect(screen.getByTestId("island-expanded")).toBeInTheDocument();
      // Well past the 2.6s hold — a non-critical notification would have collapsed.
      act(() => vi.advanceTimersByTime(10000));
      expect(screen.getByTestId("island-expanded")).toBeInTheDocument();
      expect(screen.queryByTestId("island-compact")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("arrival does NOT auto-collapse while hovered; collapses once the cursor leaves", () => {
    // Regression: the arrival card must not collapse out from under a reader. While
    // `hovered` (island:hover) is true the 2.6s auto-collapse is deferred; when the
    // cursor leaves, the next poll collapses to the compact pill (card hover-pause parity).
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <Island notification={makeNotification()} mode="notch" notchGeometry={G1} hovered />
      );
      // Arrives expanded.
      expect(screen.getByTestId("island-expanded")).toBeInTheDocument();
      // Hold elapses, but hovered -> still expanded (collapse deferred).
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.getByTestId("island-expanded")).toBeInTheDocument();
      // Cursor leaves -> the next poll collapses to the compact pill.
      rerender(
        <Island notification={makeNotification()} mode="notch" notchGeometry={G1} hovered={false} />
      );
      act(() => vi.advanceTimersByTime(300));
      expect(screen.getByTestId("island-compact")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("reports the shape hitbox on settle (BUG B): onSettle fires with a rect", () => {
    // An uncontrolled island snaps to its arrival state on mount, which fires the
    // settle hook -> the host reports it as the click-through hitbox. jsdom boxes
    // are zero, but the CALL (with x/y/w/h) is what wires the hitbox path.
    const onSettle = vi.fn();
    render(
      <Island
        notification={makeNotification()}
        mode="notch"
        notchGeometry={G1}
        onSettle={onSettle}
      />
    );
    expect(onSettle).toHaveBeenCalled();
    const rect = onSettle.mock.calls[0][0];
    expect(rect).toEqual(
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
        w: expect.any(Number),
        h: expect.any(Number),
      })
    );
  });
});
