-- Armory Notes 2.4.0: bonus items seen in the faction armory (for the spreadsheet).
-- Run once in the D1 console, or:
--   npx wrangler d1 execute torn-armory-notes --remote --file=migrations/0003_tracked_items.sql
CREATE TABLE IF NOT EXISTS tracked_items (
    armory_id    TEXT    PRIMARY KEY,
    item_name    TEXT    NOT NULL DEFAULT '',
    item_id      TEXT    NOT NULL DEFAULT '',
    category     TEXT    NOT NULL DEFAULT '',
    fingerprint  TEXT    NOT NULL DEFAULT '',
    bonuses      TEXT    NOT NULL DEFAULT '',
    first_seen   INTEGER NOT NULL,
    last_seen    INTEGER NOT NULL,
    seen_by_id   INTEGER NOT NULL DEFAULT 0,
    seen_by_name TEXT    NOT NULL DEFAULT ''
);
