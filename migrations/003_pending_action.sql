-- 003_pending_action.sql — explicit pending customer decisions (R01/R09).
ALTER TABLE cases ADD COLUMN IF NOT EXISTS pending_action JSONB NULL;
