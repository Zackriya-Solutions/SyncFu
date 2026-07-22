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
  /** Dismiss a single row by id (T15, the secondary per-row x). Resolves exactly
   *  that row's waiter as Dismissed (exit 1), never crossing ids (A4). */
  readonly onRowDismiss: (id: string) => void;
  /** Clear every island notification (T15, the header "Clear all"). Wired to the
   *  backend dismiss-all path so it empties even deduped/merged notifications. */
  readonly onClearAll: () => void;
}

export function IslandList({
  snapshot,
  onCollapse,
  onRowAction,
  onRowDismiss,
  onClearAll,
}: IslandListProps) {
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
            className="di-list-clear"
            data-testid="island-list-clear"
            aria-label="Clear all notifications"
            onClick={onClearAll}
          >
            Clear all
          </button>
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
            <button
              type="button"
              className="di-lrow-close"
              data-testid="island-row-close"
              data-id={row.id}
              aria-label="Dismiss notification"
              onClick={() => onRowDismiss(row.id)}
            >
              <svg
                width="8"
                height="8"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2.5"
              >
                <line x1="2" y1="2" x2="8" y2="8" />
                <line x1="8" y1="2" x2="2" y2="8" />
              </svg>
            </button>
          </div>
        ))}
        <div className="di-list-spacer" />
      </div>
    </div>
  );
}
