import { useEffect, useCallback, useRef } from "react";
import { event as tauriEvent, core } from "@tauri-apps/api";
import { useNotificationStore } from "@/stores/notificationStore";
import type { NotificationPayload } from "@/types/notification";

/**
 * @param ingestFilter Optional predicate applied to each incoming
 *   `notification:add` payload BEFORE it enters the store. Payloads that fail the
 *   predicate are dropped at ingest and never occupy a MAX_VISIBLE slot. The
 *   island window passes `n => n.presentation === "island"` so broadcast `card`
 *   adds cannot fill (and thus starve) the island window's shared store.
 */
export function useNotifications(
  ingestFilter?: (n: NotificationPayload) => boolean,
) {
  const notifications = useNotificationStore((s) => s.notifications);
  const add = useNotificationStore((s) => s.add);
  const storeDismiss = useNotificationStore((s) => s.dismiss);
  const storeDismissAll = useNotificationStore((s) => s.dismissAll);

  // Hold the latest predicate in a ref so a new inline predicate on each render
  // does not re-subscribe the listeners (effect deps stay stable).
  const ingestFilterRef = useRef(ingestFilter);
  ingestFilterRef.current = ingestFilter;

  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    const setup = async () => {
      const unAdd = await tauriEvent.listen<NotificationPayload>(
        "notification:add",
        (ev) => {
          const payload = ev.payload as NotificationPayload;
          if (ingestFilterRef.current && !ingestFilterRef.current(payload)) {
            return;
          }
          console.log("[syncfu] Received notification:add", payload);
          add(payload);
        }
      );
      unlisteners.push(unAdd);

      const unDismiss = await tauriEvent.listen<string>(
        "notification:dismiss",
        (ev) => {
          storeDismiss(ev.payload as string);
        }
      );
      unlisteners.push(unDismiss);

      const unDismissAll = await tauriEvent.listen<number>(
        "notification:dismiss-all",
        () => {
          storeDismissAll();
        }
      );
      unlisteners.push(unDismissAll);
    };

    setup();

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [add, storeDismiss, storeDismissAll]);

  const dismiss = useCallback(
    (id: string) => {
      storeDismiss(id);
      // Also dismiss on the backend so the panel hides when empty
      core.invoke("dismiss_notification", { id }).catch(() => {});
    },
    [storeDismiss]
  );

  const dismissAll = useCallback(() => {
    storeDismissAll();
    core.invoke("dismiss_all").catch(() => {});
  }, [storeDismissAll]);

  return {
    notifications,
    dismiss,
    dismissAll,
  } as const;
}
