use askama::Template;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Redirect, Response};

use crate::auth::AdminUser;
use crate::error::{render_template, AppError};
use crate::models::release;
use crate::AppState;

#[derive(Clone)]
#[allow(dead_code)]
struct AssetView {
    id: String,
    platform: String,
    platform_label: String,
    download_url: String,
    file_size: String,
    download_count: i32,
}

#[derive(Clone)]
#[allow(dead_code)]
struct ReleaseView {
    id: String,
    version: String,
    notes: String,
    notes_preview: String,
    pub_date: String,
    created_at: String,
    is_latest: bool,
    asset_count: usize,
    assets: Vec<AssetView>,
}

#[derive(Template)]
#[template(path = "admin/releases.html")]
struct ReleasesTemplate {
    admin_name: String,
    active_page: String,
    releases: Vec<ReleaseView>,
}

#[derive(Template)]
#[template(path = "admin/partials/releases_list.html")]
struct ReleasesListTemplate {
    releases: Vec<ReleaseView>,
}

#[derive(Clone)]
struct ReleaseEditView {
    id: String,
    version: String,
    notes: String,
}

#[derive(Template)]
#[template(path = "admin/release_edit.html")]
struct ReleaseEditTemplate {
    admin_name: String,
    active_page: String,
    release: ReleaseEditView,
    release_id: String,
    assets: Vec<AssetView>,
}

#[derive(Template)]
#[template(path = "admin/partials/release_edit_panel.html")]
struct ReleaseEditPanelTemplate {
    release: ReleaseEditView,
}

#[derive(Template)]
#[template(path = "admin/partials/release_assets_list.html")]
struct ReleaseAssetsListTemplate {
    release_id: String,
    assets: Vec<AssetView>,
}

pub async fn list(
    State(state): State<AppState>,
    admin: AdminUser,
) -> Result<impl IntoResponse, AppError> {
    let releases = load_release_views(&state).await?;

    render_template(&ReleasesTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "releases".into(),
        releases,
    })
}

#[derive(serde::Deserialize)]
pub struct CreateReleaseForm {
    version: String,
    notes: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    _admin: AdminUser,
    headers: HeaderMap,
    axum::Form(form): axum::Form<CreateReleaseForm>,
) -> Result<Response, AppError> {
    release::create_release(&state.db, &form.version, form.notes.as_deref()).await?;

    if is_htmx_request(&headers) {
        return render_releases_list(&state).await;
    }

    Ok(Redirect::to("/admin/releases").into_response())
}

pub async fn edit_form(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let release = load_release_edit_view(&state, &id).await?;
    let assets = load_asset_views(&state, &id).await?;

    render_template(&ReleaseEditTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "releases".into(),
        release_id: release.id.clone(),
        release,
        assets,
    })
}

#[derive(serde::Deserialize)]
pub struct UpdateReleaseForm {
    version: String,
    notes: Option<String>,
}

pub async fn update(
    State(state): State<AppState>,
    _admin: AdminUser,
    headers: HeaderMap,
    Path(id): Path<String>,
    axum::Form(form): axum::Form<UpdateReleaseForm>,
) -> Result<Response, AppError> {
    release::update_release(&state.db, &id, &form.version, form.notes.as_deref()).await?;

    if is_htmx_request(&headers) {
        return render_release_edit_panel(&state, &id).await;
    }

    Ok(Redirect::to(&format!("/admin/releases/{}/edit", id)).into_response())
}

#[derive(serde::Deserialize)]
pub struct UploadAssetForm {
    platform: String,
    download_url: String,
    signature: Option<String>,
    file_size: Option<String>,
}

pub async fn upload_asset(
    State(state): State<AppState>,
    _admin: AdminUser,
    headers: HeaderMap,
    Path(id): Path<String>,
    axum::Form(form): axum::Form<UploadAssetForm>,
) -> Result<Response, AppError> {
    release::create_asset(
        &state.db,
        &id,
        &form.platform,
        &form.download_url,
        form.signature.as_deref().unwrap_or(""),
        parse_file_size(form.file_size.as_deref()),
    )
    .await?;

    if is_htmx_request(&headers) {
        return render_release_assets_list(&state, &id).await;
    }

    Ok(Redirect::to(&format!("/admin/releases/{}/edit", id)).into_response())
}

