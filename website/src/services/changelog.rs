use std::path::Path;

/// A parsed changelog entry.
pub struct ChangelogEntry {
    pub version: String,
    pub date: String,
    pub notes: String,
}

/// Parse `content/changelog.md` into structured entries.
///
/// Expected format:
/// ```markdown
/// ## v1.3.1 (2026-03-05)
/// - item 1
/// - item 2
/// ```
pub fn parse_changelog(content: &str) -> Vec<ChangelogEntry> {
    let mut entries = Vec::new();
    let mut current: Option<(String, String)> = None; // (version, date)
    let mut notes_lines: Vec<&str> = Vec::new();

    for line in content.lines() {
        if let Some((ver, date)) = parse_heading(line) {
            // Flush previous entry
            if let Some((prev_ver, prev_date)) = current.take() {
                let notes = notes_lines.join("\n").trim().to_string();
                entries.push(ChangelogEntry {
                    version: prev_ver,
                    date: prev_date,
                    notes,
                });
                notes_lines.clear();
            }
            current = Some((ver, date));
        } else if current.is_some() {
            notes_lines.push(line);
        }
    }

    // Flush last entry
    if let Some((ver, date)) = current {
        let notes = notes_lines.join("\n").trim().to_string();
        entries.push(ChangelogEntry {
            version: ver,
            date: date,
            notes,
        });
    }

    entries
}

/// Parse a `## v1.2.3 (2026-03-05)` heading into (version, date).
fn parse_heading(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if !trimmed.starts_with("## ") {
        return None;
    }
    let rest = trimmed.trim_start_matches("## ").trim();

    // Extract version: starts with 'v' prefix (optional) then semver-like
    let version_part = rest.split_whitespace().next()?;
    let version = version_part.trim_start_matches('v').to_string();
    if version.is_empty() || !version.chars().next()?.is_ascii_digit() {
        return None;
    }

    // Extract date from parentheses
    let date = rest
        .find('(')
        .and_then(|start| {
            rest.find(')')
                .map(|end| rest[start + 1..end].trim().to_string())
        })
        .unwrap_or_default();

    Some((version, date))
}

/// Read and parse `content/changelog.md`.
pub fn load_changelog() -> Vec<ChangelogEntry> {
    let path = Path::new("content/changelog.md");
    match std::fs::read_to_string(path) {
        Ok(content) => parse_changelog(&content),
        Err(e) => {
            tracing::warn!("Failed to read changelog: {e}");
            vec![]
        }
    }
}

/// Sync parsed changelog entries into the `releases` table.
/// - Creates missing versions with notes and pub_date.
/// - Updates notes for existing versions if they differ.
/// - Marks the first entry (newest version) as `is_latest` if no latest exists.
/// - Preserves existing assets.
pub async fn sync_to_db(pool: &sqlx::PgPool) -> Result<usize, sqlx::Error> {
    let entries = load_changelog();
    if entries.is_empty() {
        tracing::info!("changelog: no entries found, skipping sync");
        return Ok(0);
    }

    let mut synced = 0usize;

    for entry in &entries {
        let pub_date = parse_date(&entry.date);
        let notes = if entry.notes.is_empty() {
            None
        } else {
            Some(entry.notes.as_str())
        };

        // Upsert: insert if version doesn't exist, update notes if changed
        let result = sqlx::query(
            r#"
            INSERT INTO releases (id, version, notes, pub_date, is_latest)
            VALUES (gen_random_uuid()::text, $1, $2, $3, false)
            ON CONFLICT (version) DO UPDATE
              SET notes = EXCLUDED.notes
              WHERE releases.notes IS DISTINCT FROM EXCLUDED.notes
            "#,
        )
        .bind(&entry.version)
        .bind(notes)
        .bind(pub_date)
        .execute(pool)
        .await?;

        if result.rows_affected() > 0 {
            synced += 1;
        }
    }

    // If no release is marked latest, mark the newest one
    let has_latest: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM releases WHERE is_latest = true)")
            .fetch_one(pool)
            .await?;

    if !has_latest {
        if let Some(newest) = entries.first() {
            sqlx::query("UPDATE releases SET is_latest = true WHERE version = $1")
                .bind(&newest.version)
                .execute(pool)
                .await?;
        }
    }

    if synced > 0 {
        tracing::info!("changelog: synced {synced} release(s) to database");
    } else {
        tracing::info!(
            "changelog: all {} releases already up to date",
            entries.len()
        );
    }

    Ok(synced)
}

fn parse_date(date_str: &str) -> chrono::DateTime<chrono::Utc> {
    chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
        .map(|d| d.and_hms_opt(0, 0, 0).unwrap())
        .map(|dt| chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(dt, chrono::Utc))
        .unwrap_or_else(|_| chrono::Utc::now())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_changelog() {
        let content = r#"# 更新日志

## v1.3.1 (2026-03-05)

- 🪟 Windows / macOS 跨平台兼容性改进
- 🔧 CI 构建流程优化

## v1.3.0 (2026-03-03)

- ⏱ 消息回复新增实时耗时计时器

## v1.0.0 (2026-03-01)

- 🎉 首次发布
"#;
        let entries = parse_changelog(content);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].version, "1.3.1");
        assert_eq!(entries[0].date, "2026-03-05");
        assert!(entries[0].notes.contains("跨平台"));
        assert_eq!(entries[1].version, "1.3.0");
        assert_eq!(entries[2].version, "1.0.0");
    }

    #[test]
    fn test_parse_version_ranges() {
        let content = "## v0.1.5 ~ v0.1.4 (2026-02-26)\n\n- Windows 版本稳定性改进\n";
        let entries = parse_changelog(content);
        assert_eq!(entries.len(), 1);
        // Takes first version token
        assert_eq!(entries[0].version, "0.1.5");
    }

    #[test]
    fn test_parse_heading() {
        assert_eq!(
            parse_heading("## v1.2.3 (2026-01-01)"),
            Some(("1.2.3".to_string(), "2026-01-01".to_string()))
        );
        assert_eq!(parse_heading("# 更新日志"), None);
        assert_eq!(parse_heading("some text"), None);
    }
}
