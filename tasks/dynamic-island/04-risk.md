# Lane 04 - Risk / Pre-mortem: Dynamic Island notification

**Framework:** Pre-mortem (prospective hindsight: "it shipped and failed, why?") + FMEA with crash-after-step-k
enumeration + inversion (design the failure, then invert to the guard). Applied directly.

**Method:** Every risk below is written from the future in which the feature shipped and caused harm. Each
carries a named guard and an owning task/test so Wave A (feasibility) and lane 05 (tasks) / lane 06 (test
strategy) can assign an owner. Severity: CRITICAL = privacy leak or data-loss / hang; HIGH = broken
functional parity or regression; MEDIUM = degraded UX / self-healing; LOW = cosmetic.

Ground-truth corrections found while writing this lane (feed to lane 80 and 01):
- The context pack line "History in SQLite" is INACCURATE. There is no rusqlite/sqlx/sqlite anywhere in
  `src-tauri/` or `cli/`. History is a FRONTEND Zustand store: `src/stores/historyStore.ts`
  (`prependEntry` / `setEntries`). Regression reasoning about history must target that store + whatever
  event feeds it, not a Rust DB. (evidence: grep of src-tauri/cli returns zero sqlite hits; store file exists)
- `set_content_protected` is NOT called anywhere in current source (only in `gen/schemas/*.json` capability
  descriptors). The existing top-right overlay is therefore CAPTURABLE today. The island is the first window
  in this app to need capture exclusion, so there is no working reference call in-repo to copy. (evidence:
  grep `set_content_protected` -> only `src-tauri/gen/schemas/{macOS,desktop}-schema.json`)
- `--wait` is an SSE waiter (`cli/src/wait.rs::wait_for_resolution`), exit codes Action=0 / Dismissed=1 /
  Timeout=2, default 300s. Critically: `read_sse_stream` returns `WaitResult::Dismissed` on plain stream END
  (`cli/src/wait.rs:74`) - a dropped SSE connection reports a FALSE DISMISS. This is pre-existing and the
  island inherits it. (evidence: cli/src/wait.rs)

---

## 1. Interruption states (completeness gate)

### 1.1 Island state machine

States: `hidden`, `compact`, `expanded`, `morphing` (rAF springs non-resting), `list-open` (Model B
expanded list). The mockup's controller (`mount()` in the approved mockup, lines ~815-963) is the reference:
`morphing` is implicit - the rAF loop runs only while any spring is non-resting and self-halts
(`if (sW.resting && ... ) { raf = null; return; }`, mockup line 889). `list-open` is `expanded` with a
scrollable ranked list and auto-dismiss paused (D5).

### 1.2 State x event matrix (expected outcome; UNSPEC = task lane must define)

| event \ state | hidden | compact | expanded | morphing | list-open |
|---|---|---|---|---|---|
| notification arrives | -> compact/expanded per lifecycle (UNSPEC, ledger open Q) | pop + maybe expand; if 2nd distinct id -> spotlight+badge (D5) | update in place or re-present; add to ranked list | queue target change; apply after springs settle | insert into ranked list, re-rank, stagger row in (D5) |
| dismissed (this id) | no-op | -> hidden (spring to compact size then remove) | -> hidden | cancel springs, -> hidden | remove row; if last -> hidden; else re-rank, stay list-open |
| `--wait` pending | n/a (nothing shown) | must stay visible until resolved (critical never auto-dismiss) | stay expanded until answered (open Q: does --wait force expanded?) | resolve after settle | row for waited id must remain until acted |
| settings change | apply on next show | live re-geometry via `set()` (mockup 938) | live re-geometry + re-measure | RISK: retargets springs mid-flight -> visible jump | live; list height re-clamps |
| monitor change | recompute target monitor | reposition/recreate (see 1.4-C) | recreate + restore expanded | RISK: DOM torn down under running rAF -> exception | recreate + restore list |
| app restart | clean | in-flight lost | in-flight lost | in-flight lost | in-flight lost + list gone |
| window destroyed mid-morph | n/a | n/a | n/a | **rAF references dead DOM -> uncaught error; --wait hangs** | list callbacks orphaned |

### 1.3 Named interruption risks

#### CRITICAL - rAF loop survives window/DOM teardown mid-morph
- **Lane:** 04 risk / interruption
- **Root cause:** The spring loop calls `requestAnimationFrame(frame)` and mutates `island.style` +
  `path.setAttribute("d", ...)` every tick (mockup lines 875-893). If the island window is destroyed
  (monitor change, app quit, coexistence re-route) while `raf != null`, the next `frame()` tick touches a
  detached `island`/`path` node. In a bare port this throws; worse, if the window is recreated and a NEW loop
  starts while the OLD `raf` handle was never cancelled, two loops fight over one element.
- **Evidence:** design decision: mockup `frame()` has no teardown/cancel hook; `kick()` guards only
  against double-start within one controller instance (mockup line 894), not against controller disposal.
