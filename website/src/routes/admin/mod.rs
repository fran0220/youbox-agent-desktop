pub mod audit;
pub mod bots;
pub mod centers;
pub mod containers;
pub mod dashboard;
pub mod feedback;
pub mod invites;
pub mod logs;
pub mod providers;
pub mod releases;
pub mod settings;
pub mod skills;
pub mod users;

use axum::routing::{delete, get, post, put};
use axum::Router;

use crate::AppState;

/// Build admin sub-router. All routes require AdminUser extractor.
pub fn admin_routes() -> Router<AppState> {
    Router::new()
        .route("/", get(dashboard::index))
        .route("/operations", get(centers::operations))
        .route("/runtime", get(centers::runtime))
        .route("/runtime/bots/{name}/sync", post(centers::sync_runtime_bot))
        .route("/runtime/bots/{name}/restart", post(centers::restart_runtime_bot))
        .route("/config", get(centers::config))
        .route("/config/settings", post(centers::update_config_settings))
        .route("/config/providers", post(centers::upsert_config_provider))
        .route(
            "/config/providers/{key}/delete",
            post(centers::delete_config_provider),
        )
        .route("/config/providers/models", post(centers::upsert_config_model))
        .route(
            "/config/providers/models/{id}/delete",
            post(centers::delete_config_model),
        )
        .route(
            "/config/skills/delete",
            delete(centers::delete_config_skill).post(centers::delete_config_skill),
        )
        .route("/users", get(centers::redirect_operations_users))
        .route("/users/{id}", get(users::detail))
        .route("/users/{id}/role", post(users::change_role))
        .route("/users/{id}/toggle", post(users::toggle_role))
        .route("/users/{id}/toggle-role", post(users::toggle_role))
        .route(
            "/invites",
            get(centers::redirect_operations_invites).post(invites::create),
        )
        .route("/invites/{code}", delete(invites::revoke))
        .route("/invites/{code}/revoke", post(invites::revoke))
        .route("/releases", get(releases::list).post(releases::create))
        .route("/releases/{id}/edit", get(releases::edit_form))
        .route(
            "/releases/{id}",
            put(releases::update)
                .post(releases::update)
                .delete(releases::delete),
        )
        .route("/releases/{id}/assets", post(releases::upload_asset))
        .route(
            "/releases/{id}/assets/{asset_id}",
            delete(releases::delete_asset),
        )
        .route("/releases/{id}/set-latest", post(releases::set_latest))
        .route("/releases/{id}/latest", post(releases::set_latest))
        .route("/releases/{id}/delete", post(releases::delete))
        .route("/containers", get(centers::redirect_runtime_containers))
        .route("/containers/{id}/start", post(containers::start))
        .route("/containers/{id}/stop", post(containers::stop))
        .route("/bots", get(centers::redirect_runtime_bots))
        .route("/bots/{name}/sync", post(bots::sync_config))
        .route("/bots/{name}/restart", post(bots::restart))
        .route("/bots/{name}/logs", get(bots::logs))
        .route(
            "/providers",
            get(centers::redirect_config_providers).post(providers::upsert_provider_handler),
        )
        .route(
            "/providers/{key}/delete",
            post(providers::delete_provider_handler),
        )
        .route("/providers/models", post(providers::upsert_model_handler))
        .route(
            "/providers/models/{id}/delete",
            post(providers::delete_model_handler),
        )
        .route("/feedback", get(centers::redirect_operations_feedback))
        .route("/feedback/{id}/reply", post(feedback::reply))
        .route("/feedback/{id}/status", post(feedback::update_status))
        .route("/audit", get(audit::list))
        .route("/logs", get(centers::redirect_runtime_logs))
        .route(
            "/settings",
            get(centers::redirect_config_settings).post(settings::update),
        )
        .route("/skills", get(centers::redirect_config_skills))
        .route("/skills/edit", get(skills::edit_form))
        .route("/skills/save", post(skills::save))
        .route(
            "/skills/delete",
            delete(skills::delete).post(skills::delete),
        )
}