pub async fn delete_asset(
    State(state): State<AppState>,
    _admin: AdminUser,
    headers: HeaderMap,
    Path((release_id, asset_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    release::delete_asset(&state.db, &asset_id).await?;

    if is_htmx_request(&headers) {
        return render_release_assets_list(&state, &release_id).await;
    }

    Ok(Redirect::to(&format!("/admin/releases/{release_id}/edit")).into_response())
}

pub async fn set_latest(
    State(state): State<AppState>,
    _admin: AdminUser,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    release::set_latest(&state.db, &id).await?;

    if is_htmx_request(&headers) {
        return render_releases_list(&state).await;
    }

    Ok(Redirect::to("/admin/releases").into_response())
}

pub async fn delete(
    State(state): State<AppState>,
    _admin: AdminUser,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    release::delete_release(&state.db, &id).await?;

    if is_htmx_request(&headers) {
        return render_releases_list(&state).await;
    }

    Ok(Redirect::to("/admin/releases").into_response())
}

async fn render_releases_list(state: &AppState) -> Result<Response, AppError> {
    let releases = load_release_views(state).await?;
    let html = ReleasesListTemplate { releases }
        .render()
        .map_err(|e| AppError::Internal(format!("template render error: {e}")))?;
    Ok(axum::response::Html(html).into_response())
}

async fn render_release_edit_panel(state: &AppState, id: &str) -> Result<Response, AppError> {
    let release = load_release_edit_view(state, id).await?;
    let html = ReleaseEditPanelTemplate { release }
        .render()
        .map_err(|e| AppError::Internal(format!("template render error: {e}")))?;
    Ok(axum::response::Html(html).into_response())
}

async fn render_release_assets_list(state: &AppState, id: &str) -> Result<Response, AppError> {
    let assets = load_asset_views(state, id).await?;
    let html = ReleaseAssetsListTemplate {
        release_id: id.to_string(),
        assets,
    }
    .render()
    .map_err(|e| AppError::Internal(format!("template render error: {e}")))?;
    Ok(axum::response::Html(html).into_response())
}

async fn load_release_views(state: &AppState) -> Result<Vec<ReleaseView>, AppError> {
    let raw_releases = release::list_releases(&state.db).await?;
    let mut releases = Vec::new();

    for r in raw_releases {
        let raw_assets = release::list_assets(&state.db, &r.id).await?;
        let assets: Vec<AssetView> = raw_assets.iter().map(asset_view).collect();
        let notes = r.notes.clone().unwrap_or_default();
        let notes_preview = if notes.chars().count() > 80 {
            let end = notes
                .char_indices()
                .nth(80)
                .map(|(i, _)| i)
                .unwrap_or(notes.len());
            format!("{}…", &notes[..end])
        } else {
            notes.clone()
        };
        let asset_count = assets.len();
        releases.push(ReleaseView {
            id: r.id,
            version: r.version,
            notes,
            notes_preview,
            pub_date: r.pub_date.format("%Y-%m-%d").to_string(),
            created_at: r.created_at.format("%Y-%m-%d %H:%M").to_string(),
            is_latest: r.is_latest,
            asset_count,
            assets,
        });
    }

    Ok(releases)
}

async fn load_release_edit_view(state: &AppState, id: &str) -> Result<ReleaseEditView, AppError> {
    let r = release::get_release(&state.db, id)
        .await?
        .ok_or(AppError::NotFound("Release not found".into()))?;
    Ok(ReleaseEditView {
        id: r.id,
        version: r.version,
        notes: r.notes.unwrap_or_default(),
    })
}

async fn load_asset_views(state: &AppState, release_id: &str) -> Result<Vec<AssetView>, AppError> {
    let raw_assets = release::list_assets(&state.db, release_id).await?;
    Ok(raw_assets.iter().map(asset_view).collect())
}

fn is_htmx_request(headers: &HeaderMap) -> bool {
    headers
        .get("HX-Request")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn asset_view(a: &release::ReleaseAsset) -> AssetView {
    AssetView {
        id: a.id.clone(),
        platform: a.platform.clone(),
        platform_label: platform_label(&a.platform).to_string(),
        download_url: a.download_url.clone(),
        file_size: format_file_size(a.file_size),
        download_count: a.download_count,
    }
}

fn platform_label(p: &str) -> &'static str {
    match p {
        "darwin-aarch64" => "macOS (Apple Silicon)",
        "darwin-aarch64-updater" => "macOS (Apple Silicon updater)",
        "darwin-x86_64" => "macOS (Intel)",
        "darwin-x86_64-updater" => "macOS (Intel updater)",
        "windows-x86_64" => "Windows (64-bit)",
        "windows-x86_64-updater" => "Windows (64-bit updater)",
        "linux-x86_64" => "Linux (AppImage)",
        "linux-x86_64-updater" => "Linux (AppImage updater)",
        "linux-aarch64" => "Linux (ARM64 AppImage)",
        "linux-aarch64-updater" => "Linux (ARM64 AppImage updater)",
        _ => "Other",
    }
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

fn parse_file_size(input: Option<&str>) -> i64 {
    let Some(raw) = input else {
        return 0;
    };

    let normalized = raw.trim().to_lowercase();
    if normalized.is_empty() {
        return 0;
    }

    if let Ok(bytes) = normalized.parse::<i64>() {
        return bytes.max(0);
    }

    let compact = normalized.replace([',', ' '], "");
    let split_at = compact
        .chars()
        .position(|c| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(compact.len());
    let (number_part, unit_part) = compact.split_at(split_at);

    let Ok(value) = number_part.parse::<f64>() else {
        return 0;
    };

    let multiplier = match unit_part {
        "" | "b" => 1.0,
        "k" | "kb" => 1024.0,
        "m" | "mb" => 1024.0 * 1024.0,
        "g" | "gb" => 1024.0 * 1024.0 * 1024.0,
        "t" | "tb" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => 1.0,
    };

    (value * multiplier).round() as i64
}
