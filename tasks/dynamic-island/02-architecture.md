# Lane 02 - Architecture

Framework(s): C4 container/component mapping + interface-first design (types/signatures before impl) + map-vs-territory grounding (every claim checked against the repo tree, cited file:line). A short inline pre-mortem gates the two platform unknowns (capture-exclusion, notch geometry).

Scope: where the Dynamic Island slots into the existing syncfu Tauri v2 app. PLAN ONLY. All decisions cite either a repo file:line or a locked design decision (D1-D6).

Ground truth verified this session:
- `src/App.tsx:6-14` already routes by window label: `overlay` renders `NotificationOverlay`, everything else renders `MainApp`. A third label is a one-line addition.
- One overlay window exists today, label `overlay`, created in `src-tauri/src/overlay/panel.rs:76` (NSPanel on macOS via `tauri-nspanel`, always-on-top `WebviewWindow` elsewhere).
- A `main` window is created lazily by the tray "Open syncfu" item (`src-tauri/src/tray/menu.rs:67-73`); `App.tsx` renders `MainApp` into it. This is where island settings UI lives.
- Backend broadcast today: `src-tauri/src/lib.rs:31` uses `app.emit("notification:add", ...)` (all windows) and `notify()` calls `overlay::panel::show_panel` unconditionally (`lib.rs:30`).
- Deps present: `tauri-nspanel` (git v2.1), `core-graphics 0.24`, `serde_json`. NOT present: `tauri-plugin-store`, any `objc2*` crate, `dirs`/`directories` (`src-tauri/Cargo.toml:21-50`).
- Mockup reference code to PORT verbatim (ledger cross-ref, do not redesign): `notchPath` `tasks/dynamic-island-mockup.html:753`, `capsulePath` :770, `Spring` integrator :781, `SPRING` config :800, `createIsland` controller :809, `--di-wall` publish rule :887, settings schema `renderJSON` :1170.

---

## 0. One-paragraph verdict

Add a **second dedicated window** labeled `island` (not a reuse of `overlay`), sized once to a fixed envelope and never frame-animated. Add exactly **one** new payload field, `presentation: "card" | "island"` (default `card`), across the tri-file type pattern. Port the mockup's vanilla-JS island engine into a small React island subtree that reuses the existing `--s-*` style plumbing. Persist the 13-key `island.settings.json` as a plain serde JSON file in the app config dir (no new plugin), edited from the `main` window, live-pushed to the island window by a Tauri event. Both windows coexist; the backend routes each notification to one window by its `presentation` value. Two platform unknowns (capture-exclusion reaching the NSPanel, and NSScreen notch geometry) get an isolated early-gate spike before any UI work, per D1.

---

## 1. Window strategy: a second dedicated `island` window

### Decision: dedicated window, not reuse of `overlay`

The `overlay` window is fundamentally incompatible with the island in four axes, so reuse would fork its behavior with runtime branches everywhere:

| axis | overlay (today) | island (new) |
|------|-----------------|--------------|
| anchor | top-right, `calculate_panel_position` (`panel.rs:60`) | top-center, notch-anchored |
| sizing | per-frame `resizeToContent` -> `setSize` (`NotificationOverlay.tsx:12-38`) | fixed envelope, NEVER resized per frame (D3) |
| capture policy | capturable (normal notification) | `set_content_protected` when `hideFromScreenCapture` (D4) |
| shape | rectangular glass card | SVG concave-shoulder path morphing inside a static frame |
| coexistence | must stay running when island is active (point 8) | independent lifecycle |

Two windows also let point 8 (island + top-right card at once) work with zero shared mutable state.

### New backend module: `src-tauri/src/overlay/island.rs`

Sibling to `panel.rs`, same shape and conventions. Interface sketch (signatures only):

