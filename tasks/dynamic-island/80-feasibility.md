# Lane 80 - Coherence + Feasibility (Wave A)

**/think framework(s):** map-vs-territory grounding (every cross-lane claim checked against the repo and the
other lanes) + consistency-audit (pairwise lane contradiction scan) + coverage-matrix completeness gate.

**Scope:** Wave A assessor. PLAN ONLY. I verified the load-bearing ground-truth claims against the repo
(results in section 0). Findings use the coordination-model schema. No em dashes.

---

## 0. Ground-truth spot-checks (this session, against the repo)

| Claim under test | Source lane | Verdict |
|---|---|---|
| History is a FRONTEND store, not SQLite | 04-risk correction | CONFIRMED. `src/stores/historyStore.ts` exists; `grep -rli rusqlite\|sqlx\|sqlite src-tauri/src cli/src` returns nothing. |
| `set_content_protected` unused in current source | 04-risk correction | CONFIRMED. Absent from `src-tauri/src` (only in `gen/schemas/*`). |
| `App.tsx` routes by window label | 02-architecture | CONFIRMED. `App.tsx:8-14`: `label === "overlay"` -> `NotificationOverlay`, else `MainApp`. A third `island` branch is a one-line add. |
| `tauri-plugin-store` and `objc2` NOT dependencies; `tauri-nspanel` IS | 02/03 | CONFIRMED. `Cargo.toml:49` has `tauri-nspanel`; no `tauri-plugin-store`, no `objc2`. |

All four corrections the risk lane raised are real. The corollary matters: **three downstream docs still carry
the wrong "SQLite history" claim** (see CONTRADICTION C2).

---

## 1. COVERAGE MATRIX

Legend: arch = 02 section; task = 05 task id; test = 06 section. GAP = a missing or unratified cell.

### FR coverage

| FR | Requirement | Arch | Task | Test | Status |
|----|-------------|------|------|------|--------|
| FR-1 | `presentation` field, default card, tri/five-file + CLI + HTTP/WS | S2 | T1 | 1a enum round-trip; S5 kind round-trip | OK |
| FR-2 | senders cannot set geometry (payload = 27 style only) | S2, S4 | T1 + T7 | S5 payload-only-overrides; T7 verify geometry ignored | OK |
| FR-3 | island + card coexist; routing per OQ-9 | S8 | T4 (frontend filter only) | S5 old-payload + card pixel-identical | **GAP** - see C7; backend `notify()` routing unowned; OQ-9 open |
| FR-4 | notch anchor / float capsule | S1, S6 | G1 + T3 | 1a `calculate_island_position`; 2c platform trio | OK |
| FR-5 | SVG concave-shoulder path, radii/clamps, ported | S3, S6 | T2 | 1a path/clamps; 2c shot-* + corner zoom | OK |
| FR-6 | morph springs; never animate frame; hover 1.028/150ms | S1, S3 | T2 (springs) + T3 (frame held) | 1b morph SM; 2d spring determinism | PARTIAL - hover 1.028/150ms not in any task invariant or test (F-LOW-1) |
| FR-7 | wall-inset content-vs-shape (`--di-wall`) | S3 | T2 -> consumed T4/T8 | S3 content-vs-shape sweep (headline) | OK (strongest-covered FR) |
| FR-8 | 13 settings, ranges, defaults | S4 | T7 | 1a settings clamp | PARTIAL - topRadius/bottomRadius ranges left as "(radius range)"/"per mockup"; not numeric (F-MED-3) |
| FR-9 | settings app-wide, not per-notification | S4 | T7 | 1b/S5 | OK |
| FR-10 | light appearance rules; notch pill stays black | S4 (settings.appearance) | T8 | 2c theme cells; T8 light stage | OK |
| FR-11 | compact spotlight + xN badge (`26+8*(digits-1)`, 9+) | S7 | T6 | 1a badge formula | OK |
| FR-12 | ranked deduped list cap 6/560px, stagger 40-60ms, pause | S7 | T6 | 1a queue rank/dedupe; 1b Model B | OK (dedupe key unratified - C6) |
| FR-13 | Models A/C rejected + guard | S7 (Model B only) | T6 | none explicit | PARTIAL - no test asserts A/C absent; guard is T6 invariant only (F-LOW-2) |
| FR-14 | functional parity (actions/wait/timeouts/progress/grouping/27 overrides) | S7 | T5 | S5 wait round-trip + timeout parity | OK |
| FR-15 | lifecycle + interruption states | S7 state table | T5 | S6 interruption | PARTIAL - lifecycle default not ratified by PRD; OQ-2 open (C4) |
| FR-16 | click-through when idle; no jank | S1 (click-through toggle) | T3 + T5 | US-002 AC (Playwright) | OK (S1 flags this as riskiest interaction) |
| FR-17 | capture exclusion macOS/Windows | S5 | G2 + T9 | S4 capture track | OK (macOS 14+ deprecation caveat - C3) |
| FR-18 | Linux documented behavior | S5 | G2 + T9 + T10 | S4d Linux warning | OK |

