import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHistoryIngest } from "./useHistoryIngest";
import { useHistoryStore } from "@/stores/historyStore";
import { event as tauriEvent } from "@tauri-apps/api";
import { emitMockEvent, clearMockListeners } from "@/__mocks__/tauri-api";
import type { NotificationPayload } from "@/types/notification";

function makeNotification(
  overrides: Partial<NotificationPayload> = {}
): NotificationPayload {
  return {
    id: "n-1",
    sender: "ci-pipeline",
    title: "Build Complete",
    body: "All tests passed",
    priority: "normal",
    timeout: "default",
    actions: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("useHistoryIngest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMockListeners();
    useHistoryStore.getState().reset();
  });

  afterEach(() => {
    clearMockListeners();
  });

  it("subscribes to history:add on mount", async () => {
    renderHook(() => useHistoryIngest());

    await vi.waitFor(() => {
      expect(tauriEvent.listen).toHaveBeenCalledWith(
        "history:add",
        expect.any(Function)
      );
    });
  });

  it("records a card notification (card-history)", async () => {
    renderHook(() => useHistoryIngest());
    await vi.waitFor(() => expect(tauriEvent.listen).toHaveBeenCalled());

    act(() => {
      emitMockEvent(
        "history:add",
        makeNotification({ id: "card-1", presentation: "card", title: "Card one" })
      );
    });

    const entries = useHistoryStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("card-1");
    expect(entries[0].title).toBe("Card one");
  });

  it("records an island notification (history-includes-island)", async () => {
    renderHook(() => useHistoryIngest());
    await vi.waitFor(() => expect(tauriEvent.listen).toHaveBeenCalled());

    act(() => {
      emitMockEvent(
        "history:add",
        makeNotification({ id: "island-1", presentation: "island", title: "Island one" })
      );
    });

    const entries = useHistoryStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("island-1");
    expect(entries[0].title).toBe("Island one");
  });

  it("records both presentations through the one ingest (single ingest, two presentations)", async () => {
    renderHook(() => useHistoryIngest());
    await vi.waitFor(() => expect(tauriEvent.listen).toHaveBeenCalled());

    act(() => {
      emitMockEvent(
        "history:add",
        makeNotification({ id: "c", presentation: "card" })
      );
      emitMockEvent(
        "history:add",
        makeNotification({ id: "i", presentation: "island" })
      );
    });

    // Newest first: island was recorded after the card.
    expect(useHistoryStore.getState().entries.map((e) => e.id)).toEqual(["i", "c"]);
  });

  it("records a legacy payload with no presentation field (old-client compat)", async () => {
    renderHook(() => useHistoryIngest());
    await vi.waitFor(() => expect(tauriEvent.listen).toHaveBeenCalled());

    const legacy = makeNotification({ id: "legacy-1" });
    delete (legacy as { presentation?: unknown }).presentation;

    act(() => {
      emitMockEvent("history:add", legacy);
    });

    expect(useHistoryStore.getState().entries).toHaveLength(1);
    expect(useHistoryStore.getState().entries[0].id).toBe("legacy-1");
  });

  it("does not double-record the same notification id (double-ingest guard)", async () => {
    renderHook(() => useHistoryIngest());
    await vi.waitFor(() => expect(tauriEvent.listen).toHaveBeenCalled());

    const payload = makeNotification({ id: "same" });
    act(() => {
      emitMockEvent("history:add", payload);
      emitMockEvent("history:add", payload);
    });

    expect(useHistoryStore.getState().entries).toHaveLength(1);
  });

  it("ignores a payload with no id", async () => {
    renderHook(() => useHistoryIngest());
    await vi.waitFor(() => expect(tauriEvent.listen).toHaveBeenCalled());

    act(() => {
      emitMockEvent("history:add", { sender: "x", title: "no id" });
    });

    expect(useHistoryStore.getState().entries).toHaveLength(0);
  });

  it("maps group to groupKey and serializes actions", async () => {
    renderHook(() => useHistoryIngest());
    await vi.waitFor(() => expect(tauriEvent.listen).toHaveBeenCalled());

    act(() => {
      emitMockEvent(
        "history:add",
        makeNotification({
          id: "g",
          group: "ci-builds",
          actions: [{ id: "ok", label: "OK", style: "primary" }],
        })
      );
    });

    const entry = useHistoryStore.getState().entries[0];
    expect(entry.groupKey).toBe("ci-builds");
    expect(entry.actionsJson).toContain("ok");
  });

  it("cleans up the listener on unmount", async () => {
    const { unmount } = renderHook(() => useHistoryIngest());
    await vi.waitFor(() => expect(tauriEvent.listen).toHaveBeenCalled());

    unmount();

    // Events after unmount must not reach the store.
    act(() => {
      emitMockEvent("history:add", makeNotification({ id: "after-unmount" }));
    });

    expect(useHistoryStore.getState().entries).toHaveLength(0);
  });
});