```rust
// src-tauri/src/overlay/island.rs
pub const ISLAND_LABEL: &str = "island";

/// Fixed outer envelope. The frame is sized to this ONCE and never animated (D3).
/// Width = max(compactWidth, expandedWidth) from settings; height = maxExpH (560) + top slack.
pub struct IslandEnvelope { pub width: f64, pub height: f64 }

pub struct IslandAnchor { pub x: f64, pub y: f64 } // top-left of the envelope, logical px

/// Center the envelope on the notch center (macOS notch mode) or screen center (float).
/// Notch mode: y = monitor_top; float top-center: y = monitor_top + 12; float bottom-center: y = bottom - env.height - 12.
pub fn calculate_island_anchor(
    monitor: MonitorInfo,           // reuse the struct from panel.rs
    env: IslandEnvelope,
    mode: IslandMode,               // Notch | Float
    position: IslandPosition,       // Left | Center | Right | BottomCenter
    notch: Option<NotchGeometry>,   // point 6; None -> fixed fallback bar center
) -> IslandAnchor;

pub fn create_island(app: &AppHandle, settings: &IslandSettings) -> Result<(), String>;
pub fn show_island(app: &AppHandle);   // reposition to target monitor, then show
pub fn hide_island(app: &AppHandle);
/// Re-apply envelope size + anchor after a settings change that alters geometry.
pub fn reflow_island(app: &AppHandle, settings: &IslandSettings) -> Result<(), String>;
/// Toggle capture protection (point 5). Called on create and on settings change.
pub fn set_island_capture_protected(app: &AppHandle, protected: bool) -> Result<(), String>;
```

`calculate_island_anchor` is the unit-testable pure function mirroring `calculate_panel_position` (which has 6 tests at `panel.rs:334-453`); the test lane inherits that pattern.

### Startup, positioning, multi-monitor

- Startup: create the island window **hidden** in `.setup()` right after `create_panel` (`lib.rs:276`). It stays hidden until the first `presentation: "island"` notification, matching the panel pattern (`panel.rs:75` comment).
- macOS: build via `tauri-nspanel::PanelBuilder` with the exact same non-activating / join-all-spaces / full-screen-auxiliary config as `create_macos_panel` (`panel.rs:108-144`) so it floats over fullscreen apps and never steals focus. Level `Status`.
- Multi-monitor: the physical notch exists only on the built-in display. Targeting rule: if a notch is detected, the island targets the **built-in notch display**; otherwise it targets the cursor monitor via the existing `get_cursor_monitor_info` (`panel.rs:249`) with `get_primary_monitor_info` fallback. Float mode always follows the cursor monitor. This differs from the overlay, which always follows the cursor, so it is a deliberate island-only rule (state it in the PRD).

### Never-animate-the-frame reconciliation (D3)

The overlay resizes the OS window every frame (`resizeToContent`). The island must NOT. Concrete rule:

1. On `create_island` and `reflow_island`, set the window to a **fixed envelope** = `max(compactWidth, expandedWidth) x (maxExpH + slack)` and never call `setSize` during a morph.
2. The compact<->expanded morph animates only the **inner SVG path** (`notchPath` W/H/t/b via the `Spring` integrator) and the content layer, entirely inside the static frame. This is exactly what `createIsland`/`frame` does in the mockup (`:875-893`), which sets `island.style.width/height` on a DIV, never the window.
3. Because the frame is a large mostly-transparent window over the top-center, it must be **click-through** except on the island shape. Approach: create with `set_ignore_cursor_events(true)`; when the island element receives `pointerenter` (hover-to-expand, D3) the frontend calls a command `set_island_interactive(true)`, and on `pointerleave` after collapse it restores `true`. Tradeoff and an alternative (discrete window resize only at the two transition boundaries, which still honors "never animate per frame") are handed to Lane 03; flag as a decision for the PRD.

Cross-ref: this click-through toggle is the single riskiest interaction detail; Lane 04 should pre-mortem "island eats menu-bar clicks" and "actions unclickable because window stayed click-through".

---

## 2. Kind-selection plumbing (tri-file type pattern)

### Proposed field: `presentation`, default `card`

Rationale over alternatives: `variant` is vague; reusing `theme` (`types.rs` already has an open-string `theme`, `notification/types.rs:190`) would overload a styling knob with routing semantics and break the "additive, non-replacing" guarantee. `presentation` reads as "which surface renders this" and defaults to the existing behavior, so every current caller is untouched (backward compatible). **Decision for the PRD: field name `presentation`, enum `card | island`, default `card`.**

Tri-file change (mirrors the `Priority`/`ActionStyle` pattern noted in the context pack, present in all three files today):

