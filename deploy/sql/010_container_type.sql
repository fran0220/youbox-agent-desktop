-- 010: Add container_type to containers table
-- Supports: 'vm-agent' (default, existing) | 'openclaw' (new cloud agent)

ALTER TABLE containers
  ADD COLUMN IF NOT EXISTS container_type text NOT NULL DEFAULT 'vm-agent';

COMMENT ON COLUMN containers.container_type IS 'Agent backend type: vm-agent or openclaw';
