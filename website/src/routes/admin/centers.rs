use std::collections::{BTreeSet, HashMap};

use askama::Template;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Redirect, Response};

use crate::auth::AdminUser;
use crate::error::{render_template, AppError};
use crate::models::{feedback as fb_model, invite, provider, session, skill, user};
use crate::services::gateway::{GatewayClient, LogEntry};
use crate::AppState;

// ─── Shared views ─────────────────────────────────────

#[derive(Clone)]
struct UserView {
    id: String,
    name: String,
    email: String,
    role: String,
    created_at: String,
}

#[derive(Clone)]
#[allow(dead_code)]
struct InviteCodeView {
    code: String,
    role: String,
    max_uses: i32,
    used_count: i32,
    note: String,
    expires_at: String,
    created_at: String,
    is_expired: bool,
    is_exhausted: bool,
}

#[derive(Clone)]
struct FeedbackView {
    id: String,
    name: String,
    email: String,
    category: String,
    message: String,
    app_version: String,
    status: String,
    admin_reply: String,
    created_at: String,
}

#[derive(Clone)]
struct ContainerView {
    id: String,
    name: String,
    user_name: String,
    ip: String,
    status: String,
}

#[allow(dead_code)]
struct BotView {
    container_name: String,
    user_id: String,
    ip: String,
    status: String,
    container_type: String,
    config_synced: bool,
    pairing_status: String,
    last_synced: String,
    primary_model: String,
}

#[derive(Clone)]
struct ContainerOption {
    name: String,
    user_name: String,
}

struct SettingView {
    key: String,
    value: String,
    masked_value: String,
    description: String,
    is_secret: bool,
}

struct DefaultModelView {
    id: String,
    provider: String,
    provider_id: String,
    label: String,
}

#[allow(dead_code)]
struct ProviderView {
    key: String,
    display_name: String,
    api_type: String,
    base_url: String,
    api_key_ref: String,
    enabled: bool,
    sort_order: i32,
}

#[allow(dead_code)]
struct LlmModelView {
    id: String,
    provider_key: String,
    model_id: String,
    display_name: String,
    context_window: i32,
    max_tokens: i32,
    reasoning: bool,
    enabled: bool,
    sort_order: i32,
}

#[allow(dead_code)]
struct SkillView {
    file_path: String,
    group: String,
    name: String,
    checksum: String,
    updated_at: String,
    size: String,
}

#[allow(dead_code)]
struct GroupView {
    name: String,
    selected: bool,
}

// ─── Operations center ────────────────────────────────

#[derive(Template)]
#[template(path = "admin/operations.html")]
struct OperationsTemplate {
    admin_name: String,
    active_page: String,
    users: Vec<UserView>,
    users_total: i64,
    users_page: i64,
    users_has_next: bool,
    user_query: String,
    codes: Vec<InviteCodeView>,
    current_filter: String,
    items: Vec<FeedbackView>,
}

#[derive(serde::Deserialize)]
pub struct OperationsQuery {
    page: Option<i64>,
    q: Option<String>,
    status: Option<String>,
}

pub async fn operations(
    State(state): State<AppState>,
    admin: AdminUser,
    Query(params): Query<OperationsQuery>,
) -> Result<impl IntoResponse, AppError> {
    let page = params.page.unwrap_or(1).max(1);
    let query = params.q.unwrap_or_default().trim().to_string();
    let needle = query.to_lowercase();
    let all_users = user::list_users(&state.db).await?;
    let filtered_users: Vec<user::User> = all_users
        .into_iter()
        .filter(|u| {
            needle.is_empty()
                || u.name.to_lowercase().contains(&needle)
                || u.email.to_lowercase().contains(&needle)
        })
        .collect();
    let users_total = filtered_users.len() as i64;
    let start = ((page - 1) * 12) as usize;
    let users_has_next = (start + 12) < filtered_users.len();
    let users = filtered_users
        .into_iter()
        .skip(start)
        .take(12)
        .map(user_view)
        .collect();

    let codes = load_invite_views(&state).await?;
    let filter = params.status.as_deref();
    let current_filter = filter.unwrap_or("all").to_string();
    let items = fb_model::list_feedback(&state.db, filter)
        .await?
        .into_iter()
        .take(20)
        .map(feedback_view)
        .collect();

    render_template(&OperationsTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "operations".into(),
        users,
        users_total,
        users_page: page,
        users_has_next,
        user_query: query,
        codes,
        current_filter,
        items,
    })
}

pub async fn redirect_operations_users(
    _admin: AdminUser,
    Query(params): Query<HashMap<String, String>>,
) -> Redirect {
    redirect_to_center("/admin/operations", params, "users")
}

