use crate::error::AppError;
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, sqlx::FromRow, Serialize)]
pub struct Feedback {
    pub id: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub category: String,
    pub message: String,
    pub app_version: Option<String>,
    pub status: String,
    pub admin_reply: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn list_feedback(
    pool: &sqlx::PgPool,
    status_filter: Option<&str>,
) -> Result<Vec<Feedback>, AppError> {
    let feedbacks = if let Some(status) = status_filter {
        sqlx::query_as::<_, Feedback>(
            "SELECT id, name, email, category, message, app_version, status, admin_reply, created_at, updated_at FROM feedback WHERE status = $1 ORDER BY created_at DESC",
        )
        .bind(status)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, Feedback>(
            "SELECT id, name, email, category, message, app_version, status, admin_reply, created_at, updated_at FROM feedback ORDER BY created_at DESC",
        )
        .fetch_all(pool)
        .await?
    };
    Ok(feedbacks)
}

pub async fn get_feedback(pool: &sqlx::PgPool, id: &str) -> Result<Option<Feedback>, AppError> {
    let feedback = sqlx::query_as::<_, Feedback>(
        "SELECT id, name, email, category, message, app_version, status, admin_reply, created_at, updated_at FROM feedback WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(feedback)
}

pub async fn create_feedback(
    pool: &sqlx::PgPool,
    name: Option<&str>,
    email: Option<&str>,
    category: &str,
    message: &str,
    app_version: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO feedback (id, name, email, category, message, app_version, status) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, 'open')",
    )
    .bind(name)
    .bind(email)
    .bind(category)
    .bind(message)
    .bind(app_version)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn update_feedback_status(
    pool: &sqlx::PgPool,
    id: &str,
    status: &str,
) -> Result<(), AppError> {
    sqlx::query("UPDATE feedback SET status = $1 WHERE id = $2")
        .bind(status)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn reply_feedback(pool: &sqlx::PgPool, id: &str, reply: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE feedback SET admin_reply = $1, status = 'replied' WHERE id = $2")
        .bind(reply)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn count_feedback_by_status(
    pool: &sqlx::PgPool,
) -> Result<HashMap<String, i64>, AppError> {
    let rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT status, COUNT(*) FROM feedback GROUP BY status")
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().collect())
}
