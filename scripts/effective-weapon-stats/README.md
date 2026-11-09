# Torn Effective Weapon Stats

Shows effective damage, accuracy, and crit chance when you open a weapon on the item page.

**[Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/effective-weapon-stats/effective-weapon-stats.user.js)** (requires [Tampermonkey](https://www.tampermonkey.net/))

## Features

- Effective damage and accuracy from weapon experience, mods, ammo, education, merits, and active perks
- Separate rows for conditional, chance-based, and multi-hit weapon bonuses
- Expandable breakdown showing where every bonus came from
- Keeps your last good bonuses if the API fails, and labels them as saved data
- You keep full control: the script only displays information

## Setup

1. Install the script. If you have the original version, disable it to avoid two stat boxes.
2. Open any weapon on the item page.
3. Enter an API key with **Minimal Access** in the Settings panel, which opens on first run.

Reopen settings from **API settings** in the breakdown or from the Tampermonkey menu.

## API usage

| Endpoint | Key level | Frequency |
|---|---|---|
| `GET /v2/user?selections=education,job,merits,perks` | Minimal | Every 12 hours, or on Refresh |
| `GET /v2/torn/merits` | Public | Every 7 days |
| `GET /v2/key/info` | Any | Only when saving a key |

Every request is tagged `comment=EffectiveWeaponStats`. Failures wait 5 minutes before retrying.

### API key usage disclosure

| | |
|---|---|
| Data storage | Key, computed bonuses, merit names, and ammo state, locally in Tampermonkey storage |
| Data sharing | None; requests go only to api.torn.com |
| Purpose of use | Including your own education, merit, and perk bonuses in the weapon stats |
| Key storage & sharing | Stored locally; sent only in the `Authorization` header to api.torn.com; never logged |
| Key access level | Minimal Access |

## Known limitations

- Effective stats are not predicted HP damage or an opponent-specific hit chance.
- Ammo is read from your visible loadout, and is marked unconfirmed when it can't be seen.
- Relies on Torn's item page markup. If Torn changes it, the stats may not appear.

## Changelog

- **5.0.3**: Damage reduction and fist-only perks no longer count as weapon damage. Sub-Machine gun perks no longer count as Machine Gun perks.
- **5.0.2**: The key field no longer triggers the browser's save password prompt.
- **5.0.1**: Specialist now counts toward Effective Damage.
- **5.0.0**: One Torn API v2 request sent with the Authorization header, last good data on failure with a retry cooldown, reduced page monitoring, key moved to Tampermonkey storage and a Settings panel, tighter selectors, and PDA support removed.

## Credits

Based on Torn Effective Weapon Stats v4.9.0 by BakedPotato [2889448] (MIT).
