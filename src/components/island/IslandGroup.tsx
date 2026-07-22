import type { CSSProperties } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { IslandAppearance, IslandMode } from "@/types/islandSettings";
import type { IslandRow, IslandSnapshot } from "@/types/islandSnapshot";
import { useIslandSettingsStore } from "@/stores/islandSettingsStore";
import { resolveTimeout } from "@/lib/timeout";
import {
  createMorphController,
  type MorphController,
  type NotchGeometry,
} from "@/lib/islandMorph";
import { NotificationIcon } from "@/components/overlay/NotificationIcon";
import { IslandList } from "./IslandList";

// Model B host (D5, guard G10 / C1). Rendered by IslandOverlay ONLY when the
// authoritative snapshot reports MORE than one island notification. The single
// notification path (Island.tsx + its T4b/T5a/T5b lifecycle) is deliberately
// UNTOUCHED and untouchable from here: this component never renders an <Island>.
//
// It owns exactly the EPHEMERAL view state (03-alternatives G10: "the frontend
// holds only ephemeral view state"): compact spotlight <-> expanded list, and the
// per-item auto-dismiss timers. Everything rank/dedupe/count/badge is read from
// the snapshot, never recomputed.
//
// Morph: the same ported spring engine as Island (createMorphController) drives
// the compact-pill <-> expanded-card morph inside the fixed OS frame (D3), so the
// grouped island keeps the notch-hugging identity - it does NOT degrade to a plain
// rounded card when count>1.
//
// Auto-dismiss pause (D5 / F2, 02-architecture "Auto-dismiss pause semantics"):
// auto-dismiss is FRONTEND-owned for parity with the card and the single island;
// list-open state is inherently frontend, so pausing is LOCAL - no backend
// round-trip. While the list is expanded every per-item timer is cleared (paused);
// on collapse they restart from full. Waiter-bearing and critical rows never
// auto-dismiss (F2 suppression scope: `hasWaiter || critical`).

