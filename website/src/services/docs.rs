use pulldown_cmark::{html, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use std::path::{Path, PathBuf};

const CONTENT_DIR: &str = "content";

pub struct NavItem {
    pub title: String,
    pub path: String,
    pub active: bool,
    pub children: Vec<NavItem>,
}

pub struct TocItem {
    pub title: String,
    pub id: String,
    pub level: u32,
}

pub fn render_markdown(source: &str) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    let parser = Parser::new_ext(source, options);
    let mut html_output = String::new();
    html::push_html(&mut html_output, parser);
    html_output
}

pub fn extract_toc(source: &str) -> Vec<TocItem> {
    let options = Options::empty();
    let parser = Parser::new_ext(source, options);
    let mut toc = Vec::new();
    let mut in_heading = false;
    let mut heading_level = 0u32;
    let mut heading_text = String::new();

    for event in parser {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                let lvl = match level {
                    HeadingLevel::H2 => 2,
                    HeadingLevel::H3 => 3,
                    _ => 0,
                };
                if lvl >= 2 && lvl <= 3 {
                    in_heading = true;
                    heading_level = lvl;
                    heading_text.clear();
                }
            }
            Event::End(TagEnd::Heading(_)) => {
                if in_heading && !heading_text.is_empty() {
                    let id = heading_text
                        .to_lowercase()
                        .replace(' ', "-")
                        .chars()
                        .filter(|c| c.is_alphanumeric() || *c == '-')
                        .collect::<String>();
                    toc.push(TocItem {
                        title: heading_text.clone(),
                        id,
                        level: heading_level,
                    });
                }
                in_heading = false;
            }
            Event::Text(text) if in_heading => {
                heading_text.push_str(&text);
            }
            _ => {}
        }
    }
    toc
}

pub fn build_nav_tree(current_path: &str) -> Vec<NavItem> {
    let content_dir = Path::new(CONTENT_DIR);
    if !content_dir.exists() {
        return vec![];
    }

    let mut items = Vec::new();

    let top_files: Vec<(&str, &str)> = vec![
        ("index", "文档首页"),
        ("getting-started", "快速开始"),
        ("faq", "常见问题"),
        ("changelog", "更新日志"),
    ];

    for (slug, title) in &top_files {
        let file = content_dir.join(format!("{}.md", slug));
        if file.exists() || *slug == "index" {
            items.push(NavItem {
                title: title.to_string(),
                path: if *slug == "index" {
                    "/docs".to_string()
                } else {
                    format!("/docs/{}", slug)
                },
                active: current_path == *slug || (current_path.is_empty() && *slug == "index"),
                children: vec![],
            });
        }
    }

    // Guide subdirectory
    let guide_dir = content_dir.join("guide");
    if guide_dir.exists() {
        let guide_files: Vec<(&str, &str)> = vec![
            ("overview", "功能概览"),
            ("models", "AI 模型"),
            ("workspace", "工作空间"),
            ("memory", "记忆系统"),
            ("skills", "技能系统"),
            ("tasks", "定时任务"),
            ("cowork", "协作模式"),
        ];

        let children: Vec<NavItem> = guide_files
            .iter()
            .filter(|(slug, _)| guide_dir.join(format!("{}.md", slug)).exists())
            .map(|(slug, title)| {
                let path = format!("/docs/guide/{}", slug);
                NavItem {
                    title: title.to_string(),
                    path,
                    active: current_path == format!("guide/{}", slug),
                    children: vec![],
                }
            })
            .collect();

        if !children.is_empty() {
            items.push(NavItem {
                title: "用户指南".to_string(),
                path: "/docs/guide/overview".to_string(),
                active: current_path.starts_with("guide/"),
                children,
            });
        }
    }

    items
}

pub fn read_doc(path: &str) -> Result<(String, String), std::io::Error> {
    let clean_path = path.trim_start_matches('/');
    let file_path = if clean_path.is_empty() || clean_path == "index" {
        PathBuf::from(CONTENT_DIR).join("index.md")
    } else {
        PathBuf::from(CONTENT_DIR).join(format!("{}.md", clean_path))
    };

    let content = std::fs::read_to_string(&file_path)?;

    let title = content
        .lines()
        .find(|l| l.starts_with("# "))
        .map(|l| l.trim_start_matches("# ").to_string())
        .unwrap_or_else(|| "Documentation".to_string());

    Ok((title, content))
}