```rust
// src-tauri/src/notification/types.rs  (and identical in cli/src/types.rs)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Presentation { Card, Island }
impl Default for Presentation { fn default() -> Self { Self::Card } }
// add to NotificationPayload / NotifyRequest:
#[serde(default)]
pub presentation: Presentation,
// cli/src/types.rs additionally needs `impl FromStr for Presentation` (mirrors Priority:19-30)
```

```typescript
// src/types/notification.ts
export type Presentation = "card" | "island";
// in NotificationPayload:
readonly presentation?: Presentation; // undefined treated as "card"
```

CLI flag on the `Send` subcommand (`cli/src/main.rs:33`, alongside `--priority`):

```rust
/// Presentation surface: card (top-right) or island (top-center notch)
#[arg(long, default_value = "card")]
presentation: Presentation,
```

HTTP/WS schema: no endpoint signature change; `presentation` rides inside the existing JSON body that `axum` deserializes into `NotificationPayload` (`#[serde(default)]` keeps old bodies valid). The WS path is the same payload. Backward compatibility invariant for the test lane: a body with no `presentation` field must deserialize to `Presentation::Card`.

---

## 3. Frontend: porting the mockup into React

New subtree `src/components/island/` plus shared libs in `src/lib/`. Port, do not reinvent (ledger cross-ref).

### Files and responsibilities

```
src/lib/spring.ts          <- port Spring class + SPRING config (mockup :781-805). Pure, unit-testable.
src/lib/notchPath.ts       <- port notchPath (:753) + capsulePath (:770). Pure string builders, unit-testable.
src/lib/styleVars.ts       <- EXTRACT buildStyleVars + STYLE_VAR_MAP from NotificationCard.tsx:254-305 so
                              both the card and the island consume the same 27 --s-* mapping (DRY, no fork).
src/components/island/IslandOverlay.tsx  <- router target for label "island" (parallels NotificationOverlay)
src/components/island/Island.tsx         <- the engine host: owns the rAF loop + springs, renders <svg><path>,
                                            publishes --di-wall (:887). Ports createIsland's frame/setTargets/measure.
src/components/island/IslandCompact.tsx  <- leading glyph + trailing live-activity + xN badge (Model B spotlight)
src/components/island/IslandExpanded.tsx <- card content, reuses NotificationIcon/RelativeTime, honors --s-* + --di-wall
src/components/island/IslandList.tsx     <- Model B ranked/deduped/capped-6/scroll-fade list (D5)
```

### Where state lives

- **Island geometry/motion state** (springs, expanded flag, rAF handle): local to `Island.tsx` via `useRef`/`useState`. This is per-frame mutable and must not live in a store (the mockup keeps it in closures at `:832`).
- **Active notifications**: reuse the existing `notificationStore` (`src/stores/notificationStore.ts`) via `useNotifications` (`src/hooks/useNotifications.ts`). No second source of truth. `IslandList` derives its ranked/deduped view from the same store (point 7).
- **Island settings** (the 13 knobs): new `src/stores/islandSettingsStore.ts`, hydrated once from `get_island_settings` IPC and updated on the `island:settings` event (point 4).

### App routing

`src/App.tsx:10` gains one branch:

```typescript
if (label === "island") return <IslandOverlay />;
if (label === "overlay") return <NotificationOverlay />;
return <MainApp />;
```

`src/types/notification.ts:91` `WindowLabel` becomes `"overlay" | "main" | "island"`.

### How the 27 `--s-*` overrides flow into island content

Unchanged mechanism: `IslandExpanded` calls the extracted `buildStyleVars(style, font)` (from `styleVars.ts`) and spreads the returned CSS custom properties onto its content root, exactly as `NotificationCard` does at `:164`. The island's own geometry vars (`--di-accent`, `--di-wall`, `--di-pop`) are set by `Island.tsx` on the outer element and are orthogonal to the `--s-*` set, so a payload's `style` overrides theme the expanded card identically in both presentations. Invariant for the test lane: the same `style` payload produces the same resolved `--s-*` values in card and island.

### Motion dependency: hand-rolled, no `motion`

The mockup already ships a working ~1.5kb rAF damped-spring integrator implementing 220/25 and 400/30 (`Spring` at :781). Adopt it; do not add `motion`/Framer. Reasons: (a) it is already the approved spec, (b) Motion layout animations do not run in jsdom so tests would be Playwright-only regardless, (c) zero new dependency. Final call is Lane 03's, but architecture recommends port-the-mockup.

