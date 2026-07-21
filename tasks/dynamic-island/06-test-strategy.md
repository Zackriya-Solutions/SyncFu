# Lane 06 - Test Strategy

**/think frameworks:** first-principles invariant decomposition (every test traces to a MUST-be-true)
+ inversion / test-escape pre-mortem (how would a green suite still ship a broken island?)
+ risk-based layering (spend the effort where D1 says failure is catastrophic: capture-exclusion and
content-vs-shape fidelity).

This lane owns D1's dedicated capture-exclusion verification track and the parked /grill-me-qa test
dimensions. It plans tests only; it writes no test code.

---

## 0. Thesis and the one lesson that shapes everything

Two truths drive this strategy:

1. **jsdom is blind.** Vitest/jsdom has no layout engine: `getBoundingClientRect()` returns zeros and
   CSS springs never run. So the entire visual/positioning/morph cluster (the D1 primary effort) is
   **unverifiable in unit tests**. Playwright against the Vite-served overlay route is the decisive
   layer, not a nice-to-have.

2. **Box-vs-box is a false friend.** The approved mockup already ships a runtime self-check
   (`renderSelfCheck`, mockup line 1581) that compares the SVG shape-path box to the island box and
   faults at `dx|dy > 2.5px`. During this session, geometry bugs recurred 3x while that exact check
   stayed green, because **the shape box and the island box agreed while the content spilled past the
   concave walls.** The test suite must promote a content-vs-shape invariant (section 3) to a
   first-class assertion, or it will grant false confidence the same way the mockup's own check did.

Effort ranking (from D1): visual fidelity + positioning + customization (primary) > functional parity
(mandatory) > capture-exclusion (mandatory, own track, hardest, catastrophic if wrong).

---

## 1. Test pyramid for this feature

Bottom (fast, many) to top (slow, decisive-few). Each row states the invariant class it owns and what
it structurally CANNOT catch (so nothing orphans upward by accident).

### 1a. Rust unit (`cargo test`, any runner, target < 2 min)
Pure functions ported from the mockup's vanilla JS + new plumbing. These are deterministic, need no
display, and are the cheapest place to lock the math.

| Unit under test | Invariant | Evidence / source |
|---|---|---|
| Notch path segment builder (if shape math is computed in Rust; else this moves to 1b) | 8 segments, closed path, control point at outer top corner | research doc section 1; mockup `notchPath` |
| Radius clamps | `topR = min(topRadius, W/4, H/4)`, `botR = min(bottomRadius, W/4, H/2)`; never overshoot on small pills | research doc lines 22-26 (verbatim from all 3 native repos) |
| Badge width formula | `width = 26 + 8*(digits-1)`; caps display at `9+` for count >= 10 | D5; research doc section 4 |
| Queue ranking + dedupe | critical ranks first; dedupe by group/live-activity key; list capped 6 rows / 560px then scroll; auto-dismiss paused while list open | D5; provenance gap "dedupe-key semantics" (coordinate final key with 02/05) |
| Settings validation / clamping | compactWidth in 150-600 (default 218), expandedWidth 320-560 (380), height 24-60 (34), surfaceOpacity 0-100 (94); out-of-range inputs clamp, not panic | D4; playground ISLAND.SETTINGS.JSON |
| Compact-width derivation | notch-derived width path vs float base + content growth; fallback constant when notch API unavailable | research doc lines 46, 314 |
| `calculate_island_position()` (new, mirrors existing `calculate_panel_position`) | top-center anchor per mode; float positions left/center/right/bottom-center; bottom-center expands upward | extends `src-tauri/src/overlay/panel.rs:60` pattern (already unit-tested at panel.rs:335+) |
| Kind/presentation enum round-trip | new field serde round-trips across the tri-file mirror; unknown/missing value defaults to existing card | architecture facts; `cli/src/types.rs`, `src-tauri/src/notification/types.rs` |

**Cannot catch:** anything visual, any spring feel, any real layout. Passing Rust units say nothing
about whether the island renders correctly.

### 1b. Frontend Vitest (`vitest run`, ubuntu, target < 1 min)
Runtime logic that is pure or DOM-shallow. `vitest.config.ts` already exists; ~7 specs today.

