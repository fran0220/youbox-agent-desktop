-- JAcoworks System Settings
-- Run after 002_website_tables.sql

CREATE TABLE IF NOT EXISTS system_settings (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger
DROP TRIGGER IF EXISTS trg_system_settings_updated ON system_settings;
CREATE TRIGGER trg_system_settings_updated
    BEFORE UPDATE ON system_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed default keys (empty values, admin fills via UI)
INSERT INTO system_settings (key, description) VALUES
    ('llm_proxy_url', 'LLM 中转站地址'),
    ('llm_proxy_key', 'LLM 中转站密钥'),
    ('openai_api_key', 'OpenAI API 密钥 (Embedding 向量搜索)'),
    ('exa_api_key', 'Exa 搜索 API 密钥'),
    ('tavily_api_key', 'Tavily 搜索 API 密钥'),
    ('feishu_client_id', '飞书应用 Client ID'),
    ('feishu_client_secret', '飞书应用 Client Secret'),
    ('admin_token', '管理员 API Token'),
    ('embedding_base_url', 'Embedding API 地址 (OpenAI 兼容, 不含 /embeddings)'),
    ('embedding_api_key', 'Embedding API 密钥'),
    ('fal_api_key', 'fal.ai 图片生成 API 密钥'),
    ('mineru_token', 'MinerU 文档解析 API Token (mineru.net)'),
    ('jimeng_api_url', '即梦网关地址 (Seedance 视频生成)'),
    ('jimeng_api_key', '即梦网关 API 密钥'),
    ('github_token', 'GitHub Personal Access Token (反馈同步 Issues)'),
    ('github_repo', 'GitHub 仓库 (owner/repo 格式, 反馈同步 Issues)'),
    ('primary_model', '云端容器默认模型 (如 claude-sonnet-4-6)'),
    ('primary_provider', '云端容器默认 Provider (如 proxy-claude)'),
    ('posthog_api_key', 'PostHog API 密钥 (错误追踪 + 分析)'),
    ('posthog_endpoint', 'PostHog 端点地址 (默认 https://us.i.posthog.com)'),
    ('asset_gateway_token', 'Asset Gateway 认证 Token (资产生成 CLI)'),
    ('asset_gateway_url', 'Asset Gateway 服务地址 (资产生成 CLI)'),
    ('ai_search_gateway_url', 'AI Search 网关地址 (搜索 CLI)'),
    ('ai_search_token', 'AI Search 认证 Token (搜索 CLI)')
ON CONFLICT (key) DO NOTHING;