---

## 4. Settings persistence: plain JSON file, edited from `main`

### Store choice: serde JSON file, NOT tauri-plugin-store

`tauri-plugin-store` is not a dependency today (`Cargo.toml:21-50`) and adding it buys little: the schema is a flat 13-key object (mockup `renderJSON` :1170). A plain serde read/write to `island.settings.json` in the app config dir is minimal, matches the mockup schema byte-for-byte, and needs no new plugin. (Simplicity-first.)

```rust
// src-tauri/src/notification/settings.rs (new)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandSettings {
    pub compact_width: f64,      // 150-600 default 218
    pub expanded_width: f64,     // 320-560 default 380
    pub height: f64,             // 24-60  default 34
    pub surface_opacity: f64,    // 0-1    default 0.94 (fill alpha only)
    pub top_radius: f64,         // default 6
    pub bottom_radius: f64,      // default 14
    pub corner_scaling: bool,    // default true
    pub accent: String,          // default "#4a9eff"
    pub mode: IslandMode,        // notch | float, default notch
    pub position: IslandPosition,// left|center|right|bottomCenter, default center
    pub appearance: IslandAppearance, // dark|light|auto, default dark
    pub reduced_motion: bool,    // default false
    pub hide_from_screen_capture: bool, // default true
}
impl Default for IslandSettings { /* the mockup DEFAULTS at :1123 */ }

pub fn settings_path(app: &AppHandle) -> PathBuf;     // app_config_dir()/island.settings.json
pub fn load_settings(app: &AppHandle) -> IslandSettings; // missing/corrupt -> Default (validate + clamp on read)
pub fn save_settings(app: &AppHandle, s: &IslandSettings) -> Result<(), String>;
```

Field names are the `camelCase` JSON keys from the mockup's `renderJSON` (`:1171-1178`): `compactWidth, expandedWidth, height, surfaceOpacity, topRadius, bottomRadius, cornerScaling, accent, mode, position, appearance, reducedMotion, hideFromScreenCapture`. Validation clamps to the D4 ranges on load (never trust the file).

### IPC commands (register in `lib.rs` `generate_handler!` at :257)

```rust
#[tauri::command] async fn get_island_settings(app) -> Result<IslandSettings, String>;
#[tauri::command] async fn set_island_settings(app, settings: IslandSettings) -> Result<(), String>;
#[tauri::command] async fn set_island_interactive(app, interactive: bool) -> Result<(), String>; // point 1 click-through toggle
```

### Where the settings UI lives: the `main` window

Not the tray (a tray menu cannot host 13 sliders/segments). The `main` window already exists and renders `MainApp` (`App.tsx:12`, `tray/menu.rs:67`). Add an "Island" settings panel to `MainApp` that ports the mockup playground controls (`tasks/dynamic-island-mockup.html:591-622`). The tray keeps only its current items; optionally add an "Island settings..." item that opens `main` and deep-links the panel (nice-to-have, defer).

### Live-update path

```
MainApp slider onChange
  -> islandSettingsStore.set(...)           (optimistic local)
  -> invoke("set_island_settings", {...})   (persist)
Rust set_island_settings:
  -> save_settings(file)
  -> if geometry keys changed: island::reflow_island(app, &s)   (resize envelope / reposition / re-anchor)
  -> if hide_from_screen_capture changed: island::set_island_capture_protected(app, s.hide...)
  -> app.emit_to("island", "island:settings", &s)
IslandOverlay listens "island:settings"
  -> islandSettingsStore.replace(s) -> Island.tsx re-targets springs via the ported controller.update() (mockup :946-948)
```

Using `emit_to("island", ...)` (not broadcast) keeps the overlay/main windows out of it. `Island.tsx` re-targets springs rather than snapping, matching `createIsland`'s `update()` at `:946`.

---

## 5. Capture exclusion (D1 dedicated track, EARLY GATE)

Primitive: Tauri v2 `WebviewWindow::set_content_protected(true)` -> macOS `NSWindowSharingNone`, Windows `WDA_EXCLUDEFROMCAPTURE`, Linux no-op (documented gap).