### Locked-decision MUST coverage

| Locked MUST | Arch | Task | Test | Status |
|---|---|---|---|---|
| D3 radii 6/14 -> 19/24 | S3 | T2 | 1a | OK |
| D3 clamps t<=min(W/4,H/4), b<=min(W/4,H/2) | S3 | T2 | 1a radius clamps | OK |
| D3 springs 220/25, 400/30, 260/18, 1000/100 | S3 | T2 | 1b, 2d | OK |
| D3 hover 1.028 top-anchored, 150ms delay | FR-6 text | none | none | **GAP** (F-LOW-1) |
| D3 never animate OS frame | S1 | T3 | S6 (frame never resizes) | OK |
| D4 compactWidth/expandedWidth/height/surfaceOpacity | S4 | T7 | 1a clamp | OK |
| D4 topRadius/bottomRadius/cornerScaling | S4 | T7 | 1a | PARTIAL - radius ranges undefined (F-MED-3) |
| D4 accent presets + custom | S4 | T7 | (theme cells) | OK |
| D4 mode notch/float | S4 | T7 | 2c | OK |
| D4 position left/center/right/bottom-center (float; bottom-center up) | S1 (anchor) | T8 | T8 anchoring | OK |
| D4 appearance dark/light/auto (notch compact stays black) | S4 | T8 | 2c light stage | OK |
| D4 reducedMotion (1000/100) | S3 | T2 | 2d reduced-motion | OK |
| D4 hideFromScreenCapture | S5 | T7 (knob) + T9 (wire) | S4 | OK |
| D5 spotlight + xN badge | S7 | T6 | 1a | OK |
| D5 ranked deduped list cap 6/560px scroll+fade | S7 | T6 | 1a/1b | OK |
| D5 stagger 40-60ms, critical first | (implicit) | T6 | (implicit) | PARTIAL - stagger timing not in a test invariant (F-LOW-2) |
| D5 auto-dismiss paused while list open | S7 | T6 | 1b, S6 | OK |
| D5 Models A/C rejected | S7 | T6 (guard) | none | PARTIAL (F-LOW-2) |
| D5 Model B ownership (where rank/dedupe/count LIVE) | S7 says FRONTEND | T6 FRONTEND (`rankDedupe.ts`) | 1a Rust AND 1b frontend | **CONTRADICTION** vs alternatives G10 (Rust) - C1 (top finding) |
| Capture exclusion own track (D1) | S5 | G2 + T9 | S4 (dedicated) | OK |

**Coverage verdict:** 14 of 18 FRs fully covered. FR-3, FR-6, FR-8, FR-13, FR-15 have gaps. The single most
serious structural gap is not an FR row but a cross-lane disagreement on Model B ownership (C1).

