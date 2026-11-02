-- Armory Notes 2.3.0: readable bonus text for the spreadsheet export.
-- Run once in the D1 console, or:
--   npx wrangler d1 execute torn-armory-notes --remote --file=migrations/0002_bonuses.sql
ALTER TABLE notes ADD COLUMN bonuses TEXT NOT NULL DEFAULT '';
