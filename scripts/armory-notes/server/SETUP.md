# Faction notes server: setup

This sets up the small server that stores your faction's shared armory notes. It runs on Cloudflare's free plan: a **Worker** (the code in this folder) and a **D1** database. You do this once, as the faction's notes admin. Members just install the script and enter a Public API key.

Time needed: about 15 minutes.

## How it works

- Each member enters a **Public** Torn API key in the script's Settings.
- About once every 12 hours the script sends that key to your Worker. The Worker makes one Torn API call (`user` with `basic,faction`) to learn who the member is and which faction they're in, then forgets the key. If they're in your faction, it returns a signed session token.
- Everyone in the faction can read notes. Only player IDs in `EDITOR_IDS` can change them. That list is checked on every change, so removing someone takes effect immediately.
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
| `EDITOR_IDS` | Text | Player IDs allowed to edit, comma-separated, for example `1234567,2345678` |
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

Pick one of these:

- **Recommended:** In `armory-notes.user.js`, set `DEFAULT_SERVER_URL` in CONFIG to your Worker URL. Bump `@version` and push. Members' Tampermonkey updates automatically, and they only need to enter their key.
- **Or:** Each member opens **Tampermonkey menu > Settings (faction sharing)** and pastes the URL.

The script's `@connect workers.dev` already covers `*.workers.dev`. If you later move the Worker to your own domain, add `// @connect yourdomain.com` to the script header.

## 7. First sign-in (verify in game)

1. Open your Faction Armory. The Settings dialog opens on the first visit.
2. Enter your Public key and click **Save & sign in**.
3. You should see "Signed in as YourName [ID] · Role: editor".

This also confirms that Torn's API answers requests from Cloudflare. If sign-in fails with "Could not reach the Torn API", check the Worker's **Logs** tab and tell the script author.

Then use **Tampermonkey menu > Upload local notes to faction** to move your existing notes over.

## Day-to-day

| Task | How |
|---|---|
| Add or remove an editor | Edit `EDITOR_IDS` in **Settings > Variables and Secrets**, then click **Deploy**. Takes effect on that member's next change. |
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
| You are not allowed to edit faction notes | Their player ID isn't in `EDITOR_IDS`. |
| Incorrect API key | The member's key is wrong or was deleted. They re-enter it in Settings. |
| Faction notes server error (HTTP 404) | Wrong server URL in the script's Settings. |
