# Dynamic Island notification presentation

A new presentation for syncfu overlays: a pure-black capsule anchored to the macOS notch (floating
capsule on Windows/Linux) that spring-morphs between a compact live pill and an expanded card.
Strictly additive: `presentation: "card" | "island"` (default `card`), old clients unaffected.

Plan package: `tasks/dynamic-island/` (PRD, architecture, risk register, adversarial verification,
synthesis, release checklist). Approved visual spec: `tasks/dynamic-island-mockup.html` (rev 8).

## What ships

- `--presentation island` CLI flag + `presentation` payload field (tri-file plumbing, serde-default
  backward compatible; unknown values 422 with a helpful error)
- Dedicated always-on-top `island` window: notch-hugging top-center on macOS (real NSScreen
  geometry, measured 183pt), fixed 600x560 envelope never resized during morph; idle click-through
- Ported morph engine: SVG Bezier notch shape (radii 6/14 -> 19/24 with clamps), hand-rolled rAF
  springs (220/25 container, 400/30 content, eps rest + rounding guards + dispose), wall-inset
  content rule
- Full parity: actions, `--wait` (exit 0/1/2), priority timeouts, countdown, progress bar/ring,
  live-activity pill, lifecycle interruption state machine (arrive expanded -> auto-collapse;
  decisions held expanded)
- Model B overflow: Rust-owned ranked/deduped snapshot (spotlight + xN badge capped 9+, 6-row list,
  critical first, waiter-bearing notifications exempt from dedupe - exit-code integrity proven with
  3 concurrent waiters)
- 13 persistent settings (geometry, opacity, radii, accent, mode, 4 positions incl bottom-center
  expanding upward, appearance dark/light/auto, reduced motion) with live re-style, settings UI in
  the main window, playground-exact JSON persistence
- Honest capture exclusion: guaranteed macOS <= 14 + Windows 19041+; macOS 15+ best-effort with
  truthful status (ScreenCaptureKit ignores the flag there; Apple confirms no public API); Linux
  unsupported and says so
- History finally wired (backend `history:add` broadcast; was never connected for ANY presentation)
- Docs: README island section, honest capture matrix, PRD amendments, RELEASE-CHECKLIST

## Notable fixes to existing behavior (deliberate, documented)

- Critical card notifications no longer auto-dismiss at 8s (latent `?? 8000` bug violated the
  documented "critical never auto-dismisses" contract)
- `notification:update` events are now consumed by the frontend (previously emitted but ignored)

## Test plan

- 193 vitest (22 files) - state machines, stores, hooks, components
- 134+ Rust unit/integration tests - snapshot ranking/dedupe/waiter-exemption, settings clamps,
  anchor math, capture-status matrix, CLI wire tests spawning the real binary
- ~110 Playwright visual tests (webkit + chromium) against the approved mockup baselines,
  including content-vs-shape wall audits and 20x morph-determinism runs
- E2E operator journey: 20/20 against the real stack (real CLI x real HTTP/manager/waiters):
  approve->0 / dismiss->1 / timeout->2, three concurrent waiters each resolving their own action,
  Model B ranking, card regression. Independently re-run by a second reviewer.
- Manual items + surviving risks: `tasks/dynamic-island/RELEASE-CHECKLIST.md`

## Review process

Every task passed an independent second-eyes review gate (17 total) plus an over-engineering lens;
all findings fixed and re-verified before merge. Per-task branches (`feat/island-*`) preserve the
full history.
