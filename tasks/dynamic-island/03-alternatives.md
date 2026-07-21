# Lane 03 - Alternatives (Dynamic Island notification)

**/think frameworks:** weighted decision-matrix (trade-off per axis) + inversion (author a named guard for every
rejected option) + reversibility screen (Type-1 hard-to-reverse vs Type-2 cheap-to-reverse to calibrate how much
the guard must bite).

**Scope:** one plan lane. PLAN ONLY, no code. Each axis lists 2+ viable approaches with trade-offs, ONE
recommendation, and a NAMED GUARD (G-NN) for every rejected option. A guard is a standing rule: implementation may
not silently resurface the rejected option; doing so requires re-adjudication that cites the guard. Guards are
consolidated in the **Guard Register** at the end. Evidence is either a repo `file:line` or `design decision:
<source>` where code does not exist yet.

Grounding verified this session against the repo:
- `src-tauri/src/overlay/panel.rs` - one window id `"overlay"`, NSPanel on macOS (`create_macos_panel`,
  L108-144) / `WebviewWindow` elsewhere (`create_standard_panel`, L152-178), anchored top-right by
  `calculate_panel_position` (L60-69, unit-tested L334-453). `PANEL_WIDTH = 400`.
- `src-tauri/src/notification/manager.rs` - `NotificationManager` (Rust) already owns `active` (IndexMap),
  `groups` (HashMap), `queued` (Vec), `MAX_VISIBLE = 5`, dedup-by-id (L41 `shift_remove`), queue promotion
  (L60-66), group tracking (L29-36).
- `src-tauri/src/notification/types.rs` - `NotificationPayload` has `theme: Option<String>` (L190),
  `style: Option<StyleOverrides>` (L196), `group: Option<String>` (L188). No `kind`/`presentation`/`variant`.
- `src/components/overlay/NotificationOverlay.tsx` - consumes `useNotifications()` -> `{ notifications, dismiss }`
  (L41), renders a stack, resizes window to content (L58, L70).
- `src-tauri/Cargo.toml` - plugins present: single-instance, autostart, dialog, log. **No `tauri-plugin-store`,
  no settings/config module anywhere** (grep of `src-tauri/src` for store/settings/config returned nothing).

---

## Axis 1 - Window model: shared overlay window vs dedicated island window vs replace-overlay

**Requirement it serves:** island is *additive*; the existing top-right glass card must keep working and both may
be on screen at once (brief S1, S9 non-goals). Island anchors top-center / notch; card anchors top-right.

**Option 1A - Dedicated island window (RECOMMENDED).** A second Tauri surface, window id `"island"`, created by a
sibling of `create_panel` in `panel.rs`, anchored top-center, its own NSPanel config, `set_content_protected(true)`
applied only to it.
- Pros: card and island coexist trivially (two windows, two anchors). Capture-exclusion scoped to the island only,
  so the top-right card is unaffected (it does not need to be hidden). Zero regression to
  `calculate_panel_position` and the existing overlay lifecycle. Reuses the proven NSPanel/WebviewWindow builder
  patterns already in `panel.rs`. Clean routing: notifications with `presentation=island` go to the island window,
  the rest to `"overlay"`.
- Cons: second webview (memory/startup cost of a second WebView2/WKWebView); a second position calculator
  (`calculate_island_position`, top-center) and a second show/hide lifecycle; the manager or an event router must
  fan notifications to the correct window.

**Option 1B - Shared full-width overlay window (viable, not recommended).** Repurpose the single `"overlay"` window
into a full-screen-width transparent, click-through surface that hosts BOTH the top-right card stack and the
top-center island via CSS positioning inside one webview.
- Pros: one webview, one lifecycle, one event stream; the frontend already renders a stack and could add an island
  region.
