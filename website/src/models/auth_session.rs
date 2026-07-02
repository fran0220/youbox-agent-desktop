use crate::error::AppError;
use chrono::{DateTime, Utc};

pub async fn create_auth_session(
    pool: &sqlx::PgPool,
    user_id: &str,
    token: &str,
    expires_at: DateTime<Utc>,
    ip: Option<&str>,
    user_agent: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO auth_sessions (id, token, user_id, expires_at, ip_address, user_agent) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)",
    )
    .bind(token)
    .bind(user_id)
    .bind(expires_at)
    .bind(ip)
    .bind(user_agent)
    .execute(pool)
    .await?;
    Ok(())
}

/// Returns (user_id, role) if the session is valid and not expired.
pub async fn get_session_by_token(
    pool: &sqlx::PgPool,
    token: &str,
) -> Result<Option<(String, String)>, AppError> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT u.id, u.role FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > now()",
    )
    .bind(token)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

#[allow(dead_code)]
pub async fn delete_auth_session(pool: &sqlx::PgPool, token: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM auth_sessions WHERE token = $1")
        .bind(token)
        .execute(pool)
        .await?;
    Ok(())
}
