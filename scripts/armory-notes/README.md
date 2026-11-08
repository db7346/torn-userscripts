# Torn Armory Notes

Attach a colored label and a note to individual weapons and armor. Notes are tied to each item's unique armory ID, so a note stays with that exact MP5k, not every MP5k.

- **Faction notes** (Faction Armory): stored on your faction's own notes server, so every member using the script sees the same notes. Only editors chosen by the notes admin can edit them.
- **Local notes** (Items page): private to you, stored only in this browser.

**[Install](https://raw.githubusercontent.com/db7346/torn-userscripts/release/scripts/armory-notes/armory-notes.user.js)** (requires [Tampermonkey](https://www.tampermonkey.net/))

## Features

- A tag button next to every Primary, Secondary, Melee and Armor item
- Click it to add a short label (up to 16 characters), pick one of 8 colors, and write a note (up to 1,000 characters). **Undo** is offered for 10 seconds after each save or delete.
- The label shows as a colored pill; hover it to read the full note
- **Faction Armory:** shared faction notes, refreshed every 45 seconds while the tab is visible. Hover shows who edited a note last and when. A **filter bar** above the list searches item names, labels and notes, or shows **Tagged only** / **Untagged bonus items** (on the page currently shown).
- **Items page:** your private notes (row and thumbnail views), plus a faction pill (with a people icon) when an item has a faction note. Editors can click it to edit or delete the faction note, which is handy for items in your own inventory; everyone else sees it read-only.
- **Faction Armory > Deposit:** faction notes show read-only on your items, so you can see what you're depositing.
- **Trade pages:** faction notes show read-only on your own items, in the trade view, on the add-items screen and on its confirmation step, and on **the other person's items** in the trade view (matched by the item's stats), so you can see a faction-owned item before you send it
- **Live spreadsheet** (optional, set up by the notes admin): every bonus weapon and armor piece in the Faction Armory, plus every faction note, with stats, bonuses, last edit, previous edit and last seen, in Google Sheets
- Upload your existing local notes to the faction in one step
- Label autocomplete, plus backup and restore of local notes

## Setup

### Members

