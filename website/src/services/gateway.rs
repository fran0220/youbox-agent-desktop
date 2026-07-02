use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct LogEntry {
    pub level: String,
    pub msg: String,
    #[serde(default)]
    pub ts: String,
    #[serde(default)]
    pub trace_id: String,
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub service: String,
    #[serde(default)]
    pub raw: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SystemSetting {
    pub key: String,
    pub value: String,
    pub description: String,
}

/// Client for proxying admin operations to the Go gateway.
pub struct GatewayClient {
    http: reqwest::Client,
    base_url: String,
    admin_token: String,
}

impl GatewayClient {
    pub fn new(http: reqwest::Client, base_url: String, admin_token: String) -> Self {
        Self {
            http,
            base_url,
            admin_token,
        }
    }

    pub async fn health(&self) -> Result<bool, AppError> {
        let resp = self
            .http
            .get(format!("{}/health", self.base_url))
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("gateway health check failed: {e}")))?;
        Ok(resp.status().is_success())
    }

    pub async fn start_container(&self, id: &str) -> Result<(), AppError> {
        let resp = self
            .http
            .post(format!(
                "{}/api/admin/containers/{}/start",
                self.base_url, id
            ))
            .header("Authorization", format!("Bearer {}", self.admin_token))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("start container failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "start container failed ({status}): {body}"
            )));
        }

        Ok(())
    }

    pub async fn stop_container(&self, id: &str) -> Result<(), AppError> {
        let resp = self
            .http
            .post(format!(
                "{}/api/admin/containers/{}/stop",
                self.base_url, id
            ))
            .header("Authorization", format!("Bearer {}", self.admin_token))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("stop container failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "stop container failed ({status}): {body}"
            )));
        }

        Ok(())
    }

    pub async fn get_settings(&self) -> Result<Vec<SystemSetting>, AppError> {
        let resp = self
            .http
            .get(format!("{}/api/admin/settings", self.base_url))
            .header("Authorization", format!("Bearer {}", self.admin_token))
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("get settings failed: {e}")))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "failed to fetch settings from gateway ({status}): {body}"
            )));
        }
        resp.json::<Vec<SystemSetting>>()
            .await
            .map_err(|e| AppError::Internal(format!("parse settings failed: {e}")))
    }

    pub async fn update_settings(
        &self,
        settings: std::collections::HashMap<String, String>,
    ) -> Result<(), AppError> {
        let body = serde_json::json!({ "settings": settings });
        let resp = self
            .http
            .put(format!("{}/api/admin/settings", self.base_url))
            .header("Authorization", format!("Bearer {}", self.admin_token))
            .json(&body)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("update settings failed: {e}")))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "failed to update settings ({status}): {body}"
            )));
        }
        Ok(())
    }

    pub async fn get_logs(
        &self,
        service: &str,
        container: Option<&str>,
        level: Option<&str>,
        search: Option<&str>,
        lines: Option<u32>,
    ) -> Result<Vec<LogEntry>, AppError> {
        let mut url = format!("{}/api/admin/logs?service={}", self.base_url, service);
        if let Some(c) = container {
            url.push_str(&format!("&container={}", c));
        }
        if let Some(l) = level {
            url.push_str(&format!("&level={}", l));
        }
        if let Some(s) = search {
            url.push_str(&format!("&search={}", urlencoding::encode(s)));
        }
        if let Some(n) = lines {
            url.push_str(&format!("&lines={}", n));
        }
        let resp = self
            .http
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.admin_token))
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("fetch logs failed: {e}")))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "fetch logs failed ({status}): {body}"
            )));
        }
        resp.json::<Vec<LogEntry>>()
            .await
            .map_err(|e| AppError::Internal(format!("parse logs failed: {e}")))
    }

    pub async fn sync_container_config(&self, container_name: &str) -> Result<(), AppError> {
        let resp = self
            .http
            .post(format!(
                "{}/api/admin/containers/{}/sync-config",
                self.base_url, container_name
            ))
            .header("Authorization", format!("Bearer {}", self.admin_token))
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("sync config failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "sync config failed ({status}): {body}"
            )));
        }
        Ok(())
    }

    pub async fn restart_container(&self, container_name: &str) -> Result<(), AppError> {
        let resp = self
            .http
            .post(format!(
                "{}/api/admin/containers/{}/restart",
                self.base_url, container_name
            ))
            .header("Authorization", format!("Bearer {}", self.admin_token))
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("restart container failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "restart container failed ({status}): {body}"
            )));
        }
        Ok(())
    }
}