---

## 2. CONTRADICTION SCAN

### C1 (HIGH) - Model B ownership: frontend (arch + tasks) vs Rust (alternatives G10)
- Evidence: `03-alternatives.md` Axis 7 recommends 7A "Rust `NotificationManager` owns the canonical
  ranked+deduped list + spotlight + count" and encodes it as **guard G10 (Type-1, hard)**: the ranked list,
  spotlight, and count "MUST live in the Rust `NotificationManager`; the frontend holds only ephemeral view
  state." `02-architecture.md` S7 says the opposite: "no queue moves to the frontend and no manager change for
  ranking; `IslandList` computes rank/dedupe/cap as a pure view selector" in `src/lib/islandRanking.ts`.
  `05-tasks.md` T6 follows architecture: `src/components/island/rankDedupe.ts` (frontend TS).
  `06-test-strategy.md` cannot decide either: 1a lists "Queue ranking + dedupe" as a **Rust** unit while 1b
  lists "Model B list logic (port of mockup ModelB)" as a **frontend Vitest** unit.
- Impact: the plan currently ships a silent violation of a locked Type-1 guard. Two "sources of truth" risk is
  exactly what G10 guards against (Rust dedup-by-id vs TS dedup-by-group drifting). Test lane doubling the
  ranking spec in both languages is the tell.
- Resolution (synthesis must pick ONE and propagate):
  - Option A (honor G10): move rank/dedupe/spotlight/count into `NotificationManager` (Rust); frontend
    `IslandList` renders what it is handed. Update arch S7, T6, and test 1a-only. Keeps the tested Rust core
    single-source. Cost: a pause/resume command round-trip for "auto-dismiss paused while list open" (the one
    con G10 itself names).
  - Option B (re-adjudicate G10): the alternatives lane explicitly allows re-adjudication citing the guard.
    If chosen, record the re-adjudication in 03, delete the Rust-side ranking test row from 06 1a, and note
    that the manager stays source-of-truth for the *set* while the *view computation* is a pure frontend
    module. This is defensible because the store already mirrors the active set via `notification:add`.
  - Recommended: **Option B is cleaner given the existing broadcast**, but it MUST be an explicit
    re-adjudication of G10, not a silent divergence. Do not leave the plan as-is.

### C2 (MEDIUM) - "SQLite history" claim survives in three docs after the risk lane corrected it
- Evidence: 04-risk ground-truth correction (verified in section 0): history is `src/stores/historyStore.ts`,
  no SQLite. Yet `prd-dynamic-island.md` S7 regression surface says "history/SQLite"; `05-tasks.md:11` lists
  "SQLite history" as the regression surface; `06-test-strategy.md` S5 last bullet asserts "an island
  notification is written to the **SQLite history** ... assert row present."
- Impact: the 06 S5 history test is specified against a store that does not exist. If implemented literally it
  cannot pass; if reinterpreted ad hoc, the R-HISTORY invariant (island notifications must reach the history
  store) may not be tested at all.
- Resolution: synthesis rewrites the 06 S5 history bullet to assert `historyStore.prependEntry` receives the
  island notification via the same event that feeds it today; correct the PRD S7 and tasks:11 wording from
  "SQLite" to "frontend history store." R-HISTORY (single-ingest, two-renderers) is the correct design; only
  the storage-medium noun is wrong.

### C3 (MEDIUM) - macOS capture strategy vs `sharingType` deprecation on 14+
- Evidence: 04-risk correction: "`NSWindow sharingType` write is deprecated on macOS 14+ ... capture strategy
  must use public APIs (feasibility input)." Architecture S5 and G2 name the fallback as raw AppKit
  `sharingType = .none`. `set_content_protected(true)` (Tauri) maps to `NSWindowSharingNone`, the same
  deprecated property. So both the primary and the fallback rest on the deprecated API.
