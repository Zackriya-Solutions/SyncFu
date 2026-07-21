import type { NotificationPayload } from "@/types/notification";
import { NotificationIcon } from "@/components/overlay/NotificationIcon";
import { RelativeTime } from "@/components/overlay/RelativeTime";
import { useGoogleFont } from "@/hooks/useGoogleFont";
import { buildStyleVars } from "@/lib/styleVars";

// Expanded card content for the island: icon / mono sender / title / body.
// Reuses the SAME `buildStyleVars` map, `NotificationIcon`, and `RelativeTime`
// as NotificationCard so the 27 `--s-*` overrides resolve identically in card
// and island (invariant c). No morph or lifecycle here (T4b/T5b) - pure render.

interface IslandExpandedProps {
  readonly notification: NotificationPayload;
}

export function IslandExpanded({ notification }: IslandExpandedProps) {
  const { sender, title, body, icon, font, createdAt, style } = notification;

  // Load a custom Google font when requested, exactly as the card does.
  useGoogleFont(font);

  // Shared style map: every provided override becomes the same `--s-*` custom
  // property it does on the card (invariant c). Consumed by island.css.
  const styleVars = buildStyleVars(style, font);

  return (
    <div className="di-expanded" data-testid="island-expanded" style={styleVars}>
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