- **Impact:** console error spam, pinned CPU from a zombie loop, and a half-drawn island. If it happens
  during a `--wait`, the waiter never receives Action/Dismissed and blocks to the 300s timeout -> exit 2.
- **Regression risk:** none to top-right card (separate window), but a leaked rAF loop degrades the whole app.
- **Recommendation:** The React island component MUST `cancelAnimationFrame` and null the handle in cleanup
  (unmount / window-close event), and the controller must expose a `dispose()` that stops springs before any
  window recreation. Make-before-break on recreation (create new window, start its loop, then destroy old).
- **Reverification:** unit test: dispose() during a non-resting spring cancels the pending frame and no
  further `path.setAttribute` fires (spy). Playwright: trigger monitor-change simulation mid-morph, assert no
  console error.
- **Cross-refs:** 05-tasks (recreation ordering task), 06-test (dispose test), 02-arch (component lifecycle).

#### HIGH - `--wait` semantics undefined across compact/expanded/list-open
- **Root cause:** Ledger open question: does `--wait` force/hold the expanded state? In Model B a waited
  notification can be buried in a scrolled list (>6 rows, mockup caps 6 / 560px then scrolls). A user
  answering "which one am I waiting on?" cannot see it.
- **Evidence:** design decision: brief section 8 lifecycle open Q; D5 ranked list caps 6 rows.
- **Impact:** the caller blocks on `--wait` but the actionable UI is off-screen -> effective hang to timeout.
- **Recommendation:** PRD/task lane MUST specify: a `--wait` (blocking) notification pins to the top of the
  ranked list, cannot be auto-dismissed, and forces at least a compact-visible spotlight if list is closed.
- **Cross-refs:** 01-prd (FR for wait+island), 05-tasks, 06-test (wait-in-list e2e).

### 1.4 Crash-after-step-k tables

**(A) Settings write** (persistent app settings; D4 knobs; target = tauri store / JSON config).
Steps: (1) read UI values -> (2) validate+clamp to D4 ranges -> (3) serialize -> (4) write bytes -> (5)
atomic commit (temp+rename) -> (6) emit "settings-changed" to island window -> (7) island `set()` applies live.

| crash after step | on-disk state | live island | severity + guard |
|---|---|---|---|
| 1-2 | unchanged | unchanged | LOW - nothing happened |
| 3-4 (partial bytes, NO atomic rename) | **corrupt / truncated config** | old | **HIGH** - next launch fails to parse. Guard: write temp + atomic rename; parse-with-fallback-to-D4-defaults, never panic on bad config |
| 5 (committed) before 6 | new | old until restart | MEDIUM - self-heals on restart or next open; acceptable |
| 6 before 7 (event lost; island not yet created) | new | never applied live | MEDIUM - island MUST re-read settings on each show/create, not only on the event |

Invariant: settings persistence is atomic and parse-tolerant; the island reads config at creation AND on
change events (two independent paths), so a lost event cannot leave stale geometry forever.

**(B) Capture-protection toggle** (`hideFromScreenCapture`, D4, default ON per NotchPrompter/research §5).
Steps: (1) user flips toggle -> (2) invoke backend to `set_content_protected(island_win, v)` -> (3) OS applies
(macOS `sharingType=.none` / Win `WDA_EXCLUDEFROMCAPTURE`) -> (4) persist setting -> (5) UI confirms.

| crash after step | window protected? | setting persisted? | severity + guard |
|---|---|---|---|
| 1 | no | no | LOW |
| 2 before 3 (call issued, OS not yet applied / silently no-op) | **NO** | no | **CRITICAL if user believes hidden** - see §2. Guard: apply-first ordering + capability probe + surfaced result, never assume success |
| 3 before 4 | yes (this session) | no | MEDIUM - protection lost on restart; toggle reverts. Guard: re-apply from persisted setting at every window creation |
| 4 before 5 | yes | yes | LOW - just missing UI confirmation |

Invariant (privacy): apply protection to the OS window BEFORE persisting and BEFORE the window is ordered
front; treat protection as a property of the window INSTANCE that must be re-asserted on every (re)creation.

**(C) Window recreation on monitor change.** Existing `show_panel` REPOSITIONS the single "overlay" window
via the underlying WebviewWindow (mockup n/a; `src-tauri/src/overlay/panel.rs` `show_panel`, line ~187 - it
recomputes `calculate_panel_position` for the cursor monitor and moves the same window). If the island needs
different notch geometry per display (notched laptop panel vs external non-notch monitor) it may need a
resize/reshape or full recreate. Steps: (1) monitor/display change event -> (2) resolve target monitor +
notch geometry -> (3) create NEW island window (make-before-break) -> (4) **apply capture protection to new
window** -> (5) apply appearance/settings/geometry -> (6) restore pending notification + state (compact vs
expanded, list contents, waited id) -> (7) order front + destroy old window.