- Is the plan coherent? Mostly. Deprecated != removed; the property still functions on 14/15. The real
  question is behavioral: does it still EXCLUDE under a **ScreenCaptureKit**-based recorder (modern OBS,
  macOS 14/15 share)? 06 S4b answers yes-must-verify ("verify `sharingType=.none` still excludes under
  ScreenCaptureKit recorders on macOS 14/15") and probes via `SCScreenshotManager`. But **G2's own
  acceptance criterion only names "QuickTime/OBS"**, not ScreenCaptureKit explicitly, and offers no Plan C if
  both the Tauri call and raw `sharingType` fail to exclude under ScreenCaptureKit.
- Resolution: tighten G2 pass/fail to read: "island absent from a **ScreenCaptureKit-based** capture
  (macOS 14/15) AND a legacy `screencapture -x` capture." Add a named Plan C to G2: if neither excludes under
  ScreenCaptureKit, the island window must be built as a plain capturable-excludable `WebviewWindow` rather
  than an NSPanel, trading the NSPanel space-joining behavior. This makes the G2 gate genuinely load-bearing.

### C4 (MEDIUM) - Lifecycle default: tasks assumed it, PRD did NOT ratify it
- Evidence: ledger `[from:05-tasks]` and T4 "implements arrive-expanded-then-collapse-to-pill as the
  recommended default." PRD FR-15 + OQ-2 leave the lifecycle model **open** ("MUST be resolved before US-002
  ships"). The PRD did not ratify; it deferred.
- Impact: T4 and T5 build a state machine on an unratified default. If OQ-2 later resolves to
  arrive-as-pill-expand-on-activity, T4/T5 rework the entry transition and every interruption row keyed to it.
- Resolution: synthesis must have the PRD ratify OQ-2 = arrive-expanded-then-collapse-to-pill (the tasks
  provisional) BEFORE T4 starts, or explicitly flag T4/T5 as blocked on OQ-2. Do not start T4 with OQ-2 open.

### C5 (RESOLVED, no action) - Settings backend: serde JSON (arch) vs tauri-plugin-store (alternatives)
- Evidence: 02-architecture S4 picks plain serde JSON file ("`tauri-plugin-store` NOT installed"). 03
  Axis 5 recommends 5A `tauri-plugin-store` **but explicitly blesses 5B (JSON file + commands) as "equally
  acceptable"** and states "this axis does not force one; it forces NOT SQLite." Guard G6 only forbids SQLite.
- Verdict: NOT a real contradiction. Architecture's serde-JSON choice sits inside the alternatives' accepted
  set and honors G6. T7 defers the mechanism to architecture. Resolution: adopt architecture's plain serde
  JSON (`island.settings.json`); no plugin. Synthesis just needs to state this once so T7 is unambiguous.

### C6 (MEDIUM) - Dedupe-key semantics: architecture is concrete, others are vague and non-matching
- Evidence: architecture S7 concretely proposes `dedupe key: payload.group ?? \`${sender}::${title}\``. PRD
  FR-12 defers to OQ-6 (open). T6 says "by group? by live-activity key? confirm with 02/01." 06 1a says
  "dedupe by group/live-activity key." The phrase "live-activity key" appears in tasks/tests but is never
  defined anywhere, and does not match architecture's `sender::title` fallback.
- Impact: three lanes reference an undefined "live-activity key"; only architecture has a buildable rule. If
  unreconciled, T6 and its test will encode different keys, and R-WAIT-ID (per-id event identity through the
  merged list) interacts with this.
- Resolution: adopt architecture's concrete rule into PRD OQ-6: dedupe key = `group ?? sender+"::"+title`;
  delete the undefined "live-activity key" phrasing from T6 and 06 1a, or define it explicitly if intended.

### C7 (MEDIUM) - T4 routing contradicts the dedicated-island-window design
- Evidence: architecture S3/S8 route the island via `App.tsx` label (`label === "island"` -> `IslandOverlay`),
  a SEPARATE window created by T3, and defense-in-depth has `NotificationOverlay` keep only
  `presentation !== "island"` (i.e. EXCLUDE island). T4's file list instead says "routing in
  `src/components/overlay/NotificationOverlay.tsx` (render Island when `presentation === "island"`, else
  existing stack)." That renders the Island component INSIDE the top-right overlay window and is the opposite
  of the architecture filter. Verified `App.tsx:8-14` routes strictly by label today.
- Impact: if T4 is implemented as written, the island renders in the top-right overlay window, not the
  dedicated top-center island window T3 built; the two-window coexistence design collapses.
- Resolution: T4 must add `if (label === "island") return <IslandOverlay/>` to `App.tsx` and render `Island`
  under `IslandOverlay`; `NotificationOverlay` filters island items OUT. Fix the T4 file list.

### C8 (LOW) - Ported-module file paths disagree between arch and tasks
- Evidence: architecture puts pure libs in `src/lib/{spring,notchPath,styleVars,islandRanking}.ts`; tasks T2/T6
  put them in `src/components/island/{spring,notchPath,wallInset,rankDedupe}.ts`. Also arch names a
  `styleVars.ts` EXTRACT (DRY of the 27-override map from `NotificationCard`) that tasks never call out as a
  T-owned deliverable.
- Impact: cosmetic + one missing deliverable (the `styleVars.ts` extraction that keeps card and island sharing
  one `--s-*` map). Resolution: pick one directory; add the `styleVars.ts` extraction to T4 (or T2) so the 27
  overrides are not forked.

---

## 3. COMPLETENESS GATES CHECK

| Gate (from context pack) | Status | Evidence / gap |
|---|---|---|
| Interruption states for every state machine, owned | PARTIAL | 04-risk S1 matrix + 02 S7 table + 06 S6 skeleton exist; T5 owns them. BUT several cells are UNSPEC pending OQ-2 (C4), and the "new notification arrives in hidden" transition is undefined until the lifecycle default is ratified. |
| Glossary present; overloaded nouns flagged | PASS | PRD S0 glossary flags Presentation-vs-Kind, Persistent-settings-vs-Payload-overrides, Wall-inset (content-vs-shape). "kind" formally retired. |
| Per-OS deployment threat surface | PASS | 04-risk S7 covers macOS (private-API/notarization, sharingType deprecation), Windows (build 19041 gate, hook/hardware capture), Linux (no API + Wayland positioning). |
| Every MUST has exactly one owner task | PASS (with note) | 05 S3 MUST-ownership matrix. Multi-owner rows (notch = G1+T3+T4; capture = G2+T9) are sequenced with a primary; acceptable. One true hole: **hover 1.028/150ms** (D3) has no owner (F-LOW-1); and the backend `notify()` routing for FR-3 has no owner task (C7-adjacent). |
| Platform unknowns have early gates WITH pass/fail | PASS (tighten G2) | G1 and G2 are Wave 0, isolated, with go/no-go acceptance. G2's pass/fail should name ScreenCaptureKit explicitly and add a Plan C (C3). |
| Rejected alternatives have named guards mapped to owning tasks | PARTIAL | Guard register G1-G12 exists. Mapped to tasks: G11 (A/C) -> T6, G8 (theme) -> T1, G1 (window) -> T3, G2 (motion) -> T2, G5 (notch fallback) -> G1. NOT explicitly mapped to a task-level check: G3 (CSS mask), G4 (canvas), G6 (SQLite settings), G7 (linear tween), G9 (CLI-only), G10 (Model B ownership - and G10 is currently VIOLATED, see C1), G12 (per-notification geometry -> partially T1/T7). |

---

## 4. FEASIBILITY VERDICT PER TASK

Ordering (G1/G2 -> T1 -> T3 -> T4 -> T5 -> {T6,T7} -> T8/T9 -> T10 -> T11) is a valid DAG, acyclic, and
gates are genuinely first (Wave 0). T2 correctly decoupled. Gate-before-window ordering is correct: G2 must
settle the window TYPE before T3 builds it.

| Task | Size | One PR? | Deps | Verdict / flag |
|---|---|---|---|---|
| G1 notch geometry | S | yes (verdict doc) | none | OK. First. |
| G2 capture exclusion | S | yes (verdict doc) | none | OK, but tighten pass/fail (C3): name ScreenCaptureKit + a Plan C. |
| T1 presentation field | S | yes | none | OK. Five/six touch points enumerated; back-compat `#[serde(default)]` correct. |
| T2 shape/spring/wall port + harness | M | borderline | none | OK but on the large edge: 3 pure modules + a Playwright harness route. Acceptable as one PR since all are pure/testable. |
| T3 island window plumbing | M | yes | G1,G2,T1 | OK. Mirrors `calculate_panel_position` pattern; unit-testable pure position fn. |
| T4 island render + morph | **L** | **at risk** | T2,T3 | **Flag Wave V:** bundles engine host + compact pill + expanded card + morph + 27-override wiring + routing. Plausibly splits into (T4a compact/expanded static render, T4b morph engine). Also carries the C7 routing bug and the unratified-lifecycle C4 dependency. |
| T5 functional parity + lifecycle | **L** | **at risk** | T4,T1 | **Flag Wave V:** actions + `--wait` + timeouts + progress + countdown + lifecycle state machine + interruption transitions is a lot for one PR. Splits along parity (actions/wait) vs lifecycle SM. |
| T6 Model B | M | yes (once C1 resolved) | T5 | **Blocked on C1** (ownership). Size OK; where the code lives is not decided. |
| T7 settings schema+persist+IPC+UI | **L** | **at risk** | T4 | **Flag Wave V:** Rust struct + atomic persistence + IPC + TS types + settings UI + live consume. Splits cleanly into (T7a backend settings+IPC, T7b settings UI). C5 (serde JSON) should be locked before start. |
| T8 appearance + position | M | yes | T4,T7 | OK. |
| T9 capture wiring | M | yes | G2,T7 | OK. Depends on G2 verdict being green/Plan-B/Plan-C. |
| T10 docs | S | yes | T1,T5,T7,T9 | OK. |
| T11 e2e journey | M | yes | T5,T6,T7,T8,T9 | OK. Also needs the 06 harness-wiring task (Playwright unwired today) to land first; see below. |

**Missing task:** 06-test-strategy repeatedly calls for a **Playwright-harness-wiring owner task** (pin
version, add `playwright.config.ts` + `webServer`, land against the mockup BEFORE Tauri code) as "the earliest
green gate." 05-tasks has NO such task; it is only referenced inside T2's harness route and T11. Recommend
adding **T0-harness** (or folding an explicit harness-wiring deliverable into T2) so the visual layer exists
before T4. Without it, T2's screenshot acceptance criteria cannot run.

---

## 5. VERDICT

**REVISE.** The plan is structurally sound (valid DAG, gates first, strong wall-inset/capture tracks, glossary
and threat-surface gates passed) but ships one locked-guard violation and several unratified decisions that
will fork implementation if not closed first.

Required revisions before hand-off to `orchestrator-implementor`, in priority order:

1. **C1 (HIGH):** Resolve Model B ownership. Either move rank/dedupe/count to the Rust manager (honor G10) or
   formally re-adjudicate G10 and keep it a frontend pure module. Propagate to arch S7, T6, and delete the
   duplicate ranking test row in 06 (1a Rust vs 1b frontend). No silent divergence.
2. **C2 (MEDIUM):** Correct "SQLite history" to "frontend `historyStore`" in PRD S7, tasks:11, and rewrite the
   06 S5 history test to assert `historyStore.prependEntry` receives island notifications.
3. **C4 (MEDIUM):** PRD ratifies OQ-2 lifecycle default (= arrive-expanded-then-collapse-to-pill) before T4.
4. **C7 (MEDIUM):** Fix T4 routing to `App.tsx` label branch + `IslandOverlay`; `NotificationOverlay` excludes
   island items. As written, the island renders in the wrong window.
5. **C3 (MEDIUM):** Tighten G2 pass/fail to name ScreenCaptureKit (macOS 14/15) and add a named Plan C
   (plain capture-excludable `WebviewWindow` if the NSPanel cannot be excluded).
6. **C6 (MEDIUM):** Lock the dedupe key (`group ?? sender::title`) into PRD OQ-6; remove the undefined
   "live-activity key" phrasing.
7. **F-MED-3 (MEDIUM):** Give topRadius/bottomRadius numeric ranges in FR-8 (currently "(radius range)").
8. **Add the missing Playwright-harness-wiring task** (earliest green gate) to 05-tasks.
9. **C5 (LOW):** State once that settings use plain serde JSON (`island.settings.json`), no plugin, to unblock
   T7. **C8 (LOW):** unify ported-module paths and add the `styleVars.ts` 27-override extraction as an owned
   deliverable. **F-LOW-1:** assign hover 1.028/150ms an owner (T2 or T4) + a test. **F-LOW-2:** add a test
   asserting Models A/C absent and stagger 40-60ms.

Everything else (functional parity, wall-inset track, capture track, threat surface, glossary, DAG) is GO.

---

## Cross-references for other lanes

### What Wave V (85-verify) should try hardest to REFUTE (load-bearing assumptions)

1. **`set_content_protected(true)` excludes the `tauri-nspanel` NSPanel under a ScreenCaptureKit recorder on
   macOS 14/15.** This is the category differentiator and it rests on a deprecated property applied to a
   window type Tauri's API may not reach. If false, G2 -> Plan C -> the whole window strategy (dedicated
   NSPanel) may change. Highest-value refutation target.
