# Torn OC Helper

An overview of your faction's Organized Crimes 2.0: members not in a crime, members in each crime, and any problems with those crimes.

**[Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/oc-helper/oc-helper.user.js)** (requires [Tampermonkey](https://www.tampermonkey.net/))

## Features

- Members not in an OC, with last OC and activity highlights
- Crimes grouped into Uninitiated, Recruiting, and Full, with live timers
- Warnings for low success chances and missing items
- Overall success chance for supported Full crimes
- Your current OC in the sidebar
- Sortable lists and a member ignore list
- Also available on your faction's page while traveling
- You keep full control: the script only displays information

## Setup

1. Install the script. If you have the original version, disable it to avoid two overviews.
2. Enter an API key with **Minimal Access and faction API access** in the Settings panel, which opens on first run.
3. Click **Test and save key**, then set your preferences.

Reopen settings with the ⚙ on the overview or from the Tampermonkey menu.

## Requests

| Request | Key level | Frequency |
|---|---|---|
| `GET /v2/faction?selections=basic,crimes,members` | Minimal + faction API access | At most once per 60 seconds, shared across tabs |
| `GET /v2/faction/crimes?cat=completed` | Minimal + faction API access | Same refresh, up to 3 pages |
| `GET /v2/torn/{ids}/items` | Public | New item IDs only, cached 7 days |
| `GET /v2/key/info` | Any | On save, and once to find your user ID |
| `tornprobability.com` scenario list | None | Overview only, cached 1 day |
| `tornprobability.com` success lookup | None | Once per Full crime and set of pass rates |

Torn requests are tagged `comment=OCHelper`. Failures wait 5 minutes before retrying.

### API key usage disclosure

| | |
|---|---|
| Data storage | Key, settings, and cached faction, item, and success data, locally in Tampermonkey storage |
| Data sharing | **Crime names and slot pass rates for Planning crimes are sent to tornprobability.com, a third-party service, unless turned off in Settings.** Your key, your name, and member names are never sent |
| Purpose of use | Showing your faction's Organized Crime status to you |
| Key storage & sharing | Stored locally; sent only in the `Authorization` header to api.torn.com; never logged |
| Key access level | Minimal Access with faction API access |

## Known limitations

- Only crimes with mapped routes can show an overall success chance.
- Last-OC times cover up to 300 of your faction's most recent completed crimes.
- Relies on Torn's crimes page and sidebar markup. If Torn changes it, parts may not appear.

## Changelog

- **6.0.3**: The overview now hides when you leave the crimes tab.
- **6.0.2**: The key field no longer triggers the browser's save password prompt.
- **6.0.1**: Crime slot totals now include open slots in Recruiting crimes.
- **6.0.0**: Removed jQuery and PDA support, moved the key out of request URLs, added shared caching and last-good data on failure, fixed crashes and item name errors, added crime paging, fixed the sidebar notice, replaced the preferences page with a Settings panel, and added a third-party data disclosure.

## Credits and license

Modified from [TORN] OC 2.0 Helper v5.4.0 by callmericky [3299880] / whatdoesthespacebardo. Licensed under [GPL-3.0](LICENSE), unlike the rest of this repository.
