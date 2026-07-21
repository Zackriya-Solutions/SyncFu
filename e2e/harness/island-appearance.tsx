// Playwright appearance harness (T8). Mounts the REAL Island in dark / light /
// auto appearances plus a light FLOAT compact pill, so the visual baselines prove
// the D4 appearance rules: light re-skins the expanded card + float pill, the
// notch compact pill stays pure black, and auto follows prefers-color-scheme.
//
// Appearance/mode come in as PROPS (not the singleton store) so every cell renders
// its own appearance side by side under one store. The `auto` cell reads the live
// prefers-color-scheme; the spec flips the emulated OS scheme to prove it follows.
import React from "react";
import { createRoot } from "react-dom/client";
import { Island } from "@/components/island/Island";
import type {
  IslandAppearance,
  IslandMode,
} from "@/types/islandSettings";
import type { NotificationPayload } from "@/types/notification";
import "@/styles/globals.css";
import "@/styles/overlay.css";
import "@/styles/island.css";

const NOW = new Date().toISOString();

function base(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
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

interface Fixture {
  readonly id: string;
  readonly state: "compact" | "expanded";
  readonly appearance: IslandAppearance;
  readonly mode: IslandMode;
}

const FIXTURES: readonly Fixture[] = [
  { id: "dark-expanded", state: "expanded", appearance: "dark", mode: "notch" },
  { id: "light-expanded", state: "expanded", appearance: "light", mode: "notch" },
  { id: "auto-expanded", state: "expanded", appearance: "auto", mode: "notch" },
  // Light appearance also lightens the FLOAT compact pill (#e9e9ee); the notch
  // compact pill stays black even in light (asserted structurally in the spec).
  { id: "light-float-pill", state: "compact", appearance: "light", mode: "float" },
  { id: "light-notch-compact", state: "compact", appearance: "light", mode: "notch" },
];

const root = document.getElementById("root")!;
for (const fx of FIXTURES) {
  const cell = document.createElement("div");
  cell.className = "cell";
  cell.id = `cell-${fx.id}`;
  root.appendChild(cell);
  createRoot(cell).render(
    <React.StrictMode>
      <Island
        notification={base()}
        state={fx.state}
        appearance={fx.appearance}
        mode={fx.mode}
      />
    </React.StrictMode>
  );
}