- Cons: the window is currently 400px wide and dynamically resized to content (`resizeToContent`,
  `NotificationOverlay.tsx` L58); making it full-width breaks that model and the click-through hit-test surface
  (a full-width always-on-top window risks swallowing clicks unless per-region ignore-cursor-events is managed).
  `set_content_protected(true)` on the shared window would hide the top-right card from capture too, which is not
  wanted (only the island must be invisible). `calculate_panel_position` and its 6 unit tests would have to be
  rewritten. NSPanel level/collection-behavior tuned for a small corner panel may not suit a full-width surface.

**Recommendation: 1A dedicated island window.** It is the only option that keeps capture-exclusion scoped, leaves
the tested top-right path untouched, and satisfies coexistence without a click-through rewrite. The second-webview
cost is bounded and one-time.

**Rejected: replace-overlay** (make the single window reposition top-center and morph into the island, dropping the
top-right card). Rejected because it cannot show card and island simultaneously (violates the additive
requirement), regresses existing behavior, and forces content-protection onto the card. See guard **G1**.

---

## Axis 2 - Animation engine: hand-rolled rAF spring vs motion/framer-motion vs CSS-only

**Locked context (D3):** the spring *numbers* are fixed (container 220/25, content 400/30, pop 260/18,
reduced-motion 1000/100). The mockup already ships a working rAF damped-spring integrator implementing these
(`tasks/dynamic-island-mockup.html`, per context pack L79). "Never animate the outer window frame; hold the panel
at expanded size and animate shape + content inside" is a locked rule.

**Option 2A - Port the mockup's hand-rolled rAF spring (RECOMMENDED).** Lift the vanilla-JS damped-spring
integrator into a small TS module driving the SVG path `d`, radii, and inner opacity/scale per frame.
- Pros: zero dependency (~1.5kb). The morph animates an SVG path `d` string that is *recomputed per frame* from
  `{W,H,t,b}` (Axis 3); no mainstream animation library interpolates arbitrary SVG `d`, so a library would not
  remove this hand-driven loop anyway. Full control lets us honor the D3 rule (animate shape + content, never the
  frame). The mockup is the approved reference, so port-not-reinvent minimizes design drift. Reduced-motion is a
  one-line spring-constant swap.
- Cons: hand-maintained rAF lifecycle (start/stop, cleanup on unmount, frame-budget cap - research notes
  `MAX_CONCURRENT_ANIMATIONS = 8`); we own the integrator's correctness and its tests.

**Option 2B - Adopt motion / framer-motion (viable, not recommended).** Add the `motion` package; use
`AnimatePresence` for staged content reveal and springs for scale/opacity.
- Pros: mature, declarative, battle-tested staging; PILLAR (same stack) uses it.
- Cons: (a) +30-50kb dependency into a project that currently ships **no** animation library
  (`NotificationOverlay.tsx` uses hand-written CSS). (b) Its headline feature `layout` animates box
  geometry via transforms - it does **not** interpolate the SVG `d` path we depend on, so the shape morph stays
  hand-rolled regardless; Motion would only help the inner content crossfade. (c) `layout` actively tempts
  animating the container box, which is the exact D3 anti-pattern (jank documented in all three native apps).
  (d) Motion layout animations do not run in jsdom, so it buys nothing for unit tests; visual verification is
  Playwright either way (brief Q8).

**Option 2C - CSS-only (keyframes/transitions).** Already adjudicated OUT by D3 (springs required; linear tweens
rejected). Recorded here for completeness. CSS transitions cannot produce the required spring feel, cannot smoothly
interpolate an SVG `d` across dynamic widths, and `corner-shape` concave corners are Chrome-139+ only. See guard
**G7** (the pre-adjudicated D3 guard).

**Recommendation: 2A hand-rolled rAF spring, ported from the approved mockup.** It is the lowest-dependency path,
is the only one that actually solves the SVG-`d` morph, and best enforces the D3 "never animate the frame" rule.

**Rejected: motion/framer-motion as the morph driver.** See guard **G2**. Narrow re-adjudication window: Motion may
be reconsidered *only for the inner content crossfade* (not the container/shape) and *only if* profiling shows the
hand-rolled crossfade janks; reintroducing it must cite G2 and prove the SVG shape stays hand-driven and the
container box is never Motion-`layout`-animated.