1. Install the script.
2. Open your Faction Armory. A **Sign in** popup appears the first time.
3. Enter a **Public** API key ([create one](https://www.torn.com/preferences.php#tab=api), "Public Only" access) and click **Save & sign in**.

A short **How it works** guide appears once after you sign in. Open it again any time from the Tampermonkey menu, or with **?** in the note editor.

### Faction notes admin

Set up the server once by following [server/SETUP.md](server/SETUP.md) (Cloudflare free plan, about 15 minutes).

### No server, no key, or not in the faction?

Everything still works. The Faction Armory then uses your private notes, as in version 1. If sign-in fails because the key is wrong or you're not in the faction, the script remembers that and stops trying until you sign in again.

## Editing a note

- Click the tag, or an existing label, to open the editor.
- **Enter** in the label field or **Ctrl+Enter** anywhere saves. **Esc** cancels.
- Clear both the label and the note, or click **Delete**, to remove it.
- In the Faction Armory, only editors see the tag on items without a note. Everyone else sees existing notes read-only.
- On the Items page, editors can edit or delete an existing faction note by clicking its pill. New faction notes are added in the Faction Armory (or with **Editor tools… > Upload local notes**), so nothing is shared by accident.

## Tampermonkey menu

| Command | What it does |
|---|---|
| Sign in | Enter your Public API key, sign in or out, choose whether tag icons show on items without notes, and **Reload faction notes** if they look out of date (deletes nothing) |
| How it works | Short guide with a legend of the icons and pills (and an Editors tab for editors) |
| Refresh faction notes | Fetch the latest faction notes now |
| Editor tools… | Editors only. **Trade log** (logged trades, with Remove buttons), **Sync armory now** (read the whole armory now; it also runs every 6 hours and about 15 minutes after a trade is logged), **Missing items** (mark items that left the armory as sold, removed or returned to their owner, in bulk), **Upload local notes** (move private notes into faction notes; items seen in the armory are pre-ticked, items that already have a faction note are skipped), and for the notes admin **Manage editors** |
| Private notes… | **Export backup** (`torn-armory-notes-YYYY-MM-DD.json`), **Import** (Merge: newer note wins per item, or Replace all), **Clear all** (offers to export first) |

## API usage

The script never calls the Torn API itself. It talks only to your faction's notes server:

| Request | When | Torn API call made by the server |
|---|---|---|
| Sign in (`POST /auth`) | About once every 12 hours | `GET /v2/user?selections=basic,faction` (Public key), tagged `comment=ArmoryNotes` |
| Fetch changes (`GET /notes`) | Every 45 s while the Faction Armory is open and visible; once on Items page load if the cache is over a minute old | None |
| Save, delete, upload | When you click | None |
| Trade check (`POST /trades/:id/check`, editors) | Once per trade page, and again only if the trade's items change | None |

That is about **1 Torn API call per 12 hours**, and about **1.3 server requests a minute** while the armory is open. The script caps itself at 30 server requests a minute and backs off after errors. A bad key or a non-member is checked with Torn only once per page load.

### API key usage disclosure

| | |
|---|---|
| Who runs the server | Your faction's notes admin, on their own Cloudflare account. Its address is built into the script. |
| Data storage | **This browser:** your local notes, your API key, your display choice, a sign-in token and a cache of faction notes. **Faction server (Cloudflare D1):** faction notes with the Torn player ID and name of whoever changed each one, and a change history; the faction armory's bonus weapons and armor (stats, bonuses, who they're loaned to, who lent them to the faction, sold / removed marks); trades logged by editors; and the editor list (player ID, name, who added them). **Your API key is not stored on the server.** |
| Data sharing | Faction notes are visible to members of your faction who use this script, and to anyone the notes admin gives the view page link (a read-only web page of the armory list with notes, who items are loaned to, and who edited them). Nothing is shared with anyone else. |
| Purpose of use | Annotating your own and your faction's items |
| Key storage & sharing | Stored only in Tampermonkey storage. Sent over HTTPS, in the body of the sign-in request (about once every 12 hours), only to your faction's notes server. The server uses it for two Torn API calls (checking the key's access level, and confirming who you are and that you're in the faction), then forgets it. It is never stored, logged or put in a URL. |
| Key access level | **Members: Public** is all that's needed (Minimal, Limited and Custom keys also work; **Full Access keys are refused**). **Notes admin only:** one Limited key of their own, stored as a server secret (`ARMORY_API_KEY`), used for the armory sync (`faction/inventory`, `torn/itemdetails`) every 6 hours and about 15 minutes after a logged trade, and for the faction member list (`faction/members`) in Manage editors. All calls are tagged `comment=ArmoryNotes`. |

## Known limitations

- On the other person's side of a trade, Torn shows no item ID, so notes are matched by **stats**: name + damage + accuracy for weapons, name + defence + bonus for armor. An item is only matched after an editor has seen it with the script (in the armory, on their Items page or in their own trade) since its note was added. If two noted items have identical stats, neither is shown rather than guessing.
- On the trade add-items screen and the Deposit list, the item ID is read from an internal React attribute (`data-reactid`). If Torn updates its page framework, notes stop showing there until the script is updated; everything else keeps working.
- On the Items page, faction notes show in row view only, not thumbnail view.
- Edits are last-write-wins. If two editors change the same note at once, the later save wins; both changes are in the server's history.
- Local notes are per browser. Use Export/Import to move them.
- In the Faction Armory, a long item name truncates to make room for the label pill.
- The armory filter only searches the page Torn is showing; items on other armory pages are not searched (use the view page for the whole armory).
- Faction rows are classified by the text of the "Type" column. If Torn renames those values, buttons there disappear until the script is updated.

## Changelog

- **2.9.3**: **How it works** explains borrowed items (with a sample of the trade box) and Missing items; long dialogs scroll on small screens; the note editor's field is now just "Borrowed from". View page: TNL banner and title, shorter header.
- **2.9.2**: Security update. Script updates now come from the **release** branch, so members only get versions that were published on purpose. The script can only contact your faction's own server. **Full Access keys are refused** at sign-in. Editors can only log trades they're part of. Server: a small **Activity** panel on the view page (notes, trades, borrowed and sold marks, editor changes, syncs; last 90 days) and a faster borrowed-items lookup. Needs migration `0008_activity.sql`.
- **2.9.1**: Faction Armory **Deposit** list shows faction notes (read-only) on your items.
- **2.9.0**: **Borrowed items:** editors tick **Borrowed from <lender>** on the lender's trade (or fill **Borrowed from** in the note editor). When the items go back they're hidden instead of "Missing", and they come back with their tags. **Editor tools… > Missing items** marks items **sold**, **removed** or **returned to owner**, many at once. Tooltips show "Borrowed from". The view page gets **Borrowed** and **Sold / removed** status filters. Needs migration `0007_borrowed_sold.sql`. Older scripts now see the update notice.
- **2.8.3**: API key disclosure brought up to date: who runs the server, everything the server stores, the admin's Limited key, and the view page link. No change to how the script works.
- **2.8.2**: Tampermonkey menu trimmed to five items: **Sign in**, **How it works**, **Refresh faction notes**, **Editor tools…** (editors only) and **Private notes…**. **Reload faction notes** moved into Sign in. **How it works** redesigned: wider, with a legend of the real icons and pills, and an Editors tab.
- **Server update (no script change)**: view page Bonuses column sorts A→Z by bonus name (highest % first within the same bonus); **Sort by stat** gains **Bonus %**.
- **2.8.1**: **Sign in** replaces Settings: the faction's server is built in, so the popup only asks for your API key, plus a switch to hide tag icons on items without notes (they then appear when you hover an item). The note editor can't get stuck on "Saving…" any more: Close always works, and after 20 seconds without a reply the form is released with an explanation. The editor shows "Saved ✓" when done, and **Undo** is offered for 10 seconds after saving or deleting a note. A one-time **How it works** guide (also in the Tampermonkey menu and behind **?** in the note editor).
- **2.8.0**: Filter bar above the Faction Armory list (everyone). Editors: **Log This As Traded** is highlighted, with a count, when a trade holds faction items that aren't logged yet. Scripts older than the version the faction's server needs show an update notice with a link, at most once a day.
- **2.7.0**: **Manage editors (admin)**: the notes admin (set once as `ADMIN_ID` on the server) adds and removes editors from the script, no Cloudflare visit needed. Editors on the Faction Armory get a warning when the armory sync failed or is more than 12 hours old. The server re-syncs the armory about 15 minutes after a trade is logged or removed. Needs migration `0006_editors.sql` and the `ADMIN_ID` variable.
- **2.6.2**: Menu item **Clear faction notes cache** renamed to **Reload faction notes (fix stale data)**, since it deletes nothing.
- **Server update (no script change)**: view page shows Damage/Accuracy (Defence for armor) as small DMG/ACC/DEF chips beside the item name instead of separate columns, with a **Sort by stat** menu (high→low or low→high).
- **Server update (no script change)**: view page columns can be dragged into any order (Item stays first). Each viewer's order is saved in their own browser; **Reset columns** restores the default.
- **Server update (no script change)**: an item an editor logged as received, but not yet deposited, now shows **Returned to <editor> (not deposited)** instead of "Traded to <editor>" (yellow on the view page, new status filter).
- **2.6.1**: Clicking **Sync armory now** again within 5 minutes shows a plain "results are already current" notice instead of an error.
- **2.6.0**: Armory sync: the faction's server can read the whole armory from the Torn API every 6 hours (notes admin's own Limited key, see SETUP.md), giving exact **Status** (In armory / Traded to X / Missing since …) and **Loaned to**. Weapons and armor are separate tabs on the view page and separate exports (`&type=weapons` / `&type=armor`). New menu item **Sync armory now (editors)**. Needs migration `0005_armory_sync.sql`.
- **Server update (no script change)**: shareable read-only web page at `/view?key=…` (needs the `VIEW_TOKEN` secret, see SETUP.md), with search, filters, sorting and click-to-show editor history.
- **2.5.0**: Editors get a **Log This As Traded** checkbox on trades, which logs the trade's bonus armory items for the spreadsheet ("Traded to …"); untick to undo. Tampermonkey menu **Trade log (editors)** lists logged trades with Remove buttons. Sheet: new Source column (Armory / Not in armory) and Last trade columns in place of Last seen; only bonus items are listed. Needs migration `0004_trade_log.sql`.
- **2.4.0**: Editors' browsers record every weapon and armor piece with a bonus seen in the Faction Armory (name, stats, bonuses, last seen) for the faction's spreadsheet, with a blank label until someone adds a note. Nothing changes in game. Needs migration `0003_tracked_items.sql`.
- **2.3.0**: Editors' browsers also record each noted item's bonuses ("22% Execute"). The server can publish a live spreadsheet feed of faction notes, with stats, bonuses, last edit and previous edit, for Google Sheets (see SETUP.md). Needs migration `0002_bonuses.sql`.
- **2.2.0**: Trade view shows faction notes on the other person's items too, matched by item stats ("fingerprint"), since Torn shows no ID for them. Editors' browsers record fingerprints automatically from the armory, Items page and their own trades. Needs the server update in this release and the `migrations/0001_fingerprint.sql` database change (see SETUP.md).
- **2.1.1**: Trade add-items confirmation step ("Are you sure you wish to add…") now shows faction notes too.
- **2.1.0**: Trade pages. Faction notes show read-only (for everyone, editors included) on your own items in the trade view and on the add-items screen. No polling there: at most one refresh per page load.
- **2.0.2**: Fixes: saving a faction note no longer hides another editor's change made moments earlier; without a key, or outside the faction, the Faction Armory falls back to private notes instead of showing nothing; clearing the cache during a refresh no longer loses notes; an upload that fails partway reports what was moved; uploads are split by size; refreshes only redraw notes that changed. The server rejects oversized requests before reading them.
- **2.0.1**: Editors can edit or delete faction notes from the Items page by clicking the faction pill (for items in your own inventory). The faction's server URL is now built in.
- **2.0.0**: Shared faction notes. Faction Armory notes are stored on a faction-run Cloudflare server and refresh every 45 s while visible, with editors-only editing and "last edited by". Adds the Settings panel (server URL + Public key), uploading (moving) local notes to the faction, and read-only faction pills on the Items page. Menu commands for local notes are renamed "local".
- **1.0.0**: Initial release. Labels and notes per armory ID on the Items page (rows and thumbnails) and Faction Armory, with JSON export, import (merge or replace) and clear all.
