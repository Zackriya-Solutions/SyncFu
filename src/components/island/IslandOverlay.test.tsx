import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { IslandOverlay } from "./IslandOverlay";
import { useNotificationStore } from "@/stores/notificationStore";
import { window as tauriWindow } from "@tauri-apps/api";
import { emitMockEvent, clearMockListeners } from "@/__mocks__/tauri-api";
import type { NotificationPayload } from "@/types/notification";

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

describe("IslandOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMockListeners();
    useNotificationStore.getState().clear();
  });

  afterEach(() => {
    clearMockListeners();
  });

  it("renders the island root container", () => {
    render(<IslandOverlay />);
    expect(screen.getByTestId("island-root")).toBeInTheDocument();
  });

  it("renders an island notification as the expanded card on arrival", () => {
    useNotificationStore.getState().add(makeNotification({ title: "Deploy?" }));
    render(<IslandOverlay />);
    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();
    expect(screen.getByText("Deploy?")).toBeInTheDocument();
  });

  it("renders ONLY island-presentation items, never card items (guard G1)", () => {
    // A broadcast card add can reach this window; the island must ignore it.
    useNotificationStore.getState().add(
      makeNotification({ id: "card-1", title: "Card Title", presentation: "card" })
    );
    useNotificationStore.getState().add(
      makeNotification({ id: "isl-2", title: "Island Title", presentation: "island" })
    );

    render(<IslandOverlay />);

    expect(screen.getByText("Island Title")).toBeInTheDocument();
    expect(screen.queryByText("Card Title")).not.toBeInTheDocument();
  });

  it("excludes items with undefined presentation (defaults to card)", () => {
    useNotificationStore.getState().add(
      makeNotification({ id: "u-1", title: "Untagged", presentation: undefined })
    );
    render(<IslandOverlay />);
    expect(screen.queryByText("Untagged")).not.toBeInTheDocument();
    expect(screen.queryByTestId("island-expanded")).not.toBeInTheDocument();
  });

  it("ingests island notifications through the shared notificationStore", async () => {
    // Single shared ingest: the island reuses useNotifications -> notificationStore,
    // the same store the card uses. An island payload emitted on notification:add
    // reaching this store is proof it flowed through that shared ingest. (This does
    // NOT assert history persistence, which is unwired for all presentations - a
    // T10 concern - so we make no claim about it here.)
    render(<IslandOverlay />);

    await waitFor(() => {
      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    act(() => {
      emitMockEvent("notification:add", makeNotification({ id: "ingest-1", title: "Ingested" }));
    });

    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    expect(screen.getByText("Ingested")).toBeInTheDocument();
  });

  it("still renders the island when 6+ active card broadcasts arrive (no starvation)", async () => {
    // Card adds are broadcast and reach the island window too. If they entered
    // this window's store they would fill MAX_VISIBLE (5) slots and push a later
    // island item into the queue, rendering nothing. The ingest predicate drops
    // card payloads BEFORE the store, so the island always has room to render.
    render(<IslandOverlay />);

    await waitFor(() => {
      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    act(() => {
      for (let i = 0; i < 6; i++) {
        emitMockEvent(
          "notification:add",
          makeNotification({ id: `card-${i}`, title: `Card ${i}`, presentation: "card" })
        );
      }
      emitMockEvent(
        "notification:add",
        makeNotification({ id: "isl-survivor", title: "Survives", presentation: "island" })
      );
    });

    // Only the island item entered the store; the 6 cards were dropped at ingest.
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    expect(screen.getByText("Survives")).toBeInTheDocument();
    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();
  });

  it("hides the island window when it holds no island notification", async () => {
    const hideMock = tauriWindow.getCurrentWindow().hide;
    render(<IslandOverlay />);
    await waitFor(() => {
      expect(hideMock).toHaveBeenCalled();
    });
  });
});
