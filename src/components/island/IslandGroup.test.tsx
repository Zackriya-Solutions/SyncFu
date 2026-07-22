import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { IslandGroup } from "./IslandGroup";
import type { NotificationPayload } from "@/types/notification";
import type { IslandRow, IslandSnapshot } from "@/types/islandSnapshot";

// Model B host specs: dumb-render routing (spotlight <-> list), the row stagger,
// the bottom fade / scroll cap, auto-dismiss pause-while-open, and the absence of
// the rejected Models A (cycle arrows) and C (stack-under DOM). Rank/dedupe/count
// are Rust-owned and not recomputed here, so these fixtures pass a pre-built
// snapshot exactly as the manager would emit it.

function notif(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    id: "n1",
    sender: "ci",
    title: "Build",
    body: "",
    priority: "normal",
    presentation: "island",
    timeout: "default",
    actions: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function rowOf(n: NotificationPayload, hasWaiter = false): IslandRow {
  return { ...n, hasWaiter };
}

function snapshotOf(rows: IslandRow[], merged = 0): IslandSnapshot {
  const count = rows.length + merged;
  const badgeLabel = count > 9 ? "9+" : String(count);
  return {
    count,
    badgeLabel,
    badgeWidth: 26 + 8 * (badgeLabel.length - 1),
    merged,
    spotlight: rows[0] ?? null,
    rows,
  };
}

// jsdom provides requestAnimationFrame/cancelAnimationFrame natively; the ported
// morph loop parks itself at rest, so no rAF stubbing is needed here.
afterEach(() => {
  vi.useRealTimers();
});

const noop = () => {};

describe("IslandGroup (Model B)", () => {
  it("starts as the compact spotlight with the top item + xN badge", () => {
    const snap = snapshotOf([
      rowOf(notif({ id: "a", sender: "ci", title: "Deploy", priority: "high" })),
      rowOf(notif({ id: "b", sender: "gh", title: "Review" })),
    ]);
    render(<IslandGroup snapshot={snap} onRowAction={noop} onRowActionId={noop} onDismiss={noop} onClearAll={noop} />);

    expect(screen.getByTestId("island-spotlight")).toBeInTheDocument();
    expect(screen.getByTestId("island-badge")).toHaveTextContent("2");
    // Compact by default: the list is not yet mounted.
    expect(screen.queryByTestId("island-list")).not.toBeInTheDocument();
  });

  it("expands to the ranked list on click, and collapses back", () => {
    const snap = snapshotOf([
      rowOf(notif({ id: "a", title: "A" })),
      rowOf(notif({ id: "b", title: "B" })),
    ]);
    render(<IslandGroup snapshot={snap} onRowAction={noop} onRowActionId={noop} onDismiss={noop} onClearAll={noop} />);

    fireEvent.click(screen.getByTestId("island-spotlight"));
    expect(screen.getByTestId("island-list")).toBeInTheDocument();
    expect(screen.getAllByTestId("island-row")).toHaveLength(2);

    fireEvent.click(screen.getByTestId("island-list-collapse"));
    expect(screen.queryByTestId("island-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("island-spotlight")).toBeInTheDocument();
  });

  it("staggers rows by 50ms via animation-delay", () => {
    const snap = snapshotOf([
      rowOf(notif({ id: "a", title: "A" })),
      rowOf(notif({ id: "b", title: "B" })),
      rowOf(notif({ id: "c", title: "C" })),
    ]);
    render(<IslandGroup snapshot={snap} onRowAction={noop} onRowActionId={noop} onDismiss={noop} onClearAll={noop} />);
    fireEvent.click(screen.getByTestId("island-spotlight"));

    const rows = screen.getAllByTestId("island-row");
    expect(rows[0]).toHaveStyle({ animationDelay: "0ms" });
    expect(rows[1]).toHaveStyle({ animationDelay: "50ms" });
    expect(rows[2]).toHaveStyle({ animationDelay: "100ms" });
  });

  it("marks the body as scrolling (bottom fade) only past the 6-row cap", () => {
    const six = Array.from({ length: 6 }, (_, i) =>
      rowOf(notif({ id: `n${i}`, title: `T${i}` }))
    );
    const { rerender } = render(
      <IslandGroup snapshot={snapshotOf(six)} onRowAction={noop} onRowActionId={noop} onDismiss={noop} onClearAll={noop} />
    );
    fireEvent.click(screen.getByTestId("island-spotlight"));
    expect(screen.getByTestId("island-list-body")).toHaveAttribute(
      "data-scrolls",
      "false"
    );

    const seven = [...six, rowOf(notif({ id: "n6", title: "T6" }))];
    rerender(
      <IslandGroup snapshot={snapshotOf(seven)} onRowAction={noop} onRowActionId={noop} onDismiss={noop} onClearAll={noop} />
    );
    // still expanded; 7 rows -> scroll + fade
    expect(screen.getByTestId("island-list-body")).toHaveAttribute(
      "data-scrolls",
      "true"
    );
  });

  it("shows the merged count in the list header", () => {
    const snap = snapshotOf([rowOf(notif({ id: "a", title: "A" }))], 3); // 1 row, 3 merged
    render(<IslandGroup snapshot={snap} onRowAction={noop} onRowActionId={noop} onDismiss={noop} onClearAll={noop} />);
    fireEvent.click(screen.getByTestId("island-spotlight"));
    expect(screen.getByTestId("island-list-count")).toHaveTextContent("1 · 3 merged");
  });

  it("auto-dismiss runs while COMPACT but is PAUSED while the list is open", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const snap = snapshotOf([
      rowOf(notif({ id: "a", title: "A", timeout: { seconds: 5 } })),
      rowOf(notif({ id: "b", title: "B", timeout: { seconds: 5 } })),
    ]);
    render(<IslandGroup snapshot={snap} onRowAction={noop} onRowActionId={noop} onDismiss={onDismiss} onClearAll={noop} />);

    // Open the list -> timers paused.
    fireEvent.click(screen.getByTestId("island-spotlight"));
    act(() => vi.advanceTimersByTime(10000));
    expect(onDismiss).not.toHaveBeenCalled();

    // Collapse -> timers resume from full and fire.
    fireEvent.click(screen.getByTestId("island-list-collapse"));
    act(() => vi.advanceTimersByTime(6000));
    expect(onDismiss).toHaveBeenCalledWith("a");
    expect(onDismiss).toHaveBeenCalledWith("b");
  });

  it("never auto-dismisses waiter-bearing or critical rows (F2 suppression scope)", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const snap = snapshotOf([
      rowOf(notif({ id: "wait", title: "Approve?", timeout: { seconds: 3 } }), true),
      rowOf(notif({ id: "crit", title: "Down", priority: "critical", timeout: { seconds: 3 } })),
    ]);
    render(<IslandGroup snapshot={snap} onRowAction={noop} onRowActionId={noop} onDismiss={onDismiss} onClearAll={noop} />);
    // Compact (timers active), advance well past their timeout.
    act(() => vi.advanceTimersByTime(60000));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("rejects Models A and C: no cycle arrows, no stack-under DOM (guard G11)", () => {
    const snap = snapshotOf([
      rowOf(notif({ id: "a", title: "A" })),
      rowOf(notif({ id: "b", title: "B" })),
    ]);
    const { container } = render(
      <IslandGroup snapshot={snap} onRowAction={noop} onRowActionId={noop} onDismiss={noop} onClearAll={noop} />
    );
    fireEvent.click(screen.getByTestId("island-spotlight"));
    // Model A: prev/next cycle navigation must not exist.
    expect(container.querySelector('[data-act="prev"]')).toBeNull();
    expect(container.querySelector('[data-act="next"]')).toBeNull();
    expect(screen.queryByTestId("island-nav")).not.toBeInTheDocument();
    // Model C: no stacked-toast host under the island.
    expect(container.querySelector(".stack-host")).toBeNull();
    expect(screen.queryByTestId("island-stack")).not.toBeInTheDocument();
  });

  it("row action fires the primary action; falls back to dismiss when actionless", () => {
    const onRowAction = vi.fn();
    const snap = snapshotOf([
      rowOf(notif({ id: "a", title: "A" })),
      rowOf(notif({ id: "b", title: "B" })),
    ]);
    render(<IslandGroup snapshot={snap} onRowAction={onRowAction} onRowActionId={noop} onDismiss={noop} onClearAll={noop} />);
    fireEvent.click(screen.getByTestId("island-spotlight"));
    fireEvent.click(screen.getAllByTestId("island-row-action")[0]);
    expect(onRowAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a" })
    );
  });

  it("the header Clear all button invokes the dismiss-all path (T15)", () => {
    const onClearAll = vi.fn();
    const snap = snapshotOf([
      rowOf(notif({ id: "a", title: "A" })),
      rowOf(notif({ id: "b", title: "B" })),
    ]);
    render(
      <IslandGroup
        snapshot={snap}
        onRowAction={noop}
        onRowActionId={noop}
        onDismiss={noop}
        onClearAll={onClearAll}
      />
    );
    fireEvent.click(screen.getByTestId("island-spotlight"));
    fireEvent.click(screen.getByTestId("island-list-clear"));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("the per-row close dismisses EXACTLY that row's id, never crossing (A4, T15)", () => {
    const onDismiss = vi.fn();
    const snap = snapshotOf([
      rowOf(notif({ id: "a", title: "A" })),
      rowOf(notif({ id: "b", title: "B" })),
    ]);
    render(
      <IslandGroup
        snapshot={snap}
        onRowAction={noop}
        onRowActionId={noop}
        onDismiss={onDismiss}
        onClearAll={noop}
      />
    );
    fireEvent.click(screen.getByTestId("island-spotlight"));
    // The SECOND row's x resolves only "b" - the per-id waiter identity (A4).
    fireEvent.click(screen.getAllByTestId("island-row-close")[1]);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith("b");
  });

  // --- Inline row expansion (T18): multi-action rows reveal their full option set ---

  const twoActions = [
    { id: "open", label: "Open Docs", style: "primary" as const },
    { id: "star", label: "Star on GitHub", style: "secondary" as const },
  ];

  it("expands a multi-action row on body click, revealing ALL actions with their styles", () => {
    const snap = snapshotOf([
      rowOf(notif({ id: "a", title: "A", actions: twoActions })),
      rowOf(notif({ id: "b", title: "B" })),
    ]);
    render(
      <IslandGroup snapshot={snap} onRowAction={noop} onRowActionId={noop} onDismiss={noop} onClearAll={noop} />
    );
    fireEvent.click(screen.getByTestId("island-spotlight"));

    // Compact: only the primary fast-path button, expansion not mounted.
    expect(screen.queryByTestId("island-row-expand")).not.toBeInTheDocument();
    const body = screen.getAllByTestId("island-row-body")[0];
    expect(body).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(body);
    expect(body).toHaveAttribute("aria-expanded", "true");
    const expandActions = screen.getAllByTestId("island-row-expand-action");
    expect(expandActions).toHaveLength(2);
    expect(expandActions[0]).toHaveTextContent("Open Docs");
    expect(expandActions[0].className).toContain("primary");
    expect(expandActions[1]).toHaveTextContent("Star on GitHub");
    expect(expandActions[1].className).toContain("secondary");
  });

  it("fires the EXACT id+action for a clicked expansion button (A4)", () => {
    const onRowActionId = vi.fn();
    const snap = snapshotOf([
      rowOf(notif({ id: "a", title: "A", actions: twoActions })),
      rowOf(notif({ id: "b", title: "B", actions: twoActions })),
    ]);
    render(
      <IslandGroup snapshot={snap} onRowAction={noop} onRowActionId={onRowActionId} onDismiss={noop} onClearAll={noop} />
    );
    fireEvent.click(screen.getByTestId("island-spotlight"));
    // Expand row B (the SECOND row) and click its SECONDARY action.
    fireEvent.click(screen.getAllByTestId("island-row-body")[1]);
    const bActions = screen.getAllByTestId("island-row-expand-action");
    fireEvent.click(bActions[1]);
    expect(onRowActionId).toHaveBeenCalledTimes(1);
    expect(onRowActionId).toHaveBeenCalledWith("b", "star");
  });

  it("is an accordion: expanding one row collapses the other", () => {
    const snap = snapshotOf([
      rowOf(notif({ id: "a", title: "A", actions: twoActions })),
      rowOf(notif({ id: "b", title: "B", actions: twoActions })),
    ]);
    render(
      <IslandGroup snapshot={snap} onRowAction={noop} onRowActionId={noop} onDismiss={noop} onClearAll={noop} />
    );
    fireEvent.click(screen.getByTestId("island-spotlight"));
    const [bodyA, bodyB] = screen.getAllByTestId("island-row-body");

    fireEvent.click(bodyA);
    expect(bodyA).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("island-row-expand")).toHaveAttribute("data-id", "a");

    fireEvent.click(bodyB);
    // A collapses, only B's expansion remains.
    expect(bodyA).toHaveAttribute("aria-expanded", "false");
    expect(bodyB).toHaveAttribute("aria-expanded", "true");
    const expands = screen.getAllByTestId("island-row-expand");
    expect(expands).toHaveLength(1);
    expect(expands[0]).toHaveAttribute("data-id", "b");
  });

  it("does NOT make single-/zero-action rows expandable (fast path unchanged)", () => {
    const onRowAction = vi.fn();
    const snap = snapshotOf([
      rowOf(notif({ id: "one", title: "One", actions: [{ id: "go", label: "Go", style: "primary" }] })),
      rowOf(notif({ id: "none", title: "None" })),
    ]);
    render(
      <IslandGroup snapshot={snap} onRowAction={onRowAction} onRowActionId={noop} onDismiss={noop} onClearAll={noop} />
    );
    fireEvent.click(screen.getByTestId("island-spotlight"));
    // Neither row exposes an expand toggle.
    expect(screen.queryByTestId("island-row-body")).not.toBeInTheDocument();
    // The compact primary fast path still fires for the single-action row.
    fireEvent.click(screen.getAllByTestId("island-row-action")[0]);
    expect(onRowAction).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }));
  });

  it("keeps the 560/scroll cap with a row expanded (scroll container absorbs growth)", () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      rowOf(notif({ id: `n${i}`, title: `T${i}`, actions: twoActions }))
    );
    render(
      <IslandGroup snapshot={snapshotOf(rows)} onRowAction={noop} onRowActionId={noop} onDismiss={noop} onClearAll={noop} />
    );
    fireEvent.click(screen.getByTestId("island-spotlight"));
    // 7 rows -> scroll affordance on. Expanding a row must not clear it: the cap is
    // enforced by the scroll container, not by collapsing the list.
    const body = screen.getByTestId("island-list-body");
    expect(body).toHaveAttribute("data-scrolls", "true");
    fireEvent.click(screen.getAllByTestId("island-row-body")[0]);
    expect(screen.getByTestId("island-row-expand")).toBeInTheDocument();
    expect(body).toHaveAttribute("data-scrolls", "true");
  });

  // --- Hitbox reporting (BUG B): the group must report on EVERY size-affecting state
  // change, or the backend click-through region goes stale (visible-but-unclickable).
  // jsdom boxes are zero, so we assert the CALL + rect SHAPE, never pixel values. ---

  const rectShape = expect.objectContaining({
    x: expect.any(Number),
    y: expect.any(Number),
    w: expect.any(Number),
    h: expect.any(Number),
  });

  it("reports the shape hitbox on the initial compact spotlight", () => {
    const onSettle = vi.fn();
    const snap = snapshotOf([
      rowOf(notif({ id: "a", title: "A" })),
      rowOf(notif({ id: "b", title: "B" })),
    ]);
    render(
      <IslandGroup snapshot={snap} onRowAction={noop} onRowActionId={noop} onDismiss={noop} onClearAll={noop} onSettle={onSettle} />
    );
    // snap("compact") calls onSettle synchronously during the mount layout effect.
    expect(onSettle).toHaveBeenCalled();
    expect(onSettle.mock.calls[0][0]).toEqual(rectShape);
  });

  it("re-reports the hitbox when an inline row expands and collapses (accordion growth)", () => {
    const onSettle = vi.fn();
    const snap = snapshotOf([
      rowOf(notif({ id: "a", title: "A", actions: twoActions })),
      rowOf(notif({ id: "b", title: "B" })),
    ]);
    render(
      <IslandGroup snapshot={snap} onRowAction={noop} onRowActionId={noop} onDismiss={noop} onClearAll={noop} onSettle={onSettle} />
    );
    fireEvent.click(screen.getByTestId("island-spotlight")); // expand to the list

    // Opening the accordion grows the shape -> a fresh report (via onExpandedRowChange).
    const beforeOpen = onSettle.mock.calls.length;
    fireEvent.click(screen.getAllByTestId("island-row-body")[0]);
    expect(onSettle.mock.calls.length).toBeGreaterThan(beforeOpen);
    const lastCall = onSettle.mock.calls[onSettle.mock.calls.length - 1];
    expect(lastCall[0]).toEqual(rectShape);

    // Collapsing it shrinks the shape -> another report.
    const beforeClose = onSettle.mock.calls.length;
    fireEvent.click(screen.getAllByTestId("island-row-body")[0]);
    expect(onSettle.mock.calls.length).toBeGreaterThan(beforeClose);
  });

  it("re-reports the hitbox when the row set changes while the list is open (list growth)", () => {
    const onSettle = vi.fn();
    const two = snapshotOf([
      rowOf(notif({ id: "a", title: "A" })),
      rowOf(notif({ id: "b", title: "B" })),
    ]);
    const { rerender } = render(
      <IslandGroup snapshot={two} onRowAction={noop} onRowActionId={noop} onDismiss={noop} onClearAll={noop} onSettle={onSettle} />
    );
    fireEvent.click(screen.getByTestId("island-spotlight")); // expand

    const before = onSettle.mock.calls.length;
    const three = snapshotOf([
      rowOf(notif({ id: "a", title: "A" })),
      rowOf(notif({ id: "b", title: "B" })),
      rowOf(notif({ id: "c", title: "C" })),
    ]);
    rerender(
      <IslandGroup snapshot={three} onRowAction={noop} onRowActionId={noop} onDismiss={noop} onClearAll={noop} onSettle={onSettle} />
    );
    // A notification arriving while the list is open must re-report the grown shape.
    expect(onSettle.mock.calls.length).toBeGreaterThan(before);
  });

  it("wires aria-controls from the accordion toggle to its expansion region (a11y)", () => {
    const snap = snapshotOf([
      rowOf(notif({ id: "a", title: "A", actions: twoActions })),
      rowOf(notif({ id: "b", title: "B" })),
    ]);
    render(
      <IslandGroup snapshot={snap} onRowAction={noop} onRowActionId={noop} onDismiss={noop} onClearAll={noop} />
    );
    fireEvent.click(screen.getByTestId("island-spotlight"));
    const body = screen.getAllByTestId("island-row-body")[0];
    const controls = body.getAttribute("aria-controls");
    expect(controls).toBe("island-row-expand-a");
    fireEvent.click(body);
    expect(screen.getByTestId("island-row-expand")).toHaveAttribute("id", controls!);
  });
});
