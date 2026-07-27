//! T11 journey harness server (EVIDENCE tooling, not production code).
//!
//! Runs the REAL syncfu server stack - `build_router` over the REAL
//! `NotificationManager` + `WaiterRegistry` - on an EPHEMERAL port, driven by the
//! REAL `syncfu-cli` binary from `e2e/journey/run-journey.sh`.
//!
//! WHY this exists (composition argument): the shipping app hardcodes port 9868
//! (`lib.rs` `start_server(server_state, 9868)`, no env override) and launches
//! real desktop windows. On this machine :9868 is already held by the user's
//! installed production instance (`/Applications/syncfu.app`), which must not be
//! killed, and the port cannot be rebound without a production `src/` change
//! (forbidden for T11). So the full app cannot be spawned here. Per T11's
//! degrade-honestly rule we exercise the CLI <-> HTTP <-> manager <-> waiters
//! journey end-to-end with NO webview: `app_handle: None` skips only the Tauri
//! window emits (the UI/morph/click layer is already proven by the vitest +
//! Playwright harness suites). Every exit-code, waiter-routing (A4), and Model B
//! ranking assertion below runs against production logic.
//!
//! Added route: `GET /island-snapshot` returns `manager.island_snapshot(...)` -
//! the SAME production ranking call the IPC-only `get_island_snapshot` command
//! makes. The shipping server exposes no HTTP snapshot surface (a documented
//! gap, T11 finding F1); this probe reuses the real ranking code so the journey
//! can assert the Rust-owned Model B list structurally over HTTP.

use std::sync::Arc;

use axum::{extract::State, routing::get, Json, Router};

use syncfu_lib::notification::manager::{IslandSnapshot, NotificationManager};
use syncfu_lib::server::http::{build_router, ServerState};
use syncfu_lib::server::waiters::WaiterRegistry;

async fn island_snapshot_probe(State(state): State<ServerState>) -> Json<IslandSnapshot> {
    let waiter_ids = state.waiters.active_ids().await;
    Json(state.manager.island_snapshot(&waiter_ids).await)
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let manager: Arc<NotificationManager> = NotificationManager::new();
    let waiters: Arc<WaiterRegistry> = WaiterRegistry::new();

    let state = ServerState {
        manager,
        waiters,
        app_handle: None,
    };

    // Real production router + the snapshot probe (reuses production ranking).
    let app: Router = build_router(state.clone()).merge(
        Router::new()
            .route("/island-snapshot", get(island_snapshot_probe))
            .with_state(state),
    );

    // Ephemeral port: never collides with the user's :9868 production instance.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind ephemeral port");
    let addr = listener.local_addr().expect("local_addr");

    // The runner greps this exact line to learn the base URL.
    println!("JOURNEY_SERVER_URL=http://127.0.0.1:{}", addr.port());
    // Flush stdout so the runner sees the URL before serve() blocks.
    use std::io::Write;
    std::io::stdout().flush().ok();

    axum::serve(listener, app).await.expect("serve");
}
