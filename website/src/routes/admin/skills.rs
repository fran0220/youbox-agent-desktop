#![allow(dead_code)]
// Legacy standalone skills list page code is retained while GET /admin/skills redirects into the consolidated config center.

use askama::Template;
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Redirect, Response};

use crate::auth::AdminUser;
use crate::error::{render_template, AppError};
use crate::models::skill;
use crate::AppState;

// ─── List ────────────────────────────────────────────

#[allow(dead_code)]
struct SkillView {
    file_path: String,
    group: String,
    name: String,
    checksum: String,
    updated_at: String,
    size: String,
}

#[allow(dead_code)]
struct GroupView {
    name: String,
    selected: bool,
}

#[derive(Template)]
#[template(path = "admin/skills.html")]
struct SkillsTemplate {
    admin_name: String,
    active_page: String,
    skills: Vec<SkillView>,
    total_count: i64,
    groups: Vec<GroupView>,
    all_selected: bool,
    save_success: bool,
    save_error: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct ListQuery {
    group: Option<String>,
    success: Option<bool>,
    error: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    admin: AdminUser,
    Query(query): Query<ListQuery>,
) -> Result<impl IntoResponse, AppError> {
    let all_files = skill::list_skills(&state.db, "system").await?;
    let total_count = all_files.len() as i64;

    // Extract unique groups
    let mut group_names: Vec<String> = all_files
        .iter()
        .filter_map(|f| {
            let parts: Vec<&str> = f.file_path.split('/').collect();
            if parts.len() > 1 {
                Some(parts[0].to_string())
            } else {
                None
            }
        })
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    group_names.sort();

    let filter_group = query.group.unwrap_or_default();
    let all_selected = filter_group.is_empty();
    let groups: Vec<GroupView> = group_names
        .into_iter()
        .map(|name| GroupView {
            selected: name == filter_group,
            name,
        })
        .collect();

    let skills: Vec<SkillView> = all_files
        .into_iter()
        .filter(|f| {
            if filter_group.is_empty() {
                return true;
            }
            f.file_path.starts_with(&format!("{}/", filter_group))
        })
        .map(|f| {
            let parts: Vec<&str> = f.file_path.split('/').collect();
            let group = if parts.len() > 1 {
                parts[0].to_string()
            } else {
                "未分类".to_string()
            };
            let name = if parts.len() > 1 {
                parts[1..].join("/")
            } else {
                f.file_path.clone()
            };
            SkillView {
                file_path: f.file_path,
                group,
                name,
                checksum: f.checksum[..8.min(f.checksum.len())].to_string(),
                updated_at: f.updated_at.format("%Y-%m-%d %H:%M").to_string(),
                size: format_size(f.content.len()),
            }
        })
        .collect();

    render_template(&SkillsTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "skills".into(),
        skills,
        total_count,
        groups,
        all_selected,
        save_success: query.success.unwrap_or(false),
        save_error: query.error,
    })
}

// ─── Edit / New ──────────────────────────────────────

#[derive(Template)]
#[template(path = "admin/skill_edit.html")]
struct SkillEditTemplate {
    admin_name: String,
    active_page: String,
    is_new: bool,
    file_path: String,
    content: String,
    save_error: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct EditQuery {
    path: Option<String>,
}

pub async fn edit_form(
    State(state): State<AppState>,
    admin: AdminUser,
    Query(query): Query<EditQuery>,
) -> Result<impl IntoResponse, AppError> {
    let (is_new, file_path, content) = if let Some(ref path) = query.path {
        match skill::get_skill(&state.db, "system", path).await? {
            Some(f) => (false, f.file_path, f.content),
            None => return Err(AppError::NotFound("技能文件不存在".into())),
        }
    } else {
        (true, String::new(), default_skill_template())
    };

    render_template(&SkillEditTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "skills".into(),
        is_new,
        file_path,
        content,
        save_error: None,
    })
}

// ─── Save ────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct SaveForm {
    file_path: String,
    content: String,
    original_path: Option<String>,
}

pub async fn save(
    State(state): State<AppState>,
    _admin: AdminUser,
    axum::Form(form): axum::Form<SaveForm>,
) -> Result<Response, AppError> {
    let file_path = form.file_path.trim().to_string();
    let content = form.content.clone();

    if file_path.is_empty() {
        return Ok(Redirect::to("/admin/skills?error=文件路径不能为空").into_response());
    }

    // If path changed (rename), delete old entry
    if let Some(ref orig) = form.original_path {
        let orig = orig.trim();
        if !orig.is_empty() && orig != file_path {
            skill::delete_skill(&state.db, "system", orig).await?;
        }
    }

    skill::upsert_skill(&state.db, "system", &file_path, &content).await?;

    let redirect = format!("/admin/skills?success=true");
    Ok(Redirect::to(&redirect).into_response())
}

// ─── Delete ──────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct DeleteQuery {
    path: String,
}

pub async fn delete(
    State(state): State<AppState>,
    _admin: AdminUser,
    headers: HeaderMap,
    Query(query): Query<DeleteQuery>,
) -> Result<Response, AppError> {
    skill::delete_skill(&state.db, "system", &query.path).await?;

    if is_htmx_request(&headers) {
        // Return empty string to remove the row
        Ok(axum::response::Html("").into_response())
    } else {
        Ok(Redirect::to("/admin/skills?success=true").into_response())
    }
}

// ─── Helpers ─────────────────────────────────────────

fn is_htmx_request(headers: &HeaderMap) -> bool {
    headers
        .get("HX-Request")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn format_size(bytes: usize) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    }
}

fn default_skill_template() -> String {
    r#"---
display-name: "新技能"
display-description: "技能描述"
---

# 技能名称

技能说明...

## 使用场景

- 场景一
- 场景二

## 工作流程

1. 步骤一
2. 步骤二
"#
    .to_string()
}
