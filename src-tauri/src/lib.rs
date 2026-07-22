pub mod notification;
pub mod overlay;
pub mod server;
pub mod tray;

use std::sync::Arc;

use log::{error, info};
use notification::manager::{IslandSnapshot, NotificationManager};
use notification::settings::{self, IslandSettings};
use notification::types::{NotificationPayload, NotificationUpdate, Presentation, Priority, Timeout};
use server::http::ServerState;
use server::waiters::{WaitEvent, WaiterRegistry};
use server::webhook::{self, WebhookPayload, WebhookResult};
use tauri::{Emitter, Manager};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

#[cfg(debug_assertions)]
const LOG_LEVEL: log::LevelFilter = log::LevelFilter::Debug;

#[cfg(not(debug_assertions))]
const LOG_LEVEL: log::LevelFilter = log::LevelFilter::Info;

/// Recompute and emit the authoritative Model B island snapshot (D5 / G10) to the
/// island window ONLY (`emit_to`, so the top-right panel never sees it). Called on
/// EVERY manager change so the frontend `IslandList` renders a truth it never
/// re-derives (C1). `hasWaiter` is enriched here from the live `WaiterRegistry`.
pub async fn emit_island_snapshot(
    app: &tauri::AppHandle,
    manager: &NotificationManager,
    waiters: &WaiterRegistry,
) {
    let waiter_ids = waiters.active_ids().await;
    let snapshot = manager.island_snapshot(&waiter_ids).await;
    if let Err(e) = app.emit_to(overlay::island::ISLAND_LABEL, "island:snapshot", &snapshot) {
        error!("Failed to emit island:snapshot: {e}");
    }
}

#[tauri::command]
async fn notify(
    manager: tauri::State<'_, Arc<NotificationManager>>,
    waiters: tauri::State<'_, Arc<WaiterRegistry>>,
    payload: NotificationPayload,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let id = manager.add(payload.clone()).await;
    route_show_and_emit(&app, &payload)?;
    // History ingest (presentation-agnostic, single ingest point): mirrors the HTTP
    // path so a notification created over the Tauri command is recorded in history
    // exactly once too. Only the main-window historyStore listens.
    if let Err(e) = app.emit("history:add", &payload) {
        error!("Failed to emit history:add: {e}");
    }
    emit_island_snapshot(&app, &manager, &waiters).await;
    Ok(id)
}

/// Show the target overlay window and emit `notification:add` to it, routed by presentation.
///
/// `Card` keeps the existing broadcast + panel path (byte-identical, invariant f). `Island` shows
/// only the island and scopes the emit to the island window so the top-right panel never pops
/// (FR-3) and the panel's frontend never accumulates island state.
fn route_show_and_emit(
    app: &tauri::AppHandle,
    payload: &NotificationPayload,
) -> Result<(), String> {
    match overlay::OverlayRoute::of(payload.presentation) {
        overlay::OverlayRoute::Panel => {
            overlay::panel::show_panel(app);
            app.emit("notification:add", payload)
                .map_err(|e| e.to_string())
        }
        overlay::OverlayRoute::Island => {
            overlay::island::show_island(app);
            app.emit_to(overlay::island::ISLAND_LABEL, "notification:add", payload)
                .map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
async fn dismiss_notification(
    manager: tauri::State<'_, Arc<NotificationManager>>,
    waiters: tauri::State<'_, Arc<WaiterRegistry>>,
    id: String,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    let dismissed = manager.dismiss(&id).await;
    if let Some(ref notification) = dismissed {
        // Notify waiting CLI clients
        waiters.notify(&id, WaitEvent::Dismissed).await;

        app.emit("notification:dismiss", &id)
            .map_err(|e| e.to_string())?;
        // Hide the hosting window if no more active notifications
        if manager.active_count().await == 0 {
            overlay::hide_for(&app, notification.presentation);
        }
    }
    emit_island_snapshot(&app, &manager, &waiters).await;
    Ok(dismissed.is_some())
}

#[tauri::command]
async fn dismiss_all(
    manager: tauri::State<'_, Arc<NotificationManager>>,
    waiters: tauri::State<'_, Arc<WaiterRegistry>>,
    app: tauri::AppHandle,
) -> Result<usize, String> {
    // Notify all waiting CLI clients before clearing
    waiters.notify_all(WaitEvent::Dismissed).await;

    let dismissed = manager.dismiss_all().await;
    let count = dismissed.len();
    // Broadcast dismissal hides both overlay windows.
    overlay::panel::hide_panel(&app);
    overlay::island::hide_island(&app);
    app.emit("notification:dismiss-all", &count)
        .map_err(|e| e.to_string())?;
    emit_island_snapshot(&app, &manager, &waiters).await;
    Ok(count)
}

#[tauri::command]
async fn update_notification(
    manager: tauri::State<'_, Arc<NotificationManager>>,
    waiters: tauri::State<'_, Arc<WaiterRegistry>>,
    id: String,
    update: NotificationUpdate,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    let updated = manager.update(&id, update.clone()).await;
    if updated {
        app.emit("notification:update", &serde_json::json!({ "id": id, "update": update }))
            .map_err(|e| e.to_string())?;
        emit_island_snapshot(&app, &manager, &waiters).await;
    }
    Ok(updated)
}

#[tauri::command]
async fn get_active_notifications(
    manager: tauri::State<'_, Arc<NotificationManager>>,
) -> Result<Vec<NotificationPayload>, String> {
    Ok(manager.list_active().await)
}

#[tauri::command]
async fn health(
    manager: tauri::State<'_, Arc<NotificationManager>>,
) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "status": "ok",
        "activeCount": manager.active_count().await,
    }))
}

