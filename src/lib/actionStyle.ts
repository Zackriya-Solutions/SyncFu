import type { CSSProperties } from "react";
import type { Action } from "@/types/notification";

// Shared per-action inline-style builder (T5a extraction). Extracted VERBATIM
// from NotificationCard so the card and the island apply per-action bg/color/
// border overrides identically (functional parity). Returns undefined when the
// action carries no overrides so the CSS class styling is left untouched.
export function buildActionStyle(action: Action): CSSProperties | undefined {
  const { bg, color, borderColor } = action;
  if (!bg && !color && !borderColor) return undefined;

  const style: CSSProperties = {};
  if (bg) style.background = bg;
  if (color) style.color = color;
  if (borderColor) style.borderColor = borderColor;
  return style;
}