| crash after step | result | severity + guard |
|---|---|---|
| 2 before 3 | old window still up, wrong geometry | LOW - stale but visible; self-heals next event |
| 3 before 4 | **new window visible WITHOUT capture protection** | **CRITICAL** - privacy leak window. Guard: NEVER order the new window front before step 4; create hidden, protect, then show |
| 4 before 6 | protected but blank / wrong content | MEDIUM - notification lost visually; if `--wait` active, user cannot act -> timeout. Guard: restore state before show |
| 6 before 7 (both windows up) | brief double-island | LOW - dedupe by destroying old immediately after new shows |

Note: the current codebase repositions rather than recreates (one window labeled "overlay"). If the island is
a SEPARATE second window, the existing `show_panel`/`hide_panel` (which act on label "overlay") must not
touch the island, and the island's own monitor-change handler must not fight the card's. Cross-window
identity/labeling is an architecture task (02).

**(D) `--wait` waiter with island dismissed.** CLI side blocks in `wait_for_resolution` on an SSE stream for
one id (`cli/src/wait.rs`). Island dismiss steps: (1) user dismisses island (whole) or one list row -> (2)
frontend -> backend event -> `NotificationManager.dismiss(id)` (`manager.rs:54`) -> (3) manager may promote a
queued item (`dismiss_promotes_from_queue` test exists) -> (4) server emits SSE `Dismissed` for that id -> (5)
waiter -> exit 1.

| scenario | outcome today / risk | severity + guard |
|---|---|---|
| dismiss whole island containing waited id N | if island emits only a single "list dismissed" and not a per-id `Dismissed` for N, the N-waiter never resolves -> 300s timeout -> **exit 2 (should be 1)** | **HIGH** - Guard: Model B MUST preserve per-id Dismissed/Action events; the merged list is a view, not a new event identity |
| act on row N in list | must emit `Action(action_id)` for N; ledger flags "how list rows map to actions" as OPEN | HIGH - unresolved row->callback mapping breaks the Action path (wrong exit code / hang). Owner: task lane |
| auto-dismiss paused while list open (D5) but CLI `--wait` counting | island pause is VISUAL only; CLI 300s timeout is independent and still fires -> exit 2 while island still shows N | MEDIUM - Guard: document that `--wait --wait-timeout` governs the CLI, independent of island auto-dismiss; consider server-side keepalive |
| island window destroyed mid-wait (crash / monitor change / app restart) | no dismiss/action event ever emitted -> waiter blocks to timeout | MEDIUM - inherent; timeout is the backstop |
| SSE connection drops (server restart, blip) | `read_sse_stream` returns `Dismissed` on stream END -> **false exit 1** | MEDIUM (pre-existing, inherited) - flag: island's higher-value approval prompts make a false "dismissed" more consequential |

---

## 2. Capture-exclusion silent failure (the catastrophic privacy case)

**The failure that ends the product's credibility:** a user reads the marketing ("invisible during screen
sharing", brief section 2), leaves `hideFromScreenCapture` ON, streams/records/pairs while an agent pushes an
island notification containing a secret, an approval prompt, or a private message - and it appears on the
capture. The differentiator becomes a liability.

