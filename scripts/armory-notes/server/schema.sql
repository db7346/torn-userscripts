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
    deleted         INTEGER NOT NULL DEFAULT 0,
    fingerprint     TEXT    NOT NULL DEFAULT '',   -- item stats ("w|name|dmg|acc"), matches items with no ID on the page
    changed_at      INTEGER NOT NULL DEFAULT 0,    -- epoch ms of any change (sync marker); updated_at = last edit
    bonuses         TEXT    NOT NULL DEFAULT ''    -- readable bonus text, e.g. "22% Execute" (for the CSV export)
);

CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes (updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_changed_at ON notes (changed_at);

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

-- Weapons/armor with a bonus seen in the faction armory by an editor's browser.
-- Not notes: nothing shows in game for these. They list every bonus item in the
-- spreadsheet export, with a blank label until someone adds a note.
CREATE TABLE IF NOT EXISTS tracked_items (
    armory_id    TEXT    PRIMARY KEY,
    item_name    TEXT    NOT NULL DEFAULT '',
    item_id      TEXT    NOT NULL DEFAULT '',
    category     TEXT    NOT NULL DEFAULT '',      -- Primary | Secondary | Melee | Defensive
    fingerprint  TEXT    NOT NULL DEFAULT '',
    bonuses      TEXT    NOT NULL DEFAULT '',      -- e.g. "22% Execute"
    first_seen   INTEGER NOT NULL,                 -- epoch ms
    last_seen    INTEGER NOT NULL,                 -- epoch ms
    seen_by_id   INTEGER NOT NULL DEFAULT 0,
    seen_by_name TEXT    NOT NULL DEFAULT '',
    in_armory    INTEGER NOT NULL DEFAULT 1,       -- 0 once the armory sync no longer finds it
    missing_since INTEGER,                          -- epoch ms it was first found gone
    loaned_to    TEXT    NOT NULL DEFAULT '',      -- from the armory sync
    loaned_to_id INTEGER NOT NULL DEFAULT 0
);

-- Trades logged by editors ("Log This As Traded" on the trade page).
-- Only weapons/armor with a bonus that are armory items or have a faction note.
CREATE TABLE IF NOT EXISTS trade_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id       TEXT    NOT NULL,
    armory_id      TEXT    NOT NULL,
    item_name      TEXT    NOT NULL DEFAULT '',
    from_name      TEXT    NOT NULL DEFAULT '',
    to_name        TEXT    NOT NULL DEFAULT '',
    logged_at      INTEGER NOT NULL,               -- epoch ms
    logged_by_id   INTEGER NOT NULL,
    logged_by_name TEXT    NOT NULL DEFAULT '',
    UNIQUE (trade_id, armory_id)
);
CREATE INDEX IF NOT EXISTS idx_trade_log_item ON trade_log (armory_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_trade_log_at ON trade_log (logged_at);

-- Armory sync bookkeeping (last_run, last_ok, last_error, last_error_at, summary).
CREATE TABLE IF NOT EXISTS sync_state (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL DEFAULT ''
);
