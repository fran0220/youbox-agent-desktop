-- LLM Model registry
CREATE TABLE IF NOT EXISTS llm_models (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    provider_key TEXT NOT NULL REFERENCES llm_providers(key) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    context_window INT NOT NULL DEFAULT 128000,
    max_tokens INT NOT NULL DEFAULT 16384,
    reasoning BOOLEAN NOT NULL DEFAULT false,
    enabled BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(provider_key, model_id)
);

DROP TRIGGER IF EXISTS set_llm_models_updated_at ON llm_models;
CREATE TRIGGER set_llm_models_updated_at
    BEFORE UPDATE ON llm_models
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