#### CRITICAL - capture exclusion silently not applied
- **Lane:** 04 risk / privacy
- **Root cause (multi-path):**
  1. `set_content_protected(true)` may not take on the `tauri-nspanel` NSPanel. The panel is converted from a
     WebviewWindow by `tauri-nspanel` (`panel.rs` `create_macos_panel`); Tauri's `set_content_protected`
     operates on the WebviewWindow's `NSWindow`, and it is UNVERIFIED whether the handle still maps after
     conversion. (ledger provenance gap: "Whether set_content_protected(true) works on the tauri-nspanel
     window type on macOS - needs early gate").
  2. Windows `WDA_EXCLUDEFROMCAPTURE` requires Win10 build 2004 / 19041+. On older builds
     `SetWindowDisplayAffinity` with that flag FAILS (older OS only supports `WDA_MONITOR`, which black-boxes
     BitBlt capture but not all paths). Tauri's mapping may swallow the failure -> setting reads ON, window
     is captured.
  3. Linux: NO reliable equivalent (research §5, ledger deferred item). The toggle is a no-op.
  4. Window recreation (monitor change, §1.4-C) drops protection unless re-applied.
- **Evidence:** research §5 table + caveats; ledger `provenance_gaps` + `deferred`; `set_content_protected`
  absent from current source (grep).
- **Impact:** silent, catastrophic, and exactly the scenario the feature promises to prevent.
- **Regression risk:** n/a (new capability) but reputational.
- **Detection strategy (must be built, not assumed):**
  - macOS: after applying, read back `NSWindow.sharingType` via the raw handle and assert `== .none`; if the
    read-back path is unavailable, treat as UNKNOWN and surface, not silent-ON.
  - Windows: check `GetWindowDisplayAffinity` returns `WDA_EXCLUDEFROMCAPTURE`, and gate on OS build >= 19041
    at startup; below that, disable the toggle and show "not supported on this Windows build".
  - Linux: never show a green "hidden" state; the toggle is disabled with an explanatory tooltip; if a
    fallback ships (hide-while-capture-app-frontmost), see its own failure modes below.
  - Dedicated verification track (D1): a manual per-OS capture test (start OBS / QuickTime / Windows Game Bar
    / a Meet share, push an island, confirm absence in the recording). This CANNOT be automated in CI on the
    host machine reliably; it is a release-gate checklist item owned by lane 06.
- **Per-OS threat surface:**
  - **macOS:** `sharingType = .none` is the primitive (NotchPrompter, boring.notch). BUT `NSWindow.sharingType`
    is DEPRECATED on modern macOS (Sonoma+); the modern capture path is ScreenCaptureKit. Verify that
    `.none` still excludes under ScreenCaptureKit-based recorders (recent OBS, macOS 14/15 screen share), not
    only legacy CGWindowList capture. boring.notch additionally hosts on a private SkyLight space
    (`CGSSpace(level: max)`, `SLSRemoveWindowsFromSpaces`) - orthogonal to capture-hiding and NOT needed;
    do not adopt it (see §7 fragility).
  - **Windows:** `WDA_EXCLUDEFROMCAPTURE`, min build 19041. Respected by DXGI Desktop Duplication and
    Windows.Graphics.Capture. THREAT: OBS "Game Capture" (hook-based, injects into a target process to grab
    its swapchain) operates below the display-affinity layer for the hooked process; and some GPU-level /
    kernel capture tools bypass it. Since syncfu is the process being protected and game-capture hooks a
    DIFFERENT target process, standard OBS Display Capture / Window Capture DO honor
    `WDA_EXCLUDEFROMCAPTURE`; document that exclusion is guaranteed only against display/window/duplication
    capture, not against a malicious in-process hook or hardware capture card. Set user expectations honestly.
  - **Linux:** impossible. Fallback (hide while a known capture app is frontmost) has its OWN failure modes:
    (a) on Wayland you cannot reliably enumerate the foreground app or window list (security model forbids
    it), so detection fails; (b) X11 detection can miss OBS running via PipeWire portal capture that does not
    need focus; (c) races - the app can start capturing after the check; (d) false positives hide the island
    when the user is not actually sharing. Recommendation: on Linux DO NOT ship a false-confidence fallback;
    disable the toggle, show "screen-capture hiding is unavailable on Linux", and log it. An honest gap beats
    a fallback that fails silently.
- **Counter-example warning (from research §5, carry verbatim):** open-island and open-vibe-island set
  `sharingType = .readOnly`, which leaves the overlay VISIBLE/capturable. Do NOT copy their panel setup. Only
  `.none` (NotchPrompter default-true, boring.notch key) actually hides. A code reviewer must reject any PR
  that sets `.readOnly` believing it hides.
- **Recommendation:** capture exclusion is its own gated track (D1). Guard = apply-first + read-back-verify +
  per-OS capability probe + honest UI state (ON / UNSUPPORTED / UNKNOWN, never a silent lie) + re-apply on
  every window creation.
- **Reverification:** early spike task proves `set_content_protected` takes on the nspanel (read-back
  `sharingType`); release-gate manual per-OS capture checklist; startup build-number gate on Windows.
- **Cross-refs:** 02-arch (raw-handle access for read-back), 05-tasks (early isolated gate + release gate),
  06-test (dedicated capture-exclusion track owns this).

---

## 3. Regression surface

The syncfu regression surface (context pack line 101): existing top-right overlay, HTTP/WS API compat, CLI
flag compat, history. Each risk below assumes it shipped and broke something that worked.

#### HIGH - old clients omit the new kind field and get rejected
- **Root cause:** if the new presentation selector (ledger: `presentation: "island" | "card"` or `variant`)
  is added as a REQUIRED (non-Option, no serde default) field on `NotificationPayload`
  (`src-tauri/src/notification/types.rs`), an existing client that POSTs a payload without it fails
  deserialization -> 400. Every deployed `syncfu send` and every third-party HTTP/WS caller breaks.
- **Evidence:** existing optional style fields all use `#[serde(skip_serializing_if = "Option::is_none")]`
  (types.rs lines 40-89); the pattern for additive fields is Option or `#[serde(default)]`.
- **Impact:** silent breakage of all existing integrations the moment the server updates.
- **Recommendation:** the field MUST be `Option<Presentation>` or carry `#[serde(default)]` resolving to
  `card`. Mirror across all three type files (`cli/src/types.rs`, `src-tauri/src/notification/types.rs`,
  `src/types/notification.ts`) per the locked tri-file pattern. Add a deserialize test: payload with no
  presentation field -> defaults to card.
- **Reverification:** Rust test deserializing a pre-island JSON body; CLI integration test with old flags.
- **Cross-refs:** 01-prd (glossary: field name + default), 02-arch, 05-tasks, 06-test.

#### HIGH - CLI flag compat and `--wait` exit-code contract
- **Root cause:** adding `--island` / `--presentation` must default to card and not perturb existing flags;
  and the `--wait` contract (exit 0/1/2, `cli/src/main.rs` lines ~228-240) must hold identically in island
  mode. Model B's list re-presentation and dedupe (D5) change WHEN/WHICH dismiss+action events fire (§1.4-D).
- **Evidence:** `cli/src/main.rs` exit-code match; `cli/src/wait.rs`.
- **Impact:** scripts relying on exit codes (approve=0, dismiss=1, timeout=2) silently get wrong codes when
  island re-ranking/dedup changes event identity.
- **Recommendation:** freeze the exit-code contract as an invariant test that runs against BOTH card and
  island presentations; guarantee per-id event identity through Model B (a merged list never collapses two
  ids into one event).
- **Cross-refs:** 05-tasks, 06-test (parity matrix card vs island).

#### MEDIUM - history omits island notifications
- **Root cause:** history is a FRONTEND store (`src/stores/historyStore.ts`, `prependEntry`), NOT SQLite.
  If the island renders via a new code path/component that does not feed the same event that populates
  history, island notifications never appear in the History view.
- **Evidence:** grep: zero sqlite in src-tauri; `historyStore.ts` exists; population wiring is frontend.
- **Impact:** users lose the audit trail specifically for the new, higher-stakes island notifications.
- **Recommendation:** route island notifications through the SAME NotificationManager.add + the same event
  that feeds `historyStore`, regardless of which overlay window renders them. Presentation is a render
  choice, not a separate pipeline.
- **Cross-refs:** 02-arch (single ingest, two renderers), 06-test (history-includes-island test).

#### MEDIUM - two overlay windows collide
- **Root cause:** the island is a second always-on-top window. `show_panel`/`hide_panel` act on the window
  labeled "overlay" (`panel.rs`). If labeling/identity is sloppy, showing a card could move/hide the island
  or vice versa; both claim top-center vs top-right but z-order and focus stealing can interfere.
- **Evidence:** `src-tauri/src/overlay/panel.rs` single-window design (label "overlay", cursor-monitor
  reposition).
- **Impact:** flicker, wrong-position, or one window hiding the other.
- **Recommendation:** distinct window labels + independent position logic; the island never routes through
  the card's `show_panel`. Decide coexistence routing (ledger open Q: simultaneous? per-notification
  routing?) in PRD/arch before building the window.
