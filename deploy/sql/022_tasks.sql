-- 022_tasks.sql: Task scheduling and orchestration

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL REFERENCES users(id),
    session_id TEXT,
    workflow_id TEXT,
    stage TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'chat'
        CHECK (type IN ('chat', 'research', 'document', 'analysis', 'creative', 'code')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'assigned', 'running', 'done', 'failed', 'timeout')),
    priority INT NOT NULL DEFAULT 0,
    agent_name TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL,
    result TEXT,
    error TEXT,
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 2,
    timeout_sec INT NOT NULL DEFAULT 300,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks (user_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status) WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS idx_tasks_workflow ON tasks (workflow_id) WHERE workflow_id IS NOT NULL;

-- reuse the existing updated_at trigger function from 001
DROP TRIGGER IF EXISTS set_tasks_updated_at ON tasks;
CREATE TRIGGER set_tasks_updated_at BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
