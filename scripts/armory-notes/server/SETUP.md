# Faction notes server: setup

This sets up the small server that stores your faction's shared armory notes. It runs on Cloudflare's free plan: a **Worker** (the code in this folder) and a **D1** database. You do this once, as the faction's notes admin. Members just install the script and enter a Public API key.

Time needed: about 15 minutes.

## How it works

- Each member enters a **Public** Torn API key with **Sign in** in the Tampermonkey menu.
- About once every 12 hours the script sends that key to your Worker. The Worker makes one Torn API call (`user` with `basic,faction`) to learn who the member is and which faction they're in, then forgets the key. If they're in your faction, it returns a signed session token.
- Everyone in the faction can read notes. Only editors can change them. The notes admin (`ADMIN_ID`) picks editors in the script (**Tampermonkey menu > Editor tools… > Manage editors**). The list is checked on every change, so removing someone takes effect immediately.
- Nobody can pretend to be the admin: the admin's player ID comes from Torn at sign-in (from their own API key) inside a token signed with `TOKEN_SECRET`, and `ADMIN_ID` can only be changed in your Cloudflare account.
- Every change is also written to a history table (`note_log`), so mistakes can be undone by hand.

## 1. Create the database

1. Sign up or log in at [dash.cloudflare.com](https://dash.cloudflare.com) (the free plan is enough).
2. Go to **Storage & Databases > D1 SQL Database > Create database**.
3. Name it `torn-armory-notes` and create it.
4. Open the database's **Console** tab, paste the whole of [`schema.sql`](schema.sql), and click **Execute**.
5. Copy the **Database ID** from the database's overview page.

## 2. Put the database ID in `wrangler.toml`

1. In GitHub, open [`scripts/armory-notes/server/wrangler.toml`](wrangler.toml) and click the pencil (edit).
2. Replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with the ID you copied.
3. Commit the change.

The database ID is not a secret. Without access to your Cloudflare account, nobody can use it.

## 3. Connect the Worker to GitHub

1. In Cloudflare, go to **Workers & Pages > Create > Import a repository**.
2. Connect GitHub if asked, and pick `db7346/torn-userscripts`.
3. Use these settings:

   | Setting | Value |
   |---|---|
   | Project name | `torn-armory-notes` (must match `name` in `wrangler.toml`) |
   | Root directory | `scripts/armory-notes/server` |
   | Build command | *(leave empty)* |
   | Deploy command | `npx wrangler deploy` |

4. Click **Save and Deploy**.
5. Optional: under the Worker's **Settings > Build > Build watch paths**, set the include path to `scripts/armory-notes/server/*`. Pushes that only change other scripts then won't redeploy the server.

From now on, every push to `main` that touches the server folder redeploys it automatically.

## 4. Add the settings

Go to the Worker's **Settings > Variables and Secrets** and add these three:

| Name | Type | Value |
|---|---|---|
| `FACTION_ID` | Text | Your faction's ID (the number in your faction's profile URL) |
| `ADMIN_ID` | Text | Your own player ID. You manage editors from the script and are always an editor. |
| `TOKEN_SECRET` | **Secret** | A long random string (32+ characters) |

For `TOKEN_SECRET`, use a password manager's generator. Or open your browser's console (F12) on any page, run `crypto.randomUUID() + crypto.randomUUID()`, and paste the result. You never need to type it again.

Click **Deploy** after adding them.

These values live only in Cloudflare, never in the public repo. `keep_vars = true` in `wrangler.toml` stops GitHub deploys from wiping them.

## 5. Check it's running

Open your Worker URL, shown on the Worker's overview page (for example `https://torn-armory-notes.<your-subdomain>.workers.dev`). You should see:

```json
{"ok":true,"service":"torn-armory-notes"}
```

## 6. Point the script at your server

In `armory-notes.user.js`, set `DEFAULT_SERVER_URL` in CONFIG to your Worker URL. Bump `@version` and push. Members' Tampermonkey updates automatically, and they only need to enter their key. (The URL is built in; members can't change it.)

The script's `@connect workers.dev` already covers `*.workers.dev`. If you later move the Worker to your own domain, add `// @connect yourdomain.com` to the script header.

## 7. First sign-in (verify in game)

1. Open your Faction Armory. The **Sign in** popup opens on the first visit.
2. Enter your Public key and click **Save & sign in**.
3. You should see "Signed in as YourName [ID] · Role: admin" (or "editor" if `ADMIN_ID` is not set yet).

This also confirms that Torn's API answers requests from Cloudflare. If sign-in fails with "Could not reach the Torn API", check the Worker's **Logs** tab and tell the script author.

Then use **Tampermonkey menu > Editor tools… > Upload local notes** to move your existing notes over.

## Updating an existing server

