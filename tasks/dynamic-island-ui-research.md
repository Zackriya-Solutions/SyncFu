# Dynamic Island UI Research (agent fleet, 2026-07-20)

# SyncFu Dynamic-Island Mockup — Implementation Brief

Synthesized from 3 native Swift apps (boring.notch, open-island, open-vibe-island — all draw the real concave shape) + 2 web efforts (Pillar/Tauri, cho.sh/amelie demos — all fake the shape). Where native and web disagree, native wins on shape math; web wins on the fact that syncfu is plain HTML with no physical notch.

---

## 1. THE SHAPE

### The one technique that matters
All three native apps draw the concave "shoulder" identically, and it is the *only* faithful method: **quadratic Béziers where the control point sits AT the outer top corner** (on the top edge). This pulls the curve inward → concave fillet. Bottom corners use the mirror arrangement → convex round. Web demos all skip this (Pillar just zeroes the top radius; cho.sh swaps in a squircle clipPath). For a plain-HTML mockup, reproduce it 1:1 as an **inline SVG `<path>` with an animated `d`** — crispest, resolution-independent, trivially scalable.

### Radii (pick boring.notch's set — it derives from DynamicNotchKit, the most-forked source)
| State | topRadius | bottomRadius |
|---|---|---|
| Compact (closed) | **6** | **14** |
| Expanded (open) | **19** | **24** |

