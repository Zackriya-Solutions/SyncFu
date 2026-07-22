use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

/// Event sent to waiting CLI clients when a notification is resolved.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "event", rename_all = "lowercase")]
pub enum WaitEvent {
    /// SSE stream is connected and listening.
    Connected,
    /// User clicked an action button.
    Action {
        action_id: String,
    },
    /// Notification was dismissed (X button, timeout, or dismiss-all).
    Dismissed,
}

/// Registry of broadcast channels for notifications that have waiting CLI clients.
///
/// Each notification ID maps to a broadcast sender. When a notification is resolved
/// (action clicked or dismissed), the event is sent to all subscribers and the
/// entry is cleaned up.
pub struct WaiterRegistry {
    waiters: RwLock<HashMap<String, broadcast::Sender<WaitEvent>>>,
}

impl WaiterRegistry {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            waiters: RwLock::new(HashMap::new()),
        })
    }

    /// Subscribe to resolution events for a notification.
    /// Creates a new broadcast channel if one doesn't exist yet.
    /// Returns a receiver that will get the next event.
    pub async fn subscribe(&self, id: &str) -> broadcast::Receiver<WaitEvent> {
        self.subscribe_with_sender(id).await.1
    }

    /// Subscribe AND return a clone of the channel's sender alongside the receiver.
    /// The sender clone is the identity token the client-disconnect drop-guard needs
    /// (`remove_if_orphaned`): it lets cleanup remove the entry ONLY while it is still
    /// the same channel this subscription joined, never a fresh channel a later wait
    /// on the same id created after a `notify()` removed the original.
    pub async fn subscribe_with_sender(
        &self,
        id: &str,
    ) -> (broadcast::Sender<WaitEvent>, broadcast::Receiver<WaitEvent>) {
        let mut waiters = self.waiters.write().await;
        let sender = waiters
            .entry(id.to_string())
            .or_insert_with(|| broadcast::channel(4).0);
        (sender.clone(), sender.subscribe())
    }

    /// Remove the entry for `id` IFF it is still the same channel `sender` joined AND
    /// that channel has no remaining receivers. Returns whether an entry was removed.
    ///
    /// This is the client-disconnect cleanup (a `--wait` CLI dying / Ctrl+C). The two
    /// guards make it safe against the concurrency the registry allows:
    /// - `same_channel`: after a `notify()` removed the original channel, a later wait
    ///   on the same id creates a NEW channel; a late drop from the first stream must
    ///   not remove that fresh entry (identity, not just key, must match).
    /// - `receiver_count() == 0`: two concurrent waits on one id SHARE a channel; one
    ///   disconnecting must not evict the entry while the other is still listening.
    pub async fn remove_if_orphaned(
        &self,
        id: &str,
        sender: &broadcast::Sender<WaitEvent>,
    ) -> bool {
        let mut waiters = self.waiters.write().await;
        match waiters.get(id) {
            Some(existing)
                if existing.same_channel(sender) && existing.receiver_count() == 0 =>
            {
                waiters.remove(id);
                true
            }
            _ => false,
        }
    }

    /// Send an event to all subscribers waiting on this notification ID.
    /// Removes the entry afterward (notification is resolved).
    pub async fn notify(&self, id: &str, event: WaitEvent) {
        let mut waiters = self.waiters.write().await;
        if let Some(sender) = waiters.remove(id) {
            // Ignore send errors — means no active receivers (CLI disconnected)
            let _ = sender.send(event);
        }
    }

    /// Send a dismissed event to all waiting notifications (used by dismiss-all).
    pub async fn notify_all(&self, event: WaitEvent) {
        let mut waiters = self.waiters.write().await;
        for (_, sender) in waiters.drain() {
            let _ = sender.send(event.clone());
        }
    }

    /// The set of notification ids that currently have a pending waiter.
    ///
    /// Snapshotted by the island-snapshot emit site so the manager can enrich
    /// each row's `hasWaiter` and exempt waiter-bearing notifications from Model B
    /// dedupe (A4 / R-WAIT-ID). The registry stays keyed strictly by id; this only
    /// exposes its key set, it never changes waiter identity or lifetime.
    pub async fn active_ids(&self) -> std::collections::HashSet<String> {
        self.waiters.read().await.keys().cloned().collect()
    }

    /// Number of notifications with active waiters (for testing/debugging).
    #[cfg(test)]
    pub async fn waiter_count(&self) -> usize {
        self.waiters.read().await.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_subscribe_creates_channel() {
        let registry = WaiterRegistry::new();
        let _rx = registry.subscribe("n1").await;
        assert_eq!(registry.waiter_count().await, 1);
    }

    #[tokio::test]
    async fn test_notify_sends_action_event() {
        let registry = WaiterRegistry::new();
        let mut rx = registry.subscribe("n1").await;

        registry
            .notify("n1", WaitEvent::Action { action_id: "approve".to_string() })
            .await;

        let event = rx.recv().await.unwrap();
        assert_eq!(event, WaitEvent::Action { action_id: "approve".to_string() });
    }

    #[tokio::test]
    async fn test_notify_sends_dismissed_event() {
        let registry = WaiterRegistry::new();
        let mut rx = registry.subscribe("n1").await;

        registry.notify("n1", WaitEvent::Dismissed).await;

        let event = rx.recv().await.unwrap();
        assert_eq!(event, WaitEvent::Dismissed);
    }

    #[tokio::test]
    async fn test_notify_removes_entry() {
        let registry = WaiterRegistry::new();
        let _rx = registry.subscribe("n1").await;
        assert_eq!(registry.waiter_count().await, 1);

        registry.notify("n1", WaitEvent::Dismissed).await;
        assert_eq!(registry.waiter_count().await, 0);
    }

    #[tokio::test]
    async fn test_notify_nonexistent_is_noop() {
        let registry = WaiterRegistry::new();
        // Should not panic
        registry.notify("nonexistent", WaitEvent::Dismissed).await;
    }

    #[tokio::test]
    async fn test_notify_all_sends_to_all_waiters() {
        let registry = WaiterRegistry::new();
        let mut rx1 = registry.subscribe("n1").await;
        let mut rx2 = registry.subscribe("n2").await;

        registry.notify_all(WaitEvent::Dismissed).await;

        assert_eq!(rx1.recv().await.unwrap(), WaitEvent::Dismissed);
        assert_eq!(rx2.recv().await.unwrap(), WaitEvent::Dismissed);
        assert_eq!(registry.waiter_count().await, 0);
    }

    #[tokio::test]
    async fn test_multiple_subscribers_same_notification() {
        let registry = WaiterRegistry::new();
        let mut rx1 = registry.subscribe("n1").await;
        let mut rx2 = registry.subscribe("n1").await;

        registry
            .notify("n1", WaitEvent::Action { action_id: "ok".to_string() })
            .await;

        let e1 = rx1.recv().await.unwrap();
        let e2 = rx2.recv().await.unwrap();
        assert_eq!(e1, WaitEvent::Action { action_id: "ok".to_string() });
        assert_eq!(e2, WaitEvent::Action { action_id: "ok".to_string() });
    }

    #[tokio::test]
    async fn test_notify_with_no_receivers_cleans_up() {
        let registry = WaiterRegistry::new();
        let rx = registry.subscribe("n1").await;
        drop(rx); // Simulate CLI disconnect

        // Should not panic, just clean up
        registry.notify("n1", WaitEvent::Dismissed).await;
        assert_eq!(registry.waiter_count().await, 0);
    }

    #[tokio::test]
    async fn test_remove_if_orphaned_removes_dead_subscription() {
        // A --wait client that disconnects (its receiver dropped) leaves a channel
        // with zero receivers; cleanup removes it so the notification stops looking
        // like it has a live waiter forever.
        let registry = WaiterRegistry::new();
        let (sender, rx) = registry.subscribe_with_sender("n1").await;
        assert_eq!(registry.waiter_count().await, 1);
        drop(rx); // client disconnect
        assert!(registry.remove_if_orphaned("n1", &sender).await);
        assert_eq!(registry.waiter_count().await, 0);
    }

    #[tokio::test]
    async fn test_remove_if_orphaned_keeps_live_subscription() {
        // While a receiver is still listening, cleanup from a sibling stream must not
        // evict the entry (two concurrent waits on one id share the channel).
        let registry = WaiterRegistry::new();
        let (sender, _rx) = registry.subscribe_with_sender("n1").await;
        assert!(!registry.remove_if_orphaned("n1", &sender).await);
        assert_eq!(registry.waiter_count().await, 1);
    }

    #[tokio::test]
    async fn test_remove_if_orphaned_ignores_replaced_channel() {
        // Sequential waits on ONE id: the first resolves (notify removes its channel),
        // a second wait creates a FRESH channel, then the first stream's LATE drop
        // fires cleanup. It must not kill the second wait's entry - identity differs.
        let registry = WaiterRegistry::new();
        let (sender1, rx1) = registry.subscribe_with_sender("n1").await;
        registry.notify("n1", WaitEvent::Dismissed).await; // resolves + removes channel 1
        let _ = rx1; // first client's receiver, now stale
        drop(rx1);

        let (_sender2, _rx2) = registry.subscribe_with_sender("n1").await; // fresh channel
        assert_eq!(registry.waiter_count().await, 1);

        // The first stream disconnects late: its stale sender must match nothing.
        assert!(!registry.remove_if_orphaned("n1", &sender1).await);
        assert_eq!(registry.waiter_count().await, 1, "second wait's entry survives");
    }

    #[tokio::test]
    async fn test_remove_if_orphaned_two_concurrent_waits_drain_one_at_a_time() {
        // Two waits share one channel. Each disconnect only removes the entry once the
        // LAST receiver is gone (receiver_count guard).
        let registry = WaiterRegistry::new();
        let (sender, rx_a) = registry.subscribe_with_sender("n1").await;
        let (_sender_b, rx_b) = registry.subscribe_with_sender("n1").await; // same channel
        assert_eq!(registry.waiter_count().await, 1);

        drop(rx_a);
        assert!(!registry.remove_if_orphaned("n1", &sender).await); // rx_b still listens
        assert_eq!(registry.waiter_count().await, 1);

        drop(rx_b);
        assert!(registry.remove_if_orphaned("n1", &sender).await);
        assert_eq!(registry.waiter_count().await, 0);
    }

    #[tokio::test]
    async fn test_remove_if_orphaned_after_notify_is_noop() {
        // notify() already removed the entry; a following guard drop double-remove is
        // a harmless no-op (nothing to reconcile).
        let registry = WaiterRegistry::new();
        let (sender, rx) = registry.subscribe_with_sender("n1").await;
        registry.notify("n1", WaitEvent::Dismissed).await;
        drop(rx);
        assert!(!registry.remove_if_orphaned("n1", &sender).await);
        assert_eq!(registry.waiter_count().await, 0);
    }

    #[tokio::test]
    async fn test_wait_event_serialization() {
        let connected = serde_json::to_string(&WaitEvent::Connected).unwrap();
        assert_eq!(connected, r#"{"event":"connected"}"#);

        let action = serde_json::to_string(&WaitEvent::Action {
            action_id: "deploy".to_string(),
        })
        .unwrap();
        assert_eq!(action, r#"{"event":"action","action_id":"deploy"}"#);

        let dismissed = serde_json::to_string(&WaitEvent::Dismissed).unwrap();
        assert_eq!(dismissed, r#"{"event":"dismissed"}"#);
    }
}
