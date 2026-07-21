import type { CSSProperties } from "react";
import type { StyleOverrides } from "@/types/notification";

// Shared --s-* style map + builder, extracted verbatim from NotificationCard so
// both the card and the island renderer consume ONE map and can never fork it
// (C8). Behavior is byte-identical to the pre-extraction NotificationCard.

/** Maps from StyleOverrides key to CSS custom property name */
export const STYLE_VAR_MAP: Record<string, string> = {
  accentColor: "--s-accent-color",
  cardBg: "--s-card-bg",
  cardBorderRadius: "--s-card-border-radius",
  iconColor: "--s-icon-color",
  iconBg: "--s-icon-bg",
  iconBorderColor: "--s-icon-border-color",
  titleColor: "--s-title-color",
  titleFontSize: "--s-title-font-size",
  bodyColor: "--s-body-color",
  bodyFontSize: "--s-body-font-size",
  senderColor: "--s-sender-color",
  timeColor: "--s-time-color",
  btnBg: "--s-btn-bg",
  btnColor: "--s-btn-color",
  btnBorderColor: "--s-btn-border-color",
  btn2Bg: "--s-btn2-bg",
  btn2Color: "--s-btn2-color",
  btn2BorderColor: "--s-btn2-border-color",
  dangerBg: "--s-danger-bg",
  dangerColor: "--s-danger-color",
  dangerBorderColor: "--s-danger-border-color",
  progressColor: "--s-progress-color",
  progressTrackColor: "--s-progress-track-color",
  countdownColor: "--s-countdown-color",
  closeBg: "--s-close-bg",
  closeColor: "--s-close-color",
  closeBorderColor: "--s-close-border-color",
};

/** Build CSS custom properties object from style overrides */
export function buildStyleVars(
  style: StyleOverrides | undefined,
  font: string | undefined,
): CSSProperties {
  const vars: Record<string, string> = {};

  if (font) {
    vars.fontFamily = `"${font}", sans-serif`;
  }

  if (!style) return vars as CSSProperties;

  for (const [key, cssVar] of Object.entries(STYLE_VAR_MAP)) {
    const value = style[key as keyof StyleOverrides];
    if (value) {
      vars[cssVar] = value;
    }
  }

  return vars as CSSProperties;
}