Some releases change the database. Run each new file in [`migrations/`](migrations/) once, in order, in the D1 **Console** (paste and Execute), **before** pushing the release:

| File | Release | What it does |
|---|---|---|
| `0001_fingerprint.sql` | 2.2.0 | Adds item fingerprints (for matching the other person's trade items) and a separate sync marker |
| `0002_bonuses.sql` | 2.3.0 | Adds readable bonus text ("22% Execute") for the spreadsheet export |
| `0003_tracked_items.sql` | 2.4.0 | Adds the list of bonus items seen in the faction armory, for the spreadsheet |
| `0004_trade_log.sql` | 2.5.0 | Adds the trade log ("Log This As Traded") |
| `0005_armory_sync.sql` | 2.6.0 | Adds armory status, "missing since", loans, and sync bookkeeping |
| `0006_editors.sql` | 2.7.0 | Adds the editor list managed by the admin. Also add the `ADMIN_ID` variable (your player ID). An existing `EDITOR_IDS` list is copied in automatically the first time; after that `EDITOR_IDS` is unused and can be deleted. |
| `0007_borrowed_sold.sql` | 2.9.0 | Adds borrowed items and sold / removed marks |

New databases created from `schema.sql` already include every migration.

When a server change needs a newer script, raise `MIN_SCRIPT_VERSION` in `worker.js`. Members on an older script then see an update notice with a link, at most once a day (scripts from 2.8.0 on).

## Live spreadsheet (optional)

The server can publish the live faction notes as a spreadsheet feed for Google Sheets. It's off until you set a token.

1. In the Worker's **Settings > Runtime variables and secrets**, add a **Secret** named `EXPORT_TOKEN` with a long random value (32+ characters, same method as `TOKEN_SECRET`). Click **Deploy**.
2. Create a Google Sheet. In cell **A1**, enter:

   ```
   =IMPORTDATA("https://torn-armory-notes.<your-subdomain>.workers.dev/export.csv?token=YOUR_EXPORT_TOKEN")
   ```

3. Share the sheet with whoever should see it.

Google refreshes it about once an hour, and when the sheet is opened.

The sheet lists every weapon and armor piece **with a bonus** that an editor's browser has seen in the Faction Armory (Source: **Armory**), then any bonus item that has a faction note but was never seen in the armory (Source: **Not in armory**). Items without a note have a blank label until someone adds one. Items without a bonus are never listed.

For separate tabs, use `&type=weapons` and `&type=armor` on the export link (one `IMPORTDATA` per tab). Without `type`, everything is in one list.

| Column | |
|---|---|
| Item, Category | The item (Category on the weapons/all export only) |
| Status | **In armory**, **Traded to X** (gone, with a logged trade), **Returned to X (not deposited)** (an editor logged receiving it but hasn't put it back in the armory yet), **Missing since …** (gone, no logged trade), or **Not in armory** (a faction note on an item never seen in the armory) |
| Loaned to | Who the item is loaned to (needs the armory sync) |
| Label, Note, Color, Armory ID | The faction note, if any |
| Damage, Accuracy / Defence, Bonuses | The item's stats, recorded automatically by editors' browsers |
| Last edited by / (TCT) | Who changed the note last, and when (Torn City Time) |
| Previous edit by / (TCT) | The change before that (blank if there was only one) |
| Last trade, Last trade (TCT), Trade logged by | The latest trade an editor logged for this item ("Traded to ChaosRipper"), when, and who logged it |

### Logging trades

Editors see a **Log This As Traded** checkbox in the "This trade expires…" bar on a trade. Ticking it logs that trade's bonus weapons and armor that are armory items or have a faction note: yours as "Traded to <them>", theirs (matched by stats) as "Traded to <you>". Other items are ignored. While an item you received is still out of the armory, its Status reads **Returned to <you> (not deposited)**; the next armory sync after you deposit it changes that to **In armory**. Untick it to remove the log.

### Borrowed, sold and removed items

- **Borrowed:** when someone lends items to the faction, an editor ticks **Borrowed from <lender>** in the trade's "This trade expires" bar. Items the server hasn't seen yet are matched by their stats when they reach the armory (within 7 days). One-off items: fill **Borrowed from** in the note editor. While borrowed items are in the armory their status is **In armory · Borrowed from X**; once they go back they are hidden (not "Missing"), and they come back with their label, note and owner.
- **Sold / removed:** **Editor tools… > Missing items** lists items that left without a logged trade. Tick them and choose **Mark sold**, **Mark removed** or **Returned to owner**. If a sold or removed item ever comes back to the armory, its status returns to **In armory** by itself.

To fix a mistake later, use **Tampermonkey menu > Editor tools… > Trade log**: it lists recent logged trades with a **Remove** button per item and per trade. The sheet itself is read-only (Google re-imports it), so make corrections there, not in the sheet.

**Keep the link private.** Anyone with it, or anyone who can see the formula in the sheet, can read every faction note. If it leaks, change `EXPORT_TOKEN`, click Deploy, and update the formula; the old link stops working immediately.

## Armory sync (optional, recommended)

Reads the **whole** faction armory from the Torn API every 6 hours, so the sheet and view page list every bonus weapon and armor piece (not only the pages an editor opened), with exact **Status** (In armory / Traded to X / Missing since …) and **Loaned to**.

It needs **one Limited API key of the notes admin's own**, from a player with **faction API access** (set in your faction's settings). That key is stored on the server; members' keys never are.

1. Create a key in Torn (Settings > API Keys) with **Limited** access. Name it "Armory Notes sync".
2. In the Worker's **Settings > Runtime variables and secrets**, add a **Secret** named `ARMORY_API_KEY` with that key, then click **Deploy**.
3. Because a dashboard change can bring back older code, open **Deployments** and use **Retry build** on the newest GitHub commit.
4. In Torn, use **Tampermonkey menu > Editor tools… > Sync armory now** for the first run. After that it runs every 6 hours by itself, and about 15 minutes after an editor logs or removes a trade (`[triggers]` in `wrangler.toml`).

If the sync fails (for example the key was deleted or lost faction API access) or hasn't worked for 12 hours, editors see a warning when they open the Faction Armory.

Each sync makes about 2 to 4 inventory calls plus 1 call per 25 *new* items (stats never change, so known items are not looked up again), all tagged `comment=ArmoryNotes`. The 15-minute check makes no calls unless a trade was logged. **Manage editors** reads the faction member list (`faction/members`, Public) with the same key, at most once every 12 hours unless you click **Reload member list**. Torn errors (for example a missing faction API access) show on the view page and in the sync notice.

## Shareable web page (optional)

A read-only page with the same list, served by your Worker, so no Google account is involved and nothing is cached.
It has a dark theme, colored labels, search, filters, sorting, and columns each viewer can drag into their own order. Editor names stay hidden until a row is clicked.

1. In the Worker's **Settings > Runtime variables and secrets**, add a **Secret** named `VIEW_TOKEN` with a long random value (32+ characters). **Copy it first**: Cloudflare won't show it again. Click **Deploy**.
2. Share this link (with your token):

   ```
   https://torn-armory-notes.<your-subdomain>.workers.dev/view?key=YOUR_VIEW_TOKEN
   ```

Anyone with the link can view the list. To revoke it, change `VIEW_TOKEN` and click Deploy; the old link stops working at once. The "hidden" editor names are only tucked away on screen: they are still in the page data.

## Day-to-day

| Task | How |
|---|---|
| Add or remove an editor | **Tampermonkey menu > Editor tools… > Manage editors**. Takes effect immediately. |
| Change the admin | Change `ADMIN_ID` in **Settings > Variables and Secrets**, click **Deploy**, then **Retry build** on the latest commit. |
| Force everyone to sign in again | Change `TOKEN_SECRET`. Scripts re-sign-in automatically with their stored key. |
| See who changed what | D1 **Console**: `SELECT * FROM note_log ORDER BY at DESC LIMIT 50;` |
| Undo a bad edit | Find the old values in `note_log`, then re-enter them in the armory. |
| Restore the whole database | D1 **Time Travel** restores the database to an earlier point (7 days back on the free plan, 30 on paid). |
| Back up | `npx wrangler d1 export torn-armory-notes --remote --output=backup.sql` |

## Costs and limits

The free plan includes 100,000 Worker requests a day and millions of D1 reads. Each member with the Faction Armory open and visible makes about 1.3 requests a minute, and none otherwise. A 100-member faction stays far below the limits.

## Troubleshooting

| Message in the script | Meaning |
|---|---|
| Server is missing FACTION_ID / TOKEN_SECRET | Step 4 is incomplete, or `TOKEN_SECRET` is shorter than 16 characters. |
| Server is missing the DB (D1) binding | The `database_id` in `wrangler.toml` is wrong, or step 2 wasn't committed. |
| Faction notes are only available to members of this faction | Wrong `FACTION_ID`, or the player isn't in the faction. |
| You are not allowed to edit faction notes | They aren't an editor. Add them with **Editor tools… > Manage editors**. |
| No admin is set on the server | Add the `ADMIN_ID` variable (step 4). |
| Only the notes admin can manage editors | You're signed in as someone other than `ADMIN_ID`. |
| Incorrect API key | The member's key is wrong or was deleted. They re-enter it with **Sign in**. |
| Faction notes server error (HTTP 404) | Wrong `DEFAULT_SERVER_URL` built into the script (step 6). |