- **Cross-refs:** 01-prd (coexistence rule), 02-arch, 03-alternatives (one window vs two).

---

## 4. Session lesson (carried risk): content-vs-shape geometry, the `--di-wall` invariant

#### HIGH - content overruns the concave shoulder despite box-vs-box alignment
- **Lane:** 04 risk / carried session lesson
- **Root cause:** the notch shape has CONCAVE top shoulders drawn by quadratic Beziers whose control point
  sits at the outer top corner (research §1). The drawn black intrudes INTO the rectangular bounding box at
  the top corners, and the walls sit `t` (top radius) inside the box edge. Verifying that the content BOX
  aligns with the island BOX passes while text/icons still collide with the curved wall - which is exactly
  why the bug recurred 3x in the mockup. The fix is the content-inset rule: horizontal padding =
  `max(base, wall + margin)` where `wall = --di-wall`, published live each frame as `t` (notch) or the float
  corner radius (mockup lines 884-887).
- **Evidence:** design decision: mockup publishes `--di-wall` per frame (line 887) and every content root
  derives padding from it: `padding: 0 max(13px, calc(var(--di-wall,6px)+4px))` (line 134),
  `padding: 14px max(16px, calc(var(--di-wall,19px)+5px)) 15px` (line 158), and preset B/OV roots repeat the
  rule (lines 335, 342, 388, 396, 410). The collective_thoughts note flags this explicitly.
- **Impact:** on any port that reintroduces box-vs-box thinking (or hardcodes a padding literal), content
  clips under the curved wall at small widths / large radii / the light-mode expanded card - the single most
  likely visual-fidelity regression.
- **Regression risk:** self-contained to the island; but it is the recurrence-prone defect, so it is a
  CARRIED risk, not a one-time fix.
