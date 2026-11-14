# Needles to Top

Moves the Temporary items you choose to the top of your Items page's **Temporary** tab, in the order you set. By default: Tyrosine, Melatonin, Epinephrine, Serotonin.

**[Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/needles-to-top/needles-to-top.user.js)** (requires [Tampermonkey](https://www.tampermonkey.net/))

## Features

- Your top items come first, in your order; everything else follows in Torn's own order. Duplicate rows (such as a faction-loaned copy) keep their order.
- Sorts straight away when the Temporary tab loads or rows are added or removed. Opening an item's info or options doesn't move anything.
- **Settings** (Tampermonkey menu → Settings): reorder with ↑ / ↓, remove with ✕, add any item currently in your Temporary tab, or reset to the default. Changes apply at once.
- Only reorders rows on your own page: no clicks, no API key, no network requests. Your list is stored locally in Tampermonkey.

## Known limitations

- Temporary tab only.
- Torn gives rows position classes (such as first or last in a row) based on where it put them. These aren't updated after sorting, the same as in 1.8.

## Changelog

- **2.0.0**: Rewrite. One ordered list, editable in Settings; matches items by ID; sorts without the half-second delay and only when rows are added or removed; waits for the Temporary tab instead of polling; fixed the `@run-at` line; quiet console.
- **1.8**: Original by Elaine.

## Credits

Based on "Needles to top!" 1.8 by Elaine [2047176], released under the MIT License.
