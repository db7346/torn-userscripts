-- Armory Notes 2.2.0: item fingerprints + separate sync marker.
-- For databases created before 2.2.0 (new installs get these from schema.sql).
-- Run once in the D1 console, or:
--   npx wrangler d1 execute torn-armory-notes --remote --file=migrations/0001_fingerprint.sql
ALTER TABLE notes ADD COLUMN fingerprint TEXT NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN changed_at INTEGER NOT NULL DEFAULT 0;
UPDATE notes SET changed_at = updated_at WHERE changed_at = 0;
CREATE INDEX IF NOT EXISTS idx_notes_changed_at ON notes (changed_at);
