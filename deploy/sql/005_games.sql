-- JAcoworks Game Gallery Tables
-- Run after 001_init_business_tables.sql

-- ============================================================
-- Game gallery
-- ============================================================

CREATE TABLE IF NOT EXISTS games (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id         TEXT NOT NULL REFERENCES users(id),
    author_name     TEXT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT DEFAULT '',
    thumbnail_url   TEXT DEFAULT '',
    play_url        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'published'
                    CHECK (status IN ('published','hidden','deleted')),
    play_count      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_games_user ON games(user_id);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_created ON games(created_at DESC);

-- ============================================================
-- Triggers
-- ============================================================

DROP TRIGGER IF EXISTS trg_games_updated ON games;
CREATE TRIGGER trg_games_updated
    BEFORE UPDATE ON games FOR EACH ROW EXECUTE FUNCTION update_updated_at();
