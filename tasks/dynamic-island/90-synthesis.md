# Lane 90 - Synthesis (Wave S reconciliation)

**/think framework(s):** theory-of-constraints critical-path sequencing (order tasks by dependency x
risk so the plan never blocks on a surprise) + consistency reconciliation (fold C1-C7 and A1-A6 into a
single non-contradictory plan) + coverage-matrix completeness gate (prove every FR and locked MUST has
one owner-task and one owner-test after the resolutions).

**Status:** REVISE verdict from Wave A is now DISCHARGED. Every required revision (C1-C7, the missing
harness task, the T4/T5/T7 splits, the FR gaps) is folded in below. This file is the hand-off artifact
for `orchestrator-implementor`. PLAN ONLY. Base branch: `main`. No em dashes. The 6 Meetily KPIs do not
apply (this is syncfu). Regression surface to protect on every task: existing top-right overlay, HTTP
`:9868` / WS `:9869` API compatibility, CLI flag compatibility, the frontend history store.

Binding inputs treated as settled and NOT re-litigated: D1-D6, the Guard Register G1-G12, and the Wave V
consequences A1-A6 in `85-verify.md`. Where lanes conflicted, the resolutions in section 2 are final.

---

## 1. RECONCILED DESIGN SUMMARY

### 1.1 The architecture in prose

The Dynamic Island is an **additive** notification presentation that lives beside the existing top-right
glass card, never replacing it. It is a pure-black capsule anchored top-center (hugging the physical
MacBook notch; a floating rounded capsule elsewhere) that spring-morphs between a compact pill and an
expanded card. Selection is per notification through a single new payload field.

**Routing noun.** Exactly one new field, `presentation: "card" | "island"`, default `card`, added with
`#[serde(default)]` so every existing HTTP/WS/CLI caller is untouched. It is threaded through the real
**five-to-six touch points** (CLI flag, `cli/src/types.rs`, `cli/src/client.rs`,
`src-tauri/src/server/http.rs`, `src-tauri/src/notification/types.rs`, `src/types/notification.ts`), not
just the "tri-file" mirror. "kind" is retired as a noun (glossary). `theme` is never overloaded for
routing (G8).

**Window model.** A **dedicated second window** labeled `island`, sibling to the existing `overlay`
window, created hidden at startup and shown on the first island notification. `src/App.tsx` already
routes by window label, so a one-line `if (label === "island") return <IslandOverlay/>` branch is the
routing seam. The island window is sized ONCE to a fixed envelope (`max(compactWidth, expandedWidth) x
(maxExpandedHeight + slack)`) and its OS frame is NEVER animated (D3); the compact/expanded morph
animates only the inner SVG path and content layer inside that static frame. The window is created
click-through (`ignore_cursor_events(true)`) and toggles to interactive on pointer enter over the island
shape. On macOS it is an NSPanel (non-activating, joins all Spaces, full-screen-auxiliary) built with the
same config as the current panel, subject to the macOS 15 capture caveat below.

**Model B (overflow) ownership - resolved to G10 letter.** The Rust `NotificationManager` is the single
source of truth. It owns priority ranking, dedupe, the 6-row cap, spotlight selection, and the count, and
emits a **full authoritative island snapshot** on every change. The frontend `IslandList` is a **dumb
renderer** of that snapshot; the frontend store's independent queue logic (its own `MAX_VISIBLE=5`,
dedupe, promotion) is NOT extended to the island, because Wave V proved it provably diverges from the
manager (windows W1-W4 in `85-verify.md`). The dedupe key is `group ?? sender::title` everywhere.
Notifications carrying a pending `--wait` waiter are **exempt from dedupe merging** (A4): each keeps its
own row and its 1:1 id->waiter mapping, so exit codes 0/1/2 survive the merged list.

**Settings.** The 13 persistent app-wide settings (geometry, opacity, radii, accent, mode, position,
appearance, reduced-motion, capture toggle) are stored as a **plain serde JSON file**
`island.settings.json` in the app config dir (no `tauri-plugin-store`, which is not installed; G6 only
forbids SQLite). Written atomically (temp + rename), validated and clamped on read, edited from the
`main` window UI, persisted over IPC, and live-pushed to the island window by an `emit_to("island",
"island:settings")` event. Senders can NEVER set geometry; the per-notification payload keeps ONLY the
existing 27 `--s-*` style overrides (G12).

