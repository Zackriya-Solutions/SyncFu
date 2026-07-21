# Feature brief: Dynamic Island notification

**Status**: Idea / notes for planning. Not a PRD, not a plan. This file is the input to
`/orchestrator-planner ./tasks/dynamic-island-notification.md`.
**Date**: 2026-07-20
**Design reference**: `tasks/dynamic-island-mockup.html` (open in a browser; full-fidelity visual spec)

---

## 1. One-paragraph idea

Add a new **presentation style** to syncfu overlay notifications: a Dynamic Island / notch-style
capsule. Instead of the current top-right liquid-glass card, this variant renders a pure-black
capsule anchored to the top-center of the screen (hugging the physical notch on MacBooks, floating as
a rounded capsule elsewhere) that spring-morphs between a compact idle pill and a fully expanded
notification card. It is cross-platform and visually polished, and its output must be invisible during
screen sharing / screen recording. Reference product: Notchie (closed source) and NotchPrompter (open
source). This is an **additive** kind, selectable per notification; it does not replace the existing
top-right card.

## 2. Why

- syncfu is "the notification layer your AI agents are missing." A notch-anchored island is the most
  recognizable, glanceable ambient-status form factor on modern laptops, and it fits agent/long-task
  status (timers, progress, live activity) better than a corner toast.
- Screen-share invisibility is a real product differentiator in this category (Notchie markets exactly
  this) and matters for developers who stream / pair / demo while agents run and secrets or private
  notifications could otherwise leak on a live capture.

## 3. Target codebase / architecture ground truth

> The planner runs inside `~/work/2025/syncfu`, and **this repo IS the syncfu notification app**
> (remote `github.com/Zackriya-Solutions/SyncFu`). Implementation happens here. Note: an older local
> working copy of the same project also exists at `~/work/2026/reminders/notification-shell/`; the
> canonical, current tree is this repo. Confirm current paths during planning.

- **App**: Tauri v2. Rust backend (`src-tauri/`) + React 18 + TypeScript frontend (`src/`), Vite.
  Builds the `syncfu` binary and `syncfu.app`. Workspace members: `src-tauri`, `cli`.
- **Overlay today**: `src-tauri/src/overlay/panel.rs` creates one always-on-top window pinned
  **top-right** (NSPanel on macOS via `tauri-nspanel`; always-on-top `WebviewWindow` on Win/Linux).
  `calculate_panel_position()` computes the top-right point and is unit-tested.
- **Frontend today**: `src/components/overlay/NotificationOverlay.tsx` renders a stack of
  `NotificationCard.tsx`; the frontend measures content and resizes the window to fit. Motion is
  hand-written CSS; **no animation library is installed** (candidate: `motion` / Framer Motion).
- **Notification model**: enums (`Priority`, `ActionStyle`, `ProgressStyle`) are mirrored across three
  files and this is the pattern a new "kind" follows:
  - `cli/src/types.rs`
  - `src-tauri/src/notification/types.rs`
  - `src/types/notification.ts`
- **Style system**: 27 per-notification `style` overrides map to `--s-*` CSS custom properties (see
  `src/styles/overlay.css`). Accents: low `#2ed573`, normal `#4a9eff`, high `#ffa502`, critical
  `#ff3b30`. Type pairing: SF Pro (UI) + SF Mono (sender, timers, ids, percentages).
- **Transport**: external processes send via HTTP (`:9868`) + WebSocket (`:9869`) into a
  `NotificationManager`, which emits Tauri events to the overlay window.
- **Tests today**: frontend Vitest + Testing Library (~7 specs); Rust ~109 unit tests + a CLI
  integration test. `test:e2e: "playwright test"` is declared in `package.json` but there is **no
  Playwright config, no specs, and no tauri-driver** yet.

## 4. Decisions already locked (from a /grill-me-qa pass)

These are constraints, not open questions. Do not re-litigate.

