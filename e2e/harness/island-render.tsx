// Playwright render harness for the REAL island React components (T4a). Unlike
// island.ts (which snapshots the T2 shape modules), this mounts Island.tsx +
// IslandExpanded/IslandCompact with fixtures so the visual baselines exercise
// the actual component tree, styleVars wiring, and wall insets.
//
// NOTCH-OVERHANG CHECK (T3 observation): the `expanded-tall` fixture is a
// near-max-height card. It confirms our layout grows DOWNWARD from a top-aligned
// origin and applies no overflow:hidden, so a tall card at screen-top is never
// clipped by our own layout. The residual physical-notch band (top-center) is a
// window-placement concern (T3 anchor / T5b), not T4a static content; the black
// shape shoulders + charcoal surface visually merge with the notch there.
import React from "react";
import { createRoot } from "react-dom/client";
import { Island } from "@/components/island/Island";
import type { NotificationPayload, StyleOverrides } from "@/types/notification";
import "@/styles/globals.css";
import "@/styles/overlay.css";
import "@/styles/island.css";

// Fixed timestamp text is deterministic ("just now") because createdAt is now.
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

// All 27 --s-* overrides, to prove the shared styleVars map resolves in the
// island exactly as it does on the card (invariant c).
const STYLE_27: StyleOverrides = {
  accentColor: "#c084fc",
  cardBg: "rgba(30,12,45,0.96)",
  cardBorderRadius: "20px",
  iconColor: "#f0abfc",
  iconBg: "rgba(192,132,252,0.18)",
  iconBorderColor: "rgba(192,132,252,0.35)",
  titleColor: "#fdf4ff",
  titleFontSize: "14px",
  bodyColor: "#e9d5ff",
  bodyFontSize: "12.5px",
  senderColor: "#d8b4fe",
  timeColor: "#c4b5fd",
  btnBg: "#7c3aed",
  btnColor: "#ffffff",
  btnBorderColor: "#8b5cf6",
  btn2Bg: "rgba(255,255,255,0.08)",
  btn2Color: "#f5f3ff",
  btn2BorderColor: "rgba(255,255,255,0.14)",
  dangerBg: "#ef4444",
  dangerColor: "#ffffff",
  dangerBorderColor: "rgba(0,0,0,0.1)",
  progressColor: "#c084fc",
  progressTrackColor: "rgba(255,255,255,0.1)",
  countdownColor: "#c084fc",
  closeBg: "rgba(255,255,255,0.08)",
  closeColor: "#e9d5ff",
  closeBorderColor: "rgba(255,255,255,0.14)",
};

const LONG_BODY =
  "Deploying commit a1b2c3d to production. This will run three pending database " +
  "migrations, restart the API workers, and invalidate the edge cache. Confirm " +
  "to proceed or dismiss to hold the release for manual review.";

interface Fixture {
  readonly id: string;
  readonly state: "compact" | "expanded";
  readonly notification: NotificationPayload;
}

const FIXTURES: readonly Fixture[] = [
  { id: "compact", state: "compact", notification: base({ sender: "claude-code · running" }) },
  { id: "expanded-basic", state: "expanded", notification: base({}) },
  {
    id: "expanded-rich-body",
    state: "expanded",
    notification: base({ title: "Release gate", body: LONG_BODY, icon: "rocket" }),
  },
  {
    id: "expanded-critical",
    state: "expanded",
    notification: base({
      priority: "critical",
      sender: "deploy-bot",
      title: "Production incident",
      body: "Error rate spiked to 12% after the 14:03 deploy. Rollback recommended.",
      icon: "triangle-alert",
    }),
  },
  {
    id: "expanded-styled-27",
    state: "expanded",
    notification: base({ title: "Custom theme", style: STYLE_27 }),
  },
  {
    // Near-max-height card for the notch-overhang check.
    id: "expanded-tall",
    state: "expanded",
    notification: base({ title: "Long release notes", body: LONG_BODY + " " + LONG_BODY, icon: "rocket" }),
  },
];

const root = document.getElementById("root")!;
for (const fx of FIXTURES) {
  const cell = document.createElement("div");
  cell.className = "cell";
  cell.id = `cell-${fx.id}`;
  root.appendChild(cell);
  createRoot(cell).render(
    <React.StrictMode>
      <Island notification={fx.notification} state={fx.state} />
    </React.StrictMode>
  );
}