function prefersReducedMotion(): boolean {
  return !!(
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Resolve `appearance` to "is the surface light?" synchronously (jsdom -> dark,
 *  matching Island.tsx). Model B has no live OS-theme-flip subscription: the store
 *  re-read on settings/appearance change is sufficient for the grouped view. */
function resolveLightNow(appearance: IslandAppearance): boolean {
  if (appearance !== "auto") return appearance === "light";
  return !!(
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  );
}

interface IslandGroupProps {
  readonly snapshot: IslandSnapshot;
  /** Act on a row (primary action, else dismiss). Wired by IslandOverlay to the
   *  SAME action_callback / dismiss commands the card and single island use. */
  readonly onRowAction: (row: IslandRow) => void;
  /** Dismiss a single notification by id (auto-dismiss + row dismiss). */
  readonly onDismiss: (id: string) => void;
  /** Clear every island notification (T15, the list "Clear all"). */
  readonly onClearAll: () => void;
  /** Appearance/mode OVERRIDES for the render/e2e harness. Omitted in production
   *  (values come from the settings store). */
  readonly appearance?: IslandAppearance;
  readonly mode?: IslandMode;
  /** Physical notch cutout geometry (T13). In notch mode the grouped spotlight is offset DOWN by the
   *  cutout height so it sits below the notch (never behind it); the group stays ALWAYS visible (no
   *  hover-reveal - it represents a pile the user is actively triaging). Null/float keeps the layout. */
  readonly notchGeometry?: NotchGeometry | null;
  /** Settle report (BUG B): the shape hitbox on morph settle, so the backend cursor tracker makes the
   *  grouped spotlight clickable (parity with the single island). */
  readonly onSettle?: (rect: { x: number; y: number; w: number; h: number }) => void;
}

export function IslandGroup({
  snapshot,
  onRowAction,
  onDismiss,
  onClearAll,
  appearance: appearanceProp,
  mode: modeProp,
  notchGeometry = null,
  onSettle,
}: IslandGroupProps) {
  const settings = useIslandSettingsStore((s) => s.settings);
  const appearance = appearanceProp ?? settings.appearance;
  const mode = modeProp ?? settings.mode;

  const [isLight, setIsLight] = useState(() => resolveLightNow(appearance));
  useEffect(() => setIsLight(resolveLightNow(appearance)), [appearance]);

  const islandRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<MorphController | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const isReduced = () =>
    settingsRef.current.reducedMotion || prefersReducedMotion();
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;

  const [expanded, setExpanded] = useState(false);
  // Under-notch offset (T13): in notch mode the grouped spotlight is pushed below the cutout.
  const underNotch = mode === "notch" && notchGeometry != null;

  // Report the shape bounds as the click-through hitbox (BUG B) so the spotlight is clickable.
  const reportHitbox = useCallback(() => {
    const report = onSettleRef.current;
    const island = islandRef.current;
    if (!report || !island) return;
    const r = island.getBoundingClientRect();
    report({ x: r.x, y: r.y, w: r.width, h: r.height });
  }, []);

  // Create the controller once and arrive at the compact spotlight instantly.
  // Model B defaults to the collapsed spotlight; the user expands to the list.
  useLayoutEffect(() => {
    const island = islandRef.current;
    const svg = svgRef.current;
    const path = pathRef.current;
    const content = contentRef.current;
    if (!island || !svg || !path || !content) return;

    const controller = createMorphController(
      { island, svg, path, content },
      { onSettle: reportHitbox }
    );
    controllerRef.current = controller;
    controller.configure(settingsRef.current);
    controller.snap("compact", isReduced());
    controller.setSurface({ light: isLight, mode, mirrored: false });

    const onClose = () => controller.dispose();
    window.addEventListener("beforeunload", onClose);
    return () => {
      window.removeEventListener("beforeunload", onClose);
      controller.dispose();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Morph on expand/collapse (after the initial snap).
  const didMount = useRef(false);
  useLayoutEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    controller.animateTo(expanded ? "expanded" : "compact", isReduced());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // Live surface updates (appearance/mode).
  useEffect(() => {
    controllerRef.current?.setSurface({ light: isLight, mode, mirrored: false });
  }, [isLight, mode]);

  // Re-measure the expanded list when its row set changes (rounding-guarded).
  useEffect(() => {
    if (!expanded) return;
    const controller = controllerRef.current;
    const el = contentRef.current;
    if (!controller || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => controller.measure());
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, snapshot]);

  // Per-item auto-dismiss, PAUSED while the list is open (D5). Restarts from full
  // on collapse. Critical (resolveTimeout === null) and waiter-bearing rows never
  // fire (F2 suppression scope).
  useEffect(() => {
    if (expanded) return;
    const timers = snapshot.rows.flatMap((row) => {
      // F2 suppression scope: waiter-bearing and critical rows never auto-dismiss
      // (critical regardless of any explicit timeout).
      if (row.hasWaiter || row.priority === "critical") return [];
      const ms = resolveTimeout(row.timeout, row.priority);
      if (ms === null) return [];
      return [setTimeout(() => onDismiss(row.id), ms)];
    });
    return () => timers.forEach(clearTimeout);
  }, [expanded, snapshot, onDismiss]);

  const spot = snapshot.spotlight;
  // A light expanded card / float pill re-skins content to the dark ink ramp; the
  // notch compact spotlight keeps its light text on black (parity with Island).
  const lightContent = isLight && (expanded || mode === "float");
  // Under-notch offset var (T13): translate the grouped spotlight down by the cutout height.
  const revealStyle: CSSProperties = underNotch
    ? ({ "--di-notch-h": `${notchGeometry!.heightLogical}px` } as CSSProperties)
    : {};

  return (
    <div
      className="di-reveal"
      data-testid="island-group-reveal"
      data-notch={underNotch ? "true" : undefined}
      data-revealed="true"
      style={revealStyle}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget) reportHitbox();
      }}
    >
      <div
        className={lightContent ? "di-island di-light-content" : "di-island"}
        data-testid="island-group"
        data-state={expanded ? "expanded" : "compact"}
        ref={islandRef}
      >
        <svg
          className="di-shape"
          preserveAspectRatio="none"
          aria-hidden="true"
          ref={svgRef}
        >
          <path ref={pathRef} />
        </svg>
        <div className="di-content" ref={contentRef}>
        {expanded ? (
          <IslandList
            snapshot={snapshot}
            onCollapse={() => setExpanded(false)}
            onRowAction={onRowAction}
            onRowDismiss={onDismiss}
            onClearAll={onClearAll}
          />
        ) : (
          spot && (
            <button
              type="button"
              className="di-spot"
              data-testid="island-spotlight"
              data-priority={spot.priority}
              aria-label="Expand notifications"
              onClick={() => setExpanded(true)}
            >
              <span className="di-lrow-dot" />
              <span className="di-spot-ava" aria-hidden="true">
                {spot.icon && <NotificationIcon name={spot.icon} size={16} />}
              </span>
              <span className="di-spot-txt">
                <b>{spot.sender}</b>
                <i>{spot.title}</i>
              </span>
              <span
                className="di-badge-count"
                data-testid="island-badge"
                style={{ width: `${snapshot.badgeWidth}px` }}
              >
                {snapshot.badgeLabel}
              </span>
            </button>
          )
        )}
        </div>
      </div>
    </div>
  );
}
