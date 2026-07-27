use std::convert::Infallible;
use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    response::sse::{Event, Sse},
    routing::{get, post},
    Json, Router,
};
use futures::stream::Stream;
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use crate::notification::manager::NotificationManager;
use crate::notification::types::{
    Action, NotificationPayload, NotificationUpdate, Presentation, Priority, ProgressInfo,
    StyleOverrides, Timeout,
};
use crate::server::waiters::{WaitEvent, WaiterRegistry};
use crate::server::webhook::{self, WebhookPayload, WebhookResult};

/// Shared state for the HTTP server.
#[derive(Clone)]
pub struct ServerState {
    pub manager: Arc<NotificationManager>,
    pub waiters: Arc<WaiterRegistry>,
    pub app_handle: Option<tauri::AppHandle>,
}

/// Incoming notification request — similar to NotificationPayload but with optional fields.
#[derive(Debug, Deserialize)]
pub struct NotifyRequest {
    pub sender: String,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default = "default_priority")]
    pub priority: Priority,
    #[serde(default)]
    pub presentation: Presentation,
    #[serde(default)]
    pub timeout: Option<Timeout>,
    #[serde(default)]
    pub actions: Vec<Action>,
    #[serde(default)]
    pub progress: Option<ProgressInfo>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub sound: Option<String>,
    #[serde(default)]
    pub callback_url: Option<String>,
    #[serde(default)]
    pub style: Option<StyleOverrides>,
}

fn default_priority() -> Priority {
    Priority::Normal
}

/// Response for POST /notify
#[derive(Debug, Serialize, Deserialize)]
pub struct NotifyResponse {
    pub id: String,
}

/// Response for POST /dismiss-all
#[derive(Debug, Serialize, Deserialize)]
pub struct DismissAllResponse {
    pub dismissed: usize,
}

/// Response for GET /health
#[derive(Debug, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub active_count: usize,
}

/// Incoming update request
#[derive(Debug, Deserialize)]
pub struct UpdateRequest {
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub progress: Option<ProgressInfo>,
}

/// Incoming action request — triggers webhook callback
#[derive(Debug, Deserialize)]
pub struct ActionRequest {
    pub action_id: String,
}

/// Build the axum router.
pub fn build_router(state: ServerState) -> Router {
    Router::new()
        .route("/notify", post(handle_notify))
        .route("/notify/{id}/update", post(handle_update))
        .route("/notify/{id}/action", post(handle_action))
        .route("/notify/{id}/dismiss", post(handle_dismiss))
        .route("/notify/{id}/wait", get(handle_wait))
        .route("/dismiss-all", post(handle_dismiss_all))
        .route("/health", get(handle_health))
        .route("/active", get(handle_active))
        .with_state(state)
}
// NOTE (security review P1): no CORS layer. The server binds loopback only and its
// only clients are the CLI, curl, and server-side integrations - none of which need
// CORS. A permissive CORS layer previously let any website POST cross-origin to
// :9868 to spoof notifications or inject a `callback_url` (SSRF); removing it closes
// that browser vector entirely. (A callback_url denylist is deliberately NOT added -
// localhost/private callbacks are a documented, legitimate use of this local tool.)

/// Start the HTTP server on the given port.
pub async fn start_server(state: ServerState, port: u16) -> Result<(), std::io::Error> {
    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await?;
    info!("HTTP server listening on 127.0.0.1:{port}");
    axum::serve(listener, app).await
}

