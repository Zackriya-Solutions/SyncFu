use std::time::Duration;
use wiremock::matchers::{body_partial_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

// Import the client and types from the crate
use syncfu_cli::client::SyncfuClient;
use syncfu_cli::types::*;

#[tokio::test]
async fn test_send_notification() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/notify"))
        .respond_with(
            ResponseTemplate::new(201).set_body_json(serde_json::json!({"id": "test-uuid-123"})),
        )
        .mount(&server)
        .await;

    let client = SyncfuClient::new(&server.uri());
    let req = NotifyRequest {
        sender: "test".to_string(),
        title: "Hello".to_string(),
        body: "World".to_string(),
        icon: None,
        priority: Priority::Normal,
        presentation: Presentation::Card,
        timeout: None,
        actions: vec![],
        progress: None,
        group: None,
        theme: None,
        sound: None,
        callback_url: None,
        style: None,
    };

    let resp = client.send_notification(&req).await.unwrap();
    assert_eq!(resp.id, "test-uuid-123");
}

#[tokio::test]
async fn test_send_notification_with_actions() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/notify"))
        .respond_with(
            ResponseTemplate::new(201).set_body_json(serde_json::json!({"id": "action-test"})),
        )
        .mount(&server)
        .await;

    let client = SyncfuClient::new(&server.uri());
    let req = NotifyRequest {
        sender: "ci".to_string(),
        title: "PR Ready".to_string(),
        body: "Review requested".to_string(),
        icon: Some("git-pull-request".to_string()),
        priority: Priority::High,
        presentation: Presentation::Card,
        timeout: Some(Timeout::Named("never".to_string())),
        actions: vec![
            Action {
                id: "approve".to_string(),
                label: "Approve".to_string(),
                style: ActionStyle::Primary,
                icon: None,
                bg: Some("#22c55e".to_string()),
                color: Some("#fff".to_string()),
                border_color: None,
            },
            Action {
                id: "deny".to_string(),
                label: "Deny".to_string(),
                style: ActionStyle::Danger,
                icon: None,
                bg: None,
                color: None,
                border_color: None,
            },
        ],
        progress: None,
        group: None,
        theme: None,
        sound: None,
        callback_url: Some("http://localhost:9870/cb".to_string()),
        style: Some(StyleOverrides {
            accent_color: Some("#a855f7".to_string()),
            ..Default::default()
        }),
    };

    let resp = client.send_notification(&req).await.unwrap();
    assert_eq!(resp.id, "action-test");
}

#[tokio::test]
async fn test_health() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/health"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            serde_json::json!({"status": "ok", "active_count": 3}),
        ))
        .mount(&server)
        .await;

    let client = SyncfuClient::new(&server.uri());
    let resp = client.health().await.unwrap();
    assert_eq!(resp.status, "ok");
    assert_eq!(resp.active_count, 3);
}

#[tokio::test]
async fn test_list_active() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/active"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            {"id": "n1", "sender": "ci", "title": "Build", "body": "Done", "priority": "normal", "timeout": "default", "actions": [], "createdAt": "2026-01-01T00:00:00Z"},
            {"id": "n2", "sender": "monitor", "title": "Alert", "body": "CPU high", "priority": "high", "timeout": "never", "actions": [], "createdAt": "2026-01-01T00:00:00Z"},
        ])))
        .mount(&server)
        .await;

    let client = SyncfuClient::new(&server.uri());
    let list = client.list_active().await.unwrap();
    assert_eq!(list.len(), 2);
}

#[tokio::test]
async fn test_dismiss() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/notify/test-id/dismiss"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    let client = SyncfuClient::new(&server.uri());
    client.dismiss("test-id").await.unwrap();
}

#[tokio::test]
async fn test_dismiss_nonexistent_returns_error() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/notify/nonexistent/dismiss"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;

    let client = SyncfuClient::new(&server.uri());
    let result = client.dismiss("nonexistent").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("not found"));
}

#[tokio::test]
async fn test_dismiss_all() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/dismiss-all"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"dismissed": 5})),
        )
        .mount(&server)
        .await;

    let client = SyncfuClient::new(&server.uri());
    let resp = client.dismiss_all().await.unwrap();
    assert_eq!(resp.dismissed, 5);
}

#[tokio::test]
async fn test_update_notification() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/notify/up-id/update"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    let client = SyncfuClient::new(&server.uri());
    let req = UpdateRequest {
        body: Some("Updated".to_string()),
        progress: Some(ProgressInfo {
            value: 0.75,
            label: Some("75%".to_string()),
            style: ProgressStyle::Bar,
        }),
    };
    client.update_notification("up-id", &req).await.unwrap();
}

#[tokio::test]
async fn test_trigger_action() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/notify/act-id/action"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            serde_json::json!({"success": true, "status_code": 200, "error": null}),
        ))
        .mount(&server)
        .await;

    let client = SyncfuClient::new(&server.uri());
    let resp = client.trigger_action("act-id", "approve").await.unwrap();
    assert!(resp.success);
    assert_eq!(resp.status_code, Some(200));
}

#[tokio::test]
async fn test_connection_error_message() {
    let client = SyncfuClient::new("http://127.0.0.1:1");
    let result = client.health().await;
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("cannot connect to syncfu"));
}

