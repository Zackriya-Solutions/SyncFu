import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { event as tauriEvent, core } from "@tauri-apps/api";
import { useIslandSettingsStore } from "@/stores/islandSettingsStore";
import type { IslandSettings } from "@/types/islandSettings";
import type { IslandRow, IslandSnapshot } from "@/types/islandSnapshot";
import { EMPTY_ISLAND_SNAPSHOT } from "@/types/islandSnapshot";
import type { NotchGeometry } from "@/lib/islandMorph";
import { Island } from "./Island";
import { IslandGroup } from "./IslandGroup";

// Per-window host for the `island` webview. Its render is driven ENTIRELY by the
// Rust-owned `island:snapshot` (guard G10 / C1), NEVER by the frontend
// notification store. This is the ratchet that makes the store's independent
// queue (W1-W4 divergences, 85-verify A3) irrelevant by construction: this
// component does not import `useNotifications`, so it cannot re-derive rank,
// dedupe, count or spotlight - it renders only what the manager hands it.
//
// Two paths into the snapshot (mirroring the settings pattern, closes W3):
//   1. creation read - `get_island_snapshot` on mount, so a window that starts
//      AFTER notifications exist reconciles immediately (no undercount);
//   2. live change - the `island:snapshot` event on every manager change.
//
// Routing (D5):
//   count 0  -> hide the window (mirrors the overlay's hide-when-empty).
//   count 1  -> the SINGLE-notification lifecycle: render <Island> exactly as
//               before (T4b/T5a/T5b untouched). Data source is the snapshot
//               spotlight, but the notification and lifecycle are identical.
//   count >1 -> Model B: <IslandGroup> (spotlight + xN badge -> expanded list).

