# Torn Armory Notes

Attach a colored label and a private note to individual weapons and armor. Notes are tied to each item's unique armory ID, so a note stays with that exact MP5k (not every MP5k) as it moves between your inventory and the faction armory.

**[Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/armory-notes/armory-notes.user.js)** (requires [Tampermonkey](https://www.tampermonkey.net/))

## Features

- A tag button next to every Primary, Secondary, Melee and Armor item
- Click it to add a short label (up to 16 characters), pick one of 8 colors, and write a note (up to 1,000 characters)
- The label shows as a colored pill; hover it to read the full note
- Works on the **Items page** (rows and thumbnail views) and the **Faction Armory** (Weapons and Armor tabs)
- Label autocomplete from labels you've already used
- Backup and restore through the Tampermonkey menu

## Setup

None. Install the script and open your Items page or Faction Armory. No API key is needed.

### Editing a note

- Click the tag (or an existing label) to open the editor.
- **Enter** in the label field or **Ctrl+Enter** anywhere saves. **Esc** cancels.
- Clear both the label and the note (or click **Delete**) to remove it.

## Backups

Notes live only in this browser's Tampermonkey storage. Use the Tampermonkey menu to keep a backup:

| Menu command | What it does |
|---|---|
| Export notes (backup) | Downloads `torn-armory-notes-YYYY-MM-DD.json` |
| Import notes (restore) | Pick a backup, then **Merge** (newer note wins per item) or **Replace all** |
| Clear all notes | Deletes every note (offers to export first) |

## API usage

None. This script makes no API calls and no network requests of any kind.

### API key usage disclosure

| | |
|---|---|
| Data storage | Your labels and notes, only locally in your browser (Tampermonkey storage) |
| Data sharing | None |
| Purpose of use | Personal annotation of your own and your faction's items |
| Key storage & sharing | Not applicable; no key is used |
| Key access level | None |

## Known limitations

- Notes are per browser. Use Export/Import to move them to another browser or computer.
- In the Faction Armory, a long item name truncates to make room for the label pill.
- The faction Deposit list is not covered (it has no armory IDs in its markup).
- Faction rows are classified by the text of the "Type" column. If Torn renames those values, buttons there disappear until the script is updated.

## Changelog

- **1.0.0**: Initial release. Labels and notes per armory ID on the Items page (rows and thumbnails) and Faction Armory, with JSON export, import (merge or replace) and clear all.