pub async fn redirect_operations_invites(_admin: AdminUser) -> Redirect {
    Redirect::to("/admin/operations#invites")
}

pub async fn redirect_operations_feedback(
    _admin: AdminUser,
    Query(params): Query<HashMap<String, String>>,
) -> Redirect {
    redirect_to_center("/admin/operations", params, "feedback")
}

// ─── Runtime center ───────────────────────────────────

#[derive(Template)]
#[template(path = "admin/runtime.html")]
struct RuntimeTemplate {
    admin_name: String,
    active_page: String,
    containers: Vec<ContainerView>,
    bots: Vec<BotView>,
    log_containers: Vec<ContainerOption>,
    logs: Vec<LogEntry>,
    current_service: String,
    current_container: String,
    current_level: String,
    current_search: String,
    current_lines: u32,
    error_message: String,
    save_success: bool,
    save_error: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct RuntimeQuery {
    service: Option<String>,
    container: Option<String>,
    level: Option<String>,
    search: Option<String>,
    lines: Option<u32>,
    success: Option<bool>,
    error: Option<String>,
}

pub async fn runtime(
    State(state): State<AppState>,
    admin: AdminUser,
    Query(query): Query<RuntimeQuery>,
) -> Result<impl IntoResponse, AppError> {
    let db_containers = session::list_containers(&state.db).await.unwrap_or_default();
    let log_containers: Vec<ContainerOption> = db_containers
        .iter()
        .map(|c| ContainerOption {
            name: c.container_name.clone(),
            user_name: c.user_id.clone(),
        })
        .collect();
    let containers = db_containers.into_iter().map(container_view).collect();

    let bots = provider::list_bot_containers(&state.db)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(bot_view)
        .collect();

    let service = query.service.as_deref().unwrap_or("agent");
    let lines = query.lines.unwrap_or(200);
    let client = gateway_client(&state);
    let (logs, error_message) = match client
        .get_logs(
            service,
            query.container.as_deref(),
            query.level.as_deref(),
            query.search.as_deref(),
            Some(lines),
        )
        .await
    {
        Ok(entries) => (entries, String::new()),
        Err(e) => (Vec::new(), format!("{e}")),
    };

    render_template(&RuntimeTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "runtime".into(),
        containers,
        bots,
        log_containers,
        logs,
        current_service: service.to_string(),
        current_container: query.container.unwrap_or_default(),
        current_level: query.level.unwrap_or_default(),
        current_search: query.search.unwrap_or_default(),
        current_lines: lines,
        error_message,
        save_success: query.success.unwrap_or(false),
        save_error: query.error,
    })
}

pub async fn redirect_runtime_containers(_admin: AdminUser) -> Redirect {
    Redirect::to("/admin/runtime#containers")
}

pub async fn redirect_runtime_bots(_admin: AdminUser) -> Redirect {
    Redirect::to("/admin/runtime#bots")
}

pub async fn redirect_runtime_logs(
    _admin: AdminUser,
    Query(params): Query<HashMap<String, String>>,
) -> Redirect {
    redirect_to_center("/admin/runtime", params, "logs")
}

pub async fn sync_runtime_bot(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    match gateway_client(&state).sync_container_config(&name).await {
        Ok(_) => Ok(Redirect::to("/admin/runtime?success=true#bots")),
        Err(e) => Ok(Redirect::to(&format!(
            "/admin/runtime?error={}",
            urlencoding::encode(&format!("同步失败: {e}"))
        ))),
    }
}

pub async fn restart_runtime_bot(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    match gateway_client(&state).restart_container(&name).await {
        Ok(_) => Ok(Redirect::to("/admin/runtime?success=true#bots")),
        Err(e) => Ok(Redirect::to(&format!(
            "/admin/runtime?error={}",
            urlencoding::encode(&format!("重启失败: {e}"))
        ))),
    }
}

// ─── Config center ────────────────────────────────────

