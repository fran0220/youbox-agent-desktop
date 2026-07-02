#![allow(dead_code)]
// Legacy standalone logs page code is retained while GET /admin/logs redirects into the consolidated runtime center.

use askama::Template;
use axum::extract::{Query, State};
use axum::response::IntoResponse;

use crate::auth::AdminUser;
use crate::error::{render_template, AppError};
use crate::models::session;
use crate::services::gateway::{GatewayClient, LogEntry};
use crate::AppState;

#[derive(serde::Deserialize)]
pub struct LogsQuery {
    pub service: Option<String>,
    pub container: Option<String>,
    pub level: Option<String>,
    pub search: Option<String>,
    pub lines: Option<u32>,
}

#[derive(Clone)]
struct ContainerOption {
    name: String,
    user_name: String,
}

#[derive(Template)]
#[template(path = "admin/logs.html")]
struct LogsTemplate {
    admin_name: String,
    active_page: String,
    containers: Vec<ContainerOption>,
    logs: Vec<LogEntry>,
    current_service: String,
    current_container: String,
    current_level: String,
    current_search: String,
    current_lines: u32,
    error_message: String,
}

pub async fn index(
    State(state): State<AppState>,
    admin: AdminUser,
    Query(query): Query<LogsQuery>,
) -> Result<impl IntoResponse, AppError> {
    let service = query.service.as_deref().unwrap_or("agent");
    let lines = query.lines.unwrap_or(200);

    let db_containers = session::list_containers(&state.db)
        .await
        .unwrap_or_default();
    let containers: Vec<ContainerOption> = db_containers
        .into_iter()
        .map(|c| ContainerOption {
            name: c.container_name.clone(),
            user_name: c.user_id,
        })
        .collect();

    let client = GatewayClient::new(
        state.http_client.clone(),
        state.config.gateway.url.clone(),
        state.config.gateway.admin_token.clone(),
    );

    let (logs, error_message) = match client
        .get_logs(
            service,
            query.container.as_deref(),
            query.level.as_deref(),
            query.search.as_deref(),
            Some(lines),
        )
        .await
    {
        Ok(entries) => (entries, String::new()),
        Err(e) => (vec![], format!("{e}")),
    };

    render_template(&LogsTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "logs".into(),
        containers,
        logs,
        current_service: service.to_string(),
        current_container: query.container.unwrap_or_default(),
        current_level: query.level.unwrap_or_default(),
        current_search: query.search.unwrap_or_default(),
        current_lines: lines,
        error_message,
    })
}
