-- Armory Notes 2.6.0: whole-armory sync (status, missing, loans).
-- Run once in the D1 console, or:
--   npx wrangler d1 execute torn-armory-notes --remote --file=migrations/0005_armory_sync.sql
ALTER TABLE tracked_items ADD COLUMN in_armory INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tracked_items ADD COLUMN missing_since INTEGER;
ALTER TABLE tracked_items ADD COLUMN loaned_to TEXT NOT NULL DEFAULT '';
ALTER TABLE tracked_items ADD COLUMN loaned_to_id INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS sync_state (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL DEFAULT ''
);
