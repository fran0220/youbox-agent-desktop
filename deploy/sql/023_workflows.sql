-- 023_workflows.sql: Workflow definitions for multi-stage orchestration

CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    stages JSONB NOT NULL DEFAULT '[]'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

DROP TRIGGER IF EXISTS set_workflows_updated_at ON workflows;
CREATE TRIGGER set_workflows_updated_at BEFORE UPDATE ON workflows
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