| Unit under test | Invariant | Note |
|---|---|---|
| Morph state machine (compact <-> expanded transitions) | legal transitions only; `--wait` holds expanded until answered; critical never auto-collapses; timeout paths (low 6s / normal 8s / high 12s / critical never) fire the right next state | state graph must match 04-risk interruption tables (section 6) |
| Model B list logic (port of mockup `ModelB`) | ranking, dedupe, 6-row cap, spotlight = highest priority, badge count, pause-on-open | pure logic, jsdom-safe |
| `--di-wall` publish rule (pure calc) | `notch mode -> t (topR)`; `float mode -> expanded ? 24 : H/2`; padding = `max(base, wall + margin)` | mockup lines 884-887, 986; verify the NUMBER, not the paint |
| Kind selection / payload parsing | island vs card routing; payload carries only the 27 `--s-*` overrides (never geometry) | D4; collective_thoughts [to:01-prd] |

**Cannot catch (state this in the spec headers so no one is fooled):** `getBoundingClientRect` is 0x0
in jsdom, springs do not integrate, `prefers-reduced-motion` media has no layout effect. **No visual,
positioning, wall-inset, or animation assertion may live here.** Any such assertion is a false green.

### 1c. Playwright visual regression (the decisive layer - section 2)
Owns everything 1a/1b structurally cannot: real render, real fonts, real layout, real (settled)
springs, real corner geometry, and the content-vs-shape invariant (section 3).

### 1d. tauri-driver end-to-end (pre-release only, not per-PR)
Drives the actual `syncfu.app` window (real NSPanel / Win32 window) for: capture-exclusion smoke
(section 4), `--wait` exit-code round-trip through the real HTTP/WS path (section 5), and multi-monitor
/ notch-geometry sanity on real hardware. Heavy, display-bound, flaky on cloud runners - gate it to
nightly + release, never block a PR on it. `test:e2e` is declared in package.json but no config or
tauri-driver exists yet (see Finding: Playwright not wired).

---

## 2. Visual harness design (the decisive layer)

**Reuse what the machine already has:** Playwright 1.61.1 via npx, chromium + webkit engines installed
(context pack). No new heavy dependency. Add a `playwright.config.ts` (none exists; the `test:e2e`
script is declared but unwired) and pin Playwright to an exact version so snapshot rendering does not
drift silently.

### 2a. What is served and shot
- Serve the overlay route (the same React overlay Vite already builds) via the Vite dev server; point
  Playwright `webServer` at it so CI boots it automatically.
- Until the React overlay exists, snapshot the **approved mockup itself** (`tasks/dynamic-island-mockup.html`,
  a self-contained no-network file) as the first baseline set. This lets the visual harness land and go
  green in the earliest PR, before any Tauri code, and gives the implementation a pixel target to match.
- **The state gallery shots are inherently deterministic**: they are built by `mountStatic` (mockup
  line 1514+) with **no springs running**, each on a stable `shot-<id>` element (line 1516). This is
  the stable spine of the visual suite.

### 2b. Engine choice mirrors the Tauri webview per OS (not arbitrary)
Tauri renders through the OS webview, so test the engine that matches production:
- **webkit** = macOS WKWebView **and** Linux webkitgtk parity -> primary engine for the macOS/Linux
  render baseline.
- **chromium** = Windows WebView2 parity -> Windows render baseline.
Run both engines; keep separate baselines per engine. Do not assume a chromium-only pass covers macOS.

### 2c. The `shot-<id>` convention (already in the mockup - adopt as the CI contract)
`renderSelfCheck` aside, the gallery assigns `id="shot-" + s.id`. The 11 canonical states to snapshot:
`shot-compact-idle`, `shot-compact-timer`, `shot-compact-ring`, `shot-compact-count`,
`shot-expanded-basic`, `shot-expanded-actions`, `shot-expanded-decision`, `shot-expanded-progress`,
`shot-expanded-ring`, `shot-expanded-critical`, `shot-expanded-markdown`. Plus the cross-platform trio
(`[data-plat=mac|win|linux]`) and the 7 theme cells (the 27-override story). Each becomes one
`expect(locator).toHaveScreenshot('<id>.png')` with a tight `maxDiffPixelRatio` (start 0.01; tighten
after baselines stabilize).

### 2d. Making spring animations deterministic (three tools, layered)
Springs are the only nondeterminism in the visual layer. Neutralize, do not screenshot mid-flight:
1. **Static shots need nothing** - the gallery/theme/anatomy shots never animate (2a). These are the
   bulk of coverage and are already frozen.
