import type { CSSProperties } from "react";
import type {
  ActionStyle,
  NotificationPayload,
  ProgressInfo,
} from "@/types/notification";
import { NotificationIcon } from "@/components/overlay/NotificationIcon";
import { RelativeTime } from "@/components/overlay/RelativeTime";
import { useGoogleFont } from "@/hooks/useGoogleFont";
import { resolveTimeout } from "@/lib/timeout";
import { buildActionStyle } from "@/lib/actionStyle";
import { progressPercent, ringDash } from "@/lib/progress";

// Expanded card content for the island: icon / mono sender / title / body, plus
// (T5a) the action buttons and the auto-dismiss countdown - functional parity
// with NotificationCard. The action INVOCATION reuses the card's path verbatim:
// a click calls `onAction(id, actionId)`, which the host wires to
// `invoke("action_callback", ...)` -> WaiterRegistry -> CLI exit 0 (no new
// transport; see IslandOverlay). Timeout resolution is the SHARED resolveTimeout
// (parity: no island-specific timing).
//
// Countdown semantics mirror the card VISUAL but honor the island lifecycle
// (synthesis 1.1: "auto-dismiss is paused while a decision is open"): the bar
// renders for any non-critical notification, but it only ANIMATES (counts down)
// when the notification actually auto-dismisses - i.e. NOT a decision. A decision
// (actions present) shows the bar full and static (paused), because the island
// keeps it expanded until answered while Island.tsx suppresses its auto-dismiss.
// The 27 `--s-*` overrides are published on the `.di-island` root (Island.tsx).

/** Map a payload ActionStyle to the mockup's `di-btn2` button variants. */
const ACTION_CLASS: Record<ActionStyle, string> = {
  primary: "di-btn2 accent",
  secondary: "di-btn2",
  danger: "di-btn2 danger",
};

/** Big-ring radius in the shared 24x24 viewBox (sized via CSS). */
const RING_R = 10;

/** Progress render (T5b): a bar (default) or a real ring per the payload's
 *  ProgressStyle, mirroring the mockup's `.ex-progress` / `.ring-wrap` anatomy.
 *  Colors honor the shared `--s-progress-*` overrides (invariant c parity with the
 *  card). The fill is a declarative width / stroke-dashoffset (CSS-eased, no rAF -
 *  R-PERF). A value change never resizes the OS frame (D3); the content height is
 *  unchanged so the morph loop rests. */
function IslandProgress({ progress }: { progress: ProgressInfo }) {
  const pct = progressPercent(progress.value);
  if (progress.style === "ring") {
    const { dashArray, dashOffset } = ringDash(progress.value, RING_R);
    return (
      <div className="di-ring-wrap" data-testid="island-progress" data-style="ring">
        <svg
          className="di-ring"
          viewBox="0 0 24 24"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <circle className="di-ring-track" cx="12" cy="12" r={RING_R} />
          <circle
            className="di-ring-fill"
            cx="12"
            cy="12"
            r={RING_R}
            strokeDasharray={dashArray}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <div className="di-ring-meta">
          <div className="di-ring-pct">{pct}%</div>
          {progress.label && <div className="di-ring-label">{progress.label}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className="di-progress" data-testid="island-progress" data-style="bar">
      <div
        className="di-pbar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <i className="di-pbar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="di-plabel">
        <span>{progress.label ?? "working"}</span>
        <span>{pct}%</span>
      </div>
    </div>
  );
}

interface IslandExpandedProps {
  readonly notification: NotificationPayload;
  /** Reuses the card's action path: host wires this to `action_callback`. */
  readonly onAction?: (notificationId: string, actionId: string) => void;
  /** Dismiss affordance (T15): the hover-visible close button resolves the SAME
   *  exit-1 path the card's close uses (dismiss_notification -> waiter Dismissed).
   *  The primary fix for CRITICAL no-action notifications, which never auto-dismiss
   *  and carry no action buttons - previously undismissable from the island UI. */
  readonly onDismiss?: (notificationId: string) => void;
}

export function IslandExpanded({ notification, onAction, onDismiss }: IslandExpandedProps) {
  const {
    id,
    sender,
    title,
    body,
    icon,
    font,
    createdAt,
    actions,
    priority,
    timeout,
    progress,
  } = notification;

  // Load a custom Google font when requested, exactly as the card does.
  useGoogleFont(font);

  const autoDismissMs = resolveTimeout(timeout, priority);
  const isDecision = actions.length > 0;
  // Countdown animates only when the island will actually auto-dismiss. A
  // decision stays expanded until answered (auto-dismiss paused), so its bar is
  // shown paused - never a running bar that empties and dismisses nothing.
  const countdownRunning = autoDismissMs !== null && !isDecision;

  return (
    <div className="di-expanded" data-testid="island-expanded">
      {onDismiss && (
        <button
          type="button"
          className="di-close"
          data-testid="island-close"
          aria-label="Dismiss"
          // stopPropagation belts the interactive-element guard in Island.tsx's
          // click-to-collapse handler (which already ignores `button`): the close
          // must dismiss, never toggle the expanded<->compact surface.
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(id);
          }}
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
      )}
      <div className="di-erow">
        {icon && (
          <div className="di-icon">
            <NotificationIcon name={icon} size={18} strokeWidth={1.8} />
          </div>
        )}
        <div className="di-etext">
          <div className="di-ehead">
            <span className="di-sender">{sender}</span>
            <RelativeTime iso={createdAt} />
          </div>
          <div className="di-title">{title}</div>
          {body && <div className="di-msg">{body}</div>}
        </div>
      </div>

      {progress && <IslandProgress progress={progress} />}

      {isDecision && (
        <div className="di-actions2" data-testid="island-actions">
          {actions.map((action) => (
            <button
              key={action.id}
              className={ACTION_CLASS[action.style]}
              style={buildActionStyle(action)}
              onClick={() => onAction?.(id, action.id)}
            >
              {action.icon && (
                <NotificationIcon name={action.icon} size={13} strokeWidth={2} />
              )}
              {action.label}
            </button>
          ))}
        </div>
      )}

      {autoDismissMs !== null && (
        <div className="di-countdown" data-testid="island-countdown">
          <i
            className={countdownRunning ? "di-countdown-fill running" : "di-countdown-fill"}
            style={{ "--countdown-duration": `${autoDismissMs}ms` } as CSSProperties}
          />
        </div>
      )}
    </div>
  );
}
