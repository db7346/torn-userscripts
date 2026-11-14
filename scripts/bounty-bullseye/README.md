# Bounty Bullseye

A small bullseye next to online or idle players in your sidebar **Enemies** and **Targets** lists when they have an active bounty. Hover it for the details.

**[Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/bounty-bullseye/bounty-bullseye.user.js)** · [Greasy Fork](https://greasyfork.org/scripts/605511) (requires [Tampermonkey](https://www.tampermonkey.net/))

## Features

- Checks only online and idle players, and only in the Enemies and Targets lists (never Friends)
- Hover text shows the total reward, how many bounties, and when the soonest one expires
- Each player is rechecked every 10 minutes, with results shared across tabs
- Requests are paced to at most 6 per minute, skip collapsed lists, and pause in hidden tabs
- Display only: it never clicks or submits anything

## Setup

1. Install the script and open any Torn page.
2. The Settings panel opens. Paste any **Public** API key or higher and click **Test and save key**.
3. To change the key later, choose **Settings** in the Tampermonkey menu.

## API usage

| Request | When | Key level |
|---|---|---|
| `GET /v2/user/{id}/bounties` | Online or idle players in the two lists, every 10 minutes each | Public |
| `GET /v2/key/info` | When saving a key | Any |

About one call per minute with 10 of those players online. Requests are tagged `comment=BountyBullseye`.

### API key usage disclosure

| | |
|---|---|
| Data storage | Key and recent bounty results for players in those lists, locally in Tampermonkey storage |
| Data sharing | None; requests go only to api.torn.com |
| Purpose of use | Showing which of your enemies and targets currently have bounties |
| Key storage & sharing | Stored locally, sent only in the Authorization header, never logged |
| Key access level | Public |

## Known limitations

- A bounty placed or claimed since a player's last check can take up to 10 minutes to show or disappear.
- Relies on the sidebar sections `#nav-enemies_list` and `#nav-targets_list`. If Torn renames them, the bullseyes stop appearing.

## Changelog

- **1.0.0**: First release.
