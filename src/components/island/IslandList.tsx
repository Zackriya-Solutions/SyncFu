import type { CSSProperties } from "react";
import { useState } from "react";
import type { IslandRow, IslandSnapshot } from "@/types/islandSnapshot";
import { NotificationIcon } from "@/components/overlay/NotificationIcon";
import { buildActionStyle } from "@/lib/actionStyle";

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
//
// Row expansion (T18): a row carrying MORE THAN ONE action would otherwise strand
// its non-primary actions (the compact row shows only the primary), so for a
// --wait decision the CLI could only ever resolve with the primary or dismissal.
// Clicking such a row's body toggles an INLINE accordion expansion revealing ALL
// its actions (primary/secondary/danger, styled per the card's action anatomy)
// plus its message body. One row is open at a time; expansion is LOCAL view state
// (never part of the snapshot - G10) and dies with the list. Single-/zero-action
// rows are NOT expandable and keep the unchanged compact fast path.

/** Rows visible before the list scrolls (D5 cap). */
const VISIBLE_ROWS = 6;

/** Per-row stagger step in ms (D5: 40-60ms; mockup uses 50). */
const STAGGER_MS = 50;

/** A row is expandable only when it strands actions behind the single compact
 *  button, i.e. it carries more than one action. Zero-/single-action rows keep
 *  the unchanged compact affordance (the fast path is never regressed). */
function isExpandable(row: IslandRow): boolean {
  return row.actions.length > 1;
}

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
  /** Fire a SPECIFIC action of a row (the inline expansion buttons). Resolves
   *  exactly that row's waiter with that action id (A4) - clicking the secondary
   *  on row B's expansion fires (B, secondaryId), never crossing ids. */
  readonly onRowActionId: (id: string, actionId: string) => void;
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
  onRowActionId,
  onRowDismiss,
  onClearAll,
}: IslandListProps) {
  const { rows, merged } = snapshot;
  const scrolls = rows.length > VISIBLE_ROWS;
  const countText =
    `${rows.length}` + (merged > 0 ? ` · ${merged} merged` : "");
  // Accordion: at most one expanded row. Local view state - a snapshot replace or
  // a collapse-to-spotlight (this component unmounts) resets it (G10).
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
        {rows.map((row, i) => {
          const expandable = isExpandable(row);
          const isOpen = expandable && expandedId === row.id;
          const inner = (
            <>
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
            </>
          );
          return (
            <div
              key={row.id}
              className="di-lrow"
              data-testid="island-row"
              data-id={row.id}
              data-priority={row.priority}
              data-expanded={isOpen ? "true" : undefined}
              style={{ animationDelay: `${i * STAGGER_MS}ms` } as CSSProperties}
            >
              <div className="di-lrow-main">
                {expandable ? (
                  <button
                    type="button"
                    className="di-lrow-body"
                    data-testid="island-row-body"
                    data-id={row.id}
                    aria-expanded={isOpen}
                    aria-label={isOpen ? "Hide actions" : "Show all actions"}
                    onClick={() => setExpandedId(isOpen ? null : row.id)}
                  >
                    {inner}
                  </button>
                ) : (
                  <span className="di-lrow-body">{inner}</span>
                )}
                {!isOpen && (
                  <button
                    type="button"
                    className="di-lrow-act"
                    data-testid="island-row-action"
                    data-id={row.id}
                    onClick={() => onRowAction(row)}
                  >
                    {actionLabel(row)}
                  </button>
                )}
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
              {isOpen && (
                <div
                  className="di-lrow-expand"
                  data-testid="island-row-expand"
                  data-id={row.id}
                >
                  {row.body && <p className="di-lrow-msg">{row.body}</p>}
                  <div className="di-lrow-actions">
                    {row.actions.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        className={`action-button ${action.style}`}
                        style={buildActionStyle(action)}
                        data-testid="island-row-expand-action"
                        data-id={row.id}
                        data-action={action.id}
                        onClick={() => onRowActionId(row.id, action.id)}
                      >
                        {action.icon && (
                          <NotificationIcon name={action.icon} size={14} strokeWidth={2} />
                        )}
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div className="di-list-spacer" />
      </div>
    </div>
  );
}