**Unknown to resolve before UI work (pre-mortem: silent privacy leak):** the island window on macOS is an **NSPanel** created by `tauri-nspanel`, not a stock `WebviewWindow`. Tauri's `set_content_protected` operates on the `WebviewWindow` handle; whether it reaches the underlying NSPanel's `sharingType`, and whether tauri-nspanel keeps a `WebviewWindow` handle addressable via `get_webview_window("island")` (the panel code already relies on this dual-handle trick at `panel.rs:200-217`), must be proven on a real capture (QuickTime / Zoom / a `CGDisplayStream`).

Raw-AppKit fallback if the Tauri call does not take on the NSPanel:
```rust
// via the panel/ns_window handle: set sharingType = NSWindowSharingType::None directly
// ns_window.setSharingType_(NSWindowSharingNone)  (objc msg send)
```
Counter-example guard (context pack): open-island / open-vibe-island set `.readOnly` and ARE capturable. Do not copy their panel setup; the correct value is `NSWindowSharingNone` (NotchPrompter `sharingType = .none`, boring.notch `updateSharingType()`).

Windows/Linux: island is a normal `WebviewWindow`, so `set_content_protected` is the direct path on Windows; Linux ships visible with a documented limitation (Lane 04 owns the fallback decision: auto-hide while a known capture app is frontmost, or accept-visible-and-warn).

Deliverable of the gate: a 1-command spike that creates a capture-protected island stub and a manual/scripted capture check per OS, wired to the D1 dedicated verification track. Lane 05 must place this BEFORE any island UI task.

---

## 6. Notch geometry (EARLY GATE)

Need: notch width/height and screen bounds to anchor the concave shoulders. boring.notch formula (context pack): `notchWidth = screen.width - auxiliaryTopLeftArea.width - auxiliaryTopRightArea.width + 4`, from `NSScreen`.

Candidate Tauri access paths, ranked:
1. **`objc2-app-kit` NSScreen** (recommended). Read `auxiliaryTopLeftArea` / `auxiliaryTopRightArea` (macOS 12+) or `safeAreaInsets.top` on the screen matching the built-in display. Adds one well-maintained crate; no custom plugin. This is the objc2 path the prompt names.
2. **Hand-rolled objc bridge** using the `objc`/`core-graphics` machinery already linked (`core-graphics 0.24` present). Smaller dependency delta, more unsafe code to own.
3. Custom Tauri plugin wrapping either of the above. Overkill for two field reads; reject unless reused elsewhere.
4. Existing notch crates (e.g. DynamicNotchKit) are Swift, not linkable from Rust; UX reference only.

```rust
// src-tauri/src/overlay/notch.rs (new, macOS-gated)
pub struct NotchGeometry { pub screen_width: f64, pub notch_width: f64, pub notch_height: f64, pub screen_x: f64, pub screen_top: f64 }
#[cfg(target_os = "macos")] pub fn notch_geometry() -> Option<NotchGeometry>; // None on non-notch Macs
#[cfg(not(target_os = "macos"))] pub fn notch_geometry() -> Option<NotchGeometry> { None }
```

Fallback bar for non-notch (context pack): fixed ~185x32 capsule centered top; the `float`/`capsulePath` path (mockup :770) already renders this convex shape. So `notch_geometry() == None` naturally routes the frontend into float rendering.

Early-gate spike shape: a Rust unit/integration probe that logs `notch_geometry()` on a notch Mac and a non-notch Mac (and returns `None` cleanly on Windows/Linux). Owned by Lane 05, placed with the capture gate. Multi-monitor note: `notch_geometry` targets the built-in display specifically; external monitors never have a notch.

---

## 7. Model B data flow (D5)

### Source of truth: `NotificationManager` (unchanged), frontend derives the view

`NotificationManager` already holds `active: IndexMap`, `queued: Vec`, `groups: HashMap` (`manager.rs:11-14`). Model B needs the full active set (spotlight + list), which the store already mirrors via `notification:add` / `:dismiss` events (`useNotifications.ts:16-39`). So **no queue moves to the frontend and no manager change** for ranking; `IslandList` computes rank/dedupe/cap as a pure view selector over `notificationStore`.