/// Fire webhook callback when a user clicks an action button on a notification.
/// Looks up the notification's callback_url, POSTs action details, then dismisses.
#[tauri::command]
async fn action_callback(
    manager: tauri::State<'_, Arc<NotificationManager>>,
    waiters: tauri::State<'_, Arc<WaiterRegistry>>,
    notification_id: String,
    action_id: String,
    app: tauri::AppHandle,
) -> Result<WebhookResult, String> {
    let notification = manager
        .get(&notification_id)
        .await
        .ok_or_else(|| format!("Notification not found: {notification_id}"))?;

    let result = if let Some(ref url) = notification.callback_url {
        let payload = WebhookPayload {
            notification_id: notification_id.clone(),
            action_id: action_id.clone(),
            sender: notification.sender.clone(),
            title: notification.title.clone(),
        };
        webhook::fire_webhook(url, &payload).await
    } else {
        info!("No callback_url for notification={notification_id}, action={action_id} — skipping webhook");
        WebhookResult {
            success: true,
            status_code: None,
            error: None,
        }
    };

    // Notify waiting CLI clients
    waiters
        .notify(
            &notification_id,
            WaitEvent::Action {
                action_id: action_id.clone(),
            },
        )
        .await;

    // Dismiss after action regardless of webhook result
    let dismissed = manager.dismiss(&notification_id).await;
    if let Some(ref notification) = dismissed {
        app.emit("notification:dismiss", &notification_id)
            .map_err(|e| e.to_string())?;
        if manager.active_count().await == 0 {
            overlay::hide_for(&app, notification.presentation);
        }
    }
    emit_island_snapshot(&app, &manager, &waiters).await;

    Ok(result)
}

/// Read the persistent island settings (D4), clamped. Missing/corrupt file yields defaults.
#[tauri::command]
async fn get_island_settings(app: tauri::AppHandle) -> Result<IslandSettings, String> {
    let path = settings::settings_path(&app)?;
    Ok(settings::load_settings(&path))
}

/// Persist island settings and push the change to the live island - never rebuilds the window (D3/G2).
///
/// The incoming settings are clamped (never trust IPC input), saved atomically, then applied in
/// place: reflow only when a geometry field changed, re-apply capture protection only when the
/// `hideFromScreenCapture` toggle changed, and emit `island:settings` scoped to the island window so
/// the top-right panel never sees it. Returns the clamped settings so the caller mirrors what was
/// stored. The notification payload schema is untouched (G12).
#[tauri::command]
async fn set_island_settings(
    app: tauri::AppHandle,
    settings: IslandSettings,
) -> Result<IslandSettings, String> {
    let path = settings::settings_path(&app)?;
    let previous = settings::load_settings(&path);
    let next = settings.clamped();

    settings::save_settings(&path, &next)?;

    if next.geometry_differs(&previous) {
        overlay::island::reflow_island(&app);
    }
    if next.hide_from_screen_capture != previous.hide_from_screen_capture {
        overlay::island::set_island_capture_protected(&app, next.hide_from_screen_capture);
    }

    app.emit_to(overlay::island::ISLAND_LABEL, "island:settings", &next)
        .map_err(|e| e.to_string())?;
    Ok(next)
}

