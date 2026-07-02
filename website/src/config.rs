use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub gateway: GatewayConfig,
    pub site: SiteConfig,
    pub cookie_secret: String,
    #[serde(default)]
    pub posthog: PosthogConfig,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ServerConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
}

#[derive(Debug, Deserialize, Clone)]
pub struct DatabaseConfig {
    pub url: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct GatewayConfig {
    pub url: String,
    /// Public URL for browser redirects (e.g. Feishu SSO). Falls back to `url`.
    pub public_url: Option<String>,
    pub admin_token: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct SiteConfig {
    pub name: String,
    pub description: String,
    pub base_url: String,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct PosthogConfig {
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_posthog_host")]
    pub host: String,
}

fn default_posthog_host() -> String {
    "https://us.i.posthog.com".to_string()
}

fn default_host() -> String {
    "0.0.0.0".to_string()
}

fn default_port() -> u16 {
    9527
}

fn env_override(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

impl Config {
    pub fn load(path: &str) -> Result<Config, Box<dyn std::error::Error>> {
        let content = std::fs::read_to_string(Path::new(path))?;
        let mut config: Config = toml::from_str(&content)?;

        if let Some(secret) = env_override("WEBSITE_COOKIE_SECRET") {
            config.cookie_secret = secret;
        }
        if let Some(host) = env_override("WEBSITE_SERVER_HOST") {
            config.server.host = host;
        }
        if let Some(port) = env_override("WEBSITE_SERVER_PORT") {
            config.server.port = port.parse::<u16>().map_err(|err| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!("invalid WEBSITE_SERVER_PORT: {err}"),
                )
            })?;
        }
        if let Some(url) = env_override("WEBSITE_DATABASE_URL") {
            config.database.url = url;
        }
        if let Some(url) = env_override("WEBSITE_GATEWAY_URL") {
            config.gateway.url = url;
        }
        if let Some(url) = env_override("WEBSITE_GATEWAY_PUBLIC_URL") {
            config.gateway.public_url = Some(url);
        }
        if let Some(token) = env_override("WEBSITE_GATEWAY_ADMIN_TOKEN") {
            config.gateway.admin_token = token;
        }
        if let Some(name) = env_override("WEBSITE_SITE_NAME") {
            config.site.name = name;
        }
        if let Some(description) = env_override("WEBSITE_SITE_DESCRIPTION") {
            config.site.description = description;
        }
        if let Some(base_url) = env_override("WEBSITE_SITE_BASE_URL") {
            config.site.base_url = base_url;
        }
        if let Some(api_key) = env_override("WEBSITE_POSTHOG_API_KEY") {
            config.posthog.api_key = api_key;
        }
        if let Some(host) = env_override("WEBSITE_POSTHOG_HOST") {
            config.posthog.host = host;
        }

        Ok(config)
    }
}
