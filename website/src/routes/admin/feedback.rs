#![allow(dead_code)]
// Legacy standalone list page code is retained while GET /admin/feedback redirects into the consolidated operations center.

use askama::Template;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Redirect, Response};

use crate::auth::AdminUser;
use crate::error::{render_template, AppError};
use crate::models::feedback as fb_model;
use crate::AppState;

#[derive(Clone)]
struct FeedbackView {
    id: String,
    name: String,
    email: String,
    category: String,
    message: String,
    app_version: String,
    status: String,
    admin_reply: String,
    created_at: String,
}

#[derive(Template)]
#[template(path = "admin/feedback_list.html")]
struct FeedbackListTemplate {
    admin_name: String,
    active_page: String,
    current_filter: String,
    items: Vec<FeedbackView>,
}

#[derive(Template)]
#[template(path = "admin/partials/feedback_item.html")]
struct FeedbackItemTemplate {
    item: FeedbackView,
}

#[derive(serde::Deserialize)]
pub struct FilterParams {
    status: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    admin: AdminUser,
    Query(params): Query<FilterParams>,
) -> Result<impl IntoResponse, AppError> {
    let filter = params.status.as_deref();
    let current_filter = filter.unwrap_or("all").to_string();
    let raw = fb_model::list_feedback(&state.db, filter).await?;

    let items: Vec<FeedbackView> = raw.into_iter().map(feedback_view).collect();

    render_template(&FeedbackListTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "feedback".into(),
        current_filter,
        items,
    })
}

#[derive(serde::Deserialize)]
pub struct ReplyForm {
    reply: String,
    status: Option<String>,
}

pub async fn reply(
    State(state): State<AppState>,
    _admin: AdminUser,
    headers: HeaderMap,
    Path(id): Path<String>,
    axum::Form(form): axum::Form<ReplyForm>,
) -> Result<Response, AppError> {
    if !form.reply.trim().is_empty() {
        fb_model::reply_feedback(&state.db, &id, form.reply.trim()).await?;
    }
    if let Some(status) = &form.status {
        fb_model::update_feedback_status(&state.db, &id, status).await?;
    }

    if is_htmx_request(&headers) {
        let updated = fb_model::get_feedback(&state.db, &id)
            .await?
            .ok_or(AppError::NotFound("Feedback not found".into()))?;
        let html = FeedbackItemTemplate {
            item: feedback_view(updated),
        }
        .render()
        .map_err(|e| AppError::Internal(format!("template render error: {e}")))?;
        return Ok(axum::response::Html(html).into_response());
    }

    Ok(Redirect::to("/admin/feedback").into_response())
}

#[derive(serde::Deserialize)]
pub struct StatusForm {
    status: String,
}

pub async fn update_status(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    axum::Form(form): axum::Form<StatusForm>,
) -> Result<impl IntoResponse, AppError> {
    fb_model::update_feedback_status(&state.db, &id, &form.status).await?;
    Ok(Redirect::to("/admin/feedback"))
}

fn feedback_view(f: fb_model::Feedback) -> FeedbackView {
    FeedbackView {
        id: f.id,
        name: f.name.unwrap_or_default(),
        email: f.email.unwrap_or_default(),
        category: f.category,
        message: f.message,
        app_version: f.app_version.unwrap_or_default(),
        status: f.status,
        admin_reply: f.admin_reply.unwrap_or_default(),
        created_at: f.created_at.format("%Y-%m-%d %H:%M").to_string(),
    }
}

fn is_htmx_request(headers: &HeaderMap) -> bool {
    headers
        .get("HX-Request")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}
