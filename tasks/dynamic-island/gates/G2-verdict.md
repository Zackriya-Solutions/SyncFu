# G2 verdict - capture exclusion on the island NSPanel (live probe)

Status: RESOLVED (go, with honest per-OS scope). Spike branch `spike/island-g2-capture-exclusion`.
Machine: macOS 26.5, build 25F71 (the post-15 ScreenCaptureKit world). Date 2026-07-21.

Probe artifacts (throwaway, not shipped): `tasks/dynamic-island/gates/g2-probe/`
- `nspanel_probe.swift` - builds an NSPanel with the shipped config and reads back sharingType.
- `sck_smoke.swift` - ScreenCaptureKit availability + TCC permission state.
- `cg_probe.swift` - legacy CoreGraphics capture path (compile attempt).
- `evidence.log` - captured stdout of all four probes on this machine.

## 1. What ships, and the mechanism under test

`overlay/panel.rs` builds the overlay as a `tauri-nspanel` NSPanel (macro `tauri_panel!` +
`PanelBuilder`), non-activating, floating, collection behavior `canJoinAllSpaces` +
`full_screen_auxiliary`. The capture-exclusion mechanism is Tauri's
`WebviewWindow::set_content_protected(true)`, which maps (per Wave V A1, tao 0.35.2
`macos/window.rs:1529-1537`) to `NSWindow.setSharingType(.none)`. A1 further established that the
tauri-nspanel isa-swizzle (`object_setClass` to a Panel subclass) preserves the flag, because
`sharingType` is an instance ivar the swizzle does not touch.

The question this gate answers is NOT "does the flag apply" (A1 proved it does). It is: on macOS
26.5, does a window with `sharingType = .none` actually disappear from a real capture, under both
the legacy path and ScreenCaptureKit? Read-back of `sharingType` is explicitly INSUFFICIENT: it
passes while SCK may still capture, which is the exact silent privacy leak A1 warned about.

## 2. Methodology

Two-part probe. Part R (mechanism/read-back) uses the ship path; Part S (behavior) is the live
capture attempt.

- Anti-lie control: the probe window is filled with a known solid color (magenta) and every capture
  attempt is paired with a protection-OFF positive control. The color MUST appear when unprotected
  (proves the capture path can see the window); only then is its absence when protected meaningful.
- Apply-first ordering: `sharingType` is set BEFORE the window is ordered on screen, matching the
  guard T9 must honor.
- Fidelity note (deliberate scope call, ponytail): the live behavior probe uses a raw AppKit NSPanel
  configured identically to the shipped panel rather than a full Tauri example. Reasons: (a) the
  repo has no built `../dist`, so a Tauri example requires a full frontend build; (b) it cannot
  unblock the capture, which is TCC-gated regardless of which harness creates the window; (c) SCK
  reads the window's `sharingType` ivar, not its Objective-C class, so a raw NSPanel with
  `sharingType = .none` is behaviorally identical to the shipped swizzled panel for the capture
  question (A1 confirmed the flag survives the swizzle). Residual risk: we did not re-run the tao
  -> setSharingType mapping at runtime; it stays sourced from A1's crate-source citation.

## 3. Live results on macOS 26.5 (this machine)

Raw output: `g2-probe/evidence.log`.

- SCK: available at compile and runtime, but `SCShareableContent.getWithCompletionHandler` returns
  `The user declined TCCs for application, window, display capture`. The controlling process has no
  Screen Recording permission, so no SCK frame could be captured.
- Legacy `screencapture` CLI: `screencapture -x` -> `could not create image from display` (exit 1);
  `screencapture -R` -> `could not create image from rect` (exit 1). On macOS 26.5 the built-in
  screenshot tool is itself gated by Screen Recording TCC and fails closed without it.
- Legacy CoreGraphics `CGWindowListCreateImage`: does not compile against the 26.5 SDK - the symbol
  is `unavailable in macOS: Please use ScreenCaptureKit instead`. The old unguarded CoreGraphics
  capture route no longer exists in the SDK.
- NSPanel read-back (ship config): a fresh NSPanel now defaults to `sharingType = readOnly(1)` (and
  `readWrite(2)` is deprecated as of macOS 15). After the mechanism runs, `sharingType = none(0)`,
  read back stable after `orderFront`. Window shows: `isVisible=true`, `isOnActiveSpace=true`,
  `collectionBehavior=257` (`canJoinAllSpaces` 1 | `fullScreenAuxiliary` 256). No interaction fault
  between `sharingType = .none` and the collection behavior; the panel still renders on the active
  space. The OFF control read back `readOnly(1)` as expected.

