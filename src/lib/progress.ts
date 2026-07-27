// Progress geometry helpers for the island (T5b). Pure + unit-testable, shared by
// the compact live-activity mini-ring (IslandCompact) and the expanded bar/ring
// (IslandExpanded). Ported from the approved design mockup's ringSVG (rev 8):
// a 24x24 viewBox circle whose stroke-dasharray == circumference
// and stroke-dashoffset == circumference * (1 - value) draws the fill arc.
//
// The card renders progress as a bar for BOTH styles; the island adds a real ring
// (mockup anatomy), so the ring math lives here rather than being forced onto the
// card's render (surgical: the card is untouched).

/** Clamp a raw progress value into [0, 1]; NaN degrades to 0 (never render junk). */
export function clampProgress(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Integer 0..100 percent for the label + aria-valuenow (matches the card's round). */
export function progressPercent(value: number): number {
  return Math.round(clampProgress(value) * 100);
}

/** SVG stroke-dash geometry for a ring of radius `r` in the 24x24 viewBox. */
export function ringDash(
  value: number,
  r: number
): { readonly dashArray: number; readonly dashOffset: number } {
  const circumference = 2 * Math.PI * r;
  return {
    dashArray: circumference,
    dashOffset: circumference * (1 - clampProgress(value)),
  };
}
