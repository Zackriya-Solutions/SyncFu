import type { NotificationPayload } from "@/types/notification";

// Compact pill content: leading glyph (accent dot) / label / trailing
// live-activity slot. Mirrors the mockup's `.di-compact` anatomy (rev 8). Static
// in T4a - the trailing slot is a mount point that T4b/T5b (timers, ring, xN
// badge) fill; here it is intentionally empty.

interface IslandCompactProps {
  readonly notification: NotificationPayload;
}

export function IslandCompact({ notification }: IslandCompactProps) {
  const { sender } = notification;

  return (
    <div className="di-compact" data-testid="island-compact">
      <span className="di-dot" data-testid="island-compact-glyph" />
      <span className="di-sender">{sender}</span>
      <span className="di-trailing" data-testid="island-compact-trailing" />
    </div>
  );
}
