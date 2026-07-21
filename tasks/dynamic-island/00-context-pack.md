# Context Pack: dynamic-island (planning run)

Every agent reads this FIRST. This run PLANS the Dynamic Island notification feature for syncfu.
Nobody implements anything in this run.

## Objective

Turn the approved Dynamic Island design into a ready-to-build plan package: PRD, architecture,
alternatives, risk register, task decomposition, and test strategy, reconciled into one ranked
plan that `orchestrator-implementor` can execute PR by PR.

Why it matters: syncfu is "the notification layer your AI agents are missing." The island is the
most glanceable ambient-status form factor for agent work (timers, progress, approvals), and its
screen-share invisibility is a category differentiator (Notchie markets exactly this).

## The idea (already designed and APPROVED)

A new notification presentation: a pure-black capsule anchored top-center (hugging the macOS
physical notch; floating capsule on Windows/Linux) that spring-morphs between a compact pill and an
expanded card. Additive - the existing top-right glass card stays. Full spec with locked decisions
D1-D6: `tasks/dynamic-island-notification.md`. Visual spec (user-approved, rev 8):
`tasks/dynamic-island-mockup.html`. Evidence base with per-repo code citations:
`tasks/dynamic-island-ui-research.md`.

### Locked decisions (do NOT re-litigate; refine only)
- D1: test priority = visual fidelity + positioning + customization; capture-exclusion gets its own
  dedicated verification track; functional parity mandatory.
- D2: design-mock-first gate - CLEARED (user approved rev 8, 2026-07-20).
- D3: shape + motion numbers locked: SVG quadratic-Bezier concave shoulders (control point at outer
  top corner), radii 6/14 compact -> 19/24 expanded, clamps t<=min(W/4,H/4) b<=min(W/4,H/2);
  springs container 220/25, content 400/30, pop 260/18, reduced-motion 1000/100; hover 1.028
  top-anchored, 150ms delay; never animate the OS window frame - hold panel at expanded size,
  animate shape + content inside.
- D4: customization = PERSISTENT APP SETTINGS (not per-notification): compactWidth 150-600 (218),
  expandedWidth 320-560 (380), height 24-60 (34), surfaceOpacity 0-100% (94, fill only), topRadius/
  bottomRadius + cornerScaling, accent presets + custom, mode notch/float, position left/center/
  right/bottom-center (float only; bottom-center expands upward), appearance dark/light/auto (notch
  compact pill stays black in light mode), reducedMotion, hideFromScreenCapture. Payload keeps only
  the existing 27 --s-* style overrides. The mockup playground's ISLAND.SETTINGS.JSON is the
  persistence schema.
- D5: overflow = Model B ONLY: compact spotlight (highest priority) + xN badge (width 26+8*(digits-1),
  caps 9+); expand -> priority-ranked deduped list capped 6 rows/560px then scrolls with bottom fade;
  rows stagger 40-60ms; critical first; auto-dismiss paused while list open. Models A (badge+cycle)
  and C (stack-under) REJECTED - guard against resurrection.
- D6: design approved; mockup anatomy tables + settings JSON are the authoritative numbers.

## Architecture facts (verified this session against the repo)

- Repo: `~/work/2025/syncfu` = the syncfu notification app. Tauri v2, Rust backend (`src-tauri/`),
  React 18 + TS frontend (`src/`), Vite. Workspace members `src-tauri`, `cli`. Branch base: `main`
  (no develop/devtest branch exists in this repo).
- Overlay today: `src-tauri/src/overlay/panel.rs` creates ONE always-on-top window pinned top-right
  (NSPanel via tauri-nspanel on macOS; always-on-top WebviewWindow on Win/Linux).
  `calculate_panel_position()` is unit-tested. PANEL_WIDTH 400, margins 12.
- Frontend overlay: `src/components/overlay/NotificationOverlay.tsx` renders a stack of
  `NotificationCard.tsx`; frontend measures content and resizes the window
  (`getCurrentWindow().setSize`). Hand-written CSS animation; NO animation library installed.
- Notification model: enums (Priority, ActionStyle, ProgressStyle) mirrored across THREE files -
  `cli/src/types.rs`, `src-tauri/src/notification/types.rs`, `src/types/notification.ts`. A new
  field/kind follows that exact tri-file pattern.
- Style system: 27 per-notification `style` overrides -> `--s-*` CSS custom properties
  (`src/styles/overlay.css`). Accents: low #2ed573 normal #4a9eff high #ffa502 critical #ff3b30.
  Timeouts: low 6s / normal 8s / high 12s / critical never.
