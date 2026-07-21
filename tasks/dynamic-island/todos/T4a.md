# TODO T4a - Island static render + frontend routing + 27-override plumbing (C7 fix)

| Reference instruction (do not skip): Identify root cause first. Stay grounded. /think regression
| possibilities. Trace call paths. Verify reachability. Understand context, not just lines. Check
| references and usages. /simplify only after thorough /review. If clarity is missing in any area,
| capture the uncertainty here and resolve it during execution.

**Why:** T3's island window currently hosts a blank MainApp (App.tsx has no island branch). This
task closes C7: label-routed IslandOverlay host rendering compact pill + expanded card (static, no
morph yet) with the shared 27-override map from T2. First user-visible island.

**What (files corrected per C7):** `src/App.tsx` (add `if (label === "island") return
<IslandOverlay/>` branch), `src/components/island/IslandOverlay.tsx` (new; per-window event
subscription via emit_to("island") events, filters presentation === "island" as defense in depth),
`src/components/island/Island.tsx` (new; host shell, static compact/expanded states),
`src/components/island/IslandCompact.tsx` (new; leading glyph + trailing live-activity slot),
`src/components/island/IslandExpanded.tsx` (new; icon/sender/title/body via styleVars.ts +
NotificationIcon + RelativeTime), `src/components/overlay/NotificationOverlay.tsx` (ADD exclusion
filter presentation !== "island"), `src/styles/island.css` (new).

**How:** Shape from T2's notchPath/capsulePath rendered as inline SVG behind the content;
content insets via T2's wallPadding rule (R-WALL). Visual reference = approved mockup rev 8
(compact anatomy: glyph left / label / trailing slot; expanded: icon, mono sender, title, body).
The e2e harness + mockup baselines are the pixel targets. Static states only - T4b adds the morph;
render expanded state on arrival (lifecycle default lands fully in T5b).

**Files:** listed above + `e2e/` spec additions for the island route states + Vitest render tests.

**Dependencies:** T2 (merged), T3 (merged).

**progress.txt observations:** T3 review observation to CONFIRM here: the 600x560 envelope has no
top slack - verify a max-height expanded card/list at screen-top does not clip beneath the macOS
notch overhang (the compact pill hugs the notch; expanded content starts below the shape's top
walls by design - prove it with a tall fixture screenshot and record the result).
T3 established: island events arrive via emit_to("island") only; overlay events via broadcast.

**Architectural alignment note:** guard G1 (renders in the island window, never overlay). Invariant
(b): the card path stays pixel-identical - prove with the existing overlay baselines. Invariant (c):
all 27 --s-* overrides resolve identically in card and island (shared styleVars). Invariant (d):
compact pill pure black in macOS notch mode regardless of appearance. Invariant (e): island
notifications still reach historyStore.prependEntry (single ingest, two renderers; R-HISTORY) -
trace where history entries are written for overlay notifications and mirror it.

**Known unknowns:** none material after C7; record the notch-overhang check result.

**Acceptance:** Vitest render tests (compact/expanded structure, exclusion filter, history ingest);
Playwright snapshots of expanded basic / rich-body / critical vs mockup references + a styled
27-override fixture; overlay baseline unchanged; `pnpm tsc --noEmit`, `pnpm test`,
`npx playwright test` green.
