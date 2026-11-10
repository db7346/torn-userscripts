# Torn Userscripts

Tampermonkey userscripts for [Torn City](https://www.torn.com).

## Scripts

| Script | Description | Install |
|---|---|---|
| [Armory Notes](scripts/armory-notes/) | Colored labels and notes on individual weapons and armor, by armory ID, shared with your faction | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/release/scripts/armory-notes/armory-notes.user.js) |
| [BUSTR: Busting Reminder](scripts/bustr/) | How many busts you have left before getting jailed, plus a hardness-sorted jail list | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/bustr/bustr.user.js) |
| [Clean Player Names](scripts/clean-player-names/) | Larger, more legible player names on honor bars | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/clean-player-names/clean-player-names.user.js) |
| [Effective Weapon Stats](scripts/effective-weapon-stats/) | Effective damage, accuracy, and crit chance when you open a weapon | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/effective-weapon-stats/effective-weapon-stats.user.js) |
| [OC Helper](scripts/oc-helper/) | Overview of your faction's Organized Crimes and any problems with them | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/oc-helper/oc-helper.user.js) |
| [Rental Manager](scripts/rental-manager/) | Queue of rentals needing attention, with prefilled lease extensions | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/rental-manager/rental-manager.user.js) |
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
- Stores your key only locally (Tampermonkey storage) and sends it only in the `Authorization` header to `api.torn.com` (exception: Armory Notes' faction sharing sends a Public key to your faction's own server at sign-in; see [its README](scripts/armory-notes/))
- Rate-limits and caches its API calls, and tags them with `comment=<ScriptName>` for your key log

## Repository layout

```
scripts/
  <script-name>/
    <script-name>.user.js
    README.md
    server/          (only for scripts with a backend, e.g. armory-notes)
```

## License

[MIT](LICENSE), except [OC Helper](scripts/oc-helper/), which is [GPL-3.0](scripts/oc-helper/LICENSE).