- **D1 - coverage priority.** All four new risk surfaces must be tested; the primary effort goes to
  the **visual cluster**: visual/animation fidelity, positioning/anchoring, and per-notification
  customization. **Screen-capture exclusion** is mandatory and gets its **own dedicated verification
  track** (it is catastrophic if wrong and the hardest to test; do not let "everything matters" orphan
  it). Functional parity (actions, --wait, timeout, progress, grouping) is mandatory.
- **D2 - design-mock-first with a manual approval gate.**
  1. A plain-HTML, full-fidelity, cross-platform mockup (all states + all customization) is built
     first. Done: `tasks/dynamic-island-mockup.html`.
  2. The user **manually approves the design** before any implementation begins. No Tauri code until
     the mockup is approved.
  3. Playwright validates the mockup (render + screenshot each state), and later validates the real
     Tauri implementation.
- **Design thesis (locked direction, details still open):** the compact pill is pure black so it
  blends with the notch and reads as part of the hardware; on expand it morphs into syncfu's existing
  content anatomy and honors the same 27 `--s-*` overrides.
- **D3 - shape + motion (locked by agent research, see `tasks/dynamic-island-ui-research.md`):** the
  notch is an SVG path with quadratic-Bezier concave shoulders (control point at the outer top
  corner), radii 6/14 compact -> 19/24 expanded with clamps (t <= min(W/4,H/4), b <= min(W/4,H/2)).
  Springs: container stiffness 220 / damping 25; content 400/30; pop 260/18; hover scale 1.028
  top-anchored with 150ms open delay. Never animate the outer window frame - hold the panel at
  expanded size and animate shape + content only (all three native apps document jank otherwise).
- **D4 - customization (user-locked):** full playground; knobs are PERSISTENT APP SETTINGS (not
  per-notification payload): compact width 150-600 (default 218), expanded width 320-560 (default
  380), height 24-60 (default 34), opacity 0-100 (default 94, surface fill alpha only), corner radii
  + scaling toggle, accent presets, mode notch/float, position (float mode: top-left / top-center /
  top-right / **bottom-center**, user-requested 2026-07-20; bottom-center expands upward with the
  notch shape mirrored vertically when flush), reduced motion,
  hide-from-capture toggle, and **appearance: dark / light / auto** (user-requested 2026-07-20).
  Light mode restyles the expanded card (light frosted surface, dark text) and float-mode pills;
  in macOS notch mode the compact pill stays black to blend with the physical notch (same rule iOS
  applies to the real Dynamic Island). Per-notification payload keeps only the existing 27 style
  overrides.
- **D5 - many notifications (RESOLVED, user-picked 2026-07-20):** **Model B - expandable ranked
  list.** Compact = highest-priority spotlight item + xN count badge (badge width 26 + 8*(digits-1),
  caps at 9+); expanding reveals a priority-ranked, deduped list capped at 6 rows / 560px, then
  scrolls inside the island with a bottom fade affordance; rows stagger in 40-60ms; critical ranks
  first; auto-dismiss pauses while the list is open. Models A (badge+cycle) and C (stack-under) were
  mocked, reviewed, and rejected - do not resurrect without re-adjudication (C is the anti-pattern
  no mature app ships).
- **D6 - DESIGN APPROVED (2026-07-20):** the user approved `tasks/dynamic-island-mockup.html` at
  rev 6 (wall-aware content) as the visual spec. The D2 manual design gate is CLEARED - implementation
  planning may proceed. The mockup's anatomy tables + the playground's ISLAND.SETTINGS.JSON are the
  authoritative numbers; `tasks/dynamic-island-ui-research.md` is the evidence base.

## 5. Requirements

### Functional
- New notification **kind / presentation** selectable per notification (payload field + CLI flag),
  additive to the existing top-right card. Name of the field/flag is an open question (section 8).
- **Anchor top-center.** macOS hugs the physical notch (top corners square, fused to the notch);
  non-notch displays and Windows/Linux render a floating rounded capsule pinned top-center.
- **Two states, one morph.** Compact (idle / live-activity) and expanded (card). Compact uses the
  Dynamic Island leading/trailing model: leading glyph, trailing live activity (timer, ring, pulse, or
  a grouped count). Expanded shows icon, sender, title, body, progress (bar/ring), actions, countdown.
