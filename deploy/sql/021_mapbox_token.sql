-- Mapbox token for DigitalCityPanel, managed via system_settings.
INSERT INTO system_settings (key, value, description)
VALUES ('mapbox_token', '', 'Mapbox GL JS access token (用于数字城市面板)')
ON CONFLICT (key) DO NOTHING;
