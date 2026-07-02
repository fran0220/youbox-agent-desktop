use askama::Template;
use axum::extract::State;
use axum::response::IntoResponse;
use pulldown_cmark::{html, Options, Parser};

use crate::error::{render_template, AppError};
use crate::models::release;
use crate::AppState;

#[derive(Template)]
#[template(path = "pages/index.html")]
struct IndexTemplate {}

pub async fn index() -> Result<impl IntoResponse, AppError> {
    render_template(&IndexTemplate {})
}

pub struct AssetView {
    pub platform: String,
    pub platform_label: String,
    pub download_url: String,
    pub file_size: String,
}

#[derive(Template)]
#[template(path = "pages/download.html")]
struct DownloadTemplate {
    latest_version: String,
    latest_date: String,
    assets: Vec<AssetView>,
    notes_html: String,
}

pub async fn download(State(state): State<AppState>) -> Result<impl IntoResponse, AppError> {
    let latest = release::get_latest_release(&state.db).await?;

    let (version, date, assets, notes_html) = if let Some(ref rel) = latest {
        let raw_assets = release::list_assets(&state.db, &rel.id).await?;
        let views: Vec<AssetView> = raw_assets
            .iter()
            .filter(|a| !a.platform.contains("updater"))
            .map(|a| AssetView {
                platform: a.platform.clone(),
                platform_label: platform_label(&a.platform),
                download_url: a.download_url.clone(),
                file_size: format_file_size(a.file_size),
            })
            .collect();
        let html = rel
            .notes
            .as_deref()
            .map(render_markdown)
            .unwrap_or_default();
        (
            rel.version.clone(),
            rel.pub_date.format("%Y-%m-%d").to_string(),
            views,
            html,
        )
    } else {
        (String::new(), String::new(), vec![], String::new())
    };

    render_template(&DownloadTemplate {
        latest_version: version,
        latest_date: date,
        assets,
        notes_html,
    })
}

fn platform_label(platform: &str) -> String {
    match platform {
        "darwin-aarch64" => "macOS (Apple Silicon)",
        "darwin-x86_64" => "macOS (Intel)",
        "windows-x86_64" => "Windows (64-bit)",
        "linux-x86_64" => "Linux (AppImage)",
        "linux-aarch64" => "Linux (ARM64 AppImage)",
        other => other,
    }
    .to_string()
}

fn render_markdown(input: &str) -> String {
    let parser = Parser::new_ext(input, Options::all());
    let mut html_output = String::new();
    html::push_html(&mut html_output, parser);
    html_output
}

#[derive(Template)]
#[template(path = "pages/about.html")]
struct AboutTemplate {}

pub async fn about() -> Result<impl IntoResponse, AppError> {
    render_template(&AboutTemplate {})
}

fn format_file_size(bytes: i64) -> String {
    if bytes <= 0 {
        return String::new();
    }
    let mb = bytes as f64 / (1024.0 * 1024.0);
    if mb >= 1024.0 {
        format!("{:.1} GB", mb / 1024.0)
    } else {
        format!("{:.1} MB", mb)
    }
}
