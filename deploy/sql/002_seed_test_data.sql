-- JAcoworks Test Seed Data
-- Run AFTER 001_init_business_tables.sql

-- Seed admin user (local test password hash only; do not run seed data in production)
INSERT INTO users (name, email, password_hash, role)
VALUES ('Admin', 'admin@jacoworks.local', '$2a$10$MsFAEiTNH4m6b.TZox1TH.rIpES7Ixu7Gmu6uhLk/aWq54Fgb33vG', 'admin')
ON CONFLICT (email) DO NOTHING;

-- Test activation code: JACO-TEST-2026
-- Role: admin (so the test user can access admin APIs)
-- Max uses: 10 (for repeated testing)
-- No expiration
INSERT INTO invite_codes (code, role, max_uses, used_count, created_by, note)
VALUES ('JACO-TEST-2026', 'admin', 10, 0, 'system', '测试激活码 - 仅供开发测试使用')
ON CONFLICT (code) DO NOTHING;

-- A regular user test code
INSERT INTO invite_codes (code, role, max_uses, used_count, created_by, note)
VALUES ('JACO-USER-2026', 'user', 5, 0, 'system', '普通用户测试激活码')
ON CONFLICT (code) DO NOTHING;
