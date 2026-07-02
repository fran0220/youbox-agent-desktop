use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

#[derive(Debug)]
pub enum AppError {
    Database(sqlx::Error),
    NotFound(String),
    #[allow(dead_code)]
    BadRequest(String),
    Unauthorized,
    Internal(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Database(e) => write!(f, "Database error: {e}"),
            AppError::NotFound(msg) => write!(f, "Not found: {msg}"),
            AppError::BadRequest(msg) => write!(f, "Bad request: {msg}"),
            AppError::Unauthorized => write!(f, "Unauthorized"),
            AppError::Internal(msg) => write!(f, "Internal error: {msg}"),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::Database(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error"),
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.as_str()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.as_str()),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "Unauthorized"),
            AppError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error"),
        };

        // TODO: check Accept header and return JSON for API requests
        (status, message.to_string()).into_response()
    }
}

/// Render an Askama template into an HTML response.
pub fn render_template(
    tmpl: &impl askama::Template,
) -> Result<axum::response::Html<String>, AppError> {
    let html = tmpl
        .render()
        .map_err(|e| AppError::Internal(format!("template render error: {e}")))?;
    Ok(axum::response::Html(html))
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        tracing::error!("Database error: {e}");
        AppError::Database(e)
    }
}
