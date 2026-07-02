-- 011: Change containers unique constraint from user_id to (user_id, container_type)
-- Allows one user to have both vm-agent and openclaw containers simultaneously.

ALTER TABLE containers
  DROP CONSTRAINT IF EXISTS containers_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_containers_user_type
  ON containers (user_id, container_type);