---

## Axis 3 - Shape rendering: inline SVG path vs CSS mask vs canvas

**Locked context (D3):** SVG quadratic-Bezier concave shoulders, control point at the outer top corner, radii
6/14 -> 19/24 with clamps. The 8-segment path maps 1:1 from the native `NotchShape` (ui-research L28-40, L260-278).

**Option 3A - Inline SVG `<path>` with animated `d` (RECOMMENDED).** Build the `d` string in JS from `{W,H,t,b}`,
set on `<path fill="#000">`; content lives in a DOM layer above.
- Pros: resolution-independent, crispest (research verdict), ports 1:1 from native, `d` is trivially animatable per
  frame (pairs with Axis 2A), scales cleanly when the user changes width/height (recompute `d`, radii are fixed
  constants clamped). SVG shadow / 1px seam overlay are straightforward.
- Cons: two stacked layers (SVG shape + DOM content) must stay aligned; wall-inset content rule (`--di-wall`,
  padding = max(base, wall+margin)) must be honored so text never overlaps the concave shoulders.

**Option 3B - CSS mask (radial-gradient / `corner-shape`) (viable fallback, not recommended).** Carve concave top
corners with `mask: radial-gradient(...)` intersect, convex bottom via `border-radius`.
- Pros: no SVG, pure CSS; fewer DOM nodes.
- Cons: research explicitly warns the mask is "hard to animate on width" (ui-research L56) - fatal for a morph that
  changes width every frame. True concave `corner-shape: scoop` is Chrome-139+ only, unusable in a shipped WebView.
  Radii/clamps become mask-position math instead of a clean `d` recompute.

**Option 3C - Canvas 2D (rejected).** Redraw the path into a `<canvas>` each frame.
- Cons: imperative redraw loop, loses DOM/CSS crispness and DevTools inspectability, does not host the text content
  (content stays DOM, so you end up compositing canvas-shape under DOM-content anyway = strictly more complexity
  than SVG for zero benefit). Retina scaling must be hand-managed.

**Recommendation: 3A inline SVG path.** Matches D3, the mockup, and native; animates on width where the CSS mask
cannot.

**Rejected: CSS mask** as the primary renderer (see guard **G3**; it survives only as a documented degraded
fallback if a target WebView ever fails to render the SVG path, which is not expected). **Rejected: canvas** (see
guard **G4**).

---

## Axis 4 - Notch geometry: objc2/AppKit query vs hardcoded-width fallback vs config-only

**Known unknown (context pack L74-76):** Tauri's access path to `NSScreen.auxiliaryTopLeftArea` /
`auxiliaryTopRightArea` / `safeAreaInsets` is unverified. boring.notch derives
`notchWidth = screen.width - auxLeft - auxRight + 4`, fallback 185, notch present when `safeAreaInsets.top > 0`
(ui-research L313-314). D4 gives a user `compactWidth` setting (150-600, default 218).

The three options are not mutually exclusive; the real decision is the *primary* source and the *fallback order*.

**Option 4A - Layered: objc2/AppKit query -> hardcoded fallback -> config override (RECOMMENDED, behind an early
gate).** Primary: query `NSScreen` for auxiliary areas / safe-area insets via the `objc2`/`objc2-app-kit` crates
inside the macOS-only path of `panel.rs`, compute true notch width and presence. If the query fails or returns nil,
fall back to a hardcoded closed width (185, or derived from `safeAreaInsets.top`). A user `compactWidth` setting
(D4) always overrides.
- Pros: only path that makes the compact pill actually hug the physical notch (the category-defining look). Matches
  native exactly. Fallback keeps non-notch and older macOS working. Config override preserves user control.
- Cons: raw AppKit FFI from Tauri is the project's biggest platform unknown; `objc2` calls are `unsafe` and version
  fragile. MUST sit behind an early isolated verification gate (owned by the task/risk lanes) - do not let this
  block the rest of the build, and do not defer it to "CI will catch it."

