use crate::error::AppError;
use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, sqlx::FromRow, Serialize)]
pub struct Release {
    pub id: String,
    pub version: String,
    pub notes: Option<String>,
    pub pub_date: DateTime<Utc>,
    pub is_latest: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, sqlx::FromRow, Serialize)]
pub struct ReleaseAsset {
    pub id: String,
    pub release_id: String,
    pub platform: String,
    pub download_url: String,
    pub signature: String,
    pub file_size: i64,
    pub download_count: i32,
}

pub async fn list_releases(pool: &sqlx::PgPool) -> Result<Vec<Release>, AppError> {
    let releases = sqlx::query_as::<_, Release>(
        "SELECT id, version, notes, pub_date, is_latest, created_at FROM releases ORDER BY pub_date DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(releases)
}

pub async fn get_release(pool: &sqlx::PgPool, id: &str) -> Result<Option<Release>, AppError> {
    let release = sqlx::query_as::<_, Release>(
        "SELECT id, version, notes, pub_date, is_latest, created_at FROM releases WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(release)
}

pub async fn get_latest_release(pool: &sqlx::PgPool) -> Result<Option<Release>, AppError> {
    let release = sqlx::query_as::<_, Release>(
        "SELECT id, version, notes, pub_date, is_latest, created_at FROM releases WHERE is_latest = true LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    Ok(release)
}

pub async fn create_release(
    pool: &sqlx::PgPool,
    version: &str,
    notes: Option<&str>,
) -> Result<Release, AppError> {
    let release = sqlx::query_as::<_, Release>(
        "INSERT INTO releases (id, version, notes, pub_date) VALUES (gen_random_uuid()::text, $1, $2, now()) RETURNING id, version, notes, pub_date, is_latest, created_at",
    )
    .bind(version)
    .bind(notes)
    .fetch_one(pool)
    .await?;
    Ok(release)
}

pub async fn update_release(
    pool: &sqlx::PgPool,
    id: &str,
    version: &str,
    notes: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query("UPDATE releases SET version = $1, notes = $2 WHERE id = $3")
        .bind(version)
        .bind(notes)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_latest(pool: &sqlx::PgPool, id: &str) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE releases SET is_latest = false WHERE is_latest = true")
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE releases SET is_latest = true WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn delete_release(pool: &sqlx::PgPool, id: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM releases WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_assets(
    pool: &sqlx::PgPool,
    release_id: &str,
) -> Result<Vec<ReleaseAsset>, AppError> {
    let assets = sqlx::query_as::<_, ReleaseAsset>(
        "SELECT id, release_id, platform, download_url, signature, file_size, download_count FROM release_assets WHERE release_id = $1 ORDER BY platform",
    )
    .bind(release_id)
    .fetch_all(pool)
    .await?;
    Ok(assets)
}

pub async fn create_asset(
    pool: &sqlx::PgPool,
    release_id: &str,
    platform: &str,
    download_url: &str,
    signature: &str,
    file_size: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO release_assets (id, release_id, platform, download_url, signature, file_size) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)",
    )
    .bind(release_id)
    .bind(platform)
    .bind(download_url)
    .bind(signature)
    .bind(file_size)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_asset(pool: &sqlx::PgPool, asset_id: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM release_assets WHERE id = $1")
        .bind(asset_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_asset_for_platform(
    pool: &sqlx::PgPool,
    release_id: &str,
    platform: &str,
) -> Result<Option<ReleaseAsset>, AppError> {
    let asset = sqlx::query_as::<_, ReleaseAsset>(
        "SELECT id, release_id, platform, download_url, signature, file_size, download_count FROM release_assets WHERE release_id = $1 AND platform = $2",
    )
    .bind(release_id)
    .bind(platform)
    .fetch_optional(pool)
    .await?;
    Ok(asset)
}

/// Find updater asset: try "{platform}-updater" first, then exact "{platform}".
pub async fn get_updater_asset(
    pool: &sqlx::PgPool,
    release_id: &str,
    platform: &str,
) -> Result<Option<ReleaseAsset>, AppError> {
    let updater_platform = format!("{platform}-updater");
    let asset = get_asset_for_platform(pool, release_id, &updater_platform).await?;
    if asset.is_some() {
        return Ok(asset);
    }
    get_asset_for_platform(pool, release_id, platform).await
}

pub async fn increment_download_count(pool: &sqlx::PgPool, asset_id: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE release_assets SET download_count = download_count + 1 WHERE id = $1")
        .bind(asset_id)
        .execute(pool)
        .await?;
    Ok(())
}
