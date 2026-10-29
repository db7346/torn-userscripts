# Torn Rental Manager

A card on the properties list (and the extend/lease tabs) listing every rental that needs attention, with one-click navigation and prefilled lease extensions.

**[Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/rental-manager/rental-manager.user.js)** (requires [Tampermonkey](https://www.tampermonkey.net/))

## Features

- **Attention queue:** rented properties with N days or fewer left (soonest first, red at 1 day or less) and vacant properties, for the property types you choose
- Each row shows the renter, cost, period, $/day and any pending extension offer, plus an **Extend →** or **List →** link
- **Prev / Next** through the queue; the property you're viewing is highlighted
- **Prefilled extension offers**, in this order:
  1. Your last agreement with this renter for this property (activity log; Full Access key only)
  2. The renter's current lease terms
  3. Your default cost and days
- **Prefilled new listings** with your default cost and days
- **Happy: N** shown in an empty slot on the property options page
- Values are filled once per view, so your own edits are never overwritten
- You always click Submit yourself; the script never submits anything
- Follows Torn's dark and light mode, with an accent color you choose

## Setup

1. Install the script and disable the old Easy Property Rent Extension if you have it.
2. Open `properties.php`. The settings panel opens on first run.
3. Paste an API key (**Limited Access** minimum; **Full Access** also enables prefill from your activity log).
4. Set the days threshold, default cost and days, property types and accent color, then click **Save**.

Reopen settings with the ⚙ button on the card or from the Tampermonkey menu. ↻ forces a refresh.

## API usage

| Endpoint | Key level | Frequency |
|---|---|---|
| `GET /user/properties?filters=ownedByUser` | Limited | Cached 5 min; refreshed after you submit a lease or extension |
| `GET /user/log?log=5937,5943` | Full (optional) | Only on the extension tab, cached 10 min |
| `GET /key/info` | Any | Only when saving a key |

Every request is tagged `comment=RentalManager` so it's identifiable in your key log.

### API key usage disclosure

| | |
|---|---|
| Data storage | Only locally in your browser (Tampermonkey storage) |
| Data sharing | None; nothing is sent anywhere except api.torn.com |
| Purpose of use | Managing your own rental properties |
| Key storage & sharing | Stored locally; sent only in the `Authorization` header to api.torn.com; never logged |
| Key access level | Limited Access (Full Access optional, for log prefill) |

## Known limitations

- The v2 activity log's `data` fields aren't documented. The script reads the v1 names (`property_id`, `renter`, `days`, `rent`) and falls back to the current lease terms if they're missing.
- Properties already listed for rent or for sale aren't counted as needing attention.

## Changelog

- **3.1.0**: Card shows only on the properties list and the extend/lease tabs (hidden on Vault and other option tabs).
- **3.0.1**: Added GitHub update/download URLs for auto-updates.
- **3.0.0**: Rewrite with API v2 (Limited key works), a single cached properties call, queue card UI, settings panel, no jQuery, hash routing, fill-once inputs and full API error handling.
- **2.3.0**: Last version of the original by IceBlueFire.

## Credits

Based on [Easy Property Rent Extension](https://greasyfork.org/scripts/524340) by IceBlueFire [776] (MIT).