(open-island uses 6/20 → 22/36; open-vibe uses 22/22 opened. boring's 6/14→19/24 is the mainstream reference. Animate all four values to morph.)

**Clamp rules (verbatim from all three repos):**
```
topR = min(topRadius, width/4, height/4)
botR = min(bottomRadius, width/4, height/2)
```

### The actual path (SVG, origin top-left, rect = W×H, `t`=topR, `b`=botR)
This is the load-bearing snippet — the 8 segments map 1:1 from SwiftUI `addQuadCurve`:
```
M 0 0
Q {t} 0   {t} {t}          // top-left CONCAVE shoulder (control on top edge)
L {t} {H-b}                 // left wall
Q {t} {H} {t+b} {H}         // bottom-left CONVEX round
L {W-t-b} {H}               // bottom edge
Q {W-t} {H} {W-t} {H-b}     // bottom-right CONVEX round
L {W-t} {t}                 // right wall
Q {W-t} 0 {W} 0             // top-right CONCAVE shoulder (control on top edge)
Z
```
Build the `d` string in JS from `{W, H, t, b}` and set it on `<path fill="#000">` (native fill is pure `#000` / `#0d0d0f`, always dark so it blends into the bezel). Add a 1px black top-edge overlay inset by `t` to seal the seam, plus `box-shadow`/SVG shadow `rgba(0,0,0,0.7)` radius 6.

### How it scales when the user changes width/height
- Recompute `d` every frame — W and H are free variables; `t`/`b` are **fixed constants**, not proportional, but the clamp above prevents overshoot on small pills. This is exactly what native does (radii are hardware-independent; only W/H come from the notch).
- Optional `cornerRadiusScaling` toggle (boring.notch, default on): only when true do the radii grow 6/14 → 19/24 on expand; when off they stay at 6/14.
- **Compact width** is content-derived, never a fixed literal in native: `notchWidth = screen.width − auxLeft − auxRight + 4`. On web there is no notch API — hardcode a base (185–224) and grow it per content (+ badge width `26 + 8·(digits−1)`).

### Pure-CSS fallback (only if you refuse SVG)
Convex bottom = `border-radius: 0 0 {b}px {b}px`. Concave top shoulders need a mask (border-radius can't do inverted corners):
```css
mask:
  radial-gradient(6px at top left,  #0000 98%, #000) top left,
  radial-gradient(6px at top right, #0000 98%, #000) top right;
mask-composite: intersect;
```
(`corner-shape: scoop` gives native concave corners but is Chrome-139+ only — do not rely on it.) **Recommendation: use SVG.** The CSS mask is hard to animate on width.

---

## 2. ANIMATION

### Morph springs — native and web cross-validate
Converting SwiftUI `response 0.42 / damping 0.8` to stiffness/damping (mass 1): `k = (2π/0.42)² ≈ 224`, `c = 2·0.8·√224 ≈ 24`. This **exactly matches Pillar's `default` spring (stiffness 220, damping 25)** — strong signal this is the right number.

| Transition | Native (response/damping) | Web equivalent to use |
|---|---|---|
| **Open** (calm) | 0.42 / 0.8 | `spring stiffness:220 damping:25 mass:1` · or `cubic-bezier(0.22,1,0.36,1)` ~420ms |
| **Close** | boring: 0.45 / 1.0 (critically damped, no bounce); island apps: smooth 0.3s | `cubic-bezier(0.4,0,0.2,1)` ~300ms |
| **Pop** (attention) | 0.3 / 0.5 (visible overshoot) | `spring 260/18` (Pillar bouncy) · or `cubic-bezier(0.34,1.56,0.64,1)` ~300ms |
| **Drag/resize** | interactiveSpring 0.38 / 0.8 | `spring 300/28 mass:0.8` (Pillar snappy) |

For a **no-library** mockup drive it with the Web Animations API (`element.animate([...], {easing:'cubic-bezier(0.34,1.56,0.64,1)', duration:420})`) or Motion One (`{type:'spring', stiffness:220, damping:25}`). cho.sh's canonical *content* spring is **stiffness 400 / damping 30** — use that for the inner crossfade, the calmer 220/25 for the container morph.

### The architecture rule (copy this — it's the #1 lesson)
**Never resize the outer container/window on a real timeline.** Native holds the NSPanel at fixed opened size and animates only SwiftUI opacity/scale/clip-radii; mixing AppKit frame animation with SwiftUI springs caused jank (documented in all three repos). On web: keep an outer fixed-max container, animate the SVG `d` + inner opacity/scale/`clip-path`. This avoids dual-timeline jitter.

### Staged content reveal (hides the width jump)
Stack old + new content as absolute layers, both on one spring:
- **Old exits:** `opacity 1→0, scale→0.9, filter blur(10px)`
- **New enters:** `opacity 0→1, scale 0.9→1`
- Use `matchedGeometryEffect`-style shared elements for the icon/badge that persist across states (island apps morph the glyph, not fade it).
- Stagger inner list items ~40–60ms. Set `will-change: transform, opacity; contain: layout style paint` on the pill; cap concurrent animations (Pillar `MAX_CONCURRENT_ANIMATIONS = 8`).

### Hover & attention
- **Hover scale `1.028`, anchor top**, spring `response 0.38 / damping 0.8`.
- **Hover-open delay `0.15s`** before expanding.
- **Pop scale `1.04`, anchor top**, pop spring above; pop also widens the pill +18px.
- All scaling anchored `.top` (transform-origin: top center) so it grows *downward* from the notch.
- Fluid closed-content width changes: `cubic-bezier(0.4,0,0.2,1)` 450ms (Material standard).

### Optional boot flourish (Pillar, worth copying)
8×8px radius-4 white dot → 200ms appear, 100ms delay, 600ms spring to full pill = 900ms total.

### Timing tokens & auto-dismiss
FAST 0.15s · MEDIUM 0.25s · SLOW 0.4s. Auto-dismiss timers: HUD 1.5s · download 2s · live-activity/notification 3s. Reduced-motion path: near-instant spring `{stiffness:1000, damping:100, mass:0.1}` or 0.1s easeOut.

---

## 3. CUSTOMIZATION SURFACE

### What real apps expose (evidence)
- **Native (all 3 islands): NO width/height/opacity** — geometry is 100% notch-derived. They expose only: height *mode* + slider (boring: **15–45** notch, **0–40** non-notch, default 32), `cornerRadiusScaling` toggle, shadow/lighting toggles, per-phase status colors, closed display style (minimal/detailed), hide-idle-to-edge (4px capsule), and the screen-recording toggle.
- **Pillar (web): DOES expose** mode (island vs notch), **opacity 0–100 (default 94)** applied to *surface fill rgba only, not the whole element*, accent color + 8 presets, album-accent pull, motion speed + reduced-motion override, module/indicator toggles. No width/height slider (computed per content).
- **NotchPrompter (web-portable):** width slider **150–600** (default 184), height **80–500** (default 150), position left/center/right, theme, screen-recording toggle. Its opacity setting is **stubbed/commented out** — a caution.

### Recommended knob set for syncfu
Because syncfu is plain HTML with no hardware notch, you *can* expose geometry that native can't. Ship this tight set:

| Knob | Range / default | Notes |
|---|---|---|
| **Width** | 120–640 px, default ~185 (closed) | Free on web; still let content auto-grow it |
| **Height** | 24–45 px, default 32–38 | Echo boring's 15–45; drives radius clamps |
| **Opacity / transparency** | 0–100, default **94** | Apply to **surface fill `rgba(20,20,22,α)`**, NOT the whole element (Pillar lesson; avoid NotchPrompter's stubbed mistake). Keep body dark |
| **Mode** | island \| notch | notch = flat-top corners flush to top edge; island = floating fully-rounded |
| **Corner-radius scaling** | on/off, default on | grow 6/14→19/24 on expand |
| **Accent color** | hex + presets | Pillar-style, for status/indicators only — body stays #000 |
| **Position anchor** | left \| center \| right | NotchPrompter; 20px min edge padding |
| **Reduced motion** | system \| on \| off | swaps to near-instant spring |
| **Hide from screen capture** | toggle, default on | see §5 — only works in a native/Tauri wrapper |

Keep per-status colors (running/waiting/completed) if syncfu shows agent/session state. Do **not** add speculative knobs beyond this.

---

## 4. MANY-NOTIFICATIONS MODEL

### What the researched apps do
| App | Model | Mechanics |
|---|---|---|
| **boring.notch** | Single-slot, latest-wins | New event overwrites the one slot; cancel-and-replace timer; auto-dismiss 1.5/2/3s. **No stacking, no badge.** |
| **open-island / open-vibe** | **Spotlight + count badge → scrollable list** | Rank by integer `displayPriority`, dedupe by live-attachment key. Closed: ONE spotlight glyph + `×N` / count badge (width `26 + 8·(digits−1)`). Open: ranked list capped **6 rows / 560px**, then scrolls. Notification cards (approval/question/completion) are single-item, auto-collapse on timeout or pointer-leave; newest **re-presents over** the current — never queued. |
| **open-vibe agent grid** | **Balanced status-dot matrix** | `balancedRows`: 1→[1],4→[2,2],6→[3,3],9→[3,3,3], ≥10→[4,4]. Tiles 8×8px (6×6 at 3 rows). States: running=full color, idle=22% opacity, waiting=pulse `0.35↔1 @0.7s ease-in-out`. Overflow: `prefix(7)` + one `+N` cell. |
| **Pillar** | **Grouped capped list + 9+ badge + absorb toast** | Group by app, sort by group size, slice 10/group, `max-h-52 overflow-y-auto`. Badge caps at `9+`. Transient toast: single most-recent, exits **upward** `y:-40, scale:0.4, opacity:0` (absorption spring 300/25). |

**Consensus: nobody stacks toasts.** Every mature app collapses concurrency into one spotlight + a count, or one grouped scrollable list.

### Recommendation for syncfu — mock up these 2
- **Model A (primary): Spotlight + count badge → ranked scrollable list.** This is the cross-app consensus (both island apps *and* Pillar's open state). Closed = highest-priority item + `×N`/`9+` badge; open = priority-ranked, deduped list capped ~6 rows then scroll. Reuse the absorb-upward toast (`y:-40, scale:0.4`) for transient single-item alerts.
- **Model B (secondary): balanced status-dot grid.** Best fit if syncfu surfaces many agents/sessions at a glance. Use the `balancedRows` lookup, 8px tiles (6px @3 rows), color-by-state, waiting pulse `0.35↔1 @0.7s`, `prefix(7)+"+N"`.

Avoid boring's pure single-slot (too lossy for syncfu's multi-session case) and avoid any infinite queue/stack.

---

## 5. SCREEN-SHARE INVISIBILITY

Confirmed primitive per OS (the whole feature is one window property):

| OS | Technique | Evidence / file |
|---|---|---|
| **macOS** | `NSWindow.sharingType = .none` (visible = `.readOnly`/`.readWrite`) | **NotchPrompter** `PrompterWindow.swift → updateScreenRecordingVisibility()`: `.none` when hidden, `.readOnly` when shown; wired via Combine `$hideFromScreenRecording`, **default true**. **boring.notch** `BoringNotchSkyLightWindow.swift → updateSharingType()`: `.none` vs `.readWrite`, key `hideFromScreenRecording` **default false**, live via Defaults.publisher. |
| **Windows** | `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` (Win10 2004+) | Documented in Pillar research (not implemented there). |
| **Cross-platform (Tauri v2)** | `window.set_content_protected(true)` → maps to macOS `NSWindowSharingNone` / Windows `WDA_EXCLUDEFROMCAPTURE` | Pillar research. |

**Critical caveats:**
- **open-island and open-vibe-island do NOT hide** — both set `sharingType = .readOnly`, which makes the overlay **visible/capturable** in screen shares. They are counter-examples, not references. Do not copy their panel setup for this feature.
- **Plain HTML/CSS in a browser has NO equivalent** — a web page cannot exclude itself from capture. For syncfu's *mockup* this is impossible in-browser; the real invisibility requires a native shell or a **Tauri wrapper calling `set_content_protected(true)`**. Flag this in the mockup as a wrapper-only capability (expose the toggle in the UI, note it no-ops in pure web).
- boring.notch also hosts the notch on a private SkyLight space (`CGSSpace(level: 2147483647)`, `SLSRemoveWindowsFromSpaces`) — orthogonal to capture-hiding, not needed for syncfu.

---

### Cross-reference summary for the build
- **Shape:** SVG path above, radii closed 6/14 → open 19/24, control-point-at-corner. Solid `#000`.
- **Morph:** container spring 220/25 (=native 0.42/0.8); content spring 400/30; pop 260/18; never resize the outer box on a real timeline.
- **Customize:** width, height, opacity(→surface-fill α, default 94), mode, corner-scaling, accent, position, reduced-motion, hide-from-capture.
- **Many:** spotlight + count → scrollable ranked list (primary); balanced dot grid (secondary); no toast stacks.
- **Invisibility:** macOS `sharingType=.none` / Windows `WDA_EXCLUDEFROMCAPTURE` / Tauri `set_content_protected(true)`; impossible in pure browser.

---

# Appendix: per-source findings

## github.com/jpomykala/NotchPrompter (Swift/AppKit/SwiftUI macOS app). Key files: notch-prompter/PrompterWindow.swift, PrompterView.swift, PrompterViewModel.swift, SettingsView.swift, NotchPrompterApp.swift. Verified via raw.githubusercontent.com at HEAD.

### exists
true

### stack
Native macOS app: Swift + SwiftUI content hosted in an AppKit NSWindow via NSHostingView. MenuBarExtra + Settings scene app (LSUIElement/accessory activation policy). No web tech. This is a teleprompter that hangs BELOW the notch, not a Dynamic Island reimplementation.

### notch_shape
There is NO concave shoulder/fillet and NO Dynamic-Island morph shape. The window is a plain rounded-BOTTOM rectangle that hangs down from the top screen edge, tucked under the physical notch/menu bar. Shape is done with SwiftUI clipShape in PrompterWindow.swift init:

    let contentView = PrompterView(viewModel: viewModel)
        .clipShape(UnevenRoundedRectangle(
            topLeadingRadius: 0,
            bottomLeadingRadius: 16,
            bottomTrailingRadius: 16,
            topTrailingRadius: 0
        )).border(Color.black.opacity(0.0), width: 0)

    let hosting = NSHostingView(rootView: contentView)
    hosting.wantsLayer = true
    hosting.layer?.masksToBounds = true

So: top corners radius 0 (flat, hidden behind notch), bottom corners radius 16. No SVG path, no CSS mask, no concave fillet drawing. The window chrome that makes it read as a notch: styleMask [.borderless]; isOpaque=false; backgroundColor=.clear; window.level=.statusBar; hasShadow=false ('true adds a little cool effect, but it's not needed for Notch type app'); collectionBehavior=[.canJoinAllSpaces, .fullScreenAuxiliary].

ANCHORING (topCenterFrame in PrompterWindow.swift): x = screen.frame.minX + 20 padding + availableWidth * alignmentPosition (left=0.0/center=0.5/right=1.0); availableWidth = screen.frame.width - width - 40. Vertical tuck trick: `let heightOfBorderTopWithRadiusToHide: CGFloat = 4; let y = screen.frame.maxY - height + heightOfBorderTopWithRadiusToHide` — it pushes the window UP by 4px so the flat top edge / any top corner radius hides under the notch/menu bar.

### expand_animation
No compact-to-expanded morph. The only animation is a vertical SLIDE (drop-down / retract) driven by NSWindow frame animation. `private let animationSpeed = 0.25`.
SHOW (animateShow): finalFrame = topCenterFrame; startFrame = finalFrame with origin.y = screen.frame.maxY (fully above/off the top edge); window.setFrame(startFrame, display:false); orderFront; then NSAnimationContext.runAnimationGroup { context.duration = 0.25; context.timingFunction = CAMediaTimingFunction(name: .easeOut); window.animator().setFrame(finalFrame, display:true) }.
HIDE (animateHide): animate origin.y up to screen.frame.maxY with duration 0.25, timingFunction .easeIn, completionHandler orderOut(nil).
Resize on width/height/screen/alignment changes uses window.setFrame(frame, display:true, animate:true) (default AppKit resize animation). Hover controls overlay uses .animation(.easeInOut(duration: 0.2)) with .transition(.opacity.combined(with:.scale(scale:0.95))).

### customization
All in SettingsView.swift + PrompterViewModel.swift @Published defaults, persisted to UserDefaults.
WIDTH: SettingSlider range 150...600, step 10, unit px; default prompterWidth=184 (ViewModel L43/287).
HEIGHT: range 80...500, step 10, px; default prompterHeight=150 (L44/289).
OPACITY: NOT functional. A UserDefaults key exists (Keys.opacity = 'PrompterOpacity', L98) but the modifier is commented out in PrompterContentView: `// .opacity(viewModel.opacity) TODO: it would be better to control background and text opacity separatly, or just background opacity`. No @Published opacity var wired. So opacity is dead/unimplemented.
POSITION: horizontalAlignment enum left/center/right (Picker); selectedScreenIndex Picker for multi-monitor (getSelectedScreen validates bounds, falls back to NSScreen.main).
THEME: prompterTheme Picker, default .dark (PrompterTheme provides backgroundColor/textColor/fadeColor).
FADES: enableTopFade/enableBottomFade toggles; topFadeHeight/bottomFadeHeight default 40, slider step 5 (LinearGradient overlays).
TEXT/SCROLL: fontSize default 10, speed default 12, lineHeight default 8, fontDesign default .monospaced, textAlignment, speedIncrement default 2, manualScrollAmount default 50, pauseOnHover default true, showHoverControls, showProgressBar, voiceActivation (mic VAD), enableGlobalKeyboardShortcuts.
PRIVACY: hideFromScreenRecording toggle, default true.

### multi_notification
Not applicable / none. This is a single-buffer scrolling teleprompter, not a notification system. There is no queue, stack, badge, or cycling of concurrent items. PrompterContentView renders ONE Text (viewModel.text) that scrolls via an offset (viewModel.offset). ScriptTab.swift exists for managing multiple saved SCRIPTS (tabs the user switches between), but only one is shown at a time — not concurrent overlays.

### screen_share
FOUND. File: notch-prompter/PrompterWindow.swift, method `updateScreenRecordingVisibility(_ hideFromRecording: Bool)`:

    private func updateScreenRecordingVisibility(_ hideFromRecording: Bool) {
        // https://developer.apple.com/documentation/appkit/nswindow/sharingtype-swift.property
        if hideFromRecording {
            window.sharingType = .none
        } else {
            window.sharingType = .readOnly
        }
    }

It uses NSWindow.sharingType: `.none` makes the window invisible to screen capture / screen sharing; `.readOnly` (the normal capturable state) when disabled. It is wired reactively via Combine (viewModel.$hideFromScreenRecording sink) AND called once at init with the current value. Default hideFromScreenRecording = true (PrompterViewModel.swift L55), so it hides from recordings out of the box. User toggle in SettingsView.swift L468 'Hide from screen recordings — Prevent the prompter from appearing in screen shares' (checkbox).

### compact_geometry
No notch-dimension detection at all. The app does NOT read NSScreen safeAreaInsets or auxiliaryTopLeftArea/auxiliaryTopRightArea to measure the physical notch. Width and height are purely user-set sliders (default 184x150). It just anchors to top-center of the chosen screen and offsets UP by a hardcoded 4px (heightOfBorderTopWithRadiusToHide) so the flat top edge tucks behind the menu bar / notch. There is no compact 'pill' state vs expanded state — the window is always the user-sized rectangle; visibility is binary (slid in / slid out).

### web_reusable
Directly portable to plain HTML/CSS/JS:
1) Shape: a fixed, top-center div with `border-radius: 0 0 16px 16px;` (flat top, 16px bottom corners), background black, no shadow. Position with `top:0; left:50%; transform:translateX(-50%);` and for the tuck-trick pull up ~4px (`margin-top:-4px`).
2) Drop-in/retract animation: translateY from -100% (above viewport) to 0 over 0.25s; show uses ease-out, hide uses ease-in — e.g. `transition: transform 0.25s cubic-bezier(0,0,0.58,1);` show, `ease-in` on hide.
3) Left/center/right anchoring = change the horizontal translate/justify with a 20px min edge padding.
4) Fade overlays = top/bottom `linear-gradient` masks at 40px height.
5) Hover controls = fade+scale(0.95) transition over 0.2s.
NOT portable: sharingType=.none screen-capture invisibility has no web equivalent; NSWindow statusBar level / canJoinAllSpaces are OS-only.

