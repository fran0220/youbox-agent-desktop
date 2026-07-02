-- Drop the UNIQUE constraint on users.name
-- Feishu SSO users can have duplicate display names (e.g. two people named "张帆")
-- The UNIQUE index causes create_user_failed during SSO login when names collide
DROP INDEX IF EXISTS idx_users_name;
CREATE INDEX IF NOT EXISTS idx_users_name ON users(name);
