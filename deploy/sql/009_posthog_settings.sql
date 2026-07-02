-- Add PostHog settings for error tracking + analytics
INSERT INTO system_settings (key, description) VALUES
    ('posthog_api_key', 'PostHog API 密钥 (错误追踪 + 分析)'),
    ('posthog_endpoint', 'PostHog 端点地址 (默认 https://us.i.posthog.com)')
ON CONFLICT (key) DO NOTHING;
