// Playwright bottom-center morph harness (T8). A single driveable Island in a
// bottom-center `.island-root`, exposing the same __setIslandState / __islandSettled
// hooks as island-morph so the spec can drive a FULL-MOTION compact->expanded morph
// and assert the bottom edge stays put (the capsule grows UPWARD) mid-morph.
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Island, type IslandHandle, type IslandState } from "@/components/island/Island";
import type { NotificationPayload } from "@/types/notification";
import "@/styles/globals.css";
import "@/styles/overlay.css";
import "@/styles/island.css";

const NOW = new Date().toISOString();

const FIXTURE: NotificationPayload = {
  id: "bc-fixture",
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
  const [state, setState] = useState<IslandState>("compact");
  const ref = useRef<IslandHandle>(null);
  useEffect(() => {
    (window as unknown as { __setIslandState: (s: IslandState) => void }).__setIslandState =
      (s) => setState(s);
  }, []);
  return (
    <Island
      ref={ref}
      notification={FIXTURE}
      state={state}
      mode="float"
      position="bottom-center"
    />
  );
}

const root = document.getElementById("root")!;
createRoot(root).render(<Harness />);