- **Latent inconsistencies to resolve during the port (do NOT copy the mockup's drift):**
  - the breathing margin added to `--di-wall` VARIES across presets: +4 (line 134), +5 (line 158), +4
    (line 335), +5 (line 342), +4 (line 388/396), +2 (line 410). The implementation must choose ONE rule per
    content type, not inherit six.
  - float-mode wall radius differs between live and static: `expanded ? 24` in `mount()` (line 887) vs
    `expanded ? 22` in `mountStatic()` (line 986). Pick one; otherwise live and screenshot goldens disagree.
- **Recommendation:** name the invariant **R-WALL: content horizontal padding >= --di-wall + margin at every
  radius/width/state**, and give it an OWNING TEST in lane 06: a geometry assertion that, at the content-row
  Y, the content bounding box left/right edges stay inside the SVG path's inner wall (sample the path or the
  computed inset), swept across the full D4 radius/width slider ranges and both compact/expanded and both
  appearances. Box-vs-box alignment is explicitly INSUFFICIENT and must not be the acceptance check.
- **Reverification:** the R-WALL geometry test (content-vs-shape, not box-vs-box) in the visual-regression
  harness; run across the customization gallery states.
- **Cross-refs:** 06-test (owns R-WALL test), 02-arch (single `--di-wall` publisher during the port),
  05-tasks (shape+wall task lands before content layout).

---

## 5. Sequencing hazards (what breaks if built out of order)

Ordered dependencies; violating them causes rework or false confidence.

1. **Platform spikes BEFORE the window.** Two ledger unknowns are load-bearing: (a) Tauri access path to
   NSScreen `auxiliaryTopLeftArea`/`auxiliaryTopRightArea` for notch width; (b) does `set_content_protected`
   take on the tauri-nspanel window. If the island window is built first and (b) fails, the entire panel
   construction is reworked to set `sharingType` via a raw AppKit handle. Both are one-day isolated gates
   (collective_thoughts). **Hazard if skipped:** privacy feature discovered non-functional after the window
   is built -> late rework of the most sensitive path.
2. **Tri-file type change BEFORE transport/CLI/frontend.** The presentation field must land (with serde
   default) across `cli/src/types.rs`, `src-tauri/src/notification/types.rs`, `src/types/notification.ts`
   first; otherwise CLI, HTTP handler, and frontend cannot compile against it and schema drifts between the
   three. **Hazard:** partial adoption -> deserialize mismatch / TS type errors.
3. **Settings persistence + schema BEFORE settings UI and BEFORE the island reads geometry.** The island's
   geometry comes from persistent settings (D4); with no config source it cannot render correctly and the UI
   has nothing to bind. **Hazard:** island hardcodes defaults, settings become cosmetic.
4. **Shape generator + `--di-wall` publisher BEFORE content layout (R-WALL).** Porting the notchPath + spring
   integrator + the single wall-inset publisher must precede laying out compact/expanded content; content
   built first will hardcode padding and reintroduce the 3x-recurring bug. **Hazard:** content-vs-shape
   regression baked in.
5. **Coexistence routing decision BEFORE the second window.** Decide whether island and card can show
   simultaneously and how a notification routes (ledger open Q) before building the island window; otherwise
   the two windows collide (see §3 medium). **Hazard:** rework of `show_panel`/labeling.
6. **Capture-exclusion track gates SHIP, not built last-and-hoped.** If exclusion is deferred to the end and
   fails, the product ships a false privacy claim. Put it behind the early gate (item 1) AND as a release-gate
   manual checklist (lane 06). **Hazard:** catastrophic §2 outcome ships.
7. **rAF dispose/lifecycle BEFORE monitor-change and coexistence work.** The teardown/cancel path (§1.3
   CRITICAL) must exist before recreation logic, or recreation leaks zombie loops.

---

## 6. Performance: rAF spring + per-frame SVG path rewrite in a Tauri webview

#### MEDIUM - continuous rAF + per-frame `d` rewrite pins CPU / drains battery
- **Lane:** 04 risk / performance
- **Root cause:** the morph rewrites `path.setAttribute("d", ...)` and mutates `island.style.width/height`
  every animation frame (mockup 875-893). Changing an SVG `d` attribute is NOT a compositor-only change; it
  forces path re-tessellation + repaint of the SVG layer each frame (unlike transform/opacity). The mockup's
  loop self-halts when springs rest (line 889), so IDLE cost is genuinely zero - the real risk is
  CONTINUOUS animations: a live-activity timer ticking, a progress ring, or the D5 "waiting" pulse
  (`0.35<->1 @0.7s`, research §4) keep something animating, and any long-lived compact live-activity keeps
  the island in a perpetual repaint if the pulse/timer is driven through the same rAF or re-triggers `kick()`.
- **Evidence:** design decision: mockup `frame()` + `kick()`; research §4 waiting-pulse; §2
  `MAX_CONCURRENT_ANIMATIONS = 8` frame-budget guard that syncfu has not adopted.
- **Impact:** on a MacBook a continuously repainting top-center webview (WKWebView / WebView2 / WebKitGTK)
  can hold a CPU core busy and measurably cut battery during exactly the long-running-agent scenario the
  feature targets. Multi-monitor / multiple concurrent islands multiply it.
