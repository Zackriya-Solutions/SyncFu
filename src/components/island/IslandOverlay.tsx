import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useNotifications } from "@/hooks/useNotifications";
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
  const { notifications } = useNotifications((n) => n.presentation === "island");

  // Transparent window background (same Cap pattern as the overlay panel).
  useEffect(() => {
    document.documentElement.setAttribute("data-transparent-window", "true");
    document.body.style.background = "transparent";
  }, []);

  const islandItems = notifications.filter((n) => n.presentation === "island");
  const current = islandItems[0];

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
    <div data-testid="island-root" className="island-root">
      {current && <Island key={current.id} notification={current} />}
    </div>
  );
}