```typescript
// src/lib/islandRanking.ts (pure, unit-testable)
type Ranked = { spotlight: NotificationPayload; count: number; rows: NotificationPayload[] };
function rankForIsland(items: readonly NotificationPayload[]): Ranked;
//  order: critical > high > normal > low, then most-recent createdAt
//  dedupe key: payload.group ?? `${sender}::${title}`  (research: dedupe by group/live-activity key)
//  rows: deduped, capped at 6 (D5); count = total island-presentation items; badge caps "9+"
```

Only `presentation: "island"` items feed this selector (see point 8 filtering).

### Interaction with `--wait` waiters and callbacks

Unchanged and untouched. A list row maps to a notification id; expanding a row and clicking an action still calls `invoke("action_callback", { notificationId, actionId })` (`NotificationOverlay.tsx:78`), which drives `waiters.notify` and the webhook exactly as today (`lib.rs:109-152`). The island is a new **view** over the same action path, so `--wait` exit codes (0/1/2) and SSE events are preserved. Sub-question for Lane 05: rows in the collapsed list show label-only; actions appear when a row is focused/expanded, so the id->action mapping is per-row and reuses the payload's `actions`.

### Auto-dismiss pause semantics

Today each card runs its own timer with a cursor-hover pause (`NotificationCard.tsx:111-147`). Model B requires: **while the list is open (island expanded showing >1 item), all per-item auto-dismiss timers are paused** (D5). Implementation: `Island.tsx` exposes an `isListOpen` boolean into context; the island's item timer hook checks `isListOpen || hovered` before firing. On collapse, timers resume from full (not remaining) to avoid abrupt dismissals, matching the hover-resume behavior already shipped. Critical items never auto-dismiss regardless (`TIMEOUTS.critical = null`, `NotificationCard.tsx:12`).

State machine (interruption states, completeness gate):

| state | trigger in | trigger out | interruptions handled |
|-------|-----------|-------------|-----------------------|
| Hidden | first island notif | last island notif dismissed | new notif -> Compact |
| Compact spotlight (+xN) | notif while empty | hover / new activity -> Expanded | new notif -> update spotlight+badge; --wait notif -> force Expanded |
| Expanded card (1 item) | hover / activity | pointerleave + timeout -> Compact | 2nd notif -> Expanded list |
| Expanded list (>1) | 2nd island notif | count drops to 1 -> Expanded card; to 0 -> Hidden | new notif -> insert ranked, pause timers; settings change -> re-target springs; monitor change -> reflow/hide |

---

## 8. Coexistence: island and top-right card at once

Both windows run simultaneously; each notification renders in exactly one, chosen by `presentation`.

### Routing rule: backend routes by presentation (recommended), frontend filters as the safety net

`notify()` (`lib.rs:23-34`) changes from unconditional broadcast + `show_panel` to:

```rust
match payload.presentation {
    Presentation::Island => { island::show_island(&app); app.emit_to(ISLAND_LABEL, "notification:add", &payload)?; }
    Presentation::Card   => { panel::show_panel(&app);    app.emit_to("overlay",     "notification:add", &payload)?; }
}
```

