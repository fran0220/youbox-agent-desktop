use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::Serialize;

use crate::error::AppError;
use crate::models::release;
use crate::AppState;

#[derive(Serialize)]
struct UpdateResponse {
    version: String,
    notes: Option<String>,
    pub_date: String,
    url: String,
    signature: String,
}

/// Tauri updater endpoint: GET /api/update/:target/:arch/:current_version
/// Returns 204 if up-to-date, or JSON with update info.
pub async fn check(
    State(state): State<AppState>,
    Path((target, arch, current_version)): Path<(String, String, String)>,
) -> Result<impl IntoResponse, AppError> {
    let latest = release::get_latest_release(&state.db).await?;

    let latest = match latest {
        Some(r) => r,
        None => return Ok(axum::http::StatusCode::NO_CONTENT.into_response()),
    };

    // If client is already on the latest version, return 204
    // DB may store "v1.8.1" or "1.8.1"; Tauri sends without prefix.
    let latest_ver = latest.version.strip_prefix('v').unwrap_or(&latest.version);
    let client_ver = current_version.strip_prefix('v').unwrap_or(&current_version);
    if latest_ver == client_ver {
        return Ok(axum::http::StatusCode::NO_CONTENT.into_response());
    }

    // Tauri sends target="darwin-aarch64" arch="aarch64", so try target first,
    // then fall back to "{target}-{arch}" for legacy compatibility.
    let asset = release::get_updater_asset(&state.db, &latest.id, &target).await?;
    let platform = target.clone();
    let asset = match asset {
        Some(a) => Some(a),
        None => {
            let fallback = format!("{target}-{arch}");
            release::get_updater_asset(&state.db, &latest.id, &fallback).await?
        }
    };

    let asset = match asset {
        Some(a) => a,
        None => {
            return Err(AppError::NotFound(format!(
                "No asset for platform {platform}"
            )))
        }
    };

    // Download counting should not block updates, but failures must be visible in logs.
    if let Err(err) = release::increment_download_count(&state.db, &asset.id).await {
        tracing::warn!(
            release_id = %latest.id,
            asset_id = %asset.id,
            error = %err,
            "failed to increment release download count"
        );
    }

    Ok(Json(UpdateResponse {
        version: latest_ver.to_string(),
        notes: latest.notes,
        pub_date: latest.pub_date.to_rfc3339(),
        url: asset.download_url,
        signature: asset.signature,
    })
    .into_response())
}