- **Reuse existing behavior in island mode**: actions (primary/secondary/danger), `--wait` blocking
  decisions, timeouts by priority (critical never auto-dismisses), progress updates, grouping/stacking,
  and all 27 style overrides.
- Sensible **compact-vs-expanded lifecycle** (e.g. arrive expanded then collapse to a live pill, or
  arrive as a pill and expand on activity/hover). Exact model is an open question (section 8).

### Non-functional
- **Hidden during screen sharing (mandatory).** The island window is excluded from OS screen capture.
  Tauri v2 exposes this directly: `window.set_content_protected(true)` (maps to macOS
  `NSWindowSharingNone` and Windows `WDA_EXCLUDEFROMCAPTURE`). Verified references: NotchPrompter
  `PrompterWindow.swift updateScreenRecordingVisibility()` (`sharingType = .none`, default ON);
  boring.notch `BoringNotchSkyLightWindow.swift updateSharingType()`. Counter-example warning:
  open-island and open-vibe-island set `.readOnly` and ARE capturable - do not copy their panel setup.
  - Linux: **no reliable equivalent.** Documented limitation; a fallback (for example, auto-hide while
    a capture/meeting app is frontmost) is an open decision.
- **Cross-platform** (macOS, Windows, Linux) with graceful degradation where hardware/APIs differ.
- **Beautiful and native-feeling**: spring motion, no "web" linear tweens; respects reduced-motion.
- Performance: the morph must not jank; overlay stays click-through when idle.

## 6. Prior art (from a research pass; verify before adopting)

> **Deep technical research completed 2026-07-20** by a 6-agent fleet that mined the actual source of
> boring.notch, open-island, open-vibe-island, NotchPrompter, and PILLAR plus web morph techniques.
> Full brief with code evidence: `tasks/dynamic-island-ui-research.md`. The bullets below are the
> earlier survey; the research doc supersedes it on shape/animation/customization/overflow numbers.

- **PILLAR** (github.com/warpirate/pillar-dynamic-island-for-windows) - MIT. **Closest match**:
  Tauri 2 + Rust + React + TypeScript + Motion, a top-center always-on-top transparent pill that
  expands to a card. Same stack as ours. Very low stars / obscure: **audit before trusting**, mine the
  Rust overlay-window setup and the React morph component.
- **Dynamic-island-notifications** (github.com/nithinpjohn/Dynamic-island-notifications) - MIT, web,
  Next.js + Motion. Portable morph component; lift the compact<->expanded logic.
- **NotchPrompter** (github.com/jpomykala/NotchPrompter) - open-source notch teleprompter; the free
  counterpart to Notchie. **Study its screen-share-invisibility technique** (window capture exclusion)
  and its notch anchoring. (Fetch was not completed in this session; the architecture lane should read
  the repo directly for the sharingType / capture-exclusion implementation.)
- **Notchie** (producthunt.com/products/notchie) - closed source. The named reference; markets
  "invisible during screen sharing." UX reference only.
- **boring.notch** (GPL-3.0, ~10k stars), **NotchNotification** + **NotchDrop** (Lakr233, MIT) - Swift/
  SwiftUI, macOS-native. UX and timing reference only; not portable to a web frontend.
- **Motion / Framer Motion** (motion.dev) - the animation dependency to build on. No dedicated
  `react-dynamic-island` npm package exists; the component is hand-built. Key primitives: `layout`
  prop (auto-animate size/position between states), `AnimatePresence` (staged reveal of expanded
  content), spring config.
- **Morph techniques that sell it**: (1) shared-layout spring morph on one persistent element, not
  width/height tweens; (2) `AnimatePresence` staged reveal, container grows before content appears;
  (3) anchor the morph to a fixed top-center point so it feels attached to the hardware.

## 7. Design mockup - what it demonstrates

