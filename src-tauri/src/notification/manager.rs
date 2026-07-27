use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use indexmap::IndexMap;
use serde::Serialize;
use tokio::sync::RwLock;

use super::types::{NotificationPayload, NotificationUpdate, Presentation, Priority};

const MAX_VISIBLE: usize = 5;

/// One row of the Model B island snapshot: the notification plus `hasWaiter`,
/// which is computed against the `WaiterRegistry` at emit time (NEVER a
/// sender-settable payload field - G12). The notification is flattened so the
/// frontend row type is exactly `NotificationPayload & { hasWaiter }`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandRow {
    #[serde(flatten)]
    pub notification: NotificationPayload,
    pub has_waiter: bool,
}

impl IslandRow {
    fn of(notification: &NotificationPayload, has_waiter: bool) -> Self {
        Self {
            notification: notification.clone(),
            has_waiter,
        }
    }
}

/// The authoritative Model B island view (D5), owned by Rust (guard G10 / C1).
/// The frontend `IslandList` renders this DUMBLY and never re-derives it from the
/// store queue (which provably diverges - W1-W4, 85-verify A3).
///
/// `count` is the TOTAL island notification count (drives the `xN` badge). `rows`
/// is the FULL priority-ranked, deduped list; the 6-row / 560px cap is a VISUAL
/// concern the frontend enforces via scroll containment, so the list can scroll
/// past 6 (D5 "capped 6 rows/560px then scrolls"). `merged = count - rows.len()`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandSnapshot {
    pub count: usize,
    pub badge_label: String,
    pub badge_width: u32,
    pub merged: usize,
    pub spotlight: Option<IslandRow>,
    pub rows: Vec<IslandRow>,
}

/// Sort key for Model B ranking: critical first, then high/normal/low.
fn priority_order(priority: Priority) -> u8 {
    match priority {
        Priority::Critical => 0,
        Priority::High => 1,
        Priority::Normal => 2,
        Priority::Low => 3,
    }
}

/// Badge label + pill width (mockup rev 8 `badgeInfo`, L1310). Displayed label
/// caps at `"9+"`; width is `26 + 8*(digits-1)` over the DISPLAYED label length,
/// so anything above 9 is `"9+"` at width 34.
fn badge_info(count: usize) -> (String, u32) {
    let label = if count > 9 {
        "9+".to_string()
    } else {
        count.to_string()
    };
    let width = 26 + 8 * (label.chars().count() as u32 - 1);
    (label, width)
}

/// Dedupe key: `group ?? sender::title` (architecture C6, adopted everywhere).
fn dedupe_key(n: &NotificationPayload) -> String {
    n.group
        .clone()
        .unwrap_or_else(|| format!("{}::{}", n.sender, n.title))
}

/// Pure Model B snapshot builder over a set of island notifications and the ids
/// that currently have a pending waiter. Kept free of locks/async so ranking,
/// dedupe, waiter-exemption, cap, spotlight and badge are all unit-testable.
///
/// Waiter-exemption (A4 / R-WAIT-ID): a notification with a pending waiter is
/// NEVER merged - it always keeps its own row and 1:1 id, preserving `--wait`
/// exit-code identity. Two waiters sharing a dedupe key therefore resolve as two
/// distinct rows. Non-waiter duplicates collapse to the highest-ranked survivor.
fn build_snapshot(items: &[NotificationPayload], waiter_ids: &HashSet<String>) -> IslandSnapshot {
    let mut ranked: Vec<&NotificationPayload> = items.iter().collect();
    ranked.sort_by(|a, b| {
        priority_order(a.priority)
            .cmp(&priority_order(b.priority))
            // recency: newest first within a priority
            .then_with(|| b.created_at.cmp(&a.created_at))
            // total order for deterministic snapshots when timestamps tie
            .then_with(|| a.id.cmp(&b.id))
    });

    let spotlight = ranked
        .first()
        .map(|n| IslandRow::of(n, waiter_ids.contains(&n.id)));

    let mut seen: HashSet<String> = HashSet::new();
    let mut rows: Vec<IslandRow> = Vec::new();
    for n in &ranked {
        let has_waiter = waiter_ids.contains(&n.id);
        if has_waiter {
            rows.push(IslandRow::of(n, true));
        } else if seen.insert(dedupe_key(n)) {
            rows.push(IslandRow::of(n, false));
        }
    }

    let count = items.len();
    let merged = count - rows.len();
    let (badge_label, badge_width) = badge_info(count);
    IslandSnapshot {
        count,
        badge_label,
        badge_width,
        merged,
        spotlight,
        rows,
    }
}

