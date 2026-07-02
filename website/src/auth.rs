use axum::body::Body;
use axum::extract::FromRequestParts;
use axum::http::{header, request::Parts, HeaderMap, Method, Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Redirect, Response};
use tower_cookies::Cookies;

use crate::error::AppError;
use crate::models::user::User;
use crate::AppState;

const SESSION_COOKIE: &str = "admin_session";

/// Verify admin credentials and return the user.
/// Supports both bcrypt (Go gateway format: `$2a$...`) and sha256 (legacy).
pub async fn admin_login(db: &sqlx::PgPool, email: &str, password: &str) -> Result<User, AppError> {
    let row = sqlx::query_as::<_, UserWithHash>(
        "SELECT id, name, email, password_hash, role, created_at, updated_at FROM users WHERE email = $1 AND role = 'admin'",
    )
    .bind(email)
    .fetch_optional(db)
    .await?;

    let user = row.ok_or(AppError::Unauthorized)?;
    let stored = user
        .password_hash
        .as_deref()
        .ok_or(AppError::Unauthorized)?;

    let valid = if stored.starts_with("$2a$") || stored.starts_with("$2b$") {
        bcrypt::verify(password, stored).unwrap_or(false)
    } else {
        sha256_hex(password) == stored
    };

    if !valid {
        return Err(AppError::Unauthorized);
    }

    Ok(User {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
        updated_at: user.updated_at,
    })
}

/// Verify user credentials (any role). Same as admin_login but not restricted to admins.
pub async fn user_login(db: &sqlx::PgPool, email: &str, password: &str) -> Result<User, AppError> {
    let row = sqlx::query_as::<_, UserWithHash>(
        "SELECT id, name, email, password_hash, role, created_at, updated_at FROM users WHERE email = $1",
    )
    .bind(email)
    .fetch_optional(db)
    .await?;

    let user = row.ok_or(AppError::Unauthorized)?;
    let stored = user
        .password_hash
        .as_deref()
        .ok_or(AppError::Unauthorized)?;

    let valid = if stored.starts_with("$2a$") || stored.starts_with("$2b$") {
        bcrypt::verify(password, stored).unwrap_or(false)
    } else {
        sha256_hex(password) == stored
    };

    if !valid {
        return Err(AppError::Unauthorized);
    }

    Ok(User {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
        updated_at: user.updated_at,
    })
}

