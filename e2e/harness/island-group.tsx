// Playwright Model B harness (T6). Mounts the REAL IslandGroup with pre-built
// snapshot fixtures - exactly the shape the Rust manager emits (rank/dedupe/count
// are Rust-owned; the frontend is a dumb renderer, so the harness provides the
// snapshot verbatim). Baselines here are DELIBERATE NEW references for the
// compact-grouped badge widths and the expanded ranked list (6-row cap + scroll +
// fade + stagger), vs the mockup's Model B stage.
import React from "react";
import { createRoot } from "react-dom/client";
import { IslandGroup } from "@/components/island/IslandGroup";
import type { NotificationPayload } from "@/types/notification";
import type { IslandRow, IslandSnapshot } from "@/types/islandSnapshot";
import "@/styles/globals.css";
import "@/styles/overlay.css";
import "@/styles/island.css";

const NOW = new Date().toISOString();

function row(overrides: Partial<IslandRow>): IslandRow {
  const base: NotificationPayload = {
    id: "r",
    sender: "ci",
    title: "Build",
    body: "",
    icon: "git-pull-request",
    priority: "normal",
    presentation: "island",
    timeout: "default",
    actions: [],
    createdAt: NOW,
  };
  return { ...base, hasWaiter: false, ...overrides };
}

/** Badge width mirrors the Rust formula (26 + 8*(digits-1), caps "9+"). */
function snapshot(rows: IslandRow[], count: number): IslandSnapshot {
  const badgeLabel = count > 9 ? "9+" : String(count);
  return {
    count,
    badgeLabel,
    badgeWidth: 26 + 8 * (badgeLabel.length - 1),
    merged: count - rows.length,
    spotlight: rows[0] ?? null,
    rows,
  };
}

const SPOT = row({ id: "spot", sender: "deploy-bot", title: "Deploy awaiting approval", priority: "high" });

// Eight distinct, pre-ranked rows for the expanded list (8 > 6 -> scroll + fade).
const LIST_ROWS: IslandRow[] = [
  row({ id: "c1", sender: "pagerduty", title: "production is down", priority: "critical", icon: "triangle-alert" }),
  row({ id: "h1", sender: "deploy-bot", title: "deploy awaiting approval", priority: "high", icon: "rocket" }),
  row({ id: "h2", sender: "ci", title: "CI pipeline failing", priority: "high", icon: "alert" }),
  row({ id: "n1", sender: "github", title: "review requested on #482", priority: "normal", icon: "git-pull-request" }),
  row({ id: "n2", sender: "linear", title: "assigned you an issue", priority: "normal", icon: "bell" }),
  row({ id: "n3", sender: "slack", title: "new mention in #eng", priority: "normal", icon: "bell" }),
  row({ id: "l1", sender: "github", title: "starred your repo", priority: "low", icon: "star" }),
  row({ id: "l2", sender: "github", title: "started following you", priority: "low", icon: "user" }),
];

interface Fixture {
  readonly id: string;
  readonly snapshot: IslandSnapshot;
}

const FIXTURES: readonly Fixture[] = [
  // Compact spotlight badge widths: 2 (26px), 10 -> "9+" (34px), 100 -> "9+".
  { id: "compact-2", snapshot: snapshot([SPOT, row({ id: "b" })], 2) },
  { id: "compact-10", snapshot: snapshot([SPOT, row({ id: "b" })], 10) },
  { id: "compact-100", snapshot: snapshot([SPOT, row({ id: "b" })], 100) },
  // Expanded ranked list (the spec expands this cell before shooting).
  { id: "list", snapshot: snapshot(LIST_ROWS, 8) },
];

const noop = () => {};
const root = document.getElementById("root")!;
for (const fx of FIXTURES) {
  const cell = document.createElement("div");
  cell.className = "cell";
  cell.id = `cell-${fx.id}`;
  root.appendChild(cell);
  createRoot(cell).render(
    <React.StrictMode>
      <IslandGroup
        snapshot={fx.snapshot}
        onRowAction={noop}
        onDismiss={noop}
        onClearAll={noop}
      />
    </React.StrictMode>
  );
}
