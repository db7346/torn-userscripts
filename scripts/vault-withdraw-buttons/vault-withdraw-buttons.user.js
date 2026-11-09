// ==UserScript==
// @name         Vault Withdraw Buttons
// @namespace    torn-userscripts
// @version      6.0.1
// @description  Adds configurable withdraw presets and a Paste button to the Torn property vault.
// @author       DadGum
// @match        https://www.torn.com/properties.php*
// @updateURL    https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/vault-withdraw-buttons/vault-withdraw-buttons.user.js
// @downloadURL  https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/vault-withdraw-buttons/vault-withdraw-buttons.user.js
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

/* * CREDITS
 *   Based on an earlier vault buttons script whose original author is unknown.
 *   If you wrote the original, please contact DadGum so credit can be added.
 *
 * PURPOSE
 *   Speeds up property vault withdrawals. Presets add to the withdrawal amount
 *   and Paste fills it. The script never submits anything; you always click
 *   Torn's Withdraw button yourself.
 *
 * API KEY USAGE DISCLOSURE
 *   Data storage:     Settings only (presets), in Tampermonkey storage.
 *   Data sharing:     None. The script makes no network requests.
 *   Purpose of use:   Personal convenience on the vault page.
 *   Key storage/sharing: Not applicable. No API key is requested or stored.
 *   Key access level: Not applicable. The Torn API is not used.
 *
 * TEMPLATE NOTE
 *   The API and Cache modules are omitted because this script makes no API calls.
 *
 * CHANGELOG
 *   6.0.1  Presets may be separated by commas without spaces.
 *          Amounts with misplaced commas, such as 1,5m, are now rejected.
 *          Presets that do not shorten cleanly now show the full number.
 *   6.0.0  Added update and download URLs.
 *   5.0.0  Removed the Magic button and the play money setting.
 *   4.0.1  Presets now add to the current amount.
 *   4.0.0  Added a settings panel, configurable presets, and inline notices.
 *          Replaced interval polling with a scoped MutationObserver.
 *          Paste now understands Torn-style values such as 1.5m.
 *          Replaced index-based selectors and restructured the script.
 *   3.1    Previous release.
 */

