# Dynamic Island - Release Checklist (T11 sign-off)

This is the final pre-release gate for the Dynamic Island presentation. It records
what the automated T11 journey proves on this machine, and every item that must be
verified BY A HUMAN (or on another OS / CI) before shipping. It doubles as the
integration PR's test-plan section.

Status legend: `[x]` verified on the T11 machine (macOS 26.5 Tahoe, 2026-07-21) ·
`[ ]` outstanding manual / per-OS / CI item.

---

## 1. Automated journey (this machine) - GREEN

Run:

```bash
bash e2e/journey/run-journey.sh          # 20/20 assertions, exit 0
```

It builds the REAL `syncfu-cli`, boots the REAL server stack
(`src-tauri/examples/journey_server.rs` = `build_router` + real `NotificationManager`
+ `WaiterRegistry`) on an ephemeral port, and drives the CLI end to end.

- [x] `send --presentation island --wait` + action POST `approve` -> exit **0**, resolved `action_id=approve`
- [x] deny action POST -> exit **0**, resolved `action_id=deny` (action-specific routing)
- [x] dismiss -> exit **1**
- [x] timeout (`--wait-timeout 2`, no action) -> exit **2**
- [x] 3+ concurrent island `--wait` -> Rust-owned Model B snapshot: `count=3`, 3 ranked rows, critical spotlight, every row `hasWaiter=true`
- [x] each row's action resolves the RIGHT waiter with its OWN `action_id` (A4 end-to-end)
- [x] top-right CARD `--wait` -> action -> exit **0** (regression); card is ABSENT from the island snapshot (presentation scoping)
- [x] existing suites untouched: `cargo check --workspace` clean; `pnpm test` 193/193

### Composition argument (why the journey has no webview here)

The shipping app hardcodes HTTP port **9868** (`src-tauri/src/lib.rs`,
`start_server(server_state, 9868)`, no env override) and launches real desktop
windows. On the T11 machine :9868 is held by the user's installed production
instance (`/Applications/syncfu.app`), which must not be killed, and the port
cannot be rebound without a production `src/` change (forbidden for T11). So the
full Tauri app could not be spawned. Per the degrade-honestly rule the journey
drives **CLI <-> HTTP <-> manager <-> waiters** against the real stack; the
UI / morph / button-click layer is proven separately by the vitest + Playwright
harness suites (`e2e/island-*.spec.ts`, `src/**/*.test.tsx`). The HTTP action POST
the journey uses stands in for the proven UI click. Exit codes, waiter routing,
and Model B ranking all execute production logic.

---

## 2. Manual / degraded items (not automatable in the T11 composition)

Each carries the EXACT command or file to exercise it by hand.

### D. Live settings mid-journey - DEGRADED (IPC-only)
`set_island_settings` (Tauri command, `src-tauri/src/lib.rs`) writes
`island.settings.json` atomically and emits `island:settings` to the island
webview. There is no HTTP surface and no webview in the journey composition.
- Covered automatically by: `cargo test -p syncfu settings` (persist / clamp-on-read /
  atomic-write) and `pnpm test:e2e -- island-settings` (live restyle in the harness).
- [ ] MANUAL (real app): with the app running, open Settings, change `compactWidth`
  / `surfaceOpacity` / accent while an island is on screen; confirm the live island
  restyles WITHOUT a rebuild/flicker. Confirm `island.settings.json` under the app
  config dir (`~/Library/Application Support/dev.syncfu.app/`) reflects the change.

### Full real-app island render + morph + click (webview)
The journey does not open the island window here (port/window blocker above).
- [ ] MANUAL (real app, free :9868): `syncfu send --presentation island --wait -a approve:Approve -a deny:Deny:danger "review this"`;
  confirm it ARRIVES top-center, morphs (arrive-expanded -> collapse to compact pill, per OQ-2),
  and clicking Approve in the WEBVIEW unblocks the CLI with exit 0. This is the one
  seam the automated journey substitutes with an HTTP POST.

---

## 3. Screen-capture exclusion - per-OS manual matrix (OQ-1 honest scoping)

The `hideFromScreenCapture` flag is applied UNCONDITIONALLY as defense in depth
(`overlay/island.rs`); `get_island_capture_status` reports an HONEST tri-state
derived ONLY from OS + version (never a `sharingType` read-back - G2). The
derivation is unit-tested (`derive_capture_status`).

Recorded on this machine (macOS major 26, Tahoe):
- [x] Surfaced status = **BEST_EFFORT**, reason: "Best effort only: macOS 15 and
  later can still capture this window." Flag applied. This matches OQ-1 (no false
  safety on macOS 15+; NO auto-hide fallback subsystem).

Guaranteed-tier capture checks (MUST be done by a human on real hardware - a live
ScreenCaptureKit / capture probe, never a property read-back):
- [ ] macOS <= 14 (Sonoma or earlier): island is ABSENT from a QuickTime / screen
  recording AND a Zoom/Meet share. Status must read ON.
