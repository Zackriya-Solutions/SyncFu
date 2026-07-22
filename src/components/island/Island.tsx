import type { CSSProperties } from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { NotificationPayload } from "@/types/notification";
import type {
  IslandAppearance,
  IslandMode,
  IslandPosition,
} from "@/types/islandSettings";
import { useIslandSettingsStore } from "@/stores/islandSettingsStore";
import { buildStyleVars } from "@/lib/styleVars";
import { resolveTimeout } from "@/lib/timeout";
import {
  createMorphController,
  effectiveIslandSettings,
  shouldReveal,
  type IslandState,
  type MorphController,
  type NotchGeometry,
} from "@/lib/islandMorph";
import { AmbientWings } from "./AmbientWings";
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
//
// LIFECYCLE STATE MACHINE (T5b, completeness gate - 04-risk S1 / 02-arch S7).
// The machine spans two owners; every interruption cell below is defined:
//
//   hidden    - NO Island mounted. Owned by IslandOverlay (renders `islandItems[0]`
//               only when present; hides the window when empty). "last dismissed ->
//               hidden" and "arrival -> present" live there.
//   compact   - renderState "compact": the live pill. `notification.progress`
//               drives the trailing live-activity ring, refreshed in place by the
//               Update flow even after collapse (invariant d).
//   expanded  - renderState "expanded": the full card (bar/ring progress + actions).
//   morphing  - transient: the controller's rAF springs are non-resting between
//               compact<->expanded. Not a React state (React never tracks frames -
//               the controller does); `data-state` is the TARGET, and the loop
//               self-parks at rest (T4b A6). dispose() cancels it on unmount/close.
//   list-open - T6 SEAM (>1 island item -> ranked list). NOT built here; IslandOverlay
//               renders a single item and marks where the list will mount.
//
// Interruption transitions handled here:
//   arrival (hidden)            -> present expanded (C4 arrive-expanded, IslandOverlay)
//   hold elapses (expanded)     -> animate to compact (auto-collapse below)
//   --wait decision (any)       -> forced/held expanded, auto-collapse+dismiss OFF
//   progress update (compact)   -> refresh pill live-activity, no frame resize (D3)
//   progress update (expanded)  -> refresh card in place, no remount, no frame resize
//   new distinct notif (morphing/any) -> LATEST-WINS re-present: IslandOverlay's
//               `key={id}` remounts to the new item (snap expanded) and the old
//               controller disposes its rAF, so there is never a half-morph.
//   dismissed (any)             -> IslandOverlay drops it -> hidden; dispose() cancels
//               any in-flight morph (also the monitor-change teardown path, T9 owns
//               the window recreation; here it is frontend cancel ordering only).

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

/** Resolve `appearance` to "is the surface light?" NOW. `auto` reads the OS
 *  `prefers-color-scheme` synchronously so the very first paint is already correct
 *  (no dark->light flash on a light-OS system). jsdom (no matchMedia) -> dark,
 *  matching `prefersReducedMotion`'s guard. */
function resolveLightNow(appearance: IslandAppearance): boolean {
  if (appearance !== "auto") return appearance === "light";
  return !!(
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  );
}

/** Live wrapper around `resolveLightNow`: `auto` also subscribes to the media
 *  query so a mid-display OS theme flip restyles the shown island without a
 *  resend. Seeded synchronously, so the first paint never flashes. */
