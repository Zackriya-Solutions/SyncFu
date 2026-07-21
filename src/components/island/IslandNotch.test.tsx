import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Island } from "./Island";
import type { NotchGeometry } from "@/lib/islandMorph";
import type { NotificationPayload } from "@/types/notification";

// BUG A wing layout (jsdom). With a real cutout geometry in notch mode the compact
// pill lays out wing-aware: the sender LABEL is omitted (it cannot fit in the ~4px
// underhang below the 32pt cutout), the cutout width drives a `--di-notch-w` grid
// var, and the expanded card exposes `--di-notch-h` so its content drops below the
// cutout. Without geometry (the default jsdom path) nothing changes.
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

describe("Island notch wing layout (BUG A)", () => {
  it("omits the sender label and marks data-notch in notch mode with geometry", () => {
    render(
      <Island
        notification={makeNotification()}
        state="compact"
        mode="notch"
        notchGeometry={G1}
      />
    );
    // Glyph + trailing survive; the sender label is gone (it would sit behind the cutout).
    expect(screen.getByTestId("island-compact-glyph")).toBeInTheDocument();
    expect(screen.getByTestId("island-compact-trailing")).toBeInTheDocument();
    expect(screen.queryByText("claude-code")).not.toBeInTheDocument();

    const island = screen.getByTestId("island");
    expect(island).toHaveAttribute("data-notch", "true");
    // The grid center strip is exactly the cutout width.
    expect(island.style.getPropertyValue("--di-notch-w")).toBe("183px");
    expect(island.style.getPropertyValue("--di-notch-h")).toBe("32px");
  });

  it("keeps the sender label and NO notch vars without geometry (unchanged default)", () => {
    render(
      <Island notification={makeNotification()} state="compact" mode="notch" />
    );
    expect(screen.getByText("claude-code")).toBeInTheDocument();
    const island = screen.getByTestId("island");
    expect(island).not.toHaveAttribute("data-notch");
    expect(island.style.getPropertyValue("--di-notch-w")).toBe("");
  });

  it("does NOT enter wing layout in float mode even with geometry", () => {
    render(
      <Island
        notification={makeNotification()}
        state="compact"
        mode="float"
        notchGeometry={G1}
      />
    );
    // Float mode keeps the label; the cutout is irrelevant off the built-in panel.
    expect(screen.getByText("claude-code")).toBeInTheDocument();
    expect(screen.getByTestId("island")).not.toHaveAttribute("data-notch");
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

  it("widens the compact pill so wings exist beside the cutout", () => {
    // The controller writes the effective width imperatively; assert the box is the
    // wing-seated 303px (183 + 2*60), not the raw 218 default.
    render(
      <Island
        notification={makeNotification()}
        state="compact"
        mode="notch"
        notchGeometry={G1}
      />
    );
    expect(screen.getByTestId("island").style.width).toBe("303px");
  });
});
