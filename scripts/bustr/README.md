# BUSTR: Busting Reminder

Shows how many busts you likely have left before getting jailed, above the jail list, and sorts the list by how hard each bust is.

**[Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/bustr/bustr.user.js)** (requires [Tampermonkey](https://www.tampermonkey.net/))

## Features

- A colored bar above the jail list: busts left, plus your current penalty and estimated safe threshold
- Red, orange, or green based on limits you set
- Adds a bust to the count as soon as you see "You busted...", then confirms it from your log
- A **hardness** score on each player (level × (hours left + 3)), with the list sorted easiest first
- Runs only on the jail page, pauses in hidden tabs, and shares data across tabs
- Display only: you always click Bust yourself

## Setup

1. Install the script and open the jail page.
2. The Settings panel opens. Paste a **Full Access** API key and click **Save**.
3. Change limits, refresh rate, a manual threshold, or the hardness switch any time from the **Settings** button on the bar or the Tampermonkey menu.

## API usage

| Request | When | Key level |
|---|---|---|
| `GET /v2/user/log?log=5360&from=<72 hours ago>` | Every 60 seconds (configurable) while the jail page is visible | Full |
| `GET /v2/user/log?log=5360` | Up to 1,000 past busts, once every 24 hours | Full |
| `GET /v2/key/info` | When saving a key | Any |

Usually 1–2 calls per minute while the jail page is open, and none on other pages. Requests are tagged `comment=BUSTR`.

### API key usage disclosure

| | |
|---|---|
| Data storage | Key, settings, and bust log times, locally in Tampermonkey storage |
| Data sharing | None; requests go only to api.torn.com |
| Purpose of use | Estimating how many busts you can do before getting jailed |
| Key storage & sharing | Stored locally, sent only in the Authorization header, never logged |
| Key access level | Full Access, because Torn only shares your log with Full Access keys |

## Known limitations

- The threshold is an estimate from your own bust history. Set a manual threshold in Settings if you know yours.
- The hardness score is a guide, not Torn's actual bust chance.

## Changelog

- **2.0.1**: With two jail tabs open, a bust is no longer counted twice.
- **2.0.0**: Rewrite. Jail page only, API v2 with the key in a header, all busts in the last 72 hours counted, threshold estimate fixes, a Settings panel, readable errors, shared caching, and no PDA support.

## Credits

Based on BUSTR: Busting Reminder + PDA by Adobi & Ironhydedragon, released under the MIT License.
