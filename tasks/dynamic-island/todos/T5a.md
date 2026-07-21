# TODO T5a - Functional parity: actions / --wait / timeouts / countdown

| Reference instruction (do not skip): Identify root cause first. Stay grounded. /think regression
| possibilities. Trace call paths. Verify reachability. Understand context, not just lines. Check
| references and usages. /simplify only after thorough /review. If clarity is missing in any area,
| capture the uncertainty here and resolve it during execution.

**Why:** D1 mandates functional parity. Island actions must drive the SAME action_callback -> waiter
-> CLI exit-code path as the card (no new transport). A4 (binding): a notification with a pending
waiter keeps a 1:1 id->waiter mapping - encoded at the action layer here, enforced again in T6's
dedupe.

**What:** IslandExpanded gains primary/secondary/danger action buttons + the countdown (mirroring
NotificationCard's behavior, styled per the approved mockup anatomy); Island.tsx gains the --wait
stays-expanded-until-answered rule (a notification with actions+waiter suppresses auto-collapse
until answered); priority timeouts 6s/8s/12s/critical-never honored in island mode with countdown
reflecting the timeout; auto-dismiss resolves the waiter with dismissed (exit 1), timeout exit 2,
action exit 0 - identical to card.

**How:** Reuse NotificationCard's action invocation path verbatim (trace how the card invokes
action_callback and reuse the same invoke/command); reuse its timeout/countdown logic where
extractable without refactoring the card (extract-only if shared, duplicate-minimal otherwise -
document the choice). T4b's IslandHandle collapse/expand + hold suppression is your lifecycle
surface. waiters.rs and cli/wait.rs are UNTOUCHED (reuse).

**Files:** `src/components/island/IslandExpanded.tsx`, `src/components/island/Island.tsx`,
`src/components/island/IslandCompact.tsx` (countdown-aware trailing slot if needed), island.css,
tests (+ a Rust/CLI integration test for the island --wait roundtrip).

**Dependencies:** T4a, T4b, T1 (all merged).

**progress.txt observations:** T4b exposes IslandHandle {expand, collapse, state} + ENTRY_HOLD_MS;
the card's TIMEOUTS map lives in NotificationCard (low 6s/normal 8s/high 12s/critical null).
Known pre-existing: SSE false-dismiss on stream-end (cli/src/wait.rs:74) - FLAG in comments, do
not fix here.

**Architectural alignment note:** parity contract - no island-specific timing; A4 waiter identity;
no new transport; card path untouched.

**Known unknowns:** none material; document any card-logic extraction decision.

**Acceptance:** integration test `syncfu send --presentation island --wait -a approve:Approve`
returns 0 on approve / 1 on dismiss / 2 on timeout; two-waiters-same-dedupe-key collision test
asserts both resolve correctly (A4 - at this stage each keeps its own island instance/row);
critical-never-dismisses test; Playwright renders actions + countdown; all gates green
(cargo + tsc + vitest + playwright x2).
