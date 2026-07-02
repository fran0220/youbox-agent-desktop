-- CLI tools manifest for runtime hot-update (Desktop downloads tools independently of app version)
-- Value is a JSON array: [{"name":"ai-search","version":"1.0.0","platforms":{"darwin-aarch64":{"url":"...","sha256":"..."},...}}]

INSERT INTO system_settings (key, value, description) VALUES
    ('cli_tools_manifest', '[]', 'CLI 工具版本清单 (JSON)，桌面端启动时检查并按需下载更新')
ON CONFLICT (key) DO NOTHING;
