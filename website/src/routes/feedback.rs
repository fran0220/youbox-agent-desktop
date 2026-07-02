use askama::Template;
use axum::extract::State;
use axum::response::{Html, IntoResponse};

use crate::error::{render_template, AppError};
use crate::models::feedback as fb_model;
use crate::AppState;

#[derive(Template)]
#[template(path = "feedback.html")]
#[allow(dead_code)]
struct FeedbackTemplate {
    success: bool,
    error: Option<String>,
}

pub async fn form_page() -> Result<impl IntoResponse, AppError> {
    render_template(&FeedbackTemplate {
        success: false,
        error: None,
    })
}

#[derive(serde::Deserialize)]
pub struct FeedbackForm {
    name: Option<String>,
    email: Option<String>,
    category: String,
    message: String,
    app_version: Option<String>,
}

pub async fn submit(
    State(state): State<AppState>,
    axum::Form(form): axum::Form<FeedbackForm>,
) -> Result<impl IntoResponse, AppError> {
    if form.message.trim().is_empty() {
        return Ok(Html(
            "<div class=\"bg-red-50 rounded-2xl p-8 text-center\">\
             <p class=\"text-red-700 font-medium\">请填写详细描述</p>\
             <a href=\"/feedback\" class=\"text-terra hover:text-terra-dark mt-4 inline-block\">返回</a>\
             </div>"
                .to_string(),
        ));
    }

    let valid_categories = ["bug", "feature", "general"];
    let category = if valid_categories.contains(&form.category.as_str()) {
        &form.category
    } else {
        "general"
    };

    fb_model::create_feedback(
        &state.db,
        form.name.as_deref().filter(|s| !s.is_empty()),
        form.email.as_deref().filter(|s| !s.is_empty()),
        category,
        form.message.trim(),
        form.app_version.as_deref().filter(|s| !s.is_empty()),
    )
    .await?;

    Ok(Html(
        "<div class=\"bg-green-50 rounded-2xl p-8 text-center\">\
         <div class=\"text-4xl mb-4\">✅</div>\
         <h3 class=\"text-lg font-semibold text-gray-900 mb-2\">感谢您的反馈！</h3>\
         <p class=\"text-gray-500\">我们会尽快查看并处理。</p>\
         <a href=\"/\" class=\"text-terra hover:text-terra-dark mt-4 inline-block font-medium\">返回首页</a>\
         </div>"
            .to_string(),
    ))
}
