use crate::error::AppError;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SessionStats {
    pub total_sessions: i64,
    pub active_today: i64,
    pub by_type: serde_json::Value,
}

#[derive(Debug, sqlx::FromRow, Serialize)]
pub struct ContainerInfo {
    pub user_id: String,
    pub container_name: String,
    pub container_ip: Option<String>,
    pub status: String,
}

pub async fn get_session_stats(pool: &sqlx::PgPool) -> Result<SessionStats, AppError> {
    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM chat_sessions")
        .fetch_one(pool)
        .await?;

    let active_today: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM chat_sessions WHERE updated_at >= CURRENT_DATE")
            .fetch_one(pool)
            .await?;

    let by_type: Vec<(String, i64)> =
        sqlx::query_as("SELECT type, COUNT(*) FROM chat_sessions GROUP BY type")
            .fetch_all(pool)
            .await?;

    let by_type_map: serde_json::Value = serde_json::to_value(
        by_type
            .into_iter()
            .collect::<std::collections::HashMap<_, _>>(),
    )
    .unwrap_or_default();

    Ok(SessionStats {
        total_sessions: total.0,
        active_today: active_today.0,
        by_type: by_type_map,
    })
}

pub async fn list_containers(pool: &sqlx::PgPool) -> Result<Vec<ContainerInfo>, AppError> {
    let containers = sqlx::query_as::<_, ContainerInfo>(
        "SELECT user_id, container_name, container_ip::text AS container_ip, status FROM containers ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(containers)
}

pub async fn get_container_by_name(
    pool: &sqlx::PgPool,
    container_name: &str,
) -> Result<Option<ContainerInfo>, AppError> {
    let container = sqlx::query_as::<_, ContainerInfo>(
        "SELECT user_id, container_name, container_ip::text AS container_ip, status FROM containers WHERE container_name = $1",
    )
    .bind(container_name)
    .fetch_optional(pool)
    .await?;
    Ok(container)
}
