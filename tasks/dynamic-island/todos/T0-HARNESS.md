# TODO T0-HARNESS - Playwright visual harness wiring (earliest green gate)

| Reference instruction (do not skip): Identify root cause first. Stay grounded. /think regression
| possibilities. Trace call paths. Verify reachability. Understand context, not just lines. Check
| references and usages. /simplify only after thorough /review. If clarity is missing in any area,
| capture the uncertainty here and resolve it during execution.

**Why:** D1 ranks visual fidelity top priority and jsdom is blind to it; the plan (90-synthesis.md
task 1) makes a Playwright harness the earliest green gate so every later island PR has a pixel
target. Baselines come from the user-approved mockup rev 8.

**What:** Pin exact Playwright as devDependency; `playwright.config.ts` with webkit (primary,
macOS) + chromium projects and a `webServer`; a spec that snapshots the mockup's 11 `shot-*` state
cells, the `[data-plat]` platform trio, and the theme gallery cells; committed baselines; a diff
fails the build; `npx playwright test` green on fresh checkout.

**How:** Serve `tasks/dynamic-island-mockup.html` statically (it is self-contained, no network);
`reducedMotion: 'reduce'` and/or the mockup's settled behavior for any animated shot - NEVER
`waitForTimeout` for correctness. Start `maxDiffPixelRatio` at 0.01. Alternatives considered: E2E
via tauri-driver (rejected - no macOS support; the harness targets DOM fidelity, not the native
window); Chromatic (rejected - external SaaS).

**Files:** `playwright.config.ts` (new), `package.json` (devDependency + wire the existing unwired
`test:e2e` script), `e2e/island-mockup.spec.ts` (new), committed baseline snapshots dir.

**Dependencies:** none.

**progress.txt observations:** repo has Vitest with Tauri mocks; `test:e2e` script exists but is
unwired; machine has Playwright 1.61.1 + chromium + webkit engines installed.

**Architectural alignment note:** harness is test-infra only; MUST NOT touch src/ or src-tauri/.
Later tasks (T2 dev-harness route, T4+) add their own specs on this config.

**Known unknowns:** exact maxDiffPixelRatio start (0.01, tighten later); Windows-chromium cadence
per-PR vs nightly (record a default, note for CI budget).

**Acceptance:** `npx playwright test` green on clean checkout; deliberately edited baseline fails;
config keeps webkit baselines separate from chromium (never mixed).
