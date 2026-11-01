-- Torn Armory Notes: D1 schema
-- Run once in the Cloudflare D1 console (or: npx wrangler d1 execute torn-armory-notes --remote --file=schema.sql).
-- Safe to re-run: every statement is IF NOT EXISTS.

-- One row per faction armory item. Deleted notes stay as tombstones (deleted = 1)
-- so clients polling with ?since= learn about deletions.
CREATE TABLE IF NOT EXISTS notes (
    armory_id       TEXT    PRIMARY KEY,           -- Torn armory ID (digits)
    label           TEXT    NOT NULL DEFAULT '',
    color           TEXT    NOT NULL DEFAULT 'blue',
    text            TEXT    NOT NULL DEFAULT '',
    item_name       TEXT    NOT NULL DEFAULT '',
    item_id         TEXT    NOT NULL DEFAULT '',
    updated_at      INTEGER NOT NULL,              -- epoch ms, set by the server
    updated_by_id   INTEGER NOT NULL,              -- Torn player ID of the editor
    updated_by_name TEXT    NOT NULL DEFAULT '',
    deleted         INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes (updated_at);

-- Append-only change log (every create / update / delete / import).
-- Not shown in the script yet; kept so history and revert can be added later.
CREATE TABLE IF NOT EXISTS note_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    armory_id TEXT    NOT NULL,
    action    TEXT    NOT NULL,                    -- 'upsert' | 'delete' | 'import'
    label     TEXT,
    color     TEXT,
    text      TEXT,
    at        INTEGER NOT NULL,                    -- epoch ms
    by_id     INTEGER NOT NULL,
    by_name   TEXT
);

CREATE INDEX IF NOT EXISTS idx_note_log_item ON note_log (armory_id, at);
