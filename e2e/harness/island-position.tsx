// Playwright position harness (T8). Mounts the REAL Island inside a `.island-root`
// per float position (left / center / right / bottom-center) so the baselines
// prove the D4 layout: the capsule anchors to the matching edge and bottom-center
// grows UPWARD from the bottom. Each root carries the SAME data-mode/data-position
// attributes IslandOverlay sets in production, so the ported CSS is what renders.
//
// The roots are sized fixed boxes here (the production root is position:fixed
// inset:0); the harness stylesheet overrides `.island-root` to relative boxes so
// the four positions sit side by side.
import React from "react";
import { createRoot } from "react-dom/client";
import { Island } from "@/components/island/Island";
import type { IslandPosition } from "@/types/islandSettings";
import type { NotificationPayload } from "@/types/notification";
import "@/styles/globals.css";
import "@/styles/overlay.css";
import "@/styles/island.css";

const NOW = new Date().toISOString();

const NOTIFICATION: NotificationPayload = {
  id: "fixture",
  sender: "claude-code",
  title: "Approval needed",
  body: "Run database migration 0042 before the deploy proceeds?",
  icon: "git-pull-request",
  priority: "normal",
  presentation: "island",
  timeout: "default",
  actions: [],
  createdAt: NOW,
};

const POSITIONS: readonly IslandPosition[] = ["left", "center", "right", "bottom-center"];

const root = document.getElementById("root")!;
for (const position of POSITIONS) {
  const cell = document.createElement("div");
  cell.className = "island-root pos-box";
  cell.id = `cell-${position}`;
  cell.dataset.mode = "float";
  cell.dataset.position = position;
  root.appendChild(cell);
  createRoot(cell).render(
    <React.StrictMode>
      <Island
        notification={NOTIFICATION}
        state="expanded"
        mode="float"
        position={position}
      />
    </React.StrictMode>
  );
}