async fn handle_notify(
    State(state): State<ServerState>,
    Json(req): Json<NotifyRequest>,
) -> (StatusCode, Json<NotifyResponse>) {
    let req_sender = req.sender.clone();
    let payload = NotificationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        sender: req.sender,
        title: req.title,
        body: req.body,
        icon: req.icon,
        priority: req.priority,
        presentation: req.presentation,
        timeout: req.timeout.unwrap_or_default(),
        actions: req.actions,
        progress: req.progress,
        group: req.group,
        theme: req.theme,
        sound: req.sound,
        callback_url: req.callback_url,
        style: req.style,
        created_at: chrono::Utc::now(),
    };

    let id = state.manager.add(payload.clone()).await;

    // Show the target overlay window and emit to it, routed by presentation.
    // Card: existing broadcast + top-right panel (byte-identical). Island: scoped to the island
    // window so the panel never pops (FR-3) and never accumulates island state.
    if let Some(ref app) = state.app_handle {
        debug!("Emitting notification:add for id={id}");
        let emit = match crate::overlay::OverlayRoute::of(payload.presentation) {
            crate::overlay::OverlayRoute::Panel => {
                crate::overlay::panel::show_panel(app);
                tauri::Emitter::emit(app, "notification:add", &payload)
            }
            crate::overlay::OverlayRoute::Island => {
                crate::overlay::island::show_island(app);
                tauri::Emitter::emit_to(
                    app,
                    crate::overlay::island::ISLAND_LABEL,
                    "notification:add",
                    &payload,
                )
            }
        };
        match emit {
            Ok(()) => info!("Notification emitted: id={id} sender={}", req_sender),
            Err(e) => error!("Failed to emit notification:add: {e}"),
        }
        // History ingest (presentation-agnostic, single ingest point): one broadcast
        // per accepted notification so the main window records it once, for BOTH card
        // and island. Only the main-window historyStore listens; the overlay/island
        // windows ignore it. Idempotent by id on the frontend guards redelivery.
        if let Err(e) = tauri::Emitter::emit(app, "history:add", &payload) {
            error!("Failed to emit history:add: {e}");
        }
        crate::emit_island_snapshot(app, &state.manager, &state.waiters).await;
    } else {
        warn!("No app_handle — cannot emit notification event");
    }

    (StatusCode::CREATED, Json(NotifyResponse { id }))
}

async fn handle_update(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<UpdateRequest>,
) -> StatusCode {
    debug!("Update request for id={id}");
    let update = NotificationUpdate {
        body: req.body,
        progress: req.progress,
    };

    let updated = state.manager.update(&id, update.clone()).await;

    if updated {
        if let Some(ref app) = state.app_handle {
            let _ = tauri::Emitter::emit(
                app,
                "notification:update",
                &serde_json::json!({ "id": id, "update": update }),
            );
            crate::emit_island_snapshot(app, &state.manager, &state.waiters).await;
        }
        info!("Notification updated: id={id}");
        StatusCode::OK
    } else {
        warn!("Update failed — notification not found: id={id}");
        StatusCode::NOT_FOUND
    }
}

