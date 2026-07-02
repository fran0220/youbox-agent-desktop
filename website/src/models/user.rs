use crate::error::AppError;
use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
pub struct User {
    pub id: String,
    pub name: String,
    pub email: String,
    pub role: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn list_users(pool: &sqlx::PgPool) -> Result<Vec<User>, AppError> {
    let users = sqlx::query_as::<_, User>(
        "SELECT id, name, email, role, created_at, updated_at FROM users ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(users)
}

pub async fn get_user(pool: &sqlx::PgPool, id: &str) -> Result<Option<User>, AppError> {
    let user = sqlx::query_as::<_, User>(
        "SELECT id, name, email, role, created_at, updated_at FROM users WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(user)
}

#[allow(dead_code)]
pub async fn get_user_by_email(pool: &sqlx::PgPool, email: &str) -> Result<Option<User>, AppError> {
    let user = sqlx::query_as::<_, User>(
        "SELECT id, name, email, role, created_at, updated_at FROM users WHERE email = $1",
    )
    .bind(email)
    .fetch_optional(pool)
    .await?;
    Ok(user)
}

pub async fn update_user_role(pool: &sqlx::PgPool, id: &str, role: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE users SET role = $1 WHERE id = $2")
        .bind(role)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn count_users(pool: &sqlx::PgPool) -> Result<i64, AppError> {
    let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;
    Ok(row.0)
}
