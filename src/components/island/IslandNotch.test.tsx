import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Island } from "./Island";
import type { NotchGeometry } from "@/lib/islandMorph";
import type { NotificationPayload } from "@/types/notification";

// T13 under-notch layout (jsdom). With a real cutout geometry in notch mode the
// island renders as a SECOND NOTCH below the cutout: the compact pill takes the
// cutout WIDTH, the whole island is offset down by the cutout HEIGHT (published as
// `--di-notch-h` on the `.di-reveal` wrapper), and the compact content lays out
// NORMALLY - the sender label is back (no wing layout). Without geometry (the
// default jsdom path) nothing changes.
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

describe("Island under-notch layout (T13)", () => {
  it("keeps the sender label and marks the reveal wrapper in notch mode with geometry", () => {
    render(
      <Island
        notification={makeNotification()}
        state="compact"
        mode="notch"
        notchGeometry={G1}
      />
    );
    // Normal compact layout: glyph + sender label all present (no wing omission).
    expect(screen.getByTestId("island-compact-glyph")).toBeInTheDocument();
    expect(screen.getByText("claude-code")).toBeInTheDocument();

    // The reveal wrapper carries the under-notch offset var + notch marker.
    const wrapper = screen.getByTestId("island-reveal");
    expect(wrapper).toHaveAttribute("data-notch", "true");
    expect(wrapper.style.getPropertyValue("--di-notch-h")).toBe("32px");
    // A controlled island is always revealed so fixtures render the pill.
    expect(wrapper).toHaveAttribute("data-revealed", "true");
  });

  it("takes the cutout width for the compact pill (second-notch sizing)", () => {
    // The controller writes the effective width imperatively; the pill is exactly
    // the 183pt cutout width, not the 218 default.
    render(
      <Island
        notification={makeNotification()}
        state="compact"
        mode="notch"
        notchGeometry={G1}
      />
    );
    expect(screen.getByTestId("island").style.width).toBe("183px");
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
