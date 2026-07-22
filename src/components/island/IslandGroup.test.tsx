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
    render(<IslandGroup snapshot={snap} onRowAction={noop} onDismiss={noop} onClearAll={noop} />);

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
    render(<IslandGroup snapshot={snap} onRowAction={noop} onDismiss={noop} onClearAll={noop} />);

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
    render(<IslandGroup snapshot={snap} onRowAction={noop} onDismiss={noop} onClearAll={noop} />);
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
      <IslandGroup snapshot={snapshotOf(six)} onRowAction={noop} onDismiss={noop} onClearAll={noop} />
    );
    fireEvent.click(screen.getByTestId("island-spotlight"));
    expect(screen.getByTestId("island-list-body")).toHaveAttribute(
      "data-scrolls",
      "false"
    );

    const seven = [...six, rowOf(notif({ id: "n6", title: "T6" }))];
    rerender(
      <IslandGroup snapshot={snapshotOf(seven)} onRowAction={noop} onDismiss={noop} onClearAll={noop} />
    );
    // still expanded; 7 rows -> scroll + fade
    expect(screen.getByTestId("island-list-body")).toHaveAttribute(
      "data-scrolls",
      "true"
    );
  });

  it("shows the merged count in the list header", () => {
    const snap = snapshotOf([rowOf(notif({ id: "a", title: "A" }))], 3); // 1 row, 3 merged
    render(<IslandGroup snapshot={snap} onRowAction={noop} onDismiss={noop} onClearAll={noop} />);
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
    render(<IslandGroup snapshot={snap} onRowAction={noop} onDismiss={onDismiss} onClearAll={noop} />);

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
    render(<IslandGroup snapshot={snap} onRowAction={noop} onDismiss={onDismiss} onClearAll={noop} />);
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
      <IslandGroup snapshot={snap} onRowAction={noop} onDismiss={noop} onClearAll={noop} />
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
    render(<IslandGroup snapshot={snap} onRowAction={onRowAction} onDismiss={noop} onClearAll={noop} />);
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
});
