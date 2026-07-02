-- Upgrade Claude Opus model registry from 4.6 to 4.7.
-- Keep the runtime default on GPT-5.4; only update the selectable Claude Opus entry.

INSERT INTO llm_models (provider_key, model_id, display_name, context_window, max_tokens, reasoning, enabled, sort_order)
VALUES ('proxy', 'claude-opus-4-7', 'Opus 4.7', 200000, 32000, true, true, 2)
ON CONFLICT (provider_key, model_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  context_window = EXCLUDED.context_window,
  max_tokens = EXCLUDED.max_tokens,
  reasoning = EXCLUDED.reasoning,
  enabled = EXCLUDED.enabled,
  sort_order = EXCLUDED.sort_order;

DELETE FROM llm_models
WHERE provider_key = 'proxy' AND model_id = 'claude-opus-4-6';
