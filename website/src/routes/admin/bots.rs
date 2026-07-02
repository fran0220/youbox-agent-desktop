#![allow(dead_code)]
// Legacy standalone list page code is retained while GET /admin/bots redirects into the consolidated runtime center.

use askama::Template;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Redirect};

use crate::auth::AdminUser;
use crate::error::{render_template, AppError};
use crate::models::provider;
use crate::services::gateway::GatewayClient;
use crate::AppState;

// ─── Views ───────────────────────────────────────────

#[allow(dead_code)]
struct BotView {
    container_name: String,
    user_id: String,
    ip: String,
    status: String,
    container_type: String,
    config_synced: bool,
    pairing_status: String,
    last_synced: String,
    primary_model: String,
}

// ─── Templates ───────────────────────────────────────

#[derive(Template)]
#[template(path = "admin/bots.html")]
struct BotsTemplate {
    admin_name: String,
    active_page: String,
    bots: Vec<BotView>,
    save_success: bool,
    save_error: Option<String>,
}

// ─── List ────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct ListQuery {
    success: Option<bool>,
    error: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    admin: AdminUser,
    axum::extract::Query(query): axum::extract::Query<ListQuery>,
) -> Result<impl IntoResponse, AppError> {
    let db_bots = provider::list_bot_containers(&state.db).await?;

    let bots: Vec<BotView> = db_bots
        .into_iter()
        .map(|b| {
            let config_synced = match (&b.desired_config_hash, &b.applied_config_hash) {
                (Some(desired), Some(applied)) => desired == applied,
                _ => false,
            };
            let primary_model = b
                .config
                .as_ref()
                .and_then(|c| c.get("primary_model"))
                .and_then(|v| v.as_str())
                .unwrap_or("-")
                .to_string();
            let last_synced = b
                .last_synced_at
                .map(|ts| ts.format("%Y-%m-%d %H:%M").to_string())
                .unwrap_or_else(|| "从未同步".into());

            BotView {
                container_name: b.container_name,
                user_id: b.user_id,
                ip: b.container_ip.unwrap_or_default(),
                status: b.status,
                container_type: b.container_type,
                config_synced,
                pairing_status: b.pairing_status.unwrap_or_else(|| "unknown".into()),
                last_synced,
                primary_model,
            }
        })
        .collect();

    render_template(&BotsTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "bots".into(),
        bots,
        save_success: query.success.unwrap_or(false),
        save_error: query.error,
    })
}

// ─── Sync Config ─────────────────────────────────────

pub async fn sync_config(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let client = GatewayClient::new(
        state.http_client.clone(),
        state.config.gateway.url.clone(),
        state.config.gateway.admin_token.clone(),
    );

    match client.sync_container_config(&name).await {
        Ok(_) => Ok(Redirect::to("/admin/bots?success=true")),
        Err(e) => Ok(Redirect::to(&format!(
            "/admin/bots?error=同步失败: {}",
            urlencoding::encode(&e.to_string())
        ))),
    }
}

// ─── Restart ─────────────────────────────────────────

pub async fn restart(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let client = GatewayClient::new(
        state.http_client.clone(),
        state.config.gateway.url.clone(),
        state.config.gateway.admin_token.clone(),
    );

    match client.restart_container(&name).await {
        Ok(_) => Ok(Redirect::to("/admin/bots?success=true")),
        Err(e) => Ok(Redirect::to(&format!(
            "/admin/bots?error=重启失败: {}",
            urlencoding::encode(&e.to_string())
        ))),
    }
}

// ─── Logs ────────────────────────────────────────────

pub async fn logs(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let client = GatewayClient::new(
        state.http_client.clone(),
        state.config.gateway.url.clone(),
        state.config.gateway.admin_token.clone(),
    );

    let entries = client
        .get_logs("container", Some(&name), None, None, Some(100))
        .await
        .unwrap_or_default();

    let log_text: String = entries
        .iter()
        .map(|e| format!("[{}] {}: {}", e.ts, e.level, e.msg))
        .collect::<Vec<_>>()
        .join("\n");

    // Simple HTML escape
    let escaped = log_text
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");

    Ok(axum::response::Html(format!(
        "<pre class=\"text-xs font-mono whitespace-pre-wrap bg-gray-900 text-green-400 p-4 rounded-xl max-h-96 overflow-auto\">{}</pre>",
        escaped
    )))
}
