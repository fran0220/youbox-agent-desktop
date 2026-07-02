use crate::error::AppError;
use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};

#[derive(Debug, sqlx::FromRow)]
#[allow(dead_code)]
pub struct SkillFile {
    pub owner: String,
    pub file_path: String,
    pub content: String,
    pub checksum: String,
    pub updated_at: DateTime<Utc>,
}

/// List all skill files for a given owner, ordered by file_path.
pub async fn list_skills(pool: &sqlx::PgPool, owner: &str) -> Result<Vec<SkillFile>, AppError> {
    let files = sqlx::query_as::<_, SkillFile>(
        "SELECT owner, file_path, content, checksum, updated_at
         FROM skill_files WHERE owner = $1 ORDER BY file_path",
    )
    .bind(owner)
    .fetch_all(pool)
    .await?;
    Ok(files)
}

/// Get a single skill file by owner + file_path.
pub async fn get_skill(
    pool: &sqlx::PgPool,
    owner: &str,
    file_path: &str,
) -> Result<Option<SkillFile>, AppError> {
    let file = sqlx::query_as::<_, SkillFile>(
        "SELECT owner, file_path, content, checksum, updated_at
         FROM skill_files WHERE owner = $1 AND file_path = $2",
    )
    .bind(owner)
    .bind(file_path)
    .fetch_optional(pool)
    .await?;
    Ok(file)
}

/// Insert or update a skill file (upsert).
pub async fn upsert_skill(
    pool: &sqlx::PgPool,
    owner: &str,
    file_path: &str,
    content: &str,
) -> Result<(), AppError> {
    let checksum = content_checksum(content);
    sqlx::query(
        "INSERT INTO skill_files (owner, file_path, content, checksum)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (owner, file_path)
         DO UPDATE SET content = $3, checksum = $4, updated_at = now()",
    )
    .bind(owner)
    .bind(file_path)
    .bind(content)
    .bind(&checksum)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete a skill file.
pub async fn delete_skill(
    pool: &sqlx::PgPool,
    owner: &str,
    file_path: &str,
) -> Result<bool, AppError> {
    let result = sqlx::query("DELETE FROM skill_files WHERE owner = $1 AND file_path = $2")
        .bind(owner)
        .bind(file_path)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Count skill files by owner.
#[allow(dead_code)]
pub async fn count_skills(pool: &sqlx::PgPool, owner: &str) -> Result<i64, AppError> {
    let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM skill_files WHERE owner = $1")
        .bind(owner)
        .fetch_one(pool)
        .await?;
    Ok(row.0)
}

/// SHA-256 first 16 hex chars — must match gateway's store.ContentChecksum.
fn content_checksum(content: &str) -> String {
    let hash = Sha256::digest(content.as_bytes());
    hex::encode(&hash[..8])
}
