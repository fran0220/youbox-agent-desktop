-- 008: Cron jobs table (gateway-managed, proxied from sidecar mode)

CREATE TABLE IF NOT EXISTS cron_jobs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('cron', 'at', 'every')),
  schedule_expr TEXT NOT NULL,
  prompt TEXT NOT NULL,
  session_target TEXT NOT NULL DEFAULT 'isolated' CHECK (session_target IN ('main', 'isolated')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  delete_after_run BOOLEAN NOT NULL DEFAULT false,
  delivery_mode TEXT DEFAULT 'none' CHECK (delivery_mode IN ('announce', 'none')),
  last_run TIMESTAMPTZ,
  run_count INTEGER NOT NULL DEFAULT 0,
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_jobs_user_id ON cron_jobs(user_id);

-- updated_at trigger (same pattern as other tables)
CREATE OR REPLACE FUNCTION update_cron_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cron_jobs_updated_at ON cron_jobs;
CREATE TRIGGER trg_cron_jobs_updated_at
  BEFORE UPDATE ON cron_jobs
  FOR EACH ROW EXECUTE FUNCTION update_cron_jobs_updated_at();
