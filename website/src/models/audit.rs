use crate::error::AppError;
use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, sqlx::FromRow, Serialize)]
pub struct AuditLog {
    pub id: i64,
    pub user_id: Option<String>,
    pub action: String,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
    pub detail: serde_json::Value,
    pub ip_address: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub async fn list_audit_logs(
    pool: &sqlx::PgPool,
    user_id: Option<&str>,
    action: Option<&str>,
    from_time: Option<DateTime<Utc>>,
    to_time: Option<DateTime<Utc>>,
    limit: i64,
    offset: i64,
) -> Result<Vec<AuditLog>, AppError> {
    let logs = sqlx::query_as::<_, AuditLog>(
        r#"
        SELECT id, user_id, action, resource_type, resource_id, detail, ip_address::text AS ip_address, created_at
        FROM audit_logs
        WHERE ($1::text IS NULL OR user_id = $1)
          AND ($2::text IS NULL OR action = $2)
          AND ($3::timestamptz IS NULL OR created_at >= $3)
          AND ($4::timestamptz IS NULL OR created_at <= $4)
        ORDER BY created_at DESC
        LIMIT $5 OFFSET $6
        "#,
    )
    .bind(user_id)
    .bind(action)
    .bind(from_time)
    .bind(to_time)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;
    Ok(logs)
}

pub async fn count_audit_logs(
    pool: &sqlx::PgPool,
    user_id: Option<&str>,
    action: Option<&str>,
    from_time: Option<DateTime<Utc>>,
    to_time: Option<DateTime<Utc>>,
) -> Result<i64, AppError> {
    let row: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)
        FROM audit_logs
        WHERE ($1::text IS NULL OR user_id = $1)
          AND ($2::text IS NULL OR action = $2)
          AND ($3::timestamptz IS NULL OR created_at >= $3)
          AND ($4::timestamptz IS NULL OR created_at <= $4)
        "#,
    )
    .bind(user_id)
    .bind(action)
    .bind(from_time)
    .bind(to_time)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}
