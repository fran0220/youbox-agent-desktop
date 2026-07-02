-- Decouple webchat (oc-gateway) default model from desktop (gateway).
-- oc_primary_model overrides the shared primary_model for OpenClaw containers.
-- Run after 016_vnc_port.sql

INSERT INTO system_settings (key, value, description) VALUES
    ('oc_primary_model', 'proxy/claude-opus-4-6', 'WebChat OpenClaw 默认主模型 (覆盖 primary_model)'),
    ('oc_primary_provider', '', 'WebChat OpenClaw 默认 provider (覆盖 primary_provider, 留空则用 proxy)')
ON CONFLICT (key) DO NOTHING;
