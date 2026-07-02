#![allow(dead_code)]
// Legacy standalone list page code is retained while GET /admin/containers redirects into the consolidated runtime center.

use askama::Template;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Redirect, Response};

use crate::auth::AdminUser;
use crate::error::{render_template, AppError};
use crate::models::session;
use crate::services::gateway::GatewayClient;
use crate::AppState;

#[derive(Clone)]
struct ContainerView {
    id: String,
    name: String,
    user_name: String,
    ip: String,
    status: String,
}

#[derive(Template)]
#[template(path = "admin/containers.html")]
struct ContainersTemplate {
    admin_name: String,
    active_page: String,
    containers: Vec<ContainerView>,
}

#[derive(Template)]
#[template(path = "admin/partials/container_row.html")]
struct ContainerRowTemplate {
    container: ContainerView,
}

pub async fn list(
    State(state): State<AppState>,
    admin: AdminUser,
) -> Result<impl IntoResponse, AppError> {
    let db_containers = session::list_containers(&state.db).await?;
    let containers: Vec<ContainerView> = db_containers.into_iter().map(container_view).collect();

    render_template(&ContainersTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "containers".into(),
        containers,
    })
}

pub async fn start(
    State(state): State<AppState>,
    _admin: AdminUser,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let client = GatewayClient::new(
        state.http_client.clone(),
        state.config.gateway.url.clone(),
        state.config.gateway.admin_token.clone(),
    );
    client.start_container(&id).await?;

    if is_htmx_request(&headers) {
        let container = session::get_container_by_name(&state.db, &id)
            .await?
            .ok_or(AppError::NotFound("Container not found".into()))?;
        let html = ContainerRowTemplate {
            container: container_view(container),
        }
        .render()
        .map_err(|e| AppError::Internal(format!("template render error: {e}")))?;
        return Ok(axum::response::Html(html).into_response());
    }

    Ok(Redirect::to("/admin/containers").into_response())
}

pub async fn stop(
    State(state): State<AppState>,
    _admin: AdminUser,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let client = GatewayClient::new(
        state.http_client.clone(),
        state.config.gateway.url.clone(),
        state.config.gateway.admin_token.clone(),
    );
    client.stop_container(&id).await?;

    if is_htmx_request(&headers) {
        let container = session::get_container_by_name(&state.db, &id)
            .await?
            .ok_or(AppError::NotFound("Container not found".into()))?;
        let html = ContainerRowTemplate {
            container: container_view(container),
        }
        .render()
        .map_err(|e| AppError::Internal(format!("template render error: {e}")))?;
        return Ok(axum::response::Html(html).into_response());
    }

    Ok(Redirect::to("/admin/containers").into_response())
}

fn container_view(c: session::ContainerInfo) -> ContainerView {
    ContainerView {
        id: c.container_name.clone(),
        name: c.container_name,
        user_name: c.user_id,
        ip: c.container_ip.unwrap_or_default(),
        status: c.status,
    }
}

fn is_htmx_request(headers: &HeaderMap) -> bool {
    headers
        .get("HX-Request")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}