- [ ] macOS 15+ (Sequoia/Tahoe): island MAY appear in capture (expected). Status
  reads BEST_EFFORT and the Settings UI shows the honest "limited on this OS" line.
  Marketing claims must match this limitation.
- [ ] Windows 10 build 19041+ : island absent from capture (WDA_EXCLUDEFROMCAPTURE);
  status reads ON. Older builds: status UNSUPPORTED.
- [ ] Linux: toggle disabled, label "Not supported on Linux" (OQ-5); no process
  detection. Island IS capturable (documented limitation).

---

## 4. Cross-OS visual baselines - CI canonicalization

Island appearance / position baselines are MACHINE-SENSITIVE (known env-drift on
island-appearance / island-position observed in worktrees; T5b/T6 reviews). The
T11 journey therefore asserts STRUCTURE and STATE, not new pixel baselines.

- Snapshot paths are already segregated by `{projectName}-{platform}`
  (`playwright.config.ts` `snapshotPathTemplate`): `webkit-darwin`, `chromium-darwin`,
  `chromium-win32` never share a file.
- [ ] Regenerate/canonicalize baselines ON A CI RUNNER for each target, never from a
  developer worktree: `pnpm test:e2e -- --update-snapshots` on the macOS runner
  (webkit + chromium) and the Windows runner (chromium-win32).
- [ ] macOS runner exercises webkit + chromium per-PR; `chromium-win32` runs nightly
  (CI-budget default), not per-PR.
- [ ] Do NOT commit worktree-generated island-appearance / island-position pixels;
  treat any local `--update-snapshots` diff on those as env-drift, not a change.

---

## 5. Binary-collision note (build/CI hazard)

Both the app crate (`syncfu`) AND `syncfu-cli` build a binary named **`syncfu`**.
In a shared `CARGO_TARGET_DIR` the app can overwrite `target/debug/syncfu`.

- The journey resolves the CLI path from `cargo build -p syncfu-cli
  --message-format=json` (matches `manifest_path` containing `/cli/`), never by
  guessing `target/debug/syncfu`.
- [ ] Any CI step invoking the CLI must use `cargo run -p syncfu-cli --` OR the
  resolved artifact path, and must NOT assume `target/debug/syncfu` is the CLI when
  the app has also been built.

---

## 6. Surviving risks (from FINAL-plan.md) with owning gate

- [ ] **R1 - macOS 15+ capture limitation (product-level, not code-fixable):** SCK
  ignores `setContentProtected`; no public API. Owned by G2 live probe + T9 honest
  status surface. Ship only with the OQ-1 status line + matching marketing. (See section 3.)
- [ ] **R2 - content-vs-shape spill:** owned by the T0 harness `--di-wall` leaf audit
  (box-vs-box is only the floor). Verify on baseline regen (section 4).
- [ ] **R3 - rAF loop not resting / battery:** owned by T2 invariants (eps, rounding,
  dispose) + idle-CPU probe. [ ] Confirm idle island holds ~0% CPU on the real app.
- [x] **R4 - `--wait` exit-code corruption under dedupe:** owned by T6 two-waiters-same-key
  test AND re-proven end-to-end here (Scenario B: 3 concurrent waiters each resolve
  their OWN action; A4). Green.
- [x] **R5 - frontend/manager state divergence:** owned by T6 snapshot protocol (no
  delta-derived island state). The journey reads the authoritative Rust snapshot
  (`island_snapshot`) directly; count/rows/spotlight/hasWaiter all match. Green.

---

## 7. Final sign-off gate

- [x] `bash e2e/journey/run-journey.sh` -> 20/20, exit 0
- [x] `cargo check --workspace` clean
- [x] `pnpm test` 193/193
- [ ] `pnpm test:e2e` (Playwright harness) green on the macOS CI runner
- [ ] Sections 2, 3, 4, 6 manual/per-OS items completed and checked
- [ ] No spawned process left running (`ps aux | grep -Ei 'journey_server|debug/syncfu'` empty; the user's `/Applications/syncfu.app` instance is separate and stays up)

### R6 - R-SSE-FALSE-DISMISS (inherited, pre-existing)
A late `GET /wait` subscribe against a notification already resolved returns `Dismissed` (exit 1)
even when it was resolved by an ACTION (`handle_wait` `!exists` path). Pre-existing, outside this
feature's scope; flagged in T5a and by the T11 review. Owning follow-up: distinguish
resolved-by-action from dismissed at the SSE boundary, or document exit-1-on-late-subscribe as the
contract. Journey robustness note: the T11 assertions gate on `hasWaiter` before acting and on the
`action_id` echo, so they cannot pass vacuously through this path.

### Testability recommendations (from T11 findings F1/F2)
- F1: no HTTP surface exposes the island snapshot (`get_island_snapshot` is IPC-only); the journey
  uses a harness probe route reusing the production `manager.island_snapshot()`. Consider a
  debug-gated HTTP probe for CI.
- F2: the app hardcodes port 9868 (no env override), so the full app cannot be spawned while a
  production instance runs. A `SYNCFU_PORT` env override (future, non-T11 change) would make the
  complete app spawnable in CI and worktrees.