**Option 4B - Hardcoded width + config-only (no FFI) (viable fallback stance).** Never query AppKit; ship a fixed
closed width (185) plus the D4 `compactWidth` setting; treat every display as if the pill floats.
- Pros: zero unsafe FFI, no platform gate, trivially cross-platform, deterministic tests.
- Cons: the pill will not perfectly hug the notch (14"/16" MacBook notches differ; external displays have none), so
  the flagship visual is approximate. Pushes geometry onto the user.

**Option 4C - Config-only with no detection at all (rejected as a primary).** Rely solely on the D4 setting; no
hardcoded default derivation, no query.
- Cons: a fresh install with no configured width has no sensible notch fit; burdens every user before first use.
  This is a strict subset of 4B without even a good default.

**Recommendation: 4A layered, gated.** Query first for fidelity, hardcode-fallback for safety, config override for
control. Put the AppKit query behind an early isolated gate task; **4B is the pre-approved fallback if the gate
proves the query infeasible** (that specific fallback does not require re-adjudication - it is the planned Plan B).

**Rejected: config-only-no-detection** as a primary (see guard **G5**). Also guarded: shipping hardcoded-only
*without ever attempting the query* when the gate has not yet run (guard **G5** covers both - the query attempt is
mandatory before settling for a fallback).

---

## Axis 5 - Settings storage: tauri-plugin-store vs JSON config file vs SQLite (history db)

**Locked context (D4):** settings are PERSISTENT APP SETTINGS (not per-notification). The schema is the mockup
playground's `ISLAND.SETTINGS.JSON` - a nested document (widths, radii, accent presets, mode, position,
appearance, toggles). The frontend playground reads and writes them live. Repo has **no** settings store today;
history already uses SQLite; PILLAR (same stack) uses Rust `load_settings`/`save_settings` commands over a file
(ui-research L368).

**Option 5A - tauri-plugin-store (RECOMMENDED).** Add the official Tauri v2 KV/JSON store; persist the settings
document; frontend reads/writes directly, backend reads for window creation.
- Pros: official, battle-tested, JSON-native (fits the nested `ISLAND.SETTINGS.JSON` shape 1:1), gives the
  playground live frontend read/write with minimal glue, handles path/serialization/atomic-write for us. Least
  custom code.
- Cons: one new dependency into a project that has so far avoided a store plugin; a small amount of schema
  versioning/migration still ours to own.

**Option 5B - Hand-rolled JSON config file + Tauri commands (viable alternative).** Serde-serialize the settings
struct to a file under the app config dir (`dirs`/`tauri` path API); expose `get_settings`/`save_settings`
commands; frontend calls them. This is PILLAR's actual approach.
- Pros: no new plugin; full control; matches the immutable "return a new copy" style; precedent in a same-stack
  app.
- Cons: we hand-write load/save/atomic-write/migration and the two Tauri commands and a frontend wrapper; more
  surface than 5A for the same result.

**Option 5C - SQLite (reuse the history DB) (rejected).** Store settings as rows/a KV table in the existing history
database.
- Cons: a relational store for a single nested JSON document is a poor fit; couples settings lifecycle and
  migrations to the history DB (unrelated concerns); the nested `ISLAND.SETTINGS.JSON` maps awkwardly to columns or
  degenerates into a one-row JSON blob (at which point a file is simpler). No transactional benefit is needed for
  app settings.

**Recommendation: 5A tauri-plugin-store**, with **5B JSON-file-plus-commands as an equally acceptable
lighter-dependency alternative** if the team prefers to add no plugin (both are Type-2, cheap to switch; the
deciding factor is "reactive store convenience" vs "zero new dependency"). This axis does not force one; it forces
NOT SQLite.

**Rejected: SQLite for settings** (see guard **G6**).

---

## Axis 6 - Kind selection API: new `presentation` field vs overloading `theme` vs CLI-only flag

