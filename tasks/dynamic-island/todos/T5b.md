# TODO T5b - Progress (bar + ring) + lifecycle interruption state machine

| Reference instruction (do not skip): Identify root cause first. Stay grounded. /think regression
| possibilities. Trace call paths. Verify reachability. Understand context, not just lines. Check
| references and usages. /simplify only after thorough /review. If clarity is missing in any area,
| capture the uncertainty here and resolve it during execution.

**Why:** Completes functional parity (progress bar + ring) and closes the FR-15 completeness gate:
the full compact/expanded lifecycle interruption state machine with every transition enumerated
(the plan's interruption-states gate; C4 ratified arrive-expanded-then-collapse so no UNSPEC cells
remain).

**What:** IslandExpanded gains progress bar + ring (mirroring NotificationCard's progress render
via shared logic where extractable); IslandCompact gains live-activity progress ring/timer in the
trailing slot (CSS transform/opacity animation ONLY - never the path rAF, R-PERF); Island.tsx gains
the explicit lifecycle state machine (hidden / compact / expanded / morphing; list-open arrives in
T6 - leave the seam) with the interruption transitions from 04-risk S1 + 02-architecture S7:
new-notification-mid-morph = latest-wins re-present (never half-morph); progress update after
collapse updates the pill live-activity and expand shows current value (never stale); update flow
re-renders inside the island without frame resize.

**How:** Build on T4b's controller (animateTo/snap/measure) and T5a's decision/timeout logic.
Progress events arrive via the existing Update flow - trace notification:update handling in
useNotifications/store first. Keep progress fixtures within the 72..560 content range (T4b review
edge note: floor/cap handoff jump exists outside it). The mid-morph interruption test should
screenshot MID-FLIGHT (T4b review coverage gap) - use __islandFrames/settle hooks to time it.

**Files:** `src/components/island/IslandExpanded.tsx`, `IslandCompact.tsx`, `Island.tsx`,
`src/styles/island.css`, tests + e2e.

**Dependencies:** T5a (merged), T4b (merged).

**progress.txt observations:** T4b edge notes in the thought ledger (floor/cap handoff, mid-flight
coverage); T5a extracted resolveTimeout/actionStyle to src/lib - follow that pattern if progress
logic is shared with the card.

**Architectural alignment note:** D3 - frame never resizes during any interruption; R-PERF split -
live-activity is CSS-only animation; latest-wins re-present per the risk lane's interruption matrix.

**Known unknowns:** exact interruption matrix rows - read 04-risk section 1 + 02-architecture S7
tables in the run folder and enumerate each as a test; monitor-change-during-morph is frontend
teardown-ordering only (window recreation is T9/T3 territory - note, do not build).

**Acceptance:** Vitest state-machine specs, one per interruption row; Playwright settled snapshots
for progress bar/ring compact + expanded; a mid-morph new-notification test asserting the frame
never resizes AND capturing a mid-flight frame; progress-after-collapse freshness test; all gates
green (cargo + tsc + vitest + playwright x2).
