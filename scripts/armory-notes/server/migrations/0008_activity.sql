-- Armory Notes 2.9.2: activity log (view page "Activity") and faster lookups.
-- Run once in the D1 console, or:
--   npx wrangler d1 execute torn-armory-notes --remote --file=migrations/0008_activity.sql
CREATE TABLE IF NOT EXISTS activity (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         INTEGER NOT NULL,
    kind       TEXT    NOT NULL,
    actor_id   INTEGER NOT NULL DEFAULT 0,
    actor_name TEXT    NOT NULL DEFAULT '',
    armory_id  TEXT    NOT NULL DEFAULT '',
    detail     TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_activity_at ON activity (at);
CREATE INDEX IF NOT EXISTS idx_note_log_at ON note_log (at);
-- The borrowed list is read on every page load: index only the few borrowed rows.
CREATE INDEX IF NOT EXISTS idx_tracked_borrowed ON tracked_items (borrowed_from) WHERE borrowed_from <> '';
