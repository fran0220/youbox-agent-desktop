use crate::error::AppError;
use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, sqlx::FromRow, Serialize)]
pub struct Game {
    pub id: String,
    pub user_id: String,
    pub author_name: String,
    pub title: String,
    pub description: String,
    pub thumbnail_url: String,
    pub play_url: String,
    pub status: String,
    pub play_count: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn list_published(pool: &sqlx::PgPool) -> Result<Vec<Game>, AppError> {
    let games = sqlx::query_as::<_, Game>(
        "SELECT id, user_id, author_name, title, description, thumbnail_url, play_url, status, play_count, created_at, updated_at
         FROM games WHERE status = 'published' ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(games)
}

pub async fn get_game(pool: &sqlx::PgPool, id: &str) -> Result<Option<Game>, AppError> {
    let game = sqlx::query_as::<_, Game>(
        "SELECT id, user_id, author_name, title, description, thumbnail_url, play_url, status, play_count, created_at, updated_at
         FROM games WHERE id = $1 AND status = 'published'",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(game)
}

pub async fn increment_play_count(pool: &sqlx::PgPool, id: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE games SET play_count = play_count + 1 WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}
