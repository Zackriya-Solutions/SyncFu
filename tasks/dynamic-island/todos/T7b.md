# TODO T7b - Settings UI + live-push restyle

| Reference instruction (do not skip): Identify root cause first. Stay grounded. /think regression
| possibilities. Trace call paths. Verify reachability. Understand context, not just lines. Check
| references and usages. /simplify only after thorough /review. If clarity is missing in any area,
| capture the uncertainty here and resolve it during execution.

**Why:** D4's knobs need a user-facing surface. The approved mockup's playground IS the UI spec
(sections: GEOMETRY / SURFACE / CORNERS / ACCENT / PLACEMENT / BEHAVIOR + presets + Reset). A
change must restyle the live island with no restart and no resend.

**What:** Island settings panel under MainApp (13 controls + capture-status display from T9's
store field + 3 presets Apple default/Slim bar/Big status + Reset); store gains optimistic set +
invoke(set_island_settings); Island.tsx consumes the store and re-targets springs on
island:settings (NEVER snap, D3 - the morph engine animates to the new geometry).

**How:** Port the playground control semantics (ranges, captions incl the "fill only" transparency
note and the notch-stays-black appearance caption, the Tauri lock note for capture) into MainApp's
existing component idioms (read MainApp/HistoryView for patterns). Percent domain: UI shows 0-100%,
store/backend keep 0.0-1.0 (T7a decision). Position: bottom-center rejected/disabled in notch mode;
positions are float-only (disable with caption in notch mode, mirroring the mockup). Two independent
settings paths (creation read + change event) so a lost event cannot leave stale geometry.

**Files:** `src/components/app/IslandSettingsPanel.tsx` (new) + MainApp wiring,
`src/stores/islandSettingsStore.ts`, `src/components/island/Island.tsx`, styles, tests.

**Dependencies:** T7a (merged), T4b (merged - spring re-target path), T9 (merged - status display).

**progress.txt observations:** T9 store has captureStatus (on/best-effort/unsupported/unknown +
reason) - render it honestly (green ON only when ON; BEST_EFFORT shows the limited-on-this-OS
reason). T4b: re-target via IslandMorph controller, never snap (except reduced-motion).

**Architectural alignment note:** D3 - no OS-frame animation on settings change (geometry morphs
inside). Guard: senders never control geometry (payload untouched).

**Known unknowns:** exact MainApp layout slot (pick the least invasive; document).

**Acceptance:** frontend test - settings change updates island CSS vars/geometry live; Playwright -
width/radius change re-renders, content-vs-shape invariant still holds (wall audit), capture status
renders per state; presets apply; reset restores defaults; gates green.
