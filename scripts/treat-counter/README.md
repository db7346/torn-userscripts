# Torn Treat Counter

Live Halloween treat counter in the Torn sidebar. Shows your current treats and total collected without opening your basket.

```
Treats: 124 · 1,573/2,500
```

**[Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/treat-counter/treat-counter.user.js)** (requires [Tampermonkey](https://www.tampermonkey.net/))

## Features

- Updates from the Torn API about once a minute while a Torn tab is visible
- One shared poll across all open Torn tabs, so more tabs don't mean more API calls
- Instant refresh after an attack awards treats
- Free, instant update when you open your basket (no API call)
- Hover for details (available, collected, goal, last update); click for settings
- Only runs during the Halloween event window (Oct 25 – Nov 1, 12:00 UTC)

## Setup

1. Install the script.
2. Load any Torn page. The settings panel opens on first run.
3. Paste an API key with **Minimal Access** and click **Save & test**.

You can reopen settings by clicking the counter or from the Tampermonkey menu.

## API usage

| Endpoint | Key level | Frequency |
|---|---|---|
| `GET /user/halloween` | Minimal | ~1/min, plus at most 1 per 15 s after attack treats |
| `GET /torn/halloween` | Minimal | ~1/day (goal fallback) |
| `GET /key/info` | Any | Only when saving a key |

Every request is tagged `comment=TreatCounter` so it's identifiable in your key log.

### API key usage disclosure

| | |
|---|---|
| Data storage | Only locally in your browser (Tampermonkey storage) |
| Data sharing | None; nothing is sent anywhere except api.torn.com |
| Purpose of use | Displaying your own Halloween treat counts |
| Key storage & sharing | Stored locally; sent only in the `Authorization` header to api.torn.com; never logged |
| Key access level | Minimal Access |

## Known limitations

- The collected goal (e.g. 2,500) is read from your basket when you open it. Until then, it's estimated from the next basket upgrade requirement, and the tooltip marks it as an estimate.
- `/user/halloween` is marked unstable in Torn's API spec. If the response changes, the counter shows a warning instead of a wrong number.
- Attack detection relies on the `.dialog-title__halloween` element on the attack page.

## Changelog

- **1.0.1**: Added GitHub update/download URLs for auto-updates.
- **1.0.0**: Clean rewrite with API polling, cross-tab shared state, settings panel, collected/goal display, and full API error handling.

## Credits

Based on [Treat counter](https://greasyfork.org/scripts/478249) by m0tch, Grizh and Silmaril (MIT).
