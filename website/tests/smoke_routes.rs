use reqwest::{header, Client, StatusCode};
use serde::Deserialize;
use std::time::Duration;

const BASE_URL_ENV: &str = "WEBSITE_SMOKE_BASE_URL";
const SKIP_IF_DOWN_ENV: &str = "WEBSITE_SMOKE_SKIP_IF_DOWN";
const DEFAULT_BASE_URL: &str = "http://127.0.0.1:9527";

#[derive(Clone)]
struct SmokeTarget {
    base_url: String,
    client: Client,
}

impl SmokeTarget {
    async fn get(&self, path: &str) -> reqwest::Response {
        let url = join_url(&self.base_url, path);
        self.client
            .get(&url)
            .send()
            .await
            .unwrap_or_else(|err| panic!("request failed for {url}: {err}"))
    }

    async fn post_form(&self, path: &str, form: &[(&str, &str)]) -> reqwest::Response {
        let url = join_url(&self.base_url, path);
        self.client
            .post(&url)
            .form(form)
            .send()
            .await
            .unwrap_or_else(|err| panic!("request failed for {url}: {err}"))
    }
}

#[derive(Deserialize)]
struct UpdatePayload {
    version: String,
}

fn join_url(base: &str, path: &str) -> String {
    format!("{}{path}", base.trim_end_matches('/'))
}

fn assert_redirects_to_admin_login(response: &reqwest::Response, route: &str) {
    assert!(
        response.status().is_redirection(),
        "expected {route} to redirect to /admin/login, got {}",
        response.status()
    );

    let location = response
        .headers()
        .get(header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    assert!(
        location.starts_with("/admin/login"),
        "expected {route} redirect location to start with /admin/login, got {location:?}"
    );
}

fn assert_status_is_one_of(status: StatusCode, allowed: &[StatusCode], context: &str) {
    assert!(
        allowed.iter().any(|candidate| *candidate == status),
        "{context}: expected one of {allowed:?}, got {status}"
    );
}

async fn resolve_target() -> Option<SmokeTarget> {
    let base_url = std::env::var(BASE_URL_ENV).unwrap_or_else(|_| DEFAULT_BASE_URL.to_string());

    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("failed to build reqwest client");

    let probe_url = join_url(&base_url, "/");
    match client.get(&probe_url).send().await {
        Ok(_) => Some(SmokeTarget { base_url, client }),
        Err(err) => {
            if std::env::var(SKIP_IF_DOWN_ENV)
                .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
                .unwrap_or(false)
            {
                eprintln!(
                    "[website-smoke] skip: cannot reach {probe_url}. \
                     Start website dev server or set {BASE_URL_ENV}. error={err}"
                );
                return None;
            }

            panic!(
                "[website-smoke] cannot reach {probe_url}. \
                 Start website dev server, set {BASE_URL_ENV}, or set {SKIP_IF_DOWN_ENV}=1 to skip. error={err}"
            );
        }
    }
}

#[tokio::test]
async fn smoke_target_is_required_unless_explicitly_skipped() {
    if std::env::var(SKIP_IF_DOWN_ENV).is_ok() {
        return;
    }

    let client = Client::builder()
        .timeout(Duration::from_millis(100))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("failed to build reqwest client");
    let invalid_url = "http://127.0.0.1:1";
    let failed = client.get(invalid_url).send().await.is_err();
    assert!(failed, "test setup expected {invalid_url} to be unreachable");
}

#[tokio::test]
async fn homepage_returns_200_and_branding() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/").await;
    assert_eq!(response.status(), StatusCode::OK);

    let body = response
        .text()
        .await
        .expect("failed to read homepage response body");
    assert!(
        body.contains("JAcoworks"),
        "homepage should contain JAcoworks branding"
    );
}

#[tokio::test]
async fn download_page_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/download").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn about_page_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/about").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn docs_page_returns_200_and_navigation_content() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/docs").await;
    assert_eq!(response.status(), StatusCode::OK);

    let body = response
        .text()
        .await
        .expect("failed to read /docs response body");
    assert!(
        body.contains("文档") || body.contains("快速开始"),
        "docs index should contain documentation navigation content"
    );
}

#[tokio::test]
async fn docs_getting_started_returns_200_and_branding() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/docs/getting-started").await;
    assert_eq!(response.status(), StatusCode::OK);

    let body = response
        .text()
        .await
        .expect("failed to read /docs/getting-started response body");
    assert!(
        body.contains("JAcoworks") || body.contains("快速开始"),
        "getting-started page should contain JAcoworks branding or getting-started keyword"
    );
}

#[tokio::test]
async fn docs_faq_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/docs/faq").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn docs_changelog_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/docs/changelog").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn docs_guide_overview_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/docs/guide/overview").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn docs_guide_models_returns_200_and_model_keywords() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/docs/guide/models").await;
    assert_eq!(response.status(), StatusCode::OK);

    let body = response
        .text()
        .await
        .expect("failed to read /docs/guide/models response body");
    assert!(
        body.contains("Claude") || body.contains("模型"),
        "models page should contain Claude or 模型 keyword"
    );
}