#[derive(Template)]
#[template(path = "admin/config_center.html")]
struct ConfigCenterTemplate {
    admin_name: String,
    active_page: String,
    gateway_status: String,
    db_status: String,
    app_version: String,
    default_models: Vec<DefaultModelView>,
    settings: Vec<SettingView>,
    current_model: String,
    current_provider: String,
    providers: Vec<ProviderView>,
    models: Vec<LlmModelView>,
    skills: Vec<SkillView>,
    total_count: i64,
    groups: Vec<GroupView>,
    all_selected: bool,
    save_success: bool,
    save_error: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct ConfigQuery {
    group: Option<String>,
    success: Option<bool>,
    error: Option<String>,
}

pub async fn config(
    State(state): State<AppState>,
    admin: AdminUser,
    Query(query): Query<ConfigQuery>,
) -> Result<impl IntoResponse, AppError> {
    render_config_center(&state, &admin, query.group, query.success.unwrap_or(false), query.error)
        .await
}

pub async fn redirect_config_settings(_admin: AdminUser) -> Redirect {
    Redirect::to("/admin/config#settings")
}

pub async fn redirect_config_providers(_admin: AdminUser) -> Redirect {
    Redirect::to("/admin/config#providers")
}

pub async fn redirect_config_skills(
    _admin: AdminUser,
    Query(params): Query<HashMap<String, String>>,
) -> Redirect {
    redirect_to_center("/admin/config", params, "skills")
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

pub async fn update_config_settings(
    State(state): State<AppState>,
    _admin: AdminUser,
    axum::Form(form): axum::Form<UpdateSettingsForm>,
) -> Result<Response, AppError> {
    let mut settings = HashMap::new();
    for (key, value) in [
        ("llm_proxy_url", form.llm_proxy_url),
        ("feishu_client_id", form.feishu_client_id),
        ("embedding_base_url", form.embedding_base_url),
        ("jimeng_api_url", form.jimeng_api_url),
        ("asset_gateway_url", form.asset_gateway_url),
        ("ai_search_gateway_url", form.ai_search_gateway_url),
        ("github_repo", form.github_repo),
        ("posthog_endpoint", form.posthog_endpoint),
        ("primary_model", form.primary_model),
        ("primary_provider", form.primary_provider),
    ] {
        if let Some(v) = value {
            let v = v.trim().to_string();
            if !v.is_empty() || key == "primary_model" || key == "primary_provider" {
                settings.insert(key.to_string(), v);
            }
        }
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
        return Ok(Redirect::to("/admin/config?error=没有需要更新的配置").into_response());
    }

    match gateway_client(&state).update_settings(settings).await {
        Ok(_) => Ok(Redirect::to("/admin/config?success=true#settings").into_response()),
        Err(e) => Ok(Redirect::to(&format!(
            "/admin/config?error={}",
            urlencoding::encode(&format!("保存失败: {e}"))
        ))
        .into_response()),
    }
}

#[derive(serde::Deserialize)]
pub struct ProviderForm {
    key: String,
    display_name: String,
    api_type: String,
    base_url: String,
    api_key_ref: String,
    enabled: Option<String>,
}

pub async fn upsert_config_provider(
    State(state): State<AppState>,
    _admin: AdminUser,
    axum::Form(form): axum::Form<ProviderForm>,
) -> Result<Response, AppError> {
    let key = form.key.trim();
    if key.is_empty() {
        return Ok(Redirect::to("/admin/config?error=Provider key 不能为空#providers").into_response());
    }
    provider::upsert_provider(
        &state.db,
        key,
        form.display_name.trim(),
        form.api_type.trim(),
        form.base_url.trim(),
        form.api_key_ref.trim(),
        form.enabled.is_some(),
    )
    .await?;
    Ok(Redirect::to("/admin/config?success=true#providers").into_response())
}

pub async fn delete_config_provider(
    State(state): State<AppState>,
    _admin: AdminUser,
    headers: HeaderMap,
    Path(key): Path<String>,
) -> Result<Response, AppError> {
    provider::delete_provider(&state.db, &key).await?;
    if is_htmx_request(&headers) {
        Ok(axum::response::Html("").into_response())
    } else {
        Ok(Redirect::to("/admin/config?success=true#providers").into_response())
    }
}

#[derive(serde::Deserialize)]
pub struct ModelForm {
    provider_key: String,
    model_id: String,
    display_name: String,
    context_window: i32,
    max_tokens: i32,
    reasoning: Option<String>,
    enabled: Option<String>,
}

pub async fn upsert_config_model(
    State(state): State<AppState>,
    _admin: AdminUser,
    axum::Form(form): axum::Form<ModelForm>,
) -> Result<Response, AppError> {
    let provider_key = form.provider_key.trim();
    let model_id = form.model_id.trim();
    if provider_key.is_empty() || model_id.is_empty() {
        return Ok(Redirect::to("/admin/config?error=Provider key 和 Model ID 不能为空#models").into_response());
    }
    provider::upsert_model(
        &state.db,
        provider_key,
        model_id,
        form.display_name.trim(),
        form.context_window,
        form.max_tokens,
        form.reasoning.is_some(),
        form.enabled.is_some(),
    )
    .await?;
    Ok(Redirect::to("/admin/config?success=true#models").into_response())
}

pub async fn delete_config_model(
    State(state): State<AppState>,
    _admin: AdminUser,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    provider::delete_model(&state.db, &id).await?;
    if is_htmx_request(&headers) {
        Ok(axum::response::Html("").into_response())
    } else {
        Ok(Redirect::to("/admin/config?success=true#models").into_response())
    }
}

#[derive(serde::Deserialize)]
pub struct DeleteSkillQuery {
    path: String,
}

pub async fn delete_config_skill(
    State(state): State<AppState>,
    _admin: AdminUser,
    headers: HeaderMap,
    Query(query): Query<DeleteSkillQuery>,
) -> Result<Response, AppError> {
    skill::delete_skill(&state.db, "system", &query.path).await?;
    if is_htmx_request(&headers) {
        Ok(axum::response::Html("").into_response())
    } else {
        Ok(Redirect::to("/admin/config?success=true#skills").into_response())
    }
}

async fn render_config_center(
    state: &AppState,
    admin: &AdminUser,
    filter_group: Option<String>,
    save_success: bool,
    save_error: Option<String>,
) -> Result<impl IntoResponse, AppError> {
    let client = gateway_client(state);
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
    let settings = raw_settings
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

    let providers = provider::list_providers(&state.db)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(provider_view)
        .collect();
    let models = provider::list_models(&state.db)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(llm_model_view)
        .collect();

    let all_files = skill::list_skills(&state.db, "system").await.unwrap_or_default();
    let total_count = all_files.len() as i64;
    let group_names: Vec<String> = all_files
        .iter()
        .filter_map(|f| f.file_path.split('/').next().map(str::to_string))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let filter_group = filter_group.unwrap_or_default();
    let all_selected = filter_group.is_empty();
    let groups = group_names
        .into_iter()
        .map(|name| GroupView {
            selected: name == filter_group,
            name,
        })
        .collect();
    let skills = all_files
        .into_iter()
        .filter(|f| filter_group.is_empty() || f.file_path.starts_with(&format!("{filter_group}/")))
        .take(80)
        .map(skill_view)
        .collect();

    render_template(&ConfigCenterTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "config".into(),
        gateway_status,
        db_status,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        default_models: default_models(),
        settings,
        current_model,
        current_provider,
        providers,
        models,
        skills,
        total_count,
        groups,
        all_selected,
        save_success,
        save_error: save_error.or(gateway_fetch_error),
    })
}

// ─── Mapping helpers ──────────────────────────────────

fn user_view(u: user::User) -> UserView {
    UserView {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        created_at: u.created_at.format("%Y-%m-%d %H:%M").to_string(),
    }
}

async fn load_invite_views(state: &AppState) -> Result<Vec<InviteCodeView>, AppError> {
    let now = chrono::Utc::now();
    Ok(invite::list_invite_codes(&state.db)
        .await?
        .into_iter()
        .map(|c| {
            let is_expired = c.expires_at.map(|e| e < now).unwrap_or(false);
            InviteCodeView {
                code: c.code,
                role: c.role,
                max_uses: c.max_uses,
                used_count: c.used_count,
                note: c.note,
                expires_at: c
                    .expires_at
                    .map(|e| e.format("%Y-%m-%d %H:%M").to_string())
                    .unwrap_or_default(),
                created_at: c.created_at.format("%Y-%m-%d %H:%M").to_string(),
                is_expired,
                is_exhausted: c.used_count >= c.max_uses,
            }
        })
        .collect())
}

fn feedback_view(f: fb_model::Feedback) -> FeedbackView {
    FeedbackView {
        id: f.id,
        name: f.name.unwrap_or_default(),
        email: f.email.unwrap_or_default(),
        category: f.category,
        message: f.message,
        app_version: f.app_version.unwrap_or_default(),
        status: f.status,
        admin_reply: f.admin_reply.unwrap_or_default(),
        created_at: f.created_at.format("%Y-%m-%d %H:%M").to_string(),
    }
}

fn container_view(c: session::ContainerInfo) -> ContainerView {
    ContainerView {
        id: c.container_name.clone(),
        name: c.container_name,
        user_name: c.user_id,
        ip: c.container_ip.unwrap_or_default(),
        status: c.status,
    }
}

fn bot_view(b: provider::BotContainerInfo) -> BotView {
    let config_synced = match (&b.desired_config_hash, &b.applied_config_hash) {
        (Some(desired), Some(applied)) => desired == applied,
        _ => false,
    };
    let primary_model = b
        .config
        .as_ref()
        .and_then(|c| c.get("primary_model"))
        .and_then(|v| v.as_str())
        .unwrap_or("-")
        .to_string();
    let last_synced = b
        .last_synced_at
        .map(|ts| ts.format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_else(|| "从未同步".into());

    BotView {
        container_name: b.container_name,
        user_id: b.user_id,
        ip: b.container_ip.unwrap_or_default(),
        status: b.status,
        container_type: b.container_type,
        config_synced,
        pairing_status: b.pairing_status.unwrap_or_else(|| "unknown".into()),
        last_synced,
        primary_model,
    }
}

fn provider_view(p: provider::LLMProvider) -> ProviderView {
    ProviderView {
        key: p.key,
        display_name: p.display_name,
        api_type: p.api_type,
        base_url: p.base_url,
        api_key_ref: p.api_key_ref,
        enabled: p.enabled,
        sort_order: p.sort_order,
    }
}

fn llm_model_view(m: provider::LLMModel) -> LlmModelView {
    LlmModelView {
        id: m.id,
        provider_key: m.provider_key,
        model_id: m.model_id,
        display_name: m.display_name,
        context_window: m.context_window,
        max_tokens: m.max_tokens,
        reasoning: m.reasoning,
        enabled: m.enabled,
        sort_order: m.sort_order,
    }
}

fn skill_view(f: skill::SkillFile) -> SkillView {
    let parts: Vec<&str> = f.file_path.split('/').collect();
    let group = if parts.len() > 1 {
        parts[0].to_string()
    } else {
        "未分类".to_string()
    };
    let name = if parts.len() > 1 {
        parts[1..].join("/")
    } else {
        f.file_path.clone()
    };
    SkillView {
        file_path: f.file_path,
        group,
        name,
        checksum: f.checksum[..8.min(f.checksum.len())].to_string(),
        updated_at: f.updated_at.format("%Y-%m-%d %H:%M").to_string(),
        size: format_size(f.content.len()),
    }
}

fn gateway_client(state: &AppState) -> GatewayClient {
    GatewayClient::new(
        state.http_client.clone(),
        state.config.gateway.url.clone(),
        state.config.gateway.admin_token.clone(),
    )
}

fn is_htmx_request(headers: &HeaderMap) -> bool {
    headers
        .get("HX-Request")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn redirect_to_center(
    path: &str,
    params: HashMap<String, String>,
    fragment: &str,
) -> Redirect {
    let query = encode_query(params);
    let location = if query.is_empty() {
        format!("{path}#{fragment}")
    } else {
        format!("{path}?{query}#{fragment}")
    };
    Redirect::to(&location)
}

fn encode_query(params: HashMap<String, String>) -> String {
    let mut pairs: Vec<(String, String)> = params.into_iter().collect();
    pairs.sort_by(|a, b| a.0.cmp(&b.0));
    pairs
        .into_iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                urlencoding::encode(&key),
                urlencoding::encode(&value)
            )
        })
        .collect::<Vec<_>>()
        .join("&")
}

