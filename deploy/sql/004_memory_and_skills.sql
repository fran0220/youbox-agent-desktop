-- Memory sync: bidirectional between desktop and cloud containers
CREATE TABLE IF NOT EXISTS user_memory (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_path  TEXT NOT NULL,          -- "MEMORY.md" | "daily/2026-02-26.md"
    content    TEXT NOT NULL DEFAULT '',
    checksum   TEXT NOT NULL,          -- SHA-256 first 16 chars
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, file_path)
);
CREATE INDEX IF NOT EXISTS idx_user_memory_updated ON user_memory(user_id, updated_at DESC);

-- Skills: one-way push from desktop to cloud containers
CREATE TABLE IF NOT EXISTS skill_files (
    owner      TEXT NOT NULL,          -- 'system' for builtin skills | user_id for custom
    file_path  TEXT NOT NULL,          -- relative path e.g. "创作/poster/SKILL.md"
    content    TEXT NOT NULL,
    checksum   TEXT NOT NULL,          -- SHA-256 first 16 chars of content
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner, file_path)
);
CREATE INDEX IF NOT EXISTS idx_skill_files_owner ON skill_files(owner);
