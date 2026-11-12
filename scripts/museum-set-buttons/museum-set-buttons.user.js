// ==UserScript==
// @name         Museum Set Buttons
// @namespace    dadgum.torn.museum-set-buttons
// @version      2.0.0
// @description  A small tab on the item market with one-click links to every museum flower and plushie, how many of each you own, and how many full sets you can trade in.
// @author       Titanic_ [2968477] (rewrite by DadGum [3158823])
// @license      MIT
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      api.torn.com
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/museum-set-buttons/museum-set-buttons.user.js
// @downloadURL  https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/museum-set-buttons/museum-set-buttons.user.js
// ==/UserScript==

/*
 * PURPOSE
 *   Adds a small tab to the right edge of the item market. It opens a panel listing the 11 museum
 *   flowers and 13 museum plushies. Clicking one opens the market on that item. With an API key it
 *   also shows how many of each you own, how many full sets you can trade in, and what is missing.
 *   Links only: the script never buys, sells or clicks anything for you.
 *
 * CREDITS AND LICENSE
 *   Based on Museum Set Buttons v1.0 by Titanic_ [2968477], released under the MIT License.
 *
 * API KEY USAGE DISCLOSURE (the key is optional; links work without it)
 *   Data storage:        Key, panel state, and your flower and plushie counts (cached 15 minutes),
 *                        locally in Tampermonkey storage.
 *   Data sharing:        None. Requests go only to api.torn.com.
 *   Purpose of use:      Showing how many museum flowers and plushies you own.
 *   Key storage/sharing: Stored locally, sent only in the Authorization header, never logged.
 *   Key access level:    Minimal Access (inventory).
 *
 * REQUESTS (item market only, tagged comment=MuseumSetButtons)
 *   GET /v2/user/inventory?cat=Flower&limit=250   When the market opens, then at most every
 *   GET /v2/user/inventory?cat=Plushie&limit=250  15 minutes while the tab is visible (Minimal)
 *   GET /v2/key/info                               When saving a key
 *   At most 2 calls per 15 minutes, and none on other pages.
 *
 * CHANGELOG
 *   2.0.0  Rewrite. Links open the new item market (the old market address no longer exists).
 *          Only on the item market, as a small tab instead of a fixed panel over the page. Owned
 *          counts, tradeable sets and missing items from your inventory (optional Minimal key).
 *          Settings in Tampermonkey storage instead of shared page storage.
 *   1.0    Original by Titanic_.
 */