- **Secondary root cause (feedback loop):** `setTargets()` -> `requestAnimationFrame(measure)` -> `measure()`
  -> `sH.to(...)` -> `kick()` (mockup 850-873). If measured inner height oscillates by a sub-pixel each pass,
  the loop never rests -> permanent rAF. Needs an epsilon/rounding guard on the height target.
- **Recommendation:**
  - separate "morph" animation (transient, must rest) from "live-activity" animation (timer/ring/pulse):
    drive continuous indicators with cheap CSS transform/opacity keyframes or a throttled timer, NOT the
    path-rewriting rAF; the path loop should only run during an actual shape transition.
  - cap concurrent animations (adopt the `MAX_CONCURRENT_ANIMATIONS` idea) and pause all animation when the
    island window is occluded/hidden or the display is asleep.
  - add an epsilon so `measure()` does not re-kick on sub-pixel height noise.
  - honor `reducedMotion` (D3 near-instant spring 1000/100) which collapses the morph to ~1 frame.
  - budget target: 0% CPU at rest (verify), and a bounded ceiling during a live timer (measure on each OS
    webview).
- **Reverification:** a performance probe (Playwright + CDP or manual Instruments/WebView2 profiler): assert
  no frames scheduled 500ms after a morph completes; measure CPU with a running compact timer over 60s per OS.
- **Cross-refs:** 02-arch (split morph vs live-activity animation), 06-test (idle-cost probe), 05-tasks.

---

## 7. Deployment threat surface per OS

#### MEDIUM - macOS: AppKit/private-API reach threatens notarization robustness and version durability
- **Root cause:** to read notch geometry (`safeAreaInsets`, `auxiliaryTopLeftArea/RightArea`) and to set
  `sharingType` on the panel, the implementation reaches into AppKit via objc2 / raw handles. Those specific
  NSScreen APIs are PUBLIC, so notarization (Developer ID) is unaffected. The threat is if the team copies
  boring.notch's PRIVATE SkyLight path (`SLSRemoveWindowsFromSpaces`, `CGSSpace(level: max)`) for space
  hosting: private frameworks are fragile across macOS releases (can break or change behavior each major
  version) and would block Mac App Store distribution (not Developer ID notarization, which still allows it,
  but it is a durability and review-risk hazard).
- **Evidence:** research §5 boring.notch SkyLight usage; research notes `sharingType` is the only primitive
  actually needed; §2 above (sharingType deprecation on Sonoma+).
- **Impact:** brittle overlay that breaks on a macOS point release, or a harder App Store path.
- **Recommendation:** use ONLY public NSScreen + `sharingType`/`set_content_protected`; explicitly do NOT
  adopt SkyLight private-space hosting (it is orthogonal to the feature, per research). Pin a manual
  smoke-test on each new macOS major. Verify `sharingType=.none` still excludes under ScreenCaptureKit
  recorders on macOS 14/15 (deprecation risk, §2).
- **Reverification:** notarization dry-run of a signed build; per-macOS-version capture smoke test.
- **Cross-refs:** 02-arch, 06-test (capture track), 05-tasks (spike).