**Context:** `NotificationPayload` has `theme: Option<String>` (types.rs L190) and `style` overrides but no
form-factor selector. The tri-file enum pattern is `cli/src/types.rs` + `src-tauri/src/notification/types.rs` +
`src/types/notification.ts` (brief S3). Brief Q8 lists candidates: `presentation`, `variant`, or reuse `theme`.

**Option 6A - New `presentation` field, enum `card | island`, default `card` (RECOMMENDED).** Add the field across
the three type files and a `syncfu send --presentation island` flag.
- Pros: explicit and self-documenting; backward-compatible (absent -> `card`, existing senders unchanged); cleanly
  separates *form factor* from *visual theme* and from D4's appearance (dark/light/auto) setting; follows the
  established tri-file enum pattern so it slots into existing serde/tests.
- Cons: touches three type files + the CLI + serde round-trip tests (bounded, mechanical).

**Option 6B - Overload the existing `theme` field (e.g. `theme="island"`) (rejected).**
- Cons: conflates form factor (card vs island) with visual theme; D4 already introduces appearance dark/light/auto
  as a *setting*, so theme-as-presentation would collide semantically and values would fight. A single string field
  carrying two orthogonal concepts is a classic overload that later needs untangling.

**Option 6C - CLI-only flag with no payload field (rejected as non-viable).** A `--island` flag that sets no
transported field cannot reach the frontend, since presentation must travel in the payload over HTTP/WS to the
window. It necessarily collapses into either 6A (a real field) or 6B (overloading an existing field). Not an
independent option.

**Recommendation: 6A new `presentation` enum field, default `card`, plus a `--presentation` CLI flag.** (Exact
naming is a PRD/glossary decision - cross-ref lane 01; this lane fixes the *mechanism*: a dedicated additive field,
not an overload.)

**Rejected: overloading `theme`** (see guard **G8**). **Rejected: CLI-only-no-field** (see guard **G9**).

---

## Axis 7 - Model B queue ownership: Rust NotificationManager vs frontend store

**Locked context (D5):** Model B = compact spotlight (highest priority) + xN badge; expand -> priority-ranked,
deduped list capped 6 rows/560px then scroll; critical first; dedupe by group/live-activity key; auto-dismiss
paused while the list is open. **Existing:** `NotificationManager` (Rust) already owns `active`/`groups`/`queued`,
dedups by id, tracks groups, promotes from queue (manager.rs L26-107) and is covered by Rust unit tests.

**Option 7A - Rust NotificationManager owns the canonical ranked+deduped list + spotlight + count (RECOMMENDED).**
Extend the existing manager with priority ranking, dedupe-by-group/live-activity-key, spotlight selection, and the
count; the frontend renders what it is given.
- Pros: single source of truth; extends the component that *already* owns grouping and dedup-by-id, so no logic
  moves out of the tested Rust core (109 unit tests live here); ranking/dedupe/cap are pure functions, ideal for
  Rust unit tests; the frontend stays a thin renderer, consistent with today's `useNotifications()` model.
- Cons: "auto-dismiss paused while list open" needs the frontend (which owns the open/closed view state) to signal
  the manager to pause/resume timers - one extra command round-trip and a small state handshake.

**Option 7B - Frontend store owns the queue, ranking, dedupe, and spotlight (rejected).** The React store holds the
list and computes Model B in TS.
- Pros: list-open state is inherently frontend, so pausing auto-dismiss is local (no round-trip).
- Cons: creates a second source of truth alongside the Rust manager that already tracks active/groups/queued,
  risking drift (e.g. dedup-by-id in Rust vs dedup-by-group in TS disagreeing); moves testable business logic out
  of the Rust core into the less-covered frontend; duplicates grouping logic that already exists in Rust.

**Recommendation: 7A Rust NotificationManager owns the model.** Frontend owns only ephemeral *view* state (is-list-
open, scroll offset, row stagger) and sends a pause/resume signal for auto-dismiss while the list is open. This
keeps one source of truth and reuses the tested core.

