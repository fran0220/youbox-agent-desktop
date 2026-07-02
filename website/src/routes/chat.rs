use askama::Template;
use axum::extract::State;
use axum::response::IntoResponse;

use crate::auth::AuthUser;
use crate::error::{render_template, AppError};
use crate::AppState;

#[derive(Template)]
#[template(path = "chat.html")]
struct ChatTemplate {
    gateway_url: String,
    user_name: String,
    auth_token: String,
    openclaw_token: String,
    openclaw_ws_port: i32,
    openclaw_vnc_url: String,
    posthog_key: String,
    posthog_host: String,
}

/// Chat page — serves the React SPA with injected auth context.
/// Cookie token doubles as the Gateway auth token (shared DB).
/// For OpenClaw containers, also injects the container_token for in-band auth.
pub async fn page(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let gateway_url = state
        .config
        .gateway
        .public_url
        .as_deref()
        .unwrap_or(&state.config.gateway.url)
        .to_string();

    // Look up OpenClaw container token + WS port for this user (empty/0 if vm-agent or no container)
    let (openclaw_token, openclaw_ws_port, vnc_port) = sqlx::query_as::<_, (String, Option<i32>, Option<i32>)>(
        "SELECT COALESCE(container_token, ''), host_port, vnc_port FROM containers WHERE user_id = $1 AND container_type = 'openclaw'",
    )
    .bind(&auth.user.id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .map(|(t, p, v)| (t, p.unwrap_or(0), v.unwrap_or(0)))
    .unwrap_or_default();

    let openclaw_vnc_url = if vnc_port > 0 {
        format!("{}/vnc/vnc.html", gateway_url)
    } else {
        String::new()
    };

    render_template(&ChatTemplate {
        gateway_url,
        user_name: auth.user.name.clone(),
        auth_token: auth.token,
        openclaw_token,
        openclaw_ws_port,
        openclaw_vnc_url,
        posthog_key: state.config.posthog.api_key.clone(),
        posthog_host: state.config.posthog.host.clone(),
    })
}
