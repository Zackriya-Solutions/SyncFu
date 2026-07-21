import { useCallback, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { event as tauriEvent, core } from "@tauri-apps/api";
import { useNotifications } from "@/hooks/useNotifications";
import { useIslandSettingsStore } from "@/stores/islandSettingsStore";
import type { IslandSettings } from "@/types/islandSettings";
import { Island } from "./Island";

// Per-window host for the `island` webview. Reuses the SAME `useNotifications`
// ingest as the overlay (single ingest, two renderers): whatever history wiring
// lands applies to both presentations at that shared ingest, not here.
//
// History status (honest state): history persistence is a T10 concern and is
// currently UNWIRED for every presentation - `historyStore.prependEntry` has no
// production caller and backend `manager.add()` writes no history. The island is
// not special: once history is wired at the shared ingest, the island inherits it
// for free. Do NOT wire history in this component.
//
// Event routing (from T3): island `notification:add` arrives via
// `emit_to("island", ...)`. As defense in depth we ingest only island items (see
// the `useNotifications` predicate below) and additionally filter the render to
// `presentation === "island"` (guard G1: the island renders island items only).

export function IslandOverlay() {
  // Ingest ONLY island items into this window's shared store. Broadcast `card`
  // adds reach this window too; dropping them at ingest keeps them from consuming
  // MAX_VISIBLE slots and starving an island notification into the queue.
  const { notifications, dismiss } = useNotifications((n) => n.presentation === "island");
  const setSettings = useIslandSettingsStore((s) => s.setSettings);

  // Island action path == card action path (T5a parity, no new transport): a
  // button click drives the SAME `action_callback` command ->
  // WaiterRegistry.notify -> CLI exit 0. Mirrors NotificationOverlay.handleAction.
  const handleAction = useCallback((notificationId: string, actionId: string) => {
    core.invoke("action_callback", { notificationId, actionId }).catch((err) =>
      console.error("[syncfu] action_callback failed:", err)
    );
  }, []);

  // Transparent window background (same Cap pattern as the overlay panel).
  useEffect(() => {
    document.documentElement.setAttribute("data-transparent-window", "true");
    document.body.style.background = "transparent";
  }, []);

  // Island settings, two independent paths into the store (T7b, invariant b):
  //   1. creation read - fetch the persisted settings once so a change made
  //      BEFORE this window existed is honored on the first paint;
  //   2. live change - the `island:settings` event (emitted by the backend on
  //      set_island_settings) restyles the live island with no restart/resend.
  // Island.tsx subscribes to the store, so both paths converge there. A dropped
  // event cannot pin stale geometry forever: the next event (or the next window
  // creation) re-reads the truth.
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

  const islandItems = notifications.filter((n) => n.presentation === "island");
  const current = islandItems[0];

  // Float position drives where the capsule sits inside the transparent envelope
  // (the Rust window anchor moves the frame to the matching monitor edge). Notch
  // mode ignores position entirely (invariant e) - force top-center there. The
  // capsule fill/shape/appearance still come from the store inside Island; this
  // root only lays the capsule out (alignment + bottom-anchor).
  const { mode, position } = useIslandSettingsStore((s) => s.settings);
  const layoutPosition = mode === "float" ? position : "center";

  // Hide the island window when it holds no island notification, mirroring the
  // overlay's hide-when-empty. The fixed envelope is NEVER resized (D3), so
  // there is no content-driven setSize here - only show/hide.
  useEffect(() => {
    if (!current) {
      getCurrentWindow().hide();
    }
  }, [current]);

  // Uncontrolled Island runs the ratified lifecycle: arrive EXPANDED, then
  // auto-collapse to the compact pill (OQ-2). `key={current.id}` restarts that
  // entry transition for each new notification. The window frame never resizes
  // (D3); only the inner island morphs.
  return (
    <div
      data-testid="island-root"
      className="island-root"
      data-mode={mode}
      data-position={layoutPosition}
    >
      {current && (
        <Island
          key={current.id}
          notification={current}
          onAction={handleAction}
          onDismiss={dismiss}
        />
      )}
    </div>
  );
}
