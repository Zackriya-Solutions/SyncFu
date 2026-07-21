# TODO T7a - Settings backend: model + persistence + IPC + TS types

| Reference instruction (do not skip): Identify root cause first. Stay grounded. /think regression
| possibilities. Trace call paths. Verify reachability. Understand context, not just lines. Check
| references and usages. /simplify only after thorough /review. If clarity is missing in any area,
| capture the uncertainty here and resolve it during execution.

**Why:** D4 locks island customization as persistent app settings (never payload). This ships the
13-key model + persistence + IPC so T7b (UI), T8 (float/positions/appearance), and T9 (capture
toggle) have a real backend. OQ-4 resolved: radius ranges are the mockup's (top 0-24 default 6,
bottom 0-40 default 14).

**What:** `src-tauri/src/notification/settings.rs` (new): IslandSettings struct (camelCase serde),
Default = mockup DEFAULTS (218 / 380 / 34 / 0.94 / topR 6 / botR 14 / scaling true / #4a9eff /
notch / center / dark / reducedMotion false / hideFromScreenCapture true), settings_path,
load_settings (clamp-and-default, corrupt/truncated file -> defaults, never panic), save_settings
(ATOMIC temp+rename). lib.rs: register get_island_settings / set_island_settings /
set_island_interactive; on set -> save, reflow_island if geometry changed, re-apply capture
protection if that toggle changed, emit_to("island", "island:settings"). Mirror types:
`src/types/islandSettings.ts` + `src/stores/islandSettingsStore.ts` (new).

**How:** Plain serde JSON in the app config dir (guard G6: no SQLite, no new plugin - the repo has
no tauri-plugin-store and does not gain one). Clamps: compactWidth 150-600, expandedWidth 320-560,
height 24-60, surfaceOpacity 0-100 (fill alpha only), topRadius 0-24, bottomRadius 0-40. The
notification payload schema is NOT touched (G12 regression guard). T3's reflow_island is the
documented reflow seam - this task gives it its first caller.

**Files:** `src-tauri/src/notification/settings.rs` (new), `src-tauri/src/notification/mod.rs`,
`src-tauri/src/lib.rs`, `src/types/islandSettings.ts` (new), `src/stores/islandSettingsStore.ts`
(new) + tests.

**Dependencies:** T4a (merged - the island the settings reflect against; C5 lock).

**progress.txt observations:** T3 exposed reflow_island uncalled-by-design; G2 verdict defines the
capture re-apply semantics (in-place, never rebuild); the mockup playground's ISLAND.SETTINGS.JSON
block is the exact schema reference.

**Architectural alignment note:** guards G6, G12. Atomic write per R-SETTINGS-WRITE (partial write
must leave the prior valid file intact). Store follows the existing zustand store patterns
(notificationStore/historyStore).

**Known unknowns:** none material (ranges resolved by OQ-4).

**Acceptance:** Rust unit tests - serde defaults, every clamp, corrupt-file fallback, persistence
round-trip (write/reload/equal), atomic-write (partial write leaves prior file intact);
`cargo check/test --workspace`, `pnpm tsc --noEmit`, `pnpm test` green; existing suites untouched.
