// A4 (--wait identity) at the layer T5a owns: two --wait notifications that SHARE
// a dedupe key (same `sender::title`, no group) must each keep their own 1:1
// id->waiter mapping so their exit codes never cross-contaminate.
//
// At T5a there is NO dedupe merging yet (T6 owns the manager-level waiter
// exemption). The guarantee here is the WaiterRegistry itself: it keys strictly
// by notification id, so two distinct ids - even ones that would share a dedupe
// key at the UI - resolve INDEPENDENTLY. This is the two-waiters-same-dedupe-key
// collision the plan's A4 acceptance requires (85-verify.md A4); the manager-level
// exemption that PREVENTS the merge in the first place is verified in T6.
//
// waiters.rs is reused UNCHANGED; this is an external integration test.

use syncfu_lib::server::waiters::{WaitEvent, WaiterRegistry};

#[tokio::test]
async fn two_waiters_sharing_a_dedupe_key_resolve_independently() {
    let registry = WaiterRegistry::new();

    // Two notifications with the SAME dedupe key ("deploy::Approve needed") but
    // distinct wire ids, each with its own waiting CLI client.
    let id_w1 = "notif-w1";
    let id_w2 = "notif-w2";
    let mut rx_w1 = registry.subscribe(id_w1).await;
    let mut rx_w2 = registry.subscribe(id_w2).await;

    // W1 is approved (-> CLI exit 0); W2 is dismissed (-> CLI exit 1).
    registry
        .notify(id_w1, WaitEvent::Action { action_id: "approve".to_string() })
        .await;
    registry.notify(id_w2, WaitEvent::Dismissed).await;

    // Each waiter receives ONLY its own resolution - no collision, no swap.
    assert_eq!(
        rx_w1.recv().await.unwrap(),
        WaitEvent::Action { action_id: "approve".to_string() }
    );
    assert_eq!(rx_w2.recv().await.unwrap(), WaitEvent::Dismissed);
}

#[tokio::test]
async fn resolving_one_waiter_leaves_the_other_pending() {
    let registry = WaiterRegistry::new();
    let mut rx_w1 = registry.subscribe("notif-a").await;
    let mut rx_w2 = registry.subscribe("notif-b").await;

    // Resolve only W1; W2's channel must remain open (still awaiting its answer).
    registry
        .notify("notif-a", WaitEvent::Action { action_id: "ok".to_string() })
        .await;

    assert_eq!(
        rx_w1.recv().await.unwrap(),
        WaitEvent::Action { action_id: "ok".to_string() }
    );
    // W2 has NOT been notified: a non-blocking receive finds nothing yet.
    assert!(rx_w2.try_recv().is_err());
}