(() => {
    'use strict';

    // =========================================================================
    // CONFIG
    // =========================================================================

    const CONFIG = Object.freeze({
        DEBUG: false,
        SCRIPT_NAME: 'Museum Set Buttons',
        API_BASE: 'https://api.torn.com/v2',
        API_COMMENT: 'MuseumSetButtons',
        STORAGE_PREFIX: 'tms_msb_',
        STORAGE_KEYS: Object.freeze({
            API_KEY: 'api_key',
            SETTINGS_SHOWN: 'settings_shown',
            UI: 'ui',
            COUNTS: 'counts',
        }),
        /** Torn caches inventory for 15 minutes, so asking more often returns the same data. */
        COUNTS_TTL_MS: 15 * 60 * 1000,
        BACKOFF_MS: 60 * 1000,
        RATE_LIMIT: Object.freeze({ MAX_CALLS: 50, WINDOW_MS: 60 * 1000 }),
        REQUEST_TIMEOUT_MS: 20000,
        CHECK_MS: 60 * 1000,
        NOTICE_MS: 6000,
        MARKET_URL: 'https://www.torn.com/page.php?sid=ItemMarket#/market/view=category',
        IMAGE_URL: 'https://www.torn.com/images/items/{id}/small.png',
        /** Museum sets: market category, inventory category, and item IDs (checked against the Torn wiki). */
        SETS: Object.freeze([
            {
                key: 'flowers',
                title: 'Flowers',
                category: 'Flower',
                items: Object.freeze([
                    ['Dahlia', 260], ['Orchid', 264], ['African Violet', 282], ['Cherry Blossom', 277], ['Peony', 276], ['Ceibo Flower', 271],
                    ['Edelweiss', 272], ['Crocus', 263], ['Heather', 267], ['Tribulus Omanese', 385], ['Banana Orchid', 617],
                ]),
            },
            {
                key: 'plushies',
                title: 'Plushies',
                category: 'Plushie',
                items: Object.freeze([
                    ['Sheep', 186], ['Teddy Bear', 187], ['Kitten', 215], ['Jaguar', 258], ['Wolverine', 261], ['Nessie', 266], ['Red Fox', 268],
                    ['Monkey', 269], ['Chamois', 273], ['Panda', 274], ['Lion', 281], ['Camel', 384], ['Stingray', 618],
                ]),
            },
        ]),
        IDS: Object.freeze({ TAB: 'tms-msb-tab', PANEL: 'tms-msb-panel', SETTINGS: 'tms-msb-settings', NOTICE: 'tms-msb-notice' }),
        API_ERROR_MESSAGES: Object.freeze({
            0: "Torn's API had an unknown error. Try again shortly.",
            1: 'No API key was sent. Open Settings and enter your key.',
            2: 'Your API key is incorrect. Open Settings and enter it again.',
            3: 'Torn rejected the request type. The script may need an update.',
            4: 'Torn rejected the requested data. The script may need an update.',
            5: "Torn's API rate limit was reached. Retrying in a minute.",
            6: 'Torn rejected an ID in the request.',
            7: 'This key cannot read that data.',
            8: 'Torn has temporarily blocked this IP address from the API.',
            9: "Torn's API is currently disabled.",
            10: 'The API key owner is in federal jail.',
            11: 'This key was changed too recently. Try again in a moment.',
            12: 'Torn could not read this API key. Try again shortly.',
            13: 'This API key is temporarily disabled.',
            14: 'This key has reached its daily read limit.',
            15: 'Torn returned a temporary error. Try again shortly.',
            16: "This key's access level is too low. Owned counts need a Minimal Access key.",
            17: "Torn's API had a backend error. Try again shortly.",
            18: 'This API key is paused by its owner.',
            19: 'This key must be migrated to the new key system.',
            20: 'This race has not finished yet.',
            21: 'Torn rejected the category in the request.',
            22: 'This selection is only available in API v1.',
            23: 'This selection is only available in API v2.',
            24: 'This API endpoint is temporarily closed.',
        }),
    });

    const K = CONFIG.STORAGE_KEYS;

    /**
     * Writes a debug message when debugging is enabled. Never pass the API key.
     * @param {...*} args Values to log.
     * @returns {void}
     */
    function log(...args) {
        if (CONFIG.DEBUG) console.debug('[MSB]', ...args);
    }

    // =========================================================================
    // STORAGE
    // =========================================================================

    const Storage = {
        /**
         * Reads and deserializes a stored value.
         * @param {string} key Unprefixed key.
         * @param {*} fallback Value returned when missing or invalid.
         * @returns {*} Stored value or fallback.
         */
        get(key, fallback) {
            const raw = GM_getValue(CONFIG.STORAGE_PREFIX + key, null);
            if (raw === null || raw === undefined) return fallback;
            try {
                return JSON.parse(raw);
            } catch {
                return fallback;
            }
        },

        /**
         * Serializes and stores a value.
         * @param {string} key Unprefixed key.
         * @param {*} value JSON-serializable value.
         * @returns {void}
         */
        set(key, value) {
            GM_setValue(CONFIG.STORAGE_PREFIX + key, JSON.stringify(value));
        },

        /**
         * Removes a stored value.
         * @param {string} key Unprefixed key.
         * @returns {void}
         */
        remove(key) {
            GM_deleteValue(CONFIG.STORAGE_PREFIX + key);
        },
    };

    /**
     * Reads the saved API key.
     * @returns {string} Key, or an empty string.
     */
    function getApiKey() {
        return Storage.get(K.API_KEY, '');
    }

    /**
     * Reads the panel state (open, and which groups are collapsed).
     * @returns {{open: boolean, collapsed: Object<string, boolean>}} State.
     */
    function getUiState() {
        const ui = Storage.get(K.UI, {});
        return { open: Boolean(ui?.open), collapsed: ui?.collapsed && typeof ui.collapsed === 'object' ? ui.collapsed : {} };
    }

    // =========================================================================
    // CACHE
    // =========================================================================

    const Cache = {
        /**
         * Reads your cached counts when younger than the TTL (shared across tabs).
         * @returns {?Object<string, number>} Counts by item ID, or null.
         */
        getCounts() {
            const entry = Storage.get(K.COUNTS, null);
            if (!entry || typeof entry.ts !== 'number' || Date.now() - entry.ts >= CONFIG.COUNTS_TTL_MS) return null;
            return entry.counts || null;
        },

        /**
         * Reads your last counts regardless of age (shown while refreshing).
         * @returns {?{ts: number, counts: Object<string, number>}} Entry, or null.
         */
        lastCounts() {
            return Storage.get(K.COUNTS, null);
        },

        /**
         * Saves counts with the current time.
         * @param {Object<string, number>} counts Counts by item ID.
         * @returns {void}
         */
        setCounts(counts) {
            Storage.set(K.COUNTS, { ts: Date.now(), counts });
        },

        /**
         * Clears cached counts.
         * @returns {void}
         */
        clear() {
            Storage.remove(K.COUNTS);
        },
    };

    // =========================================================================
    // API
    // =========================================================================

    /** A request failure with Torn's error code when one was returned. */
    class ApiRequestError extends Error {
        /**
         * Creates a request error.
         * @param {string} message Readable message.
         * @param {number|null} [code=null] Torn API error code.
         */
        constructor(message, code = null) {
            super(message);
            this.name = 'ApiRequestError';
            this.code = code;
        }
    }

    const RateLimiter = {
        /** @type {number[]} */
        calls: [],

        /**
         * Waits for a slot in the sliding window and claims it.
         * @returns {Promise<void>} Resolves when a request may be sent.
         */
        async acquire() {
            const { MAX_CALLS, WINDOW_MS } = CONFIG.RATE_LIMIT;
            for (;;) {
                const now = Date.now();
                this.calls = this.calls.filter((time) => now - time < WINDOW_MS);
                if (this.calls.length < MAX_CALLS) {
                    this.calls.push(now);
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, this.calls[0] + WINDOW_MS - now));
            }
        },
    };

    /**
     * Converts a Torn API error object to a readable error.
     * @param {{code: number, error: string}} apiError Error from the response.
     * @returns {ApiRequestError} Readable error.
     */
    function toApiError(apiError) {
        const code = Number(apiError?.code);
        const message = CONFIG.API_ERROR_MESSAGES[code]
            || `Torn API error ${Number.isFinite(code) ? code : '?'}: ${apiError?.error || 'request rejected'}`;
        return new ApiRequestError(message, Number.isFinite(code) ? code : null);
    }

    const api = {
        /**
         * Sends one rate-limited GET request to Torn API v2.
         * @param {string} path Path such as "/user/inventory".
         * @param {Object<string, string|number>} [params={}] Query parameters.
         * @param {string} [key=getApiKey()] API key, sent only in the header.
         * @returns {Promise<Object>} Parsed response.
         * @throws {ApiRequestError} On missing key, network, HTTP, parsing, or API errors.
         */
        async get(path, params = {}, key = getApiKey()) {
            if (!key) throw new ApiRequestError(CONFIG.API_ERROR_MESSAGES[1], 1);
            await RateLimiter.acquire();
            const url = new URL(CONFIG.API_BASE + path);
            Object.entries({ ...params, comment: CONFIG.API_COMMENT }).forEach(([name, value]) => url.searchParams.set(name, String(value)));
            const response = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url.href,
                    headers: { Accept: 'application/json', Authorization: `ApiKey ${key}` },
                    timeout: CONFIG.REQUEST_TIMEOUT_MS,
                    onload: resolve,
                    onerror: () => reject(new ApiRequestError('Could not reach the Torn API.')),
                    ontimeout: () => reject(new ApiRequestError('The Torn API request timed out.')),
                });
            });
            let data;
            try {
                data = JSON.parse(response.responseText);
            } catch {
                throw new ApiRequestError(`Torn API returned an unreadable response (HTTP ${response.status}).`);
            }
            if (data?.error) throw toApiError(data.error);
            if (response.status < 200 || response.status >= 300) throw new ApiRequestError(`Torn API HTTP ${response.status}.`);
            return data;
        },

        /**
         * Reads a key's access level.
         * @param {string} key Key to check.
         * @returns {Promise<{level: number, type: string}>} Access summary.
         * @throws {ApiRequestError} When the key is rejected.
         */
        async keyInfo(key) {
            const data = await this.get('/key/info', {}, key);
            const access = data?.info?.access;
            if (!access || !Number.isFinite(access.level)) throw new ApiRequestError('Unexpected key info format.');
            return { level: access.level, type: String(access.type || '') };
        },

        /**
         * Loads your items in one inventory category.
         * @param {string} category Flower or Plushie.
         * @returns {Promise<Array<{id: number, amount: number, faction_owned: boolean}>>} Items.
         * @throws {ApiRequestError} When the request fails.
         */
        async inventory(category) {
            const data = await this.get('/user/inventory', { cat: category, limit: 250 });
            const items = data?.inventory?.items;
            if (!Array.isArray(items)) throw new ApiRequestError('Unexpected inventory format.');
            return items;
        },
    };

    // =========================================================================
    // DATA (no DOM access)
    // =========================================================================

    /**
     * Totals inventory entries by item ID. Faction-owned items are left out (they cannot be traded in).
     * @param {Array<{id: number, amount: number, faction_owned?: boolean}>} items Inventory entries.
     * @returns {Object<string, number>} Counts by item ID.
     */
    function countItems(items) {
        const counts = {};
        for (const item of items) {
            if (item?.faction_owned) continue;
            const id = Number(item?.id);
            const amount = Number(item?.amount) || 0;
            if (id > 0 && amount > 0) counts[id] = (counts[id] || 0) + amount;
        }
        return counts;
    }

    /**
     * Full sets you can trade in, and what is missing for the next one.
     * @param {{items: ReadonlyArray<[string, number]>}} set Museum set.
     * @param {Object<string, number>} counts Counts by item ID.
     * @returns {{sets: number, missing: string[]}} Complete sets and items short for one more.
     */
    function setSummary(set, counts) {
        const amounts = set.items.map(([, id]) => counts[id] || 0);
        const sets = Math.min(...amounts);
        const missing = set.items.filter(([, id]) => (counts[id] || 0) <= sets).map(([name]) => name);
        return { sets, missing };
    }

    /**
     * Item market address for one item.
     * @param {string} category Market category (Flower or Plushie).
     * @param {number} id Item ID.
     * @returns {string} URL.
     */
    function marketUrl(category, id) {
        return `${CONFIG.MARKET_URL}&categoryName=${encodeURIComponent(category)}&itemID=${id}`;
    }

    /**
     * Describes how old the counts are.
     * @param {number} ts Time saved.
     * @returns {string} Text like "updated 4m ago".
     */
    function ageText(ts) {
        const minutes = Math.floor((Date.now() - ts) / 60000);
        return minutes < 1 ? 'updated just now' : `updated ${minutes}m ago`;
    }

    // =========================================================================
    // UI
    // =========================================================================

    /**
     * Creates an element without parsing HTML.
     * @param {string} tag Tag name.
     * @param {{id?: string, className?: string, text?: string, title?: string, attrs?: Object<string, string>, onClick?: EventListener}} [options={}] Options.
     * @param {Array<Node|string|null|false|undefined>} [children=[]] Children; empty values are skipped.
     * @returns {HTMLElement} Element.
     */
    function createEl(tag, options = {}, children = []) {
        const element = document.createElement(tag);
        if (options.id) element.id = options.id;
        if (options.className) element.className = options.className;
        if (options.text !== undefined) element.textContent = options.text;
        if (options.title) element.title = options.title;
        Object.entries(options.attrs ?? {}).forEach(([name, value]) => element.setAttribute(name, value));
        if (options.onClick) element.addEventListener('click', options.onClick);
        element.append(...children.filter((child) => child !== null && child !== false && child !== undefined));
        return element;
    }

    /**
     * Lets Enter and Space activate an element that acts as a button.
     * @param {HTMLElement} element Element with a click handler.
     * @returns {HTMLElement} The element.
     */
    function activateOnKey(element) {
        element.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                element.click();
            }
        });
        return element;
    }

    /**
     * Injects the script's styles. All selectors use the tms-msb prefix.
     * @returns {void}
     */
    function injectStyles() {
        const { TAB, PANEL, SETTINGS, NOTICE } = CONFIG.IDS;
        GM_addStyle(`
            #${TAB} { position: fixed; z-index: 99990; top: 35%; right: 0; padding: 8px 5px; writing-mode: vertical-rl; border: 1px solid #555; border-right: 0; border-radius: 6px 0 0 6px; background: #222; color: #ddd; font: bold 12px Arial, sans-serif; cursor: pointer; box-shadow: -2px 2px 6px rgba(0,0,0,0.4); }
            #${TAB}:hover { color: #fff; background: #2d2d2d; }
            #${PANEL} { position: fixed; z-index: 99991; top: 12%; right: 0; width: 230px; max-height: 76vh; overflow-y: auto; border: 1px solid #555; border-right: 0; border-radius: 6px 0 0 6px; background: #1d1d1f; color: #ddd; font: 12px Arial, sans-serif; box-shadow: -2px 2px 8px rgba(0,0,0,0.5); }
            #${PANEL} .tms-msb-head { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid #333; font-weight: bold; }
            #${PANEL} .tms-msb-head span { flex: 1; }
            #${PANEL} .tms-msb-btn { padding: 1px 6px; border: 1px solid #555; border-radius: 3px; background: #333; color: #ddd; cursor: pointer; font-size: 11px; }
            #${PANEL} .tms-msb-btn:hover { border-color: #888; color: #fff; }
            #${PANEL} .tms-msb-group-head { padding: 6px 8px; background: #26262a; cursor: pointer; user-select: none; }
            #${PANEL} .tms-msb-summary { padding: 2px 8px 4px; color: #9a9a9a; font-size: 11px; }
            #${PANEL} a.tms-msb-item { display: flex; align-items: center; gap: 6px; padding: 3px 8px; color: #ddd; text-decoration: none; }
            #${PANEL} a.tms-msb-item:hover { background: #2c2c30; color: #fff; }
            #${PANEL} a.tms-msb-item img { width: 30px; height: 15px; object-fit: contain; }
            #${PANEL} a.tms-msb-item .tms-msb-name { flex: 1; }
            #${PANEL} .tms-msb-count { min-width: 22px; text-align: right; font-weight: bold; }
            #${PANEL} .tms-msb-have { color: #6fcf86; }
            #${PANEL} .tms-msb-none { color: #ef6b5f; }
            #${PANEL} .tms-msb-short { background: rgba(239,107,95,0.08); }
            #${PANEL} .tms-msb-foot { padding: 6px 8px; border-top: 1px solid #333; color: #9a9a9a; font-size: 11px; }
            #${PANEL} .tms-msb-error { color: #ef6b5f; }
            #${SETTINGS} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); }
            #${SETTINGS} .tms-msb-dialog { box-sizing: border-box; width: 420px; max-width: 94vw; padding: 16px; border-radius: 6px; background: #1b1b1b; color: #e6e6e6; font: 13px/1.4 Arial, sans-serif; }
            #${SETTINGS} h2 { margin: 0 0 8px; font-size: 16px; }
            #${SETTINGS} input { box-sizing: border-box; width: 100%; margin: 8px 0; padding: 6px; -webkit-text-security: disc; }
            #${SETTINGS} button { margin: 8px 6px 0 0; padding: 5px 10px; cursor: pointer; }
            #${NOTICE} { position: fixed; z-index: 100001; right: 16px; bottom: 16px; max-width: 340px; padding: 8px 12px; border-left: 4px solid #e64d1a; border-radius: 5px; background: #2a2a2a; color: #eee; font: 12px Arial, sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,0.5); }
        `);
    }

    let noticeTimer = null;

    /**
     * Shows a small notice in the corner.
     * @param {string} message Text.
     * @returns {void}
     */
    function showNotice(message) {
        document.getElementById(CONFIG.IDS.NOTICE)?.remove();
        const notice = createEl('div', { id: CONFIG.IDS.NOTICE, text: message, attrs: { role: 'status' } });
        document.body.append(notice);
        clearTimeout(noticeTimer);
        noticeTimer = setTimeout(() => notice.remove(), CONFIG.NOTICE_MS);
    }

    /**
     * Builds one item link with its icon and owned count.
     * @param {string} category Market category.
     * @param {string} name Item name.
     * @param {number} id Item ID.
     * @param {?Object<string, number>} counts Counts, or null when unknown.
     * @param {boolean} short True when this item is holding back the next set.
     * @returns {HTMLElement} Link.
     */
    function buildItem(category, name, id, counts, short) {
        const owned = counts ? counts[id] || 0 : null;
        const count = createEl('span', {
            className: `tms-msb-count ${owned === null ? '' : owned > 0 ? 'tms-msb-have' : 'tms-msb-none'}`.trim(),
            text: owned === null ? '—' : String(owned),
            title: owned === null ? 'Add an API key in Settings to see how many you own' : `You own ${owned}`,
        });
        return createEl('a', {
            className: `tms-msb-item${short ? ' tms-msb-short' : ''}`,
            title: `Open ${name} on the item market`,
            attrs: { href: marketUrl(category, id), 'data-item': String(id) },
        }, [
            createEl('img', { attrs: { src: CONFIG.IMAGE_URL.replace('{id}', String(id)), alt: '', loading: 'lazy' } }),
            createEl('span', { className: 'tms-msb-name', text: name }),
            count,
        ]);
    }

    /**
     * Builds one set group: header, set summary and item links.
     * @param {Object} set Museum set.
     * @param {?Object<string, number>} counts Counts, or null when unknown.
     * @param {boolean} collapsed Group collapsed.
     * @returns {HTMLElement} Group.
     */
    function buildGroup(set, counts, collapsed) {
        const summary = counts ? setSummary(set, counts) : null;
        const head = createEl('div', {
            className: 'tms-msb-group-head',
            text: `${collapsed ? '▶' : '▼'} ${set.title} (${set.items.length})`,
            attrs: { role: 'button', tabindex: '0', 'aria-expanded': String(!collapsed) },
            onClick: () => {
                const ui = getUiState();
                ui.collapsed[set.key] = !collapsed;
                Storage.set(K.UI, ui);
                render();
            },
        });
        activateOnKey(head);
        const children = [head];
        if (summary) {
            const text = summary.sets > 0 ? `Full sets: ${summary.sets}` : 'Full sets: 0';
            const missingText = summary.missing.length && summary.missing.length < set.items.length
                ? ` · Next set needs ${summary.missing.length > 4 ? `${summary.missing.length} items (shaded below)` : summary.missing.join(', ')}`
                : summary.missing.length === set.items.length && summary.sets === 0 ? ' · None owned yet' : '';
            children.push(createEl('div', { className: 'tms-msb-summary', text: text + missingText }));
        }
        if (!collapsed) {
            const shortIds = new Set(summary && summary.missing.length < set.items.length ? set.items.filter(([name]) => summary.missing.includes(name)).map(([, id]) => id) : []);
            set.items.forEach(([name, id]) => children.push(buildItem(set.category, name, id, counts, shortIds.has(id))));
        }
        return createEl('div', { className: 'tms-msb-group', attrs: { 'data-set': set.key } }, children);
    }

    /**
     * Draws the tab, and the panel when it is open.
     * @returns {void}
     */
    function render() {
        const ui = getUiState();
        let tab = document.getElementById(CONFIG.IDS.TAB);
        if (!tab) {
            tab = createEl('div', {
                id: CONFIG.IDS.TAB,
                text: 'Museum sets',
                attrs: { role: 'button', tabindex: '0', title: 'Museum flowers and plushies' },
                onClick: () => setOpen(!getUiState().open),
            });
            activateOnKey(tab);
            document.body.append(tab);
        }
        document.getElementById(CONFIG.IDS.PANEL)?.remove();
        tab.style.display = ui.open ? 'none' : '';
        if (!ui.open) return;
        const last = Cache.lastCounts();
        const counts = getApiKey() && last?.counts ? last.counts : null;
        let footText = 'Add an API key in Settings to see how many you own.';
        if (getApiKey()) footText = Counts.error || (last?.ts ? `Counts ${ageText(last.ts)}` : 'Loading counts...');
        const panel = createEl('div', { id: CONFIG.IDS.PANEL, attrs: { role: 'dialog', 'aria-label': CONFIG.SCRIPT_NAME } }, [
            createEl('div', { className: 'tms-msb-head' }, [
                createEl('span', { text: '🌸 Museum sets' }),
                getApiKey() ? createEl('button', { className: 'tms-msb-btn', text: '↻', title: 'Refresh counts', attrs: { type: 'button' }, onClick: () => Counts.refresh({ force: true }) }) : null,
                createEl('button', { className: 'tms-msb-btn', text: '⚙', title: 'Settings', attrs: { type: 'button' }, onClick: () => openSettings() }),
                createEl('button', { className: 'tms-msb-btn', text: '✕', title: 'Close', attrs: { type: 'button' }, onClick: () => setOpen(false) }),
            ]),
            ...CONFIG.SETS.map((set) => buildGroup(set, counts, Boolean(ui.collapsed[set.key]))),
            createEl('div', { className: `tms-msb-foot${Counts.error ? ' tms-msb-error' : ''}`, text: footText }),
        ]);
        document.body.append(panel);
    }

    /**
     * Opens or closes the panel and remembers it.
     * @param {boolean} open New state.
     * @returns {void}
     */
    function setOpen(open) {
        Storage.set(K.UI, { ...getUiState(), open });
        render();
        if (open) Counts.refresh();
    }

    /**
     * Tests and saves a key from Settings.
     * @param {HTMLInputElement} input Key field.
     * @param {HTMLElement} status Status line.
     * @returns {Promise<boolean>} True when saved.
     */
    async function saveKey(input, status) {
        const key = input.value.trim();
        if (!/^[A-Za-z0-9]{16}$/.test(key)) {
            status.textContent = 'That does not look like a Torn API key (16 letters and numbers).';
            return false;
        }
        status.textContent = 'Checking key...';
        try {
            const info = await api.keyInfo(key);
            if (info.level < 2 && info.type !== 'Custom') {
                status.textContent = 'Key not saved. Owned counts need Minimal Access or higher.';
                return false;
            }
            Storage.set(K.API_KEY, key);
            Cache.clear();
            input.value = '';
            input.placeholder = 'Key saved. Paste a new key to replace it.';
            status.textContent = `Key saved (${info.type || 'access level ' + info.level}).`;
            return true;
        } catch (error) {
            status.textContent = `Key not saved. ${error.message || error}`;
            return false;
        }
    }

    /**
     * Opens Settings. The saved key is never placed in the page.
     * @returns {void}
     */
    function openSettings() {
        if (document.getElementById(CONFIG.IDS.SETTINGS)) return;
        Storage.set(K.SETTINGS_SHOWN, true);
        const input = createEl('input', {
            attrs: {
                type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'data-lpignore': 'true', 'data-1p-ignore': 'true',
                'aria-label': 'Torn API key', placeholder: getApiKey() ? 'Key saved. Paste a new key to replace it.' : 'Minimal Access API key (optional)',
            },
        });
        const status = createEl('div', { attrs: { role: 'status' } });
        const close = () => overlay.remove();
        const save = async () => {
            if (!input.value.trim()) return close();
            if (await saveKey(input, status)) Counts.refresh({ force: true });
            return undefined;
        };
        const overlay = createEl('div', { id: CONFIG.IDS.SETTINGS }, [
            createEl('div', { className: 'tms-msb-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': `${CONFIG.SCRIPT_NAME} settings` } }, [
                createEl('h2', { text: CONFIG.SCRIPT_NAME }),
                createEl('div', { text: 'Optional: a Minimal Access key shows how many of each flower and plushie you own. Without one, the links still work. The key is stored only in Tampermonkey and sent only to api.torn.com.' }),
                input,
                createEl('button', { text: 'Save', attrs: { type: 'button' }, onClick: save }),
                createEl('button', {
                    text: 'Remove key',
                    attrs: { type: 'button' },
                    onClick: () => {
                        Storage.remove(K.API_KEY);
                        Cache.clear();
                        input.placeholder = 'Minimal Access API key (optional)';
                        status.textContent = 'API key removed.';
                        render();
                    },
                }),
                createEl('button', { text: 'Close', attrs: { type: 'button' }, onClick: close }),
                status,
            ]),
        ]);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close();
        });
        overlay.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') close();
            if (event.key === 'Enter' && event.target === input) save();
        });
        document.body.append(overlay);
        input.focus();
    }

    // =========================================================================
    // COUNTS (inventory refresh)
    // =========================================================================

    const Counts = {
        busy: false,
        error: '',
        backoffUntil: 0,

        /**
         * Loads flower and plushie counts unless fresh ones are cached. Errors are shown in the panel.
         * @param {{force?: boolean}} [options] Ignore the cache.
         * @returns {Promise<void>} Resolves when done.
         */
        async refresh({ force = false } = {}) {
            if (this.busy || !getApiKey()) return;
            if (!force && (Cache.getCounts() || Date.now() < this.backoffUntil)) return;
            this.busy = true;
            try {
                const lists = await Promise.all(CONFIG.SETS.map((set) => api.inventory(set.category)));
                Cache.setCounts(countItems(lists.flat()));
                this.error = '';
            } catch (error) {
                this.error = error.message || String(error);
                if (error?.code === 5) this.backoffUntil = Date.now() + CONFIG.BACKOFF_MS;
                if (error?.code === 2 || error?.code === 16) showNotice(this.error);
                log('Count refresh failed:', this.error);
            } finally {
                this.busy = false;
            }
            render();
        },
    };

    // =========================================================================
    // INIT
    // =========================================================================

    /**
     * Entry point: adds the tab, and keeps counts fresh while the panel is open and the tab visible.
     * @returns {void}
     */
    function init() {
        try {
            injectStyles();
            GM_registerMenuCommand('Settings', () => openSettings());
            GM_registerMenuCommand('Clear cache', () => {
                Cache.clear();
                Counts.refresh({ force: true });
            });
            render();
            if (!getApiKey() && !Storage.get(K.SETTINGS_SHOWN, false)) openSettings();
            if (getUiState().open) Counts.refresh();
            setInterval(() => {
                if (!document.hidden && getUiState().open) Counts.refresh();
            }, CONFIG.CHECK_MS);
        } catch (error) {
            console.error('[MSB] Start-up failed:', error);
            showNotice(`${CONFIG.SCRIPT_NAME} could not start: ${error.message || error}`);
        }
    }

    init();
})();