fn sha256_hex(input: &str) -> String {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

/// Generate a random session token.
pub fn generate_token() -> String {
    let mut buf = [0u8; 32];
    use rand::RngCore;
    rand::rngs::OsRng.fill_bytes(&mut buf);
    hex::encode(buf)
}

/// Set the admin session cookie after successful login.
pub fn set_session_cookie(cookies: &Cookies, token: &str, secure: bool) {
    use tower_cookies::Cookie;
    let mut cookie = Cookie::new(SESSION_COOKIE, token.to_string());
    cookie.set_path("/");
    cookie.set_http_only(true);
    cookie.set_secure(secure);
    cookie.set_same_site(tower_cookies::cookie::SameSite::Lax);
    cookies.add(cookie);
}

/// Remove the admin session cookie.
pub fn remove_session_cookie(cookies: &Cookies) {
    use tower_cookies::Cookie;
    let mut cookie = Cookie::new(SESSION_COOKIE, "");
    cookie.set_path("/");
    cookie.set_max_age(tower_cookies::cookie::time::Duration::seconds(0));
    cookies.add(cookie);
}

/// CSRF guard for admin mutating requests.
///
/// Admin auth is cookie-based. For non-idempotent requests, require the browser's
/// Origin or Referer host to match the request host (or X-Forwarded-Host when
/// behind OpenResty). This avoids consuming request bodies, so uploads and HTMX
/// form posts continue to work without per-handler parsing.
pub async fn admin_csrf_guard(request: Request<Body>, next: Next) -> Response {
    if is_safe_method(request.method()) || is_same_origin_admin_request(request.headers()) {
        return next.run(request).await;
    }

    (
        StatusCode::FORBIDDEN,
        "Forbidden: admin CSRF origin check failed",
    )
        .into_response()
}

fn is_safe_method(method: &Method) -> bool {
    matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
}

fn is_same_origin_admin_request(headers: &HeaderMap) -> bool {
    let Some(source_host) = request_source_host(headers) else {
        return false;
    };

    allowed_request_hosts(headers)
        .into_iter()
        .any(|host| hosts_equivalent(&source_host, &host))
}

fn request_source_host(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .and_then(extract_url_host)
        .or_else(|| {
            headers
                .get(header::REFERER)
                .and_then(|value| value.to_str().ok())
                .and_then(extract_url_host)
        })
}

fn allowed_request_hosts(headers: &HeaderMap) -> Vec<String> {
    let mut hosts = Vec::new();
    for name in [header::HOST.as_str(), "x-forwarded-host"] {
        if let Some(value) = headers.get(name).and_then(|value| value.to_str().ok()) {
            for host in value.split(',') {
                if let Some(host) = normalize_host(host) {
                    hosts.push(host);
                }
            }
        }
    }
    hosts
}

fn extract_url_host(url: &str) -> Option<String> {
    let (_, rest) = url.split_once("://")?;
    let authority = rest.split('/').next().unwrap_or_default();
    normalize_host(authority)
}

fn normalize_host(host: &str) -> Option<String> {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || host == "null" {
        None
    } else {
        Some(host)
    }
}

fn hosts_equivalent(left: &str, right: &str) -> bool {
    left == right || strip_default_port(left) == strip_default_port(right)
}

fn strip_default_port(host: &str) -> &str {
    host.strip_suffix(":80")
        .or_else(|| host.strip_suffix(":443"))
        .unwrap_or(host)
}

/// Axum extractor that enforces admin authentication.
/// Extracts the authenticated admin user from the session cookie.
#[derive(Debug, Clone)]
pub struct AdminUser(pub User);

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = Redirect;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let cookies = Cookies::from_request_parts(parts, state)
            .await
            .map_err(|_| Redirect::to("/admin/login"))?;

        let token = cookies
            .get(SESSION_COOKIE)
            .map(|c| c.value().to_string())
            .ok_or_else(|| Redirect::to("/admin/login"))?;

        if token.is_empty() {
            return Err(Redirect::to("/admin/login"));
        }

        let session = crate::models::auth_session::get_session_by_token(&state.db, &token)
            .await
            .map_err(|_| Redirect::to("/admin/login"))?;

        let (user_id, role) = session.ok_or_else(|| Redirect::to("/admin/login"))?;

        if role != "admin" {
            return Err(Redirect::to("/admin/login"));
        }

        let user = crate::models::user::get_user(&state.db, &user_id)
            .await
            .map_err(|_| Redirect::to("/admin/login"))?
            .ok_or_else(|| Redirect::to("/admin/login"))?;

        Ok(AdminUser(user))
    }
}

/// Axum extractor for any authenticated user (not admin-restricted).
/// Redirects to /login if not authenticated.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user: User,
    pub token: String,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = Redirect;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let cookies = Cookies::from_request_parts(parts, state)
            .await
            .map_err(|_| Redirect::to("/login"))?;

        let token = cookies
            .get(SESSION_COOKIE)
            .map(|c| c.value().to_string())
            .ok_or_else(|| Redirect::to("/login"))?;

        if token.is_empty() {
            return Err(Redirect::to("/login"));
        }

        let session = crate::models::auth_session::get_session_by_token(&state.db, &token)
            .await
            .map_err(|_| Redirect::to("/login"))?;

        let (user_id, _role) = session.ok_or_else(|| Redirect::to("/login"))?;

        let user = crate::models::user::get_user(&state.db, &user_id)
            .await
            .map_err(|_| Redirect::to("/login"))?
            .ok_or_else(|| Redirect::to("/login"))?;

        Ok(AuthUser { user, token })
    }
}

#[derive(Debug, sqlx::FromRow)]
struct UserWithHash {
    pub id: String,
    pub name: String,
    pub email: String,
    pub password_hash: Option<String>,
    pub role: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[cfg(test)]
mod tests {
    use axum::http::{header, HeaderMap, HeaderValue};

    use super::{generate_token, is_same_origin_admin_request};

    #[test]
    fn generated_token_is_hex_and_32_bytes() {
        let token = generate_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn generated_tokens_are_not_reused() {
        let a = generate_token();
        let b = generate_token();
        assert_ne!(a, b);
    }

    #[test]
    fn csrf_origin_check_allows_same_host() {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, HeaderValue::from_static("jaco.jingao.club"));
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://jaco.jingao.club"),
        );
        assert!(is_same_origin_admin_request(&headers));
    }

    #[test]
    fn csrf_origin_check_rejects_cross_host() {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, HeaderValue::from_static("jaco.jingao.club"));
        headers.insert(header::ORIGIN, HeaderValue::from_static("https://evil.example"));
        assert!(!is_same_origin_admin_request(&headers));
    }
}
