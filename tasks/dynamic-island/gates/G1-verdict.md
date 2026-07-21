# G1 verdict: notch-geometry access from Rust

**Verdict: GO.** T3 can read physical notch width from Rust with only public NSScreen
APIs, no private SkyLight, notarization-safe. Measured on real hardware this session.

**Thinking framework:** first-principles + inversion. First-principles: the only load-bearing
question is "can Rust obtain the notch cutout width without private APIs and without crashing off
the main thread." Inversion: I looked for the failure that would force a no-go (a panic on
non-notch displays from objc2's non-optional NSRect, or a main-thread assertion) and probed exactly
that. Both failure modes did not occur.

## Environment probed

- macOS 26.5 (build 25F71), Apple silicon.
- objc2 0.6.4, objc2-app-kit 0.3.2, objc2-foundation 0.3.2 (already in `src-tauri/Cargo.lock`
  transitively via `tauri-nspanel`; the spike promotes objc2-app-kit to a direct dev-dependency).
- Two displays attached, which lucky-covers BOTH known-unknown cases in one run:
  - screen[0]: built-in notched panel.
  - screen[1]: external non-notch monitor (the "external display of a notched Mac" unknown).

## Measured values (real output)

```
NSScreen count: 2
--- screen[0] ---  (built-in, notched)
  frame:            1470 x 956
  safeAreaInsets:   top=32.0 left=0.0 right=0.0 bottom=0.0
  auxTopLeftArea:   646.0 x 32.0 @ (0.0,924.0)
  auxTopRightArea:  645.0 x 32.0 @ (825.0,924.0)
  has_notch:        true
  => notchWidth:    183.0 pt          (1470 - 646 - 645 + 4)
--- screen[1] ---  (external, non-notch)
  frame:            1920 x 1080
  safeAreaInsets:   top=0.0 left=0.0 right=0.0 bottom=0.0
  auxTopLeftArea:   0.0 x 0.0 @ (0.0,0.0)
  auxTopRightArea:  0.0 x 0.0 @ (0.0,0.0)
  has_notch:        false
```

- notchWidth = 183.0 pt on the built-in display. Plausible (real MacBook notch cutout is ~180 pt).
  Cross-check: the physical gap between the two aux areas is 825 - 646 = 179 pt; boring.notch's
  `+4` fudge widens it to 183 so the capsule slightly overhangs the cutout. Consistent.
- Aux areas sit at y=924 (top of the 956-tall frame minus the 32 pt menu-bar band), confirming they
  describe the menu-bar strips flanking the notch, not the notch itself.

## Exact API path (public, notarization-safe)

`objc2_app_kit::NSScreen` (thread_kind `MainThreadOnly`), methods:

- `NSScreen::screens(mtm) -> Retained<NSArray<NSScreen>>` - iterate all displays.
- `screen.frame() -> NSRect` - full display rect (points).
- `screen.safeAreaInsets() -> NSEdgeInsets` - `.top > 0.0` is the notch presence signal (macOS 12+).
- `screen.auxiliaryTopLeftArea() -> NSRect`, `screen.auxiliaryTopRightArea() -> NSRect` - the
  menu-bar strips left and right of the notch (macOS 12+).

`NSRect` is `objc2_foundation::NSRect` (= `CGRect`); fields `.size.width/.size.height/.origin.x/.y`
are `f64`. `NSEdgeInsets` is `objc2_foundation::NSEdgeInsets` with `f64` `top/left/right/bottom`.

## Main-thread requirements (binding for T3)

`NSScreen` is `#[thread_kind = MainThreadOnly]`; every accessor takes `&self` gated by a
`MainThreadMarker`. T3 MUST call these inside the existing
`AppHandle::run_on_main_thread(...)` dispatch (the pattern already used in
`src-tauri/src/overlay/panel.rs` lines 196 / 229 for NSPanel). Inside that closure obtain the marker
with `MainThreadMarker::new().expect(...)`. Off the main thread `MainThreadMarker::new()` returns
`None`, so a wrong-thread call is a clean `None`, not UB. (In the standalone example, `main()` is
already the main thread, so the marker resolves directly with no Tauri loop.)