2. **Reduced-motion path for morph shots:** launch the Playwright context with
   `reducedMotion: 'reduce'`. The mockup already swaps to the near-instant spring `{stiffness:1000,
   damping:100}` under `prefers-reduced-motion` (mockup lines 129, 804-806). The morph settles in ~1
   frame, so a post-transition screenshot is stable. This also doubles as the reduced-motion
   accessibility assertion (D3 requires reduced-motion support).
3. **Clock injection / settle hook for full-motion morph:** to assert the real 220/25 container +
   400/30 content springs land at the correct final geometry, use Playwright's `page.clock` to advance
   time deterministically, OR have the implementation expose a test-only settled flag (spring velocity
   below epsilon) and `page.waitForFunction(() => window.__islandSettled)` before shooting. Prefer the
   settled-flag hook: it is engine-independent and does not couple the test to frame timing.

Never `waitForTimeout(ms)` a spring; that is the classic flaky-visual mistake.

### 2e. Ported session probes as CI assertions (from collective_thoughts [to:06])
Three probes were used by hand this session; promote each to an automated check:
- **Content-vs-shape wall audit** -> section 3 (the headline assertion).
- **Corner zoom** -> screenshot a magnified crop of a top shoulder (the concave fillet is where the
  SVG path regresses first; a full-island shot averages the diff away and hides a broken corner).
  `expect(locator).toHaveScreenshot('corner-tl.png', { clip: <shoulder rect> })` at high device scale.
- **Console probe** -> assert zero console errors during render AND assert the mockup's own render-fault
  banner never displays: `expect(await page.locator('text=RENDER FAULT DETECTED').count()).toBe(0)`
  and the self-check banner stays `display:none` (mockup line 1600).

---

## 3. Content-vs-shape invariant as a first-class assertion

**This is the lane's headline deliverable** and the direct fix for the session lesson.

**The invariant (MUST be true):** every visible leaf element inside `.di-island` stays inside the
concave shape walls at every state, every radius setting, every mode, both engines. The wall inset is
published live as `--di-wall` (mockup: `notch -> t`, `float -> expanded ? 24 : H/2`).

**Why box-vs-box is insufficient:** the mockup's `renderSelfCheck` (line 1581) only asserts the shape
path box aligns with the island box (`dx|dy > 2.5px`). Content can overflow the concave shoulders while
both boxes still agree - exactly the bug that recurred 3x. Box alignment is necessary but not
sufficient.

**The assertion (Playwright `page.evaluate`, cannot run in jsdom - no layout):**
1. Read the live wall inset from the element: `getComputedStyle(island).getPropertyValue('--di-wall')`.
2. Walk `.di-island` and collect **every visible leaf** (elements with no element children, plus text
   nodes' bounding rects via Range) - icons, sender, title, body text runs, badges, action buttons,
   countdown, timers, ring labels.
3. For each leaf rect assert:
   - `leaf.left  >= island.left  + wall - EPS`
   - `leaf.right <= island.right - wall + EPS`
   - `leaf.top   >= island.top   + topRadiusInset - EPS` (content clears the concave top shoulders)
   where `EPS` is sub-pixel (~0.5px).
4. Return the list of violations; `expect(violations).toEqual([])`.

**Coverage matrix (run the audit across a parameter sweep, not one state):** {compact, expanded} x
{notch, float} x {min radius, default, max radius} x {narrow width 150, default, wide 640} x {chromium,
webkit}. Wide + max-radius + compact is the corner case the mockup regressed on. This sweep is the
single most valuable test in the suite per D1.

Keep the mockup's box-vs-box self-check too (it catches gross shape drift cheaply), but it is the floor,
not the ceiling.

---

## 4. Capture-exclusion verification per OS (D1 dedicated track)

The whole feature is one window property: Tauri `window.set_content_protected(true)` ->
`NSWindowSharingNone` (macOS) / `WDA_EXCLUDEFROMCAPTURE` (Windows) / no-op (Linux). It is catastrophic
if it silently fails (a private notification leaks on a live stream) and it is **impossible to verify
in pure web / headless jsdom** - it requires a real window on a real compositor. So this track is
mostly a **manual release checklist**, with best-effort programmatic smoke in CI.

### 4a. The core method (all OSes): capture-while-visible, assert-absent
The proof requires TWO observations of the same screen region at the same instant:
1. The island **is** present in the real display (confirm via DOM / a non-capture screenshot path, or
   visually) - proves the window is actually on-screen, so an "absent" result is exclusion, not a
   window that simply was not shown.
2. An **OS-level capture** of that region does **not** contain the island's signature (its pure-black
   capsule shape + accent pixel).