### takeaways
- Screen-share hiding = one line: window.sharingType = .none (vs .readOnly). Default ON. In PrompterWindow.swift.
- Notch 'shape' is just UnevenRoundedRectangle(top 0/0, bottom 16/16) clipShape + layer.masksToBounds — no concave fillet, no SVG/mask.
- Tuck-under-notch trick: y = screen.frame.maxY - height + 4 (hardcoded 4px) hides the flat top edge behind the menu bar/notch.
- Slide animation: 0.25s, easeOut on show / easeIn on hide, animating NSWindow frame origin.y from screen.frame.maxY.
- Window chrome for a floating notch feel: borderless + isOpaque=false + clear background + level=.statusBar + hasShadow=false + collectionBehavior [.canJoinAllSpaces,.fullScreenAuxiliary].
- No notch measurement, no compact/expand morph, no multi-notification queue — width/height are plain user sliders (default 184x150, ranges 150-600 / 80-500). Opacity setting is stubbed/commented out.

## github.com/TheBoredTeam/boring.notch (default branch HEAD, fetched raw). Key files: boringNotch/components/Notch/NotchShape.swift, boringNotch/sizing/matters.swift, boringNotch/models/Constants.swift, boringNotch/ContentView.swift, boringNotch/models/BoringViewModel.swift, boringNotch/BoringViewCoordinator.swift, boringNotch/animations/drop.swift, boringNotch/components/Notch/BoringNotchWindow.swift, boringNotch/components/Notch/BoringNotchSkyLightWindow.swift, boringNotch/managers/NotchSpaceManager.swift, boringNotch/components/Settings/SettingsView.swift, boringNotch/enums/generic.swift, boringNotch/models/SharingStateManager.swift

### exists
true

### notch_shape
CONFIRMED — it is a custom SwiftUI `Shape` in NotchShape.swift (derived from MrKai77/DynamicNotchKit). It takes TWO radii: `topCornerRadius` (default 6) and `bottomCornerRadius` (default 14). The magic is that the TOP corners are CONCAVE fillets (the "shoulder" that flares the black out to the screen edge) and the BOTTOM corners are CONVEX rounds. All corners are single quadratic Béziers (`addQuadCurve`), no arcs. Exact path (rect = drawn notch bounds):

  path.move(to: (minX, minY))                                              // top-left, flush to screen edge
  // CONCAVE top-left shoulder — control sits at the OUTER corner:
  path.addQuadCurve(to: (minX + top,        minY + top),
                    control:(minX + top,     minY))
  path.addLine(to: (minX + top,             maxY - bottom))               // left wall
  // CONVEX bottom-left — control at outer bottom corner:
  path.addQuadCurve(to: (minX + top + bottom, maxY),
                    control:(minX + top,       maxY))
  path.addLine(to: (maxX - top - bottom,      maxY))                      // bottom edge
  // CONVEX bottom-right:
  path.addQuadCurve(to: (maxX - top,          maxY - bottom),
                    control:(maxX - top,       maxY))
  path.addLine(to: (maxX - top,               minY + top))                // right wall
  // CONCAVE top-right shoulder:
  path.addQuadCurve(to: (maxX, minY),
                    control:(maxX - top,       minY))
  path.addLine(to: (minX, minY))                                          // close top

The concave top corners work because for the top curve the control point is pulled to the outer corner (minX+top,minY)/(maxX-top,minY) while endpoints are inset+down, producing an inward-curving fillet; the bottom uses the mirror arrangement for a normal outward round. Radii are animatable via `var animatableData: AnimatablePair<CGFloat,CGFloat>` mapping (top, bottom) so the shoulders morph smoothly. Actual radius values come from `cornerRadiusInsets` in matters.swift: opened = (top: 19, bottom: 24), closed = (top: 6, bottom: 14). In ContentView the shape is chosen live: topCornerRadius = (open && Defaults[.cornerRadiusScaling]) ? 19 : 6; bottom = ...? 24 : 14. Applied as `.background(.black).clipShape(currentNotchShape)` plus a 1px black Rectangle overlay at top (padded horizontally by topCornerRadius) to seal the seam against the bezel, and a `.shadow(color: .black.opacity(0.7), radius: cornerRadiusScaling ? 6 : 4)`. There is a separate simpler `BottomRoundedRectangle` shape (arcs, only bottom rounded) used elsewhere.

### expand_animation
CONFIRMED, all in ContentView.swift and drop.swift. Two distinct springs keyed on notchState:
  openAnimation  = Animation.spring(response: 0.42, dampingFraction: 0.8, blendDuration: 0)
  closeAnimation = Animation.spring(response: 0.45, dampingFraction: 1.0, blendDuration: 0)   // critically damped, no overshoot on close
applied as `.animation(vm.notchState == .open ? openAnimation : closeAnimation, value: vm.notchState)`.
A separate interactive spring for drag/resize movement: `Animation.interactiveSpring(response: 0.38, dampingFraction: 0.8, blendDuration: 0)`.
Gesture progress uses `.animation(.smooth, value: gestureProgress)`.
Library default (BoringAnimations.animation in drop.swift): macOS 14+ → `Animation.spring(.bouncy(duration: 0.4))`; older → `Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.7)` (an ease-out-expo curve).
The morph is driven purely by state change: open() sets notchSize = openNotchSize (640×190) and notchState = .open; the frame height animates (`.frame(height: open ? notchSize.height : nil)`) while clipShape's radii animate via animatableData, so size + corner radius interpolate together for the fluid expand. Pinch/scale on gesture: gestureScale = 1.0 + gestureProgress*0.01, clamped `max(0.6, …)`, `.scaleEffect(anchor: .top)`. Haptics via `.sensoryFeedback(.alignment, trigger:)`.

### customization
CONFIRMED from Constants.swift (Defaults.Keys) + SettingsView.swift. There is NO width and NO opacity user setting — width is always auto-derived from the physical notch (see compact_geometry). Size/appearance options exposed:
- notchHeightMode (WindowHeightMode: .matchRealNotchSize default / .matchMenuBar / .custom) for notch displays; nonNotchHeightMode (default .matchMenuBar) for non-notch displays.
- Custom height sliders: notch displays `Slider(value: $notchHeight, in: 15...45, step: 1)`; non-notch `Slider(value: $nonNotchHeight, in: 0...40, step: 1)`. Mode-switch presets set notchHeight to 38/44/38 and nonNotchHeight to 24/32/32.
- notchHeight / nonNotchHeight defaults both 32.
- cornerRadiusScaling (Bool, default true) — toggles whether the corner radii grow to the opened 19/24 set when expanded (visual only).
- enableShadow (default true), lightingEffect (default true).
- showOnAllDisplays (default false) + per-display preferred_screen_uuid selection + automaticallySwitchDisplay.
- Behavior: openNotchOnHover, minimumHoverDuration (Slider 0...1), extendHoverArea, enableGestures, gestureSensitivity (Slider 100...300 step 100), closeGestureEnabled.
- hideTitleBar (default true) controls the "chin" fill below the notch.
No opacity/blur/tint of the notch body itself (it is hardcoded `.black`); only player/HUD tinting toggles (playerColorTinting, coloredSpectrogram, sliderColor).

