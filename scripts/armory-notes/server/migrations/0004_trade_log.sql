-- Armory Notes 2.5.0: trade log ("Log This As Traded").
-- Run once in the D1 console, or:
--   npx wrangler d1 execute torn-armory-notes --remote --file=migrations/0004_trade_log.sql
CREATE TABLE IF NOT EXISTS trade_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id       TEXT    NOT NULL,
    armory_id      TEXT    NOT NULL,
    item_name      TEXT    NOT NULL DEFAULT '',
    from_name      TEXT    NOT NULL DEFAULT '',
    to_name        TEXT    NOT NULL DEFAULT '',
    logged_at      INTEGER NOT NULL,
    logged_by_id   INTEGER NOT NULL,
    logged_by_name TEXT    NOT NULL DEFAULT '',
    UNIQUE (trade_id, armory_id)
);
CREATE INDEX IF NOT EXISTS idx_trade_log_item ON trade_log (armory_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_trade_log_at ON trade_log (logged_at);
