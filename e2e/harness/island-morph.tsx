// Playwright morph harness (T4b). Mounts a single REAL Island (controlled by a
// wrapper's state) and exposes window hooks so the spec can drive a FULL-MOTION
// compact<->expanded morph and wait on the mandated settle flag. This is the
// live spring loop (islandMorph.ts) end to end, not the static T4a render.
//
// Determinism: the spec waits on window.__islandSettled (springs at eps-rest,
// snapped exactly to target), so the settled screenshot is identical every run
// regardless of frame timing - that is what the 20x zero-variance test proves.
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Island, type IslandHandle, type IslandState } from "@/components/island/Island";
import type { NotificationPayload } from "@/types/notification";
import "@/styles/globals.css";
import "@/styles/overlay.css";
import "@/styles/island.css";

const NOW = new Date().toISOString();

const FIXTURE: NotificationPayload = {
  id: "morph-fixture",
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

function Harness() {
  // Controlled state: no auto-collapse timer races the spec. State changes still
  // run the animated morph (only the FIRST mount snaps).
  const [state, setState] = useState<IslandState>("compact");
  const ref = useRef<IslandHandle>(null);
  useEffect(() => {
    (window as unknown as { __setIslandState: (s: IslandState) => void }).__setIslandState =
      (s) => setState(s);
  }, []);
  return <Island ref={ref} notification={FIXTURE} state={state} />;
}

const root = document.getElementById("root")!;
createRoot(root).render(<Harness />);
