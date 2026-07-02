-- JAcoworks Full Schema (auth refactor: Go-native auth with Goth)
-- Run against PostgreSQL 17 on Railway

-- Drop Better Auth tables (auth refactor: Goth replaces BA)
DROP TABLE IF EXISTS verification CASCADE;
DROP TABLE IF EXISTS account CASCADE;
DROP TABLE IF EXISTS session CASCADE;
DROP TABLE IF EXISTS "user" CASCADE;

-- 启用扩展
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- Auth tables (managed by Go gateway with Goth)
-- ============================================================

-- 用户表 (replaces BA's "user" table)
CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name            TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT,
    role            TEXT NOT NULL DEFAULT 'user',
    feishu_open_id  TEXT UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 登录会话表 (replaces BA's "session" table)
CREATE TABLE IF NOT EXISTS auth_sessions (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    token           TEXT NOT NULL UNIQUE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at      TIMESTAMPTZ NOT NULL,
    ip_address      TEXT,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Business tables
-- ============================================================

-- 容器映射
CREATE TABLE IF NOT EXISTS containers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,
    container_name  TEXT NOT NULL,
    container_ip    INET,
    container_token TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'stopped'
                    CHECK (status IN ('running','stopped','paused','creating','error')),
    cpu_limit       INT NOT NULL DEFAULT 1,
    memory_mb       INT NOT NULL DEFAULT 1024,
    disk_mb         INT NOT NULL DEFAULT 5120,
    container_type  text        NOT NULL DEFAULT 'vm-agent',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 聊天会话
CREATE TABLE IF NOT EXISTS chat_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,
    title           TEXT NOT NULL DEFAULT '新对话',
    type            TEXT NOT NULL DEFAULT 'chat'
                    CHECK (type IN ('chat','cowork')),
    model           TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    workspace_path  TEXT NOT NULL DEFAULT '',
    messages        JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 激活码
CREATE TABLE IF NOT EXISTS invite_codes (
    code            TEXT PRIMARY KEY,
    role            TEXT NOT NULL DEFAULT 'user',
    max_uses        INT NOT NULL DEFAULT 1,
    used_count      INT NOT NULL DEFAULT 0,
    created_by      TEXT,
    note            TEXT NOT NULL DEFAULT '',
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 激活码使用记录
CREATE TABLE IF NOT EXISTS invite_code_usages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL REFERENCES invite_codes(code) ON DELETE CASCADE,
    user_id         TEXT NOT NULL,
    used_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(code, user_id)
);

-- 审计日志
CREATE TABLE IF NOT EXISTS audit_logs (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         TEXT,
    action          TEXT NOT NULL,
    resource_type   TEXT,
    resource_id     TEXT,
    detail          JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================

-- Auth indexes
CREATE INDEX IF NOT EXISTS idx_users_name ON users(name);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_feishu ON users(feishu_open_id) WHERE feishu_open_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

-- Business indexes
CREATE INDEX IF NOT EXISTS idx_containers_status ON containers(status);
CREATE INDEX IF NOT EXISTS idx_containers_user ON containers(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_containers_user_type ON containers(user_id, container_type);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_type ON chat_sessions(user_id, type);
CREATE INDEX IF NOT EXISTS idx_invite_codes_expires ON invite_codes(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_messages ON chat_sessions USING gin(messages);

-- ============================================================
-- Triggers
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_containers_updated ON containers;
CREATE TRIGGER trg_containers_updated
    BEFORE UPDATE ON containers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_chat_sessions_updated ON chat_sessions;
CREATE TRIGGER trg_chat_sessions_updated
    BEFORE UPDATE ON chat_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
