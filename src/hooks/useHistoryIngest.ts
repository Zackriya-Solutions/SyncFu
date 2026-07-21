import { useEffect } from "react";
import { event as tauriEvent } from "@tauri-apps/api";
import { useHistoryStore } from "@/stores/historyStore";
import type { HistoryEntry, NotificationPayload } from "@/types/notification";

/**
 * Records every notification into the frontend history store, once.
 *
 * Why this shape (post-T6 ground truth): the island window renders from the
 * Rust-owned `island:snapshot` and does NOT run `useNotifications`, and Zustand
 * stores do not cross Tauri windows. `HistoryView` lives in the MAIN window, so
 * history must be ingested there. The backend broadcasts one presentation-agnostic
 * `history:add` event per accepted notification (card AND island), which is the
 * single shared ingest point. Mount this hook ONCE in the main window; the store's
 * `prependEntry` is idempotent by id as the double-ingest guard.
 */
function toHistoryEntry(p: NotificationPayload): HistoryEntry {
  return {
    id: p.id,
    sender: p.sender,
    title: p.title,
    body: p.body,
    priority: p.priority,
    groupKey: p.group,
    actionsJson:
      p.actions && p.actions.length > 0 ? JSON.stringify(p.actions) : undefined,
    createdAt: p.createdAt,
  };
}

export function useHistoryIngest() {
  const prependEntry = useHistoryStore((s) => s.prependEntry);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;

    (async () => {
      const un = await tauriEvent.listen<NotificationPayload>(
        "history:add",
        (ev) => {
          const payload = ev.payload as NotificationPayload;
          if (!payload || !payload.id) return;
          prependEntry(toHistoryEntry(payload));
        }
      );
      if (active) unlisten = un;
      else un();
    })();

    return () => {
      active = false;
      unlisten?.();
    };
  }, [prependEntry]);
}
