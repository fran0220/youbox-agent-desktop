use axum::extract::{Path, State};
use axum::response::{IntoResponse, Redirect, Response};

use crate::error::AppError;
use crate::models::release::{self, Release, ReleaseAsset};
use crate::AppState;

const INSTALL_SH: &str = include_str!("../../../scripts/install-app.sh");
const INSTALL_PS1: &str = include_str!("../../../scripts/install-app.ps1");

const CHANNEL_FILES: &[(&str, &str)] = &[
    ("latest.yml", "win32"),
    ("latest-mac.yml", "darwin"),
    ("latest-linux.yml", "linux"),
    ("latest-linux-arm64.yml", "linux-arm64"),
];

pub async fn install_sh() -> impl IntoResponse {
    (
        [
            ("content-type", "text/x-shellscript; charset=utf-8"),
            ("cache-control", "public, max-age=300"),
        ],
        INSTALL_SH,
    )
}

pub async fn install_ps1() -> impl IntoResponse {
    (
        [
            ("content-type", "text/plain; charset=utf-8"),
            ("cache-control", "public, max-age=300"),
        ],
        INSTALL_PS1,
    )
}

/// Public compatibility endpoint for install scripts:
/// GET /electron/latest/{latest.yml|latest-mac.yml|asset-name}
///
/// Desktop in-app updates still use the authenticated gateway feed. The website
/// feed is intentionally public so fresh installs can discover and download the
/// latest COS-hosted desktop artifacts without a gateway session token.
pub async fn latest_file(
    State(state): State<AppState>,
    Path(file): Path<String>,
) -> Result<Response, AppError> {
    if file.contains('/') || file.contains("..") {
        return Err(AppError::NotFound("not found".to_string()));
    }

    let latest = release::get_latest_release(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("no release found".to_string()))?;
    let assets = release::list_assets(&state.db, &latest.id).await?;

    if let Some((_, family)) = CHANNEL_FILES.iter().find(|(name, _)| *name == file) {
        let picked = pick_release_assets_for_feed(&assets, family);
        if picked.is_empty() {
            return Err(AppError::NotFound("no asset for platform".to_string()));
        }
        let body = build_channel_yaml(&latest, &picked);
        return Ok(([("content-type", "text/yaml; charset=utf-8")], body).into_response());
    }

    let asset = assets
        .into_iter()
        .find(|asset| release_asset_file_name(&asset.download_url) == file)
        .ok_or_else(|| AppError::NotFound("asset not found".to_string()))?;

    if let Err(err) = release::increment_download_count(&state.db, &asset.id).await {
        tracing::warn!(
            release_id = %latest.id,
            asset_id = %asset.id,
            error = %err,
            "failed to increment public desktop download count"
        );
    }

    Ok(Redirect::temporary(&asset.download_url).into_response())
}

fn pick_release_assets_for_feed(
    assets: &[ReleaseAsset],
    platform_family: &str,
) -> Vec<ReleaseAsset> {
    let mut preferred = Vec::new();
    let mut fallback = Vec::new();

    for asset in assets {
        if !asset_matches_feed_platform(&asset.platform, platform_family) {
            continue;
        }
        if !asset_matches_updater_artifact(&asset.download_url, platform_family) {
            continue;
        }
        if asset.signature.trim().is_empty() {
            continue;
        }
        if is_updater_platform(&asset.platform) {
            preferred.push(asset.clone());
        } else {
            fallback.push(asset.clone());
        }
    }

    let mut picked = Vec::new();
    for asset in preferred.into_iter().chain(fallback) {
        if picked
            .iter()
            .any(|existing: &ReleaseAsset| existing.download_url == asset.download_url)
        {
            continue;
        }
        picked.push(asset);
    }
    picked
}

fn asset_matches_feed_platform(platform: &str, family: &str) -> bool {
    let platform = platform.to_lowercase();
    match family {
        "darwin" => {
            platform.contains("darwin")
                || platform.starts_with("mac")
                || (platform.contains("aarch64")
                    && !platform.contains("linux")
                    && !platform.contains("windows"))
        }
        "win32" => platform.contains("win") || platform.contains("windows"),
        "linux" => {
            platform.contains("linux") && !platform.contains("arm") && !platform.contains("aarch64")
        }
        "linux-arm64" => {
            platform.contains("linux") && (platform.contains("arm") || platform.contains("aarch64"))
        }
        _ => false,
    }
}

fn is_updater_platform(platform: &str) -> bool {
    platform.to_lowercase().ends_with("-updater")
}

fn asset_matches_updater_artifact(download_url: &str, family: &str) -> bool {
    let file_name = release_asset_file_name(download_url).to_lowercase();
    match family {
        "darwin" => file_name.ends_with(".zip"),
        "win32" => file_name.ends_with(".exe"),
        "linux" | "linux-arm64" => file_name.ends_with(".appimage"),
        _ => false,
    }
}

fn release_asset_file_name(download_url: &str) -> String {
    let no_query = download_url
        .split(['?', '#'])
        .next()
        .unwrap_or(download_url);
    no_query.rsplit('/').next().unwrap_or(no_query).to_string()
}

fn build_channel_yaml(release: &Release, assets: &[ReleaseAsset]) -> String {
    let mut body = format!("version: {}\nfiles:\n", release.version);
    for asset in assets {
        let file_name = release_asset_file_name(&asset.download_url);
        body.push_str(&format!(
            "  - url: {}\n    sha512: {}\n    size: {}\n    arch: {}\n",
            file_name,
            asset.signature,
            asset.file_size,
            feed_arch(asset),
        ));
    }

    let first = &assets[0];
    let first_file = release_asset_file_name(&first.download_url);
    body.push_str(&format!(
        "path: {}\nsha512: {}\nreleaseDate: '{}'\n",
        first_file,
        first.signature,
        release.pub_date.to_rfc3339(),
    ));
    body
}

fn feed_arch(asset: &ReleaseAsset) -> &'static str {
    let platform = asset.platform.to_lowercase();
    let file_name = release_asset_file_name(&asset.download_url).to_lowercase();
    if platform.contains("arm64")
        || platform.contains("aarch64")
        || file_name.contains("arm64")
        || file_name.contains("aarch64")
    {
        "arm64"
    } else {
        "x64"
    }
}
