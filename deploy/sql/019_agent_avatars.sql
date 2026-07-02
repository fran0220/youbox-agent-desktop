-- 019_agent_avatars.sql — Agent Avatar 资产存储

CREATE TABLE IF NOT EXISTS agent_avatars (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  agent_role TEXT NOT NULL,
  model_url  TEXT NOT NULL,
  anim_urls  JSONB NOT NULL DEFAULT '{}',
  style      TEXT NOT NULL DEFAULT 'cartoon',
  source     TEXT NOT NULL DEFAULT 'tripo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- user_id NULL = system default avatar for that role
CREATE UNIQUE INDEX IF NOT EXISTS idx_avatar_default ON agent_avatars(agent_role) WHERE user_id IS NULL;
-- each user can have one custom avatar per role
CREATE UNIQUE INDEX IF NOT EXISTS idx_avatar_user ON agent_avatars(user_id, agent_role) WHERE user_id IS NOT NULL;

-- Auto-update updated_at (reuses update_updated_at() from 001_init_business_tables.sql)
DROP TRIGGER IF EXISTS set_updated_at_agent_avatars ON agent_avatars;
CREATE TRIGGER set_updated_at_agent_avatars
  BEFORE UPDATE ON agent_avatars
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
