import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { NotificationPayload } from "@/types/notification";
import { buildStyleVars } from "@/lib/styleVars";
import { resolveTimeout } from "@/lib/timeout";
import {
  createMorphController,
  type IslandState,
  type MorphController,
} from "@/lib/islandMorph";
import { IslandCompact } from "./IslandCompact";
import { IslandExpanded } from "./IslandExpanded";

// Island morph host (T4b). Wires T2's spring engine (via the ported
// islandMorph controller) so the island morphs compact<->expanded INSIDE the
// fixed OS frame (D3: nothing here resizes the window). The controller owns all
// animated geometry (box size, SVG viewBox + path `d`, `--di-wall`) and writes
// it imperatively to the refs below every frame; React owns ONLY the structure,
// the 27 `--s-*` style overrides, and which anatomy (compact | expanded) renders.
// Keeping geometry out of JSX is deliberate: a React re-render can never clobber
// a live frame.
//
// Lifecycle (OQ-2 ratified): arrive EXPANDED, hold, then auto-collapse to the
// compact live pill. `--wait` items stay expanded until answered (T5b). The
// imperative handle (expand/collapse) is the trigger surface T5 drives.

export type { IslandState };

/** Ratified entry hold before the auto-collapse morph. T5b owns the full
 *  lifecycle state machine and may tune this; it is the default, not a policy. */
const ENTRY_HOLD_MS = 2600;

/** Imperative trigger surface for T5 (lifecycle interruption / --wait). */
export interface IslandHandle {
  expand(): void;
  collapse(): void;
  readonly state: IslandState;
}

function prefersReducedMotion(): boolean {
  return !!(
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

interface IslandProps {
  readonly notification: NotificationPayload;
  /** Optional CONTROLLED state. When set, the island is pinned to it (springs
   *  snapped, no auto-collapse) - used by the static render harness and unit
   *  tests. Omit it for the production lifecycle (arrive expanded -> collapse). */
  readonly state?: IslandState;
  /** Action click handler. The host wires this to `invoke("action_callback")`,
   *  joining the card's UNCHANGED action_callback -> waiter -> CLI exit-0 path. */
  readonly onAction?: (notificationId: string, actionId: string) => void;
  /** Auto-dismiss handler. The host wires this to `dismiss_notification`, the
   *  same path the card uses -> waiter Dismissed -> CLI exit 1. */
  readonly onDismiss?: (notificationId: string) => void;
}

export const Island = forwardRef<IslandHandle, IslandProps>(function Island(
  { notification, state, onAction, onDismiss },
  ref
) {
  const islandRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<MorphController | null>(null);

  const controlled = state != null;
  const [renderState, setRenderState] = useState<IslandState>(state ?? "expanded");
  const renderStateRef = useRef(renderState);
  renderStateRef.current = renderState;

  useImperativeHandle(
    ref,
    () => ({
      expand: () => setRenderState("expanded"),
      collapse: () => setRenderState("compact"),
      get state() {
        return renderStateRef.current;
      },
    }),
    []
  );

  // A controlled `state` prop drives the rendered anatomy.
  useEffect(() => {
    if (state != null) setRenderState(state);
  }, [state]);

  // Create the controller once the refs exist and ARRIVE at the initial state
  // instantly (snap). Cleanup disposes on unmount AND on window-close so no rAF
  // survives teardown (R-RAF-DISPOSE, R-PERF).
  useLayoutEffect(() => {
    const island = islandRef.current;
    const svg = svgRef.current;
    const path = pathRef.current;
    const content = contentRef.current;
    if (!island || !svg || !path || !content) return;

    const controller = createMorphController({ island, svg, path, content });
    controllerRef.current = controller;
    controller.snap(renderStateRef.current, prefersReducedMotion());

    const onClose = () => controller.dispose();
    window.addEventListener("beforeunload", onClose);
    return () => {
      window.removeEventListener("beforeunload", onClose);
      controller.dispose();
      controllerRef.current = null;
    };
    // Create once; renderState transitions are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Animate on every renderState change AFTER the initial snap. The first run is
  // skipped because snap() (above) already arrived at the initial state.
  const didMount = useRef(false);
  useLayoutEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    controller.animateTo(renderState, prefersReducedMotion());
  }, [renderState]);

  // Re-measure expanded content when it changes size (rounding-guarded retarget).
  useEffect(() => {
    if (renderState !== "expanded") return;
    const controller = controllerRef.current;
    const el = contentRef.current;
    if (!controller || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => controller.measure());
    observer.observe(el);
    return () => observer.disconnect();
  }, [renderState, notification]);

  // T5a parity: a notification carrying actions is a DECISION (the frontend proxy
  // for a pending `--wait` waiter - the payload has no wait flag). Its priority
  // auto-dismiss is the SHARED resolveTimeout (parity: no island-specific timing);
  // critical resolves to null and never auto-dismisses.
  const isDecision = notification.actions.length > 0;
  const autoDismissMs = resolveTimeout(notification.timeout, notification.priority);

  // Ratified entry transition: arrive expanded, hold, auto-collapse to the pill.
  // Skipped while controlled (the harness/tests pin the state) AND for decisions,
  // which STAY EXPANDED until answered (invariant b; T4b auto-collapse suppressed).
  useEffect(() => {
    if (controlled || isDecision) return;
    const id = setTimeout(() => setRenderState("compact"), ENTRY_HOLD_MS);
    return () => clearTimeout(id);
  }, [controlled, isDecision]);

  // Auto-dismiss (parity with the card's exit-1 path): when the priority timeout
  // elapses, resolve the waiter as Dismissed via the host's `dismiss_notification`
  // invoke. Suppressed for decisions (auto-dismiss paused while awaiting an answer
  // - synthesis 1.1; a decision resolves via action/dismiss/CLI-timeout instead)
  // and for critical (autoDismissMs === null, never auto-dismisses).
  useEffect(() => {
    if (controlled || isDecision || autoDismissMs === null || !onDismiss) return;
    const id = setTimeout(() => onDismiss(notification.id), autoDismissMs);
    return () => clearTimeout(id);
  }, [controlled, isDecision, autoDismissMs, onDismiss, notification.id]);

  const expanded = renderState === "expanded";
  // The 27 `--s-*` overrides live on the `.di-island` root so they reach BOTH the
  // SVG path (`var(--s-card-bg, ...)`) and the content (invariant c). Compact
  // keeps its hardcoded #000000 fill and never reads these (invariant d).
  const styleVars = buildStyleVars(notification.style, notification.font);

  return (
    <div
      className="di-island"
      data-testid="island"
      data-state={renderState}
      style={styleVars}
      ref={islandRef}
    >
      <svg className="di-shape" preserveAspectRatio="none" aria-hidden="true" ref={svgRef}>
        <path ref={pathRef} />
      </svg>
      <div className="di-content" ref={contentRef}>
        {expanded ? (
          <IslandExpanded notification={notification} onAction={onAction} />
        ) : (
          <IslandCompact notification={notification} />
        )}
      </div>
    </div>
  );
});