Without observation 1, an all-clear is meaningless (an unshown window is trivially absent).

### 4b. macOS
- **Manual / release (real hardware, MacBook with notch + external non-notch display):**
  1. Show an island notification.
  2. `screencapture -x -R<x,y,w,h> /tmp/cap.png` over the island's window region (`-x` = no sound;
     `-R` = rect). `screencapture` honors `sharingType = .none`, so an excluded window is absent.
  3. Assert `/tmp/cap.png` over that region contains no pure-black capsule (compare against a control
     capture taken with the island hidden; the region must be pixel-identical to the island-hidden
     control within tolerance).
  4. Repeat inside a real screen-share (Zoom/Meet/QuickTime recording) and with the toggle OFF (must
     become visible) to prove the toggle actually controls it, not that it is always hidden.
- **Programmatic (CI best-effort, macos runner):** a ScreenCaptureKit `SCScreenshotManager` grab of the
  display, then assert the island's known region is background-only. Runner caveat: GitHub macOS
  runners have a virtual framebuffer and may not host an on-screen NSPanel faithfully; treat a CI pass
  as smoke, never as the release sign-off. If SCScreenshotKit is unavailable, fall back to
  `screencapture -x -R` in the runner.

### 4c. Windows
- **Manual / release (Win10 2004+ real machine):**
  1. Show island. 2. Capture via the **modern** path - Windows.Graphics.Capture (the API Teams/OBS
     "window/display capture" uses) or DXGI desktop duplication - and assert the island region is
     black/absent. `WDA_EXCLUDEFROMCAPTURE` blocks exactly this path.
  3. Also probe `PrintWindow(hwnd, dc, PW_RENDERFULLCONTENT)`; an excluded window returns black.
- **OBS game-capture caveat (document explicitly):** `WDA_EXCLUDEFROMCAPTURE` blocks the DWM/Graphics.
  Capture path, but legacy `BitBlt` capture and OBS "Game Capture" (hook-based) can behave differently;
  older `WDA_MONITOR` only blanks monitor capture. Requires Windows 10 version 2004+; on older builds
  the exclusion silently degrades. The release checklist MUST test against at least: OBS Display
  Capture, OBS Window Capture, Teams/Zoom share, and the Win+G game bar. Note any path that still sees
  the island as a KNOWN caveat in user docs, not a silent gap.
- **CI:** Windows runners are headless; capture-exclusion is **release-checklist only**, not CI.

### 4d. Linux
- No reliable exclusion API (documented limitation, intent-ledger deferred item). The **test** is
  therefore not "is it hidden" (it will not be) but "**does the product surface the documented-limitation
  warning**":
  - Assert a startup/settings warning fires when `hideFromScreenCapture` is enabled on Linux (log line
    + settings-UI note). This is a Vitest/Rust-unit assertion on the warning path (no display needed).
  - If a fallback is chosen (auto-hide while a known capture app is frontmost - still an OPEN decision,
    provenance gap), add a unit test for the frontmost-app detection -> hide trigger. Guard against
    shipping silent false safety: the toggle must not appear to work when it cannot.

### 4e. CI vs manual split (explicit)
| Check | CI (per-PR) | CI (nightly, macos runner) | Manual release checklist |
|---|---|---|---|
| macOS exclusion | no | smoke (best-effort, may not host NSPanel) | yes - real notch Mac + external display + real share app |
| Windows exclusion | no | no | yes - Win10 2004+, OBS + Teams + game bar |
| Linux warning surfaces | yes (unit) | - | yes - confirm warning text visible |
| Toggle OFF -> visible (all OS) | no | macos smoke | yes - prove the toggle controls it |

Rationale: exclusion depends on a live compositor and a real capture consumer; cloud runners cannot
faithfully reproduce a screen-share pipeline, so a green CI here would be dangerous false confidence.
The dedicated track's authority lives in the release checklist.

---

## 5. API / CLI compatibility tests

