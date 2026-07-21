import { useLayoutEffect, useRef, useState } from "react";
import type { NotificationPayload } from "@/types/notification";
import { notchPath, RADII, wallPadding } from "@/lib/notchPath";
import { buildStyleVars } from "@/lib/styleVars";
import { IslandCompact } from "./IslandCompact";
import { IslandExpanded } from "./IslandExpanded";

// Static island host: the inline SVG notch shape (from T2's notchPath) rendered
// BEHIND the content, with content inset off the concave shoulders via T2's
// wallPadding rule (R-WALL). No spring/morph machinery lives here - that is
// T4b. This component only renders one settled state (compact | expanded).

export type IslandState = "compact" | "expanded";

/** Default envelope dims per state (D4 defaults: compactWidth 218, height 34;
 *  expandedWidth 380). Expanded height is measured from content. */
const COMPACT_W = 218;
const COMPACT_H = 34;
const EXPANDED_W = 380;
/** Floor so the expanded shape never collapses when content is unmeasured
 *  (jsdom reports 0 height; the real browser measures the true content box). */
const EXPANDED_MIN_H = 72;

/**
 * Compact pill surface is PURE BLACK in macOS notch mode regardless of
 * appearance (invariant d): it hugs the physical, opaque-black notch cutout and
 * must be indistinguishable from it. It deliberately does NOT read `--s-card-bg`
 * or any appearance setting (that lands in T4b). The expanded surface DOES honor
 * the shared `--s-card-bg` override, defaulting to the mockup's frosted charcoal.
 */
const COMPACT_FILL = "#000000";
const EXPANDED_FILL = "var(--s-card-bg, rgba(13,13,15,0.94))";

interface IslandProps {
  readonly notification: NotificationPayload;
  readonly state: IslandState;
}

export function Island({ notification, state }: IslandProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [measuredH, setMeasuredH] = useState(EXPANDED_MIN_H);

  const expanded = state === "expanded";

  // Measure the settled content box (in normal flow) so the shape height matches
  // it exactly (mirrors the mockup's mountStatic `inner.offsetHeight`). This is
  // static sizing, not a morph: it runs per content change, no animation.
  useLayoutEffect(() => {
    if (!expanded) return;
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setMeasuredH(Math.max(el.offsetHeight, EXPANDED_MIN_H));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, notification]);

  const W = expanded ? EXPANDED_W : COMPACT_W;
  const H = expanded ? measuredH : COMPACT_H;
  const t = expanded ? RADII.expandedTop : RADII.compactTop;
  const b = expanded ? RADII.expandedBottom : RADII.compactBottom;

  const d = notchPath({ W, H, t, b });
  const fill = expanded ? EXPANDED_FILL : COMPACT_FILL;
  // The 27 `--s-*` overrides must be in scope for the inline SVG path (which reads
  // `var(--s-card-bg, ...)`) AND the content. The path is `.di-island > svg > path`
  // and the content is `.di-island > .di-content > ...`, so the ONLY common
  // ancestor is `.di-island`. Set the shared vars here (invariant c). Compact keeps
  // its hardcoded #000000 fill and never reads these (invariant d).
  const styleVars = buildStyleVars(notification.style, notification.font);
  // R-WALL: content padding derives from the shoulder inset (`t`), never letting
  // text/icons cross the concave shoulder. Published as `--di-wall` for parity.
  const padX = wallPadding(t, expanded ? "card" : "compact");

  // Expanded height is content-driven (auto): the in-flow content sizes the box,
  // the absolute SVG fills it. Compact is a fixed-height pill.
  const sizeStyle = expanded ? { width: W } : { width: W, height: H };

  return (
    <div
      className="di-island"
      data-testid="island"
      data-state={state}
      style={{ ...styleVars, ...sizeStyle, ["--di-wall" as string]: `${t}px` }}
    >
      <svg
        className="di-shape"
        preserveAspectRatio="none"
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        aria-hidden="true"
      >
        <path d={d} fill={fill} />
      </svg>
      <div
        className="di-content"
        ref={contentRef}
        style={{ paddingLeft: padX, paddingRight: padX }}
      >
        {expanded ? (
          <IslandExpanded notification={notification} />
        ) : (
          <IslandCompact notification={notification} />
        )}
      </div>
    </div>
  );
}
