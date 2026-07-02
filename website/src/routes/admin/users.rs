#![allow(dead_code)]
// Legacy standalone list page code is retained while GET /admin/users redirects into the consolidated operations center.

use askama::Template;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Redirect, Response};

use crate::auth::AdminUser;
use crate::error::{render_template, AppError};
use crate::models::user;
use crate::AppState;

#[derive(Clone)]
struct UserView {
    id: String,
    name: String,
    email: String,
    role: String,
    created_at: String,
}

#[derive(Template)]
#[template(path = "admin/users.html")]
struct UsersTemplate {
    admin_name: String,
    active_page: String,
    users: Vec<UserView>,
    total: i64,
    page: i64,
    query: String,
}

#[derive(Template)]
#[template(path = "admin/user_detail.html")]
struct UserDetailTemplate {
    admin_name: String,
    active_page: String,
    user: UserView,
}

#[derive(Template)]
#[template(path = "admin/partials/user_row.html")]
struct UserRowTemplate {
    user: UserView,
}

#[derive(serde::Deserialize)]
pub struct ListParams {
    page: Option<i64>,
    q: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    admin: AdminUser,
    Query(params): Query<ListParams>,
) -> Result<impl IntoResponse, AppError> {
    let page = params.page.unwrap_or(1).max(1);
    let query = params.q.unwrap_or_default().trim().to_string();
    let needle = query.to_lowercase();

    let all_users = user::list_users(&state.db).await?;
    let filtered: Vec<user::User> = all_users
        .into_iter()
        .filter(|u| {
            if needle.is_empty() {
                return true;
            }
            u.name.to_lowercase().contains(&needle) || u.email.to_lowercase().contains(&needle)
        })
        .collect();
    let total = filtered.len() as i64;

    let start = ((page - 1) * 20) as usize;
    let users: Vec<UserView> = filtered
        .into_iter()
        .skip(start)
        .take(20)
        .map(user_view)
        .collect();

    render_template(&UsersTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "users".into(),
        users,
        total,
        page,
        query,
    })
}

pub async fn detail(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let u = user::get_user(&state.db, &id)
        .await?
        .ok_or(AppError::NotFound("User not found".into()))?;
    render_template(&UserDetailTemplate {
        admin_name: admin.0.name,
        active_page: "users".into(),
        user: user_view(u),
    })
}

#[derive(serde::Deserialize)]
pub struct RoleForm {
    role: String,
}

pub async fn change_role(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    axum::Form(form): axum::Form<RoleForm>,
) -> Result<impl IntoResponse, AppError> {
    let role = if form.role == "admin" {
        "admin"
    } else {
        "user"
    };
    user::update_user_role(&state.db, &id, role).await?;
    Ok(Redirect::to(&format!("/admin/users/{id}")))
}

pub async fn toggle_role(
    State(state): State<AppState>,
    _admin: AdminUser,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let u = user::get_user(&state.db, &id)
        .await?
        .ok_or(AppError::NotFound("User not found".into()))?;
    let next_role = if u.role == "admin" { "user" } else { "admin" };
    user::update_user_role(&state.db, &id, next_role).await?;

    if is_htmx_request(&headers) {
        let updated = user::get_user(&state.db, &id)
            .await?
            .ok_or(AppError::NotFound("User not found".into()))?;
        let html = UserRowTemplate {
            user: user_view(updated),
        }
        .render()
        .map_err(|e| AppError::Internal(format!("template render error: {e}")))?;
        return Ok(axum::response::Html(html).into_response());
    }

    Ok(Redirect::to("/admin/users").into_response())
}

fn is_htmx_request(headers: &HeaderMap) -> bool {
    headers
        .get("HX-Request")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn user_view(u: user::User) -> UserView {
    UserView {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        created_at: u.created_at.format("%Y-%m-%d %H:%M").to_string(),
    }
}
