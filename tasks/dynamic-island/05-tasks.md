# Lane 05 - Task Decomposition (Dynamic Island notification)

**/think framework(s):** Theory-of-Constraints critical-path sequencing + dependency-DAG topological
ordering + first-principles vertical-slice decomposition (each task is one worktree, one PR, one
shippable slice; platform unknowns front-loaded as isolated de-risking gates so the critical path
never blocks on a surprise).

**Scope:** PLAN ONLY. This lane produces the ordered build sheet for `orchestrator-implementor`. No
code is written here. Base branch: `main`. Regression surface to protect on every task: existing
top-right overlay behavior, HTTP `:9868` / WS `:9869` API compatibility, CLI flag compatibility,
SQLite history. The 6 Meetily KPIs do NOT apply (this is syncfu).

---

## 0. Grounding (verified against repo this session)

The "tri-file" model enum pattern is actually a **five-touch-point** plumbing path for any new
payload field. A new `presentation` field must be threaded through all of:

| # | File | Role | Verified |
|---|------|------|----------|
| 1 | `cli/src/main.rs` (Send subcommand, lines 33-104) | new `--presentation` clap flag | yes |
| 2 | `cli/src/types.rs` (`NotifyRequest`, lines 163-187) | serialize field to server | yes |
| 3 | `cli/src/client.rs` | populate the request struct | yes (dir listing) |
| 4 | `src-tauri/src/server/http.rs` (`NotifyRequest` 34-58; payload build ~136-140) | deserialize + map to payload | yes |
| 5 | `src-tauri/src/notification/types.rs` (`NotificationPayload`, 171-199) | canonical model + enum | yes |
| 6 | `src/types/notification.ts` (`NotificationPayload`, 58-75) | frontend model | yes |

Overlay window today: `src-tauri/src/overlay/panel.rs` - ONE window, pinned top-right via
`calculate_panel_position()` (unit-tested, 6 tests). Frontend: `src/components/overlay/
NotificationOverlay.tsx` renders a `NotificationCard` stack and self-resizes via
`getCurrentWindow().setSize`. No animation library installed.

Settings JSON shape (authoritative, from mockup `renderJSON()` lines 1170-1178):
`{ island: { compactWidth, expandedWidth, height, surfaceOpacity, topRadius, bottomRadius,
cornerScaling, accent, mode, position, appearance, reducedMotion, hideFromScreenCapture } }`.
Defaults (mockup `DEFAULTS` line 1123): w 218, expW 380, h 34, opacity 94, topR 6, botR 14,
scaling true, accent #4a9eff, mode notch, position center, appearance dark, reduced false,
hideCapture true.

Reference implementations to PORT (do not reinvent) live in `tasks/dynamic-island-mockup.html`:
`notchPath()` Bezier shape generator with clamps, rAF damped-spring integrator (220/25, 400/30,
260/18, 1000/100), `--di-wall` wall-inset content rule, Model B ranked-list logic.

---

## 1. Build order at a glance (critical path in **bold**)

```
Wave 0 (gates, parallel):     G1        G2
Wave 1 (foundations, parallel): T1      T2
Wave 2 (island core):         **T3 -> T4 -> T5**
Wave 3 (features, parallel):    T6   T7   T8   T9
Wave 4 (close-out):             T10      **T11**
```

Critical path: G1/G2 -> T1 -> T3 -> T4 -> T5 -> T11. Everything in Wave 3 can proceed in parallel
once its own dependency is merged. T2 (pure-frontend port) is deliberately decoupled from window
plumbing so shape/motion work and Rust window work proceed simultaneously.

---

## 2. Tasks

### G1 - GATE: notch-geometry access from Tauri
- **id:** G1
- **goal:** Produce a written verdict on how Rust/Tauri reads the physical notch width so the island
  can hug it. Deliverable is a **verdict + minimal proof snippet in the PR description**, NOT shipped
  code. Resolves provenance gap "Tauri access path to NSScreen auxiliaryTopLeftArea/
  auxiliaryTopRightArea".
- **files to touch:** none merged to `src/`; a throwaway spike may live in a scratch binary or a
  `#[cfg(test)]`/example under `src-tauri/examples/notch_probe.rs` that is NOT part of the shipped
  build. PR body carries the findings.