pub struct NotificationManager {
    active: RwLock<IndexMap<String, NotificationPayload>>,
    groups: RwLock<HashMap<String, Vec<String>>>,
    queued: RwLock<Vec<NotificationPayload>>,
}

impl NotificationManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            active: RwLock::new(IndexMap::new()),
            groups: RwLock::new(HashMap::new()),
            queued: RwLock::new(Vec::new()),
        })
    }

    pub async fn add(&self, payload: NotificationPayload) -> String {
        let id = payload.id.clone();

        // Track group membership
        if let Some(ref group) = payload.group {
            let mut groups = self.groups.write().await;
            groups
                .entry(group.clone())
                .or_default()
                .push(id.clone());
        }

        let mut active = self.active.write().await;

        // Remove existing with same id (replacement)
        active.shift_remove(&id);

        if active.len() >= MAX_VISIBLE {
            // Queue overflow
            let mut queued = self.queued.write().await;
            queued.push(payload);
        } else {
            active.insert(id.clone(), payload);
        }

        id
    }

    pub async fn dismiss(&self, id: &str) -> Option<NotificationPayload> {
        let mut active = self.active.write().await;
        let removed = active.shift_remove(id);

        if removed.is_some() {
            // Promote from queue if available
            let mut queued = self.queued.write().await;
            if !queued.is_empty() && active.len() < MAX_VISIBLE {
                let promoted = queued.remove(0);
                let promoted_id = promoted.id.clone();
                active.insert(promoted_id, promoted);
            }
        }

        removed
    }

    pub async fn dismiss_all(&self) -> Vec<NotificationPayload> {
        let mut active = self.active.write().await;
        let mut queued = self.queued.write().await;
        let mut dismissed: Vec<NotificationPayload> =
            active.drain(..).map(|(_, v)| v).collect();
        dismissed.extend(queued.drain(..));
        dismissed
    }

    pub async fn update(&self, id: &str, partial: NotificationUpdate) -> bool {
        let mut active = self.active.write().await;
        if let Some(notification) = active.get_mut(id) {
            if let Some(body) = partial.body {
                notification.body = body;
            }
            if let Some(progress) = partial.progress {
                notification.progress = Some(progress);
            }
            true
        } else {
            false
        }
    }

    pub async fn get(&self, id: &str) -> Option<NotificationPayload> {
        let active = self.active.read().await;
        active.get(id).cloned()
    }

    pub async fn active_count(&self) -> usize {
        self.active.read().await.len()
    }

    /// Active count for ONE presentation. The hide/track lifecycle is per-window
    /// (review P2): the island window (and its cursor tracker) must be torn down
    /// when the island count hits 0 even if cards remain, and vice versa - gating
    /// on the GLOBAL count leaked the ~10Hz island poll whenever an island was
    /// emptied while a card outlived it.
    pub async fn active_count_for(&self, presentation: Presentation) -> usize {
        self.active
            .read()
            .await
            .values()
            .filter(|n| n.presentation == presentation)
            .count()
    }

    pub async fn list_active(&self) -> Vec<NotificationPayload> {
        self.active.read().await.values().cloned().collect()
    }

    /// Build the authoritative Model B island snapshot (D5 / G10). Considers ALL
    /// island-presentation notifications - active AND queued - so the ranked list
    /// is never starved by `MAX_VISIBLE` (the interim store-pollution note, T4a).
    /// `waiter_ids` is the live `WaiterRegistry` key set, snapshotted by the emit
    /// site at emit time, so `hasWaiter` enrichment is computed here, not settable.
    pub async fn island_snapshot(&self, waiter_ids: &HashSet<String>) -> IslandSnapshot {
        let active = self.active.read().await;
        let queued = self.queued.read().await;
        let items: Vec<NotificationPayload> = active
            .values()
            .chain(queued.iter())
            .filter(|n| n.presentation == Presentation::Island)
            .cloned()
            .collect();
        build_snapshot(&items, waiter_ids)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notification::types::{Presentation, Priority, Timeout};

    fn make_notification(id: &str) -> NotificationPayload {
        NotificationPayload {
            id: id.to_string(),
            sender: "test".to_string(),
            title: format!("Test {id}"),
            body: "body".to_string(),
            icon: None,
            priority: Priority::Normal,
            presentation: Presentation::Card,
            timeout: Timeout::default(),
            actions: vec![],
            progress: None,
            group: None,
            theme: None,
            sound: None,
            callback_url: None,
            style: None,
            created_at: chrono::Utc::now(),
        }
    }

    #[tokio::test]
    async fn test_add_and_get() {
        let mgr = NotificationManager::new();
        let id = mgr.add(make_notification("n1")).await;
        assert_eq!(id, "n1");

        let n = mgr.get("n1").await.unwrap();
        assert_eq!(n.title, "Test n1");
    }

    #[tokio::test]
    async fn test_add_replaces_same_id() {
        let mgr = NotificationManager::new();
        let mut n = make_notification("n1");
        mgr.add(n.clone()).await;

        n.title = "Updated".to_string();
        mgr.add(n).await;

        assert_eq!(mgr.active_count().await, 1);
        let stored = mgr.get("n1").await.unwrap();
        assert_eq!(stored.title, "Updated");
    }

    #[tokio::test]
    async fn test_dismiss() {
        let mgr = NotificationManager::new();
        mgr.add(make_notification("n1")).await;

        let dismissed = mgr.dismiss("n1").await;
        assert!(dismissed.is_some());
        assert_eq!(mgr.active_count().await, 0);
    }

    #[tokio::test]
    async fn test_dismiss_unknown_returns_none() {
        let mgr = NotificationManager::new();
        let result = mgr.dismiss("unknown").await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_max_visible_queues_overflow() {
        let mgr = NotificationManager::new();
        for i in 0..7 {
            mgr.add(make_notification(&format!("n{i}"))).await;
        }

        assert_eq!(mgr.active_count().await, 5);
        let queued = mgr.queued.read().await;
        assert_eq!(queued.len(), 2);
    }

    #[tokio::test]
    async fn test_dismiss_promotes_from_queue() {
        let mgr = NotificationManager::new();
        for i in 0..6 {
            mgr.add(make_notification(&format!("n{i}"))).await;
        }

        mgr.dismiss("n0").await;
        assert_eq!(mgr.active_count().await, 5);
        assert!(mgr.queued.read().await.is_empty());
    }

    #[tokio::test]
    async fn test_dismiss_all() {
        let mgr = NotificationManager::new();
        for i in 0..7 {
            mgr.add(make_notification(&format!("n{i}"))).await;
        }

        let dismissed = mgr.dismiss_all().await;
        assert_eq!(dismissed.len(), 7);
        assert_eq!(mgr.active_count().await, 0);
    }

    #[tokio::test]
    async fn test_update_body() {
        let mgr = NotificationManager::new();
        mgr.add(make_notification("n1")).await;

        let updated = mgr
            .update(
                "n1",
                NotificationUpdate {
                    body: Some("new body".to_string()),
                    progress: None,
                },
            )
            .await;

        assert!(updated);
        let n = mgr.get("n1").await.unwrap();
        assert_eq!(n.body, "new body");
    }

    #[tokio::test]
    async fn test_update_unknown_returns_false() {
        let mgr = NotificationManager::new();
        let result = mgr
            .update(
                "unknown",
                NotificationUpdate {
                    body: Some("x".to_string()),
                    progress: None,
                },
            )
            .await;
        assert!(!result);
    }

    #[tokio::test]
    async fn test_list_active() {
        let mgr = NotificationManager::new();
        mgr.add(make_notification("n1")).await;
        mgr.add(make_notification("n2")).await;

        let active = mgr.list_active().await;
        assert_eq!(active.len(), 2);
    }

    // ---- Model B island snapshot (T6) --------------------------------------

    fn island(id: &str, sender: &str, title: &str, priority: Priority) -> NotificationPayload {
        let mut n = make_notification(id);
        n.sender = sender.to_string();
        n.title = title.to_string();
        n.priority = priority;
        n.presentation = Presentation::Island;
        n
    }

    fn no_waiters() -> HashSet<String> {
        HashSet::new()
    }

    #[test]
    fn test_badge_formula_1_to_9_shows_digit() {
        assert_eq!(badge_info(2), ("2".to_string(), 26));
        assert_eq!(badge_info(9), ("9".to_string(), 26));
    }

    #[test]
    fn test_badge_formula_caps_at_9plus_width_34() {
        // Above 9 the label is always "9+" (2 chars) -> 26 + 8*(2-1) = 34.
        assert_eq!(badge_info(10), ("9+".to_string(), 34));
        assert_eq!(badge_info(100), ("9+".to_string(), 34));
    }

    #[test]
    fn test_ranking_critical_first_then_recency() {
        let mut low = island("a", "s", "low", Priority::Low);
        low.created_at = chrono::Utc::now();
        let mut crit = island("b", "s", "crit", Priority::Critical);
        crit.created_at = low.created_at + chrono::Duration::seconds(1);
        let mut normal_old = island("c", "s", "n-old", Priority::Normal);
        normal_old.created_at = low.created_at + chrono::Duration::seconds(2);
        let mut normal_new = island("d", "s", "n-new", Priority::Normal);
        normal_new.created_at = low.created_at + chrono::Duration::seconds(3);

        let snap = build_snapshot(&[low, crit, normal_old, normal_new], &no_waiters());
        let order: Vec<&str> = snap.rows.iter().map(|r| r.notification.id.as_str()).collect();
        // critical, then normals newest-first, then low
        assert_eq!(order, vec!["b", "d", "c", "a"]);
        assert_eq!(snap.spotlight.unwrap().notification.id, "b");
    }

    #[test]
    fn test_dedupe_key_group_over_sender_title() {
        let mut a = island("a", "ci", "Build failed", Priority::Normal);
        a.group = Some("ci".to_string());
        let mut b = island("b", "OTHER", "OTHER", Priority::Normal);
        b.group = Some("ci".to_string());
        // Same group -> one survives despite different sender/title.
        let snap = build_snapshot(&[a, b], &no_waiters());
        assert_eq!(snap.rows.len(), 1);
        assert_eq!(snap.count, 2);
        assert_eq!(snap.merged, 1);
    }

    #[test]
    fn test_dedupe_key_sender_title_when_no_group() {
        let a = island("a", "ci", "Build failed", Priority::Normal);
        let b = island("b", "ci", "Build failed", Priority::Normal);
        let c = island("c", "ci", "Deploy done", Priority::Normal);
        let snap = build_snapshot(&[a, b, c], &no_waiters());
        assert_eq!(snap.rows.len(), 2); // two distinct sender::title
        assert_eq!(snap.merged, 1);
    }

    #[test]
    fn test_waiter_exemption_never_merges_two_same_key_waiters() {
        // A4 / R-WAIT-ID: two --wait notifications sharing a dedupe key must both
        // keep their own row so each maps 1:1 to its own waiter (exit-code safe).
        let a = island("wait-a", "ci", "Approve deploy?", Priority::High);
        let b = island("wait-b", "ci", "Approve deploy?", Priority::High);
        let waiters: HashSet<String> = ["wait-a".to_string(), "wait-b".to_string()].into();
        let snap = build_snapshot(&[a, b], &waiters);
        assert_eq!(snap.rows.len(), 2, "both waiter rows must survive dedupe");
        assert_eq!(snap.merged, 0);
        let ids: HashSet<&str> = snap.rows.iter().map(|r| r.notification.id.as_str()).collect();
        assert!(ids.contains("wait-a") && ids.contains("wait-b"));
    }

    #[test]
    fn test_has_waiter_enrichment_per_row() {
        let a = island("a", "ci", "t1", Priority::Normal);
        let b = island("b", "ci", "t2", Priority::Normal);
        let waiters: HashSet<String> = ["a".to_string()].into();
        let snap = build_snapshot(&[a, b], &waiters);
        let a_row = snap.rows.iter().find(|r| r.notification.id == "a").unwrap();
        let b_row = snap.rows.iter().find(|r| r.notification.id == "b").unwrap();
        assert!(a_row.has_waiter);
        assert!(!b_row.has_waiter);
    }

    #[test]
    fn test_spotlight_is_top_ranked() {
        let low = island("a", "s", "low", Priority::Low);
        let high = island("b", "s", "high", Priority::High);
        let snap = build_snapshot(&[low, high], &no_waiters());
        assert_eq!(snap.spotlight.unwrap().notification.id, "b");
    }

    #[test]
    fn test_snapshot_determinism_is_input_order_independent() {
        let mut a = island("a", "s", "t", Priority::Normal);
        let mut b = island("b", "s", "u", Priority::Normal);
        let mut c = island("c", "s", "v", Priority::High);
        let base = chrono::Utc::now();
        a.created_at = base;
        b.created_at = base; // identical timestamp -> id tiebreak
        c.created_at = base;
        let s1 = build_snapshot(&[a.clone(), b.clone(), c.clone()], &no_waiters());
        let s2 = build_snapshot(&[c, b, a], &no_waiters());
        let ids1: Vec<_> = s1.rows.iter().map(|r| r.notification.id.clone()).collect();
        let ids2: Vec<_> = s2.rows.iter().map(|r| r.notification.id.clone()).collect();
        assert_eq!(ids1, ids2);
    }

    #[test]
    fn test_empty_snapshot() {
        let snap = build_snapshot(&[], &no_waiters());
        assert_eq!(snap.count, 0);
        assert!(snap.spotlight.is_none());
        assert!(snap.rows.is_empty());
        assert_eq!(snap.badge_label, "0");
    }

    #[tokio::test]
    async fn test_island_snapshot_only_island_presentation() {
        let mgr = NotificationManager::new();
        mgr.add(make_notification("card1")).await; // Card by default
        mgr.add(island("isl1", "s", "t", Priority::Normal)).await;
        let snap = mgr.island_snapshot(&no_waiters()).await;
        assert_eq!(snap.count, 1);
        assert_eq!(snap.rows[0].notification.id, "isl1");
    }

    #[tokio::test]
    async fn test_snapshot_includes_queued_not_starved_by_max_visible() {
        // MAX_VISIBLE=5 must NOT starve the Model B list: 8 island notifications
        // (5 active + 3 queued) all appear, badge caps "9+" isn't hit at 8.
        let mgr = NotificationManager::new();
        for i in 0..8 {
            mgr.add(island(&format!("n{i}"), "s", &format!("t{i}"), Priority::Normal))
                .await;
        }
        let snap = mgr.island_snapshot(&no_waiters()).await;
        assert_eq!(snap.count, 8, "queued island items must count");
        assert_eq!(snap.rows.len(), 8, "all distinct island items are rows");
        assert_eq!(snap.badge_label, "8");
    }

    #[tokio::test]
    async fn test_waiter_registry_active_ids() {
        let registry = crate::server::waiters::WaiterRegistry::new();
        let _rx = registry.subscribe("x").await;
        let ids = registry.active_ids().await;
        assert!(ids.contains("x"));
        assert_eq!(ids.len(), 1);
    }

    #[tokio::test]
    async fn test_group_tracking() {
        let mgr = NotificationManager::new();
        let mut n1 = make_notification("n1");
        n1.group = Some("ci".to_string());
        let mut n2 = make_notification("n2");
        n2.group = Some("ci".to_string());

        mgr.add(n1).await;
        mgr.add(n2).await;

        let groups = mgr.groups.read().await;
        assert_eq!(groups.get("ci").unwrap().len(), 2);
    }
}
