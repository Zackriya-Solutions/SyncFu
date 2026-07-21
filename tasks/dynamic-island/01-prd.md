# Lane 01 - PRD

**/think framework(s):** jobs-to-be-done + socratic (pin the real user job and surface unstated
assumptions) plus inversion (enumerate non-goals). Chosen because the risk here is scope drift, not
math: the load-bearing question is "what is the user actually hiring the island to do, and what nouns
secretly drive two code paths."

OUTPUT_PATH: /Users/sujith/work/2025/syncfu/tasks/prd-dynamic-island.md

**Artifact status:** REAL PRD produced via the `prd` skill in `--sub-skill` (non-interactive) mode. No
fallback needed; the Skill tool loaded and its standard structure was followed. There is no existing
`tasks/prd-syncfu-mvp.md` in this repo (it was referenced in the task but does not exist), so the PRD
follows the skill's own Step 2 structure rather than copying that file.

## Summary of the PRD

The PRD specs the Dynamic Island as an ADDITIVE per-notification presentation alongside the existing
top-right glass card. Structure: glossary, overview, users, goals, 4 user stories, 18 functional
requirements, non-goals, success metrics, and 9 open questions.

Key load-bearing decisions the PRD locks in:
- **Retired the "kind" noun.** The brief used "kind" and "presentation" interchangeably. The PRD makes
  **presentation** the single canonical routing noun and explicitly forbids a second `kind` field, so
  one concept never drives two code paths. Flagged in the glossary.
- **The persistent-settings vs payload-overrides split is the spine.** Persistent settings (13 keys from
  `island.settings.json`) own GEOMETRY + POSITION and are app-wide; payload overrides (the existing 27
  `StyleOverrides` keys) own SKIN and are per-notification. Senders NEVER control geometry. Encoded in
  FR-2, FR-8, FR-9 and repeated in the glossary as flagged terms.
- FRs map to locked decisions: D3 -> FR-4/5/6/7 (anchor, SVG shape, morph springs, wall inset);
  D4 -> FR-8/9/10 (13 persistent settings with ranges/defaults, app-wide, light-mode rules);
  D5 -> FR-11/12/13 (compact spotlight + xN badge, expanded ranked deduped list cap 6/560px, Models A
  and C rejected + guarded).
- Functional parity (FR-14) and lifecycle (FR-15) preserve actions, `--wait` exit codes 0/1/2, priority
  timeouts, progress, grouping, and all 27 overrides.
- Capture exclusion (FR-17/18) is its own dedicated track per D1; macOS + Windows guaranteed, Linux
  documented-only, never claims invisibility it cannot deliver.
- Four user stories cover exactly the four required actors: agent author sending, developer approving
  `--wait`, streamer relying on capture invisibility, user customizing persistent settings.
- Non-goals (section 8) via inversion pass include brief section 9 plus explicit REJECTED guards on
  overflow Models A and C and on per-notification geometry creep.
- The 9 open questions are the intent-ledger `provenance_gaps` verbatim, each assigned an owner lane and
  the FR/US it blocks. OQ-3 (NSScreen notch geometry access) and OQ-4 (does `set_content_protected`
  apply to the tauri-nspanel NSPanel) are called out as early isolated gates.

Every FR carries acceptance criteria; every "MUST" is written so the 05-tasks lane can attach an owner
task.

## Findings

### LOW - "kind" vs "presentation" nouns risked two code paths
- Lane: 01-prd
- Root cause: design decision (brief `tasks/dynamic-island-notification.md:110` uses "kind /
  presentation" as synonyms; open question 8 lists three candidate field names).
- Evidence: brief line 110 "New notification kind / presentation"; intent-ledger provenance_gaps[0].
- Impact: if implementers add both a `kind` and a `presentation` field, routing logic forks and payload
  schema bloats.
- Regression risk: none yet (plan stage).
- Recommendation: PRD retires "kind", canonicalizes "presentation" (glossary + FR-1). Final field NAME
  still open (OQ-1) but the concept is now singular.
- Reverification: architecture lane confirms one routing field in the three type files.
- Cross-refs: 02-architecture (OQ-1).

### MEDIUM - Coexistence semantics undefined (FR-3)
- Lane: 01-prd
- Root cause: design decision gap; brief says island is "additive" and "coexist" (lines 19, 204) but
  never says whether both can be on screen simultaneously.
- Evidence: brief line 204 "both coexist"; no rule for simultaneous island + card display.
- Impact: two overlay windows could show conflicting/duplicate notifications; ambiguous per-notification
  routing.
- Regression risk: touches existing top-right overlay (named regression surface).
- Recommendation: resolve OQ-9 in architecture lane before US-001 ships; PRD requires only that the
  top-right card is undisturbed.
- Reverification: architecture lane states the coexistence rule; test-strategy adds a regression check.
- Cross-refs: 02-architecture (OQ-9), 06-test-strategy.

### MEDIUM - Capture exclusion may not apply to the tauri-nspanel window type (FR-17)
- Lane: 01-prd
- Root cause: design assumption; context pack + brief assume `set_content_protected(true)` works, but
  the island uses an NSPanel via tauri-nspanel and this is an unverified path.
- Evidence: context-pack lines 72-73 and provenance_gaps[3]; brief lines 124-129.
- Impact: catastrophic privacy failure if the island is silently capturable while the toggle reads ON.
- Regression risk: none to existing code; new-window risk.
- Recommendation: OQ-4 early isolated gate (05-tasks); fallback sets `sharingType = .none` via raw
  AppKit handle. Written into FR-17 acceptance.
- Reverification: dedicated capture-exclusion track (D1) records the screen per-OS.
- Cross-refs: 02-architecture (OQ-4), 04-risk, 05-tasks, 06-test-strategy.

## Cross-references for other lanes
- **02-architecture:** owns OQ-1, OQ-2, OQ-3, OQ-4, OQ-7, OQ-8, OQ-9; decide single vs dedicated island
  window (PRD only requires top-right card undisturbed) and reuse-NotificationCard vs new component; port
  the mockup's notchPath/spring/`--di-wall`/Model B logic.
- **03-alternatives:** carry named guards for rejected overflow Models A and C (FR-13) and the
  motion-lib vs hand-rolled-spring choice; guard per-notification geometry creep (FR-2/9).
- **04-risk:** capture-exclusion silent failure is the top privacy risk; Linux gap (OQ-5); notch geometry
  edge cases; morph jank; content-vs-shape wall bug recurred 3x, encode it; owns per-OS deployment threat
  surface.
- **05-tasks:** isolate OQ-3 and OQ-4 as early verification-gate tasks; owner task per MUST FR; carry the
  FR-13 A/C guard as a task.
- **06-test-strategy:** owns the D1 dedicated capture-exclusion track (FR-17/18); visual-regression on
  the mockup `shot-*` ids; assert the FR-7 content-vs-shape invariant not box-vs-box; island visual
  checks are Playwright-based (jsdom is blind to layout animation).
