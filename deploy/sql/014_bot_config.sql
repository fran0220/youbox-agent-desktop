-- Bot-level OpenClaw config (desired state tracking)
ALTER TABLE containers ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';
ALTER TABLE containers ADD COLUMN IF NOT EXISTS desired_config_hash TEXT DEFAULT '';
ALTER TABLE containers ADD COLUMN IF NOT EXISTS applied_config_hash TEXT DEFAULT '';
ALTER TABLE containers ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS pairing_status TEXT DEFAULT 'unknown';
ALTER TABLE containers ADD COLUMN IF NOT EXISTS paired_device_id TEXT DEFAULT '';

-- Seed default providers (matching current hardcoded config)
INSERT INTO llm_providers (key, display_name, api_type, base_url, api_key_ref, sort_order)
VALUES
    ('proxy', 'LLM Proxy (中转站)', 'openai-completions', '', 'LLM_PROXY_KEY', 0)
ON CONFLICT (key) DO NOTHING;

-- Seed default models
INSERT INTO llm_models (provider_key, model_id, display_name, context_window, max_tokens, reasoning, sort_order)
VALUES
    ('proxy', 'gpt-5.4', 'GPT 5.4', 128000, 16384, false, 0),
    ('proxy', 'claude-sonnet-4-6', 'Sonnet 4.6', 200000, 16384, false, 1),
    ('proxy', 'claude-opus-4-7', 'Opus 4.7', 200000, 32000, true, 2),
    ('proxy', 'grok-4.1-fast', 'Grok 4.1 Fast', 131072, 16384, false, 3),
    ('proxy', 'gemini-3.1-pro-preview', 'Gemini 3.1 Pro', 1000000, 8192, false, 4)
ON CONFLICT (provider_key, model_id) DO NOTHING;
