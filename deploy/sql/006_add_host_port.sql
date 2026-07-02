-- Add host_port column for Docker port mapping
ALTER TABLE containers ADD COLUMN IF NOT EXISTS host_port INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_containers_host_port ON containers (host_port) WHERE host_port IS NOT NULL;