#### MEDIUM - Windows: display-affinity vs GPU/hook capture, and build-gate
- **Root cause:** `WDA_EXCLUDEFROMCAPTURE` requires build 19041+; below it the call fails and, unless
  handled, the toggle lies. And exclusion is honored by Display/Window/Duplication and WGC capture but is NOT
  a guarantee against an in-process swapchain hook (OBS Game Capture hooking syncfu's own present) or a
  hardware capture card / kernel capture.
- **Evidence:** research §5 (build 2004+); Windows display-affinity semantics.
- **Impact:** false confidence on old builds or against hook/hardware capture.
- **Recommendation:** gate the toggle on `GetVersion`/build >= 19041 at startup (disable + explain below);
  read back `GetWindowDisplayAffinity` to confirm; document in-UI/docs that exclusion covers
  screen/window/display capture, not a process-level hook or hardware capture. Verify against real OBS
  (Display Capture and Game Capture) before claiming coverage.
- **Reverification:** manual OBS matrix on Windows (Display / Window / Game capture) in the capture track.
- **Cross-refs:** 06-test (Windows capture matrix), 02-arch (build probe), 05-tasks.

#### MEDIUM - Linux: no exclusion + Wayland overlay/positioning fragility
- **Root cause:** no capture-exclusion primitive (research §5). Separately, top-center always-on-top
  positioning is unreliable on Wayland (clients cannot freely set global window position; layer-shell is
  needed and not universally available), and the current Linux path is "deferred / basic WebviewWindow"
  (`panel.rs` header comment line 6). So both the anchoring AND the privacy guarantee degrade on Linux.
- **Evidence:** `src-tauri/src/overlay/panel.rs` line 6 ("Linux: Deferred"); research §5; Wayland
  positioning constraints.
- **Impact:** island may not anchor top-center on Wayland and definitely cannot hide from capture.
- **Recommendation:** scope Linux as graceful-degradation (brief NFR): float capsule best-effort, disabled
  capture toggle with honest messaging (no false fallback, §2). Do not block macOS/Windows ship on Linux
  parity. Document the limitation in the PRD non-functional section.
- **Cross-refs:** 01-prd (Linux degradation NFR), 02-arch (Linux positioning), 03-alternatives.

---

## Carried-risk register (summary for lane 90 synthesis)

| id | risk | sev | owning guard / test | owner lane |
|---|---|---|---|---|
| R-CAPTURE | capture exclusion silently off (nspanel / old-Win / Linux / recreation) | CRITICAL | apply-first + read-back verify + capability probe + honest UI + re-apply on create; dedicated per-OS manual capture track | 06 + 05 gate |
| R-RAF-DISPOSE | rAF loop touches dead DOM / zombie loop on teardown | CRITICAL | dispose() cancels frame; make-before-break recreation | 02 + 06 |
| R-WAIT-ID | Model B merges ids -> `--wait` wrong exit code / hang | HIGH | preserve per-id Dismissed/Action events; exit-code parity test card vs island | 05 + 06 |
| R-OLDCLIENT | required new field rejects pre-island payloads | HIGH | Option/`#[serde(default)]` = card; old-payload deserialize test | 02 + 06 |
| R-WALL | content overruns concave shoulder (box-vs-box passes, content clips) | HIGH | R-WALL geometry test content-vs-shape across all radii/widths/states; one wall publisher; resolve +margin and 22/24 drift | 06 + 02 |
| R-HISTORY | island notifications skip the frontend history store | MED | single ingest, two renderers; history-includes-island test | 02 + 06 |
| R-TWOWIN | island and card windows collide (labels / show_panel) | MED | distinct labels + independent position; coexistence rule decided first | 01 + 02 |
| R-PERF | per-frame `d` rewrite + continuous live-activity pins CPU | MED | split morph vs live-activity anim; cap concurrency; epsilon on measure; idle-cost probe | 02 + 06 |
| R-SETTINGS-WRITE | non-atomic settings write corrupts config | MED | atomic temp+rename; parse-with-default fallback | 02 + 05 |
| R-MACOS-PRIVATE | SkyLight private API adopted -> version fragility | MED | public NSScreen + sharingType only; forbid SkyLight | 02 |
| R-SSE-FALSE-DISMISS | dropped SSE stream reports false Dismissed (exit 1) | MED (inherited) | flag; consider distinguishing stream-drop from real dismiss | 05 |

---

## Cross-references for other lanes

- **-> 01-prd:** add FRs/NFRs for: `--wait` behavior in island (pin waited item, force-visible); coexistence
  rule (island + card simultaneous? routing?); Linux graceful-degradation NFR (no false capture fallback);
  presentation field name + default = card in the glossary. Correct the "history in SQLite" claim - history
  is a frontend store.
- **-> 02-architecture:** single ingest / two renderers (R-HISTORY, R-OLDCLIENT); distinct window labels and
  independent position logic (R-TWOWIN); raw-handle access for capture read-back (R-CAPTURE); one `--di-wall`
  publisher during the port (R-WALL); split morph vs live-activity animation and a dispose() lifecycle
  (R-PERF, R-RAF-DISPOSE); public-API-only on macOS (R-MACOS-PRIVATE); atomic settings write (R-SETTINGS-WRITE).
- **-> 03-alternatives:** one window vs two windows (R-TWOWIN feeds this); Linux no-fallback vs
  frontmost-app-detection fallback (recommend no-fallback, §2 Linux failure modes); adopting `motion` vs the
  mockup's rAF integrator interacts with R-PERF and R-RAF-DISPOSE (a library gives lifecycle/teardown for
  free but does not solve per-frame `d` cost).
- **-> 05-tasks:** two EARLY isolated gate tasks (notch-geometry access; set_content_protected-on-nspanel
  read-back) BEFORE the window; enforce build sequence in §5; capture track gates ship; tri-file field with
  serde default; dispose lifecycle before recreation/monitor-change tasks.
- **-> 06-test-strategy:** OWNS the dedicated capture-exclusion track (per-OS manual matrix incl. OBS
  Display/Window/Game on Windows, ScreenCaptureKit recorders on macOS 14/15); OWNS R-WALL content-vs-shape
  geometry test (not box-vs-box); exit-code parity matrix card vs island (R-WAIT-ID); old-payload deserialize
  test (R-OLDCLIENT); history-includes-island test (R-HISTORY); idle-cost/CPU perf probe (R-PERF); dispose
  cancels rAF test (R-RAF-DISPOSE).
- **-> 80-feasibility:** the two ground-truth corrections (no SQLite history; set_content_protected unused
  today) and the `sharingType` deprecation on macOS 14+ are feasibility inputs, not just risks.