Consequence: on macOS 26.5, every capture path funnels through ScreenCaptureKit (legacy CG removed;
`screencapture` CLI is SCK/TCC-gated), and SCK could not be exercised here because the agent process
holds no Screen Recording grant. The differentiating live-capture result (does a `sharingType=.none`
NSPanel appear in an SCK frame on 26.5) is therefore UNKNOWN-by-observation on this machine. It is
NOT invented. The strong documented inference (A1: tauri #14200 status:upstream, Apple DTS forum
792152 "no public APIs for preventing screen capture" on 15.4+) is that 26.5, being post-15 and
fully SCK-routed, behaves like 15.x: the flag is ignored and the window IS captured.

There are no capture PNGs or pixel-diffs because no capture path could produce a frame. The evidence
of record is `evidence.log` (permission denials + read-back), which is the honest ceiling in this
environment.

## 4. Per-OS result table

| Target | Mechanism | Live-probe result (this machine) | Verdict basis | Excluded from capture? |
|---|---|---|---|---|
| macOS 26.5 legacy (`screencapture`/CG) | `setSharingType(.none)` | Not runnable: CG removed from SDK; `screencapture` TCC-blocked | this machine, evidence.log | UNKNOWN by observation; legacy path no longer distinct from SCK on 26.5 |
| macOS 26.5 ScreenCaptureKit | `setSharingType(.none)` | Not runnable: TCC declined for this process | this machine + A1 docs | UNKNOWN by observation; documented-inference NO (captured) |
| macOS <= 14 | `setSharingType(.none)` | not probed on this machine | A1 (SURVIVES; SCK honors sharingType pre-15) | YES (guaranteed) |
| Windows 10 build 19041+ | `WDA_EXCLUDEFROMCAPTURE` | not probed on this machine | A1 / MS docs (DWM enforced) | YES (guaranteed) |
| Windows < 19041 | none reliable (`WDA_MONITOR` only) | not probed on this machine | MS docs | NO (unsupported) |
| Linux | none | not probed on this machine | context-pack: no reliable equivalent | NO (unsupported) |

## 5. NSPanel and collection-behavior interactions observed

- Default `sharingType` on a fresh NSPanel is `readOnly(1)` on 26.5, not `readWrite`. Explicit
  `.none` is required to attempt exclusion; `set_content_protected(true)` supplies it. This matches
  the guard "never copy open-island / open-vibe-island `.readOnly`" - the shipped panel must set
  `.none`, and the OS default of `.readOnly` is itself capturable.
- `sharingType = .none` coexists cleanly with `canJoinAllSpaces | fullScreenAuxiliary`
  (collectionBehavior 257). No visibility, active-space, or ordering regression from applying the
  flag before first show.
- Apply-first ordering verified: setting `sharingType` before `orderFront` is stable across show.

## 6. Go / no-go and the T9 recipe

GO for T9. The capture-invisibility differentiator is real only where the OS honors it. Scope it
honestly (OQ-1 resolved: NO auto-hide subsystem is built; the limitation is documented, not worked
around).

T9 tri-state, surfaced by the hideFromScreenCapture status and never claiming more than the OS
delivers:

- ON: OS is known to honor exclusion. macOS with Darwin kernel < 24 (macOS <= 14), OR Windows build
  >= 19041. T9 calls `set_content_protected(true)` before first show and reports "Hidden from screen
  capture: on".
- UNSUPPORTED: OS is known to ignore or lack the mechanism. macOS with Darwin >= 24 (macOS 15+,
  including 26.5) per A1 documented SCK behavior; Linux (no API); Windows < 19041. T9 still calls
  `set_content_protected(true)` as cheap defense-in-depth (harmless, and blocks any residual legacy
  path), but the UI must state the OS does not support hiding from capture and must NOT show an "on"
  guarantee.
- UNKNOWN: OS or version cannot be determined, or a future/unclassified case. Fail safe: treat as
  not protected in the wording, apply the flag anyway, and surface "unverified - assume visible to
  screen capture".

Concrete detection for T9:
- macOS: read the Darwin major version (kernel), or `NSProcessInfo.operatingSystemVersion.majorVersion`
  >= 15. Do NOT trust a `sharingType` read-back as proof (INSUFFICIENT, per this gate).
- Windows: gate on build number >= 19041 before calling the WDA path.
- Linux: always UNSUPPORTED.

Ordering guard (binding): apply `set_content_protected(true)` BEFORE the panel is first shown, on
the main thread, on the exact tauri-nspanel window. Never emit an "on" status on macOS 15+.

Follow-up (does not block T9): re-run Part S with Screen Recording permission granted to confirm the
26.5 SCK behavior as a fresh data point; until then the 26.5 SCK cell stays documented-inference, not
observed. PRD OQ-4 stands: Apple guidance is "file Feedback Assistant"; unresolved platform limit.