`dismiss`/`update` route the same way (the manager can look up the notification's `presentation` by id to pick the target window; `manager.get(id)` already exists, used at `lib.rs:117`). `dismiss_all` broadcasts to both then hides both. Hide logic becomes per-window: hide `overlay` when its card count hits 0, hide `island` when its island count hits 0 (add `active_count_by_presentation` to the manager, or filter `list_active`).

Defense in depth: even with routing, each frontend hook filters by `presentation` so a stray broadcast can never render in the wrong surface. `NotificationOverlay` keeps only `presentation !== "island"`; `IslandOverlay` keeps only `presentation === "island"`. This also makes the existing overlay regression-safe if routing is deferred: with frontend filtering alone, the current broadcast still works and the overlay simply ignores island items.

Lane 03 owns the "route-in-backend vs broadcast-and-filter" tradeoff; architecture recommends **both** (route to reduce cross-window churn, filter for safety), which is the lowest-regression path for the existing top-right overlay.

---

## Component / data-flow diagram (ASCII)

```
 external process / agent
        | HTTP :9868 / WS :9869   (payload gains: "presentation":"island"|"card")
        v
  axum server (server/http.rs)  --deser--> NotificationPayload { presentation, style(27), ... }
        v
  NotificationManager (Arc)   active: IndexMap | queued: Vec | groups: HashMap   [SOURCE OF TRUTH]
        v  notify() routes by presentation
   +----------------------------+----------------------------------+
   | Presentation::Card         | Presentation::Island             |
   v                            v                                  |
 panel::show_panel           island::show_island                  |
 emit_to("overlay",          emit_to("island", "notification:add")|
   "notification:add")            + island::set_capture_protected  |
        |                            + set_ignore_cursor_events     |
        v                            v                              |
 [overlay window]            [island window]  (dedicated, top-center,
  NSPanel top-right           NSPanel/notch, capture-protected,
  resize-to-content           FIXED ENVELOPE - frame never animated)
        |                            |
        v                            v
 App.tsx label==overlay      App.tsx label==island
  NotificationOverlay          IslandOverlay
   -> NotificationCard          -> Island.tsx (rAF loop, springs, <svg path notchPath/capsulePath>, --di-wall)
   (filter presentation!=island)   |-> IslandCompact  (spotlight + xN, Model B)
                                    |-> IslandExpanded (reuses --s-* via styleVars.ts, NotificationIcon, RelativeTime)
                                    |-> IslandList     (rankForIsland: rank+dedupe+cap6+scroll, timers paused while open)
                                   (filter presentation==island)

 shared stores/libs:  notificationStore (both) | islandSettingsStore (island)
 shared pure libs:    src/lib/spring.ts  notchPath.ts  styleVars.ts  islandRanking.ts   (PORTED from mockup)

 SETTINGS live-update loop:
  [main window] MainApp Island panel --invoke set_island_settings--> Rust settings.rs (save file)
       Rust: reflow_island (geometry) + set_island_capture_protected + emit_to("island","island:settings")
       [island window] islandSettingsStore.replace -> Island.tsx re-targets springs (controller.update)

 action path (unchanged): IslandExpanded button -> invoke("action_callback", {notificationId, actionId})
       -> waiters.notify (--wait SSE, exit 0/1/2) + webhook POST     [identical to overlay]
```

---

## Findings

### HIGH - Capture-exclusion may not reach the macOS NSPanel / Lane 02 / Root cause: island uses an NSPanel (tauri-nspanel) but `set_content_protected` targets the WebviewWindow handle / Evidence: `src-tauri/src/overlay/panel.rs:108-144` (NSPanel build) + panel.rs:200-217 (dual-handle reliance) + design decision D1 (dedicated capture track) / Impact: silent screen-share leak, the category differentiator fails invisibly (worst-case privacy) / Regression risk: none to existing overlay (new window) / Recommendation: EARLY-GATE spike proving `set_content_protected` on the island NSPanel via a real capture; raw-AppKit `sharingType = .none` fallback ready / Reverification: scripted CGDisplayStream/QuickTime capture shows blank where the island is, on macOS + Windows / Cross-refs: Lane 04 (privacy pre-mortem), Lane 05 (gate ordering), Lane 06 (D1 track).

### HIGH - NSScreen notch-geometry access path is unproven from Rust / Lane 02 / Root cause: notch dimensions live in AppKit NSScreen auxiliary areas with no Tauri wrapper / Evidence: context pack "Tauri access path is a KNOWN UNKNOWN" + no objc2 crate in `Cargo.toml:21-50` / Impact: cannot anchor concave shoulders correctly; island misaligns with the physical notch / Regression risk: none (new code) / Recommendation: EARLY-GATE spike using `objc2-app-kit` NSScreen (`auxiliaryTopLeftArea`/`auxiliaryTopRightArea`, boring.notch formula); float fallback when `None` / Reverification: probe logs correct notch width on a notch Mac, `None` on non-notch + Win/Linux / Cross-refs: Lane 03 (crate choice), Lane 05 (gate), Lane 04 (notch edge cases).

### MEDIUM - Click-through envelope can eat menu-bar clicks or block actions / Lane 02 / Root cause: fixed large top-center frame (never-animate-frame rule) sits over the menu bar and must toggle interactivity / Evidence: design decision D3 (hold expanded size) + `set_ignore_cursor_events` requirement / Impact: either the menu bar becomes unclickable (frame too greedy) or action buttons never receive clicks (frame stayed click-through) / Regression risk: none to overlay / Recommendation: create with `ignore_cursor_events(true)`, toggle via `set_island_interactive` on pointerenter/leave; Lane 03 weigh the discrete-resize alternative / Reverification: Playwright/manual: menu bar clickable when island idle; action click fires `action_callback` when expanded / Cross-refs: Lane 03, Lane 04.

### MEDIUM - `notify()` show/emit must become presentation-aware / Lane 02 / Root cause: `lib.rs:30-31` unconditionally shows the overlay panel and broadcasts / Evidence: `src-tauri/src/lib.rs:23-34` / Impact: without routing, an island notification would also pop the empty top-right panel / Regression risk: touches the core send path used by every existing notification (existing regression surface per context pack) / Recommendation: branch on `payload.presentation`; keep frontend presentation-filter as safety net so deferring backend routing still leaves the overlay correct / Reverification: card-only send behaves byte-identically to today (integration test); island send shows only the island / Cross-refs: Lane 06 (backward-compat test), Lane 05 (task ordering).

### LOW - `set_content_protected` toggling on settings change must not recreate the window / Lane 02 / Root cause: `hideFromScreenCapture` is a live toggle (D4) / Evidence: mockup DEFAULTS `hideCapture:true` (:1123) / Impact: a naive impl might recreate the NSPanel, dropping in-flight notifications / Regression risk: island-only / Recommendation: `set_island_capture_protected` flips `sharingType`/`content_protected` in place, never rebuilds / Reverification: toggle mid-notification; island stays, capture state flips / Cross-refs: Lane 04.

---

## Cross-references for other lanes

- **Lane 01 (PRD)**: adopt these decisions as FRs - field name `presentation` (enum `card|island`, default `card`); island targets the built-in notch display when a notch exists else the cursor monitor (island-specific, differs from overlay); settings persist as `island.settings.json` (13 keys, camelCase from mockup `renderJSON` :1170) edited from the `main` window; settings UI lives in `MainApp`, not the tray. Add a glossary entry: "presentation" vs "theme" (theme stays a styling string, presentation is routing).
- **Lane 03 (Alternatives)**: decide (a) hand-rolled Spring vs `motion` (architecture recommends port-the-mockup Spring, `src/lib/spring.ts`); (b) reuse `overlay` window vs dedicated `island` window (architecture: dedicated); (c) reuse `NotificationCard` vs new island components (architecture: new components + EXTRACT shared `styleVars.ts`); (d) backend-route vs broadcast-and-filter (architecture: both); (e) click-through toggle vs discrete window resize at transition boundaries; (f) notch crate: `objc2-app-kit` vs hand-rolled objc. Guard rejected: do NOT reuse `theme` for routing; do NOT copy open-island `.readOnly` capture setup.
- **Lane 04 (Risk / pre-mortem)**: two HIGH findings above are the top pre-mortem seeds (capture leak, notch geometry). Also: click-through eating menu-bar clicks; Linux capture gap fallback decision; NSPanel + content_protected interaction; monitor disconnect while island shown (reflow/hide); frame-never-animated vs discrete resize jank.
- **Lane 05 (Task decomposition)**: place TWO isolated early gates BEFORE any island UI task - (G1) capture-exclusion spike (point 5), (G2) notch-geometry spike (point 6). Then tri-file `presentation` field, `island.rs` window + `calculate_island_anchor` (with unit tests mirroring `panel.rs` tests), port `spring.ts`/`notchPath.ts`/`styleVars.ts`, `Island.tsx` engine, `IslandList` + `islandRanking.ts`, `settings.rs` + IPC + `MainApp` panel + live-update, backend routing in `notify()`. Every MUST (capture exclusion, notch anchor, presentation routing) maps to an owner task.
- **Lane 06 (Test strategy)**: pure libs (`spring.ts`, `notchPath.ts`, `styleVars.ts`, `islandRanking.ts`, `calculate_island_anchor`) are Vitest/Rust-unit testable; the morph and capture-exclusion are Playwright/manual only. Backward-compat invariant: payload without `presentation` deserializes to `Card` (Rust + a body sent through HTTP). Owns the D1 dedicated capture-exclusion track that both HIGH findings feed.
