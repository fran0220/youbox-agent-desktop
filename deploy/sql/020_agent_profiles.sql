CREATE TABLE IF NOT EXISTS agent_profiles (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    icon         TEXT NOT NULL DEFAULT 'bot',
    model        TEXT NOT NULL DEFAULT '',
    skills       JSONB NOT NULL DEFAULT '[]'::jsonb,
    workspace    TEXT NOT NULL DEFAULT '',
    files        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_agent_profiles_user ON agent_profiles(user_id);

DROP TRIGGER IF EXISTS trg_agent_profiles_updated ON agent_profiles;
CREATE TRIGGER trg_agent_profiles_updated
    BEFORE UPDATE ON agent_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
