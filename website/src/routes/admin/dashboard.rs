use askama::Template;
use axum::extract::State;
use axum::response::IntoResponse;

use crate::auth::AdminUser;
use crate::error::{render_template, AppError};
use crate::models::{audit, feedback, session, user};
use crate::AppState;

struct DashLogView {
    created_at: String,
    user_id: String,
    action: String,
}

#[derive(Template)]
#[template(path = "admin/dashboard.html")]
struct DashboardTemplate {
    admin_name: String,
    active_page: String,
    user_count: i64,
    session_count: i64,
    container_count: i64,
    feedback_count: i64,
    recent_logs: Vec<DashLogView>,
}

pub async fn index(
    State(state): State<AppState>,
    admin: AdminUser,
) -> Result<impl IntoResponse, AppError> {
    let user_count = user::count_users(&state.db).await?;
    let stats = session::get_session_stats(&state.db).await?;
    let containers = session::list_containers(&state.db).await?;
    let container_count = containers.iter().filter(|c| c.status == "running").count() as i64;
    let fb_counts = feedback::count_feedback_by_status(&state.db).await?;
    let feedback_count = fb_counts.get("open").copied().unwrap_or(0);

    let raw_logs = audit::list_audit_logs(&state.db, None, None, None, None, 10, 0).await?;
    let recent_logs: Vec<DashLogView> = raw_logs
        .into_iter()
        .map(|l| DashLogView {
            created_at: l.created_at.format("%m-%d %H:%M").to_string(),
            user_id: l.user_id.unwrap_or_default(),
            action: l.action,
        })
        .collect();

    render_template(&DashboardTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "dashboard".into(),
        user_count,
        session_count: stats.active_today,
        container_count,
        feedback_count,
        recent_logs,
    })
}
