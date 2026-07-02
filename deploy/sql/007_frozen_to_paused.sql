-- Migrate container status from LXD 'frozen' to Docker 'paused'
UPDATE containers SET status = 'paused' WHERE status = 'frozen';

-- Update CHECK constraint: replace 'frozen' with 'paused'
ALTER TABLE containers DROP CONSTRAINT IF EXISTS containers_status_check;
ALTER TABLE containers ADD CONSTRAINT containers_status_check
    CHECK (status IN ('running','stopped','paused','creating','error'));
