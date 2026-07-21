import type { CSSProperties } from "react";
import type { ActionStyle, NotificationPayload } from "@/types/notification";
import { NotificationIcon } from "@/components/overlay/NotificationIcon";
import { RelativeTime } from "@/components/overlay/RelativeTime";
import { useGoogleFont } from "@/hooks/useGoogleFont";
import { resolveTimeout } from "@/lib/timeout";
import { buildActionStyle } from "@/lib/actionStyle";

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

interface IslandExpandedProps {
  readonly notification: NotificationPayload;
  /** Reuses the card's action path: host wires this to `action_callback`. */
  readonly onAction?: (notificationId: string, actionId: string) => void;
}

export function IslandExpanded({ notification, onAction }: IslandExpandedProps) {
  const { id, sender, title, body, icon, font, createdAt, actions, priority, timeout } =
    notification;

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
