import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { IslandOverlay } from "./IslandOverlay";
import { emitMockEvent, clearMockListeners } from "@/__mocks__/tauri-api";
import type { NotificationPayload } from "@/types/notification";
import type { IslandRow, IslandSnapshot } from "@/types/islandSnapshot";
import { ringDash } from "@/lib/progress";

// T5b lifecycle state-machine specs at the SINGLE-notification level (count === 1).
// T6 made IslandOverlay snapshot-driven (guard G10 / C1), so these drive the
// `island:snapshot` event instead of the store, but the single Island lifecycle
// (arrive expanded -> auto-collapse; in-place progress refresh; latest-wins;
// dismiss -> hidden) is UNTOUCHED. The multi-notification (list-open) path is a
// separate Model B concern covered in IslandGroup.test.tsx.

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

function rowOf(n: NotificationPayload): IslandRow {
  return { ...n, hasWaiter: false };
}

function snapshotOf(notifs: NotificationPayload[]): IslandSnapshot {
  const rows = notifs.map(rowOf);
  const count = notifs.length;
  const badgeLabel = count > 9 ? "9+" : String(count);
  return {
    count,
    badgeLabel,
    badgeWidth: 26 + 8 * (badgeLabel.length - 1),
    merged: 0,
    spotlight: rows[0] ?? null,
    rows,
  };
}

async function mount() {
  render(<IslandOverlay />);
  await act(async () => {
    await Promise.resolve();
  });
}

function emitSnapshot(snapshot: IslandSnapshot) {
  act(() => emitMockEvent("island:snapshot", snapshot));
}

beforeEach(() => {
  vi.clearAllMocks();
  clearMockListeners();
});

afterEach(() => {
  cleanup();
  clearMockListeners();
  vi.useRealTimers();
});

describe("Island lifecycle - interruption state machine (single)", () => {
  it("[hidden + arrival] presents the newest island notification expanded (C4)", async () => {
    await mount();
    expect(screen.queryByTestId("island-expanded")).not.toBeInTheDocument();

    emitSnapshot(snapshotOf([makeNotification({ title: "Ship it?" })]));

    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();
    expect(screen.getByText("Ship it?")).toBeInTheDocument();
  });

  it("[expanded + progress update] refreshes in place without remounting (no frame resize)", async () => {
    await mount();
    emitSnapshot(
      snapshotOf([makeNotification({ id: "prog", progress: { value: 0.2, style: "bar" } })])
    );

    const before = screen.getByTestId("island-expanded");
    expect(screen.getByText("20%")).toBeInTheDocument();

    emitSnapshot(
      snapshotOf([makeNotification({ id: "prog", progress: { value: 0.7, style: "bar" } })])
    );

    // Same expanded card instance (same id -> no remount), fresh value shown.
    expect(screen.getByTestId("island-expanded")).toBe(before);
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.queryByText("20%")).not.toBeInTheDocument();
  });

  it("[compact + click] manual trigger re-expands, and the hold re-arms to collapse again", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    await mount();
    vi.useFakeTimers();

    emitSnapshot(snapshotOf([makeNotification({ id: "clicky" })]));

    // Entry: expanded -> auto-collapse.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId("island-compact")).toBeInTheDocument();

    // Click the pill -> expands again (mockup toggle behavior).
    act(() => {
      screen.getByTestId("island").click();
    });
    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();

    // The hold RE-ARMS after a manual expand: it collapses again on its own.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId("island-compact")).toBeInTheDocument();
  });

  it("[expanded + click on an action button] never toggles; a plain surface click collapses", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    await mount();
    vi.useFakeTimers();

    emitSnapshot(
      snapshotOf([
        makeNotification({
          id: "btn",
          actions: [{ id: "ok", label: "OK", style: "primary" }],
        }),
      ])
    );
    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();

    // Clicking the action button must NOT toggle the island shut.
    act(() => {
      screen.getByRole("button", { name: "OK" }).click();
    });
    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();

    // A plain click on the island surface collapses it (toggle).
    act(() => {
      screen.getByTestId("island").click();
    });
    expect(screen.getByTestId("island-compact")).toBeInTheDocument();
  });

  it("[compact + progress update] refreshes the live-activity even after collapse (never stale)", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    await mount();
    vi.useFakeTimers();

    emitSnapshot(
      snapshotOf([makeNotification({ id: "prog", progress: { value: 0.2, style: "bar" } })])
    );

    // Arrives expanded, then auto-collapses to the compact pill (hold elapses).
    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId("island-compact")).toBeInTheDocument();

    // A progress event AFTER collapse updates the compact live-activity in place.
    emitSnapshot(
      snapshotOf([makeNotification({ id: "prog", progress: { value: 0.85, style: "bar" } })])
    );

    const live = screen.getByTestId("island-compact-progress");
    const fill = live.querySelector(".di-mini-fill") as SVGCircleElement;
    expect(fill.getAttribute("stroke-dashoffset")).toBe(
      String(ringDash(0.85, 9).dashOffset)
    );
    expect(screen.getByText("85%")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("[latest-wins] a new count-1 spotlight re-presents and drops the previous item", async () => {
    await mount();
    emitSnapshot(snapshotOf([makeNotification({ id: "a", title: "First" })]));
    expect(screen.getByText("First")).toBeInTheDocument();

    // The manager emits a fresh count-1 snapshot whose single item is now "b".
    emitSnapshot(snapshotOf([makeNotification({ id: "b", title: "Second" })]));

    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.queryByText("First")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("island-expanded")).toHaveLength(1);
  });

  it("[any + dismissed] drops the item and the island goes hidden", async () => {
    await mount();
    emitSnapshot(snapshotOf([makeNotification({ id: "d1" })]));
    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();

    emitSnapshot(snapshotOf([])); // count 0

    expect(screen.queryByTestId("island-expanded")).not.toBeInTheDocument();
    expect(screen.queryByTestId("island-compact")).not.toBeInTheDocument();
  });

  it("[--wait decision] holds expanded past the collapse window (auto-collapse suppressed)", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    await mount();
    vi.useFakeTimers();

    emitSnapshot(
      snapshotOf([
        makeNotification({
          id: "wait-1",
          title: "Approve deploy?",
          actions: [{ id: "ok", label: "Approve", style: "primary" }],
        }),
      ])
    );
    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();

    // Well past the entry hold: a decision must STAY expanded (T5a suppression).
    act(() => {
      vi.advanceTimersByTime(20000);
    });

    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();
    expect(screen.queryByTestId("island-compact")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