**Rejected: frontend-owned queue/ranking** (see guard **G10**).

---

## Guard Register

Each guard is a standing rule. Resurfacing a rejected option requires re-adjudication that cites the guard by id.
G7, G11, G12 record decisions already locked upstream (D3/D5/D4); the rest are this lane's.

| id | Guards against | Rule (must re-adjudicate to violate) | Source | Reversibility |
|----|----------------|--------------------------------------|--------|----------------|
| **G1** | replace-overlay window | The island MUST be a separate window from the top-right `"overlay"`; do not reposition/repurpose the single overlay window into the island, and do not apply `set_content_protected` to the card's window. | Axis 1; design decision + `panel.rs` L60-69,108-178 | Type-1 (hard) |
| **G2** | motion/framer-motion as morph driver | Do not add `motion`/framer-motion to drive the container/shape morph. Reconsider ONLY for the inner content crossfade, ONLY if profiling shows jank, and ONLY with the SVG shape still hand-driven and the container box never `layout`-animated. | Axis 2; design decision (D3) | Type-2 (cheap) |
| **G3** | CSS mask as primary shape renderer | The concave shape MUST be an inline SVG `<path>` with animated `d`. CSS mask/`corner-shape` survives only as a documented degraded fallback, never the animated primary (it cannot animate on width). | Axis 3; ui-research L56 | Type-2 |
| **G4** | canvas shape rendering | Do not render the island shape via `<canvas>`; it adds an imperative redraw loop and still composites under DOM content for zero benefit over SVG. | Axis 3 | Type-2 |
| **G5** | config-only / hardcoded-only notch geometry (skipping the query) | The AppKit notch query MUST be attempted (behind the early gate) before settling for a fallback. Hardcoded-185/config-only is permitted ONLY as the gate-proven Plan B (Option 4B), not as a way to skip the query. | Axis 4; context pack L74-76 | Type-1 (hard) |
| **G6** | SQLite for settings | App settings MUST NOT be stored in the SQLite history DB; use tauri-plugin-store (5A) or a JSON config file (5B). | Axis 5; design decision (D4) | Type-2 |
| **G7** | linear CSS tweens (pre-adjudicated, D3) | Motion MUST be spring-based with the locked constants (220/25, 400/30, 260/18, reduced-motion 1000/100). No linear/ease CSS tweens for the morph. | D3 (locked) | Type-1 |
| **G8** | overloading `theme` for presentation | Presentation (card vs island) MUST NOT be encoded in the `theme` field; it is a dedicated `presentation` field. | Axis 6; types.rs L190 | Type-2 |
| **G9** | CLI-only flag with no payload field | Presentation MUST travel as a transported payload field; a CLI flag alone (no field) is not a valid mechanism. | Axis 6 | Type-2 |
| **G10** | frontend-owned Model B queue/ranking | The canonical ranked+deduped Model B list, spotlight, and count MUST live in the Rust `NotificationManager`; the frontend holds only ephemeral view state. | Axis 7; manager.rs L11-107 | Type-1 |
| **G11** | overflow Models A and C (pre-adjudicated, D5) | Overflow is Model B only. Model A (badge+cycle) and Model C (stack-under) are rejected; do not resurface without re-adjudication. C is the anti-pattern no mature app ships. | D5 (locked); ui-research L131-141 | Type-1 |
| **G12** | per-notification geometry (pre-adjudicated, D4) | Geometry/customization (widths, height, radii, opacity, accent, mode, position, appearance, toggles) is a PERSISTENT APP SETTING. The per-notification payload keeps ONLY the existing 27 `--s-*` style overrides; no geometry in the payload. | D4 (locked) | Type-1 |

---

## Findings (coordination-model schema)

### MEDIUM - Shared-window reuse would silently un-hide the top-right card from capture
- Lane: 03 Alternatives
- Root cause: if implementation reuses the single `"overlay"` window for the island (Axis 1B/replace), the only
  place to call `set_content_protected(true)` is that shared window, which also hosts the top-right card.
