-- LLM Provider registry (source of truth for OpenClaw config generation)
CREATE TABLE IF NOT EXISTS llm_providers (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    api_type TEXT NOT NULL DEFAULT 'openai-completions',
    base_url TEXT NOT NULL,
    api_key_ref TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_llm_providers_updated_at ON llm_providers;
CREATE TRIGGER set_llm_providers_updated_at
    BEFORE UPDATE ON llm_providers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
