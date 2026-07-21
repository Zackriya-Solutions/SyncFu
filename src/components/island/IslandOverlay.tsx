import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useNotifications } from "@/hooks/useNotifications";
import { Island } from "./Island";

// Per-window host for the `island` webview. Reuses the SAME `useNotifications`
// ingest as the overlay (single ingest, two renderers; R-HISTORY / invariant e):
// backend `manager.add()` writes history for BOTH presentations before routing,
// so nothing about history is island-specific here.
//
// Event routing (from T3): island `notification:add` arrives via
// `emit_to("island", ...)`; `card` adds are broadcast and ALSO reach this window,
// so we filter `presentation === "island"` as defense in depth (guard G1: the
// island renders island items only, never card items).

export function IslandOverlay() {
  const { notifications } = useNotifications();

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

  return (
    <div data-testid="island-root" className="island-root">
      {current && <Island notification={current} state="expanded" />}
    </div>
  );
}
