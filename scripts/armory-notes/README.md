# Torn Armory Notes

Attach a colored label and a note to individual weapons and armor. Notes are tied to each item's unique armory ID, so a note stays with that exact MP5k, not every MP5k.

- **Faction notes** (Faction Armory): stored on your faction's own notes server, so every member using the script sees the same notes. Only chosen members can edit them.
- **Local notes** (Items page): private to you, stored only in this browser.

**[Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/armory-notes/armory-notes.user.js)** (requires [Tampermonkey](https://www.tampermonkey.net/))

## Features

- A tag button next to every Primary, Secondary, Melee and Armor item
- Click it to add a short label (up to 16 characters), pick one of 8 colors, and write a note (up to 1,000 characters)
- The label shows as a colored pill; hover it to read the full note
- **Faction Armory:** shared faction notes, refreshed every 45 seconds while the tab is visible. Hover shows who edited a note last and when.
- **Items page:** your private notes (row and thumbnail views), plus a faction pill (with a people icon) when an item has a faction note. Editors can click it to edit or delete the faction note, which is handy for items in your own inventory; everyone else sees it read-only.
- **Trade pages:** faction notes show read-only on your own items, both in the trade view and on the add-items screen, so you can see a faction-owned item before you send it
- Upload your existing local notes to the faction in one step
- Label autocomplete, plus backup and restore of local notes

## Setup

### Members

1. Install the script.
2. Open your Faction Armory. A Settings dialog appears the first time.
3. Enter a **Public** API key ([create one](https://www.torn.com/preferences.php#tab=api), "Public Only" access) and click **Save & sign in**.

The server URL is already filled in. If it's empty, ask your faction's notes admin for it.

### Faction notes admin

Set up the server once by following [server/SETUP.md](server/SETUP.md) (Cloudflare free plan, about 15 minutes).

### No server, no key, or not in the faction?

Everything still works. The Faction Armory then uses your private notes, as in version 1. If sign-in fails because the key is wrong or you're not in the faction, the script remembers that and stops trying until you change Settings.

## Editing a note

- Click the tag, or an existing label, to open the editor.
- **Enter** in the label field or **Ctrl+Enter** anywhere saves. **Esc** cancels.
- Clear both the label and the note, or click **Delete**, to remove it.
- In the Faction Armory, only editors see the tag on items without a note. Everyone else sees existing notes read-only.
- On the Items page, editors can edit or delete an existing faction note by clicking its pill. New faction notes are added in the Faction Armory (or with **Upload local notes to faction**), so nothing is shared by accident.

## Tampermonkey menu

| Command | What it does |
|---|---|
| Settings (faction sharing) | Set the server URL and your API key; sign in or out |
| Refresh faction notes | Fetch the latest faction notes now |
| Upload local notes to faction | Editors only. Pick local notes to move to the faction. Items seen in the faction armory are pre-ticked. Uploaded notes are removed locally, and items that already have a faction note are skipped. |
| Clear faction notes cache | Forget cached faction notes and sign in again |
| Export local notes (backup) | Downloads `torn-armory-notes-YYYY-MM-DD.json` |
| Import local notes (restore) | Pick a backup, then **Merge** (newer note wins per item) or **Replace all** |
| Clear all local notes | Deletes every local note (offers to export first) |

## API usage

The script never calls the Torn API itself. It talks only to your faction's notes server:

| Request | When | Torn API call made by the server |
|---|---|---|
| Sign in (`POST /auth`) | About once every 12 hours | `GET /v2/user?selections=basic,faction` (Public key), tagged `comment=ArmoryNotes` |
| Fetch changes (`GET /notes`) | Every 45 s while the Faction Armory is open and visible; once on Items page load if the cache is over a minute old | None |
| Save, delete, upload | When you click | None |

That is about **1 Torn API call per 12 hours**, and about **1.3 server requests a minute** while the armory is open. The script caps itself at 30 server requests a minute and backs off after errors. A bad key or a non-member is checked with Torn only once per page load.

### API key usage disclosure

| | |
|---|---|
| Data storage | **This browser:** your local notes, your API key, the server URL, a sign-in token and a cache of faction notes. **Faction server (Cloudflare D1):** faction notes, plus the Torn player ID and name of whoever changed each one, and a change history. |
| Data sharing | Faction notes are visible to members of your faction who use this script. Nothing is shared with anyone else. |
| Purpose of use | Annotating your own and your faction's items |
| Key storage & sharing | Stored only in Tampermonkey storage. Sent over HTTPS, in the body of the sign-in request, only to the faction server set in Settings. The server uses it for one Torn API call and does not store or log it. Never put in a URL. |
| Key access level | Public |

## Known limitations

- Trade pages show notes only on **your own** items. Torn's trade page doesn't include an item ID for the other person's items, so their side can't be matched.
- On the trade add-items screen, the item ID is read from an internal React attribute (`data-reactid`). If Torn updates its page framework, notes stop showing there until the script is updated; everything else keeps working.
- On the Items page, faction notes show in row view only, not thumbnail view.
- Edits are last-write-wins. If two editors change the same note at once, the later save wins; both changes are in the server's history.
- Local notes are per browser. Use Export/Import to move them.
- In the Faction Armory, a long item name truncates to make room for the label pill.
- The faction Deposit list is not covered, because its markup has no armory IDs.
- Faction rows are classified by the text of the "Type" column. If Torn renames those values, buttons there disappear until the script is updated.

## Changelog

- **2.1.0**: Trade pages. Faction notes show read-only (for everyone, editors included) on your own items in the trade view and on the add-items screen. No polling there: at most one refresh per page load.
- **2.0.2**: Fixes: saving a faction note no longer hides another editor's change made moments earlier; without a key, or outside the faction, the Faction Armory falls back to private notes instead of showing nothing; clearing the cache during a refresh no longer loses notes; an upload that fails partway reports what was moved; uploads are split by size; refreshes only redraw notes that changed. The server rejects oversized requests before reading them.
- **2.0.1**: Editors can edit or delete faction notes from the Items page by clicking the faction pill (for items in your own inventory). The faction's server URL is now built in.
- **2.0.0**: Shared faction notes. Faction Armory notes are stored on a faction-run Cloudflare server and refresh every 45 s while visible, with editors-only editing and "last edited by". Adds the Settings panel (server URL + Public key), uploading (moving) local notes to the faction, and read-only faction pills on the Items page. Menu commands for local notes are renamed "local".
- **1.0.0**: Initial release. Labels and notes per armory ID on the Items page (rows and thumbnails) and Faction Armory, with JSON export, import (merge or replace) and clear all.