- Evidence: `src-tauri/src/overlay/panel.rs` L115 (single window id `"overlay"`); design decision D1 (capture-
  exclusion is a dedicated, catastrophic-if-wrong track).
- Impact: either the card gets hidden from capture (surprising) or the island cannot be hidden (privacy failure,
  the category-defining guarantee).
- Regression risk: high on the capture-exclusion track; medium on existing overlay behavior.
- Recommendation: dedicated island window (Axis 1A); enforce guard G1.
- Reverification: architecture lane confirms two window ids; test-strategy lane's capture track asserts protection
  is scoped to `"island"` only.
- Cross-refs: lane 02 (window creation), lane 06 (capture track), lane 04 (privacy pre-mortem).

### MEDIUM - Adopting Motion could reintroduce the D3 "animate the frame" jank anti-pattern
- Lane: 03 Alternatives
- Root cause: Motion's `layout` prop animates container box geometry; it is the natural thing to reach for, and it
  is exactly what D3 forbids, while it still cannot interpolate the SVG `d` we depend on.
- Evidence: design decision D3 (never animate the outer frame); ui-research L74-75, L336 (web demos fake the shape;
  native jank when mixing frame animation with springs).
- Impact: janky morph, larger bundle, and the shape morph remains hand-rolled regardless, so the dependency buys
  little.
- Regression risk: n/a (new feature) but degrades the flagship visual.
- Recommendation: hand-rolled rAF spring (Axis 2A); enforce guard G2.
- Reverification: architecture lane confirms no container-box animation; test-strategy lane's visual-regression
  screenshots gate the morph.
- Cross-refs: lane 02 (animation module), lane 06 (visual regression), lane 04 (jank pre-mortem).

### LOW - Notch-query fallback must be planned, not improvised
- Lane: 03 Alternatives
- Root cause: the AppKit query is an unverified platform unknown; without a pre-approved fallback, a failed gate
  could stall the whole feature or trigger an ad-hoc config-only shortcut that skips detection entirely.
- Evidence: context pack L74-76 (known unknown); design decision (Axis 4B is the pre-approved Plan B).
- Impact: schedule risk and a possible silent regression to a worse geometry model.
- Regression risk: low.
- Recommendation: layered gated approach (Axis 4A) with 4B as the pre-approved fallback; enforce guard G5; the task
  lane owns the early isolated gate.
- Reverification: task lane lists the gate as an early isolated TODO with a pass/fail criterion.
- Cross-refs: lane 05 (early gate task), lane 04 (platform-unknown risk), lane 02 (panel.rs query path).

---

## Cross-references for other lanes

- **Lane 01 (PRD):** owns the *name* of the presentation field/values (Axis 6 fixes the mechanism = a dedicated
  additive `presentation` field defaulting to `card`, not a `theme` overload); glossary should list `presentation`,
  `card`, `island`.
- **Lane 02 (Architecture):** implement Axis 1A (second window id `"island"` via a `panel.rs` sibling), Axis 2A
  (ported rAF spring module), Axis 3A (SVG-path shape module), Axis 4A (gated AppKit query + fallback + config
  override), Axis 5A/5B (settings store), Axis 7A (extend `NotificationManager` for Model B). Honor guards
  G1-G12.
- **Lane 04 (Risk):** the two MEDIUM findings (shared-window capture leak, Motion frame-jank) and the LOW
  (notch-query fallback) are pre-mortem seeds; capture-exclusion scoping (G1) is the privacy-critical one.
- **Lane 05 (Tasks):** Axis 4A requires an EARLY ISOLATED GATE task for the AppKit notch query with a pass/fail
  criterion and 4B as the documented fallback branch; every guard G1-G12 should map to a check in the owning task.
- **Lane 06 (Test strategy):** capture-exclusion track must assert protection is scoped to `"island"` only (G1);
  visual-regression must gate the morph and prove the container box is never frame-animated (G2); Model B ranking/
  dedupe/cap are Rust unit tests (G10, Axis 7A).
