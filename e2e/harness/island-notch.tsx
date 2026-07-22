// T13/T14 under-notch harness: the REAL Island in notch mode with the G1 hardware
// cutout geometry (183 x 32), plus a black rectangle overlaying the exact cutout
// position. Cells cover the three under-notch render states: the AMBIENT wings
// indicator (collapsed + not hovered, T14) whose accent hint peeks in the right
// wing beside the cutout; the hover-REVEALED compact pill offset BELOW the cutout;
// and the expanded card below the cutout. The spec proves the pill/card content
// never renders behind the cutout, and the ambient hint never hides behind it
// either (the leaf-measurement wall-audit technique).
import React from "react";
import { createRoot } from "react-dom/client";
import { Island } from "@/components/island/Island";
import type { NotchGeometry } from "@/lib/islandMorph";
import type { NotificationPayload } from "@/types/notification";
import "@/styles/globals.css";
import "@/styles/overlay.css";
import "@/styles/island.css";

// G1 measured a 183pt-wide, 32pt-tall physical cutout on real hardware.
const G1: NotchGeometry = { widthLogical: 183, heightLogical: 32 };
const NOW = new Date().toISOString();

function base(overrides: Partial<NotificationPayload>): NotificationPayload {
  return {
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
    ...overrides,
  };
}

interface Cell {
  readonly id: string;
  readonly state: "compact" | "expanded";
  /** Mirrors the backend `island:reveal` signal: true == hovering, so the pill is revealed;
   *  false == collapsed and not hovered, so the ambient wings indicator shows (T14). */
  readonly notchHover: boolean;
  readonly notification: NotificationPayload;
}

const CELLS: readonly Cell[] = [
  // Ambient (collapsed, NOT hovered) -> the minimal wings indicator with a priority-accent DOT in
  // the right wing peeking beside the cutout; no content behind the cutout (T14). High priority so
  // the accent color is unambiguous.
  {
    id: "ambient",
    state: "compact",
    notchHover: false,
    notification: base({ sender: "claude-code", priority: "high" }),
  },
  // Compact + hovering -> the REVEALED pill. WITH progress the trailing live-activity is present
  // (its ~50px is the widest content that must clear the cutout below it).
  {
    id: "compact",
    state: "compact",
    notchHover: true,
    notification: base({
      sender: "claude-code · building",
      progress: { value: 0.62, style: "bar" },
    }),
  },
  // Expanded -> the icon/title/body row must start BELOW the 32pt cutout.
  { id: "expanded", state: "expanded", notchHover: true, notification: base({}) },
];

const root = document.getElementById("root")!;
for (const c of CELLS) {
  const cell = document.createElement("div");
  cell.className = "cell";
  cell.id = `cell-${c.id}`;

  // The stage centers the island under a top-center cutout, mimicking the OS
  // envelope: the island top-aligns to the stage top (= cutout top) and centers
  // horizontally (= cutout center).
  const stage = document.createElement("div");
  stage.className = "stage";

  const cutout = document.createElement("div");
  cutout.className = "cutout";
  cutout.setAttribute("data-testid", "cutout");
  cutout.style.width = `${G1.widthLogical}px`;
  cutout.style.height = `${G1.heightLogical}px`;
  stage.appendChild(cutout);

  const mount = document.createElement("div");
  mount.className = "mount";
  stage.appendChild(mount);

  cell.appendChild(stage);
  root.appendChild(cell);

  createRoot(mount).render(
    <React.StrictMode>
      <Island
        notification={c.notification}
        state={c.state}
        mode="notch"
        notchGeometry={G1}
        notchHover={c.notchHover}
      />
    </React.StrictMode>
  );
}