### multi_notification
CONFIRMED — there is NO real queue or stack; it is single-slot, latest-wins, with auto-dismiss timers. Two independent channels in BoringViewCoordinator:
1. `sneakPeek` (struct: show/type/value/icon) for brightness/volume/mic/music/backlight HUD peeks. A new toggleSneakPeek overwrites the current one; its didSet schedules `scheduleSneakPeekHide(after:)` which cancels the prior Task and hides after `sneakPeekDuration` (default 1.5s, param default 1.5). 
2. `expandingView` (ExpandedItem: show/type/value/browser) for battery + download live activities. didSet cancels prior expandingViewTask and schedules hide after `type == .download ? 2 : 3` seconds.
Because each is one struct slot guarded by a cancel-and-replace DispatchWorkItem/Task, concurrent events do not stack or badge — the newest event simply replaces whatever was showing. Multiple simultaneous downloads are aggregated inside DownloadView/DownloadListener rather than as separate notch cards. Priority is by if/else ordering in NotchLayout (battery expandingView > inline HUD sneakPeek > music live activity > face). No scroll/cycle/count-badge mechanism for many notifications.

### screen_share
CONFIRMED, strong. Screen-capture invisibility is a real feature via NSWindow `sharingType`. In BoringNotchSkyLightWindow.swift `updateSharingType()`: `if Defaults[.hideFromScreenRecording] { sharingType = .none } else { sharingType = .readWrite }`, wired to a Defaults.publisher so it toggles live. Setting key: `hideFromScreenRecording` (Bool, default false). Additionally the app uses Apple's private SkyLight framework to host the notch on a dedicated space: `SkyLightOperator.shared.delegateWindow(self)` to add, and a dlopen/dlsym of `SLSRemoveWindowsFromSpaces` (SkyLight.framework) to remove. NotchSpaceManager creates `CGSSpace(level: 2147483647)` (max). The panel is an NSPanel: level `.mainMenu + 3`, isFloatingPanel, isOpaque false, backgroundColor .clear, hasShadow false, collectionBehavior [.fullScreenAuxiliary, .stationary, .canJoinAllSpaces, .ignoresCycle], canBecomeKey/Main false, forced `.darkAqua` appearance.

### compact_geometry
CONFIRMED in matters.swift getClosedNotchSize(). Notch DETECTION: `screen.safeAreaInsets.top > 0` means the display physically has a notch. WIDTH is measured from the real notch, not hardcoded: `notchWidth = screen.frame.width - screen.auxiliaryTopLeftArea.width - screen.auxiliaryTopRightArea.width + 4` (the +4 is a fudge to slightly overlap the bezel); fallback constant `185` if auxiliary areas are nil. HEIGHT: if notched and mode == .matchRealNotchSize → `screen.safeAreaInsets.top`; mode == .matchMenuBar → `screen.frame.maxY - screen.visibleFrame.maxY`; else custom `Defaults[.notchHeight]`. Non-notch displays use nonNotchHeight/nonNotchHeightMode (default match menubar). Opened size constants: `openNotchSize = 640×190`, `shadowPadding = 20`, `windowSize = 640×210`. Music art sizes: opened 90×90 / closed 20×20, corner-radius inset opened 13 / closed 4. `effectiveClosedNotchHeight` collapses to 0 when hidden-on-fullscreen and no physical notch. Hover hit-test (isMouseHovering) builds a rect at screen top-center of width notchSize.width.

### web_reusable
The NotchShape path ports 1:1 to an SVG `<path>` or Canvas — reuse the exact 8 segments (4 quad curves + 4 lines) with top=6/bottom=14 closed and top=19/bottom=24 open. In pure CSS the convex bottom corners are just `border-bottom-left/right-radius`, but the CONCAVE top shoulders cannot be done with border-radius; the standard trick is two pseudo-elements at the top-left/right using a `radial-gradient` mask (or SVG mask) to carve the inward fillet — or simplest, render the whole notch as one inline SVG path and animate the `d`/radii. Directly portable numbers: open spring response 0.42 damping 0.8; close response 0.45 damping 1.0; interactive-move response 0.38 damping 0.8 — map to CSS via a spring-to-cubic-bezier generator or a JS spring (Framer Motion `type:'spring', stiffness/damping` or Motion One). Morph = animate width 185→640 and height →190 together with corner radii 6/14→19/24. Body is solid #000 with a 0.7-opacity black drop shadow (radius 6). Auto-dismiss timers: HUD 1.5s, download 2s, other live-activity 3s. Scale-on-drag: scale = 1 + progress*0.01 clamped to 0.6, transform-origin top.

### takeaways
- Notch shape = custom Shape, 2 radii only: closed (top 6, bottom 14), open (top 19, bottom 24). Top corners are CONCAVE quad-curve fillets (control point at outer corner), bottom corners convex — 8 segments total.
- Open spring: response 0.42 / damping 0.8. Close spring: response 0.45 / damping 1.0 (critically damped, no bounce). Drag-move: interactiveSpring response 0.38 / damping 0.8.
- Opened notch = 640×190; windowSize 640×210 (+20 shadow pad). Closed width auto-measured: frame.width - auxiliaryTopLeftArea.width - auxiliaryTopRightArea.width + 4, fallback 185.
- Physical-notch detection = screen.safeAreaInsets.top > 0; real notch height = safeAreaInsets.top (matchRealNotchSize mode).
- Screen-share invisibility = NSWindow.sharingType = .none when hideFromScreenRecording is on, plus SkyLight private-framework space hosting and CGSSpace(level: 2147483647).
- No opacity/width user settings and no notification stacking — notifications are single-slot latest-wins with 1.5s/2s/3s auto-dismiss timers; height is the only real size customization (sliders 15-45 notch, 0-40 non-notch).

### stack
SwiftUI + AppKit (NSPanel), macOS 14+. Uses sindresorhus/Defaults for settings, SkyLightWindow + private SkyLight/CoreGraphics (CGSSpace, SLSRemoveWindowsFromSpaces) for space placement, SwiftUIIntrospect, KeyboardShortcuts. Notch is a borderless NSPanel at level .mainMenu+3 rendering a SwiftUI ContentView clipped to the custom NotchShape.

## Multi-source web research: (1) github.com/warpirate/pillar-dynamic-island-for-windows (Tauri+React, real source read via gh api); (2) cho.sh/w/9F7F85 'Recreating the Dynamic Island'; (3) amelieschlueter.com + github.com/amelie-schlueter/dynamic-island-web; (4) css-tip.com/inverted-radius + css-tricks cut-corners for concave-shoulder CSS; (5) uiuxtrend/infinum/Apple-design articles for real DI geometry.

### exists
true

### notch_shape
KEY FINDING: NONE of the researched web implementations actually draw the concave "shoulder" fillet (the inverted radius where black flares into the screen edge). They all fake it. Pillar (Pill.tsx L520-530) uses a plain rounded rect with independently-sprung top vs bottom radii: `borderRadius = useTransform([top,bottom], ([t,b]) => `${t}px ${t}px ${b}px ${b}px`)`. In "notch" mode it sets `borderRadiusTop.set(isNotch ? 0 : radius)` and keeps `borderRadiusBottom` rounded (L549-550, 564-565, 572-573, 599-600) — i.e. flat top edge flush to screen, rounded bottom only. No concave fillet at all. cho.sh instead swaps standard border-radius for SVG squircle clipPath via tienphaw/figma-squircle for corner fidelity during morph.

To ACTUALLY draw concave top shoulders in pure CSS, the portable technique is a radial-gradient mask that subtracts a circle from each top corner. Simplest single-corner cut (css-tricks): `mask: radial-gradient(40px at top right, #0000 98%, #000);`. Full inverted-radius recipe (css-tip.com/inverted-radius) with tunable radius `--r` and inner-curve size `--s`:
```
--r: 25px; --s: 40px;
border-radius: var(--r);
--_m:/calc(2*var(--r)) calc(2*var(--r)) radial-gradient(#000 70%,#0000 72%) no-repeat;
mask:
  right calc(var(--s) + var(--r)) top 0 var(--_m),
  right calc(var(--s) + var(--r)) var(--_m),
  radial-gradient(var(--s) at 100% 0,#0000 99%,#000 calc(100% + 1px)) calc(-1*var(--r)) var(--r) no-repeat,
  conic-gradient(at calc(100% - var(--s) - 2*var(--r)) calc(var(--s) + 2*var(--r)), #0000 25%,#000 0);
```
For a dynamic-island pill with two top shoulders, the pragmatic approach is two `::before`/`::after` pseudo-elements sitting just outside each top corner, each filled the same black and masked with `radial-gradient(circle at top-outer-corner, transparent Rpx, black R+1px)` so the transparent quarter-circle carves the concave fillet; OR one SVG path using arcs: outer stadium body plus two small reverse-sweep arcs (sweep-flag flipped) at the top-left/top-right where it meets the bezel. Newer option: CSS `corner-shape: scoop` (Chrome 139+, 2025) with negative-style corners — `border-top-left-radius` + `corner-shape: scoop` gives a true concave corner natively, but browser support is too thin to rely on. Recommended for a mockup: SVG path with two inverted arc segments (crispest, resolution-independent) or the radial-gradient pseudo-element pair (easiest to animate width).

