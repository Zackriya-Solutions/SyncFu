pub mod island;
pub mod panel;

#[cfg(target_os = "macos")]
pub mod notch;

use crate::notification::types::Presentation;

/// Which overlay window hosts a notification, decided by its `presentation`.
///
/// Single source of truth for backend routing so that:
/// - a `card` send keeps its existing top-right `overlay` panel path, byte-identical (invariant f);
/// - an `island` send is scoped to the dedicated top-center `island` window and never pops the
///   panel (FR-3 / R-TWOWIN).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverlayRoute {
    Panel,
    Island,
}

impl OverlayRoute {
    /// Route a presentation to its overlay window.
    pub fn of(presentation: Presentation) -> Self {
        match presentation {
            Presentation::Card => OverlayRoute::Panel,
            Presentation::Island => OverlayRoute::Island,
        }
    }

    /// The Tauri window label that receives this route's `notification:*` events.
    /// `Panel` mirrors `panel.rs`'s `overlay` label (not a const there); `Island` uses
    /// `island::ISLAND_LABEL`.
    pub fn window_label(self) -> &'static str {
        match self {
            OverlayRoute::Panel => "overlay",
            OverlayRoute::Island => island::ISLAND_LABEL,
        }
    }
}

/// Hide the overlay window that hosts a notification of the given presentation.
///
/// Only ever hides the matching window (R-TWOWIN); the other window is already empty/hidden when
/// the global active count reaches zero. Shared by the Tauri command and HTTP server paths.
pub fn hide_for(app: &tauri::AppHandle, presentation: Presentation) {
    match OverlayRoute::of(presentation) {
        OverlayRoute::Panel => panel::hide_panel(app),
        OverlayRoute::Island => island::hide_island(app),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_card_routes_to_panel() {
        assert_eq!(OverlayRoute::of(Presentation::Card), OverlayRoute::Panel);
        assert_eq!(OverlayRoute::of(Presentation::Card).window_label(), "overlay");
    }

    #[test]
    fn test_island_routes_to_island_window() {
        assert_eq!(OverlayRoute::of(Presentation::Island), OverlayRoute::Island);
        assert_eq!(
            OverlayRoute::of(Presentation::Island).window_label(),
            island::ISLAND_LABEL
        );
    }

    #[test]
    fn test_routes_are_distinct_windows() {
        // R-TWOWIN: the two presentations never resolve to the same window.
        assert_ne!(
            OverlayRoute::of(Presentation::Card).window_label(),
            OverlayRoute::of(Presentation::Island).window_label()
        );
    }
}