function useResolvedLight(appearance: IslandAppearance): boolean {
  const [light, setLight] = useState<boolean>(() => resolveLightNow(appearance));
  useEffect(() => {
    setLight(resolveLightNow(appearance));
    if (appearance !== "auto" || typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => setLight(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [appearance]);
  return light;
}

interface IslandProps {
  readonly notification: NotificationPayload;
  /** Optional CONTROLLED state. When set, the island is pinned to it (springs
   *  snapped, no auto-collapse) - used by the static render harness and unit
   *  tests. Omit it for the production lifecycle (arrive expanded -> collapse). */
  readonly state?: IslandState;
  /** Optional appearance/position OVERRIDES. Omitted in production (the values
   *  come from the settings store); the render/e2e harnesses pass them per cell so
   *  dark/light/auto and the four positions render side by side under one store. */
  readonly appearance?: IslandAppearance;
  readonly mode?: IslandMode;
  readonly position?: IslandPosition;
  /** Action click handler. The host wires this to `invoke("action_callback")`,
   *  joining the card's UNCHANGED action_callback -> waiter -> CLI exit-0 path. */
  readonly onAction?: (notificationId: string, actionId: string) => void;
  /** Auto-dismiss handler. The host wires this to `dismiss_notification`, the
   *  same path the card uses -> waiter Dismissed -> CLI exit 1. */
  readonly onDismiss?: (notificationId: string) => void;
  /** Physical notch cutout geometry (T13). In notch mode WITH a geometry the pill renders as a
   *  second notch directly below the cutout (its width matches the cutout and the whole island is
   *  offset down by the cutout height); `null`/float keeps the pre-existing floating layout. Supplied
   *  by IslandOverlay; omitted (null) in the unit/render harnesses. */
  readonly notchGeometry?: NotchGeometry | null;
  /** Backend hover-reveal signal (T13, `island:reveal`): true while the physical notch, its ambient
   *  wings, or the pill is hovered. Governs the COLLAPSED under-notch pill only (collapsed + not
   *  hovered shows the ambient wings instead, T14); an expanded island is always visible. Ignored in
   *  float / non-notch mode. Harness/tests pass it explicitly to pick the ambient vs revealed state. */
  readonly notchHover?: boolean;
  /** Settle report (BUG B): fires with the shape's window-relative bounds on every morph settle AND
   *  on each reveal slide settle, so the host can push the click-through hitbox to the backend. */
  readonly onSettle?: (rect: { x: number; y: number; w: number; h: number }) => void;
}

export const Island = forwardRef<IslandHandle, IslandProps>(function Island(
  {
    notification,
    state,
    appearance: appearanceProp,
    mode: modeProp,
    position: positionProp,
    onAction,
    onDismiss,
    notchGeometry = null,
    notchHover = false,
    onSettle,
  },
  ref
) {
  // Persistent island settings (D4). Read at creation (initial geometry) AND
  // subscribed to for live restyle (T7b): the island window's store is seeded by
  // get_island_settings and updated by the `island:settings` event (two
  // independent paths, both funnel through here). Held in a ref too so the morph
  // call sites can read `reducedMotion` without re-subscribing their effects.
  // Appearance + position (T8) derive from the same subscription; explicit props
  // override (harness/tests). mirrored == flush bottom-center notch flip (float only).
  const settings = useIslandSettingsStore((s) => s.settings);
  const appearance = appearanceProp ?? settings.appearance;
  const mode = modeProp ?? settings.mode;
  const position = positionProp ?? settings.position;
  const isLight = useResolvedLight(appearance);
  const mirrored = mode === "float" && position === "bottom-center";
  // Under-notch mode is active only in notch mode WITH a known cutout geometry (T13); everything else
  // keeps the pre-existing floating layout so float mode and jsdom/harness renders are unchanged.
  const underNotch = mode === "notch" && notchGeometry != null;
  // The geometry the morph controller targets, threaded through the SAME configure/applySettings
  // path the raw settings take: in notch mode the compact pill takes the cutout width/height so it
  // reads as a second notch (islandMorph.effectiveIslandSettings).
  const effSettings = useMemo(
    () => effectiveIslandSettings(settings, mode, notchGeometry),
    [settings, mode, notchGeometry]
  );

  const islandRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<MorphController | null>(null);
  const settingsRef = useRef(effSettings);
  settingsRef.current = effSettings;
  const isReduced = () => settingsRef.current.reducedMotion || prefersReducedMotion();
  // Hold the latest onSettle so the once-created controller always calls the current reporter.
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;

  // Report the CURRENT shape bounds (window-relative logical px) as the click-through hitbox (BUG B).
  // getBoundingClientRect is in CSS px relative to the window's top-left and INCLUDES the reveal
  // wrapper's transform, so a re-report after the reveal slide settles keeps the backend hitbox in
  // sync with where the pill actually is (concealed => off-screen => not interactive; revealed =>
  // under the cursor => interactive). Called by the controller on morph settle AND on reveal
  // transitionend. jsdom boxes are zero, but the CALL shape is what wires the hitbox path.
  const reportHitbox = useCallback(() => {
    const report = onSettleRef.current;
    const island = islandRef.current;
    if (!report || !island) return;
    const r = island.getBoundingClientRect();
    report({ x: r.x, y: r.y, w: r.width, h: r.height });
  }, []);

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

    const controller = createMorphController(
      { island, svg, path, content },
      { onSettle: reportHitbox }
    );
    controllerRef.current = controller;
    // Creation-read path: adopt the persisted settings BEFORE arriving, so the
    // first paint already has the user's geometry (no snap-then-jump).
    controller.configure(settingsRef.current);
    controller.snap(renderStateRef.current, isReduced());
    // Apply the initial surface (light card / float pill / mirrored path) before
    // the first paint so appearance is correct on arrival, not one frame late.
    controller.setSurface({ light: isLight, mode, mirrored });

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
    controller.animateTo(renderState, isReduced());
    // isReduced reads a ref; renderState is the only real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderState]);

  // Live restyle path (T7b): when settings change, re-target the CURRENT state's
  // springs to the new geometry (animate, never snap - D3). The first run is
  // skipped because configure() (in the creation effect) already adopted the
  // initial settings; only genuine changes reach the controller here.
  const settingsMounted = useRef(false);
  useLayoutEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (!settingsMounted.current) {
      settingsMounted.current = true;
      return;
    }
    controller.applySettings(effSettings, isReduced());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effSettings]);

  // Live appearance/position updates (T8): re-fill and, on a mirror flip, repaint
  // the shape in place (no morph, D3). Runs after the mount snap's initial setSurface.
  useEffect(() => {
    controllerRef.current?.setSurface({ light: isLight, mode, mirrored });
  }, [isLight, mode, mirrored]);

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
  // Keyed on renderState so a MANUAL expand (click trigger below) re-arms the
  // hold and the island re-collapses after the same interval.
  useEffect(() => {
    if (controlled || isDecision || renderState !== "expanded") return;
    const id = setTimeout(() => setRenderState("compact"), ENTRY_HOLD_MS);
    return () => clearTimeout(id);
  }, [controlled, isDecision, renderState]);

  // User click trigger: the island toggles compact<->expanded on click (the
  // approved mockup's live behavior). Clicks on interactive children (action
  // buttons) never toggle. No-op while controlled (state is pinned).
  const handleToggle = (e: React.MouseEvent<HTMLDivElement>) => {
    if (controlled) return;
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    setRenderState((s) => (s === "expanded" ? "compact" : "expanded"));
  };

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
  // Hover-reveal (T13) + ambient wings (T14): the under-notch collapsed pill is concealed until the
  // physical notch (or its ambient wings) is hovered; expanded is always visible; float / non-notch
  // always visible. When concealed under-notch, the pill is NOT hidden outright - the ambient wings
  // indicator shows in its place (below). `controlled` (harness/tests) does NOT force reveal: fixtures
  // pick the ambient vs revealed state via `notchHover`, mirroring production faithfully.
  const revealed = shouldReveal(underNotch, expanded, notchHover);
  // Ambient wings show in the pill's place iff we are under-notch AND concealed -
  // the exact complement of `revealed`, inlined here (T14 follow-up) since revealed
  // is already computed one line up.
  const ambient = underNotch && !revealed;

  // Re-report the hitbox whenever the reveal state flips. Under reduced motion the wrapper has NO
  // CSS transition, so onTransitionEnd never fires and the hitbox would go stale (a stale revealed-
  // position hitbox makes the interactive window eat clicks over an empty region). With transitions
  // this fires at ~0% progress and transitionend re-reports the settled position - a harmless
  // double report.
  useEffect(() => {
    reportHitbox();
  }, [revealed, reportHitbox]);
  // The 27 `--s-*` overrides live on the `.di-island` root so they reach BOTH the
  // SVG path (`var(--s-card-bg, ...)`) and the content (invariant c). Compact
  // keeps its hardcoded #000000 fill and never reads these (invariant d).
  const styleVars = buildStyleVars(notification.style, notification.font);
  // Under-notch offset var (T13): the reveal wrapper translates the whole island DOWN by the cutout
  // height so both compact and expanded content sit fully below the physical cutout (island.css).
  const revealStyle: CSSProperties = underNotch
    ? ({ "--di-notch-h": `${notchGeometry!.heightLogical}px` } as CSSProperties)
    : {};
  // Light appearance re-skins content text to a dark ink ramp on the SAME surfaces
  // the controller lightens (expanded card + float compact pill); the notch
  // compact pill keeps its light text on the black fill (invariant d).
  const lightContent = isLight && (expanded || mode === "float");

  const pill = (
    <div
      className="di-reveal"
      data-testid="island-reveal"
      data-notch={underNotch ? "true" : undefined}
      data-revealed={revealed ? "true" : "false"}
      style={revealStyle}
      // Re-report the hitbox once the reveal slide settles so the backend interactivity toggle
      // matches the pill's real position (own transform only, not child hover transitions).
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget) reportHitbox();
      }}
    >
      <div
        className={lightContent ? "di-island di-light-content" : "di-island"}
        data-testid="island"
        data-state={renderState}
        style={styleVars}
        ref={islandRef}
        onClick={handleToggle}
      >
        <svg className="di-shape" preserveAspectRatio="none" aria-hidden="true" ref={svgRef}>
          <path ref={pathRef} />
        </svg>
        <div className="di-content" ref={contentRef}>
          {expanded ? (
            <IslandExpanded
              notification={notification}
              onAction={onAction}
              onDismiss={onDismiss}
            />
          ) : (
            <IslandCompact notification={notification} />
          )}
        </div>
      </div>
    </div>
  );

  // Float / non-notch: byte-identical to the pre-T14 output (just the pill wrapper, no ambient).
  if (!underNotch) return pill;

  // Under-notch: the pill PLUS the ambient wings indicator (T14). The ambient element is always
  // mounted (so it can cross-fade) and toggles visibility via `data-visible`; it is absolutely
  // positioned (island.css) so it overlays the notch independently of the pill's slide transform.
  return (
    <>
      {pill}
      <AmbientWings notification={notification} geo={notchGeometry!} visible={ambient} />
    </>
  );
});
