use crate::error::AppError;
use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, sqlx::FromRow, Serialize)]
pub struct InviteCode {
    pub code: String,
    pub role: String,
    pub max_uses: i32,
    pub used_count: i32,
    pub created_by: Option<String>,
    pub note: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

pub async fn list_invite_codes(pool: &sqlx::PgPool) -> Result<Vec<InviteCode>, AppError> {
    let codes = sqlx::query_as::<_, InviteCode>(
        "SELECT code, role, max_uses, used_count, created_by, note, expires_at, created_at FROM invite_codes ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(codes)
}

pub async fn create_invite_code(
    pool: &sqlx::PgPool,
    code: &str,
    role: &str,
    max_uses: i32,
    note: &str,
    expires_at: Option<DateTime<Utc>>,
    created_by: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO invite_codes (code, role, max_uses, note, expires_at, created_by) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(code)
    .bind(role)
    .bind(max_uses)
    .bind(note)
    .bind(expires_at)
    .bind(created_by)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn revoke_invite_code(pool: &sqlx::PgPool, code: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM invite_codes WHERE code = $1")
        .bind(code)
        .execute(pool)
        .await?;
    Ok(())
}