syncfu's regression surface (context pack): top-right overlay behavior, HTTP/WS API compat, CLI flag
compat, history. The island is **additive**; these tests prove it stays additive.

- **Old payload, unchanged behavior (backward compat):** a notification payload with **no**
  presentation/kind field renders the existing top-right glass card, unchanged. Cover at three layers:
  Rust serde default (missing field -> card variant), Vitest routing (no field -> `NotificationCard`,
  not the island), and one Playwright snapshot proving the top-right card is pixel-identical to its
  pre-feature baseline. This is the load-bearing "we did not break existing users" test.
- **Kind selection round-trip:** `island` value set via payload field AND via the `syncfu send` CLI
  flag both route to the island; unknown value falls back to card (never panics). Name is a provenance
  gap - coordinate the exact field/flag with 01-prd and 02-architecture; the test asserts whatever name
  is chosen plus the default.
- **HTTP/WS schema compat:** POST :9868 and WS :9869 accept the new optional field and still accept old
  messages without it (schema is additive-optional, not required). `cli/tests/integration.rs` is the
  home for the CLI+transport round-trip.
- **`--wait` round-trip from island actions:** an action taken on the expanded island (primary /
  secondary / danger) unblocks a waiting CLI with the correct **exit code: 0 action / 1 dismiss / 2
  timeout** (context pack). Also assert Model B list rows map to the right action/callback (dedupe-key
  and row->action mapping is a provenance gap - coordinate with 05-tasks). Test through the real path
  in the tauri-driver e2e (1d); the decision plumbing cannot be faithfully exercised in jsdom.
- **Timeout-by-priority parity in island mode:** low 6s / normal 8s / high 12s / critical never (must
  match the existing card semantics; island must not introduce its own timing).
- **History:** an island notification is written to the SQLite history identically to a card
  notification (assert row present with the kind recorded).

---

## 6. Interruption-state tests (mapped from 04-risk)

D3 and the completeness gates require an interruption state for every state machine. This lane provides
the **test skeleton**; 04-risk owns the authoritative table of states and transitions. Coordinate via
cross-ref - do not invent a second, divergent list here.

State machines that need interruption coverage (each row = one Vitest state-machine spec + one
Playwright settled-state snapshot where visual):

