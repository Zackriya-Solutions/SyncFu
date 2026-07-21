import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Island } from "./Island";
import type { NotificationPayload } from "@/types/notification";
import { ringDash } from "@/lib/progress";

// T5b progress rendering: the expanded card shows a bar OR a real ring per the
// payload's ProgressStyle; the compact pill shows a live-activity mini-ring in the
// trailing slot. These assert the anatomy + aria + geometry the visual baselines
// back (the pixel snapshots live in island-render.spec.ts).

function makeNotification(
  overrides: Partial<NotificationPayload> = {}
): NotificationPayload {
  return {
    id: "isl-1",
    sender: "claude-code",
    title: "Deploying",
    body: "Running migrations",
    priority: "normal",
    presentation: "island",
    timeout: "default",
    actions: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("IslandExpanded progress", () => {
  it("renders a progress BAR with the rounded percent and aria-valuenow", () => {
    render(
      <Island
        notification={makeNotification({
          progress: { value: 0.42, label: "compiling", style: "bar" },
        })}
        state="expanded"
      />
    );
    const progress = screen.getByTestId("island-progress");
    expect(progress).toHaveAttribute("data-style", "bar");
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    // Fill width reflects the percent; label + percent both shown.
    const fill = progress.querySelector(".di-pbar-fill") as HTMLElement;
    expect(fill.style.width).toBe("42%");
    expect(screen.getByText("compiling")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("renders a real RING (SVG dash geometry) when style is ring", () => {
    render(
      <Island
        notification={makeNotification({
          progress: { value: 0.75, label: "uploading", style: "ring" },
        })}
        state="expanded"
      />
    );
    const progress = screen.getByTestId("island-progress");
    expect(progress).toHaveAttribute("data-style", "ring");
    const fill = progress.querySelector(".di-ring-fill") as SVGCircleElement;
    const { dashArray, dashOffset } = ringDash(0.75, 10);
    expect(fill.getAttribute("stroke-dasharray")).toBe(String(dashArray));
    expect(fill.getAttribute("stroke-dashoffset")).toBe(String(dashOffset));
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("uploading")).toBeInTheDocument();
  });

  it("renders NO progress block when the payload has none", () => {
    render(<Island notification={makeNotification()} state="expanded" />);
    expect(screen.queryByTestId("island-progress")).not.toBeInTheDocument();
  });
});

describe("IslandCompact live-activity", () => {
  it("renders a mini progress ring + percent in the trailing slot", () => {
    render(
      <Island
        notification={makeNotification({
          progress: { value: 0.3, style: "bar" }, // compact is always a ring
        })}
        state="compact"
      />
    );
    const live = screen.getByTestId("island-compact-progress");
    const fill = live.querySelector(".di-mini-fill") as SVGCircleElement;
    const { dashOffset } = ringDash(0.3, 9);
    expect(fill.getAttribute("stroke-dashoffset")).toBe(String(dashOffset));
    expect(screen.getByText("30%")).toBeInTheDocument();
  });

  it("leaves the trailing slot empty when there is no progress", () => {
    render(<Island notification={makeNotification()} state="compact" />);
    expect(screen.queryByTestId("island-compact-progress")).not.toBeInTheDocument();
    // The slot itself still exists (mount point), just empty.
    expect(screen.getByTestId("island-compact-trailing")).toBeEmptyDOMElement();
  });
});
