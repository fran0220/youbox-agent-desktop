-- Add VNC port for per-user desktop VM access
ALTER TABLE containers ADD COLUMN IF NOT EXISTS vnc_port INTEGER;
COMMENT ON COLUMN containers.vnc_port IS 'Host-side noVNC websockify port mapped to VM internal :6080';
