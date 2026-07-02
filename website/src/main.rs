use askama::Template;
use axum::middleware;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::Router;
use tower_cookies::CookieManagerLayer;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

mod auth;
mod config;
mod db;
mod error;
mod models;
mod routes;
mod services;

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub config: config::Config,
    pub http_client: reqwest::Client,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Logging
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    // Config
    let config_path =
        std::env::var("WEBSITE_CONFIG_PATH").unwrap_or_else(|_| "website.toml".to_string());
    let config = config::Config::load(&config_path)?;
    tracing::info!("Loaded config from {config_path}");

    // Database
    let db = db::create_pool(&config.database.url).await?;
    tracing::info!("Connected to database");

    // Sync changelog → releases table
    if let Err(e) = services::changelog::sync_to_db(&db).await {
        tracing::warn!("Failed to sync changelog to releases: {e}");
    }

    // State
    let state = AppState {
        db,
        config: config.clone(),
        http_client: reqwest::Client::new(),
    };

    // Routes
    let app = Router::new()
        // Public pages
        .route("/", get(routes::pages::index))
        .route("/download", get(routes::pages::download))
        .route("/about", get(routes::pages::about))
        .route("/docs", get(routes::docs::index))
        .route("/docs/{*path}", get(routes::docs::page))
        .route("/games", get(routes::games::gallery))
        .route("/games/{id}", get(routes::games::play))
        .route("/chat", get(routes::chat::page))
        .route(
            "/feedback",
            get(routes::feedback::form_page).post(routes::feedback::submit),
        )
        // Update API (Tauri updater)
        .route(
            "/api/update/{target}/{arch}/{current_version}",
            get(routes::update::check),
        )
        // User auth (any role — for /chat etc.)
        .route("/login", get(user_login_page).post(user_login_action))
        .route("/logout", post(user_logout_action))
        .route("/feishu/callback", get(user_feishu_callback))
        // Admin auth (no AdminUser extractor — these are the login/logout endpoints)
        .route(
            "/admin/login",
            get(admin_login_page).post(admin_login_action),
        )
        .route(
            "/admin/logout",
            post(admin_logout_action).route_layer(middleware::from_fn(auth::admin_csrf_guard)),
        )
        .route("/admin/feishu/callback", get(admin_feishu_callback))
        // Admin sub-router (all routes require AdminUser)
        .nest(
            "/admin",
            routes::admin::admin_routes().route_layer(middleware::from_fn(auth::admin_csrf_guard)),
        )
        // Static files
        .nest_service("/static", ServeDir::new("static"))
        // Layers
        .layer(CookieManagerLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Bind
    let addr = format!("{}:{}", config.server.host, config.server.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Listening on {addr}");

    // Graceful shutdown
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

// --- Admin login/logout handlers (outside the admin sub-router) ---

#[derive(Template)]
#[template(path = "admin/login.html")]
#[allow(dead_code)]
struct AdminLoginTemplate {
    error: Option<String>,
    feishu_url: Option<String>,
}

async fn admin_login_page(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Result<impl axum::response::IntoResponse, error::AppError> {
    error::render_template(&AdminLoginTemplate {
        error: None,
        feishu_url: build_feishu_url(&state.config),
    })
}

async fn admin_login_action(
    axum::extract::State(state): axum::extract::State<AppState>,
    cookies: tower_cookies::Cookies,
    headers: axum::http::HeaderMap,
    axum::extract::Form(form): axum::extract::Form<LoginForm>,
) -> Result<axum::response::Response, error::AppError> {
    let user = match auth::admin_login(&state.db, &form.email, &form.password).await {
        Ok(user) => user,
        Err(error::AppError::Unauthorized) => {
            let html = error::render_template(&AdminLoginTemplate {
                error: Some("邮箱或密码错误".to_string()),
                feishu_url: build_feishu_url(&state.config),
            })?;
            return Ok(html.into_response());
        }
        Err(e) => return Err(e),
    };

    let token = auth::generate_token();
    let expires = chrono::Utc::now() + chrono::Duration::days(30);
    models::auth_session::create_auth_session(&state.db, &user.id, &token, expires, None, None)
        .await?;

    auth::set_session_cookie(
        &cookies,
        &token,
        should_set_secure_cookie(&state.config, &headers),
    );
    Ok(axum::response::Redirect::to("/admin").into_response())
}

async fn admin_logout_action(cookies: tower_cookies::Cookies) -> impl axum::response::IntoResponse {
    if let Some(cookie) = cookies.get("admin_session") {
        let _ = cookie.value();
    }
    auth::remove_session_cookie(&cookies);
    axum::response::Redirect::to("/admin/login")
}

#[derive(serde::Deserialize)]
struct LoginForm {
    email: String,
    password: String,
    #[serde(default)]
    redirect: String,
}

/// Build the Feishu SSO URL that redirects to the Gateway's OAuth endpoint.
fn build_feishu_url(config: &config::Config) -> Option<String> {
    let gw_public = config
        .gateway
        .public_url
        .as_deref()
        .unwrap_or(&config.gateway.url);
    let callback = format!("{}/admin/feishu/callback", config.site.base_url);
    let encoded = urlencoding::encode(&callback);
    Some(format!("{gw_public}/api/auth/feishu?redirect={encoded}"))
}

/// Handle the Feishu OAuth callback from Gateway.
/// The Gateway creates an auth_session in the shared DB and redirects here with ?token=xxx.
#[derive(serde::Deserialize)]
struct FeishuCallbackParams {
    token: Option<String>,
    error: Option<String>,
    #[serde(default)]
    redirect: Option<String>,
}

async fn admin_feishu_callback(
    axum::extract::State(state): axum::extract::State<AppState>,
    cookies: tower_cookies::Cookies,
    headers: axum::http::HeaderMap,
    axum::extract::Query(params): axum::extract::Query<FeishuCallbackParams>,
) -> Result<axum::response::Response, error::AppError> {
    if let Some(err) = &params.error {
        tracing::warn!("Feishu SSO error: {err}");
        let html = error::render_template(&AdminLoginTemplate {
            error: Some(format!("飞书登录失败: {err}")),
            feishu_url: build_feishu_url(&state.config),
        })?;
        return Ok(html.into_response());
    }

    let token = params.token.as_deref().unwrap_or("");
    if token.is_empty() {
        let html = error::render_template(&AdminLoginTemplate {
            error: Some("飞书登录失败: 未收到令牌".to_string()),
            feishu_url: build_feishu_url(&state.config),
        })?;
        return Ok(html.into_response());
    }

    // Look up the auth_session created by Gateway in the shared DB
    let session = models::auth_session::get_session_by_token(&state.db, token).await?;
    let (user_id, role) = match session {
        Some(s) => s,
        None => {
            let html = error::render_template(&AdminLoginTemplate {
                error: Some("飞书登录失败: 会话无效".to_string()),
                feishu_url: build_feishu_url(&state.config),
            })?;
            return Ok(html.into_response());
        }
    };

    if role != "admin" {
        let html = error::render_template(&AdminLoginTemplate {
            error: Some("该飞书账号没有管理员权限".to_string()),
            feishu_url: build_feishu_url(&state.config),
        })?;
        return Ok(html.into_response());
    }

    tracing::info!(user_id, "admin logged in via Feishu SSO");
    auth::set_session_cookie(
        &cookies,
        token,
        should_set_secure_cookie(&state.config, &headers),
    );
    Ok(axum::response::Redirect::to("/admin").into_response())
}

// --- User login/logout handlers (for /chat and other user-facing pages) ---

#[derive(Template)]
#[template(path = "login.html")]
#[allow(dead_code)]
struct UserLoginTemplate {
    error: Option<String>,
    feishu_url: Option<String>,
    redirect: String,
}

#[derive(serde::Deserialize)]
struct UserLoginQuery {
    #[serde(default)]
    redirect: String,
}

async fn user_login_page(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::extract::Query(query): axum::extract::Query<UserLoginQuery>,
) -> Result<impl axum::response::IntoResponse, error::AppError> {
    let redirect = sanitize_redirect(&query.redirect);
    error::render_template(&UserLoginTemplate {
        error: None,
        feishu_url: build_feishu_url_with_redirect(&state.config, &redirect),
        redirect,
    })
}

async fn user_login_action(
    axum::extract::State(state): axum::extract::State<AppState>,
    cookies: tower_cookies::Cookies,
    headers: axum::http::HeaderMap,
    axum::extract::Form(form): axum::extract::Form<LoginForm>,
) -> Result<axum::response::Response, error::AppError> {
    let redirect = sanitize_redirect(&form.redirect);

    let user = match auth::user_login(&state.db, &form.email, &form.password).await {
        Ok(user) => user,
        Err(error::AppError::Unauthorized) => {
            let html = error::render_template(&UserLoginTemplate {
                error: Some("邮箱或密码错误".to_string()),
                feishu_url: build_feishu_url_with_redirect(&state.config, &redirect),
                redirect,
            })?;
            return Ok(html.into_response());
        }
        Err(e) => return Err(e),
    };

    let token = auth::generate_token();
    let expires = chrono::Utc::now() + chrono::Duration::days(30);
    models::auth_session::create_auth_session(&state.db, &user.id, &token, expires, None, None)
        .await?;

    auth::set_session_cookie(
        &cookies,
        &token,
        should_set_secure_cookie(&state.config, &headers),
    );

    let target = if redirect.is_empty() {
        "/chat"
    } else {
        &redirect
    };
    Ok(axum::response::Redirect::to(target).into_response())
}

async fn user_logout_action(cookies: tower_cookies::Cookies) -> impl axum::response::IntoResponse {
    auth::remove_session_cookie(&cookies);
    axum::response::Redirect::to("/login")
}

async fn user_feishu_callback(
    axum::extract::State(state): axum::extract::State<AppState>,
    cookies: tower_cookies::Cookies,
    headers: axum::http::HeaderMap,
    axum::extract::Query(params): axum::extract::Query<FeishuCallbackParams>,
) -> Result<axum::response::Response, error::AppError> {
    let redirect = sanitize_redirect(params.redirect.as_deref().unwrap_or(""));

    if let Some(err) = &params.error {
        tracing::warn!("Feishu SSO error: {err}");
        let html = error::render_template(&UserLoginTemplate {
            error: Some(format!("飞书登录失败: {err}")),
            feishu_url: build_feishu_url_with_redirect(&state.config, &redirect),
            redirect,
        })?;
        return Ok(html.into_response());
    }

    let token = params.token.as_deref().unwrap_or("");
    if token.is_empty() {
        let html = error::render_template(&UserLoginTemplate {
            error: Some("飞书登录失败: 未收到令牌".to_string()),
            feishu_url: build_feishu_url_with_redirect(&state.config, &redirect),
            redirect,
        })?;
        return Ok(html.into_response());
    }

    let session = models::auth_session::get_session_by_token(&state.db, token).await?;
    let (user_id, _role) = match session {
        Some(s) => s,
        None => {
            let html = error::render_template(&UserLoginTemplate {
                error: Some("飞书登录失败: 会话无效".to_string()),
                feishu_url: build_feishu_url_with_redirect(&state.config, &redirect),
                redirect,
            })?;
            return Ok(html.into_response());
        }
    };

    // No role check — any user can use /chat
    tracing::info!(user_id, "user logged in via Feishu SSO");
    auth::set_session_cookie(
        &cookies,
        token,
        should_set_secure_cookie(&state.config, &headers),
    );
    let target = if redirect.is_empty() {
        "/chat"
    } else {
        &redirect
    };
    Ok(axum::response::Redirect::to(target).into_response())
}

/// Build Feishu SSO URL for user login (with redirect parameter).
fn build_feishu_url_with_redirect(config: &config::Config, redirect: &str) -> Option<String> {
    let gw_public = config
        .gateway
        .public_url
        .as_deref()
        .unwrap_or(&config.gateway.url);
    let mut callback = format!("{}/feishu/callback", config.site.base_url);
    if !redirect.is_empty() {
        callback = format!("{callback}?redirect={}", urlencoding::encode(redirect));
    }
    let encoded = urlencoding::encode(&callback);
    Some(format!("{gw_public}/api/auth/feishu?redirect={encoded}"))
}

/// Only allow relative paths to prevent open redirect.
fn sanitize_redirect(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.starts_with('/') && !trimmed.starts_with("//") {
        trimmed.to_string()
    } else {
        String::new()
    }
}

fn should_set_secure_cookie(config: &config::Config, headers: &axum::http::HeaderMap) -> bool {
    if let Some(proto) = headers
        .get("x-forwarded-proto")
        .and_then(|h| h.to_str().ok())
    {
        if proto
            .split(',')
            .any(|item| item.trim().eq_ignore_ascii_case("https"))
        {
            return true;
        }
        if proto
            .split(',')
            .any(|item| item.trim().eq_ignore_ascii_case("http"))
        {
            return false;
        }
    }

    if let Some(host) = headers
        .get(axum::http::header::HOST)
        .and_then(|h| h.to_str().ok())
    {
        let host_only = host.split(':').next().unwrap_or(host).to_ascii_lowercase();
        if host_only == "localhost" || host_only == "127.0.0.1" || host_only == "::1" {
            return false;
        }
    }

    config.site.base_url.starts_with("https://")
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("Shutdown signal received");
}
