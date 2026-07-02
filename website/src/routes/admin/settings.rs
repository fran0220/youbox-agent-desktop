#![allow(dead_code)]
// Legacy standalone settings page code is retained while GET /admin/settings redirects into the consolidated config center.

use std::collections::HashMap;

use askama::Template;
use axum::extract::State;
use axum::response::IntoResponse;

use crate::auth::AdminUser;
use crate::error::{render_template, AppError};
use crate::services::gateway::GatewayClient;
use crate::AppState;

struct SettingView {
    key: String,
    value: String,
    masked_value: String,
    description: String,
    is_secret: bool,
}

struct ModelView {
    id: String,
    provider: String,
    provider_id: String,
    label: String,
}

#[derive(Template)]
#[template(path = "admin/settings.html")]
struct SettingsTemplate {
    admin_name: String,
    active_page: String,
    gateway_status: String,
    db_status: String,
    app_version: String,
    models: Vec<ModelView>,
    settings: Vec<SettingView>,
    current_model: String,
    current_provider: String,
    save_success: bool,
    save_error: Option<String>,
}

fn mask_value(value: &str) -> String {
    if value.is_empty() {
        return "未配置".to_string();
    }
    if value.len() <= 8 {
        return "*".repeat(value.len());
    }
    let visible = &value[..4];
    format!("{}{}", visible, "*".repeat(value.len() - 4))
}

fn is_secret_key(key: &str) -> bool {
    matches!(
        key,
        "llm_proxy_key"
            | "openai_api_key"
            | "exa_api_key"
            | "tavily_api_key"
            | "embedding_api_key"
            | "fal_api_key"
            | "mineru_token"
            | "jimeng_api_key"
            | "asset_gateway_token"
            | "ai_search_token"
            | "feishu_client_secret"
            | "admin_token"
            | "github_token"
            | "posthog_api_key"
    )
}

pub async fn index(
    State(state): State<AppState>,
    admin: AdminUser,
) -> Result<impl IntoResponse, AppError> {
    render_settings_page(&state, &admin, false, None).await
}

#[derive(serde::Deserialize)]
pub struct UpdateSettingsForm {
    llm_proxy_url: Option<String>,
    llm_proxy_key: Option<String>,
    openai_api_key: Option<String>,
    exa_api_key: Option<String>,
    tavily_api_key: Option<String>,
    embedding_base_url: Option<String>,
    embedding_api_key: Option<String>,
    fal_api_key: Option<String>,
    mineru_token: Option<String>,
    jimeng_api_url: Option<String>,
    jimeng_api_key: Option<String>,
    asset_gateway_token: Option<String>,
    asset_gateway_url: Option<String>,
    ai_search_gateway_url: Option<String>,
    ai_search_token: Option<String>,
    feishu_client_id: Option<String>,
    feishu_client_secret: Option<String>,
    admin_token: Option<String>,
    github_token: Option<String>,
    github_repo: Option<String>,
    posthog_api_key: Option<String>,
    posthog_endpoint: Option<String>,
    primary_model: Option<String>,
    primary_provider: Option<String>,
}

pub async fn update(
    State(state): State<AppState>,
    admin: AdminUser,
    axum::Form(form): axum::Form<UpdateSettingsForm>,
) -> Result<impl IntoResponse, AppError> {
    let client = GatewayClient::new(
        state.http_client.clone(),
        state.config.gateway.url.clone(),
        state.config.gateway.admin_token.clone(),
    );

    let mut settings = HashMap::new();

    // Only include non-empty values (empty means "don't change")
    // For secret fields, a value of all asterisks means "don't change"
    if let Some(v) = form.llm_proxy_url {
        let v = v.trim().to_string();
        if !v.is_empty() {
            settings.insert("llm_proxy_url".to_string(), v);
        }
    }
    if let Some(v) = form.feishu_client_id {
        let v = v.trim().to_string();
        if !v.is_empty() {
            settings.insert("feishu_client_id".to_string(), v);
        }
    }
    if let Some(v) = form.embedding_base_url {
        let v = v.trim().to_string();
        if !v.is_empty() {
            settings.insert("embedding_base_url".to_string(), v);
        }
    }
    if let Some(v) = form.jimeng_api_url {
        let v = v.trim().to_string();
        if !v.is_empty() {
            settings.insert("jimeng_api_url".to_string(), v);
        }
    }
    if let Some(v) = form.asset_gateway_url {
        let v = v.trim().to_string();
        if !v.is_empty() {
            settings.insert("asset_gateway_url".to_string(), v);
        }
    }
    if let Some(v) = form.ai_search_gateway_url {
        let v = v.trim().to_string();
        if !v.is_empty() {
            settings.insert("ai_search_gateway_url".to_string(), v);
        }
    }
    if let Some(v) = form.github_repo {
        let v = v.trim().to_string();
        if !v.is_empty() {
            settings.insert("github_repo".to_string(), v);
        }
    }
    if let Some(v) = form.posthog_endpoint {
        let v = v.trim().to_string();
        if !v.is_empty() {
            settings.insert("posthog_endpoint".to_string(), v);
        }
    }
    if let Some(v) = form.primary_model {
        let v = v.trim().to_string();
        settings.insert("primary_model".to_string(), v);
    }
    if let Some(v) = form.primary_provider {
        let v = v.trim().to_string();
        settings.insert("primary_provider".to_string(), v);
    }
    for (key, value) in [
        ("llm_proxy_key", form.llm_proxy_key),
        ("openai_api_key", form.openai_api_key),
        ("exa_api_key", form.exa_api_key),
        ("tavily_api_key", form.tavily_api_key),
        ("embedding_api_key", form.embedding_api_key),
        ("fal_api_key", form.fal_api_key),
        ("mineru_token", form.mineru_token),
        ("jimeng_api_key", form.jimeng_api_key),
        ("asset_gateway_token", form.asset_gateway_token),
        ("ai_search_token", form.ai_search_token),
        ("feishu_client_secret", form.feishu_client_secret),
        ("admin_token", form.admin_token),
        ("github_token", form.github_token),
        ("posthog_api_key", form.posthog_api_key),
    ] {
        if let Some(v) = value {
            let v = v.trim().to_string();
            if !v.is_empty() && !v.chars().all(|c| c == '*') {
                settings.insert(key.to_string(), v);
            }
        }
    }

    if settings.is_empty() {
        return render_settings_page(&state, &admin, false, Some("没有需要更新的配置".into()))
            .await;
    }

    match client.update_settings(settings).await {
        Ok(_) => render_settings_page(&state, &admin, true, None).await,
        Err(e) => render_settings_page(&state, &admin, false, Some(format!("保存失败: {e}"))).await,
    }
}