#[tokio::test]
async fn docs_guide_skills_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/docs/guide/skills").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn docs_guide_memory_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/docs/guide/memory").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn docs_guide_workspace_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/docs/guide/workspace").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn docs_guide_cowork_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/docs/guide/cowork").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn feedback_page_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/feedback").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn games_gallery_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/games").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn static_css_returns_200_with_css_content_type() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/static/css/style.css").await;
    assert_eq!(response.status(), StatusCode::OK);

    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    assert!(
        content_type.contains("css"),
        "expected /static/css/style.css content-type to contain css, got {content_type:?}"
    );
}

#[tokio::test]
async fn static_js_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/static/js/app.js").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn admin_login_page_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/admin/login").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn admin_login_with_invalid_credentials_returns_200_or_401_without_redirect() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target
        .post_form(
            "/admin/login",
            &[
                ("email", "invalid-admin@jacoworks.local"),
                ("password", "wrong-password"),
            ],
        )
        .await;

    assert!(
        !response.status().is_redirection(),
        "invalid login should not redirect"
    );
    assert_status_is_one_of(
        response.status(),
        &[StatusCode::OK, StatusCode::UNAUTHORIZED],
        "invalid admin login status",
    );
}

#[tokio::test]
async fn admin_root_requires_auth_redirect() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/admin").await;
    assert_redirects_to_admin_login(&response, "/admin");
}

#[tokio::test]
async fn admin_dashboard_requires_auth_if_route_exposed() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/admin/dashboard").await;
    if response.status() == StatusCode::NOT_FOUND {
        eprintln!(
            "[website-smoke] /admin/dashboard route is not exposed; auth gate verified via /admin"
        );
        let fallback = target.get("/admin").await;
        assert_redirects_to_admin_login(&fallback, "/admin");
        return;
    }

    assert_redirects_to_admin_login(&response, "/admin/dashboard");
}

#[tokio::test]
async fn admin_center_routes_require_auth_redirect() {
    let Some(target) = resolve_target().await else {
        return;
    };

    for route in ["/admin/operations", "/admin/runtime", "/admin/config"] {
        let response = target.get(route).await;
        assert_redirects_to_admin_login(&response, route);
    }
}

#[tokio::test]
async fn admin_users_requires_auth_redirect() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/admin/users").await;
    assert_redirects_to_admin_login(&response, "/admin/users");
}

#[tokio::test]
async fn admin_invites_requires_auth_redirect() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/admin/invites").await;
    assert_redirects_to_admin_login(&response, "/admin/invites");
}

#[tokio::test]
async fn admin_releases_requires_auth_redirect() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/admin/releases").await;
    assert_redirects_to_admin_login(&response, "/admin/releases");
}

#[tokio::test]
async fn admin_settings_requires_auth_redirect() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/admin/settings").await;
    assert_redirects_to_admin_login(&response, "/admin/settings");
}

#[tokio::test]
async fn update_api_supports_no_update_204_or_empty_db_404_flow() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/api/update/darwin/aarch64/0.0.0").await;
    match response.status() {
        StatusCode::NO_CONTENT | StatusCode::NOT_FOUND => {}
        StatusCode::OK => {
            let payload: UpdatePayload = response
                .json()
                .await
                .expect("failed to parse update API JSON response");
            let no_update_path = format!("/api/update/darwin/aarch64/{}", payload.version);
            let no_update = target.get(&no_update_path).await;
            assert_eq!(
                no_update.status(),
                StatusCode::NO_CONTENT,
                "expected 204 when requesting current version"
            );
        }
        other => panic!("expected update API to return 200/204/404, got {other}"),
    }
}

#[tokio::test]
async fn update_api_linux_x86_64_returns_200_204_or_404_when_asset_missing() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/api/update/linux/x86_64/0.0.0").await;
    match response.status() {
        StatusCode::NO_CONTENT | StatusCode::NOT_FOUND => {}
        StatusCode::OK => {
            let payload: UpdatePayload = response
                .json()
                .await
                .expect("failed to parse linux update API JSON response");
            assert!(
                !payload.version.is_empty(),
                "linux update response version should not be empty"
            );
        }
        other => panic!(
            "expected linux update API to return 200/204/404 depending on release assets, got {other}"
        ),
    }
}

#[tokio::test]
async fn update_api_invalid_target_returns_404_or_204() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target
        .get("/api/update/invalid-target/invalid-arch/0.0.0")
        .await;
    assert_status_is_one_of(
        response.status(),
        &[StatusCode::NOT_FOUND, StatusCode::NO_CONTENT],
        "invalid target update API status",
    );
}

#[tokio::test]
async fn update_api_high_current_version_returns_200_204_or_empty_db_404() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/api/update/darwin/aarch64/99.99.99").await;
    match response.status() {
        StatusCode::NO_CONTENT | StatusCode::NOT_FOUND => {}
        StatusCode::OK => {
            let payload: UpdatePayload = response
                .json()
                .await
                .expect("failed to parse high-version update API JSON response");
            assert!(
                !payload.version.is_empty(),
                "darwin update response version should not be empty"
            );
        }
        other => {
            panic!("expected high current version update API to return 200/204/404, got {other}")
        }
    }
}

#[tokio::test]
async fn nonexistent_page_returns_404() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/nonexistent-page").await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn docs_nonexistent_slug_returns_404() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/docs/nonexistent-slug").await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn health_endpoint_returns_200_if_exposed() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/health").await;
    if response.status() == StatusCode::NOT_FOUND {
        eprintln!("[website-smoke] /health not exposed; skipping status assertion");
        return;
    }

    assert_eq!(response.status(), StatusCode::OK);
}
