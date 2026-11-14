# Museum Set Buttons

A small tab on the item market with one-click links to every museum flower and plushie, how many of each you own, and how many full sets you can trade in.

**[Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/museum-set-buttons/museum-set-buttons.user.js)** · [Greasy Fork](https://greasyfork.org/scripts/605517) (requires [Tampermonkey](https://www.tampermonkey.net/))

## Features

- A **Museum sets** tab on the right edge of the item market; click it to open the panel
- All 11 flowers and 13 plushies, each opening the market on that item
- With an API key: how many of each you own, full sets you can trade in, and which items the next set still needs (shaded)
- Groups collapse, and the panel remembers whether it was open
- Links only: it never buys, sells or clicks anything for you

## Setup

1. Install the script and open the item market.
2. Settings opens once. Paste a **Minimal Access** key to see your counts, or close it to use the links only.
3. Change the key later from the ⚙ button in the panel or the Tampermonkey menu.

## API usage

| Request | When | Key level |
|---|---|---|
| `GET /v2/user/inventory?cat=Flower&limit=250` | When you open the panel, then at most every 15 minutes while it is open | Minimal |
| `GET /v2/user/inventory?cat=Plushie&limit=250` | Same | Minimal |
| `GET /v2/key/info` | When saving a key | Any |

At most 2 calls per 15 minutes, and none on other pages or with the panel closed. Requests are tagged `comment=MuseumSetButtons`.

### API key usage disclosure

| | |
|---|---|
| Data storage | Key, panel state, and your flower and plushie counts (15 minutes), locally in Tampermonkey storage |
| Data sharing | None; requests go only to api.torn.com |
| Purpose of use | Showing how many museum flowers and plushies you own |
| Key storage & sharing | Stored locally, sent only in the Authorization header, never logged |
| Key access level | Minimal (optional) |

## Known limitations

- Torn refreshes inventory data every 15 minutes, so a count can lag behind a recent purchase.
- Faction-owned items are not counted, since they cannot be traded in.

## Changelog

- **2.0.0**: Rewrite. Links open the new item market, the panel is a small tab on the item market only, and owned counts and full sets come from your inventory.

## Credits

Based on Museum Set Buttons by Titanic_ [2968477], released under the MIT License.
