# TODO T4b - Morph engine + lifecycle entry transition

| Reference instruction (do not skip): Identify root cause first. Stay grounded. /think regression
| possibilities. Trace call paths. Verify reachability. Understand context, not just lines. Check
| references and usages. /simplify only after thorough /review. If clarity is missing in any area,
| capture the uncertainty here and resolve it during execution.

**Why:** T4a renders static states; this wires T2's spring engine so the island morphs
compact<->expanded inside the fixed frame. Locks in the ratified lifecycle default (OQ-2:
arrive expanded, auto-collapse to pill) and the A6 rest guarantees on the LIVE loop.

**What:** Island.tsx becomes the rAF loop host: setTargets/measure/frame ported from the mockup
controller (createIsland ~lines 800-950 of tasks/dynamic-island-mockup.html), publishes --di-wall
live each frame, exposes window.__islandSettled for the visual harness, arrive-expanded ->
auto-collapse entry transition with a collapse trigger surface T5 can call. island.css gains the
morph-driven vars.

**How:** Use T2's Spring/createSpringLoop/pickSpring verbatim (no new spring code). measure() stays
one-shot (rAF-scheduled, never inside frame()); retargets go through the rounding guard; dispose()
on unmount AND window-close cancels the pending frame. Hover 1.028/150ms via T2 HOVER. Reduced
motion -> pickSpring swap collapses morph to ~1 frame. Live-activity animation (pulse/timer/ring)
is CSS transform/opacity ONLY - never the path-rewriting loop (R-PERF split; idle cost 0%).

**Files:** `src/components/island/Island.tsx`, `src/styles/island.css`, unit tests, e2e spec
additions (settled-hook based full-motion snapshot).

**Dependencies:** T4a (merged), T2 (merged).

**progress.txt observations:** T4a fixed the circular measurement by putting content in normal flow
with the SVG absolute - preserve that layout; the morph animates the SVG d + content transforms,
not the layout box. The OS frame is fixed 600x560 (T3) - nothing here may call window setSize.

**Architectural alignment note:** guards G2 (no motion lib), G7 (spring not linear). D3: frame
never resizes - morph is path + content only. Invariant (f): __islandSettled is the test hook the
06 lane mandated.

**Known unknowns:** none beyond the R-PERF split (documented above; decide exact CSS keyframes).

**Acceptance:** unit test - dispose() during a non-resting spring cancels the pending frame and no
further path.setAttribute fires (spy); Playwright full-motion morph snapshot via the settled hook
run 20x zero variance; idle-cost probe - no frames scheduled 500ms after morph completes;
`pnpm tsc --noEmit`, `pnpm test`, `npx playwright test` (twice) green.