fn mask_value(value: &str) -> String {
    if value.is_empty() {
        return "未配置".to_string();
    }
    if value.len() <= 8 {
        return "*".repeat(value.len());
    }
    format!("{}{}", &value[..4], "*".repeat(value.len() - 4))
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

fn default_models() -> Vec<DefaultModelView> {
    vec![
        DefaultModelView {
            id: "claude-sonnet-4-6".into(),
            provider: "Claude".into(),
            provider_id: "proxy-claude".into(),
            label: "Sonnet 4.6".into(),
        },
        DefaultModelView {
            id: "claude-opus-4-7".into(),
            provider: "Claude".into(),
            provider_id: "proxy-claude".into(),
            label: "Opus 4.7".into(),
        },
        DefaultModelView {
            id: "gpt-5.3-codex".into(),
            provider: "GPT".into(),
            provider_id: "proxy-gpt".into(),
            label: "GPT-5.3 Codex".into(),
        },
        DefaultModelView {
            id: "gpt-5.4".into(),
            provider: "GPT".into(),
            provider_id: "proxy-gpt".into(),
            label: "GPT-5.4".into(),
        },
        DefaultModelView {
            id: "gemini-3.1-pro-preview".into(),
            provider: "Gemini".into(),
            provider_id: "proxy-gemini".into(),
            label: "Gemini 3.1 Pro".into(),
        },
        DefaultModelView {
            id: "grok-4.1-fast".into(),
            provider: "Grok".into(),
            provider_id: "proxy-grok".into(),
            label: "Grok 4.1 Fast".into(),
        },
    ]
}

fn format_size(bytes: usize) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    }
}