## Non-notch nullability semantics (the key objc2-vs-Swift finding)

Swift types these as `NSRect?` and returns `nil` on non-notch displays; idiomatic Swift is
`if let area = screen.auxiliaryTopLeftArea { ... }`. **objc2-app-kit 0.3.2 types them as
non-optional `-> NSRect`.** Empirically (screen[1] above) the nil case surfaces as **`NSZeroRect`
(all fields 0.0), NOT a panic and NOT `Option::None`.** Same for `safeAreaInsets` on non-notch
(`top = 0.0`). So there is no Option to unwrap and nothing to guard against a crash; detection is a
value check. **Use `safeAreaInsets().top > 0.0` as the notch-presence test** (it is the most direct
signal and was non-zero exactly on the notched display); treat the aux rects as valid only then.

## External-display / multi-monitor notes (for T3)

- Do NOT assume `mainScreen()` is the notched one. Here the notched panel is screen[0] but
  `mainScreen` follows key-window focus and can be the external monitor. T3 must **iterate
  `screens(mtm)` and select the screen whose `safeAreaInsets().top > 0.0`** to anchor the island,
  and fall back to the floating capsule when none has a notch (or when the target display is the
  external one).
- Coordinates are per-screen points with a bottom-left origin (aux areas at y=924 in a 956-tall
  frame). Converting to Tauri's top-left window coordinates is T3's job, not proven here.

## Copy-paste recipe for T3 (`src-tauri/src/overlay/notch.rs`)

Promote the dep from dev-scope to a real macOS dependency in `src-tauri/Cargo.toml`:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
objc2-app-kit = { version = "0.3", features = ["NSScreen"] }
objc2-foundation = "0.3"
```

```rust
#[cfg(target_os = "macos")]
pub struct NotchGeometry {
    pub screen_width: f64,
    pub notch_width: f64, // physical cutout width in points
}

/// Must be called on the main thread (wrap in AppHandle::run_on_main_thread).
#[cfg(target_os = "macos")]
pub fn notch_geometry(mtm: objc2_foundation::MainThreadMarker) -> Option<NotchGeometry> {
    use objc2_app_kit::NSScreen;
    // Pick the notched built-in display, not mainScreen (focus-dependent).
    NSScreen::screens(mtm).iter().find_map(|screen| {
        if screen.safeAreaInsets().top <= 0.0 {
            return None; // non-notch display -> caller uses floating-capsule fallback
        }
        let frame = screen.frame();
        let l = screen.auxiliaryTopLeftArea().size.width;
        let r = screen.auxiliaryTopRightArea().size.width;
        Some(NotchGeometry {
            screen_width: frame.size.width,
            notch_width: frame.size.width - l - r + 4.0, // boring.notch formula
        })
    })
}
```

Callers on non-macOS, or when `notch_geometry` is `None`, use the floating capsule (~185 x 32).
G5 satisfied: the public query is attempted first, fallback only after it returns `None`.

## Honest limits (unprobeable on this hardware / out of scope here)

- Only macOS 26.5 was exercised. macOS 12/13/14 behavior of the aux-area API is unverified here;
  the API is documented public since macOS 12, and `safeAreaInsets` predates it, so the
  presence-test degrades safely, but the exact aux values on older OSes were not measured.
- No non-notch **built-in** Mac (e.g. a pre-2021 laptop or a Mac mini with only external displays)
  was available; the non-notch path was validated via the external monitor, which is the same
  `NSZeroRect` code path.
- Point-to-Tauri-window coordinate conversion and live island placement are T3's work; this gate
  only proves the geometry is readable.

## Gate results

- Probe compiles and runs in the syncfu toolchain on macOS 26.5 (real output above).
- `cargo check --workspace` green.
- Files: `src-tauri/Cargo.toml` (spike dev-dep), `src-tauri/examples/notch_probe.rs` (throwaway),
  this verdict. Nothing merged into `src/`.