### expand_animation
THREE distinct spring recipes found:

1. cho.sh/w/9F7F85 (the canonical tutorial): "the golden ratio was const stiffness = 400 and const damping = 30". Per-content crossfade uses Framer Motion: enter `initial{opacity:0,scale:0.9}` -> `animate{opacity:1,scale:1, transition:{type:'spring',stiffness:400,damping:30}}`, exit `{opacity:0, filter:'blur(10px)', scale:0}`. Uses `will-change` so browser rasterizes only after animation. Six sizes: compact, minimalLeading, minimalTrailing, default, long, large, ultra. Corner fidelity via figma-squircle clipPath instead of border-radius during morph.

2. amelieschlueter.com / amelie-schlueter/dynamic-island-web: `transition = { type:'spring', duration:0.3, stiffness:110, damping:12 }` applied to Framer Motion `layout` — softer, bouncier morph across 3 states (default/event/call).

3. Pillar (animations.ts) — full spring token set, verbatim:
- default: spring stiffness:220 damping:25 mass:1
- snappy: stiffness:300 damping:28 mass:0.8  (primary pill resize + expand — springConfig.bouncy actually used on the outer mount)
- gentle: stiffness:180 damping:22 mass:1.2
- bouncy: stiffness:260 damping:18 mass:1 (outer container mount transition)
- notification spring: stiffness:400 damping:30 mass:0.8; absorptionSpring: stiffness:300 damping:25 mass:1
- idle-slot transition: stiffness:520 damping:36
Boot sequence (bootAnimationDuration): dotAppear 200ms, dotToMorphDelay 100ms, morphToPill 600ms, total 900ms — starts as an 8x8px radius-4 dot (radial-gradient white) then springs to the 120x36 pill. width/height/radius each driven by separate Framer `useSpring`. Durations: FAST 0.15s, MEDIUM 0.25s, SLOW 0.4s. Reduced-motion path swaps to near-instant spring `{stiffness:1000,damping:100,mass:0.1}` or 0.1s easeOut. MAX_CONCURRENT_ANIMATIONS = 8 (frame-budget guard).

### customization
Pillar (useAppearance.ts) exposes a small settings surface persisted to a Rust/Tauri backend via `load_settings`/`save_settings` (draft/save/reset/discard editing model):
- mode: "island" | "notch"  (notch = flat top corners flush to screen; island = fully rounded floating pill). Implemented purely by zeroing top border-radius in notch mode.
- opacity: number 0-100 (default 94). Applied in themeTokens.ts: `surfacePrimary = rgba(20,20,22, opacity/100)`, secondary at `min(1, opacity*0.95)`. Note it only tints the surface fills, not the whole element opacity.
- accentColor: hex (default #EB0028) with 8 ACCENT_PRESETS (Red/Blue/Green/Purple/Orange/Cyan/Pink/White); `accentSoft = color-mix(in srgb, accent 25%, transparent)`.
- useAlbumAccent: bool — pull accent from currently-playing album art (Rust `extract_accent_color` returns {r,g,b}).
- layout.visible_tabs + layout.idle_indicators toggles (which modules/indicators show: timer/media/notifications/settings/prism/productivity; idle indicators media/battery/notifications).
- motion.animation_speed (1.0) and motion.reduced_motion_override "system"|"on"|"off".
NO user-facing width/height slider — pill size is derived automatically from active content (getPillTargetStyle adds width per indicator: +32 media, +28/40 battery, +50/40 notifications). Position is fixed top-center (not user-movable in the settings model shown).

### multi_notification
Pillar handles concurrency three ways (NotificationModule.tsx):
- Compact badge: a count pill capped at "9+" — `count > 9 ? "9+" : count` (L135); hidden when count 0. Animated in with badge spring (scale 0->1).
- Toast (transient, below pill): single most-recent toast, `initial{y:30,opacity:0,scale:0.85} animate{y:0,opacity:1,scale:1} exit{y:-40,opacity:0,scale:0.4}` — an "absorption" upward-shrink exit back into the pill, using absorptionSpring (300/25/1).
- Expanded list: notifications are GROUPED by app name (`groupedNotifications`), each group sorted by size (`groupedList = entries.sort((a,b)=>b[1].length-a[1].length)`), each group capped at showing `.slice(0,10)` items with a `{appNotifications.length}` count header; scroll container `max-h-52 overflow-y-auto`. Bulk actions: dismiss-per-app slices first 20; "clear old" filters notifications older than 10 min and slices 15. No infinite queue — it's a grouped, capped, scrollable list plus a 9+ badge. New-notification pulse: `scale:[1,1.15,1]` keyframe.

### screen_share
NOT IMPLEMENTED in Pillar. Grep across src-tauri/src/platform/{macos,windows,linux}.rs, lib.rs, main.rs for sharingType / NSWindowSharingNone / SetWindowDisplayAffinity / WDA_EXCLUDEFROMCAPTURE / content_protect / display_affinity returned zero matches — the window is an always-on-top layered/transparent Tauri webview but is NOT excluded from screen capture. For a real implementation the standard hooks are: macOS `NSWindow.sharingType = .none` (or Tauri v2 `window.set_content_protected(true)` which maps to it); Windows `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` (Win10 2004+) — also exposed via Tauri `set_content_protected(true)`. None of the web/CSS demos (cho.sh, amelie) address capture invisibility since they are ordinary web pages.

### compact_geometry
Pillar compact/idle geometry (animations.ts pillDimensions, logical px, Tauri LogicalSize DPI-aware):
- boot dot: 8x8, radius 4
- idle: 120x36, radius 18 (radius = height/2 => true stadium)
- idleWithBattery: 148x36; idleWithNotifications: 170x36; idleWithBatteryAndNotifications: 196x36
- hover: 160x40 radius 20; hoverWithBattery 200x40; hoverWithNotifications 200x40; both 240x40
- expanded: 380x340, radius 28
Width is computed, not fixed: getPillTargetStyle(base) + (media?+32) + (battery?+28 idle/+40 hover) + (notifications?+50 idle/+40 hover), minus 2 when battery+notifications share the right slot in idle. Blur/shadow also state-driven: idle blur 10 shadow 0.2, hover 14/0.25, expanded 20/0.35 (though the actual CSS uses a static `blur(12px)` backdrop-filter to avoid per-frame Gaussian recompute).

"Notch detection": Pillar does NOT detect a physical notch — it has no hardware notch (Windows/desktop). "notch mode" is just a cosmetic toggle that squares the top corners. Real Apple geometry (design-article sourced, approximate/scaled, not authoritative): compact island ~ 122-126pt wide x 37.33pt tall; the camera/black box corner radius commonly cited as 40px; pill uses continuous (squircle) corners with radius ≈ height/2 so it reads as a stadium; sits ~11pt below the top bezel. Different articles quote wildly different scaled pixel numbers (e.g. 767x108 r132 for a full-width 3x render) so treat the ratio (radius = height/2, continuous corner) as the reliable invariant rather than any single px figure.

### web_reusable
Directly portable to a plain HTML/CSS/JS mockup:
1. Stadium pill = `border-radius: 999px` (or height/2) on a dark `rgba(20,20,22,0.94)` element; Pillar's exact fill is `linear-gradient(135deg, #141416 0%, #1e1e23 60%, rgba(15,15,18,0.95) 100%)` + `1px solid rgba(255,255,255,0.12)` border + `backdrop-filter: blur(12px)` + top inner-glow `linear-gradient(180deg, rgba(255,255,255,0.08), transparent 50%)` overlay.
2. Notch mode = animate top-left/top-right radius to 0 while keeping bottom radius (two independent radius values in one border-radius string) — cheap flush-to-edge look without concave math.
3. Concave shoulders (the part Pillar skips) = radial-gradient mask: `mask: radial-gradient(Rpx at top left,#0000 98%,#000) top left, radial-gradient(Rpx at top right,#0000 98%,#000) top right; mask-composite: intersect;` OR two absolutely-positioned pseudo-element quarter-circles. Or an SVG path with reverse-sweep arcs for crispness.
4. Morph without a library: `transition: width .4s, height .4s, border-radius .4s` won't give spring feel — use a Web Animations API spring or a JS spring (e.g. easing `cubic-bezier(0.34,1.56,0.64,1)` approximates the overshoot). To match cho.sh, use Motion One (framer-motion's vanilla sibling) with `{type:'spring',stiffness:400,damping:30}`.
5. Content crossfade during resize: absolutely-stack old+new content, fade old `opacity:1->0 scale:0.9 blur(10px)`, fade new `opacity:0->1 scale:0.9->1`, both on the same spring — this is the trick that hides the width jump.
6. Multi-notification: grouped, capped list + `9+` badge + upward-absorb toast exit (`y:-40,scale:0.4,opacity:0`).
7. GPU: `will-change:transform,opacity; backface-visibility:hidden; contain:layout style paint` on the pill; cap concurrent animations.

### stack
Pillar: Tauri v2 (Rust backend, transparent always-on-top webview) + React + `motion/react` (Framer Motion v11+) + Tailwind. State via hooks (usePillState, useAppearance), settings persisted through Tauri invoke. cho.sh + amelie demos: Next.js + Framer Motion + Tailwind. Concave-corner CSS technique is framework-agnostic (pure CSS mask / SVG). Native corner-shape:scoop is Chrome 139+ (2025) only.

