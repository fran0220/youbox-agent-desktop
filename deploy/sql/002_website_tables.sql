-- JAcoworks Website Tables
-- Run after 001_init_business_tables.sql

-- ============================================================
-- Website-specific tables
-- ============================================================

-- 版本发布
CREATE TABLE IF NOT EXISTS releases (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    version         TEXT NOT NULL UNIQUE,
    notes           TEXT,
    pub_date        TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_latest       BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 平台安装包
CREATE TABLE IF NOT EXISTS release_assets (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    release_id      TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
    platform        TEXT NOT NULL,
    download_url    TEXT NOT NULL,
    signature       TEXT NOT NULL DEFAULT '',
    file_size       BIGINT NOT NULL DEFAULT 0,
    download_count  INT NOT NULL DEFAULT 0,
    UNIQUE(release_id, platform)
);

-- 用户反馈
CREATE TABLE IF NOT EXISTS feedback (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name            TEXT,
    email           TEXT,
    category        TEXT NOT NULL DEFAULT 'general'
                    CHECK (category IN ('bug','feature','general')),
    message         TEXT NOT NULL,
    app_version     TEXT,
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','in_progress','resolved','closed')),
    admin_reply     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_releases_latest ON releases(is_latest) WHERE is_latest = true;
CREATE INDEX IF NOT EXISTS idx_releases_version ON releases(version);
CREATE INDEX IF NOT EXISTS idx_release_assets_release ON release_assets(release_id);
CREATE INDEX IF NOT EXISTS idx_release_assets_platform ON release_assets(release_id, platform);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback(category);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);

-- ============================================================
-- Triggers
-- ============================================================

DROP TRIGGER IF EXISTS trg_feedback_updated ON feedback;
CREATE TRIGGER trg_feedback_updated
    BEFORE UPDATE ON feedback FOR EACH ROW EXECUTE FUNCTION update_updated_at();
