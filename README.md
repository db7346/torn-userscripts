# Torn Userscripts

Tampermonkey userscripts for [Torn City](https://www.torn.com).

## Scripts

| Script | Description | Install |
|---|---|---|
| [Bounty Bullseye](scripts/bounty-bullseye/) | Bullseye on online and idle Enemies and Targets in the sidebar who have an active bounty | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/bounty-bullseye/bounty-bullseye.user.js) |
| [BUSTR: Busting Reminder](scripts/bustr/) | How many busts you have left before getting jailed, plus a hardness-sorted jail list | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/bustr/bustr.user.js) |
| [Clean Player Names](scripts/clean-player-names/) | Larger, more legible player names on honor bars | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/clean-player-names/clean-player-names.user.js) |
| [Effective Weapon Stats](scripts/effective-weapon-stats/) | Effective damage, accuracy, and crit chance when you open a weapon | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/effective-weapon-stats/effective-weapon-stats.user.js) |
| [Market Buy Confirm](scripts/market-buy-confirm/) | Moves the item market's Yes confirm onto the Buy spot, with a double-click guard | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/market-buy-confirm/market-buy-confirm.user.js) |
| [Museum Set Buttons](scripts/museum-set-buttons/) | Item market tab with links to every museum flower and plushie, how many you own, and full sets | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/museum-set-buttons/museum-set-buttons.user.js) |
| [Needles to Top](scripts/needles-to-top/) | Sorts chosen Temporary items (needles by default) to the top of your Items page, in your order | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/needles-to-top/needles-to-top.user.js) |
| [OC Helper](scripts/oc-helper/) | Overview of your faction's Organized Crimes and any problems with them | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/oc-helper/oc-helper.user.js) |
| [Rental Manager](scripts/rental-manager/) | Queue of rentals needing attention, with prefilled lease extensions | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/rental-manager/rental-manager.user.js) |
| [Torn Crimes Helper](scripts/crimes-helper/) | Market links on missing crime items, enhancer check, guide links and a crime chain counter | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/crimes-helper/crimes-helper.user.js) |
| [Treat Counter](scripts/treat-counter/) | Live Halloween treat counter in the sidebar | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/treat-counter/treat-counter.user.js) |
| [Vault Withdraw Buttons](scripts/vault-withdraw-buttons/) | Preset and Paste buttons that fill the property vault withdrawal field | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/vault-withdraw-buttons/vault-withdraw-buttons.user.js) |

## Installing

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. Click a script's **Install** link above. Tampermonkey opens an install page.
3. Follow the script's README for setup (usually adding an API key).

Scripts update automatically through Tampermonkey when a new version is pushed here.

## Standards

Every script in this repo:

- Is a **read-only helper**: no automated clicks, attacks, purchases or other in-game actions
- Uses the **lowest API key access level** that works, and includes Torn's API key usage disclosure
- Stores your key only locally (Tampermonkey storage) and sends it only in the `Authorization` header to `api.torn.com`
- Rate-limits and caches its API calls, and tags them with `comment=<ScriptName>` for your key log

## Repository layout

```
scripts/
  <script-name>/
    <script-name>.user.js
    README.md
```

## License

[MIT](LICENSE), except [OC Helper](scripts/oc-helper/), which is [GPL-3.0-only](scripts/oc-helper/LICENSE).