/// Report the honest, OS-derived screen-capture status of the island (T9).
///
/// Derived only from the OS + version (never a `sharingType` read-back, which is false safety per
/// G2). Returns the tri-state (ON / BEST_EFFORT / UNSUPPORTED / UNKNOWN) plus a reason and the live
/// `hideFromScreenCapture` toggle, so T7b can render an honest status. The exclusion flag itself is
/// applied unconditionally as defense-in-depth (island.rs); this command only describes the outcome.
#[tauri::command]
async fn get_island_capture_status(
    app: tauri::AppHandle,
) -> Result<overlay::island::IslandCaptureStatus, String> {
    let path = settings::settings_path(&app)?;
    let enabled = settings::load_settings(&path).hide_from_screen_capture;
    Ok(overlay::island::current_capture_status(enabled))
}

/// Toggle whether the island window receives pointer events (in place, never rebuilds - D3/G2).
#[tauri::command]
async fn set_island_interactive(app: tauri::AppHandle, interactive: bool) -> Result<(), String> {
    overlay::island::set_island_interactive(&app, interactive);
    Ok(())
}

/// Report the live notch cutout geometry to the island webview (BUG A). `None` on non-notch / non-
/// macOS displays, where the frontend keeps the floating-capsule layout. The window's creation-read
/// path calls this on mount; monitor changes arrive via the `island:geometry` event.
#[tauri::command]
async fn get_notch_geometry(
    app: tauri::AppHandle,
) -> Result<Option<overlay::island::NotchGeometryDto>, String> {
    Ok(overlay::island::notch_geometry_dto(&app))
}

/// Store the island's true visible-shape hitbox (BUG B), in window-relative logical px. The frontend
/// reports it on morph settle and on show/hide (NOT per frame); the backend cursor tracker toggles
/// the window interactive only while the pointer is inside it, keeping the transparent envelope
/// click-through. In place, never rebuilds the window (D3/G2).
#[tauri::command]
async fn set_island_hitbox(x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    overlay::hover::set_hitbox(overlay::hover::Hitbox { x, y, w, h });
    Ok(())
}

/// Read the current authoritative island snapshot (D5 / G10). The creation-read
/// the island window makes on mount so a window that starts AFTER notifications
/// already exist reconciles immediately (closes W3 undercount / late-listener).
#[tauri::command]
async fn get_island_snapshot(
    manager: tauri::State<'_, Arc<NotificationManager>>,
    waiters: tauri::State<'_, Arc<WaiterRegistry>>,
) -> Result<IslandSnapshot, String> {
    let waiter_ids = waiters.active_ids().await;
    Ok(manager.island_snapshot(&waiter_ids).await)
}