### takeaways
- Spring numbers to copy: cho.sh canonical = stiffness 400 / damping 30; amelie (softer/bouncier) = layout spring duration 0.3 / stiffness 110 / damping 12; Pillar primary = 300/28/mass 0.8 (snappy) and 260/18/mass 1 (bouncy mount).
- Compact pill = 120x36 with radius 18 (radius = height/2 -> stadium). Expanded = 380x340 radius 28. Width is COMPUTED per active indicator (+32 media, +28..40 battery, +50 notifications), never a fixed slider.
- The concave 'shoulder' is faked everywhere: Pillar just zeroes the top border-radius in notch mode; cho.sh swaps to figma-squircle clipPath. To draw a REAL concave fillet use radial-gradient mask `radial-gradient(Rpx at top right,#0000 98%,#000)` per corner, or SVG reverse-sweep arcs, or corner-shape:scoop (Chrome 139+ only).
- Content-swap trick that hides the resize jump: stacked absolute layers, old exits `opacity:0 scale:0.9 filter:blur(10px)`, new enters `scale:0.9->1 opacity:0->1`, both on one spring + `will-change`.
- Multi-notification pattern: 9+ capped badge, grouped-by-app scrollable list (each group sliced to 10, sorted by size), and an upward 'absorb' toast exit `{y:-40, scale:0.4, opacity:0}` with a 300/25 absorption spring.
- Screen-share invisibility is NOT done in any web demo or in Pillar; the native primitive is Tauri `set_content_protected(true)` -> macOS NSWindowSharingNone / Windows WDA_EXCLUDEFROMCAPTURE.
- Boot flourish worth copying: start as an 8x8 radius-4 white radial-gradient dot, spring to full pill over 900ms (dot 200ms, delay 100ms, morph 600ms).

## github.com/8676311081/open-island (Swift/SwiftUI, GPL-3.0, macOS AI-coding notch companion; a fork/enhancement of open-vibe-island). Verified real via gh api. Key files read: Sources/OpenIslandApp/NotchShape.swift, IslandChromeMetrics.swift, IslandSurface.swift, Views/IslandPanelView.swift (2095 lines), Views/AppearanceSettingsPane.swift, OverlayPanelController.swift (896 lines), AppModel.swift (1475 lines), docs/notch-surface-model.md.

### exists
true

### notch_shape
Shape is a hand-built SwiftUI `Shape` (NOT CSS/SVG/mask) in Sources/OpenIslandApp/NotchShape.swift. It is a `struct NotchShape: Shape` with two params `topCornerRadius` and `bottomCornerRadius`, both driven by `AnimatablePair<CGFloat,CGFloat>` via `animatableData` so radii tween during expand.

The concave top "shoulder" fillets (where black flares out into the screen bezel) are drawn with `addQuadCurve` whose CONTROL point sits AT the top edge corner, producing an inward/concave quarter-curve. Exact path logic (`func path(in rect:)`):
- `let topR = min(topCornerRadius, rect.width/4, rect.height/4)`
- `let botR = min(bottomCornerRadius, rect.width/4, rect.height/2)`
- move to (minX, minY)  // top-left, flush to screen edge
- TOP-LEFT concave shoulder: `addQuadCurve(to: (minX+topR, minY+topR), control: (minX+topR, minY))`  // control at top edge => concave fillet
- line down left edge to (minX+topR, maxY-botR)
- BOTTOM-LEFT convex round: `addQuadCurve(to: (minX+topR+botR, maxY), control: (minX+topR, maxY))`
- bottom edge line to (maxX-topR-botR, maxY)
- BOTTOM-RIGHT convex round: `addQuadCurve(to: (maxX-topR, maxY-botR), control: (maxX-topR, maxY))`
- line up right edge to (maxX-topR, minY+topR)
- TOP-RIGHT concave shoulder: `addQuadCurve(to: (maxX, minY), control: (maxX-topR, minY))`
- close.
So: top corners = CONCAVE quad fillets (small radius), bottom corners = CONVEX quad rounds (large radius). Radius constants (extension NotchShape): closedTopRadius=6, closedBottomRadius=20, openedTopRadius=22, openedBottomRadius=36. Static presets `.closed` and `.opened`. Filled with `surfaceShape.fill(Color.black.opacity(...))` in IslandPanelView (line ~263). Note the shoulders use simple quadratic Béziers (single control point), not continuous/superellipse curves.

### compact_geometry
Compact (closed) pill dimensions are derived from the PHYSICAL notch, not hardcoded. In IslandPanelView: `closedNotchWidth = targetOverlayScreen.notchSize.width ?? 224`; `closedNotchHeight = targetOverlayScreen.islandClosedHeight ?? 24`.

Notch DETECTION lives in `extension NSScreen` at bottom of OverlayPanelController.swift (line 844+):
- `var notchSize: CGSize`: `guard safeAreaInsets.top > 0 else { return CGSize(width: 224, height: 38) }` (fallback for non-notch Macs). Real notch: `notchHeight = safeAreaInsets.top`; `leftPadding = auxiliaryTopLeftArea?.width ?? 0`; `rightPadding = auxiliaryTopRightArea?.width ?? 0`; `notchWidth = frame.width - leftPadding - rightPadding + 4` (the +4 fudge overlaps the bezel so no seam).
- `islandClosedHeight` via pure testable helper `computeIslandClosedHeight(safeAreaInsetsTop, topStatusBarHeight)`: if safeAreaInsetsTop>0 return it directly (island matches physical notch exactly, flush to bottom edge); else return topStatusBarHeight (fallback 24 for non-notch screens shows a synthetic top-bar island).
- notch-vs-non-notch decision in OverlayDisplayConfiguration.swift line 147: `screen.safeAreaInsets.top > 0 || screen.auxiliaryTopLeftArea?.isEmpty == false`.

Closed total width when sessions active: `closedNotchWidth + expansionWidth (+18 if popping)`. `expansionWidth` grows to fit left glyph + right count badge: leftWidth = sideWidth+8(+18 if pending); rightWidth = max(sideWidth,countBadgeWidth)(+18 if pending); total = left+right+16(+6 pending); `sideWidth = max(0, closedNotchHeight-12)+10`; `countBadgeWidth = 26 + (digits-1)*8`. When idle-hidden, expansionWidth=0 and the island collapses to a 4pt-high capsule edge (closedIdleEdgeHeight=4).

### expand_animation
Three named spring/curve animations at top of IslandPanelView.swift (lines 75-77):
- `openAnimation = Animation.spring(response: 0.42, dampingFraction: 0.8, blendDuration: 0)` — closed→opened morph.
- `closeAnimation = Animation.smooth(duration: 0.3)` — opened→closed.
- `popAnimation = Animation.spring(response: 0.3, dampingFraction: 0.5)` — the bouncy 'pop' attention state (underdamped 0.5 => visible overshoot; a `popping` NotchStatus adds +18pt width).

Animation is selected by a single computed `notchTransitionAnimation` switch on `model.notchStatus` (.opened/.closed/.popping) and applied via ONE modifier: `.animation(notchTransitionAnimation, value: model.notchStatus)`. A second `.animation(.smooth, value: closedPresenceAnimationKey)` drives closed-state width/presence changes; the two values were deliberately merged into one composite `ClosedPresenceKey{present,width}` to avoid two conflicting .animation modifiers firing in the same runloop.

Hover: `.scaleEffect(isHovering ? IslandChromeMetrics.closedHoverScale(=1.028) : 1, anchor: .top)`, and the hover bool itself animates with `withAnimation(.spring(response: 0.38, dampingFraction: 0.8))`.

Because radii are AnimatablePair on NotchShape, corner radii tween (6→22 top, 20→36 bottom) simultaneously with the frame during the 0.42s open spring. The NSPanel window frame is set INSTANTLY (no NSAnimationContext) — comment at OverlayPanelController line ~161 says all visual transitions (shape/size/opacity/radius) are driven purely by SwiftUI springs; mixing AppKit + SwiftUI timing caused jank. Content uses `matchedGeometryEffect` (island-icon, right-indicator) across a `@Namespace` for the closed→opened element morph. `drawingGroup()` applied conditionally (ConditionalDrawingGroup) to flatten rendering during animation.

### customization
Customization is in Views/AppearanceSettingsPane.swift, bound to AppModel and persisted via UserDefaults. IMPORTANT: there is NO user control over width, height, opacity, or scale — those are entirely derived from the physical notch geometry. Available options:
- Appearance mode (segmented Picker): `.default` vs `.custom` (IslandAppearanceMode). Custom unlocks the rest.
- Closed display style (custom only): `.minimal` vs `.detailed` (IslandClosedDisplayStyle) — detailed adds a phase-title text + 'sessions' label beside the count.
- `hideIdleIslandToEdge` toggle — when idle, collapse island to a thin 4pt black capsule edge (Capsule fill black, height 4, white 0.08 stroke) instead of showing the pill.
- Pixel glyph shape (custom only): `.bars / .steps / .blocks / .custom` (IslandPixelShapeStyle) — custom lets you upload an avatar image (`importCustomAvatar()` / `removeCustomAvatar()`, stored via AvatarImageStore, clipped to Circle).
- Per-phase status colors: a ColorPicker per SessionPhase (running / waitingForApproval / waitingForAnswer / completed), `supportsOpacity:false`, hex shown; default running color #6E9FFF, idle green #42E86B. `model.setStatusColor(_:for:)` / `statusColorHexes`.
- Other behavioral toggles in AppModel (not geometry): showDockIcon, hapticFeedbackEnabled, showCodexUsage, completionReplyEnabled, suppressFrontmostNotifications, isSoundMuted, watchNotificationEnabled.
All persisted under keys like islandAppearanceModeDefaultsKey, islandClosedDisplayStyleDefaultsKey, islandHideIdleToEdgeDefaultsKey, islandPixelShapeStyleDefaultsKey, islandStatusColorsDefaultsKey.

