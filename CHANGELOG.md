# Changelog

All notable changes to syncfu are documented here. This project adheres to
[Semantic Versioning](https://semver.org/) (0.x: minor versions may change behavior).

## 0.4.1

### Added

- **Notch notifications** — a second notification presentation. On a MacBook it
  covers the physical notch: its concave "wedge" top sits flush at the screen edge
  over the cutout, so the black shape absorbs the hardware notch and reads as one
  shape, with content below the cutout. It spring-morphs between an ambient pill and
  a full card. On non-notch Macs, Windows, and Linux it renders as a floating capsule.
  Includes:
  - Ambient wings (idle "something's happening" indicator) and hover-reveal.
  - Live progress (mini-ring while collapsed; bar or ring when expanded).
  - Decisions and `--wait` (arrive expanded, stay until answered; exit 0/1/2).
  - A priority-ranked, deduped multi-notification list (spotlight + `xN` badge).
  - 13 app-wide geometry/appearance settings (size, radii, opacity, accent, mode,
    position, appearance, reduced-motion, screen-capture hiding).
  - Screen-capture hiding with an honest per-OS status (guaranteed on macOS ≤14 and
    Windows 10 19041+; best-effort on macOS 15+; unsupported elsewhere).
- Single-instance enforcement — a second launch is terminated and brings the first
  instance's window to the front.

### Changed

- **Notch notifications are now the default presentation.** `syncfu send` and HTTP
  payloads without a `presentation` field route to the notch notification. Use
  `--presentation card` (or `"presentation": "card"`) for the top-right card.

### Fixed

- The arrival card no longer auto-collapses while the cursor is over it (hover-pause,
  matching the top-right card).
- Hover-reveal no longer shifts the pill sideways: the revealed pill shares the
  ambient wings' width, so only the content drops in.
- The expanded card's close button no longer overlaps the timestamp.
- Critical notifications now stay expanded on the notch notification too, instead of
  minimizing to an ambient dot after 2.6s (matches the documented invariant).
- The grouped-list per-item auto-dismiss timers no longer restart on unrelated
  snapshot changes (a progress tick could previously keep a row from ever dismissing).

### Fixed (cross-platform build)

- Build correctly on Windows and Linux. `PANEL_LABEL` was mistakenly gated to
  macOS while the `tauri_nspanel!` macro was left ungated, so non-macOS builds
  failed to compile. (0.4.0 was tagged but never published for this reason;
  0.4.1 is the first published build of these features.)

### Security

- Removed the permissive CORS layer from the localhost HTTP control port. The API's
  clients (CLI, curl, server-side) do not need CORS; dropping it prevents any website
  from reaching `:9868` cross-origin to spoof notifications or inject a callback URL.

### Internal

- The island window and its cursor tracker now tear down per-presentation (when the
  island empties, even if top-right cards remain) instead of on the global active
  count, so no idle cursor poll leaks.
- Removed dead helpers (`spring` hover constants, the `notchPath` wall-padding mirror);
  the hover lift and content padding live in CSS, the single source of truth.

### Docs

- The README now leads with a Screenshots gallery.

## 0.3.0

- Prior release: overlay notification system (top-right card), `--wait` (SSE), 27
  style properties, multi-monitor, webhook callbacks, live progress, CLI + HTTP API.
