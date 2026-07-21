import type { NotificationPayload } from "@/types/notification";
import { NotificationIcon } from "@/components/overlay/NotificationIcon";
import { RelativeTime } from "@/components/overlay/RelativeTime";
import { useGoogleFont } from "@/hooks/useGoogleFont";

// Expanded card content for the island: icon / mono sender / title / body.
// Reuses the SAME `NotificationIcon` and `RelativeTime` as NotificationCard. The
// 27 `--s-*` overrides are published on the `.di-island` root (Island.tsx) so
// they reach both the SVG path and this content, resolving identically to the
// card (invariant c). No morph or lifecycle here (T4b/T5b) - pure render.

interface IslandExpandedProps {
  readonly notification: NotificationPayload;
}

export function IslandExpanded({ notification }: IslandExpandedProps) {
  const { sender, title, body, icon, font, createdAt } = notification;

  // Load a custom Google font when requested, exactly as the card does.
  useGoogleFont(font);

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
    </div>
  );
}