### multi_notification
Many concurrent sessions handled by RANKING + BUCKETING, plus a count badge — no queue/stack/cycle of separate toasts. In AppModel.computeSessionBuckets() (line 1308): all `state.sessions` are sorted by an integer `displayPriority(for:now:)` score (isProcessAlive & active => +12000, alive+inactive => +3000, requiresAttention/dead => other tiers; ties broken by islandActivityDate then title). Sessions are split into `primary` (surfacedSessions) and `overflow` (recentSessions): iterate ranked sessions where `isVisibleInIsland`, skip subagent sessions, and DEDUPLICATE by `monitoring.liveAttachmentKey(for:)` (a Set `claimedLiveAttachmentKeys` so two views of the same live terminal collapse to one). Buckets are memoized in `_cachedSessionBuckets`.

Closed state: a single `closedSpotlightSession` is chosen (first requiresAttention, else first running, else first) and shown as the glyph; a `ClosedCountBadge(liveCount: model.liveSessionCount, tint:)` shows the total number on the right (badge widens 26 + (digits-1)*8 pts). Attention tint turns orange when the spotlight session requires attention.

Opened state: the full list renders in the panel. In LIST mode it's a `ScrollView(.vertical)` capped at `maxSessionListHeight = 560` — overflow scrolls. In NOTIFICATION mode there is deliberately NO ScrollView (content self-sizes, height measured via NotificationContentHeightKey preference).

Notification surfaces (IslandSurface.notificationSurface(for event)): only permissionRequested, questionAsked, and non-interrupt sessionCompleted auto-present. Presentation is gated by `notificationSurfaceIsEligibleForPresentation` (only when notch closed or already in .notification reason, and surface still matches session state) so a newer notification can re-present over/replace the current one rather than stacking. Auto-expanded cards auto-collapse after a short timeout or when pointer leaves after first hover (per docs/notch-surface-model.md).

### screen_share
NOT hidden from screen capture. OverlayPanelController.makePanel sets `panel.sharingType = .readOnly` (line 127), which means the overlay window IS visible in screenshots/screen recordings (readOnly = capturable but not writable by others). To make it invisible the app would need `.none` — it does not. So there is NO screen-share invisibility technique here. Window is a borderless `.nonactivatingPanel` NotchPanel: `level = .statusBar`, `collectionBehavior = [.fullScreenAuxiliary, .stationary, .canJoinAllSpaces, .ignoresCycle]`, `isFloatingPanel = true`, `hasShadow = false`, `isOpaque = false`, `backgroundColor = .clear`, `ignoresMouseEvents` toggled true/false depending on whether the island is interactive.

