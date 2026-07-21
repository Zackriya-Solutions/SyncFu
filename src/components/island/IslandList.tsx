import type { CSSProperties } from "react";
import type { IslandRow, IslandSnapshot } from "@/types/islandSnapshot";
import { NotificationIcon } from "@/components/overlay/NotificationIcon";

// Model B expanded list - a DUMB renderer of the Rust-owned island snapshot
// (guard G10 / C1). It computes NOTHING about rank, dedupe or count: rows,
// ordering, merged count and badge all arrive precomputed from the manager. Its
// only jobs are layout, the row stagger, scroll containment and the bottom fade.
//
// Cap (D5, T4b review note): the list caps at 6 rows / 560px HERE via
// `.di-list-body` max-height + overflow, NOT via the morph height cap (which is
// bypassed by content auto-height at rest). Beyond 6 rows it scrolls, and the
// `scrolls` class masks the bottom edge so the partial last row reads as a scroll
// affordance, never a hard guillotine.
//
// Stagger (D5, 40-60ms): each row animates in with `animation-delay: i*50ms`
// (mockup rowHtml). Reduced motion drops the animation via CSS.

/** Rows visible before the list scrolls (D5 cap). */
const VISIBLE_ROWS = 6;

/** Per-row stagger step in ms (D5: 40-60ms; mockup uses 50). */
const STAGGER_MS = 50;

/** Priority -> action verb (mockup `actionLabel`). Used only when the row's
 *  notification carries no explicit primary action label. */
function actionLabel(row: IslandRow): string {
  if (row.actions.length > 0) return row.actions[0].label;
  switch (row.priority) {
    case "critical":
    case "high":
      return "Review";
    case "normal":
      return "Open";
    default:
      return "View";
  }
}

interface IslandListProps {
  readonly snapshot: IslandSnapshot;
  /** Collapse back to the compact spotlight (the ▴ button). */
  readonly onCollapse: () => void;
  /** Act on a row: fires its primary action, else dismisses it. Each row maps
   *  1:1 to its own id/waiter (A4), so resolution never crosses notifications. */
  readonly onRowAction: (row: IslandRow) => void;
}

export function IslandList({ snapshot, onCollapse, onRowAction }: IslandListProps) {
  const { rows, merged } = snapshot;
  const scrolls = rows.length > VISIBLE_ROWS;
  const countText =
    `${rows.length}` + (merged > 0 ? ` · ${merged} merged` : "");

  return (
    <div className="di-list" data-testid="island-list">
      <div className="di-list-head">
        <span className="di-list-title">Notifications</span>
        <span className="di-list-head-r">
          <span className="di-list-count" data-testid="island-list-count">
            {countText}
          </span>
          <button
            type="button"
            className="di-list-collapse"
            data-testid="island-list-collapse"
            aria-label="Collapse list"
            onClick={onCollapse}
          >
            {"▴"}
          </button>
        </span>
      </div>
      <div
        className={scrolls ? "di-list-body scrolls" : "di-list-body"}
        data-testid="island-list-body"
        data-scrolls={scrolls}
      >
        {rows.map((row, i) => (
          <div
            key={row.id}
            className="di-lrow"
            data-testid="island-row"
            data-id={row.id}
            data-priority={row.priority}
            style={{ animationDelay: `${i * STAGGER_MS}ms` } as CSSProperties}
          >
            <span className="di-lrow-dot" />
            <span className="di-lrow-ava" aria-hidden="true">
              {row.icon && <NotificationIcon name={row.icon} size={15} />}
            </span>
            <span className="di-lrow-txt">
              <b>
                {row.sender} {"·"} {row.title}
              </b>
              <span>
                {row.priority} {"·"} now
              </span>
            </span>
            <button
              type="button"
              className="di-lrow-act"
              data-testid="island-row-action"
              data-id={row.id}
              onClick={() => onRowAction(row)}
            >
              {actionLabel(row)}
            </button>
          </div>
        ))}
        <div className="di-list-spacer" />
      </div>
    </div>
  );
}
