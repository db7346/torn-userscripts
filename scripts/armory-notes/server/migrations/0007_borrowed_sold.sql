-- Armory Notes 2.9.0: borrowed items (hidden while returned) and sold/removed marks.
-- Run once in the D1 console, or:
--   npx wrangler d1 execute torn-armory-notes --remote --file=migrations/0007_borrowed_sold.sql
ALTER TABLE tracked_items ADD COLUMN borrowed_from TEXT NOT NULL DEFAULT '';
ALTER TABLE tracked_items ADD COLUMN borrowed_at INTEGER;
ALTER TABLE tracked_items ADD COLUMN borrowed_by_name TEXT NOT NULL DEFAULT '';
ALTER TABLE tracked_items ADD COLUMN borrowed_trade_id TEXT NOT NULL DEFAULT '';
ALTER TABLE tracked_items ADD COLUMN disposition TEXT NOT NULL DEFAULT '';
ALTER TABLE tracked_items ADD COLUMN disposition_at INTEGER;
ALTER TABLE tracked_items ADD COLUMN disposition_by_name TEXT NOT NULL DEFAULT '';
-- Borrowed marks for items not seen in the armory yet (matched by stats when they arrive).
CREATE TABLE IF NOT EXISTS borrow_pending (
    fingerprint      TEXT PRIMARY KEY,
    borrowed_from    TEXT NOT NULL,
    borrowed_by_name TEXT NOT NULL DEFAULT '',
    trade_id         TEXT NOT NULL DEFAULT '',
    created_at       INTEGER NOT NULL
);
