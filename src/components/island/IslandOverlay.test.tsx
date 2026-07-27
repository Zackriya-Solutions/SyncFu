import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { IslandOverlay } from "./IslandOverlay";
import { window as tauriWindow } from "@tauri-apps/api";
import { emitMockEvent, clearMockListeners } from "@/__mocks__/tauri-api";
import type { NotificationPayload } from "@/types/notification";
import type { IslandRow, IslandSnapshot } from "@/types/islandSnapshot";

// IslandOverlay is snapshot-driven (guard G10 / C1): its render comes ONLY from
// the Rust-owned `island:snapshot`, never the frontend notification store. These
// specs drive that event and assert the routing (count 0/1/>1) plus the C1
// divergence guard (a store `notification:add` must NOT reach the island).

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

function rowOf(n: NotificationPayload, hasWaiter = false): IslandRow {
  return { ...n, hasWaiter };
}

/** Build a snapshot the way the Rust manager would (badge formula included). */
function snapshotOf(notifs: NotificationPayload[]): IslandSnapshot {
  const rows = notifs.map((n) => rowOf(n));
  const count = notifs.length;
  const badgeLabel = count > 9 ? "9+" : String(count);
  const badgeWidth = 26 + 8 * (badgeLabel.length - 1);
  return {
    count,
    badgeLabel,
    badgeWidth,
    merged: 0,
    spotlight: rows[0] ?? null,
    rows,
  };
}

/** Render and flush the async snapshot/settings listener registration. */
async function mount() {
  render(<IslandOverlay />);
  await act(async () => {
    await Promise.resolve();
  });
}

function emitSnapshot(snapshot: IslandSnapshot) {
  act(() => emitMockEvent("island:snapshot", snapshot));
}

describe("IslandOverlay (snapshot-driven)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMockListeners();
  });

  afterEach(() => {
    clearMockListeners();
  });

  it("renders the island root container", async () => {
    await mount();
    expect(screen.getByTestId("island-root")).toBeInTheDocument();
  });

  it("count 1 -> single Island lifecycle (expanded card)", async () => {
    await mount();
    emitSnapshot(snapshotOf([makeNotification({ title: "Deploy?" })]));
    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();
    expect(screen.getByText("Deploy?")).toBeInTheDocument();
    // Not the Model B group.
    expect(screen.queryByTestId("island-group")).not.toBeInTheDocument();
  });

  it("count > 1 -> Model B group (spotlight + badge), not a single Island", async () => {
    await mount();
    emitSnapshot(
      snapshotOf([
        makeNotification({ id: "a", title: "First" }),
        makeNotification({ id: "b", title: "Second" }),
      ])
    );
    expect(screen.getByTestId("island-group")).toBeInTheDocument();
    expect(screen.getByTestId("island-badge")).toHaveTextContent("2");
    // No single expanded card in grouped mode (it starts as the compact spotlight).
    expect(screen.queryByTestId("island-expanded")).not.toBeInTheDocument();
  });

  it("C1 guard: a store notification:add does NOT drive the island; only the snapshot does", async () => {
    await mount();
    // A raw store add event must be ignored (IslandOverlay does not read the store).
    act(() => {
      emitMockEvent(
        "notification:add",
        makeNotification({ id: "store-only", title: "FromStore" })
      );
    });
    expect(screen.queryByText("FromStore")).not.toBeInTheDocument();
    expect(screen.queryByTestId("island-expanded")).not.toBeInTheDocument();

    // The authoritative snapshot IS the source of truth.
    emitSnapshot(snapshotOf([makeNotification({ id: "snap", title: "FromSnapshot" })]));
    expect(screen.getByText("FromSnapshot")).toBeInTheDocument();
  });

  it("count 0 -> hides the island window", async () => {
    const hideMock = tauriWindow.getCurrentWindow().hide;
    await mount();
    await waitFor(() => expect(hideMock).toHaveBeenCalled());
  });
});
