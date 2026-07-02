use askama::Template;
use axum::extract::{Path, State};
use axum::response::IntoResponse;

use crate::error::{render_template, AppError};
use crate::services::docs as doc_service;
use crate::AppState;

#[derive(Template)]
#[template(path = "docs/layout.html")]
struct DocsPageTemplate {
    title: String,
    content: String,
    nav_items: Vec<doc_service::NavItem>,
    toc: Vec<doc_service::TocItem>,
}

pub async fn index(State(_state): State<AppState>) -> Result<impl IntoResponse, AppError> {
    let (title, source) = doc_service::read_doc("index")
        .map_err(|_| AppError::NotFound("Documentation not found".into()))?;
    let content = doc_service::render_markdown(&source);
    let toc = doc_service::extract_toc(&source);
    let nav_items = doc_service::build_nav_tree("");

    render_template(&DocsPageTemplate {
        title,
        content,
        nav_items,
        toc,
    })
}

pub async fn page(
    State(_state): State<AppState>,
    Path(path): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let (title, source) = doc_service::read_doc(&path)
        .map_err(|_| AppError::NotFound(format!("Document '{}' not found", path)))?;
    let content = doc_service::render_markdown(&source);
    let toc = doc_service::extract_toc(&source);
    let nav_items = doc_service::build_nav_tree(&path);

    render_template(&DocsPageTemplate {
        title,
        content,
        nav_items,
        toc,
    })
}
