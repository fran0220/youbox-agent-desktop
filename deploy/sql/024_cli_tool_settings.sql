-- CLI tool authentication settings (ai-search, asset-gateway)
-- These values are downloaded by Desktop and injected into the sidecar environment.

INSERT INTO system_settings (key, value, description) VALUES
    ('asset_gateway_token', '', 'Asset Gateway 认证 Token (资产生成 CLI)'),
    ('asset_gateway_url', 'https://asset.origingame.dev', 'Asset Gateway 服务地址 (资产生成 CLI)'),
    ('ai_search_gateway_url', 'https://search.xiaomao.chat', 'AI Search 网关地址 (搜索 CLI)'),
    ('ai_search_token', '', 'AI Search 认证 Token (搜索 CLI)')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;