/// Send a test notification for manual testing during development.
#[tauri::command]
async fn test_notify(
    manager: tauri::State<'_, Arc<NotificationManager>>,
    waiters: tauri::State<'_, Arc<WaiterRegistry>>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let payload = NotificationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        sender: "syncfu".to_string(),
        title: "Test Notification".to_string(),
        body: "syncfu is working! This is a test notification.".to_string(),
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
    let id = manager.add(payload.clone()).await;
    route_show_and_emit(&app, &payload)?;
    // History ingest (presentation-agnostic, single ingest point): mirrors the HTTP
    // path so a notification created over the Tauri command is recorded in history
    // exactly once too. Only the main-window historyStore listens.
    if let Err(e) = app.emit("history:add", &payload) {
        error!("Failed to emit history:add: {e}");
    }
    emit_island_snapshot(&app, &manager, &waiters).await;
    Ok(id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install panic hook so crashes are logged, not silent
    std::panic::set_hook(Box::new(|info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown".to_string());
        let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic".to_string()
        };
        // Log to stderr (always available, even before log plugin init)
        eprintln!("[syncfu PANIC] at {location}: {message}");
        // Also try the log crate in case it's initialized
        log::error!("[PANIC] at {location}: {message}");
    }));

    let manager = NotificationManager::new();
    let waiters = WaiterRegistry::new();

    #[cfg(debug_assertions)]
    let log_targets = vec![
        Target::new(TargetKind::LogDir {
            file_name: Some("syncfu-dev".into()),
        }),
        Target::new(TargetKind::Stdout),
        Target::new(TargetKind::Webview),
    ];

    #[cfg(not(debug_assertions))]
    let log_targets = vec![
        Target::new(TargetKind::LogDir {
            file_name: Some("syncfu".into()),
        }),
        Target::new(TargetKind::Stdout),
    ];

    let mut builder = tauri::Builder::default();

    // Single-instance guard MUST be registered FIRST (tauri v2 requirement): it kills
    // any second launch before the rest of setup runs, so a duplicate can never squat
    // beside the first instance with a dead HTTP bind on :9868 (the observed bug where
    // dev + prod coexisted). The callback fires in the EXISTING instance when a second
    // launch is attempted - focus/show its main window so the user sees the live app.
    // Desktop-only (the plugin is `#![cfg(not(any(android, ios)))]`).
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            info!("Second instance launched; focusing the existing main window");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder = builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets(log_targets)
                .level(LOG_LEVEL)
                .max_file_size(5 * 1024 * 1024) // 5 MB
                .rotation_strategy(RotationStrategy::KeepAll)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(manager)
        .manage(waiters.clone());

    // Register tauri-nspanel plugin on macOS for NSPanel support
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            notify,
            dismiss_notification,
            dismiss_all,
            update_notification,
            get_active_notifications,
            health,
            test_notify,
            action_callback,
            get_island_settings,
            set_island_settings,
            set_island_interactive,
            get_island_capture_status,
            get_island_snapshot,
            get_notch_geometry,
            set_island_hitbox,
        ])
        .setup(|app| {
            info!("syncfu starting up");

            // Set up system tray
            tray::menu::setup_tray(app.handle())
                .expect("failed to set up system tray");
            info!("System tray initialized");

            // Create notification panel — small positioned window, top-right
            overlay::panel::create_panel(app.handle())
                .expect("failed to create notification panel");
            info!("Notification panel created (hidden until first notification)");

            // Create the dynamic-island window - top-center, hidden until an island notification.
            overlay::island::create_island(app.handle())
                .expect("failed to create island window");
            info!("Island window created (hidden until first island notification)");

            // Start HTTP server on port 9868
            info!("Starting HTTP server on port 9868");
            let manager = app.state::<Arc<NotificationManager>>().inner().clone();
            let waiters = app.state::<Arc<WaiterRegistry>>().inner().clone();
            let server_state = ServerState {
                manager,
                waiters,
                app_handle: Some(app.handle().clone()),
            };
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::http::start_server(server_state, 9868).await {
                    // LOUD (T15): :9868 is the app's ONLY inbound control surface. If it
                    // cannot bind, the overlay UI still runs but `syncfu send` can never
                    // reach THIS process - a silent, confusing half-alive state. The
                    // single-instance guard above prevents the duplicate-instance cause,
                    // so reaching here means an EXTERNAL port conflict. No exit logic by
                    // design (the app remains useful as an overlay host); just make the
                    // failure unmistakable in the log AND on stderr.
                    error!(
                        "FATAL: HTTP server on :9868 failed to bind ({e}). syncfu is running \
                         WITHOUT its CLI bridge; `syncfu send` will not reach this instance. \
                         Free the port or quit the process holding it."
                    );
                    eprintln!(
                        "[syncfu] FATAL: HTTP server on :9868 failed to bind: {e}. CLI bridge is DOWN."
                    );
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide main window on close instead of destroying
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building syncfu")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                // macOS dock click — re-show the main window
                tray::menu::open_main_window(app);
            }
        });
}