- **investigate:** (a) `objc2`/`objc2-app-kit` `NSScreen.auxiliaryTopLeftArea` +
  `auxiliaryTopRightArea` reachability from a Tauri process; (b) whether the `tauri-nspanel` raw
  `NSWindow`/`NSScreen` handle is exposable; (c) the boring.notch formula
  `notchWidth = screen.width - auxLeft - auxRight + 4`; (d) non-notch fallback bar size (~185x32).
- **invariants after merge:** a documented, reproducible way to obtain notch width (or a definitive
  "not reachable, use fallback X" verdict) exists; T3 can start without further platform research.
- **dependencies:** none.
- **known unknowns:** macOS version differences in the auxiliary-area API; behavior on external
  non-notch display of a notched Mac (record it, do not solve here).
- **acceptance/verify:** PR description contains: the chosen access path, a code snippet that prints a
  plausible notch width on a notched Mac and a fallback value on a non-notch display, and a
  go/no-go statement for T3. Reviewer confirms the snippet compiles in the syncfu toolchain.
- **size:** S.
- **owns MUST:** "macOS hugs the physical notch" (geometry half; render half is T3/T4).
- **provisional story map:** US "island hugs the notch on MacBooks".

### G2 - GATE: capture exclusion on the island window
- **id:** G2
- **goal:** Verdict + proof that `set_content_protected(true)` actually excludes the island window
  from screen capture on the window type we will ship - specifically the **macOS `tauri-nspanel`
  NSPanel** (D1 catastrophic-if-wrong surface) and the **Windows always-on-top WebviewWindow (WDA)**.
  Deliverable is a written verdict + proof screenshots in the PR description, NOT shipped code.
  Resolves provenance gap "does set_content_protected work on the tauri-nspanel window type".
- **files to touch:** none merged; throwaway spike only. If the finding is "does not work on
  NSPanel," the PR body must record the raw-AppKit fallback (`sharingType = .none` via the panel's
  `NSWindow` handle, per NotchPrompter `updateScreenRecordingVisibility()` and boring.notch
  `updateSharingType()`).
- **invariants after merge:** a proven mechanism to make the island invisible to capture on macOS
  AND Windows is documented; the Linux gap is confirmed as "no reliable API" with the fallback
  decision (auto-hide while a known capture app is frontmost, or visible + warn) named for T9.
- **dependencies:** none.
- **known unknowns:** whether NSPanel + `NSWindowSharingNone` interacts with `full_screen_auxiliary`
  collection behavior already set in `panel.rs`; screenshot-based verification method per OS.
- **acceptance/verify:** PR description shows a capture attempt (QuickTime/OBS on macOS; Game Bar or
  a capture API probe on Windows) in which the island is absent, plus the exact API call path used.
  Explicit go/no-go for T9.
- **size:** S.
- **owns MUST:** "hidden during screen sharing" (feasibility proof; production wiring is T9).
- **provisional story map:** US "invisible during screen sharing".

### T1 - Presentation kind field (five-touch-point plumbing)
- **id:** T1
- **goal:** Add an additive `presentation` field (`"card" | "island"`, default `"card"`) end to end,
  changing NO rendering yet. Selecting `island` currently still renders the existing card; this PR
  only makes the field exist and survive the transport. Unblocks all island routing. Resolves
  provenance gap "kind-selection API name and default".