export function IslandOverlay() {
  const setSettings = useIslandSettingsStore((s) => s.setSettings);
  const [snapshot, setSnapshot] = useState<IslandSnapshot>(EMPTY_ISLAND_SNAPSHOT);
  // Physical notch cutout geometry (T13): creation read + live `island:geometry` event. Null on
  // non-notch / non-macOS displays -> Island keeps the float layout.
  const [notchGeometry, setNotchGeometry] = useState<NotchGeometry | null>(null);
  // Backend hover-reveal signal (T13, `island:reveal`): true while the physical notch (or the pill)
  // is hovered. Governs the collapsed under-notch pill's visibility; the backend owns the state
  // machine (notch-region + grace), so the frontend only mirrors the boolean it emits.
  const [notchHover, setNotchHover] = useState(false);
  // Backend pill/card-hover signal (T17, `island:hover`): true while the cursor is over the visible
  // island shape. Pauses the single Island's auto-dismiss while hovered, matching the card's JS
  // hover-pause. Distinct from `notchHover`, which governs only the notch-region reveal.
  const [hovered, setHovered] = useState(false);

  // Push the settled shape bounds to the backend as the click-through hitbox (BUG B). Reported on
  // morph settle (via Island's onSettle) so the cursor tracker can make the shown capsule
  // interactive; the envelope around it stays click-through.
  const reportHitbox = useCallback(
    (rect: { x: number; y: number; w: number; h: number }) => {
      core.invoke("set_island_hitbox", rect).catch((err) =>
        console.error("[syncfu] set_island_hitbox failed:", err)
      );
    },
    []
  );

  // Island action path == card action path (T5a parity, no new transport): fire
  // the row's primary action via `action_callback` -> WaiterRegistry.notify ->
  // CLI exit 0. Each row maps 1:1 to its own id/waiter (A4).
  const handleAction = useCallback((notificationId: string, actionId: string) => {
    core.invoke("action_callback", { notificationId, actionId }).catch((err) =>
      console.error("[syncfu] action_callback failed:", err)
    );
  }, []);

  // Dismiss a notification on the backend (auto-dismiss + row/close). Mirrors the
  // card's exit-1 path: dismiss_notification -> waiter Dismissed. Snapshot-driven,
  // so we never touch the frontend store (C1).
  const handleDismiss = useCallback((id: string) => {
    core.invoke("dismiss_notification", { id }).catch((err) =>
      console.error("[syncfu] dismiss_notification failed:", err)
    );
  }, []);

  // Clear every active notification (T15, the list "Clear all"). Uses the
  // registered `dismiss_all` command rather than a per-row loop over snapshot.rows:
  // the loop would only dismiss the visible survivors and leave MERGED duplicates
  // behind (dedupe re-promotes the next-ranked duplicate into a row, so the list
  // would not empty in one pass - manager.rs `merged = count - rows.len()`).
  // dismiss_all clears the manager atomically and resolves every waiter as
  // Dismissed (exit 1). Tradeoff (documented): it also clears any top-right CARD
  // notifications, acceptable for a deliberate bulk "Clear all".
  const handleClearAll = useCallback(() => {
    core.invoke("dismiss_all").catch((err) =>
      console.error("[syncfu] dismiss_all failed:", err)
    );
  }, []);

  // A Model B row action: fire the primary action if present, else dismiss. This
  // resolves exactly that row's waiter (never crosses ids - A4).
  const handleRowAction = useCallback(
    (row: IslandRow) => {
      if (row.actions.length > 0) handleAction(row.id, row.actions[0].id);
      else handleDismiss(row.id);
    },
    [handleAction, handleDismiss]
  );

  // Transparent window background (same pattern as the overlay panel).
  useEffect(() => {
    document.documentElement.setAttribute("data-transparent-window", "true");
    document.body.style.background = "transparent";
  }, []);

  // Snapshot: creation read + live event (the ONLY render data source).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    (async () => {
      try {
        const initial = await core.invoke<IslandSnapshot>("get_island_snapshot");
        if (active && initial) setSnapshot(initial);
      } catch {
        // No backend (browser harness): keep the empty snapshot.
      }
      unlisten = await tauriEvent.listen<IslandSnapshot>("island:snapshot", (ev) => {
        setSnapshot(ev.payload as IslandSnapshot);
      });
      if (!active) unlisten?.();
    })();
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  // Island settings: creation read + live `island:settings` event (T7b). Both
  // funnel through the store, which Island/IslandGroup subscribe to.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    (async () => {
      try {
        const persisted = await core.invoke<IslandSettings>("get_island_settings");
        if (active && persisted) setSettings(persisted);
      } catch {
        // No backend (browser harness) or read failure: keep the store defaults.
      }
      unlisten = await tauriEvent.listen<IslandSettings>("island:settings", (ev) => {
        setSettings(ev.payload as IslandSettings);
      });
      if (!active) unlisten?.();
    })();
    return () => {
      active = false;
      unlisten?.();
    };
  }, [setSettings]);

  // Notch geometry: creation read + live event (mirrors the snapshot/settings pattern).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    (async () => {
      try {
        const initial = await core.invoke<NotchGeometry | null>("get_notch_geometry");
        if (active) setNotchGeometry(initial ?? null);
      } catch {
        // No backend (browser harness) or non-notch: keep null (float layout).
      }
      unlisten = await tauriEvent.listen<NotchGeometry | null>("island:geometry", (ev) => {
        setNotchGeometry((ev.payload as NotchGeometry | null) ?? null);
      });
      if (!active) unlisten?.();
    })();
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  // Hover-reveal signal (T13): the backend emits `island:reveal` (bool) when the notch-region hover
  // state flips. No creation read - a freshly shown island starts concealed and the first hover
  // reveals it (an arrival announces EXPANDED, which is always visible regardless of this flag).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    (async () => {
      try {
        unlisten = await tauriEvent.listen<boolean>("island:reveal", (ev) => {
          setNotchHover(!!ev.payload);
        });
      } catch {
        // No backend (browser harness): keep concealed default; float mode ignores it anyway.
      }
      if (!active) unlisten?.();
    })();
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  // Hover signal (T17): the backend emits `island:hover` (bool) when the cursor enters/leaves the
  // visible shape. No creation read - a freshly shown island starts un-hovered.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    (async () => {
      try {
        unlisten = await tauriEvent.listen<boolean>("island:hover", (ev) => {
          setHovered(!!ev.payload);
        });
      } catch {
        // No backend (browser harness): keep the un-hovered default.
      }
      if (!active) unlisten?.();
    })();
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const { mode, position } = useIslandSettingsStore((s) => s.settings);
  const layoutPosition = mode === "float" ? position : "center";

  // Hide the island window when it holds no island notification (D3: never resize
  // the envelope, only show/hide). ALSO reset notchHover: the backend's
  // stop_tracking resets its reveal machine SILENTLY (no island:reveal false), so
  // a hover that was live when the last notification ended would otherwise leak
  // into the NEXT notification's collapse and reveal the pill with the cursor
  // nowhere near the notch (T13 review MEDIUM). A freshly shown island must start
  // concealed.
  useEffect(() => {
    if (snapshot.count === 0) {
      setNotchHover(false);
      setHovered(false);
      getCurrentWindow().hide();
    }
  }, [snapshot.count]);

  const single = snapshot.count === 1 ? snapshot.spotlight : null;

  return (
    <div
      data-testid="island-root"
      className="island-root"
      data-mode={mode}
      data-position={layoutPosition}
    >
      {single && (
        <Island
          key={single.id}
          notification={single}
          onAction={handleAction}
          onDismiss={handleDismiss}
          notchGeometry={notchGeometry}
          notchHover={notchHover}
          hovered={hovered}
          onSettle={reportHitbox}
        />
      )}
      {snapshot.count > 1 && (
        <IslandGroup
          snapshot={snapshot}
          onRowAction={handleRowAction}
          onDismiss={handleDismiss}
          onClearAll={handleClearAll}
          notchGeometry={notchGeometry}
          onSettle={reportHitbox}
        />
      )}
    </div>
  );
}