| Machine | Interruption to test | Expected invariant |
|---|---|---|
| Morph (compact <-> expanded) | new notification arrives mid-morph | latest-wins re-present (never queue a half-morph); container never resizes the OS frame mid-flight (D3) |
| Model B list | new item arrives while list is open | auto-dismiss stays paused; list re-ranks; dedupe holds; no scroll jump |
| `--wait` decision | timeout fires while user is mid-hover / mid-scroll | critical never times out; non-critical resolves to exit code 2; no double-resolution |
| Progress updates | progress event arrives after collapse to pill | pill live-activity updates; expand shows current value, not a stale one |
| Settings change | user changes width/radius/mode while an island is showing | live re-render, `--di-wall` recomputed, content-vs-shape invariant (section 3) still holds |
| Reduced-motion toggle | changes mid-animation | in-flight spring snaps to near-instant; no orphaned animation |
| Capture toggle | toggled while island visible during a live share | `set_content_protected` re-applies live (tauri-driver e2e; parity with NotchPrompter's reactive wiring) |

**Cross-ref action:** 04-risk should tag each pre-mortem failure mode with the interruption row above
that guards it, so every risk has an owning test. If 04-risk lists a state this table misses, this table
is the one that is wrong - reconcile in favor of 04-risk.

---

## 7. CI matrix

Design goal: keep per-PR fast and deterministic; push slow/flaky/display-bound work to nightly and
release. Visual baselines are **font-sensitive** - the design specifies SF Pro / SF Mono (context
pack), which exist on macOS but not on ubuntu/windows runners, so a baseline generated on Linux would
diff-flake against the intended fonts. **Generate and compare the visual-regression baselines on the
macOS runner only.** Windows/Linux get their own separate baselines (or the visual suite is macOS-gated
and Win/Linux run only functional + capture-exclusion checklists).

| Stage | Runner | Trigger | Budget | Notes |
|---|---|---|---|---|
| Rust unit (`cargo test`) | ubuntu | every PR | < 2 min | path math, clamps, badge, queue, settings validation, position |
| Frontend Vitest | ubuntu | every PR | < 1 min | state machine, Model B, wall-calc, routing; NO visual asserts |
| Playwright visual (webkit) | **macOS** | every PR | < 5 min | the 11 `shot-*` + trio + theme cells + content-vs-shape sweep + corner zoom + console probe. macOS-only for correct SF fonts + WKWebView parity |
| Playwright visual (chromium) | windows | every PR (or nightly if budget-bound) | < 5 min | Windows WebView2 parity; separate baseline set |
| Linux capture-warning unit | ubuntu | every PR | < 30 s | assert documented-limitation warning path fires |
| tauri-driver e2e (real app) | macOS + windows | nightly + pre-release | < 20 min | `--wait` exit-code round-trip, capture-exclusion smoke, multi-monitor/notch geometry |
| Capture-exclusion (macOS/Windows real) | n/a (human) | pre-release gate | manual | section 4 checklist; blocks release, not PRs |

macOS-runner-only work (call out, since macOS minutes are the scarce budget): the primary visual
baseline (fonts + WKWebView), the notch-geometry e2e, and the macOS capture smoke. Everything provable
without a display or Apple fonts stays on ubuntu to conserve macOS minutes.

Snapshot-update discipline: baselines are committed; a diff fails the build; updating requires an
explicit `--update-snapshots` run reviewed in the PR (never auto-updated in CI, or the content-vs-shape
regression walks right back in).

---

## Findings

### HIGH - Box-vs-box self-check grants false confidence; content-vs-shape must be first-class / Lane 06 / Root cause: the mockup's `renderSelfCheck` asserts only shape-box vs island-box alignment (mockup line 1581-1595, `dx|dy > 2.5px`), which stayed green while content overflowed the concave walls 3x this session (evidence: collective_thoughts [to:04-risk], [to:06]) / Impact: a green visual suite ships an island whose text/badges spill past the shoulders - the exact recurring bug / Regression risk: high; it is the feature's most-regressed geometry / Recommendation: implement section 3's per-leaf-vs-`--di-wall` audit as the headline Playwright assertion across the {state x mode x radius x width x engine} sweep; keep box-vs-box as the cheap floor / Reverification: run the audit against a deliberately over-wide compact + max-radius fixture and confirm it flags the overflow the box check misses / Cross-refs: 04-risk (encode as a named risk), 02-architecture (carry `--di-wall` into the real component), 05-tasks (audit is an owner-task).

### HIGH - Visual baselines are font- and engine-sensitive; a wrong runner OS flakes every snapshot / Lane 06 / Root cause: design mandates SF Pro / SF Mono (context pack) present on macOS only, and Tauri renders via WKWebView (mac/linux) vs WebView2 (windows) - a chromium-on-ubuntu baseline matches neither production font nor production engine (design decision: context pack fonts + Tauri webview mapping) / Impact: baselines generated on the wrong runner produce perpetual false-positive diffs or, worse, pass while hiding real font-fallback regressions / Regression risk: medium-high; poisons the decisive layer's signal / Recommendation: generate/compare visual baselines on the macOS runner with webkit as primary; give Windows its own chromium baseline; never mix / Reverification: confirm a snapshot generated on ubuntu diffs against the same page on macOS purely from font fallback / Cross-refs: 05-tasks (CI runner selection is an owner-task), 80-feasibility (macOS runner minutes budget).

### MEDIUM - Capture-exclusion is unverifiable in headless CI; without a manual release gate it can silently fail / Lane 06 / Root cause: `set_content_protected` depends on a live compositor + real capture consumer that cloud runners cannot host faithfully (research doc section 5; intent-ledger deferred) / Impact: a private notification leaks on a live stream - the feature's catastrophic-failure mode (D1) / Regression risk: high consequence, low frequency / Recommendation: make section 4's manual release checklist a hard release gate (macOS notch Mac + Win10 2004+ + real share apps incl. OBS), with CI only as best-effort smoke; test the toggle OFF path too so "always hidden" cannot masquerade as "correctly controlled" / Reverification: perform the capture-while-visible + assert-absent proof on real hardware per section 4a / Cross-refs: 04-risk (privacy pre-mortem), 05-tasks (early isolated capture gate task), 02-architecture (confirm `set_content_protected` works on the tauri-nspanel NSPanel - open unknown).

### MEDIUM - Spring nondeterminism will flake visual tests unless motion is frozen / Lane 06 / Root cause: rAF damped-spring integrator (220/25, 400/30) settles over real frames; a mid-flight screenshot is nondeterministic (research doc section 2; mockup lines 804-887) / Impact: flaky visual CI erodes trust and gets muted, hiding real regressions / Regression risk: medium / Recommendation: lean on the already-static gallery shots for the bulk; use Playwright `reducedMotion:'reduce'` (mockup already swaps to 1000/100) for morph shots; add a test-only settled flag for full-motion assertions; never `waitForTimeout` a spring / Reverification: run the morph snapshot 20x and confirm zero diff variance / Cross-refs: 02-architecture (expose a settled hook), 03-alternatives (hand-rolled spring vs motion library affects how the settle hook is built).

### MEDIUM - Playwright is declared but unwired; version drift will move snapshots under the suite / Lane 06 / Root cause: `test:e2e: "playwright test"` exists in package.json but there is no `playwright.config.ts`, no specs, no tauri-driver, and Playwright is not a project dependency (only npx-available 1.61.1) (evidence: package.json line 14; `find` shows no playwright config) / Impact: a new Playwright version can re-rasterize text/AA and invalidate every baseline; CI cannot run e2e as-is / Regression risk: medium / Recommendation: pin Playwright to an exact version as a devDependency, add `playwright.config.ts` with a `webServer` pointing at Vite and the webkit+chromium projects; land the harness against the mockup before Tauri code exists / Reverification: `npx playwright test` runs green against the mockup gallery on a fresh checkout / Cross-refs: 05-tasks (harness-setup is an early owner-task, can precede implementation), 02-architecture.

### LOW - Linux "hide from capture" toggle can present false safety / Lane 06 / Root cause: no Linux exclusion API, but the settings surface exposes `hideFromScreenCapture` for all platforms (D4) (design decision: D4 + research doc section 5) / Impact: a Linux user enables the toggle, believes they are protected, and leaks on capture / Regression risk: low-medium / Recommendation: assert (unit) that enabling it on Linux surfaces a documented-limitation warning and the toggle reads as unavailable/degraded, not silently on / Reverification: unit test on the warning path + manual confirm the settings note is visible / Cross-refs: 04-risk (Linux gap), 01-prd (document the limitation in NFRs).

---

## Cross-references for other lanes

- **-> 04-risk:** Section 6's interruption table is a skeleton; 04-risk owns the authoritative
  state/transition list. Tag each pre-mortem failure mode with its guarding test row so every risk has
  an owning test. If your list and mine diverge, yours wins - I will reconcile to it. Also please
  register the box-vs-box-false-confidence lesson (HIGH finding) and the capture-exclusion privacy
  leak as named risks with the tests here as their mitigations.
- **-> 02-architecture:** Two test hooks the implementation must expose for deterministic/verifiable
  tests: (1) a spring **settled flag** (`window.__islandSettled`) for full-motion snapshots; (2) carry
  `--di-wall` onto the real React component exactly as the mockup publishes it (lines 884-887), because
  the content-vs-shape audit reads it live. Also: confirm `set_content_protected(true)` actually
  applies to the tauri-nspanel NSPanel window type (open unknown) - the capture track's validity
  depends on it.
- **-> 05-tasks:** Owner-tasks this lane implies, in order: (a) wire Playwright (pin version + config +
  webServer) and land the visual harness against the mockup BEFORE Tauri code - it is the earliest
  green gate; (b) the content-vs-shape audit sweep; (c) the early isolated capture-exclusion gate
  (spike + smoke) as a platform-unknown gate, not deferred to CI; (d) the manual capture-exclusion
  release checklist as a release gate artifact.
- **-> 03-alternatives:** the hand-rolled-spring vs motion-library decision changes how the settle hook
  (2d) is built and whether reduced-motion swap is free (mockup's hand-rolled path already does 1000/100).
  Whichever wins must keep a deterministic settle path for the visual layer.
- **-> 01-prd:** the Linux capture limitation and the toggle-false-safety guard belong in the NFR /
  documented-limitations section; the `--wait` exit-code contract (0/1/2) and additive-payload
  backward-compat guarantee are testable acceptance criteria the PRD should state explicitly.
- **-> 80-feasibility:** macOS runner minutes are the scarce CI budget (primary visual baseline + notch
  e2e + capture smoke are macOS-only); factor into the CI cost estimate.
