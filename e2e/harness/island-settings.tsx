// Playwright settings harness (T7b). Mounts the REAL IslandSettingsPanel next to
// a live Island, both bound to the shared island-settings store. Driving a panel
// control therefore restyles the live island exactly as it does in production -
// this is the "settings change -> live restyle, no restart/resend" path end to
// end. A window hook feeds honest capture-status states (the backend's job in
// production) so the spec can assert the panel renders each one.
import React from "react";
import { createRoot } from "react-dom/client";
import { IslandSettingsPanel } from "@/components/app/IslandSettingsPanel";
import { Island } from "@/components/island/Island";
import { useIslandSettingsStore } from "@/stores/islandSettingsStore";
import type { IslandCaptureStatus } from "@/types/islandSettings";
import type { NotificationPayload } from "@/types/notification";
import "@/styles/globals.css";
import "@/styles/app.css";
import "@/styles/overlay.css";
import "@/styles/island.css";

const NOTIFICATION: NotificationPayload = {
  id: "settings-fixture",
  sender: "claude-code",
  title: "Approval needed",
  body: "Run database migration 0042 before the deploy proceeds?",
  icon: "git-pull-request",
  priority: "normal",
  presentation: "island",
  timeout: "default",
  actions: [],
  createdAt: new Date().toISOString(),
};

// Test hook: drive the honest capture status the panel renders.
(window as unknown as {
  __setIslandCaptureStatus: (s: IslandCaptureStatus) => void;
}).__setIslandCaptureStatus = (s) =>
  useIslandSettingsStore.getState().setCaptureStatus(s);

const root = document.getElementById("root")!;
createRoot(root).render(
  <div style={{ display: "flex", gap: 32, padding: 24, alignItems: "flex-start" }}>
    <div id="panel-host" style={{ flex: "0 0 640px" }}>
      <IslandSettingsPanel />
    </div>
    <div id="island-host" style={{ flex: 1, position: "relative", minHeight: 200 }}>
      <Island notification={NOTIFICATION} state="expanded" />
    </div>
  </div>
);
