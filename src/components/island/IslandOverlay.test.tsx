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

  it("ingests island notifications through the shared store (invariant e)", async () => {
    // Single ingest: the island reuses useNotifications -> notificationStore,
    // the same path the card uses. History persistence is backend-side
    // (manager.add), presentation-agnostic, so a notification reaching this
    // store is proof it flowed through the shared ingest.
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

  it("hides the island window when it holds no island notification", async () => {
    const hideMock = tauriWindow.getCurrentWindow().hide;
    render(<IslandOverlay />);
    await waitFor(() => {
      expect(hideMock).toHaveBeenCalled();
    });
  });
});