- **decision to lock in this PR:** field name `presentation`, values `card`/`island`, CLI flag
  `--presentation <card|island>`, default `card` everywhere. (Coordinate final naming with PRD lane
  01; `presentation` is this lane's recommendation over `variant`/`theme`.)
- **files to touch:** `cli/src/main.rs` (Send flag), `cli/src/types.rs` (`NotifyRequest` + enum +
  `FromStr`), `cli/src/client.rs` (populate), `src-tauri/src/server/http.rs` (`NotifyRequest` field +
  payload mapping ~line 136), `src-tauri/src/notification/types.rs` (`Presentation` enum +
  `NotificationPayload.presentation` with `#[serde(default)]`), `src/types/notification.ts`
  (`Presentation` type + field).
- **invariants after merge:** (a) omitting the field deserializes to `card` on every boundary
  (back-compat: all existing HTTP/WS/CLI callers unaffected); (b) `presentation` serializes
  camelCase and round-trips through HTTP and WS identically; (c) existing top-right overlay behavior
  is byte-for-byte unchanged; (d) all existing Rust + Vitest suites still pass.
- **dependencies:** none (can run parallel with gates).
- **known unknowns:** none material; naming is the only open item, flagged above.
- **acceptance/verify:** new serde round-trip unit tests in all three Rust type files; a CLI
  integration assertion that `syncfu send --presentation island` posts `"presentation":"island"`;
  default-omitted test proves `card`. `cargo test` + `pnpm test` green.
- **size:** S.
- **owns MUST:** "new kind selectable per notification (payload field + CLI flag), additive".
- **provisional story map:** US "operator picks island presentation per notification".

### T2 - Shape / spring / wall-inset port (pure frontend, no window plumbing)
- **id:** T2
- **goal:** Port the mockup's vanilla-JS shape generator, spring integrator, and wall-inset rule into
  typed, unit- and visually-testable frontend modules with ZERO Tauri/window dependency. Isolated
  from T3 on purpose.
- **files to touch:** new `src/components/island/notchPath.ts` (Bezier path + clamps
  `t<=min(W/4,H/4)`, `b<=min(W/4,H/2)`, radii 6/14 -> 19/24), `src/components/island/spring.ts` (rAF
  damped-spring integrator: container 220/25, content 400/30, pop 260/18, reduced-motion 1000/100),
  `src/components/island/wallInset.ts` (`--di-wall`, `padding = max(base, wall+margin)`), a Storybook-
  free dev harness route (e.g. `src/island-harness.html` + entry) that renders each shape/state for
  Playwright.
- **invariants after merge:** (a) `notchPath` output matches the mockup's path within tolerance for
  the D3 anchor cases (compact 218x34, expanded 380x variable); (b) spring integrator reproduces the
  mockup's settle behavior and honors reduced-motion by swapping to 1000/100; (c) wall-inset math
  never lets content cross the concave shoulder (the recurring 3x content-vs-shape bug - see risk
  lane cross-ref); (d) modules import nothing from `@tauri-apps/*`.
- **dependencies:** none.
- **known unknowns:** exact float precision parity vs mockup (define a tolerance with test-strategy
  lane 06); whether to keep the hand-rolled spring or adopt `motion` (architecture lane 02 decides;
  this task assumes hand-rolled per the mockup and research tilt - if 02 picks `motion`, T2's
  spring.ts becomes a thin adapter, same public API).
- **acceptance/verify:** unit tests on `notchPath`/`wallInset` pure functions; Playwright screenshots
  of the harness route for each D3 shape state (compact idle/timer/ring/grouped; expanded basic/
  actions/progress/critical) matching the mockup's `shot-*` references within threshold.
- **size:** M.
- **owns MUST:** D3 shape + motion numbers (the math); wall-inset content invariant.
- **provisional story map:** US "island morph feels native (spring, no linear tween)".

### T3 - Island window plumbing (top-center / notch anchor, hold-at-expanded)
- **id:** T3
- **goal:** Create the island's OS window: anchored top-center, notch-hugging on macOS, floating
  capsule elsewhere; sized to the EXPANDED footprint and never resized during morph (D3: never
  animate the OS frame). Idle window stays click-through.
- **files to touch:** `src-tauri/src/overlay/panel.rs` (or new `src-tauri/src/overlay/island.rs` +
  `mod.rs`), new `src-tauri/src/overlay/notch.rs` (geometry from G1 verdict), position math analogous
  to `calculate_panel_position` but centered.
- **decision to lock:** one dedicated island window separate from the top-right overlay window (so
  both presentations can coexist; coordinate with architecture lane 03 which adjudicates
  one-shared-window vs dedicated - this lane recommends dedicated for coexistence and independent
  capture-protection state).
- **invariants after merge:** (a) island window centers on the cursor's monitor top edge with correct
  logical-pixel math across scale factors (mirror the existing 6 position unit tests, centered
  variant); (b) window is held at expanded size; morph happens inside via CSS/SVG, frame never
  resizes; (c) idle island is click-through; (d) existing top-right overlay window is untouched and
  still works; (e) macOS uses NSPanel (non-activating, joins all Spaces) like the current panel.
- **dependencies:** G1 (geometry), G2 (so the window type chosen is capture-excludable), T1 (routing
  field exists).
- **known unknowns:** multi-monitor target selection (which monitor hosts the island - reuse cursor-
  monitor logic); non-notch external display of a notched Mac (fall back to floating capsule).
- **acceptance/verify:** centered-position unit tests across 1080p / retina 2x / 4k 1.5x / secondary-
  offset (parallel to existing panel tests); manual/Playwright-driver check that the window appears
  top-center and does not resize when the frontend toggles compact/expanded.
- **size:** M.
- **owns MUST:** "anchor top-center", "hold panel at expanded size, never animate window frame",
  click-through-when-idle.
- **provisional story map:** US "island anchored top-center / notch".

### T4 - Basic island render + morph (single notification)
- **id:** T4
- **goal:** The React island component: compact pill <-> expanded card morph for a SINGLE
  notification, using T2's shape/spring modules inside T3's window. Compact = leading glyph + trailing
  live activity; expanded = icon/sender/title/body. Pure-black compact pill in notch mode.
- **files to touch:** new `src/components/island/Island.tsx`, `src/components/island/CompactPill.tsx`,
  `src/components/island/ExpandedCard.tsx`, new `src/styles/island.css` (honors the 27 `--s-*`
  overrides), routing in `src/components/overlay/NotificationOverlay.tsx` (render Island when
  `presentation === "island"`, else existing stack).
- **invariants after merge:** (a) a single `presentation:"island"` notification renders as an island
  and morphs compact<->expanded without frame resize; (b) `presentation:"card"` path is completely
  unchanged; (c) all 27 `--s-*` overrides apply to the expanded card exactly as they do to
  `NotificationCard`; (d) compact pill is pure black in macOS notch mode regardless of appearance.
- **dependencies:** T2, T3.
- **known unknowns:** lifecycle default (arrive-expanded-then-collapse vs arrive-compact-expand-on-
  activity) - **decide with PRD lane 01**; this task implements arrive-expanded-then-collapse-to-pill
  as the recommended default and exposes the collapse trigger so T5 can wire `--wait`.
- **acceptance/verify:** Vitest render tests for compact/expanded structure; Playwright screenshots of
  the D3 expanded states (basic / rich-body / critical) against mockup references; verify the 27
  overrides via a styled fixture.
- **size:** L.
- **owns MUST:** "two states, one morph"; "expanded shows icon/sender/title/body"; 27 overrides in
  island mode; light/dark compact-pill rule (notch stays black).
- **provisional story map:** US "island shows agent status as pill, expands to card".

### T5 - Functional parity + lifecycle
- **id:** T5
- **goal:** Bring island mode to full functional parity with the card: actions (primary/secondary/
  danger), `--wait` blocking decisions with exit codes 0/1/2, timeouts by priority (critical never
  auto-dismisses), progress (bar/ring), countdown, and the compact/expanded lifecycle triggers.
- **files to touch:** `src/components/island/ExpandedCard.tsx` (actions/progress/countdown),
  `src/components/island/Island.tsx` (lifecycle state machine + `--wait` stays-expanded-until-answered
  rule), reuse existing `action_callback` invoke path and waiter flow (`src-tauri/src/server/
  waiters.rs`, `cli/src/wait.rs`) unchanged.
- **invariants after merge:** (a) an island action click drives the SAME `action_callback` ->
  waiter -> CLI exit-code path as the card (no new transport); (b) `--wait` island notification stays
  expanded until the user answers, then resolves with the correct exit code; (c) critical island
  notifications never auto-dismiss; low/normal/high honor 6s/8s/12s; (d) progress updates via the
  existing `Update` flow re-render inside the island without frame resize; (e) countdown reflects
  timeout.
- **dependencies:** T4, T1.
- **known unknowns:** interruption states (a higher-priority notification arriving mid-`--wait`; a
  progress update arriving during collapse animation) - enumerate with risk lane 04; this task must
  define the state machine's interrupt transitions, not leave them implicit.
- **acceptance/verify:** integration test that `syncfu send --presentation island --wait --action
  approve:Approve` returns exit 0 on approve, 1 on dismiss, 2 on timeout; Playwright checks actions/
  progress/countdown render and function; critical-never-dismiss test.
- **size:** L.
- **owns MUST:** functional parity (actions, `--wait`, timeouts, progress, countdown); lifecycle
  model; interruption/resume states for the single-island state machine.
- **provisional story map:** US "approve/deny an agent request from the island"; US "long-running
  task progress in the island".

### T6 - Model B overflow (spotlight + count badge -> ranked scrollable list)
- **id:** T6
- **goal:** Implement D5 Model B ONLY. Compact = highest-priority spotlight item + `xN` badge (width
  `26 + 8*(digits-1)`, caps at 9+); expand -> priority-ranked, deduped list capped 6 rows / 560px
  then scrolls with a bottom fade; rows stagger 40-60ms; critical first; auto-dismiss paused while
  list open. Port the mockup's Model B logic.
- **files to touch:** new `src/components/island/IslandList.tsx`, `src/components/island/rankDedupe.ts`
  (priority ranking + dedupe-key), `src/components/island/Island.tsx` (route single vs list),
  `src/styles/island.css` (list rows, bottom fade).
- **invariants after merge:** (a) with N>1 island notifications, compact shows the top-priority
  spotlight + correct badge width/caps; (b) list is priority-ranked, deduped, capped 6/560px, then
  scrolls with a visible bottom fade; (c) auto-dismiss timers pause while the list is open and resume
  on collapse; (d) critical always ranks first; (e) Models A and C are NOT present (guard against
  resurrection - see alternatives lane 03).
- **dependencies:** T5 (needs a working functional single island + action wiring per row).
- **known unknowns:** dedupe-key semantics (by `group`? by a live-activity key?) and how list rows map
  to per-item actions/callbacks/`--wait` - research suggests dedupe by group/live-activity key;
  **confirm mapping with architecture lane 02 and PRD lane 01**.
- **acceptance/verify:** unit tests on `rankDedupe` (ranking, dedupe, cap); Playwright screenshots of
  compact-grouped (badge widths for 2/10/100+) and expanded-list (6-row cap, scroll+fade, stagger)
  against the mockup's grouped `shot-*` references; test that timers pause while open.
- **size:** M.
- **owns MUST:** all D5 Model B behaviors; rejected-models guard.
- **provisional story map:** US "many concurrent agent notifications collapse into a ranked list".

### T7 - Settings (schema, persistence, IPC, UI)
- **id:** T7
- **goal:** Persist the D4 island settings (the mockup's `ISLAND.SETTINGS.JSON`) as APP settings (not
  per-notification), expose them to the overlay via IPC, and provide a settings UI. Payload keeps ONLY
  the existing 27 `--s-*` overrides (senders never control geometry).
- **files to touch:** new `src-tauri/src/settings/mod.rs` (typed `IslandSettings` struct + defaults),
  persistence (tauri-plugin-store or a JSON config file - **architecture lane 02 picks the
  mechanism**), IPC command registration in `src-tauri/src/lib.rs` (get/set), new
  `src/types/islandSettings.ts`, new settings UI surface (main window route/component), consume
  settings in `src/components/island/Island.tsx`.
- **invariants after merge:** (a) settings persist across app restarts; (b) defaults exactly match the
  mockup (218/380/34/0.94/6/14/scaling true/#4a9eff/notch/center/dark/reduced false/hideCapture true);
  (c) each knob is clamped to its documented range (compactWidth 150-600, expandedWidth 320-560,
  height 24-60, opacity 0-100); (d) `surfaceOpacity` affects fill alpha ONLY; (e) changing a setting
  restyles the live island without restart; (f) the notification payload schema is NOT extended with
  geometry (regression guard on API compat).
- **dependencies:** T4 (island must render to reflect settings). Runs parallel to T5/T6.
- **known unknowns:** persistence backend + IPC event name (architecture lane 02); settings-UI
  location (main window vs tray). Note: `hideFromScreenCapture` toggle is defined here but WIRED by
  T9; `appearance`/`position` are defined here but their RENDER behavior is T8.
- **acceptance/verify:** Rust unit tests for serde defaults + clamping; a persistence round-trip test;
  frontend test that a settings change updates island CSS vars; verify payload rejects/ignores
  geometry fields.
- **size:** L.
- **owns MUST:** D4 knobs compactWidth / expandedWidth / height / surfaceOpacity / topRadius /
  bottomRadius / cornerScaling / accent / mode; persistence; senders-never-control-geometry split.
- **provisional story map:** US "user tunes island size/shape/accent in settings".

### T8 - Appearance (dark/light/auto) + position (float modes incl bottom-center)
- **id:** T8
- **goal:** Implement the remaining D4 render behaviors: `appearance` dark/light/auto (light restyles
  expanded card + float pills to light frosted/dark text; macOS notch compact pill STAYS black); and
  float-mode `position` left/center/right/**bottom-center** (bottom-center expands upward with the
  notch shape mirrored vertically when flush - user-requested 2026-07-20).
- **files to touch:** `src/components/island/Island.tsx` + `src/styles/island.css` (light theme vars,
  position anchors), `src/components/island/notchPath.ts` (vertical-mirror for bottom-center),
  positioning in `src-tauri/src/overlay/island.rs` (float anchor points), settings UI wiring from T7.
- **invariants after merge:** (a) light appearance restyles expanded card + float compact pills; notch
  compact pill remains pure black in light mode; (b) auto follows `prefers-color-scheme`; (c) float
  positions anchor correctly incl bottom-center anchored ~12px above the bottom edge and expanding
  upward; (d) bottom-center shape is the notch path mirrored vertically when flush; (e) position is
  float-mode only (disabled/ignored in notch mode).
- **dependencies:** T4 (render), T7 (settings expose appearance/position).
- **known unknowns:** exact light-mode surface tokens (pull from mockup light stage
  `appearance:"light"`, accent #0a84ff); bottom-center on notch mode is a no-op (float only) - confirm.
- **acceptance/verify:** Playwright screenshots for dark/light/auto expanded cards and all four float
  positions incl bottom-center-expand-upward against the mockup's light stage + anchoring trio.
- **size:** M.
- **owns MUST:** appearance dark/light/auto; light-mode notch-black rule; bottom-center position;
  float positions.
- **provisional story map:** US "light/auto appearance"; US "bottom-center island".

### T9 - Capture exclusion production wiring + dedicated verification track
- **id:** T9
- **goal:** Ship the actual screen-capture invisibility (D1's own verification track): wire
  `set_content_protected(true)` (or the G2 raw-AppKit fallback) on the island window on macOS +
  Windows, gate it behind the `hideFromScreenCapture` setting, and document + implement the Linux
  fallback.
- **files to touch:** `src-tauri/src/overlay/island.rs` (apply protection at window creation + on
  toggle), settings consumption from T7, Linux branch (documented limitation + optional auto-hide-
  while-capture-app-frontmost per G2 decision).
- **invariants after merge:** (a) with `hideFromScreenCapture:true` (default) the island is absent
  from macOS + Windows screen capture; (b) toggling the setting off makes it capturable and back on
  re-excludes it, live; (c) Linux behavior matches the documented decision and never falsely claims
  invisibility; (d) the top-right overlay window's behavior is unchanged.
- **dependencies:** G2 (proven mechanism), T7 (the toggle setting).
- **known unknowns:** per-OS automated verification in CI (likely manual + a documented probe; test-
  strategy lane 06 owns the harness); Windows WDA edge cases with always-on-top.
- **acceptance/verify:** the D1 dedicated capture-exclusion checklist from test-strategy lane 06 -
  macOS + Windows manual capture probe showing absence, toggle round-trip, Linux documented-behavior
  check. This is the gate that MUST pass before T11.
- **size:** M.
- **owns MUST:** "hidden during screen sharing (mandatory)"; `hideFromScreenCapture` knob wiring;
  Linux fallback decision.
- **provisional story map:** US "island invisible during screen share/record".

### T10 - Docs / README + CLI help + API docs
- **id:** T10
- **goal:** Document the island presentation as a first-class feature: README section, `syncfu send
  --presentation` help text, HTTP/WS `presentation` field in API docs, and the settings reference
  (knobs, ranges, defaults, notch-vs-float, capture-exclusion caveat incl the Linux limitation).
- **files to touch:** `README.md` (or repo docs dir), CLI help strings already added in T1 (verify +
  expand examples), API docs wherever the HTTP/WS schema is documented, a settings reference doc.
- **invariants after merge:** (a) every shipped flag/field/knob is documented with its default and
  range; (b) the Linux capture-exclusion limitation is stated honestly; (c) docs match the actual
  merged behavior of T1/T5/T7/T9 (no drift). No AI-attribution anywhere.
- **dependencies:** T1, T5, T7, T9 (documents their surfaces). Can draft earlier, finalize after.
- **known unknowns:** where API docs live (confirm during the task).
- **acceptance/verify:** a docs reviewer checks each flag/field/knob against the code; example
  commands in the README actually run.
- **size:** S.
- **owns MUST:** "docs/README + CLI help + API docs updates are owned tasks, not afterthoughts".
- **provisional story map:** US "operator can discover and configure the island from docs".

### T11 - End-to-end acceptance (operator journey)
- **id:** T11
- **goal:** Prove the full operator journey end to end as its own acceptance task:
  `syncfu send --presentation island --wait --action approve:Approve --action deny:Deny:danger ...`
  arrives as an island, morphs, the operator approves from the island, and the CLI unblocks with the
  correct exit code - the "approve-from-island --wait roundtrip". Plus the multi-notification Model B
  path and the capture-exclusion state.
- **files to touch:** new E2E specs (Playwright + tauri-driver once introduced by test-strategy lane
  06); no production code (bug fixes surfaced here spawn follow-up tasks).
- **invariants after merge:** (a) the send->island->approve->exit-0 roundtrip passes; deny->exit-1
  (or action-specific); timeout->exit-2; (b) 3+ concurrent island notifications collapse to a Model B
  ranked list and each row's action resolves the right waiter; (c) with `hideFromScreenCapture:true`
  the island is absent from a capture during the journey; (d) settings changes (size/appearance/
  position) reflect live during the journey; (e) existing top-right card journey still passes
  (regression).
- **dependencies:** T5, T6, T7, T8, T9 (and T2/T3/T4 transitively).
- **known unknowns:** tauri-driver availability on the CI matrix (test-strategy lane 06 owns setup);
  which parts are automatable vs manual-checklist (capture exclusion likely manual).
- **acceptance/verify:** the journey E2E suite is green on macOS; Windows/Linux run per the CI matrix
  from lane 06; a manual capture-exclusion pass is recorded. This is the final sign-off task.
- **size:** M.
- **owns MUST:** the end-to-end operator journey (the completeness-gate acceptance requirement).
- **provisional story map:** US "operator approves an agent request from the island end to end".

---

## 3. MUST-ownership matrix (completeness gate)

| MUST (from brief / D-decisions) | Owning task |
|---|---|
| New `presentation` kind + CLI flag, additive | T1 |
| Anchor top-center; macOS hugs notch | G1 (geometry) + T3 (window) + T4 (render) |
| Two states, one morph (compact<->expanded) | T4 |
| D3 shape/spring/radii/clamp/hover numbers | T2 |
| Hold panel at expanded size, never animate frame | T3 |
| Reduced-motion (1000/100) | T2 |
| 27 `--s-*` overrides in island mode | T4 |
| Actions / `--wait` / timeouts / progress / countdown parity | T5 |
| Lifecycle + interruption states | T5 |
| D5 Model B (spotlight+badge / ranked list / pause / caps / stagger) | T6 |
| Rejected models A/C guard | T6 |
| D4 geometry knobs + persistence + IPC + UI | T7 |
| surfaceOpacity = fill alpha only | T7 |
| Senders never control geometry (payload = 27 overrides only) | T1 + T7 |
| Appearance dark/light/auto + notch-black rule | T8 |
| Position float modes incl bottom-center (expand upward) | T8 |
| Hidden during screen sharing (macOS/Windows) | G2 (proof) + T9 (ship) |
| `hideFromScreenCapture` toggle | T7 (knob) + T9 (wiring) |
| Linux capture fallback (documented) | G2 (decision) + T9 (impl) + T10 (docs) |
| Docs / CLI help / API docs | T10 |
| End-to-end operator journey | T11 |
| No regression: top-right overlay / HTTP-WS / CLI / history | invariant on every task; asserted T11(e) |

Every MUST has exactly one primary owner. Multi-owner rows are sequenced (geometry/proof -> ship).

---

## 4. Findings (schema)

### MEDIUM - "tri-file" pattern is actually five-to-six touch points / Lane 05
- **Root cause:** design decision + code evidence: the context pack/brief call the model a "tri-file"
  enum mirror, but a new payload field must also thread through `src-tauri/src/server/http.rs`'s own
  `NotifyRequest` (own struct, lines 34-58, mapped to payload ~136) and `cli/src/client.rs`, and the
  CLI flag in `cli/src/main.rs`.
- **Evidence:** `cli/src/main.rs:33-104`, `cli/src/types.rs:163-187`, `src-tauri/src/server/
  http.rs:34-58,136-140`, `src-tauri/src/notification/types.rs:171-199`, `src/types/notification.ts:58-75`.
- **Impact:** if T1 only touches three files, `--presentation island` silently drops at the HTTP
  boundary and the island never triggers - a hard-to-debug no-op.
- **Regression risk:** low (additive `#[serde(default)]` field).
- **Recommendation:** T1 explicitly enumerates all six touch points (done above).
- **Reverification:** T1 CLI integration test asserts the field survives HTTP round-trip, not just
  the type files compile.
- **Cross-refs:** 02-architecture (plumbing), 06-test-strategy (round-trip test).

### MEDIUM - content-vs-shape geometry bug recurred 3x; needs an invariant, not a spot-check / Lane 05
- **Root cause:** design decision (orchestrator note in collective_thoughts): mockup verification
  checked box-vs-box alignment only; content crossed the concave shoulder three times.
- **Evidence:** `tasks/dynamic-island/collective_thoughts.txt` (to:04-risk); mockup `--di-wall` rule.
- **Impact:** if T2/T4 do not carry the wall-inset as a tested invariant, island content clips into
  the shoulder on some size combinations, undetected by element-alignment tests.
- **Regression risk:** medium (visual-only, easy to ship broken).
- **Recommendation:** T2 owns `wallInset.ts` as a pure tested function; T4/T8 consume it; lane 06
  asserts content-vs-shape, not element-vs-element.
- **Reverification:** Playwright wall-audit probe (reusable from the mockup session) in lane 06.
- **Cross-refs:** 04-risk, 06-test-strategy, 02-architecture.

### LOW - lifecycle default + dedupe-key are cross-lane decisions, not task-local / Lane 05
- **Root cause:** provenance gaps in intent-ledger (lifecycle model; Model B dedupe/action mapping).
- **Evidence:** `intent-ledger.json` provenance_gaps 2 and 6.
- **Impact:** T4/T5/T6 need these settled or they will each guess differently.
- **Regression risk:** low (design, pre-code).
- **Recommendation:** T4 proposes arrive-expanded-then-collapse as default; T6 proposes dedupe-by-
  group; both flagged for PRD lane 01 + architecture lane 02 to ratify before build.
- **Reverification:** PRD FRs name the lifecycle + dedupe semantics before T4/T6 start.
- **Cross-refs:** 01-prd, 02-architecture.

---

## Cross-references for other lanes

- **-> 01-prd:** ratify the field name `presentation` (values `card`/`island`, default `card`) and the
  lifecycle default (arrive-expanded-then-collapse-to-pill) and Model B dedupe-by-group semantics.
  Map these tasks to your user stories; my story mapping above is provisional. Keep FRs consistent
  with "payload = 27 style overrides only; geometry is app settings."
- **-> 02-architecture:** decide (a) hand-rolled spring vs `motion` - T2 assumes hand-rolled with a
  stable public API so either works; (b) one shared window vs dedicated island window - T3 recommends
  dedicated for coexistence + independent capture state; (c) settings persistence backend + IPC event
  names for T7; (d) Model B row->action/`--wait` mapping for T6. Port, do not redesign, the mockup's
  `notchPath`/spring/wall-inset/Model-B logic (T2/T6).
- **-> 03-alternatives:** guard the rejected overflow Models A and C (T6 invariant) and record the
  rejected implementation options (motion-vs-hand-rolled, shared-vs-dedicated window, reuse-
  NotificationCard-vs-new-component) with named guards.
- **-> 04-risk:** the two gates G1/G2 are the de-risking spikes for your top pre-mortem failures
  (capture silently failing; notch-geometry unreachable). The content-vs-shape wall-inset invariant
  (finding 2) and the interruption states in T5 (higher-priority arrival mid-`--wait`, progress during
  collapse) need risk entries.
- **-> 06-test-strategy:** you own the D1 dedicated capture-exclusion verification track that T9 and
  T11 depend on; the visual-regression harness that T2/T4/T6/T8 target (reuse mockup `shot-*` ids +
  wall-audit / corner-zoom probes); the tauri-driver + CI matrix that T11 needs; and the content-vs-
  shape assertion (not element-vs-element). Machine already has Playwright 1.61.1 + chromium + webkit.