async fn render_settings_page(
    state: &AppState,
    admin: &AdminUser,
    save_success: bool,
    save_error: Option<String>,
) -> Result<impl IntoResponse, AppError> {
    let client = GatewayClient::new(
        state.http_client.clone(),
        state.config.gateway.url.clone(),
        state.config.gateway.admin_token.clone(),
    );

    let gateway_status = match client.health().await {
        Ok(true) => "healthy".to_string(),
        _ => "unhealthy".to_string(),
    };

    let db_status = match sqlx::query("SELECT 1").execute(&state.db).await {
        Ok(_) => "连接正常".to_string(),
        Err(_) => "连接异常".to_string(),
    };

    let (raw_settings, gateway_fetch_error) = match client.get_settings().await {
        Ok(settings) => (settings, None),
        Err(err) => (Vec::new(), Some(format!("网关设置读取失败: {err}"))),
    };

    let mut current_model = String::new();
    let mut current_provider = String::new();

    let settings: Vec<SettingView> = raw_settings
        .into_iter()
        .filter_map(|s| match s.key.as_str() {
            "primary_model" => {
                current_model = s.value;
                None
            }
            "primary_provider" => {
                current_provider = s.value;
                None
            }
            _ => {
                let is_secret = is_secret_key(&s.key);
                Some(SettingView {
                    masked_value: if is_secret {
                        mask_value(&s.value)
                    } else {
                        s.value.clone()
                    },
                    key: s.key,
                    value: if is_secret { String::new() } else { s.value },
                    description: s.description,
                    is_secret,
                })
            }
        })
        .collect();

    let models = vec![
        ModelView {
            id: "claude-sonnet-4-6".into(),
            provider: "Claude".into(),
            provider_id: "proxy-claude".into(),
            label: "Sonnet 4.6".into(),
        },
        ModelView {
            id: "claude-opus-4-7".into(),
            provider: "Claude".into(),
            provider_id: "proxy-claude".into(),
            label: "Opus 4.7".into(),
        },
        ModelView {
            id: "claude-haiku-4-5".into(),
            provider: "Claude".into(),
            provider_id: "proxy-claude".into(),
            label: "Haiku 4.5".into(),
        },
        ModelView {
            id: "gpt-5.3-codex".into(),
            provider: "GPT".into(),
            provider_id: "proxy-gpt".into(),
            label: "GPT-5.3 Codex".into(),
        },
        ModelView {
            id: "gpt-5.4".into(),
            provider: "GPT".into(),
            provider_id: "proxy-gpt".into(),
            label: "GPT-5.4".into(),
        },
        ModelView {
            id: "gemini-3.1-pro-preview".into(),
            provider: "Gemini".into(),
            provider_id: "proxy-gemini".into(),
            label: "Gemini 3.1 Pro".into(),
        },
        ModelView {
            id: "gemini-3-flash-preview".into(),
            provider: "Gemini".into(),
            provider_id: "proxy-gemini".into(),
            label: "Gemini 3 Flash".into(),
        },
        ModelView {
            id: "grok-4.1-fast".into(),
            provider: "Grok".into(),
            provider_id: "proxy-grok".into(),
            label: "Grok 4.1 Fast".into(),
        },
    ];

    render_template(&SettingsTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "settings".into(),
        gateway_status,
        db_status,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        models,
        settings,
        current_model,
        current_provider,
        save_success,
        save_error: save_error.or(gateway_fetch_error),
    })
}
