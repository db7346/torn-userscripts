-- Armory Notes 2.7.0: editors managed by the admin from the script.
-- Run once in the D1 console, or:
--   npx wrangler d1 execute torn-armory-notes --remote --file=migrations/0006_editors.sql
-- The server copies EDITOR_IDS into this table automatically the first time.
CREATE TABLE IF NOT EXISTS editors (
    player_id     INTEGER PRIMARY KEY,
    player_name   TEXT NOT NULL DEFAULT '',
    added_by_id   INTEGER NOT NULL DEFAULT 0,
    added_by_name TEXT NOT NULL DEFAULT '',
    added_at      INTEGER NOT NULL DEFAULT 0
);
