-- Add MinerU API token setting
-- Run after 014_bot_config.sql

INSERT INTO system_settings (key, description) VALUES
    ('mineru_token', 'MinerU 文档解析 API Token (mineru.net)')
ON CONFLICT (key) DO NOTHING;
