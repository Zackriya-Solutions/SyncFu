import type { CSSProperties } from "react";
import type { NotificationPayload } from "@/types/notification";
import { ringDash } from "@/lib/progress";
import { AMBIENT_WING, ambientWingsSize, type NotchGeometry } from "@/lib/islandMorph";

// Ambient wings indicator (T14). While a single notification is COLLAPSED and the physical notch is
// NOT hovered, the under-notch pill is concealed and this minimal indicator takes its place so the
// user keeps an at-a-glance "something is happening" signal. It is a static black shape sized like
// T12's wing pill - the cutout width plus one wing on each side, exactly the cutout height, flush at
// the screen top - so slim black extensions peek out beside the physical (opaque) notch. The center
// strip sits BEHIND the real cutout and holds nothing; the ONLY content is a small priority-accent
// hint in the RIGHT wing: a dot, or a tiny progress ring when the notification carries progress.
// T12 taught us a glyph/label cannot seat legibly in the wings, so the wings + accent ARE the signal.
//
// This is a separate, static, CSS-only element (NOT the morph controller): its geometry differs from
// the pill (wider, shorter, flush at top) and it never morphs. The `.di-reveal` pill wrapper and this
// element cross-fade on the SAME CSS transitions (island.css) - the wings fade as the pill slides
// down from the notch - so revealing reads as the wings growing into the pill, with no new animation
// system. Purely decorative (`aria-hidden`, `pointer-events: none`): the backend cursor tracker owns
// hover detection (its region spans these wings), never DOM events.

/** Mini-ring radius in the shared 24x24 viewBox (sized down via CSS), matching IslandCompact. */
const RING_R = 9;

interface AmbientWingsProps {
  readonly notification: NotificationPayload;
  readonly geo: NotchGeometry;
  /** True while the ambient indicator should be shown (collapsed + not hovered under-notch). */
  readonly visible: boolean;
}

export function AmbientWings({ notification, geo, visible }: AmbientWingsProps) {
  const { priority, progress } = notification;
  const { width, height } = ambientWingsSize(geo);
  const { dashArray, dashOffset } = ringDash(progress?.value ?? 0, RING_R);
  const style: CSSProperties = {
    width: `${width}px`,
    height: `${height}px`,
    "--di-wing": `${AMBIENT_WING}px`,
  } as CSSProperties;

  return (
    <div
      className="di-ambient"
      data-testid="island-ambient"
      data-priority={priority}
      data-visible={visible ? "true" : "false"}
      style={style}
      aria-hidden="true"
    >
      {progress ? (
        // Decorative (the whole indicator is aria-hidden); no progressbar role needed here.
        <svg className="di-ambient-ring" data-testid="island-ambient-ring" viewBox="0 0 24 24">
          <circle className="di-ambient-track" cx="12" cy="12" r={RING_R} />
          <circle
            className="di-ambient-fill"
            cx="12"
            cy="12"
            r={RING_R}
            strokeDasharray={dashArray}
            strokeDashoffset={dashOffset}
          />
        </svg>
      ) : (
        <span className="di-ambient-dot" data-testid="island-ambient-dot" />
      )}
    </div>
  );
}