async fn handle_action(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<ActionRequest>,
) -> Result<Json<WebhookResult>, StatusCode> {
    debug!("Action request for id={id} action={}", req.action_id);

    let notification = state
        .manager
        .get(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    let result = if let Some(ref url) = notification.callback_url {
        let payload = WebhookPayload {
            notification_id: id.clone(),
            action_id: req.action_id.clone(),
            sender: notification.sender.clone(),
            title: notification.title.clone(),
        };
        webhook::fire_webhook(url, &payload).await
    } else {
        WebhookResult {
            success: true,
            status_code: None,
            error: None,
        }
    };

    // Notify waiting CLI clients
    state
        .waiters
        .notify(
            &id,
            WaitEvent::Action {
                action_id: req.action_id.clone(),
            },
        )
        .await;

    // Dismiss after action
    let dismissed = state.manager.dismiss(&id).await;
    if let Some(ref notification) = dismissed {
        if let Some(ref app) = state.app_handle {
            let _ = tauri::Emitter::emit(app, "notification:dismiss", &id);
            if state.manager.active_count_for(notification.presentation).await == 0 {
                crate::overlay::hide_for(app, notification.presentation);
            }
        }
    }
    // Emit unconditionally (aligned with lib.rs action_callback): even if the
    // post-action dismiss raced to None, the waiter resolution above may have
    // changed hasWaiter, so the snapshot must reconcile (T6 review F2-low).
    if let Some(ref app) = state.app_handle {
        crate::emit_island_snapshot(app, &state.manager, &state.waiters).await;
    }

    info!(
        "Action completed: id={id} action={} webhook_success={}",
        req.action_id, result.success
    );
    Ok(Json(result))
}

/// Drop-guard that reconciles the waiter registry when a `--wait` SSE stream is torn
/// down by the CLIENT (disconnect / Ctrl+C), which `notify()` never observes. Without
/// it a client that dies mid-wait leaves its entry forever: the notification stays
/// `hasWaiter=true` - permanently dedupe-exempt (A4) and auto-dismiss-suppressed (F2)
/// - so a same-key resend coexists with the zombie. Held by (and only by) the wait
/// stream, so it drops exactly when the connection ends. Removal is delegated to
/// `remove_if_orphaned`, whose channel-identity + receiver-liveness guards keep a late
/// drop from a resolved/replaced/shared channel from evicting a live entry.
struct WaitGuard {
    state: ServerState,
    id: String,
    sender: broadcast::Sender<WaitEvent>,
}

impl Drop for WaitGuard {
    fn drop(&mut self) {
        // Drop is sync; the registry lock is async - hand the cleanup to the runtime.
        // By the time it acquires the lock, this stream's receiver is fully dropped,
        // so `receiver_count()` is accurate.
        let state = self.state.clone();
        let id = std::mem::take(&mut self.id);
        let sender = self.sender.clone();
        tokio::spawn(async move {
            if state.waiters.remove_if_orphaned(&id, &sender).await {
                // The dead waiter is gone: re-emit so hasWaiter / dedupe reconciles
                // live (a zombie no longer blocks a same-key resend from merging).
                if let Some(ref app) = state.app_handle {
                    crate::emit_island_snapshot(app, &state.manager, &state.waiters).await;
                }
            }
        });
    }
}

async fn handle_wait(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<
    Sse<std::pin::Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>>>,
    StatusCode,
> {
    debug!("Wait request for id={id}");

    // Subscribe BEFORE checking existence to avoid race condition:
    // if the notification is resolved between our check and subscribe,
    // we'd miss the event.
    let (sender, mut rx) = state.waiters.subscribe_with_sender(&id).await;

    // Verify notification still exists
    let exists = state.manager.get(&id).await.is_some();
    if !exists {
        info!("Wait: notification {id} already resolved");
        // Clean up the entry we just created: no stream (hence no drop-guard) carries
        // it on this early path, so without this an already-resolved wait would leak a
        // permanent zombie entry. Drop our receiver first so the liveness guard sees 0.
        drop(rx);
        state.waiters.remove_if_orphaned(&id, &sender).await;
        let stream = futures::stream::iter(vec![Ok(Event::default()
            .event("message")
            .data(
                serde_json::to_string(&WaitEvent::Dismissed).unwrap_or_default(),
            ))]);
        return Ok(Sse::new(Box::pin(stream)));
    }

    info!("Wait: SSE stream opened for id={id}");

    // A waiter just became PENDING for this id. hasWaiter and the A4 dedupe
    // exemption are derived from the WaiterRegistry, which no manager mutation
    // tracks - without this re-emit, a same-key notification that subscribed
    // after the last emit stays merged away (unreachable row, wrong exit 2) and
    // its auto-dismiss suppression reads stale hasWaiter=false. One emit per
    // --wait, mirroring the creation-read reconcile philosophy (T6 review F1).
    if let Some(ref app) = state.app_handle {
        crate::emit_island_snapshot(app, &state.manager, &state.waiters).await;
    }

    // Cleanup on client disconnect (Ctrl+C): the guard is captured by the stream
    // generator, so it drops when the connection ends - even if the stream is dropped
    // before it is ever polled (the generator still owns the captured guard).
    let guard = WaitGuard {
        state: state.clone(),
        id: id.clone(),
        sender,
    };

    let stream = async_stream::stream! {
        let _guard = guard;
        // Send connected event so CLI knows the stream is live
        yield Ok(Event::default()
            .event("message")
            .data(serde_json::to_string(&WaitEvent::Connected).unwrap_or_default()));

        // Wait for resolution event
        match rx.recv().await {
            Ok(event) => {
                info!("Wait: sending event for id={id}: {event:?}");
                yield Ok(Event::default()
                    .event("message")
                    .data(serde_json::to_string(&event).unwrap_or_default()));
            }
            Err(e) => {
                warn!("Wait: broadcast channel error for id={id}: {e}");
                yield Ok(Event::default()
                    .event("message")
                    .data(serde_json::to_string(&WaitEvent::Dismissed).unwrap_or_default()));
            }
        }
    };

    Ok(Sse::new(Box::pin(stream)))
}

async fn handle_dismiss(
    State(state): State<ServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> StatusCode {
    debug!("Dismiss request for id={id}");
    let dismissed = state.manager.dismiss(&id).await;

    if let Some(ref notification) = dismissed {
        // Notify waiting CLI clients
        state.waiters.notify(&id, WaitEvent::Dismissed).await;

        if let Some(ref app) = state.app_handle {
            let _ = tauri::Emitter::emit(app, "notification:dismiss", &id);
            // Hide the hosting window if no more active notifications
            if state.manager.active_count_for(notification.presentation).await == 0 {
                crate::overlay::hide_for(app, notification.presentation);
            }
            crate::emit_island_snapshot(app, &state.manager, &state.waiters).await;
        }
        info!("Notification dismissed: id={id}");
        StatusCode::OK
    } else {
        warn!("Dismiss failed — notification not found: id={id}");
        StatusCode::NOT_FOUND
    }
}

async fn handle_dismiss_all(
    State(state): State<ServerState>,
) -> Json<DismissAllResponse> {
    // Notify all waiting CLI clients before clearing
    state.waiters.notify_all(WaitEvent::Dismissed).await;

    let dismissed = state.manager.dismiss_all().await;
    let count = dismissed.len();

    if let Some(ref app) = state.app_handle {
        // Broadcast dismissal hides both overlay windows.
        crate::overlay::panel::hide_panel(app);
        crate::overlay::island::hide_island(app);
        let _ = tauri::Emitter::emit(app, "notification:dismiss-all", &count);
        crate::emit_island_snapshot(app, &state.manager, &state.waiters).await;
    }

    info!("All notifications dismissed: count={count}");
    Json(DismissAllResponse { dismissed: count })
}

async fn handle_health(
    State(state): State<ServerState>,
) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        active_count: state.manager.active_count().await,
    })
}