2. **The notch geometry (`auxiliaryTopLeftArea`/`RightArea`) is reachable from Rust without `objc2` in the
   tree today.** Adding `objc2-app-kit` is assumed feasible and notarization-safe; refute the "one
   well-maintained crate, no private API" claim, and refute that G1 is truly S-sized.
3. **Model B can be a pure frontend view over `notificationStore` without a second source of truth** (the C1
   crux). Refute that the store faithfully mirrors the manager's active+queued sets at the moment the island
   ranks them (queue promotion, `MAX_VISIBLE=5`, dedup-by-id all live in Rust `manager.rs`).
4. **`--wait` per-id event identity survives the Model B merged list** (R-WAIT-ID). Refute that a list row can
   collapse two ids into one Dismissed/Action event, yielding a wrong CLI exit code (0/1/2 contract).
5. **T4, T5, T7 are each one PR.** Try to prove each is multi-PR (they are all L and bundle multiple concerns).
6. **The morph never re-kicks on sub-pixel measure noise** (04-risk R-PERF secondary cause) - refute that the
   ported `measure -> kick` loop rests without an epsilon guard.

### What SYNTHESIS (90) must resolve

- Pick the C1 Model B ownership resolution and propagate it (the one decision that touches arch + tasks + test
  simultaneously).
- Push the three correction edits (C2 SQLite, C4 lifecycle ratification into PRD, C6 dedupe key into OQ-6).
- Lock C5 (serde JSON settings) and C3 (G2 pass/fail + Plan C) as one-line ratifications.
- Insert the missing Playwright-harness task and re-slice T4/T5/T7 if Wave V confirms they are multi-PR.
- Fill FR-8 radius ranges and assign the hover-spring owner (F-MED-3, F-LOW-1).

BLOCKED note: none. All inputs (PRD artifact, all six Wave R lanes, ledger, repo spot-checks) were available
and read; no lane was missing or unreadable.
