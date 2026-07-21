// Playwright lifecycle harness (T5b). Mounts one REAL Island (controlled state,
// like the morph harness) plus hooks to (1) drive a full-motion morph, (2)
// re-present a NEW distinct notification mid-morph (latest-wins, via key remount),
// and (3) apply an in-place progress update to the current item. Backs the two
// lifecycle e2e specs: mid-morph new-notification (frame never resizes, mid-flight
// captured) and progress-after-collapse freshness.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Island, type IslandState } from "@/components/island/Island";
import type { NotificationPayload } from "@/types/notification";
import "@/styles/globals.css";
import "@/styles/overlay.css";
import "@/styles/island.css";

const NOW = new Date().toISOString();

const FIXTURE_A: NotificationPayload = {
  id: "life-a",
  sender: "claude-code",
  title: "Building project",
  body: "Compiling 428 modules",
  icon: "package",
  priority: "normal",
  presentation: "island",
  // `never` -> no auto-dismiss countdown animation racing the settle flag.
  timeout: "never",
  actions: [],
  progress: { value: 0.2, style: "bar" },
  createdAt: NOW,
};

interface Hooks {
  __setState: (s: IslandState) => void;
  __present: (p: Partial<NotificationPayload>) => void;
  __update: (p: Partial<NotificationPayload>) => void;
}

function Harness() {
  const [notif, setNotif] = useState<NotificationPayload>(FIXTURE_A);
  const [state, setState] = useState<IslandState>("compact");

  useEffect(() => {
    const w = window as unknown as Hooks;
    w.__setState = (s) => setState(s);
    // present: a NEW id remounts (key change) -> snap to the current controlled
    // state, i.e. a clean latest-wins re-present, never a half-morph.
    w.__present = (p) => setNotif((n) => ({ ...n, ...p }));
    // update: same id -> in-place re-render (progress/body), no remount.
    w.__update = (p) => setNotif((n) => ({ ...n, ...p }));
  }, []);

  return (
    <div className="island-root" data-testid="island-root">
      <Island key={notif.id} notification={notif} state={state} />
    </div>
  );
}

const root = document.getElementById("root")!;
createRoot(root).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>
);
