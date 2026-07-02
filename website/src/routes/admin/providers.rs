#![allow(dead_code)]
// Legacy standalone provider page code is retained while GET /admin/providers redirects into the consolidated config center.

use askama::Template;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Redirect, Response};

use crate::auth::AdminUser;
use crate::error::{render_template, AppError};
use crate::models::provider;
use crate::AppState;

// ─── Views ───────────────────────────────────────────

#[allow(dead_code)]
struct ProviderView {
    key: String,
    display_name: String,
    api_type: String,
    base_url: String,
    api_key_ref: String,
    enabled: bool,
    sort_order: i32,
}

#[allow(dead_code)]
struct ModelView {
    id: String,
    provider_key: String,
    model_id: String,
    display_name: String,
    context_window: i32,
    max_tokens: i32,
    reasoning: bool,
    enabled: bool,
    sort_order: i32,
}

// ─── Templates ───────────────────────────────────────

#[derive(Template)]
#[template(path = "admin/providers.html")]
struct ProvidersTemplate {
    admin_name: String,
    active_page: String,
    providers: Vec<ProviderView>,
    models: Vec<ModelView>,
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
    render_providers_page(&state, &admin, query.success.unwrap_or(false), query.error).await
}

// ─── Upsert Provider ────────────────────────────────

#[derive(serde::Deserialize)]
pub struct ProviderForm {
    key: String,
    display_name: String,
    api_type: String,
    base_url: String,
    api_key_ref: String,
    enabled: Option<String>,
}

pub async fn upsert_provider_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    axum::Form(form): axum::Form<ProviderForm>,
) -> Result<Response, AppError> {
    let key = form.key.trim();
    if key.is_empty() {
        return Ok(Redirect::to("/admin/providers?error=Provider key 不能为空").into_response());
    }

    let enabled = form.enabled.is_some();
    provider::upsert_provider(
        &state.db,
        key,
        form.display_name.trim(),
        form.api_type.trim(),
        form.base_url.trim(),
        form.api_key_ref.trim(),
        enabled,
    )
    .await?;

    Ok(Redirect::to("/admin/providers?success=true").into_response())
}

// ─── Delete Provider ────────────────────────────────

pub async fn delete_provider_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    headers: HeaderMap,
    Path(key): Path<String>,
) -> Result<Response, AppError> {
    provider::delete_provider(&state.db, &key).await?;

    if is_htmx_request(&headers) {
        Ok(axum::response::Html("").into_response())
    } else {
        Ok(Redirect::to("/admin/providers?success=true").into_response())
    }
}

// ─── Upsert Model ───────────────────────────────────

#[derive(serde::Deserialize)]
pub struct ModelForm {
    provider_key: String,
    model_id: String,
    display_name: String,
    context_window: i32,
    max_tokens: i32,
    reasoning: Option<String>,
    enabled: Option<String>,
}

pub async fn upsert_model_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    axum::Form(form): axum::Form<ModelForm>,
) -> Result<Response, AppError> {
    let provider_key = form.provider_key.trim();
    let model_id = form.model_id.trim();
    if provider_key.is_empty() || model_id.is_empty() {
        return Ok(
            Redirect::to("/admin/providers?error=Provider key 和 Model ID 不能为空")
                .into_response(),
        );
    }

    let reasoning = form.reasoning.is_some();
    let enabled = form.enabled.is_some();
    provider::upsert_model(
        &state.db,
        provider_key,
        model_id,
        form.display_name.trim(),
        form.context_window,
        form.max_tokens,
        reasoning,
        enabled,
    )
    .await?;

    Ok(Redirect::to("/admin/providers?success=true").into_response())
}

// ─── Delete Model ───────────────────────────────────

pub async fn delete_model_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    provider::delete_model(&state.db, &id).await?;

    if is_htmx_request(&headers) {
        Ok(axum::response::Html("").into_response())
    } else {
        Ok(Redirect::to("/admin/providers?success=true").into_response())
    }
}

// ─── Helpers ─────────────────────────────────────────

async fn render_providers_page(
    state: &AppState,
    admin: &AdminUser,
    save_success: bool,
    save_error: Option<String>,
) -> Result<impl IntoResponse, AppError> {
    let db_providers = provider::list_providers(&state.db).await?;
    let db_models = provider::list_models(&state.db).await?;

    let providers: Vec<ProviderView> = db_providers
        .into_iter()
        .map(|p| ProviderView {
            key: p.key,
            display_name: p.display_name,
            api_type: p.api_type,
            base_url: p.base_url,
            api_key_ref: p.api_key_ref,
            enabled: p.enabled,
            sort_order: p.sort_order,
        })
        .collect();

    let models: Vec<ModelView> = db_models
        .into_iter()
        .map(|m| ModelView {
            id: m.id,
            provider_key: m.provider_key,
            model_id: m.model_id,
            display_name: m.display_name,
            context_window: m.context_window,
            max_tokens: m.max_tokens,
            reasoning: m.reasoning,
            enabled: m.enabled,
            sort_order: m.sort_order,
        })
        .collect();

    render_template(&ProvidersTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "providers".into(),
        providers,
        models,
        save_success,
        save_error,
    })
}

fn is_htmx_request(headers: &HeaderMap) -> bool {
    headers
        .get("HX-Request")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}
