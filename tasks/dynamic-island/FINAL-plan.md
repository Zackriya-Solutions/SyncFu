# FINAL Plan: Dynamic Island notification (run: dynamic-island)

**Date:** 2026-07-20 · **Base branch:** `main` · **Status:** ready for implementation pending 5 human answers (below)

## TL;DR

Ship the island as a strictly additive presentation: one new `presentation: card|island` payload field
(default `card`, serde-default backward compatible), a dedicated capture-scoped `island` window beside
the untouched top-right overlay, the approved mockup's shape/spring/wall-inset code ported as-is into
`src/lib/`, and Model B overflow owned by the Rust `NotificationManager` emitting full snapshots.
This beat the alternatives (shared window, motion library, frontend queue) because every rejected
option carries a named guard G1-G12 and the two that mattered most were refuted with code evidence:
a shared window leaks the card into capture-exclusion scope, and the frontend store provably diverges
from the manager (four divergence windows, two deterministic).

## The plan package (all in `tasks/dynamic-island/`)

| Artifact | File |
|---|---|
| PRD (18 FRs, glossary, OQ-1..9) | `tasks/prd-dynamic-island.md` (+ lane summary `01-prd.md`) |
| Architecture (dedicated window, tri-file field, port map, settings, capture, notch, Model B, coexistence) | `02-architecture.md` |
| Alternatives + guard register G1-G12 | `03-alternatives.md` |
| Risk register + interruption-state tables + per-OS threat surface | `04-risk.md` |
| Original task decomposition (superseded by synthesis splits) | `05-tasks.md` |
| Test strategy (visual harness, capture track, CI matrix) | `06-test-strategy.md` |
| Coherence audit (C1-C7, coverage matrix) | `80-feasibility.md` |
| Adversarial verdicts A1-A6 (binding) | `85-verify.md` |
| **Reconciled plan + full per-task specs (authoritative)** | `90-synthesis.md` |

Design references: brief `tasks/dynamic-island-notification.md` (D1-D6), approved visual spec
`tasks/dynamic-island-mockup.html` (rev 8), research evidence `tasks/dynamic-island-ui-research.md`.

## Ranked task list (17 tasks; one worktree + one PR each)

Full per-task specs (goal, files, invariants, guards, acceptance) live in `90-synthesis.md` section 3;
this table is the execution index. Critical path in bold.

| # | id | title | depends_on | size |
|---|----|-------|------------|------|
| 1 | T0-HARNESS | Playwright visual harness wired; baselines from the approved mockup (earliest green gate) | none | S |
| 2 | G1 | GATE spike: notch geometry via objc2-app-kit (direct dep "0.3", main-thread, non-notch nullability) | none | S |
| 3 | G2 | GATE spike: capture exclusion, LIVE ScreenCaptureKit probe on macOS 15 + macOS <=14 check + Windows WDA (never property read-back) | none | S |
| 4 | **T1** | Tri-file `presentation` field + `--presentation` CLI flag; old payloads deserialize to `card` | none | S |
| 5 | T2 | Port mockup libs: `src/lib/{spring,notchPath,styleVars,islandRanking}.ts` with eps + measure-rounding + dispose invariants (A6) | T0 | M |
| 6 | **T3** | Dedicated `island` window: `overlay/island.rs` + `calculate_island_anchor` (unit-tested) + App.tsx label routing | G1, T1 | M |
| 7 | **T4a** | Static island render: IslandOverlay host + compact/expanded components + 27 `--s-*` plumbing + C7-corrected routing | T2, T3 | M |
| 8 | **T4b** | Morph engine: spring-driven shape + staged content reveal + `__islandSettled` hook + live `--di-wall` publication | T4a | M |
| 9 | **T5a** | Parity: actions, `--wait` roundtrip, priority timeouts, countdown in island mode | T4b | M |
| 10 | **T5b** | Progress bar/ring + lifecycle interruption state machine (arrive-expanded-then-collapse default) | T5a | M |
| 11 | T6 | Model B in Rust manager: rank/dedupe/cap/count + full-snapshot event + waiter-exemption from dedupe (A3/A4); frontend dumb renderer | T5a | M |
| 12 | T7a | Settings backend: `island.settings.json` serde model, atomic write, clamp-on-read, IPC, TS types | T3 | S |
| 13 | T7b | Settings UI in MainApp + live-push restyle | T7a, T4b | M |
| 14 | T8 | Cross-platform float mode: Win/Linux capsule, positions incl bottom-center (upward expansion), appearance dark/light/auto | T4b | M |
| 15 | T9 | Capture exclusion wiring per G2 verdict + honest per-OS status surface (no false safety on macOS 15+) | G2, T3 | M |
| 16 | T10 | Compat + docs: old-client tests, history-includes-island, README/CLI help/API docs | T6, T9 | S |
| 17 | **T11** | End-to-end operator journey acceptance: `syncfu send --presentation island` through island-approved `--wait` exit 0, all OSes | all | M |

## Surviving risks (each with its owning gate/test)

1. **macOS 15+ capture limitation (product-level, not fixable in code):** SCK ignores
   `sharingType`/`setContentProtected`; Apple DTS confirms no public API. Owned by G2's live probe +
   T9's honest status surface. Needs the OQ-1 product call.
2. Content-vs-shape spill regressions: owned by the T0 harness `--di-wall` leaf audit (box-vs-box is
   only the floor).
3. rAF loop not resting / battery: owned by T2 invariants (eps, rounding, dispose) + idle-CPU probe.
4. `--wait` exit-code corruption under dedupe: owned by T6's two-waiters-same-key collision test.
5. Frontend/manager state divergence: owned by T6 snapshot protocol (no delta-derived island state).

## Open questions - ALL RESOLVED by the user (2026-07-20)

1. **OQ-1 RESOLVED - honest scoping.** Capture invisibility guaranteed on macOS <= 14 + Windows.
   On macOS 15+: still set the flag (covers legacy capture paths), settings shows an honest
   "limited on this OS" status, documented limitation. NO auto-hide fallback subsystem. T9 scope
   is fixed accordingly; marketing claims must match.
2. **OQ-2 RESOLVED - arrive expanded then auto-collapse to compact live pill**; `--wait` stays
   expanded until answered. T5b builds exactly this.
3. **OQ-3 RESOLVED - `presentation`** (`card` | `island`, default `card`), CLI `--presentation`.
   T1 uses this name verbatim.
4. **OQ-4 RESOLVED - mockup values confirmed**: topRadius 0-24 default 6, bottomRadius 0-40
   default 14 (user accepted the approved-mockup defaults).
5. **OQ-5 RESOLVED - Linux toggle disabled + honest "Not supported on Linux" label.** No process
   detection.

## PRD amendments required (itemized in 90-synthesis.md section 5; apply, do not silently edit)

Six edits: capture-scoping FR rewrite (A1), waiter-dedupe-exemption FR (A4), lifecycle ratification
(C4), dedupe-key wording (C6), history-store correction (C2), radius ranges (OQ-4).

---

**Next:** `/orchestrator-implementor dynamic-island` (same run folder; `90-synthesis.md` section 3 is
the authoritative per-task spec).
