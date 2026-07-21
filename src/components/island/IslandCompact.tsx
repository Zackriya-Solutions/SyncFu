import type { NotificationPayload } from "@/types/notification";
import { progressPercent, ringDash } from "@/lib/progress";

// Compact pill content: leading glyph (accent dot) / label / trailing
// live-activity slot. Mirrors the mockup's `.di-compact` anatomy (rev 8).
//
// The trailing slot (T5b) is the glanceable live-activity: when the notification
// carries `progress`, it shows a mini progress ring + percent. The compact pill
// is always a RING (it has no room for a bar) regardless of the payload's
// ProgressStyle, which governs only the expanded presentation. The ring fill is a
// declarative stroke-dashoffset written by React on each re-render and eased by a
// CSS transition (R-PERF: NEVER the path-rewriting rAF morph loop). A progress
// event arriving after collapse re-renders this in place with the fresh value.

/** Mini-ring radius in the shared 24x24 viewBox (sized down via CSS). */
const RING_R = 9; // mockup mini-ring radius (ringSVG(..., 9), mockup L1495)

interface IslandCompactProps {
  readonly notification: NotificationPayload;
  /** Wing layout (BUG A): a real notch cutout sits between the glyph and the trailing slot, so the
   *  sender label is OMITTED (the ~4px underhang below the 32pt cutout cannot seat 11.5px text - see
   *  island.css). The glyph lives in the left wing, the trailing slot in the right wing, and the
   *  center strip (cutout width) holds nothing. `false` keeps the glyph/label/trailing flex row. */
  readonly wings?: boolean;
}

export function IslandCompact({ notification, wings = false }: IslandCompactProps) {
  const { sender, progress } = notification;
  const pct = progress ? progressPercent(progress.value) : 0;
  const { dashArray, dashOffset } = ringDash(progress?.value ?? 0, RING_R);

  return (
    <div className="di-compact" data-testid="island-compact">
      <span className="di-dot" data-testid="island-compact-glyph" />
      {!wings && <span className="di-sender">{sender}</span>}
      <span className="di-trailing" data-testid="island-compact-trailing">
        {progress && (
          <span className="di-liveactivity" data-testid="island-compact-progress">
            <svg
              className="di-mini-ring"
              viewBox="0 0 24 24"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <circle className="di-mini-track" cx="12" cy="12" r={RING_R} />
              <circle
                className="di-mini-fill"
                cx="12"
                cy="12"
                r={RING_R}
                strokeDasharray={dashArray}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <span className="di-mini-pct">{pct}%</span>
          </span>
        )}
      </span>
    </div>
  );
}
