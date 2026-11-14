# Torn Crimes Helper

Helpers for the Crimes 2.0 pages: market links on items you're missing, an enhancer check, forum guide links, and a crime chain counter. Works without TornTools, and the API key is optional.

**[Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/crimes-helper/crimes-helper.user.js)** (requires [Tampermonkey](https://www.tampermonkey.net/))

## Features

- **Market links:** items you have none of get a small, faint cart icon in the tile's corner (full brightness when you hover the tile) that opens that item on the item market in a new tab. The badge sits beside Torn's Add button, so clicking it never adds anything.
- **Enhancer check:** the crime title shows ✅ when you own that crime's enhancer, or a red link to the market when you don't.
- **Guide link:** the crime's in-depth forum guide, in the header.
- **Crime chain counter:** success +1, failure halves it, critical failure resets it to 0. It reads the crime results Torn already sends your browser, so it needs no key, makes no API calls and doesn't need TornTools.
- **Optional log catch-up:** with a Full Access key, the counter also counts crimes done on other devices or with the page closed, and the ↻ button rebuilds it from your crime log.
- Links and counting only: it never commits crimes, buys or clicks anything for you.

## Setup

1. Install the script. If you have Torn Crimes 2.0 Helper 1.0.0 installed, disable it (both would add a guide link and a counter).
2. Open the crimes page. Settings opens once: paste a **Full Access** key for log catch-up, or close it to use everything else without a key.
3. Change the key, turn catch-up on page load off, or reset the chain from **Settings** in the Tampermonkey menu, or the ↻ button when no key is saved.

Coming from 1.0.0, your chain count moves over automatically. If 1.0.0 had a key saved, it moves into Tampermonkey storage and is deleted from Torn's page storage, where any script could read it.

## API usage

| Request | When | Key level |
|---|---|---|
| `GET /v2/user/log?cat=136&from=<last counted>&limit=100` | Once per page load | Full |
| `GET /v2/user/log?cat=136&limit=100[&to=<oldest>]` | ↻ rebuild: up to 10 pages, 1.5 seconds apart, back to your last critical failure | Full |
| `GET /v2/key/info` | When saving a key | Any |

Without a key: no requests at all. With one: about 1 call per page load. Requests are tagged `comment=CrimesHelper`.

### API key usage disclosure

| | |
|---|---|
| Data storage | Key, chain count, time of the last counted crime and settings, locally in Tampermonkey storage; logs are read and discarded |
| Data sharing | None; requests go only to api.torn.com |
| Purpose of use | Counting crimes done on other devices or with the page closed |
| Key storage & sharing | Stored locally, sent only in the Authorization header, never logged |
| Key access level | Full (logs need it), or a Custom key with the crime log category (optional) |

## Known limitations

- The chain rules (success +1, failure halves, critical failure resets) are community-observed, carried over from 1.0.0; Torn doesn't document them.
- Without a key, only crimes done on this page are counted.
- Crimes counted on the page are timestamped with your computer's clock, and catch-up reads logs after that time. A clock that is off by several seconds could miss or double-count a crime done in that window.
- Guide links cover the 12 crimes 1.0.0 knew about, plus Arson.
- Torn's class names change; if badges or links stop appearing, the selectors in `CONFIG.SELECTORS` need updating.

## Changelog

- **2.0.0**: Rewrite. Market links work again and sit beside Torn's Add button instead of inside it. Reads Torn's crime results itself, so TornTools is optional. The enhancer check can't crash before your enhancer is known. API v2 with the key in a header, Tampermonkey storage, catch-up reads only new logs, and a Settings panel with a key check. Arson added (guide, enhancer, and market links in its item picker).

## Credits

Based on Torn Crimes 2.0 Helper 1.0.0 by TiltGod5000, released under the MIT License. Guide links point to the community's in-depth guides on the Torn forums.