### web_reusable
Directly portable to HTML/CSS/JS:
1. The NotchShape path maps 1:1 to an SVG path or CSS. Reproduce the two concave top shoulders as quadratic Béziers with the control point at the top corner (Q cx,ty  x,y where control sits on the top edge) and the two convex bottom corners as normal rounded corners. Corner-radius set: closed {top 6, bottom 20}, opened {top 22, bottom 36} — animate these to morph. In CSS you can approximate with a black element + two pseudo-element corner masks (`radial-gradient` masks) for the concave shoulders, but an inline SVG `<path>` with animated `d` (or a JS-built path) is the faithful route.
2. Expand animation: use a spring — response 0.42 / damping 0.8 is roughly a ~420ms cubic-bezier with slight overshoot; the pop is response 0.3 / damping 0.5 = bouncier. Framer-Motion equivalents: open {type:'spring', stiffness≈?, ...} or just cubic-bezier(0.22,1,0.36,1) ~0.42s. Hover scale 1.028 anchored at top.
3. Geometry from the physical notch: on web there is no notch API; hardcode a pill (e.g. width 224, height 32-38) matching Apple's, and grow width to fit content + a numeric count badge (badge width 26 + 8 per extra digit).
4. Multi-item pattern: don't stack toasts — show ONE spotlight item + a numeric count badge when closed; expand to a scrollable list (cap ~560px, scroll overflow) when opened. Rank by priority, dedupe by key.
5. Idle collapse: shrink to a 4px-tall black capsule with a subtle rgba(255,255,255,0.08) 1px stroke.
6. Always render on a dark surface (preferredColorScheme(.dark)); fill pure black (#000) so it blends with the bezel.

### takeaways
- Notch corner radii: CLOSED top=6/bottom=20, OPENED top=22/bottom=36 — animate all four to morph (AnimatablePair)
- Concave shoulders = quadratic Bézier with the control point AT the top corner (control on top edge => curve caves inward); bottom corners are normal convex rounds
- Open spring = response 0.42, damping 0.8; pop spring = response 0.3, damping 0.5 (bouncy); close = smooth 0.3s; hover scale 1.028 anchor top
- Notch width = screen.frame.width - auxiliaryTopLeftArea.width - auxiliaryTopRightArea.width + 4 (the +4 overlaps the bezel to kill the seam); non-notch fallback CGSize(224, 38); island height = safeAreaInsets.top exactly
- Many sessions: rank by integer priority, dedupe by live-attachment key, show ONE spotlight + numeric count badge (width 26 + 8/extra digit) when closed; scrollable list capped 560px when open — no toast stacking
- Screen-share: uses panel.sharingType = .readOnly (VISIBLE in captures) — NOT invisibility; no width/height/opacity user settings, geometry is 100% notch-derived

### stack
Swift + SwiftUI (macOS AppKit NSPanel overlay). SPM (Package.swift) with targets OpenIslandApp, OpenIslandCore, OpenIslandHooks, OpenIslandSetup + XCTest suites. Companion iOS/watchOS apps under ios/. GPL-3.0. Shape drawn as SwiftUI Shape; overlay is a borderless non-activating NSPanel at .statusBar level.

## github.com/Octane0411/open-vibe-island (Swift/SwiftUI + AppKit macOS app, default branch main, ~1.7k stars). Key files: Sources/OpenIslandApp/NotchShape.swift, V6ClosedPillShape.swift, OpenedIslandSurfaceShape.swift, IslandChromeMetrics.swift, OverlayPanelController.swift, Views/IslandPanelView.swift, Views/V6NotchContent.swift, Views/AppearanceSettingsPane.swift, AppModel.swift. All quotes fetched raw from raw.githubusercontent.com/main.

### exists
true

### stack
Swift 5 / SwiftUI for all island rendering + AppKit (NSPanel subclass "NotchPanel") for the borderless floating overlay window. SwiftPM package (Package.swift), modules OpenIslandApp (UI) + OpenIslandCore (agent/session/hook logic) + OpenIslandHooks/Setup CLIs. Also an iOS/watchOS companion (ios/). Markdown rendering via MarkdownUI. NOT Electron — it is native Swift.

### notch_shape
The concave "shoulder" notch is drawn in SwiftUI as a `Shape` using `addQuadCurve` (NOT arcs, NOT SVG, NOT CSS mask). File `Sources/OpenIslandApp/NotchShape.swift`, struct `NotchShape: Shape` with `topCornerRadius`/`bottomCornerRadius` (both animatable via `AnimatablePair`). Radii clamped: `let topR = min(topCornerRadius, rect.width/4, rect.height/4)` and `let botR = min(bottomCornerRadius, rect.width/4, rect.height/2)`. The KEY concave-shoulder trick: the top-left inward flare is a quad curve whose CONTROL POINT sits at the outer top corner, so the curve bulges INTO the black (concave from screen's view):\n```swift\npath.move(to: CGPoint(x: rect.minX, y: rect.minY))\n// Top-left inward curve (concave, mimics notch edge)\npath.addQuadCurve(\n    to: CGPoint(x: rect.minX + topR, y: rect.minY + topR),\n    control: CGPoint(x: rect.minX + topR, y: rect.minY))\npath.addLine(to: CGPoint(x: rect.minX + topR, y: rect.maxY - botR))\n// Bottom-left rounded corner (convex)\npath.addQuadCurve(\n    to: CGPoint(x: rect.minX + topR + botR, y: rect.maxY),\n    control: CGPoint(x: rect.minX + topR, y: rect.maxY))\n...mirrored on the right, top-right inward curve control at (maxX - topR, minY)\n```\nSo: top corners use control-at-corner quad curves to make CONCAVE fillets; bottom corners use control-at-corner quad curves to make CONVEX rounds. Opened radii are BOTH 22pt: `static let openedTopRadius: CGFloat = 22`, `static let openedBottomRadius: CGFloat = 22`.\n\nThe CLOSED pill is a DIFFERENT, simpler shape — `Sources/OpenIslandApp/V6ClosedPillShape.swift`, struct `V6ClosedPillShape: Shape`: flat top edge + two semicircular bottom corners via `addArc`, radius defaults to `rect.height/2` (full semicircle bottom), clamped `min(cornerRadius ?? rect.height/2, rect.width/2, rect.height)`. No concave shoulders on the closed pill — comment says on MacBook it just extends past the physical notch and merges visually since both are black. Ink color `V6Palette.ink = Color(red:0x0d/255, green:0x0d/255, blue:0x0f/255)` (#0d0d0f); paper `#f1ead9`.\n\n`OpenedIslandSurfaceShape` is a thin selector: `.notch` topProfile → NotchShape(22,bottom); `.topBar` topProfile (external display) → V6ClosedPillShape. Only bottomCornerRadius is animatable on the opened surface.

### expand_animation
All morph/expand is pure SwiftUI `.animation()` on the content — the AppKit window is NEVER resized or animated (deliberate: comment in OverlayPanelController.positionPanel says mixing NSAnimationContext with SwiftUI springs caused jank, so `panel.setFrame(windowFrame, display: true)` is instant and the window is ALWAYS held at max/opened size via `panelSize(...)`). Exact values in `Views/IslandPanelView.swift`:\n- `openAnimation = Animation.spring(response: 0.42, dampingFraction: 0.8, blendDuration: 0)`\n- `closeAnimation = Animation.smooth(duration: 0.3)`\n- `popAnimation = Animation.spring(response: 0.3, dampingFraction: 0.5)`\n- `openedSurfaceUnmountDelay: TimeInterval = 0.36` (keeps opened surface mounted 0.36s after close so the crossfade finishes)\nThe expand is a CROSSFADE, not a literal geometry morph: openedSurface and closedSurface are stacked in a ZStack; opened gets `.opacity(usesOpenedVisualState ? 1 : 0)`, closed `.opacity(usesOpenedVisualState ? 0 : 1)`, and the whole stack has `.animation(notchTransitionAnimation, value: model.notchStatus)` which picks open/close/pop spring by status. Hover scale on closed pill: `.scaleEffect(isHovering ? IslandChromeMetrics.closedHoverScale : 1, anchor: .top)` with `closedHoverScale = 1.028`, animated by `.spring(response: 0.38, dampingFraction: 0.8)`. Pop (attention bump): `.scaleEffect(isPopping ? 1.04 : 1, anchor: .top)` with popAnimation. Hover-to-open delay `hoverOpenDelay = 0.15`s (AppModel). Closed-pill fluid content changes (label/right-slot width) animate with `.timingCurve(0.4, 0, 0.2, 1, duration: 0.45)`. Anchor for all scaling is `.top` so it grows downward from the notch.

### customization
IMPORTANT: there are NO user controls for width, height, or opacity — the pill geometry is derived entirely from hardware (notch size / menu-bar height), not user prefs. All customization lives in `Views/AppearanceSettingsPane.swift` (\"v6 Personalization tab\") and is content/behavior only:\n1. Display profile: `.notch` (MacBook/laptopcomputer) vs `.topBar` (external/display) — chooses macbook vs external pill layout. Persisted per-profile in UserDefaults keys like `appearance.island.v8.<profile>.<name>`.\n2. Right slot (`IslandRightSlot`): `.count` → \"×N\" badge, or `.agents` → the balanced agent-tile grid (default `.count`).\n3. Center label (external displays only) — what text shows in the middle.\n4. Session-list prefs: sessionGroup (grouping on/off), sessionSort, sessionStateIndicator style, completedStaleThreshold, usage display.\n5. Haptic feedback toggle (`hapticFeedbackEnabled`), sound mute, completion-reply enable.\nThe pane has a live preview (`IslandPreviewPill` / `SettingsPreviewStage`) with an auto-cycle (idle→running→waiting every 2s) driven by `TimelineView(.periodic(by: 0.25))`. The header comment explicitly says idle behavior, per-tool agent colors, spinner, and custom avatars were CUT in the v6 redesign. So opacity/size/position are all fixed by design.

### multi_notification
Two separate mechanisms. (A) CLOSED-pill agent grid (`Views/V6NotchContent.swift`, `V6RightSlotView`/`AgentsGridBody`): a hand-tuned balanced matrix, `balancedRows(n)` maps 1→[1],2→[2],3→[3],4→[2,2],5→[3,2],6→[3,3],7→[4,3],8→[4,4],9→[3,3,3], default (n≥10)→[4,4]. `cellGeometry`: 8×8pt tiles / 2pt gap / 1.5 radius for ≤2 rows, shrinks to 6×6pt / 1.5 gap / 1.0 radius at 3 rows to fit the ~20pt vertical budget. Tile states: running=full color, idle=color.opacity(0.22), waiting=breathing pulse `opacity 0.35↔1` via `.easeInOut(duration:0.7).repeatForever(autoreverses:true)`. Overflow: `AppModel` caps at `ordered.prefix(7)` tiles + one `.overflow(ordered.count - 7)` \"+N\" cell when >9 sessions (line ~910-914 AppModel.swift). (B) OPENED session list (`IslandPanelView`): sessions ranked by `displayPriority`, split into primary/overflow buckets (`computeSessionBuckets`), deduped by live-attachment key. List capped by `maxVisibleSessionRows = 6` and `maxSessionListHeight = 560`pt; beyond that an `AutoHeightScrollView` wraps it in a scrollable ScrollView (measures content via GeometryReader+PreferenceKey). Notification cards (approval/question/completion) are dedicated single-item surfaces that auto-collapse on timeout or when the pointer leaves after first hover (docs/notch-surface-model.md) — they are NOT queued/stacked; the newest actionable session is surfaced.

### screen_share
NO screen-capture invisibility is implemented — in fact the opposite. `OverlayPanelController.makePanel` sets `panel.sharingType = .readOnly` (the only sharingType usage in the repo), which makes the panel VISIBLE/capturable to screen sharing and screenshots. To hide it you would need `.none`, which they do not use. The panel is a custom `NotchPanel: NSPanel` with styleMask `[.borderless, .nonactivatingPanel]`, `level = .statusBar`, `backgroundColor = .clear`, `isOpaque = false`, `hasShadow = false`, and `collectionBehavior = [.fullScreenAuxiliary, .canJoinAllSpaces, .ignoresCycle, .stationary]` (`.stationary` keeps it pinned during Sonoma \"click wallpaper to reveal desktop\"). So: invisibility-to-capture is NOT a feature here.

### compact_geometry
Notch detection in `extension NSScreen` (bottom of OverlayPanelController.swift): a display is \"notched\" iff `safeAreaInsets.top > 0`. `var notchSize: CGSize` on a notched screen returns width = `frame.width - auxiliaryTopLeftArea.width - auxiliaryTopRightArea.width + 4`, height = `safeAreaInsets.top`. On non-notched/external displays it returns a SIMULATED notch: `externalDisplayNotchWidth = 190`, `externalDisplayNotchHeight = 38`. Closed island height: `computeIslandClosedHeight` returns `safeAreaInsets.top` on notched screens (must match physical notch exactly so it sits flush), else `topStatusBarHeight` (menu-bar reserved area, fallback 24pt). Closed-pill WIDTH: MacBook layout locks outer width to `44 + physicalNotchWidth + 44` (`halfReserve = 44` each side — `V6ClosedPill.macbookBody`); external layout is fluid/content-driven with `minWidth: 70`, intrinsic = `pad*2 + glyphW(24) + labelBlock + rightBlock`, where `pad = height/2`. Hit-test width (`OverlayPanelController.closedPanelWidth`): notched → `notchWidth + 88 (+18 while popping)`; external → `360 (+18 popping)`. The pill content sits at horizontal inset = `pad = height/2` so it clears the semicircular bottom curve.

### web_reusable
Highly portable. (1) The concave notch outline maps 1:1 to an SVG path or CSS — replace SwiftUI `addQuadCurve(to:control:)` with SVG `Q cx cy x y`: top-left concave shoulder = `M 0 0 Q topR 0 topR topR` then down the side, bottom convex corners = `Q x maxY ...`. Radii 22/22, control point pinned at the outer corner is the whole secret. (2) The closed pill = a plain div with flat top + `border-bottom-left-radius / border-bottom-right-radius: height/2` (semicircle bottom), bg `#0d0d0f`. (3) Animations translate directly: `spring(response:0.42, dampingFraction:0.8)` ≈ a CSS spring/`cubic-bezier` ~450ms; the fluid content uses an explicit web-friendly curve already: `cubic-bezier(0.4, 0, 0.2, 1)` over 450ms (Material standard easing). Hover scale 1.028, pop scale 1.04, anchor top. (4) Architecture lesson worth copying: keep the OUTER container a FIXED max size and animate only inner opacity/scale/clip-path — never resize the window/container — to avoid dual-timeline jank; crossfade a \"closed\" and \"opened\" layer via opacity. (5) Agent grid: fixed balancedRows lookup table + 8px tiles (6px at 3 rows), running/idle(22%)/waiting(pulse 0.35↔1 @700ms) — trivial in HTML/CSS. (6) Waiting pulse = `@keyframes` opacity 0.35↔1, 0.7s ease-in-out infinite alternate.

### takeaways
- Notch concave shoulders = quad curves with the CONTROL POINT at the outer corner; opened radii 22/22pt, clamped to min(w/4,h/4). Closed pill is a separate flat-top shape with bottom radius = height/2.
- Never resize the window: NSPanel is held at fixed opened size, panel.setFrame is instant, and ALL expand/collapse is SwiftUI opacity crossfade + scale — avoids AppKit/SwiftUI timing jank. Copy this for web too.
- Spring numbers: open spring(response 0.42, damping 0.8), close smooth(0.3s), pop spring(0.3,0.5); fluid content cubic-bezier(0.4,0,0.2,1) 0.45s; hover scale 1.028, pop scale 1.04, anchor .top; hover-open delay 0.15s.
- Notch detection = safeAreaInsets.top>0; width = frame.width - auxTopLeft - auxTopRight + 4. External displays fake it at 190x38. MacBook pill width locked to 44 + notchWidth + 44.
- Many-notifications: hand-tuned balancedRows table (1..9) capping at prefix(7)+‘+N’ overflow tile; opened list caps 6 rows / 560pt then scrolls; tiles 8px(→6px @3 rows), waiting pulse opacity 0.35↔1 @0.7s.
- sharingType = .readOnly means the overlay IS captured in screen shares — there is NO invisibility technique; use .none if you want that.