- Transport: HTTP :9868 + WS :9869 -> axum server -> NotificationManager (shared Arc) -> Tauri
  events -> overlay window. History in SQLite. `--wait` blocks CLI until action/dismiss/timeout
  (exit codes 0/1/2).
- Tests: frontend Vitest+Testing Library (~7 specs); Rust ~109 unit tests; `cli/tests/integration.rs`.
  `test:e2e: "playwright test"` declared but NO Playwright config/specs/tauri-driver exist yet.
  Playwright 1.61.1 available via npx; chromium + webkit engines installed on this machine.
- Screen-capture exclusion: Tauri v2 `window.set_content_protected(true)` maps to macOS
  NSWindowSharingNone / Windows WDA_EXCLUDEFROMCAPTURE. Linux: no reliable equivalent (documented
  limitation). Counter-example warning: open-island/open-vibe-island set .readOnly and ARE
  capturable - do not copy their panel setup.
- Notch geometry: boring.notch derives notchWidth = screen.width - auxiliaryTopLeftArea -
  auxiliaryTopRightArea + 4 (NSScreen); non-notch fallback bar. Tauri access path to those AppKit
  APIs is a KNOWN UNKNOWN needing an early gate.
- The approved mockup contains a reference implementation of the shape generator (notchPath),
  spring integrator, wall-inset content rule (--di-wall, padding = max(base, wall+margin)), and
  Model B list logic - in vanilla JS. Port, do not reinvent.

## The MAP (lanes and files)

| id | lane | file | wave |
|----|------|------|------|
| 01 | PRD (runs /prd --sub-skill) | 01-prd.md (+ tasks/prd-dynamic-island.md artifact) | R |
| 02 | Architecture | 02-architecture.md | R |
| 03 | Alternatives | 03-alternatives.md | R |
| 04 | Risk / pre-mortem | 04-risk.md | R |
| 05 | Task decomposition | 05-tasks.md | R |
| 06 | Test strategy | 06-test-strategy.md | R |
| 80 | Coherence + feasibility | 80-feasibility.md | A |
| 85 | Adversarial verify | 85-verify.md | V |
| 90 | Synthesis | 90-synthesis.md | S |

## Constraints (hard)

- PLAN ONLY. No implementation, no code edits outside tasks/dynamic-island/.
- Base branch: main. Nothing committed automatically; the user decides.
- No em dashes anywhere in outputs. Never read .env/.pem/.p8/.key files.
- No AI-attribution anywhere. Conventional commits format when tasks reference commits.
- The 6 Meetily KPIs do NOT apply (this is syncfu, not Meetily). syncfu's regression surface is:
  existing top-right overlay behavior, HTTP/WS API compatibility, CLI flag compatibility, history.
- Completeness gates (Wave A enforces): interruption states for every state machine; glossary +
  FR consistency (PRD lane); deployment threat surface per target OS (risk lane); every "MUST" has
  an owner-task; platform unknowns get an early isolated gate task; rejected alternatives get named
  guards (alternatives lane; note A/C overflow models and any rejected implementation options).
- Each planner states its chosen /think framework(s) in one line at the top of its file.
- Findings use the coordination-model schema (design decision / assumption substitutes for
  code evidence where code does not exist yet).

---

# IMPLEMENTATION PHASE ADDENDUM (orchestrator-implementor, 2026-07-21)

This run folder now drives implementation. Planning artifacts above remain ground truth.

- Integration branch: `feat/dynamic-island` off `main`. Each task = one worktree + one PR into the
  integration branch; final PR `feat/dynamic-island` -> `main` (user reviews, never auto-merged).
- Authoritative task specs: `90-synthesis.md` section 3 (17 tasks T0/G1/G2/T1..T11). FINAL-plan.md
  carries the execution index and the 5 RESOLVED human decisions (OQ-1..5) - binding.
- Worker contract additions: /think regression first; ponytail ladder while building (reuse existing
  code, stdlib before deps, minimum surface); /simplify only after /review is clean; /review --deep
  plus /ponytail-review at every gate; cargo check + pnpm tsc --noEmit green before every commit;
  conventional commits with [skip ci]; NO push (orchestrator opens PRs); no AI attribution anywhere;
  no em dashes; never read .env/.pem/.p8/.key.
- Machine facts: macOS 26.5 (post-15 ScreenCaptureKit world - G2's live probe runs the real case
  here); Playwright 1.61.1 + chromium + webkit installed; pnpm; Rust workspace src-tauri + cli.
- PRD amendments (90-synthesis S5, six items) are folded into the owning tasks (T1 carries the
  presentation-field wording; T9 carries capture-scoping wording; T6 carries dedupe/waiter wording;
  T5b carries lifecycle; T7a carries radius ranges; T10 carries history-store correction in docs).
