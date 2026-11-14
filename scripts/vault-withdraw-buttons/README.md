# Torn Vault Withdraw Buttons

A row of withdrawal preset buttons and a Paste button on the property vault page.

**[Install](https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/vault-withdraw-buttons/vault-withdraw-buttons.user.js)** (requires [Tampermonkey](https://www.tampermonkey.net/))

## Features

- **Presets:** 2m, 5m, 10m, 20m, 30m and 60m by default, editable in settings (up to 12)
- Presets add up, so clicking 2m three times fills 6m, and Withdraw is highlighted for you to click
- **Paste** fills the withdrawal field from your clipboard and understands values like `5k`, `1.5m` and `$2,000,000`
- Amounts are capped at your vault balance when filling
- Short notices appear under the buttons instead of pop-up alerts
- You always click Withdraw yourself; the script never submits anything

## Setup

1. Install the script.
2. Open your property's vault tab. The buttons appear in the vault section.
3. To change presets, open the Tampermonkey menu on the vault page and choose **Settings**.

## API usage

None. The script reads the vault page only and makes no network requests.

### API key usage disclosure

| | |
|---|---|
| Data storage | Settings only (presets), locally in Tampermonkey storage |
| Data sharing | None |
| Purpose of use | Personal convenience on the vault page |
| Key storage & sharing | Not applicable; no API key is requested or stored |
| Key access level | Not applicable; the Torn API is not used |

## Known limitations

- Relies on Torn's vault page markup (`.vault-wrap`, `#vault-wvalue` and the withdraw form). If Torn changes it, the buttons may not appear.
- To start a preset total over, clear the withdrawal field by hand.

## Changelog

- **6.0.2**: Added `@license MIT` to the script header. No behavior changes.
- **6.0.1**: Presets may be separated by commas without spaces, misplaced commas are rejected, and awkward presets show the full number.
- **6.0.0**: Added update and download URLs.
- **5.0.0**: Removed the Magic button and the play money setting.
- **4.0.1**: Presets now add to the current amount.
- **4.0.0**: Added a settings panel, configurable presets and inline notices. Replaced interval polling with a scoped MutationObserver. Paste now understands values like 1.5m.

## Credits

Based on an earlier vault buttons script whose original author is unknown. If you wrote the original, please contact DadGum so credit can be added.