/// End-to-end through the real CLI binary: `syncfu send --presentation island`
/// must post `"presentation":"island"` across the HTTP boundary. The mock only
/// matches when the body contains that field, so a matched request (201 + success
/// exit) proves the flag reached the wire.
#[tokio::test]
async fn test_cli_presentation_island_posts_field() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/notify"))
        .and(body_partial_json(serde_json::json!({ "presentation": "island" })))
        .respond_with(
            ResponseTemplate::new(201).set_body_json(serde_json::json!({ "id": "island-1" })),
        )
        .expect(1)
        .mount(&server)
        .await;

    let status = std::process::Command::new(env!("CARGO_BIN_EXE_syncfu"))
        .args([
            "--server",
            &server.uri(),
            "send",
            "hello",
            "--presentation",
            "island",
        ])
        .status()
        .expect("failed to spawn syncfu binary");

    assert!(status.success(), "CLI exited with failure: {status:?}");
}

/// Omitting `--presentation` defaults to `card` on the wire (back-compat).
#[tokio::test]
async fn test_cli_presentation_defaults_to_card() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/notify"))
        .and(body_partial_json(serde_json::json!({ "presentation": "card" })))
        .respond_with(
            ResponseTemplate::new(201).set_body_json(serde_json::json!({ "id": "card-1" })),
        )
        .expect(1)
        .mount(&server)
        .await;

    let status = std::process::Command::new(env!("CARGO_BIN_EXE_syncfu"))
        .args(["--server", &server.uri(), "send", "hello"])
        .status()
        .expect("failed to spawn syncfu binary");

    assert!(status.success(), "CLI exited with failure: {status:?}");
}

// --- island --wait roundtrip: exit-code parity with the card (T5a) -----------
//
// The island reuses the card's UNCHANGED action_callback -> waiter -> SSE ->
// exit-code path (waiters.rs / wait.rs untouched). These end-to-end tests drive
// the real `syncfu` binary with `--presentation island --wait` and assert the
// exact exit codes: action -> 0, dismiss -> 1, CLI timeout -> 2. The wait
// endpoint is served by a mock SSE stream (or, for timeout, a delayed response
// the CLI's own tokio timeout cancels). Because the exit path is presentation-
// agnostic, a passing island roundtrip proves the island joins that path.

const WAIT_ID: &str = "isl-wait";

/// Mount the `/notify` mock (asserting the island presentation reaches the wire)
/// and return a server pre-wired so `send --wait` resolves against WAIT_ID.
async fn island_wait_server() -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/notify"))
        .and(body_partial_json(serde_json::json!({ "presentation": "island" })))
        .respond_with(
            ResponseTemplate::new(201).set_body_json(serde_json::json!({ "id": WAIT_ID })),
        )
        .mount(&server)
        .await;
    server
}

fn send_island_wait(server_uri: &str, wait_timeout: &str) -> std::process::ExitStatus {
    std::process::Command::new(env!("CARGO_BIN_EXE_syncfu"))
        .args([
            "--server",
            server_uri,
            "send",
            "Approve deploy?",
            "--presentation",
            "island",
            "--wait",
            "--wait-timeout",
            wait_timeout,
        ])
        .status()
        .expect("failed to spawn syncfu binary")
}

/// An SSE response template carrying a single resolution event.
fn sse_event(json: serde_json::Value) -> ResponseTemplate {
    ResponseTemplate::new(200)
        .append_header("content-type", "text/event-stream")
        .set_body_string(format!("data: {json}\n\n"))
}

#[tokio::test]
async fn test_island_wait_action_exits_0() {
    let server = island_wait_server().await;
    Mock::given(method("GET"))
        .and(path(format!("/notify/{WAIT_ID}/wait")))
        .respond_with(sse_event(
            serde_json::json!({ "event": "action", "action_id": "approve" }),
        ))
        .mount(&server)
        .await;

    let uri = server.uri();
    let status = tokio::task::spawn_blocking(move || send_island_wait(&uri, "5"))
        .await
        .unwrap();
    assert_eq!(status.code(), Some(0), "action must exit 0: {status:?}");
}

#[tokio::test]
async fn test_island_wait_dismiss_exits_1() {
    let server = island_wait_server().await;
    Mock::given(method("GET"))
        .and(path(format!("/notify/{WAIT_ID}/wait")))
        .respond_with(sse_event(serde_json::json!({ "event": "dismissed" })))
        .mount(&server)
        .await;

    let uri = server.uri();
    let status = tokio::task::spawn_blocking(move || send_island_wait(&uri, "5"))
        .await
        .unwrap();
    assert_eq!(status.code(), Some(1), "dismiss must exit 1: {status:?}");
}

#[tokio::test]
async fn test_island_wait_timeout_exits_2() {
    let server = island_wait_server().await;
    // The wait endpoint stalls far beyond the CLI's --wait-timeout, so the CLI's
    // own tokio timeout fires first and yields exit 2 (no resolution event).
    Mock::given(method("GET"))
        .and(path(format!("/notify/{WAIT_ID}/wait")))
        .respond_with(sse_event(serde_json::json!({ "event": "connected" })).set_delay(Duration::from_secs(30)))
        .mount(&server)
        .await;

    let uri = server.uri();
    let status = tokio::task::spawn_blocking(move || send_island_wait(&uri, "1"))
        .await
        .unwrap();
    assert_eq!(status.code(), Some(2), "timeout must exit 2: {status:?}");
}