async fn handle_active(
    State(state): State<ServerState>,
) -> Json<Vec<NotificationPayload>> {
    Json(state.manager.list_active().await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use futures::StreamExt;
    use tower::ServiceExt;

    fn test_state() -> ServerState {
        ServerState {
            manager: NotificationManager::new(),
            waiters: WaiterRegistry::new(),
            app_handle: None,
        }
    }

    #[tokio::test]
    async fn test_health_endpoint() {
        let app = build_router(test_state());

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let health: HealthResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(health.status, "ok");
        assert_eq!(health.active_count, 0);
    }

    #[tokio::test]
    async fn test_notify_creates_notification() {
        let state = test_state();
        let app = build_router(state.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/notify")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_string(&serde_json::json!({
                            "sender": "test",
                            "title": "Hello",
                            "body": "World"
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CREATED);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let resp: NotifyResponse = serde_json::from_slice(&body).unwrap();
        assert!(!resp.id.is_empty());

        // Verify notification was stored
        assert_eq!(state.manager.active_count().await, 1);
    }

    #[tokio::test]
    async fn test_notify_with_all_fields() {
        let app = build_router(test_state());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/notify")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_string(&serde_json::json!({
                            "sender": "ci",
                            "title": "Build Complete",
                            "body": "All tests passed",
                            "priority": "high",
                            "actions": [
                                { "id": "open", "label": "Open PR", "style": "primary" }
                            ],
                            "progress": { "value": 0.75, "label": "75%", "style": "bar" },
                            "group": "ci-builds",
                            "sound": "success"
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CREATED);
    }

    #[tokio::test]
    async fn test_dismiss_existing_notification() {
        let state = test_state();
        let payload = NotificationPayload {
            id: "test-id".to_string(),
            sender: "test".to_string(),
            title: "Test".to_string(),
            body: "Body".to_string(),
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
        };
        state.manager.add(payload).await;

        let app = build_router(state.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/notify/test-id/dismiss")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(state.manager.active_count().await, 0);
    }

    #[tokio::test]
    async fn test_dismiss_nonexistent_returns_404() {
        let app = build_router(test_state());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/notify/nonexistent/dismiss")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_dismiss_all() {
        let state = test_state();
        for i in 0..3 {
            let payload = NotificationPayload {
                id: format!("n{i}"),
                sender: "test".to_string(),
                title: format!("Test {i}"),
                body: "Body".to_string(),
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
            };
            state.manager.add(payload).await;
        }

        let app = build_router(state.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/dismiss-all")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let resp: DismissAllResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(resp.dismissed, 3);
        assert_eq!(state.manager.active_count().await, 0);
    }

    #[tokio::test]
    async fn test_update_existing_notification() {
        let state = test_state();
        let payload = NotificationPayload {
            id: "test-id".to_string(),
            sender: "test".to_string(),
            title: "Test".to_string(),
            body: "Original".to_string(),
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
        };
        state.manager.add(payload).await;

        let app = build_router(state.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/notify/test-id/update")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_string(&serde_json::json!({
                            "body": "Updated body",
                            "progress": { "value": 0.5, "style": "bar" }
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let updated = state.manager.get("test-id").await.unwrap();
        assert_eq!(updated.body, "Updated body");
        assert!(updated.progress.is_some());
    }

    #[tokio::test]
    async fn test_update_nonexistent_returns_404() {
        let app = build_router(test_state());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/notify/nonexistent/update")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_string(&serde_json::json!({
                            "body": "Updated"
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_active_returns_list() {
        let state = test_state();
        let payload = NotificationPayload {
            id: "n1".to_string(),
            sender: "test".to_string(),
            title: "Test".to_string(),
            body: "Body".to_string(),
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
        };
        state.manager.add(payload).await;

        let app = build_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/active")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let notifications: Vec<NotificationPayload> = serde_json::from_slice(&body).unwrap();
        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0].title, "Test");
    }

    #[tokio::test]
    async fn test_health_reflects_active_count() {
        let state = test_state();
        let payload = NotificationPayload {
            id: "n1".to_string(),
            sender: "test".to_string(),
            title: "Test".to_string(),
            body: "Body".to_string(),
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
        };
        state.manager.add(payload).await;

        let app = build_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let health: HealthResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(health.active_count, 1);
    }

    #[tokio::test]
    async fn test_action_dismisses_notification() {
        let state = test_state();
        let payload = NotificationPayload {
            id: "action-test".to_string(),
            sender: "ci".to_string(),
            title: "Build".to_string(),
            body: "Done".to_string(),
            icon: None,
            priority: Priority::Normal,
            presentation: Presentation::Card,
            timeout: Timeout::default(),
            actions: vec![Action {
                id: "approve".to_string(),
                label: "Approve".to_string(),
                style: crate::notification::types::ActionStyle::Primary,
                icon: None,
                bg: None,
                color: None,
                border_color: None,
            }],
            progress: None,
            group: None,
            theme: None,
            sound: None,
            callback_url: None,
            style: None,
            created_at: chrono::Utc::now(),
        };
        state.manager.add(payload).await;
        assert_eq!(state.manager.active_count().await, 1);

        let app = build_router(state.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/notify/action-test/action")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_string(&serde_json::json!({
                            "action_id": "approve"
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: WebhookResult = serde_json::from_slice(&body).unwrap();
        // No callback_url, so success=true with no status_code
        assert!(result.success);
        assert!(result.status_code.is_none());

        // Notification should be dismissed
        assert_eq!(state.manager.active_count().await, 0);
    }

    #[tokio::test]
    async fn test_action_nonexistent_returns_404() {
        let app = build_router(test_state());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/notify/nonexistent/action")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_string(&serde_json::json!({
                            "action_id": "click"
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_notify_default_priority_is_normal() {
        let state = test_state();
        let app = build_router(state.clone());

        app.oneshot(
            Request::builder()
                .method("POST")
                .uri("/notify")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_string(&serde_json::json!({
                        "sender": "test",
                        "title": "Hello",
                        "body": "World"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

        let active = state.manager.list_active().await;
        assert_eq!(active[0].priority, Priority::Normal);
    }

    #[tokio::test]
    async fn test_notify_default_presentation_is_island() {
        let state = test_state();
        let app = build_router(state.clone());

        app.oneshot(
            Request::builder()
                .method("POST")
                .uri("/notify")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_string(&serde_json::json!({
                        "sender": "test",
                        "title": "Hello",
                        "body": "World"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

        let active = state.manager.list_active().await;
        assert_eq!(active[0].presentation, Presentation::Island);
    }

    #[tokio::test]
    async fn test_notify_presentation_island_survives_boundary() {
        let state = test_state();
        let app = build_router(state.clone());

        app.oneshot(
            Request::builder()
                .method("POST")
                .uri("/notify")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_string(&serde_json::json!({
                        "sender": "test",
                        "title": "Hello",
                        "body": "World",
                        "presentation": "island"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

        let active = state.manager.list_active().await;
        assert_eq!(active[0].presentation, Presentation::Island);
    }

    #[tokio::test]
    async fn test_card_and_island_route_to_distinct_windows() {
        use crate::overlay::OverlayRoute;
        let state = test_state();
        let app = build_router(state.clone());

        // A card send and an island send through the real HTTP boundary.
        for (title, presentation) in [("card-one", "card"), ("island-one", "island")] {
            app.clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/notify")
                        .header("content-type", "application/json")
                        .body(Body::from(
                            serde_json::to_string(&serde_json::json!({
                                "sender": "test",
                                "title": title,
                                "body": "b",
                                "presentation": presentation
                            }))
                            .unwrap(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap();
        }

        let active = state.manager.list_active().await;
        assert_eq!(active.len(), 2);

        // Each notification routes to its own window: card -> overlay, island -> island.
        // The island route is never the panel, so an island send never pops the top-right panel.
        for n in &active {
            let route = OverlayRoute::of(n.presentation);
            match n.presentation {
                Presentation::Card => {
                    assert_eq!(route, OverlayRoute::Panel);
                    assert_eq!(route.window_label(), "overlay");
                }
                Presentation::Island => {
                    assert_eq!(route, OverlayRoute::Island);
                    assert_eq!(route.window_label(), "island");
                    assert_ne!(route, OverlayRoute::Panel);
                }
            }
        }
    }

    #[tokio::test]
    async fn test_wait_nonexistent_returns_dismissed_immediately() {
        let app = build_router(test_state());

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/notify/nonexistent/wait")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        // SSE endpoint returns 200 with a dismissed event for already-resolved notifications
        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body_str = String::from_utf8(body.to_vec()).unwrap();
        assert!(body_str.contains("dismissed"));
    }

    #[tokio::test]
    async fn test_wait_existing_notification_sends_connected() {
        let state = test_state();
        let payload = NotificationPayload {
            id: "wait-test".to_string(),
            sender: "test".to_string(),
            title: "Test".to_string(),
            body: "Body".to_string(),
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
        };
        state.manager.add(payload).await;

        // Subscribe to waiters and trigger dismiss concurrently with the SSE stream
        let waiters = state.waiters.clone();
        tokio::spawn(async move {
            // Small delay to let SSE stream start
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            waiters.notify("wait-test", WaitEvent::Dismissed).await;
        });

        let app = build_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/notify/wait-test/wait")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body_str = String::from_utf8(body.to_vec()).unwrap();
        // Should contain both connected and dismissed events
        assert!(body_str.contains("connected"), "body: {body_str}");
        assert!(body_str.contains("dismissed"), "body: {body_str}");
    }

    #[tokio::test]
    async fn test_action_notifies_waiters() {
        let state = test_state();
        let payload = NotificationPayload {
            id: "waiter-action".to_string(),
            sender: "ci".to_string(),
            title: "Build".to_string(),
            body: "Done".to_string(),
            icon: None,
            priority: Priority::Normal,
            presentation: Presentation::Card,
            timeout: Timeout::default(),
            actions: vec![Action {
                id: "approve".to_string(),
                label: "Approve".to_string(),
                style: crate::notification::types::ActionStyle::Primary,
                icon: None,
                bg: None,
                color: None,
                border_color: None,
            }],
            progress: None,
            group: None,
            theme: None,
            sound: None,
            callback_url: None,
            style: None,
            created_at: chrono::Utc::now(),
        };
        state.manager.add(payload).await;

        // Subscribe as a waiter
        let mut rx = state.waiters.subscribe("waiter-action").await;

        let app = build_router(state);

        // Trigger action via HTTP
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/notify/waiter-action/action")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_string(&serde_json::json!({
                            "action_id": "approve"
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        // Waiter should have received the action event
        let event = rx.recv().await.unwrap();
        assert_eq!(
            event,
            WaitEvent::Action {
                action_id: "approve".to_string()
            }
        );
    }

    #[tokio::test]
    async fn test_dismiss_notifies_waiters() {
        let state = test_state();
        let payload = NotificationPayload {
            id: "waiter-dismiss".to_string(),
            sender: "test".to_string(),
            title: "Test".to_string(),
            body: "Body".to_string(),
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
        };
        state.manager.add(payload).await;

        let mut rx = state.waiters.subscribe("waiter-dismiss").await;

        let app = build_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/notify/waiter-dismiss/dismiss")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let event = rx.recv().await.unwrap();
        assert_eq!(event, WaitEvent::Dismissed);
    }

    #[tokio::test]
    async fn test_wait_client_disconnect_cleans_up_registry() {
        // The user's reproduction, at its root: a --wait client that dies (Ctrl+C)
        // must not leave its registry entry behind. We open the SSE wait stream,
        // consume ONLY the `connected` frame (an ephemeral in-process server via
        // `oneshot` - NEVER read the body to completion, which would block forever on
        // an unresolved wait), then drop the stream to simulate the disconnect.
        let state = test_state();
        let payload = NotificationPayload {
            id: "wait-dc".to_string(),
            sender: "ci".to_string(),
            title: "Deploy?".to_string(),
            body: "prod".to_string(),
            icon: None,
            priority: Priority::Normal,
            presentation: Presentation::Island,
            timeout: Timeout::default(),
            actions: vec![Action {
                id: "approve".to_string(),
                label: "Approve".to_string(),
                style: crate::notification::types::ActionStyle::Primary,
                icon: None,
                bg: None,
                color: None,
                border_color: None,
            }],
            progress: None,
            group: None,
            theme: None,
            sound: None,
            callback_url: None,
            style: None,
            created_at: chrono::Utc::now(),
        };
        state.manager.add(payload).await;

        let app = build_router(state.clone());
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/notify/wait-dc/wait")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // Poll exactly one frame (the `connected` event) so the stream started and the
        // waiter is live, then drop the body - the client hanging up.
        let mut body = response.into_body().into_data_stream();
        let first = body.next().await.expect("connected frame").expect("frame ok");
        assert!(
            String::from_utf8_lossy(&first).contains("connected"),
            "first frame is connected"
        );
        assert_eq!(state.waiters.waiter_count().await, 1);

        drop(body); // client disconnect (Ctrl+C)

        // The drop-guard spawns its cleanup on the runtime; give it a few ticks.
        let mut cleaned = false;
        for _ in 0..50 {
            if state.waiters.waiter_count().await == 0 {
                cleaned = true;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert!(cleaned, "disconnect must remove the leaked waiter entry");
        assert!(
            !state.waiters.active_ids().await.contains("wait-dc"),
            "the dead waiter no longer marks the notification hasWaiter (dedupe reconciles)"
        );

        // And the notification can still be resolved by a fresh action on its id.
        let app2 = build_router(state.clone());
        let resp2 = app2
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/notify/wait-dc/action")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_string(&serde_json::json!({ "action_id": "approve" }))
                            .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp2.status(), StatusCode::OK);
        assert_eq!(state.manager.active_count().await, 0);
    }

    #[tokio::test]
    async fn test_wait_already_resolved_does_not_leak_entry() {
        // The early-return path (notification already gone) subscribes before the
        // existence check (the deliberate race guard) - it must clean up the entry it
        // created so an already-resolved wait never leaks a permanent zombie.
        let state = test_state();
        let app = build_router(state.clone());
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/notify/ghost/wait")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        // Consume the immediate dismissed frame.
        let _ = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert_eq!(state.waiters.waiter_count().await, 0);
    }

    #[tokio::test]
    async fn test_dismiss_all_notifies_waiters() {
        let state = test_state();
        for i in 0..2 {
            let payload = NotificationPayload {
                id: format!("da-{i}"),
                sender: "test".to_string(),
                title: format!("Test {i}"),
                body: "Body".to_string(),
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
            };
            state.manager.add(payload).await;
        }

        let mut rx0 = state.waiters.subscribe("da-0").await;
        let mut rx1 = state.waiters.subscribe("da-1").await;

        let app = build_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/dismiss-all")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        assert_eq!(rx0.recv().await.unwrap(), WaitEvent::Dismissed);
        assert_eq!(rx1.recv().await.unwrap(), WaitEvent::Dismissed);
    }
}
