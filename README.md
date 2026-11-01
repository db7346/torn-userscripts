# Torn Userscripts

Tampermonkey userscripts for [Torn City](https://www.torn.com).

## Scripts

| Script | Description | Install |
|---|---|---|
| [Armory Notes](scripts/armory-notes/) | Colored labels and notes on individual weapons and armor, by armory ID | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/armory-notes/armory-notes.user.js) |
| [Rental Manager](scripts/rental-manager/) | Queue of rentals needing attention, with prefilled lease extensions | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/rental-manager/rental-manager.user.js) |
| [Treat Counter](scripts/treat-counter/) | Live Halloween treat counter in the sidebar | [Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/treat-counter/treat-counter.user.js) |

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

[MIT](LICENSE)
