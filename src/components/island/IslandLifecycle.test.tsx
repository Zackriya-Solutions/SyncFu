import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { IslandOverlay } from "./IslandOverlay";
import { useNotificationStore } from "@/stores/notificationStore";
import { clearMockListeners } from "@/__mocks__/tauri-api";
import type { NotificationPayload } from "@/types/notification";
import { ringDash } from "@/lib/progress";

// T5b lifecycle state-machine specs: ONE test per interruption row implemented at
// the frontend lifecycle level (04-risk S1 / 02-arch S7). These drive the SHARED
// notificationStore directly (the store is the single source of truth for both
// renderers; the notification:update -> store wiring is covered in
// useNotifications.test.ts). Anatomy (compact vs expanded) is React-owned, so the
// morph controller's rAF loop is irrelevant to these assertions.
//
// Row -> test map is in the T5b return; list-open (row: expanded + 2nd notif) is a
// T6 SEAM and is deliberately NOT exercised here.

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

beforeEach(() => {
  vi.clearAllMocks();
  clearMockListeners();
  useNotificationStore.getState().clear();
});

afterEach(() => {
  cleanup();
  clearMockListeners();
  vi.useRealTimers();
});

describe("Island lifecycle - interruption state machine", () => {
  it("[hidden + arrival] presents the newest island notification expanded (C4)", () => {
    render(<IslandOverlay />);
    // Hidden: nothing rendered.
    expect(screen.queryByTestId("island-expanded")).not.toBeInTheDocument();

    act(() => {
      useNotificationStore.getState().add(makeNotification({ title: "Ship it?" }));
    });

    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();
    expect(screen.getByText("Ship it?")).toBeInTheDocument();
  });

  it("[expanded + progress update] refreshes in place without remounting (no frame resize)", () => {
    useNotificationStore
      .getState()
      .add(makeNotification({ id: "prog", progress: { value: 0.2, style: "bar" } }));
    render(<IslandOverlay />);

    const before = screen.getByTestId("island-expanded");
    expect(screen.getByText("20%")).toBeInTheDocument();

    act(() => {
      useNotificationStore
        .getState()
        .update("prog", { progress: { value: 0.7, style: "bar" } });
    });

    // Same expanded card instance (same id -> no remount), fresh value shown.
    expect(screen.getByTestId("island-expanded")).toBe(before);
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.queryByText("20%")).not.toBeInTheDocument();
  });

  it("[compact + progress update] refreshes the live-activity even after collapse (never stale)", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1); // inert loop; anatomy is React-owned
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.useFakeTimers();

    useNotificationStore
      .getState()
      .add(makeNotification({ id: "prog", progress: { value: 0.2, style: "bar" } }));
    render(<IslandOverlay />);

    // Arrives expanded, then auto-collapses to the compact pill (hold elapses).
    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId("island-compact")).toBeInTheDocument();

    // A progress event AFTER collapse updates the compact live-activity in place.
    act(() => {
      useNotificationStore
        .getState()
        .update("prog", { progress: { value: 0.85, style: "bar" } });
    });

    const live = screen.getByTestId("island-compact-progress");
    const fill = live.querySelector(".di-mini-fill") as SVGCircleElement;
    expect(fill.getAttribute("stroke-dashoffset")).toBe(
      String(ringDash(0.85, 9).dashOffset)
    );
    expect(screen.getByText("85%")).toBeInTheDocument();

    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);
    vi.unstubAllGlobals();
  });

  it("[morphing/any + new distinct notif] latest-wins re-present, previous item dropped", () => {
    useNotificationStore.getState().add(makeNotification({ id: "a", title: "First" }));
    render(<IslandOverlay />);
    expect(screen.getByText("First")).toBeInTheDocument();

    // A newer distinct notification becomes the spotlight (store prepends).
    act(() => {
      useNotificationStore.getState().add(makeNotification({ id: "b", title: "Second" }));
    });

    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.queryByText("First")).not.toBeInTheDocument();
    // Re-presented expanded (arrive-expanded), a single spotlight item (no list).
    expect(screen.getAllByTestId("island-expanded")).toHaveLength(1);
  });

  it("[any + dismissed] drops the item and the island goes hidden", () => {
    useNotificationStore.getState().add(makeNotification({ id: "d1" }));
    render(<IslandOverlay />);
    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();

    act(() => {
      useNotificationStore.getState().dismiss("d1");
    });

    expect(screen.queryByTestId("island-expanded")).not.toBeInTheDocument();
    expect(screen.queryByTestId("island-compact")).not.toBeInTheDocument();
  });

  it("[--wait decision] holds expanded past the collapse window (auto-collapse suppressed)", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.useFakeTimers();

    useNotificationStore.getState().add(
      makeNotification({
        id: "wait-1",
        title: "Approve deploy?",
        actions: [{ id: "ok", label: "Approve", style: "primary" }],
      })
    );
    render(<IslandOverlay />);
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
