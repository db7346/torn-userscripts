# Torn Market Buy Confirm

On the item market, moves Torn's own **Yes** confirm button to where **Buy** was, so buying takes two clicks in the same spot. A short guard stops a double-click on Buy from confirming by accident.

**[Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/market-buy-confirm/market-buy-confirm.user.js)** · [Greasy Fork](https://greasyfork.org/scripts/605516) (requires [Tampermonkey](https://www.tampermonkey.net/))

## How it works

- Press **Buy** on a listing. Torn shows "Buy 1x Item for $X? Yes No ✕" in that row.
- Torn's **Yes** button moves onto the spot where Buy was: left edges line up, and it stops just short of ✕ so ✕ stays clickable.
- For **0.4 seconds** after it appears, Yes ignores clicks (it's dimmed while it does). A double-click on Buy can't buy; a deliberate second click works almost at once.
- **No**, **✕** and the confirm text stay where Torn puts them.
- It's Torn's real Yes button, only drawn in a different place. The script never clicks, submits or copies anything, so every purchase still takes two clicks of yours.
- If the confirm isn't a buy confirm, or the script didn't see the Buy press, the confirm is left exactly as Torn shows it.

Item market only (`page.php?sid=ItemMarket`). No API key, no network requests, nothing stored.

## Known limitations

- Torn's class names change. If Yes stops moving, the selectors in `CONFIG.SELECTORS` need updating.
- Desktop layout only.

## Changelog

- **1.0.0**: First version.