(() => {
    'use strict';

    // =========================================================================
    // CONFIG
    // =========================================================================

    const CONFIG = Object.freeze({
        DEBUG: false,
        STORAGE_PREFIX: 'tms_vwb_',
        VAULT_TAB_MARKER: 'tab=vault',
        DEFAULT_PRESETS: Object.freeze([2e6, 5e6, 10e6, 20e6, 30e6, 60e6]),
        MAX_PRESETS: 12,
        OBSERVER_DEBOUNCE_MS: 150,
        FORM_READY_TIMEOUT_MS: 1500,
        HIGHLIGHT_MS: 6000,
        NOTICE_MS: 7000,
        SUFFIXES: Object.freeze({ k: 1e3, m: 1e6, b: 1e9, t: 1e12 }),
        IDS: Object.freeze({
            BAR: 'tms-vwb-bar',
            NOTICE: 'tms-vwb-notice',
            SETTINGS: 'tms-vwb-settings',
        }),
        CLASSES: Object.freeze({
            ROW: 'tms-vwb-row',
            LABEL: 'tms-vwb-label',
            BUTTON: 'tms-vwb-btn',
            HIGHLIGHT: 'tms-vwb-highlight',
            ERROR: 'tms-vwb-error',
            PANEL: 'tms-vwb-panel',
            FIELD: 'tms-vwb-field',
            ACTIONS: 'tms-vwb-actions',
            HINT: 'tms-vwb-hint',
        }),
        // These are Torn's own stable names from the vault markup, not hashed
        // classes. The sharing message is identified by text as well as position.
        SELECTORS: Object.freeze({
            VAULT_WRAP: '.vault-wrap',
            WITHDRAW_FORM: 'form.vault-cont.left',
            VISIBLE_MONEY: 'input[type="text"].input-money',
            WITHDRAW_HIDDEN: 'input[type="hidden"][name="withdraw"]',
            SUBMIT: 'input[type="submit"]',
            VAULT_BALANCE: '#vault-wvalue',
            SHARING_MESSAGE: ':scope > .message',
            BAR_ANCHOR: ':scope > .clear',
        }),
        SHARING_DISABLED_PATTERN: /sharing is disabled/i,
    });

    /**
     * @typedef {Object} Settings
     * @property {number[]} presets Withdrawal preset amounts in dollars.
     */

    /**
     * @typedef {Object} VaultRefs
     * @property {HTMLElement} wrap Vault container.
     * @property {HTMLFormElement} withdrawForm Withdrawal form.
     * @property {HTMLInputElement} withdrawVisible Visible withdrawal input.
     * @property {HTMLInputElement} withdrawHidden Hidden withdrawal value.
     * @property {HTMLInputElement} withdrawSubmit Torn's Withdraw button.
     */

    /**
     * Writes a debug message when debugging is enabled.
     * @param {...unknown} args Values to log.
     * @returns {void}
     */
    function log(...args) {
        if (CONFIG.DEBUG) console.debug('[Vault Withdraw Buttons]', ...args);
    }

    // =========================================================================
    // STORAGE
    // =========================================================================

    const Storage = {
        /**
         * Reads and deserializes a stored value.
         * @template T
         * @param {string} key Unprefixed storage key.
         * @param {T} fallback Value returned when missing or invalid.
         * @returns {T|unknown} Stored value or fallback.
         */
        get(key, fallback) {
            const raw = GM_getValue(CONFIG.STORAGE_PREFIX + key, null);
            if (raw === null) return fallback;
            try {
                return JSON.parse(raw);
            } catch (error) {
                log('Invalid stored value', key, error);
                return fallback;
            }
        },

        /**
         * Serializes and stores a value.
         * @param {string} key Unprefixed storage key.
         * @param {unknown} value JSON-serializable value.
         * @returns {void}
         */
        set(key, value) {
            GM_setValue(CONFIG.STORAGE_PREFIX + key, JSON.stringify(value));
        },
    };

    // =========================================================================
    // DATA (pure functions, no DOM access)
    // =========================================================================

    /**
     * Parses a positive dollar amount, including Torn-style suffixes.
     * @param {unknown} raw Input such as "$2,000", "5k", or "1.5m".
     * @returns {number|null} Whole dollars, or null when invalid.
     */
    function parseAmount(raw) {
        const text = String(raw ?? '').replace(/[\s$]/g, '').toLowerCase();
        if (text.includes(',') && !/^\d{1,3}(?:,\d{3})+(?:\.\d+)?[kmbt]?$/.test(text)) return null;
        const match = /^(\d+(?:\.\d+)?|\.\d+)([kmbt]?)$/.exec(text.replace(/,/g, ''));
        if (!match) return null;

        const [, numberText, suffix] = match;
        const scaled = Number(numberText) * (suffix ? CONFIG.SUFFIXES[suffix] : 1);
        const amount = suffix ? Math.round(scaled) : Math.floor(scaled);
        return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
    }

    /**
     * Extracts a whole-dollar value from Torn's displayed money text.
     * @param {string|null|undefined} text Text such as "165,572,330".
     * @returns {number|null} Dollar value, or null when no digits exist.
     */
    function parseDisplayedMoney(text) {
        const digits = String(text ?? '').replace(/\D/g, '');
        return digits ? Number(digits) : null;
    }

    /**
     * Formats a preset compactly without changing its exact value.
     * @param {number} amount Whole-dollar amount.
     * @returns {string} Compact label such as "2m" or "1.5m".
     */
    function formatCompact(amount) {
        for (const [suffix, unit] of [['b', 1e9], ['m', 1e6], ['k', 1e3]]) {
            if (amount >= unit && amount % (unit / 100) === 0 && (suffix === 'b' || amount < unit * 1000)) {
                return `${amount / unit}${suffix}`;
            }
        }
        return String(amount);
    }

    /**
     * Formats dollars for messages.
     * @param {number} amount Whole-dollar amount.
     * @returns {string} Formatted value such as "$2,000,000".
     */
    function formatDollars(amount) {
        return `$${amount.toLocaleString('en-US')}`;
    }

    /**
     * Parses the comma-separated preset field.
     * @param {string} text User input, separated by commas or spaces.
     * @returns {{presets: number[], error: string|null}} Parsed unique presets or an error.
     */
    function parsePresetList(text) {
        // A comma stays inside a token only when it is a thousands separator.
        const tokens = String(text).split(/[\s;]+/)
            .flatMap((chunk) => chunk.split(/(?<!\d),|,(?!\d{3}(?:,|$))/))
            .filter(Boolean);
        if (!tokens.length) return { presets: [], error: 'Enter at least one preset.' };

        const presets = [];
        for (const token of tokens) {
            const amount = parseAmount(token);
            if (amount === null) return { presets: [], error: `Invalid preset: ${token}` };
            if (!presets.includes(amount)) presets.push(amount);
        }
        if (presets.length > CONFIG.MAX_PRESETS) {
            return { presets: [], error: `Use ${CONFIG.MAX_PRESETS} presets or fewer.` };
        }
        return { presets, error: null };
    }

    /**
     * Validates settings read from storage and fills defaults.
     * @param {unknown} stored Stored settings object.
     * @returns {Settings} Safe settings.
     */
    function normalizeSettings(stored) {
        const source = stored && typeof stored === 'object' ? stored : {};
        const storedPresets = Array.isArray(source.presets)
            ? source.presets.filter((value) => Number.isSafeInteger(value) && value > 0)
            : [];
        return {
            presets: storedPresets.length
                ? [...new Set(storedPresets)].slice(0, CONFIG.MAX_PRESETS)
                : [...CONFIG.DEFAULT_PRESETS],
        };
    }

    // =========================================================================
    // UI AND VAULT ACCESS
    // =========================================================================

    const state = {
        /** @type {Settings} */
        settings: normalizeSettings(Storage.get('settings', null)),
        noticeTimer: 0,
        highlightTimer: 0,
    };

    /**
     * Creates an element without using HTML parsing.
     * @param {string} tag Element tag name.
     * @param {{id?: string, className?: string, text?: string, attrs?: Record<string, string>, onClick?: EventListener}} [options] Element options.
     * @param {Array<Node>} [children] Child nodes.
     * @returns {HTMLElement} Created element.
     */
    function createEl(tag, options = {}, children = []) {
        const element = document.createElement(tag);
        if (options.id) element.id = options.id;
        if (options.className) element.className = options.className;
        if (options.text !== undefined) element.textContent = options.text;
        Object.entries(options.attrs ?? {}).forEach(([name, value]) => element.setAttribute(name, value));
        if (options.onClick) element.addEventListener('click', options.onClick);
        element.append(...children);
        return element;
    }

    /**
     * Injects the script's scoped styles.
     * @returns {void}
     */
    function injectStyles() {
        const { IDS: I, CLASSES: C } = CONFIG;
        GM_addStyle(`
            #${I.BAR} { padding: 6px 0; text-align: center; }
            .${C.ROW} { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px; }
            .${C.LABEL} { font-weight: 700; }
            .${C.BUTTON} { min-width: 50px; padding: 4px 8px; border-radius: 4px; font-size: 13px; cursor: pointer; }
            .${C.BUTTON}:disabled { cursor: not-allowed; opacity: .55; }
            .${C.HIGHLIGHT} { outline: 3px solid #f2b705 !important; outline-offset: 2px; }
            #${I.NOTICE} { min-height: 16px; margin-top: 5px; font-size: 12px; }
            #${I.NOTICE}.${C.ERROR} { color: #d13a3a; font-weight: 700; }
            #${I.SETTINGS} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.55); }
            .${C.PANEL} { box-sizing: border-box; width: 420px; padding: 16px; border: 1px solid #555; border-radius: 6px; color: #eee; background: #2b2b2b; font-size: 13px; }
            .${C.PANEL} h2 { margin: 0 0 12px; font-size: 16px; }
            .${C.FIELD} { display: block; margin-bottom: 12px; }
            .${C.FIELD} input[type="text"] { display: block; box-sizing: border-box; width: 100%; margin-top: 4px; padding: 5px; color: #eee; background: #1c1c1c; border: 1px solid #666; }
            .${C.HINT} { display: block; margin-top: 3px; color: #bbb; font-size: 12px; }
            .${C.ACTIONS} { display: flex; justify-content: flex-end; gap: 6px; }
            .${C.PANEL} .${C.ERROR} { min-height: 16px; margin-bottom: 8px; color: #ff7b7b; }
        `);
    }

    /**
     * Finds the current vault controls.
     * @returns {VaultRefs|null} Controls, or null when any are unavailable.
     */
    function getVaultRefs() {
        const S = CONFIG.SELECTORS;
        const wrap = document.querySelector(S.VAULT_WRAP);
        const withdrawForm = wrap?.querySelector(S.WITHDRAW_FORM);
        const withdrawVisible = withdrawForm?.querySelector(S.VISIBLE_MONEY);
        const withdrawHidden = withdrawForm?.querySelector(S.WITHDRAW_HIDDEN);
        const withdrawSubmit = withdrawForm?.querySelector(S.SUBMIT);

        if (!withdrawVisible || !withdrawHidden || !withdrawSubmit) return null;
        return { wrap, withdrawForm, withdrawVisible, withdrawHidden, withdrawSubmit };
    }

    /**
     * Finds the vault controls for a user action.
     * @returns {VaultRefs} Current controls.
     * @throws {Error} When Torn's vault form cannot be found.
     */
    function requireVaultRefs() {
        const refs = getVaultRefs();
        if (!refs) throw new Error('The vault form could not be found. Torn may have changed this page.');
        return refs;
    }

    /**
     * Reads a money value from a selector.
     * @param {string} selector Element selector.
     * @returns {number|null} Dollar value, or null when unavailable.
     */
    function readMoney(selector) {
        return parseDisplayedMoney(document.querySelector(selector)?.textContent);
    }

    /**
     * Checks whether Torn is displaying its vault-sharing restriction.
     * @param {HTMLElement} wrap Vault container.
     * @returns {boolean} True when vault actions are unavailable.
     */
    function isSharingDisabled(wrap) {
        const message = wrap.querySelector(CONFIG.SELECTORS.SHARING_MESSAGE);
        return Boolean(
            message
            && message.getClientRects().length > 0
            && CONFIG.SHARING_DISABLED_PATTERN.test(message.textContent),
        );
    }

    /**
     * Displays a short inline status message.
     * @param {string} message Message text.
     * @param {boolean} [isError=false] Whether to use error styling.
     * @returns {void}
     */
    function showNotice(message, isError = false) {
        const notice = document.getElementById(CONFIG.IDS.NOTICE);
        if (!notice) {
            log('Notice unavailable', message);
            return;
        }
        notice.textContent = message;
        notice.classList.toggle(CONFIG.CLASSES.ERROR, isError);
        clearTimeout(state.noticeTimer);
        state.noticeTimer = setTimeout(() => {
            notice.textContent = '';
            notice.classList.remove(CONFIG.CLASSES.ERROR);
        }, CONFIG.NOTICE_MS);
    }

    /**
     * Wraps a button action with visible error reporting.
     * @param {() => (void|Promise<void>)} action Action to run.
     * @returns {() => Promise<void>} Click handler.
     */
    function guardAction(action) {
        return async () => {
            try {
                await action();
            } catch (error) {
                log('Action failed', error);
                showNotice(error instanceof Error ? error.message : 'Something went wrong.', true);
            }
        };
    }

    /**
     * Creates one bar button.
     * @param {string} label Button text.
     * @param {string} title Tooltip text.
     * @param {() => (void|Promise<void>)} action Click action.
     * @returns {HTMLButtonElement} Button.
     */
    function createBarButton(label, title, action) {
        return createEl('button', {
            className: `torn-btn ${CONFIG.CLASSES.BUTTON}`,
            text: label,
            attrs: { type: 'button', title },
            onClick: guardAction(action),
        });
    }

    /**
     * Builds the complete button bar.
     * @returns {HTMLElement} Button bar.
     */
    function buildBar() {
        const { CLASSES: C, IDS: I } = CONFIG;
        const presetButtons = state.settings.presets.map((amount) => createBarButton(
            formatCompact(amount),
            `Add ${formatDollars(amount)}`,
            () => fillPreset(amount),
        ));

        const row = createEl('div', { className: C.ROW }, [
            createEl('span', { className: C.LABEL, text: 'Withdraw:' }),
            ...presetButtons,
            createBarButton('Paste', 'Fill the withdrawal amount from your clipboard', handlePaste),
        ]);

        return createEl('div', { id: I.BAR }, [
            row,
            createEl('div', { id: I.NOTICE, attrs: { role: 'status', 'aria-live': 'polite' } }),
        ]);
    }

    /**
     * Adds the bar if the vault is present and syncs button availability.
     * @returns {void}
     */
    function renderBar() {
        const refs = getVaultRefs();
        if (!refs) return;

        if (!document.getElementById(CONFIG.IDS.BAR)) {
            const bar = buildBar();
            const anchor = refs.wrap.querySelector(CONFIG.SELECTORS.BAR_ANCHOR);
            if (anchor) anchor.after(bar);
            else refs.wrap.append(bar);
        }
        syncButtons(refs);
    }

    /**
     * Replaces the bar after settings change.
     * @returns {void}
     */
    function rebuildBar() {
        document.getElementById(CONFIG.IDS.BAR)?.remove();
        renderBar();
    }

    /**
     * Enables or disables the bar based on current state.
     * @param {VaultRefs|null} [refs] Current vault controls.
     * @returns {void}
     */
    function syncButtons(refs = getVaultRefs()) {
        const disabled = !refs || isSharingDisabled(refs.wrap);
        document.querySelectorAll(`#${CONFIG.IDS.BAR} button`).forEach((button) => {
            if (button.disabled !== disabled) button.disabled = disabled;
        });
    }

    /**
     * Sets an input and notifies Torn's form handler.
     * @param {HTMLInputElement} input Visible money input.
     * @param {number} amount Amount to set.
     * @returns {void}
     */
    function setMoneyInput(input, amount) {
        input.value = String(amount);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /**
     * Checks whether Torn currently allows clicking a submit button.
     * @param {HTMLInputElement} submit Submit button.
     * @returns {boolean} True when enabled.
     */
    function isSubmitEnabled(submit) {
        return !submit.disabled && !submit.classList.contains('disabled');
    }

    /**
     * Confirms Torn has accepted the exact withdrawal amount.
     * @param {number} amount Expected amount.
     * @returns {boolean} True when ready to submit.
     */
    function isWithdrawReady(amount) {
        const refs = getVaultRefs();
        return Boolean(
            refs
            && parseDisplayedMoney(refs.withdrawHidden.value) === amount
            && isSubmitEnabled(refs.withdrawSubmit),
        );
    }

    /**
     * Waits for a DOM-backed condition without polling.
     * @param {() => boolean} predicate Condition to evaluate.
     * @param {Node} root Node to observe.
     * @param {number} timeoutMs Maximum wait.
     * @returns {Promise<boolean>} Whether the condition became true.
     */
    function waitFor(predicate, root, timeoutMs) {
        return new Promise((resolve) => {
            if (predicate()) {
                resolve(true);
                return;
            }

            let timer = 0;
            const observer = new MutationObserver(() => {
                if (predicate()) finish(true);
            });

            /**
             * Stops waiting and resolves the promise.
             * @param {boolean} result Wait result.
             * @returns {void}
             */
            function finish(result) {
                observer.disconnect();
                clearTimeout(timer);
                resolve(result);
            }

            observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
            timer = setTimeout(() => finish(predicate()), timeoutMs);
        });
    }

    /**
     * Reads the vault balance for a user action.
     * @returns {number} Vault balance.
     * @throws {Error} When the balance cannot be read.
     */
    function requireVaultBalance() {
        const balance = readMoney(CONFIG.SELECTORS.VAULT_BALANCE);
        if (balance === null) throw new Error('Could not read your vault balance.');
        return balance;
    }

    /**
     * Fills a withdrawal, capped at the vault balance.
     * @param {number} requested Requested amount.
     * @returns {number} Amount filled.
     * @throws {Error} When the vault is empty or unavailable.
     */
    function fillCappedWithdrawal(requested) {
        const refs = requireVaultRefs();
        const balance = requireVaultBalance();
        if (balance <= 0) throw new Error('Your vault is empty.');

        const amount = Math.min(requested, balance);
        setMoneyInput(refs.withdrawVisible, amount);
        showNotice(
            amount < requested
                ? `Capped at your vault balance: ${formatDollars(amount)}.`
                : `Filled ${formatDollars(amount)}.`,
        );
        return amount;
    }

    /**
     * Highlights Torn's Withdraw button for a human click.
     * @param {HTMLInputElement} submit Withdraw button.
     * @returns {void}
     */
    function highlightSubmit(submit) {
        document.querySelectorAll(`.${CONFIG.CLASSES.HIGHLIGHT}`).forEach((element) => {
            element.classList.remove(CONFIG.CLASSES.HIGHLIGHT);
        });
        submit.classList.add(CONFIG.CLASSES.HIGHLIGHT);
        submit.focus();
        clearTimeout(state.highlightTimer);
        state.highlightTimer = setTimeout(() => {
            submit.classList.remove(CONFIG.CLASSES.HIGHLIGHT);
        }, CONFIG.HIGHLIGHT_MS);
    }

    /**
     * Adds a preset to the current withdrawal amount and highlights Withdraw.
     * @param {number} preset Preset amount to add.
     * @returns {Promise<void>} Resolves after the highlight is applied.
     * @throws {Error} When Torn does not accept the amount.
     */
    async function fillPreset(preset) {
        const refs = requireVaultRefs();
        const current = parseDisplayedMoney(refs.withdrawHidden.value) ?? 0;
        const amount = fillCappedWithdrawal(current + preset);
        const ready = await waitFor(() => isWithdrawReady(amount), refs.withdrawForm, CONFIG.FORM_READY_TIMEOUT_MS);
        if (!ready) throw new Error('The amount was filled, but Torn did not enable Withdraw.');

        highlightSubmit(requireVaultRefs().withdrawSubmit);
    }

    /**
     * Reads the clipboard and fills the withdrawal field.
     * @returns {Promise<void>} Resolves after filling.
     * @throws {Error} When clipboard access or parsing fails.
     */
    async function handlePaste() {
        let text;
        try {
            text = await navigator.clipboard.readText();
        } catch (error) {
            throw new Error(error?.name === 'NotAllowedError'
                ? 'Clipboard access was denied. Please allow it and try again.'
                : 'Could not read your clipboard.');
        }

        const amount = parseAmount(text);
        if (amount === null) throw new Error('Clipboard does not contain a valid amount.');
        fillCappedWithdrawal(amount);
    }

    /**
     * Opens the settings panel.
     * @returns {void}
     */
    function openSettings() {
        const { CLASSES: C, IDS: I } = CONFIG;
        document.getElementById(I.SETTINGS)?.remove();

        const presetsInput = createEl('input', {
            attrs: { type: 'text', value: state.settings.presets.map(formatCompact).join(', ') },
        });
        const error = createEl('div', { className: C.ERROR, attrs: { role: 'alert' } });

        /**
         * Closes the settings panel.
         * @returns {void}
         */
        const close = () => {
            document.removeEventListener('keydown', onKeydown);
            overlay.remove();
        };

        /**
         * Closes the panel when Escape is pressed.
         * @param {KeyboardEvent} event Keyboard event.
         * @returns {void}
         */
        function onKeydown(event) {
            if (event.key === 'Escape') close();
        }

        /**
         * Validates and stores settings.
         * @returns {void}
         */
        function save() {
            const parsedPresets = parsePresetList(presetsInput.value);
            if (parsedPresets.error) {
                error.textContent = parsedPresets.error;
                return;
            }

            state.settings = normalizeSettings({ presets: parsedPresets.presets });
            Storage.set('settings', state.settings);
            close();
            rebuildBar();
            showNotice('Settings saved.');
        }

        const panel = createEl('div', {
            className: C.PANEL,
            attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Vault Withdraw Buttons settings' },
        }, [
            createEl('h2', { text: 'Vault Withdraw Buttons' }),
            createEl('label', { className: C.FIELD, text: 'Withdraw presets' }, [
                presetsInput,
                createEl('span', { className: C.HINT, text: 'Example: 2m, 5m, 10m, 20m, 30m, 60m' }),
            ]),
            error,
            createEl('div', { className: C.ACTIONS }, [
                createEl('button', { className: 'torn-btn', text: 'Cancel', attrs: { type: 'button' }, onClick: close }),
                createEl('button', { className: 'torn-btn', text: 'Save', attrs: { type: 'button' }, onClick: save }),
            ]),
        ]);

        const overlay = createEl('div', { id: I.SETTINGS }, [panel]);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close();
        });
        document.addEventListener('keydown', onKeydown);
        document.body.append(overlay);
        presetsInput.focus();
    }

    // =========================================================================
    // OBSERVERS
    // =========================================================================

    /**
     * Creates a trailing debounced function.
     * @param {() => void} fn Function to debounce.
     * @param {number} delayMs Debounce delay.
     * @returns {() => void} Debounced function.
     */
    function debounce(fn, delayMs) {
        let timer = 0;
        return () => {
            clearTimeout(timer);
            timer = setTimeout(fn, delayMs);
        };
    }

    /**
     * Runs a render and reports failures without breaking Torn's page.
     * @returns {void}
     */
    function safeRender() {
        try {
            renderBar();
        } catch (error) {
            log('Render failed', error);
            showNotice('Vault buttons could not update.', true);
        }
    }

    const scheduleRender = debounce(safeRender, CONFIG.OBSERVER_DEBOUNCE_MS);
    const pageObserver = new MutationObserver(scheduleRender);
    let observing = false;

    /**
     * Checks whether the current URL is the vault tab.
     * @returns {boolean} True on the vault tab.
     */
    function isVaultTab() {
        return window.location.href.includes(CONFIG.VAULT_TAB_MARKER);
    }

    /**
     * Connects or disconnects the observer for the current tab.
     * @returns {void}
     */
    function syncObserver() {
        if (isVaultTab()) {
            if (!observing) {
                pageObserver.observe(document.body, { childList: true, subtree: true });
                observing = true;
            }
            safeRender();
        } else if (observing) {
            pageObserver.disconnect();
            observing = false;
        }
    }

    // =========================================================================
    // INIT
    // =========================================================================

    /**
     * Starts the script.
     * @returns {void}
     */
    function init() {
        try {
            injectStyles();
            GM_registerMenuCommand('Settings', openSettings);
            window.addEventListener('hashchange', syncObserver);
            window.addEventListener('pagehide', () => {
                pageObserver.disconnect();
                observing = false;
            });
            syncObserver();
        } catch (error) {
            console.error('[Vault Withdraw Buttons] Failed to start.', error);
        }
    }

    init();
})();