**Capture exclusion - rescoped honestly (A1, binding).** `set_content_protected(true)` maps to
`NSWindowSharingNone` (macOS) and `WDA_EXCLUDEFROMCAPTURE` (Windows). Guaranteed on **macOS <= 14 and
Windows (build 19041+)**. On **macOS 15+, ScreenCaptureKit ignores sharingType / content protection**
(tauri issue #14200; Apple DTS: no public API), so there is NO public-API Plan C: the island is
best-effort on macOS 15+ with a documented limitation and an optional auto-hide-while-capture-app-
frontmost fallback. The `hideFromScreenCapture` toggle MUST surface true OS-level status (ON /
UNSUPPORTED / UNKNOWN), never a silent lie. Linux has no reliable API and ships visible with an honest
disabled toggle. The gate (G2) is a **live capture probe under a ScreenCaptureKit recorder**, never a
property read-back.

**Motion and shape.** Port the mockup's vanilla-JS engine verbatim; do not add `motion`/framer (G2) and
do not redesign. The morph is a hand-rolled rAF damped-spring integrator (220/25, 400/30, 260/18;
reduced-motion 1000/100) driving an inline SVG `<path>` with animated `d` (G3, no CSS mask; G4, no
canvas; G7, no linear tween). The port MUST retain the mockup's `eps=0.02` resting guard, add a rounding
guard on `measure()` retargets, and add a `dispose()` that cancels the pending rAF on teardown (A6). The
`--di-wall` content-inset rule (`padding = max(base, wall + margin)`) is published live and is the
content-vs-shape invariant that regressed 3x and must be tested content-vs-shape, not box-vs-box.

**Coexistence (OQ-9 resolved).** Both windows run simultaneously; each notification renders in exactly
one, chosen by `presentation`. The backend `notify()` routes by presentation (`emit_to` the target
window and `show` only that window); each frontend hook also filters by presentation as a
defense-in-depth safety net (`NotificationOverlay` keeps `presentation !== "island"`; `IslandOverlay`
keeps `presentation === "island"`). History is unaffected: single ingest through `NotificationManager`,
two renderers; island notifications reach the frontend `historyStore.prependEntry` through the same event
that feeds it today (there is NO SQLite; C2).

**Lifecycle (OQ-2, ratified-by-synthesis pending user confirmation).** Default =
**arrive-expanded-then-collapse-to-pill**. A `--wait` decision arrives expanded and stays expanded until
answered; auto-dismiss is paused while a decision or the Model B list is open; critical never
auto-dismisses; timeouts are low 6s / normal 8s / high 12s.

### 1.2 Reconciled ASCII data-flow diagram

```
 external process / agent
        | HTTP :9868 / WS :9869   payload gains: "presentation":"island"|"card"  (#[serde(default)]=card)
        v
  axum server (server/http.rs)  --deser--> NotificationPayload { presentation, style(27 --s-*), group, ... }
        v
  NotificationManager (Arc)  active:IndexMap | queued:Vec | groups:HashMap   [SINGLE SOURCE OF TRUTH]
        |   + Model B: rank / dedupe(group ?? sender::title, waiter-exempt) / cap6 / spotlight / count   (G10 LETTER)
        |   + emits FULL island snapshot on every change
        v  notify() routes by presentation
   +----------------------------+-----------------------------------------+
   | Presentation::Card         | Presentation::Island                    |
   v                            v                                         |
 panel::show_panel           island::show_island (create-hidden->protect->show)
 emit_to("overlay",          emit_to("island","notification:add" + "island:snapshot")
   "notification:add")          + set_island_capture_protected (macOS<=14/Win only; SCK caveat macOS15+)
        |                        + set_ignore_cursor_events(true) (click-through)
        v                        v
 [overlay window]            [island window] dedicated, top-center/notch, FIXED ENVELOPE (frame never animated)
  NSPanel top-right           NSPanel(mac)/WebviewWindow(win/linux)
  resize-to-content              |
        |                        v
 App.tsx label==overlay      App.tsx label==island
  NotificationOverlay          IslandOverlay  (subscribes island events; per-window)
   -> NotificationCard          -> Island.tsx  (rAF loop + springs, <svg path notchPath/capsulePath>,
   (FILTER presentation!=island)    publishes --di-wall; eps + rounding + dispose guards)
                                    |-> IslandCompact  (spotlight glyph + live-activity + xN badge)
                                    |-> IslandExpanded (reuses --s-* via extracted styleVars.ts, icon/sender/title/body)
                                    |-> IslandList     (DUMB RENDER of manager snapshot; rows staggered; timers paused-while-open)
                                   (FILTER presentation==island)

 shared:  notificationStore (both, delta events)  |  historyStore.prependEntry (single ingest, both renderers)
 pure ported libs:  spring.ts  notchPath.ts  styleVars.ts(EXTRACT)   [PORTED from mockup, unit-testable]
 macOS-only:  overlay/notch.rs -> objc2-app-kit 0.3 NSScreen.auxiliaryTopLeft/RightArea (main thread)

 SETTINGS live-update loop:
  [main window] MainApp Island panel --invoke set_island_settings--> settings.rs (serde JSON, atomic write, clamp)
       Rust: reflow_island(geometry) + set_island_capture_protected + emit_to("island","island:settings")
       [island window] islandSettingsStore.replace -> Island.tsx re-targets springs (no snap)

 action path (UNCHANGED): IslandExpanded / IslandList row button -> invoke("action_callback",{notificationId,actionId})
       -> WaiterRegistry.notify (--wait SSE, exit 0/1/2) + webhook POST    [identical to overlay; per-id identity preserved]
```

---

## 2. RESOLUTIONS TABLE

| id | Final resolution | Supersedes / amends |
|----|------------------|---------------------|
| **C1** Model B ownership | **G10 LETTER.** Rank/dedupe/cap/spotlight/count live in Rust `NotificationManager`, which emits a full authoritative island snapshot on every change; frontend `IslandList` is a dumb renderer. Frontend store queue logic NOT extended to island. | `02-architecture.md` S7 ("pure frontend view selector `islandRanking.ts`"); `05-tasks.md` T6 (`rankDedupe.ts` frontend); `06-test-strategy.md` duplicate ranking rows (1a Rust vs 1b frontend) collapse to Rust unit only. |
| **C2** History medium | History is the **frontend `historyStore`** (`prependEntry`), NOT SQLite. Island notifications reach it via the same event that feeds it today (single ingest, two renderers). | PRD S7 "history/SQLite"; `05-tasks.md:11` "SQLite history"; `06-test-strategy.md` S5 last bullet (rewrite to assert `historyStore.prependEntry` receives island items). |
| **C3 / A1** macOS capture | **Per-OS honest matrix.** Guaranteed macOS <= 14 + Windows 19041+. macOS 15+ best-effort + documented limitation (SCK ignores sharingType; no public Plan C) + optional auto-hide fallback. **G2 = live SCK capture probe** on macOS 15 AND a macOS <= 14 check, never a read-back. No false-safety toggle state. | G2 acceptance (was "QuickTime/OBS", no SCK, no Plan C); PRD FR-17 (add macOS 15 caveat); `04-risk` R-CAPTURE (SCK now confirmed refuted for read-back). |
| **C4** Lifecycle default | **Ratified-by-synthesis: arrive-expanded-then-collapse-to-pill** (pending user confirmation, see OQ list). T4b/T5b build on this; do not start with OQ-2 open. | PRD FR-15 / OQ-2 (was deferred/open); `05-tasks.md` T4 (was "provisional"). |
| **C5** Settings backend | **Plain serde JSON `island.settings.json`**, no plugin (sits inside the alternatives' accepted set; honors G6 which only forbids SQLite). Atomic temp+rename write; clamp+default on read. | Ratifies `02-architecture` S4 over `03-alternatives` 5A preference; `05-tasks.md` T7 "architecture picks the mechanism" now locked. |
| **C6** Dedupe key | **`group ?? sender::title` everywhere**, with A4 waiter-exemption (waiter-bearing notifications never merge). The undefined "live-activity key" phrasing is deleted. | PRD OQ-6 (concretize); `05-tasks.md` T6 known-unknown; `06-test-strategy.md` 1a "dedupe by group/live-activity key". |
| **C7** Island routing | **Dedicated island window.** Routing is `App.tsx` label branch -> `IslandOverlay` -> `Island`; `NotificationOverlay` EXCLUDES island items. Backend `notify()` routes by presentation. T4a file list corrected (App.tsx + new `IslandOverlay.tsx` host + per-window subscription + exclusion filter). | `05-tasks.md` T4 file list ("routing in `NotificationOverlay.tsx` render Island when island") which rendered the island in the WRONG window. |
| **A1** Capture exclusion | REFUTED-PARTIAL: SCK ignores sharingType on macOS 15+. Binds C3 above. | See C3. |
| **A2** Notch geometry | SURVIVES: `objc2-app-kit 0.3.2` already in `Cargo.lock`; add as **direct dep at "0.3"**; call NSScreen on the **main thread** (MainThreadMarker); validate **non-notch nullability** on a non-notch machine. G1 stays **S**. | Tightens `05-tasks.md` G1 task note; `02-architecture` S6 crate choice confirmed. |
| **A3** Model B view | REFUTED-PARTIAL: store is not a mirror (W1-W4 divergences). Binds C1 -> G10 letter + manager snapshot. | See C1. |
| **A4** --wait identity | REFUTED-PARTIAL: two waiters sharing a dedupe key merge to one row -> one id resolves, other times out. **Resolution: waiter-bearing notifications exempt from dedupe.** New PRD decision. Acceptance test exercises the two-waiters-same-key collision. | PRD (add waiter-exemption rule to FR-12/FR-14); `05-tasks.md` T6 row->action known-unknown; `04-risk` R-WAIT-ID. |
| **A5** Task sizing | REFUTED: T4/T5/T7 each bundle 5+ concerns. **Split into T4a/T4b, T5a/T5b, T7a/T7b (13 -> 16 tasks)**; T4a absorbs the C7 routing fix. | `05-tasks.md` T4/T5/T7 (single L PRs). |
| **A6** Spring rest | REFUTED-PARTIAL: it rests BECAUSE of `eps=0.02`, not "without a guard". **Port keeps eps + adds measure rounding guard + dispose()**; `measure()` never wired into the per-frame loop or an unrounded setSize feedback path. | `05-tasks.md` T2 invariants; `02-architecture` component lifecycle; `04-risk` R-PERF / R-RAF-DISPOSE. |

---

## 3. THE RANKED TASK LIST (execution order = dependency x risk)

17 tasks. Numbered in final execution order. Each is one worktree, one PR. Format is what
`orchestrator-implementor` ingests. Guard ids and Wave V invariants (A1-A6) that each task enforces are
listed under invariants. Sizes: S/M/L. "Story map" is provisional (PRD lane owns final mapping).

Build order at a glance (critical path in bold):

```
Wave 0 (parallel gates + harness): 1.T0-HARNESS   2.G1   3.G2   4.T1
Wave 1 (foundations, parallel):    5.T2
Wave 2 (island core):              6.**T3** -> 7.**T4a** -> 8.**T4b** -> 9.**T5a** -> 10.**T5b**
Wave 3 (features, parallel):       11.T6   12.T7a -> 13.T7b   14.T8   15.T9
Wave 4 (close-out):                16.T10   17.**T11**
```

Critical path: (G1,G2,T0) -> T1 -> T3 -> T4a -> T4b -> T5a -> T5b -> T11.

---

### 1. T0-HARNESS - Playwright visual harness wiring (earliest green gate)
- **goal:** Wire Playwright so a visual-regression suite exists BEFORE any Tauri or React island code.
  Pin an exact Playwright version as a devDependency, add `playwright.config.ts` with a `webServer` and
  webkit + chromium projects, and land the first baseline set by snapshotting the approved mockup itself
  (`tasks/dynamic-island-mockup.html`, self-contained, no network). This gives the implementation a pixel
  target and makes the visual layer green on a fresh checkout.
- **branch:** `feat/island-t0-playwright-harness`
- **files to touch:** `playwright.config.ts` (new), `package.json` (pin exact Playwright version as
  devDependency; the `test:e2e` script exists but is unwired), a baselines directory committed to the
  repo, a thin spec that shoots the mockup's 11 `shot-*` states + the `[data-plat]` trio + the 7 theme
  cells.
- **invariants after merge:** (a) `npx playwright test` runs green on a fresh checkout against the mockup
  gallery; (b) baselines are generated/compared on the **macOS runner with webkit primary** (SF Pro/SF
  Mono fonts + WKWebView parity), Windows gets a separate chromium baseline, never mixed; (c) baselines
  are committed and a diff fails the build; updating requires an explicit reviewed `--update-snapshots`;
  (d) uses `reducedMotion: 'reduce'` and/or a settled hook for any animated shot, never `waitForTimeout`.
- **depends_on:** none.
- **known unknowns:** exact `maxDiffPixelRatio` start value (begin 0.01, tighten after baselines
  stabilize); whether Windows chromium visual runs per-PR or nightly (budget call, lane 06).
- **acceptance/verify:** `npx playwright test` green against the mockup on a clean clone; CI shows the
  webkit project running on the macOS runner; a deliberately edited baseline fails the build.
- **size:** S.
- **story map:** enabler for all visual acceptance criteria.

### 2. G1 - GATE: notch-geometry access from Rust (spike, verdict only)
- **goal:** Produce a written go/no-go verdict + minimal proof snippet (in the PR description, not shipped
  code) for reading physical notch width from Rust/Tauri so the island can hug the notch. A2 has already
  de-risked this to near-certain; the gate confirms it on real hardware.
- **branch:** `spike/island-g1-notch-geometry`
- **files to touch:** none merged to `src/`; a throwaway probe may live under
  `src-tauri/examples/notch_probe.rs` (not in the shipped build). PR body carries findings.
- **investigate / tightenings (A2, binding):** add `objc2-app-kit` as a **direct dependency at "0.3"**
  (already resolved 0.3.2 transitively via `tauri-nspanel` in `Cargo.lock`); read
  `NSScreen.auxiliaryTopLeftArea` / `auxiliaryTopRightArea` (macOS 12+ public) **on the main thread**
  (`MainThreadMarker` / `run_on_main_thread`); boring.notch formula
  `notchWidth = screen.width - auxLeft - auxRight + 4`; **validate non-notch nullability semantics**
  (objc2 non-optional NSRect vs Swift `NSRect?`) on a non-notch machine; non-notch fallback bar ~185x32.
- **invariants after merge:** a documented reproducible way to obtain notch width (or a definitive
  "not reachable, use fallback X") exists; T3 can start with zero further platform research; the access
  path uses only PUBLIC NSScreen APIs (notarization-safe; G5 satisfied - the query is attempted, not
  skipped; no private SkyLight adoption).
- **guards enforced:** G5 (notch query attempted before any fallback).
- **depends_on:** none.
- **known unknowns:** macOS version differences in the auxiliary-area API; external non-notch display of a
  notched Mac (record, do not solve here).
- **acceptance/verify:** PR body shows the snippet printing a plausible notch width on a notch Mac and a
  fallback value on a non-notch display, returning cleanly on Win/Linux, plus a go/no-go for T3. Reviewer
  confirms it compiles in the syncfu toolchain and calls on the main thread.
- **size:** S.

### 3. G2 - GATE: capture exclusion on the island window (spike, tightened per A1)
- **goal:** Prove per-OS whether the island window can be excluded from screen capture on the exact window
  type shipped, using a **live capture probe** (never a property read-back). Produce a written verdict +
  proof screenshots in the PR description.
- **branch:** `spike/island-g2-capture-exclusion`
- **files to touch:** none merged; throwaway spike only. If the finding is "does not exclude", the PR body
  records the honest scoping and the auto-hide fallback decision for T9.
- **tightened acceptance (C3 / A1, binding):**
  - macOS: island must be absent from a **ScreenCaptureKit-based recorder on macOS 15** AND from a legacy
    `screencapture -x -R` / macOS <= 14 capture. Record BOTH results. Read-back of `sharingType` is
    explicitly INSUFFICIENT (it passes while SCK still captures = the silent leak).
  - Windows: WDA probe via `WDA_EXCLUDEFROMCAPTURE` on build 19041+ (Windows.Graphics.Capture / DXGI
    path), with the build-gate check for older builds.
  - There is **no public-API Plan C on macOS 15** (Apple DTS confirmed). The verdict must state the honest
    scope: guaranteed macOS <= 14 + Windows; best-effort + documented limitation + optional
    auto-hide-while-capture-app-frontmost on macOS 15+.
- **invariants after merge:** a proven mechanism (or a proven honest limitation) documented per OS; the
  macOS-15 SCK behavior is recorded from a real probe; the Linux gap confirmed "no reliable API".
- **guards enforced:** never copy open-island `.readOnly` (that stays capturable); apply-first ordering;
  honest UI status (ON / UNSUPPORTED / UNKNOWN).
- **depends_on:** none.
- **known unknowns:** NSPanel + `NSWindowSharingNone` vs `full_screen_auxiliary` collection-behavior
  interaction; per-OS live-probe scripting method.
- **acceptance/verify:** PR shows a live SCK capture on macOS 15 (island absent or documented-present), a
  macOS <= 14 capture (island absent), a Windows WDA capture (island absent), plus the exact API path and
  a go/no-go for T9.
- **size:** S.

### 4. T1 - Presentation field (five-to-six-touch-point plumbing)
- **goal:** Add the additive `presentation` field (`"card" | "island"`, default `"card"`) end to end,
  changing NO rendering. Selecting `island` still renders the card until T4a; this PR only makes the field
  exist and survive transport. Locks OQ-1 mechanism (final name coordinated with PRD).
- **branch:** `feat/island-t1-presentation-field`
- **files to touch:** `cli/src/main.rs` (`--presentation <card|island>` clap flag),
  `cli/src/types.rs` (`Presentation` enum + `FromStr` + `NotifyRequest` field),
  `cli/src/client.rs` (populate request), `src-tauri/src/server/http.rs` (`NotifyRequest` field +
  payload mapping ~line 136), `src-tauri/src/notification/types.rs` (`Presentation` enum +
  `NotificationPayload.presentation` with `#[serde(default)]`), `src/types/notification.ts`
  (`Presentation` type + optional field; `WindowLabel` gains `"island"`).
- **invariants after merge:** (a) omitting the field deserializes to `card` at every boundary (back-compat
  R-OLDCLIENT: old HTTP/WS/CLI callers unaffected); (b) `presentation` round-trips through HTTP and WS
  identically; (c) the existing top-right overlay behaves byte-for-byte as today; (d) all existing Rust +
  Vitest suites pass; (e) the payload carries ONLY the 27 `--s-*` overrides for skin, no geometry.
- **guards enforced:** G8 (not a `theme` overload), G9 (presentation is a transported field, not CLI-only),
  G12 (no per-notification geometry).
- **depends_on:** none (runs parallel with gates + harness).
- **known unknowns:** final field name (recommend `presentation`; PRD ratifies OQ-1).
- **acceptance/verify:** serde round-trip unit tests in all Rust type files; a CLI integration assertion
  that `syncfu send --presentation island` posts `"presentation":"island"` through the HTTP boundary
  (not just that types compile); default-omitted test proves `card`. `cargo test` + `pnpm test` green.
- **size:** S.
- **story map:** US-001 operator picks island presentation per notification.

### 5. T2 - Shape / spring / wall-inset port (pure frontend, no window plumbing)
- **goal:** Port the mockup's vanilla-JS shape generator, spring integrator, and wall-inset rule into
  typed, unit- and visually-testable frontend modules with ZERO Tauri dependency. Extract the shared
  27-override map so card and island never fork it (C8).
- **branch:** `feat/island-t2-shape-spring-port`
- **files to touch:** `src/lib/notchPath.ts` (new; `notchPath` + `capsulePath`, radii 6/14 -> 19/24,
  clamps `t<=min(W/4,H/4)`, `b<=min(W/4,H/2)`), `src/lib/spring.ts` (new; rAF damped-spring 220/25,
  400/30, 260/18, reduced-motion 1000/100, **eps=0.02 resting guard + rounding guard + `dispose()`**),
  `src/lib/styleVars.ts` (new; EXTRACT `buildStyleVars` + `STYLE_VAR_MAP` from `NotificationCard.tsx` so
  both renderers share one `--s-*` map), a dev harness route rendering each shape/state for Playwright.
  (Directory unified to `src/lib/`; C8.)
- **invariants after merge:** (a) `notchPath` output matches the mockup within tolerance at the D3 anchor
  cases; (b) the spring integrator reproduces the mockup settle behavior and swaps to 1000/100 under
  reduced-motion; (c) **A6: rests via the eps guard; `measure()` is one-shot, never wired into the
  per-frame loop or an unrounded resize feedback path; `dispose()` cancels the pending rAF**; (d)
  wall-inset math never lets content cross the concave shoulder (R-WALL, the 3x-recurring bug); (e)
  modules import nothing from `@tauri-apps/*`; (f) hover scale 1.028 top-anchored / 150ms open delay is
  implemented here and unit-covered (closes FR-6 gap F-LOW-1).
- **guards enforced:** G2 (hand-rolled spring, no motion lib), G3 (SVG path, not CSS mask), G4 (no canvas),
  G7 (spring not linear tween).
- **depends_on:** none (T0-HARNESS lets its screenshots run, but does not block the port).
- **known unknowns:** float-precision parity tolerance vs mockup (define with lane 06); resolve the
  mockup's own `+margin` drift (+4/+5/+2 across presets) to ONE rule per content type, and the 22-vs-24
  live/static float wall-radius drift to one value.
- **acceptance/verify:** unit tests on `notchPath` / wall-inset / hover-spring pure functions; Playwright
  screenshots of the harness route for each D3 shape state matching the mockup `shot-*` within threshold.
- **size:** M.
- **story map:** US "island morph feels native".

### 6. T3 - Island window plumbing + backend presentation routing
- **goal:** Create the dedicated `island` OS window (top-center, notch-hugging on macOS, floating capsule
  elsewhere), sized to the fixed expanded envelope and never frame-resized during morph (D3), created
  click-through. Add backend `notify()` routing by presentation so an island notification never pops the
  empty top-right panel (closes FR-3 backend-routing owner gap).
- **branch:** `feat/island-t3-window-and-routing`
- **files to touch:** `src-tauri/src/overlay/island.rs` (new; `ISLAND_LABEL`, `IslandEnvelope`,
  `calculate_island_anchor` pure fn, `create_island` / `show_island` / `hide_island` / `reflow_island` /
  `set_island_capture_protected`), `src-tauri/src/overlay/notch.rs` (new, macOS-gated; `NotchGeometry`
  from the G1 verdict), `src-tauri/src/overlay/mod.rs` (module wiring), `src-tauri/src/lib.rs` (create the
  island hidden in `.setup()` after `create_panel`; branch `notify()` on `payload.presentation` to
  `emit_to` the target window and show only it; route `dismiss`/`update` by the notification's stored
  presentation; `dismiss_all` broadcasts to both).
- **invariants after merge:** (a) `calculate_island_anchor` centers on the target monitor top edge with
  correct logical-pixel math across scale factors (mirror the 6 existing `calculate_panel_position` unit
  tests, centered variant); (b) the frame is held at the fixed envelope; morph happens inside, frame never
  resizes; (c) idle island is click-through (`ignore_cursor_events(true)`); (d) the existing `overlay`
  window is untouched and `show_panel`/`hide_panel` never act on the island (R-TWOWIN: distinct labels,
  independent position logic); (e) macOS island is an NSPanel with the same non-activating / all-Spaces /
  full-screen-auxiliary config as the current panel; (f) a `card` send behaves byte-identically to today.
- **guards enforced:** G1 (dedicated window; never repurpose overlay; content protection scoped to island).
- **depends_on:** G1 (geometry verdict), G2 (window TYPE decided before build), T1 (routing field exists).
- **known unknowns:** island targets the built-in notch display when a notch exists, else the cursor
  monitor (island-specific rule, differs from overlay); non-notch external display of a notched Mac falls
  back to floating capsule.
- **acceptance/verify:** centered-position unit tests across 1080p / retina 2x / 4k 1.5x / secondary-offset
  (parallel to the existing panel tests); an integration test that `card`-only send emits only to
  `overlay`, `island` send emits only to `island` and does not pop the panel; manual/driver check that the
  window appears top-center and does not resize on compact<->expanded toggle.
- **size:** M.
- **story map:** US "island anchored top-center / notch"; US-001 coexistence.

### 7. T4a - Island static render + routing + 27-override plumbing (C7 fix)
- **goal:** Render a single island notification (compact pill + expanded card, no morph animation yet)
  inside T3's window, wired through the CORRECT routing: `App.tsx` label branch -> new `IslandOverlay`
  host -> `Island`. `NotificationOverlay` excludes island items. Apply the 27 `--s-*` overrides to the
  expanded card via the extracted `styleVars.ts`.
- **branch:** `feat/island-t4a-static-render-routing`
- **files to touch (corrected per C7):** `src/App.tsx` (add `if (label === "island") return
  <IslandOverlay/>`), `src/components/island/IslandOverlay.tsx` (new; per-window event subscription,
  filters `presentation === "island"`), `src/components/island/Island.tsx` (new; host shell, static
  states), `src/components/island/IslandCompact.tsx` (new; leading glyph + trailing live-activity slot),
  `src/components/island/IslandExpanded.tsx` (new; icon/sender/title/body via `styleVars.ts` +
  `NotificationIcon` / `RelativeTime`), `src/components/overlay/NotificationOverlay.tsx` (ADD exclusion
  filter `presentation !== "island"` - defense in depth), `src/styles/island.css` (new).
- **invariants after merge:** (a) a `presentation:"island"` notification renders in the DEDICATED island
  window, never in the top-right overlay (C7 closed); (b) the `card` path is completely unchanged and
  pixel-identical to its pre-feature baseline; (c) all 27 `--s-*` overrides resolve to the SAME values in
  card and island (shared `styleVars.ts`); (d) compact pill is pure black in macOS notch mode regardless
  of appearance; (e) island notifications still reach `historyStore.prependEntry` (single ingest, two
  renderers; R-HISTORY, C2).
- **guards enforced:** G1 (renders in island window, not overlay).
- **depends_on:** T2 (styleVars + shape modules), T3 (window + routing).
- **known unknowns:** none material after C7.
- **acceptance/verify:** Vitest render tests for compact/expanded structure and the exclusion filter;
  Playwright snapshots of expanded basic / rich-body / critical against mockup references; a styled
  fixture proving the 27 overrides; a snapshot proving the top-right card is pixel-identical to baseline.
- **size:** M.
- **story map:** US "island shows agent status as pill, expands to card".

### 8. T4b - Morph engine + notch-black rule
- **goal:** Wire T2's spring engine into `Island.tsx` so the island morphs compact<->expanded inside the
  static frame, publishing `--di-wall` live and honoring the lifecycle default
  (arrive-expanded-then-collapse-to-pill, C4). Enforce the dispose/eps/rounding guards on the live loop.
- **branch:** `feat/island-t4b-morph-engine`
- **files to touch:** `src/components/island/Island.tsx` (rAF loop host, `setTargets`/`measure`/`frame`
  ported from the mockup controller, publishes `--di-wall`, exposes `window.__islandSettled`),
  `src/styles/island.css` (morph-driven vars).
- **invariants after merge:** (a) morph animates only the inner SVG path + content, the OS frame NEVER
  resizes (D3); (b) **A6: the loop rests via eps; `measure()` retarget is rounding-guarded and never wired
  into the per-frame loop; `dispose()` cancels the pending rAF on unmount / window-close** (R-RAF-DISPOSE,
  R-PERF); (c) arrive-expanded-then-collapse-to-pill is the default entry transition and exposes a
  collapse trigger for T5; (d) hover 1.028/150ms behaves per T2; (e) reduced-motion collapses the morph to
  ~1 frame; (f) the `window.__islandSettled` settle flag is published for the visual harness.
- **guards enforced:** G2 (no motion lib on the morph driver), G7 (spring not linear).
- **depends_on:** T4a, T2.
- **known unknowns:** live-activity animation (timer/ring/pulse) must be driven by cheap CSS
  transform/opacity, NOT the path-rewriting rAF, to keep idle cost at 0% (R-PERF split).
- **acceptance/verify:** unit test that `dispose()` during a non-resting spring cancels the pending frame
  and no further `path.setAttribute` fires (spy); Playwright full-motion morph snapshot via the settled
  hook, run 20x with zero diff variance; an idle-cost probe asserting no frames scheduled 500ms after a
  morph completes.
- **size:** M.
- **story map:** US "island morph feels native".

### 9. T5a - Functional parity: actions / --wait / timeouts / countdown
- **goal:** Bring island mode to functional parity for the action path: primary/secondary/danger actions,
  `--wait` blocking with exit codes 0/1/2, priority timeouts, and countdown, reusing the existing
  `action_callback` -> waiter path unchanged. Encode the A4 waiter-exemption at the action layer.
- **branch:** `feat/island-t5a-parity-actions-wait`
- **files to touch:** `src/components/island/IslandExpanded.tsx` (actions + countdown),
  `src/components/island/Island.tsx` (`--wait` stays-expanded-until-answered rule), no change to
  `src-tauri/src/server/waiters.rs` / `cli/src/wait.rs` (reuse).
- **invariants after merge:** (a) an island action click drives the SAME `action_callback` -> waiter ->
  CLI exit-code path as the card (no new transport); (b) `--wait` island notification stays expanded until
  answered, then resolves 0 (action) / 1 (dismiss) / 2 (timeout) identically to card; (c) critical never
  auto-dismisses; low/normal/high honor 6s/8s/12s; (d) **A4: a notification with a pending waiter keeps a
  1:1 id->waiter mapping and is never merged into another row** (R-WAIT-ID); (e) countdown reflects the
  timeout.
- **guards enforced:** parity contract (no island-specific timing); A4 waiter identity.
- **depends_on:** T4a, T4b, T1.
- **known unknowns:** inherited SSE false-dismiss on stream-end (`cli/src/wait.rs:74`) is pre-existing;
  flag, do not fix here.
- **acceptance/verify:** integration test that `syncfu send --presentation island --wait --action
  approve:Approve` returns 0 on approve, 1 on dismiss, 2 on timeout; the **two-waiters-same-dedupe-key
  collision test** asserts both resolve correctly (A4); critical-never-dismiss test; Playwright checks
  actions + countdown render.
- **size:** M.
- **story map:** US-002 approve/deny an agent request from the island.

### 10. T5b - Progress + lifecycle interruption state machine
- **goal:** Complete parity with progress (bar + ring) and implement the full compact/expanded lifecycle
  interruption state machine with every transition enumerated (closes FR-15 completeness gate).
- **branch:** `feat/island-t5b-progress-lifecycle`
- **files to touch:** `src/components/island/IslandExpanded.tsx` (progress bar + ring),
  `src/components/island/IslandCompact.tsx` (live-activity progress ring/timer),
  `src/components/island/Island.tsx` (lifecycle state machine + interruption transitions).
- **invariants after merge:** (a) progress updates via the existing `Update` flow re-render inside the
  island without frame resize; (b) the state machine matches the `04-risk` S1 interruption matrix and the
  `02-architecture` S7 table (hidden / compact / expanded / morphing / list-open) with every cell defined
  (no UNSPEC remaining, since C4 ratified the lifecycle default); (c) new-notification-mid-morph is
  latest-wins re-present (never a half-morph); (d) a progress event arriving after collapse updates the
  pill live-activity, and expand shows the current value, not a stale one; (e) live-activity animation is
  CSS transform/opacity, not the path-rewriting rAF (R-PERF).
- **guards enforced:** D3 never-animate-frame during interruptions.
- **depends_on:** T5a.
- **known unknowns:** monitor-change during morph teardown ordering is exercised here at the frontend
  level; the window-recreation ordering (make-before-break, protect-before-show) lands in T9.
- **acceptance/verify:** Vitest state-machine specs for each interruption row; Playwright settled-state
  snapshots for progress bar/ring compact and expanded; a mid-morph new-notification test asserting the
  frame never resizes.
- **size:** M.
- **story map:** US "long-running task progress in the island".

### 11. T6 - Model B overflow (Rust-owned rank/dedupe/count + dumb renderer) [C1/A3/A4]
- **goal:** Implement D5 Model B ONLY, with ownership resolved to G10 letter: rank/dedupe/cap/spotlight/
  count in the Rust `NotificationManager`, which emits a full authoritative island snapshot; the frontend
  `IslandList` is a dumb renderer. Dedupe key `group ?? sender::title`, waiter-bearing notifications
  exempt (A4).
- **branch:** `feat/island-t6-model-b`
- **files to touch:** `src-tauri/src/notification/manager.rs` (add priority ranking, dedupe by
  `group ?? sender::title` with waiter-exemption, 6-row cap, spotlight selection, count; build the island
  snapshot), `src-tauri/src/lib.rs` (emit `island:snapshot` on every change),
  `src/components/island/IslandList.tsx` (new; DUMB render of the snapshot: rows, stagger 40-60ms, bottom
  fade, scroll past 6/560px), `src/components/island/Island.tsx` (route single-vs-list from the snapshot;
  signal pause/resume of auto-dismiss while the list is open - the one round-trip G10 names),
  `src/styles/island.css` (list rows + bottom fade). NO frontend `rankDedupe.ts` (C1 supersedes it).
- **invariants after merge:** (a) with N>1 island notifications, compact shows the top-priority spotlight +
  correct badge width `26+8*(digits-1)` capping "9+"; (b) the list is priority-ranked (critical first),
  deduped, capped 6/560px then scrolls with a visible bottom fade; (c) **the ranked list, spotlight, and
  count are computed in Rust and the frontend renders only what it is handed** (G10, C1); (d) **a
  notification with a pending waiter is never merged** and each row maps 1:1 to its id/waiter (A4,
  R-WAIT-ID); (e) auto-dismiss pauses while the list is open and resumes on collapse; (f) Models A and C
  are NOT present, with a test asserting their absence (closes FR-13 gap F-LOW-2).
- **guards enforced:** G10 (Rust owns Model B), G11 (Model B only; A/C rejected).
- **depends_on:** T5a (per-row action wiring), T5b (list-open lifecycle state). C1 resolution is a
  precondition (now settled).
- **known unknowns:** none material after C1/C6/A4.
- **acceptance/verify:** Rust unit tests for ranking / dedupe(`group ?? sender::title`) / waiter-exemption
  / cap / spotlight / badge formula; a test asserting the store's independent queue is NOT used for the
  island snapshot (C1 divergence guard); Playwright snapshots of compact-grouped badge widths (2/10/100+)
  and expanded-list (6-row cap, scroll+fade, stagger 40-60ms) against grouped `shot-*` references; a test
  that timers pause while open; a test asserting Models A/C absent.
- **size:** M.
- **story map:** US "many concurrent agent notifications collapse into a ranked list".

### 12. T7a - Settings backend: model + persistence + IPC + TS types [C5]
- **goal:** Persist the 13 D4 settings as `island.settings.json` (plain serde JSON, no plugin), expose
  get/set IPC, and mirror the types to TS. No UI yet.
- **branch:** `feat/island-t7a-settings-backend`
- **files to touch:** `src-tauri/src/notification/settings.rs` (new; `IslandSettings` struct camelCase,
  `Default` = mockup DEFAULTS, `settings_path`, `load_settings` with clamp-and-default, `save_settings`
  with **atomic temp+rename**), `src-tauri/src/lib.rs` (register `get_island_settings` /
  `set_island_settings` / `set_island_interactive` in `generate_handler!`; on set: save, reflow if
  geometry changed, re-apply capture protection if the toggle changed, `emit_to("island",
  "island:settings")`), `src/types/islandSettings.ts` (new), `src/stores/islandSettingsStore.ts` (new).
- **invariants after merge:** (a) settings persist across restart; (b) defaults exactly match the mockup
  (218 / 380 / 34 / 0.94 / topR 6 / botR 14 / scaling true / #4a9eff / notch / center / dark / reduced
  false / hideCapture true); (c) each numeric knob clamps to its range (compactWidth 150-600, expandedWidth
  320-560, height 24-60, surfaceOpacity 0-100, **topRadius/bottomRadius per the FR-8 amendment ranges**);
  (d) `surfaceOpacity` affects fill alpha only; (e) a corrupt/truncated file falls back to defaults, never
  panics (R-SETTINGS-WRITE); (f) the notification payload schema is NOT extended with geometry (API-compat
  regression guard, G12).
- **guards enforced:** G6 (no SQLite for settings), G12 (geometry is app settings, not payload).
- **depends_on:** T4a (an island to reflect settings against). Locked by C5.
- **known unknowns:** the FR-8 topRadius/bottomRadius numeric ranges are a PRD amendment (see OQ list);
  T7a implements whatever the amendment fixes.
- **acceptance/verify:** Rust unit tests for serde defaults + clamping + corrupt-file fallback; a
  persistence round-trip test (write, reload, equal); an atomic-write test (partial write leaves the prior
  valid file intact).
- **size:** M.
- **story map:** US-004 user tunes island size/shape/accent.

### 13. T7b - Settings UI + live-push restyle
- **goal:** Add the island settings panel to the `main` window (porting the mockup playground controls),
  wire it to T7a's IPC, and prove a change restyles the live island without restart or resend.
- **branch:** `feat/island-t7b-settings-ui`
- **files to touch:** a settings panel component under `MainApp` (new; 13 controls),
  `src/stores/islandSettingsStore.ts` (optimistic set + invoke), `src/components/island/Island.tsx`
  (consume the store; re-target springs on `island:settings`, never snap).
- **invariants after merge:** (a) changing a setting updates island geometry/appearance without animating
  the OS frame (D3) and without a resend; (b) the island reads settings at creation AND on the change event
  (two independent paths; a lost event cannot leave stale geometry forever); (c) `position` values other
  than bottom-center are ignored in notch mode; bottom-center is rejected in notch mode.
- **guards enforced:** D3 (no frame animation on settings change).
- **depends_on:** T7a.
- **known unknowns:** settings UI lives in `main`, not the tray (a tray menu cannot host 13 controls).
- **acceptance/verify:** frontend test that a settings change updates the island CSS vars live; Playwright
  check that a width/radius change re-renders and the content-vs-shape invariant (section 4) still holds.
- **size:** M.
- **story map:** US-004.

### 14. T8 - Appearance (dark/light/auto) + float position (incl bottom-center)
- **goal:** Implement the remaining D4 render behaviors: appearance dark/light/auto (light restyles the
  expanded card + float pills; macOS notch compact pill STAYS black) and float-mode position
  left/center/right/bottom-center (bottom-center expands upward with the notch shape mirrored vertically).
- **branch:** `feat/island-t8-appearance-position`
- **files to touch:** `src/components/island/Island.tsx` + `src/styles/island.css` (light-theme vars,
  position anchors), `src/lib/notchPath.ts` (vertical-mirror path for bottom-center),
  `src-tauri/src/overlay/island.rs` (float anchor points), settings wiring from T7b.
- **invariants after merge:** (a) light appearance restyles the expanded card + float compact pills; the
  notch compact pill remains pure black in light mode; (b) auto follows `prefers-color-scheme`; (c) float
  positions anchor correctly incl bottom-center ~12px above the bottom edge expanding upward; (d)
  bottom-center shape is the notch path mirrored vertically when flush; (e) position is float-mode only.
- **guards enforced:** D4 notch-black rule.
- **depends_on:** T4a (render), T7a/T7b (settings expose appearance/position).
- **known unknowns:** exact light-mode surface tokens (pull from the mockup light stage, accent #0a84ff);
  bottom-center in notch mode is a no-op (float only).
- **acceptance/verify:** Playwright snapshots for dark/light/auto expanded cards and all four float
  positions incl bottom-center-expand-upward against the mockup light stage + anchoring trio.
- **size:** M.
- **story map:** US "light/auto appearance"; US "bottom-center island".

### 15. T9 - Capture-exclusion production wiring + honest per-OS status
- **goal:** Ship the real screen-capture invisibility with the A1 honest per-OS scoping: wire
  `set_content_protected(true)` (or the raw-AppKit path if G2 proved it needed) on the island window on
  macOS <= 14 and Windows 19041+, gate it behind `hideFromScreenCapture`, surface true OS-level status,
  and implement the documented Linux behavior.
- **branch:** `feat/island-t9-capture-exclusion`
- **files to touch:** `src-tauri/src/overlay/island.rs` (apply protection at window creation AND on toggle,
  in-place, never rebuild; re-apply on every window (re)creation - protect-before-show, make-before-break),
  settings consumption from T7a, Windows build-gate probe, Linux branch (honest disabled toggle +
  documented-limitation warning; optional auto-hide-while-capture-app-frontmost per the G2 decision).
- **invariants after merge:** (a) with `hideFromScreenCapture:true` the island is absent from macOS <= 14
  + Windows 19041+ capture; (b) **macOS 15+ surfaces the honest status (best-effort / documented
  limitation), never a silent green "hidden" (A1)**; (c) toggling the setting flips capture state live,
  in place, without dropping in-flight notifications; (d) Windows below 19041 disables the toggle with an
  explanation; (e) Linux never falsely claims invisibility (R-CAPTURE); (f) the top-right overlay window
  is unchanged.
- **guards enforced:** apply-first + honest UI (ON / UNSUPPORTED / UNKNOWN); never `.readOnly`; G1
  (protection scoped to the island window only, card untouched); public-API-only on macOS (R-MACOS-PRIVATE,
  no SkyLight).
- **depends_on:** G2 (proven mechanism + macOS 15 verdict), T7a (the toggle setting).
- **known unknowns:** per-OS automated verification is manual + best-effort smoke (lane 06 owns the
  harness); the macOS 15 auto-hide fallback is optional and gated on the user product call.
- **acceptance/verify:** the D1 dedicated capture-exclusion checklist from lane 06 - macOS <= 14 + macOS 15
  (SCK) + Windows manual capture probes showing absence-or-honest-status, toggle round-trip (prove OFF ->
  visible), Linux documented-behavior check. This gate MUST pass before T11.
- **size:** M.
- **story map:** US-003 island invisible during screen share/record.

### 16. T10 - Docs / README + CLI help + API docs
- **goal:** Document the island as a first-class feature: README section, `--presentation` help, HTTP/WS
  `presentation` field, settings reference (knobs, ranges, defaults, notch-vs-float), and the HONEST
  capture-exclusion matrix (guaranteed macOS <= 14 + Windows; macOS 15+ best-effort; Linux unsupported).
- **branch:** `feat/island-t10-docs`
- **files to touch:** `README.md` (or repo docs dir), CLI help strings (verify + expand examples), API
  docs for the HTTP/WS schema, a settings reference doc.
- **invariants after merge:** (a) every shipped flag/field/knob is documented with default and range; (b)
  the macOS 15 and Linux capture limitations are stated honestly (never claims invisibility not delivered);
  (c) docs match merged behavior of T1/T5/T7/T9 (no drift); (d) no AI-attribution anywhere.
- **depends_on:** T1, T5a/T5b, T7a/T7b, T9.
- **known unknowns:** where API docs live (confirm during the task).
- **acceptance/verify:** a docs reviewer checks each flag/field/knob against code; README example commands
  actually run.
- **size:** S.
- **story map:** US "operator can discover and configure the island from docs".

### 17. T11 - End-to-end acceptance (operator journey)
- **goal:** Prove the full operator journey end to end:
  `syncfu send --presentation island --wait --action approve:Approve --action deny:Deny:danger` arrives as
  an island, morphs, the operator approves from the island, and the CLI unblocks with the correct exit
  code, plus the multi-notification Model B path and the capture-exclusion state.
- **branch:** `feat/island-t11-e2e-journey`
- **files to touch:** new E2E specs (Playwright + tauri-driver, wired atop T0-HARNESS); no production code
  (bugs surfaced here spawn follow-up tasks).
- **invariants after merge:** (a) send -> island -> approve -> exit 0; deny -> exit 1 (or action-specific);
  timeout -> exit 2; (b) 3+ concurrent island notifications collapse to a Rust-owned Model B ranked list
  and each row's action resolves the right waiter (A4); (c) with `hideFromScreenCapture:true` the island
  is absent from a macOS <= 14 / Windows capture during the journey (macOS 15 recorded per the honest
  matrix); (d) settings changes reflect live during the journey; (e) the existing top-right card journey
  still passes (regression).
- **depends_on:** T5a, T5b, T6, T7a/T7b, T8, T9 (and T2/T3/T4a/T4b transitively); T0-HARNESS must have
  landed.
- **known unknowns:** tauri-driver availability on the CI matrix (lane 06 owns setup); capture exclusion is
  a manual checklist item, not fully automatable.
- **acceptance/verify:** the journey E2E suite green on macOS; Windows/Linux per the CI matrix; a manual
  capture-exclusion pass recorded. Final sign-off task.
- **size:** M.
- **story map:** US "operator approves an agent request from the island end to end".

---

## 4. SURVIVING RISKS (open after all mitigations)

| id | Surviving risk | Owning test / gate | Residual |
|----|----------------|--------------------|----------|
| **R-CAPTURE-macOS15** (PRODUCT-LEVEL) | ScreenCaptureKit ignores sharingType / content protection on macOS 15+; there is NO public-API fix (Apple DTS). The marketed "invisible during screen sharing" differentiator is **not deliverable on macOS 15+**. | G2 live SCK probe (proves the limitation, not the fix) + the T9 honest-status UI + the lane 06 manual release checklist. The only true mitigation is honest scoping + optional auto-hide fallback. | Open until the user makes the product-scoping call (see OQ-1 below). This narrows a category differentiator and is the single most consequential surviving risk. |
| R-WAIT-ID | Two `--wait` notifications sharing a dedupe key could still collapse if the waiter-exemption is mis-implemented, yielding a wrong exit code. | T5a two-waiters-same-dedupe-key collision test + T6 waiter-exemption unit test (A4). | Low after A4, but it is a silent-wrong-exit-code failure, so the collision test is mandatory. |
| R-WALL | Content overruns the concave shoulder while box-vs-box passes (recurred 3x). | Lane 06 content-vs-shape sweep ({compact,expanded} x {notch,float} x {min,default,max radius} x {150,default,640 width} x {chromium,webkit}) as the headline Playwright assertion; T2 `wallInset` unit tests. | Bounded by the sweep; the wide + max-radius + compact corner is the known regressor and is explicitly covered. |
| R-RAF-DISPOSE / R-PERF | A zombie rAF loop touching dead DOM on window teardown, or continuous live-activity animation pinning CPU. | T4b `dispose()` cancel test + idle-cost probe (no frames 500ms post-morph); live-activity driven by CSS transform/opacity, not the path rAF. | Low after A6 guards; the idle-cost probe is the standing guard. |
| R-C1-DIVERGENCE | The frontend store's independent queue could still be wired into the island by mistake, reintroducing the W1-W4 divergence. | T6 test asserting the island snapshot comes ONLY from the manager, not the store queue (G10 letter). | Low; the guard test is the ratchet. |
| R-VISUAL-BASELINE | Wrong-runner-OS baselines flake every snapshot (SF fonts + WKWebView vs WebView2). | T0-HARNESS macOS-runner-only webkit baseline; separate Windows chromium baseline; committed baselines with reviewed updates. | Low once the CI matrix is pinned; poisons the decisive layer if violated. |
| R-SSE-FALSE-DISMISS (inherited) | A dropped SSE stream reports a false Dismissed (exit 1); island's higher-stakes approvals make this more consequential. | Flagged in T5a; pre-existing, not fixed here. | Inherited; out of scope for this feature but recorded. |

---

## 5. COVERAGE RE-CHECK (every FR + D3/D4/D5 MUST has an owner-task and an owner-test)

Legend: **PRD-amendment** = requires an explicit PRD edit (listed at the end), not a silent change.

### FR coverage after resolutions

| FR | Owner task(s) | Owner test | Status vs Wave A |
|----|---------------|-----------|-------------------|
| FR-1 presentation field | T1 | serde round-trip + CLI-through-HTTP integration | OK |
| FR-2 senders cannot set geometry | T1 + T7a | payload-only-overrides test; geometry-ignored test | OK |
| FR-3 island+card coexist / routing | **T3 backend routing** + T4a App.tsx label + exclusion filter | card-only-emits-overlay / island-only-emits-island integration; card pixel-identical | **GAP CLOSED** (backend `notify()` routing now owned by T3; OQ-9 resolved: both coexist, one window per notification) |
| FR-4 notch anchor / float | G1 + T3 | `calculate_island_anchor` unit + platform trio | OK |
| FR-5 SVG path radii/clamps | T2 | path/clamp unit + shot-* + corner zoom | OK |
| FR-6 morph springs + hover 1.028/150ms + never animate frame | T2 (springs+hover) + T4b (loop) + T3 (frame held) | morph SM + spring determinism + **hover-spring unit (F-LOW-1 closed)** | **GAP CLOSED** (hover now owned by T2 + tested) |
| FR-7 wall-inset content-vs-shape | T2 -> T4a/T8 consume | content-vs-shape sweep (headline) | OK (strongest) |
| FR-8 13 settings ranges/defaults | T7a | settings clamp + round-trip | **GAP CLOSED via PRD-amendment** (topRadius/bottomRadius numeric ranges, below) |
| FR-9 settings app-wide | T7a | app-wide-not-per-notification test | OK |
| FR-10 light rules / notch black | T8 | theme cells + light stage | OK |
| FR-11 spotlight + xN badge | T6 (Rust) | badge formula unit | OK |
| FR-12 ranked deduped list cap/stagger/pause | T6 (Rust) | rank/dedupe/cap/stagger/pause tests; **A4 waiter-exemption** | OK (dedupe key + waiter-exempt now concrete) |
| FR-13 Models A/C rejected + guard | T6 | **explicit A/C-absent test (F-LOW-2 closed)** | **GAP CLOSED** |
| FR-14 functional parity | T5a + T5b | wait round-trip + timeout parity + progress | OK |
| FR-15 lifecycle + interruption states | T4b + T5b | interruption state-machine specs | **GAP CLOSED** (C4 ratifies the default; every cell now defined) |
| FR-16 click-through idle / no jank | T3 + T4b/T5b | US-002 Playwright + idle-cost probe | OK |
| FR-17 capture macOS/Windows | G2 + T9 | capture track + **macOS 15 SCK live probe** | OK with **PRD-amendment** (macOS 15 caveat) |
| FR-18 Linux documented behavior | G2 + T9 + T10 | Linux warning unit | OK |

### D3/D4/D5 locked-MUST coverage after resolutions

| Locked MUST | Owner task | Owner test | Status |
|---|---|---|---|
| D3 radii 6/14 -> 19/24 | T2 | path unit | OK |
| D3 clamps | T2 | clamp unit | OK |
| D3 springs 220/25, 400/30, 260/18, 1000/100 | T2 | spring + reduced-motion | OK |
| D3 hover 1.028 / 150ms | T2 | hover-spring unit | OK (was GAP) |
| D3 never animate OS frame | T3 + T4b | frame-never-resizes | OK |
| D4 compactWidth/expandedWidth/height/surfaceOpacity | T7a | clamp | OK |
| D4 topRadius/bottomRadius/cornerScaling | T7a | clamp | OK (PRD-amendment fixes ranges) |
| D4 accent presets + custom | T7a | theme cells | OK |
| D4 mode notch/float | T7a | platform trio | OK |
| D4 position incl bottom-center-up | T8 | anchoring | OK |
| D4 appearance dark/light/auto + notch black | T8 | light stage | OK |
| D4 reducedMotion 1000/100 | T2 | reduced-motion | OK |
| D4 hideFromScreenCapture | T7a + T9 | capture track | OK |
| D5 spotlight + xN badge | T6 | badge unit | OK |
| D5 ranked deduped list cap 6/560px scroll+fade | T6 | rank/cap/scroll | OK |
| D5 stagger 40-60ms, critical first | T6 | **stagger + critical-first test (F-LOW-2 closed)** | OK |
| D5 auto-dismiss paused while list open | T6 | pause test | OK |
| D5 Models A/C rejected | T6 | **A/C-absent test** | OK |
| D5 Model B ownership | **T6 Rust manager (G10 letter)** | Rust rank/dedupe unit; store-not-used guard | OK (C1 resolved) |
| D1 capture own track | G2 + T9 | dedicated per-OS track | OK (honest scoping) |

All 18 FRs and all D3/D4/D5 MUSTs now have an owner-task AND an owner-test. The five Wave A FR gaps
(FR-3, FR-6, FR-8, FR-13, FR-15) are closed as marked.

### PRD-amendment items (explicit edits required, not silent changes)

1. **FR-8 radius ranges (F-MED-3):** replace "(radius range)" / "per mockup" with numeric ranges for
   `topRadius` and `bottomRadius`. Recommended pending mockup-slider confirmation: `topRadius 0-20`
   (default 6), `bottomRadius 0-30` (default 14). Confirm the exact slider bounds against the mockup
   playground before T7a fixes them in code.
2. **FR-17 macOS 15 caveat (C3/A1):** amend to state capture exclusion is guaranteed on macOS <= 14 and
   Windows 19041+; on macOS 15+ it is best-effort with a documented limitation (SCK ignores the property;
   no public API) and the toggle surfaces honest status.
3. **FR-12 / FR-14 waiter-exemption (A4):** add the rule that notifications with a pending `--wait` waiter
   are exempt from Model B dedupe merging and keep a 1:1 id->waiter mapping.
4. **FR-15 / OQ-2 lifecycle (C4):** ratify arrive-expanded-then-collapse-to-pill as the default (pending
   user confirmation in the OQ list).
5. **OQ-6 dedupe key (C6):** fix the dedupe key to `group ?? sender::title` and delete "live-activity key".
6. **S7 / regression-surface wording (C2):** replace "history/SQLite" with "frontend history store".

---

## 6. OPEN QUESTIONS FOR THE HUMAN

Only decisions a human must make (they change user-visible behavior or a marketing claim):

- **OQ-1 (PRODUCT, highest stakes): macOS 15 capture scoping.** Accept the honest scoping - capture
  invisibility **guaranteed on macOS <= 14 + Windows**, **best-effort + documented limitation + optional
  auto-hide-while-capture-app-frontmost on macOS 15+** - given ScreenCaptureKit has no public exclusion
  API on macOS 15+ (Apple DTS)? This narrows a marketed category differentiator. If not accepted, the
  feature's privacy promise must be re-framed before ship. (Sub-question: ship the auto-hide fallback on
  macOS 15+, or disable the toggle with honest messaging like Linux?)
- **OQ-2 (BEHAVIOR): lifecycle default ratification.** Confirm **arrive-expanded-then-collapse-to-pill**
  (ratified-by-synthesis, built into T4b/T5b). If you prefer arrive-as-pill-expand-on-activity, say so
  before T4b starts; it reworks the entry transition and every interruption row.
- **OQ-3 (NAMING): presentation field final name.** Confirm `presentation` (values `card`/`island`,
  default `card`) as the payload field + CLI flag, vs `variant`. Recommendation: `presentation`. Locks
  before T1.
- **OQ-4 (SETTINGS): FR-8 radius ranges.** Confirm the exact `topRadius`/`bottomRadius` slider bounds from
  the mockup playground (recommended 0-20 / 0-30) so T7a clamps to real values, not a guess.
- **OQ-5 (LINUX): capture-toggle behavior.** Confirm Linux ships the toggle disabled with honest "not
  supported" messaging (risk lane recommends NO false-confidence fallback), vs attempting
  frontmost-capture-app detection. Recommendation: disabled + honest.

---

## RETURN SUMMARY

12-line summary of the reconciled plan:

1. Additive Dynamic Island: one new `presentation` field (default `card`), dedicated `island` window
   beside the untouched top-right overlay, routed by `App.tsx` label.
2. Window sized to a fixed envelope; the OS frame is never animated - only the inner SVG path + content
   morph via a ported hand-rolled rAF spring (no motion lib).
3. Model B ownership resolved to G10 LETTER: Rust `NotificationManager` owns rank/dedupe/cap/count and
   emits a full snapshot; the frontend `IslandList` is a dumb renderer.
4. Dedupe key = `group ?? sender::title` everywhere; notifications with pending `--wait` waiters are
   exempt from dedupe (preserves exit codes 0/1/2).
5. Settings = plain serde JSON `island.settings.json` (no plugin), atomic write, clamp-on-read, edited
   from `main`, live-pushed to the island by event.
6. Capture exclusion rescoped honestly: guaranteed macOS <= 14 + Windows; macOS 15+ best-effort +
   documented limitation (SCK ignores the property, no public API); Linux unsupported.
7. G2 gate is now a LIVE ScreenCaptureKit capture probe on macOS 15 (+ a macOS <= 14 check), never a
   property read-back; G1 uses `objc2-app-kit 0.3` on the main thread (A2, near-certain).
8. History is the frontend `historyStore` (no SQLite); single ingest, two renderers.
9. Spring port keeps eps + adds measure-rounding + `dispose()` guards; live-activity animation is CSS,
   not the path rAF (protects idle CPU).
10. Content-vs-shape `--di-wall` sweep is the headline visual assertion (box-vs-box is the floor only).
11. Task count = **17** (Playwright harness earliest gate + G1/G2 + the 13 originals with T4/T5/T7 split
    a/b per A5 = 16, plus the harness = 17), in a valid DAG, e2e operator journey last.
12. All 18 FRs and all D3/D4/D5 MUSTs now have an owner-task and an owner-test; the five Wave A FR gaps
    (FR-3/6/8/13/15) are closed; six PRD-amendment edits are itemized rather than silently applied.

**Final task count: 17** (T0-HARNESS, G1, G2, T1, T2, T3, T4a, T4b, T5a, T5b, T6, T7a, T7b, T8, T9, T10,
T11).

Open questions for the human (5):
- OQ-1 macOS 15 capture scoping (product call; narrows a marketed differentiator).
- OQ-2 lifecycle default ratification (arrive-expanded-then-collapse-to-pill).
- OQ-3 presentation field final name (`presentation` vs `variant`).
- OQ-4 FR-8 topRadius/bottomRadius numeric ranges (confirm from mockup).
- OQ-5 Linux capture-toggle behavior (disabled+honest vs frontmost-app detection).
