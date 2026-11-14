# Clean Player Names

Replaces Torn's pixel honor bar names with a larger, more legible font, while keeping color outlines for staff roles and blue names.

**[Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/clean-player-names/clean-player-names.user.js)** · [Greasy Fork](https://greasyfork.org/scripts/605513) (requires [Tampermonkey](https://www.tampermonkey.net/))

Formerly **Torn: More Legible Player Names**. If you have that version, remove it after installing this one.

## Features

- Legible uppercase names in the Manrope font on every honor bar
- Outline colors for admins, officers, moderators, helpers, and blue names
- Updates when Torn reuses a name bar for another player
- Works alongside other scripts that add content to honor bars
- Display only: it never clicks or submits anything

## Setup

Install the script. There's nothing to configure.

## API usage

None. The script makes no Torn API calls and needs no API key.

### API key usage disclosure

| | |
|---|---|
| Data storage | None |
| Data sharing | None by this script. The Manrope font loads from Google Fonts on Torn pages |
| Purpose of use | Making player names easier to read |
| Key storage & sharing | Not applicable; no API key is requested or stored |
| Key access level | Not applicable; the Torn API is not used |

## Known limitations

- Relies on Torn's `.honor-text-wrap` markup. If Torn changes it, names may not appear.

## Changelog

- **3.0.1**: Torn's own name image stays visible if a player's name cannot be read.
- **3.0.0**: Renamed from Torn: More Legible Player Names. Names and outlines now update when Torn reuses a name bar, names can no longer pick up other scripts' text, page monitoring is debounced, class names are prefixed, and updates come from GitHub.
