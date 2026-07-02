use crate::error::AppError;
use serde::Serialize;

#[derive(Debug, sqlx::FromRow, Serialize, Clone)]
pub struct LLMProvider {
    pub id: String,
    pub key: String,
    pub display_name: String,
    pub api_type: String,
    pub base_url: String,
    pub api_key_ref: String,
    pub enabled: bool,
    pub sort_order: i32,
}

#[derive(Debug, sqlx::FromRow, Serialize, Clone)]
pub struct LLMModel {
    pub id: String,
    pub provider_key: String,
    pub model_id: String,
    pub display_name: String,
    pub context_window: i32,
    pub max_tokens: i32,
    pub reasoning: bool,
    pub enabled: bool,
    pub sort_order: i32,
}

#[derive(Debug, sqlx::FromRow, Serialize, Clone)]
pub struct BotContainerInfo {
    pub user_id: String,
    pub container_name: String,
    pub container_ip: Option<String>,
    pub status: String,
    pub container_type: String,
    pub desired_config_hash: Option<String>,
    pub applied_config_hash: Option<String>,
    pub last_synced_at: Option<chrono::NaiveDateTime>,
    pub pairing_status: Option<String>,
    pub config: Option<serde_json::Value>,
}

pub async fn list_providers(pool: &sqlx::PgPool) -> Result<Vec<LLMProvider>, AppError> {
    let providers = sqlx::query_as::<_, LLMProvider>(
        "SELECT id, key, display_name, api_type, base_url, api_key_ref, enabled, sort_order \
         FROM llm_providers ORDER BY sort_order, key",
    )
    .fetch_all(pool)
    .await?;
    Ok(providers)
}

#[allow(dead_code)]
pub async fn get_provider(pool: &sqlx::PgPool, key: &str) -> Result<Option<LLMProvider>, AppError> {
    let provider = sqlx::query_as::<_, LLMProvider>(
        "SELECT id, key, display_name, api_type, base_url, api_key_ref, enabled, sort_order \
         FROM llm_providers WHERE key = $1",
    )
    .bind(key)
    .fetch_optional(pool)
    .await?;
    Ok(provider)
}

pub async fn upsert_provider(
    pool: &sqlx::PgPool,
    key: &str,
    display_name: &str,
    api_type: &str,
    base_url: &str,
    api_key_ref: &str,
    enabled: bool,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO llm_providers (key, display_name, api_type, base_url, api_key_ref, enabled) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         ON CONFLICT (key) DO UPDATE SET \
           display_name = $2, api_type = $3, base_url = $4, api_key_ref = $5, enabled = $6",
    )
    .bind(key)
    .bind(display_name)
    .bind(api_type)
    .bind(base_url)
    .bind(api_key_ref)
    .bind(enabled)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_provider(pool: &sqlx::PgPool, key: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM llm_providers WHERE key = $1")
        .bind(key)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_models(pool: &sqlx::PgPool) -> Result<Vec<LLMModel>, AppError> {
    let models = sqlx::query_as::<_, LLMModel>(
        "SELECT id, provider_key, model_id, display_name, context_window, max_tokens, \
                reasoning, enabled, sort_order \
         FROM llm_models ORDER BY provider_key, sort_order, model_id",
    )
    .fetch_all(pool)
    .await?;
    Ok(models)
}

pub async fn upsert_model(
    pool: &sqlx::PgPool,
    provider_key: &str,
    model_id: &str,
    display_name: &str,
    context_window: i32,
    max_tokens: i32,
    reasoning: bool,
    enabled: bool,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO llm_models (provider_key, model_id, display_name, context_window, \
                                  max_tokens, reasoning, enabled) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) \
         ON CONFLICT (provider_key, model_id) DO UPDATE SET \
           display_name = $3, context_window = $4, max_tokens = $5, reasoning = $6, enabled = $7",
    )
    .bind(provider_key)
    .bind(model_id)
    .bind(display_name)
    .bind(context_window)
    .bind(max_tokens)
    .bind(reasoning)
    .bind(enabled)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_model(pool: &sqlx::PgPool, id: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM llm_models WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_bot_containers(pool: &sqlx::PgPool) -> Result<Vec<BotContainerInfo>, AppError> {
    let bots = sqlx::query_as::<_, BotContainerInfo>(
        "SELECT user_id, container_name, container_ip::text AS container_ip, status, \
                COALESCE(container_type, 'vm-agent') as container_type, \
                desired_config_hash, applied_config_hash, last_synced_at, \
                pairing_status, config \
         FROM containers \
         WHERE container_type = 'openclaw' \
         ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(bots)
}