`tasks/dynamic-island-mockup.html` (self-contained, no network). Sections: live interactive morph
(idle / incoming / decision / live-progress / collapse, with macOS/Windows/Linux toggle); a state
gallery (compact idle/timer/ring/grouped; expanded basic/actions/decision/progress-bar/progress-ring/
critical/rich-body); cross-platform anchoring trio; a customization gallery proving the 27 overrides
apply (brand / terminal / Claude / danger / light / custom-radius); and an anatomy + measurements
sheet with the spring params and the screen-share-invisibility spec. Playwright screenshotting of the
static gallery is the intended validation (each state has a `shot-*` id).

## 8. Open questions for the planners

- **Kind selection API.** Field name and CLI flag for choosing the island presentation. Options:
  `presentation: "island" | "card"`, or `variant`, or reuse `theme`. Decide the name and where it lives
  (payload + `syncfu send` flag), and the default.
- **Lifecycle / interaction model.** Arrive expanded then auto-collapse to a live pill, vs arrive as a
  pill and expand on activity/hover/click? What triggers re-expansion? How does `--wait` behave (stay
  expanded until answered)?
- ~~Stacking / grouping in island form~~ **RESOLVED by D5**: Model B (spotlight + count badge ->
  ranked scrollable list). Remaining sub-questions for the task lane: how list rows map to actions/
  callbacks in the payload, and dedupe-key semantics (research suggests dedupe by group/live-activity
  key).
- **Notch geometry + multi-monitor.** Partially answered by research: boring.notch derives
  `notchWidth = screen.width - auxiliaryTopLeftArea - auxiliaryTopRightArea + 4` from NSScreen and
  falls back to a fixed 185x32-ish bar on non-notch displays. Still open: which monitor the island
  targets and Tauri's access path to those AppKit APIs.
- **Linux screen-share fallback.** No capture-exclusion API; decide the documented behavior (hide while
  a known capture app is frontmost, or accept visible + warn).
- **Animation dependency.** Research tilts toward a hand-rolled rAF damped-spring integrator
  (~1.5kb, no dependency - the v2 mockup ships one implementing 220/25 and 400/30) over adopting
  `motion`; final call belongs to the architecture lane. Either way Motion layout animations do not
  run in jsdom, so visual verification stays Playwright-based.
- **Test strategy (parked /grill-me-qa dimensions).** Visual-regression tooling (recommendation:
  Playwright screenshots against the Vite-served overlay route, since Vitest/jsdom is blind to visual /
  animation); how to actually verify capture-exclusion per OS; the cross-platform CI matrix; test
  architecture and maintainability. Recommend the planner **add a dedicated test-strategy lane**.

## 9. Non-goals

- Not replacing or removing the existing top-right glass card; both coexist.
- Not a menu-bar/HUD/media-controller product (this is a notification presentation, not a boring.notch
  style dashboard).
- No new transport; reuse the existing HTTP/WS + `NotificationManager` event flow.

## 10. Suggested planning lanes (maps to orchestrator-planner PLAN MAP)

- `01-prd.md` - PRD via `/prd --sub-skill`, aligned to sections 1-5 and 9 above.
- `02-architecture.md` - the new window (top-center, notch-anchored, capture-excluded), the kind-
  selection plumbing across the 3 type files, the React island component + morph, and where it slots
  into `overlay/panel.rs` + `NotificationOverlay.tsx`.
- `03-alternatives.md` - Motion vs hand-rolled CSS; one shared window vs a dedicated island window;
  reuse `NotificationCard` vs a new component. Guard the rejected options.
- `04-risk.md` - pre-mortem: capture-exclusion silently failing (privacy), notch-geometry edge cases,
  morph jank, Linux gap, cross-platform NSPanel/Win32 differences, interruption/resume states.
- `05-tasks.md` - ordered one-worktree-one-PR TODOs with file paths and invariants; put the
  capture-exclusion and notch-detection platform unknowns behind an **early isolated verification
  gate** (do not defer to "CI will catch it").
- `06-test-strategy.md` (add) - visual-regression harness, per-OS capture-exclusion verification, CI
  matrix; owns the D1 dedicated capture-exclusion track.

---

**Next**: `/orchestrator-planner ./tasks/dynamic-island-notification.md`
