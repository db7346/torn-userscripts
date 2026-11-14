// ==UserScript==
// @name         Torn Crimes Helper
// @namespace    dadgum.torn.crimes-helper
// @version      2.0.0
// @description  Crimes 2.0 helper: market links on items you are missing, an enhancer check, forum guide links, and a crime chain counter. Works without TornTools; the API key is optional.
// @author       TiltGod5000 (rewrite by DadGum [3158823])
// @license      MIT
// @match        https://www.torn.com/loader.php?sid=crimes*
// @match        https://www.torn.com/page.php?sid=crimes*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @sandbox      JavaScript
// @connect      api.torn.com
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/crimes-helper/crimes-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/crimes-helper/crimes-helper.user.js
// ==/UserScript==

/*
 * PURPOSE
 *   On the Crimes 2.0 pages:
 *     - Items you have none of get a small cart icon that opens that item on the item market.
 *     - The crime title shows a check mark when you own that crime's enhancer, or a red link to the
 *       market when you don't.
 *     - A link to the crime's in-depth forum guide sits in the header.
 *     - A crime chain counter: success +1, failure halves it, critical failure resets it to 0.
 *   The counter reads the crime results Torn already sends your browser (no API calls, no key,
 *   TornTools not needed). An optional Full Access key catches up on crimes done elsewhere.
 *   Links and counting only: the script never commits crimes, buys or clicks anything for you.
 *
 * CREDITS AND LICENSE
 *   Based on Torn Crimes 2.0 Helper 1.0.0 by TiltGod5000, released under the MIT License.
 *   Guide links point to the community's in-depth guides on the Torn forums.
 *
 * API KEY USAGE DISCLOSURE (the key is optional; everything except log catch-up works without it)
 *   Data storage:        Key, chain count, the time of the last counted crime and your settings,
 *                        locally in Tampermonkey storage. Crime logs are read and discarded.
 *   Data sharing:        None. Requests go only to api.torn.com.
 *   Purpose of use:      Counting crimes done on other devices or with this page closed.
 *   Key storage/sharing: Stored locally, sent only in the Authorization header, never logged.
 *   Key access level:    Full Access (logs need it), or a Custom key with the crime log category.
 *
 * REQUESTS (crimes pages only, tagged comment=CrimesHelper)
 *   GET /v2/user/log?cat=136&from=<last counted>&limit=100   Once per page load (Full)
 *   GET /v2/user/log?cat=136&limit=100[&to=<oldest>]         Rebuild button: up to 10 pages,
 *                                                            1.5 seconds apart (Full)
 *   GET /v2/key/info                                         When saving a key
 *   Without a key: no requests at all.
 *
 * CHANGELOG
 *   2.0.0  Rewrite. Market links work again (Torn renamed the empty-item class) and sit beside
 *          Torn's Add button instead of inside it. Reads Torn's crime results itself, so the
 *          enhancer check and counter no longer need TornTools. Enhancer check can't crash before
 *          your enhancer is known. API v2 with the key in a header instead of the URL; key and
 *          count in Tampermonkey storage instead of shared page storage (moved over once).
 *          Catch-up on page load reads only new logs. Settings panel with key check. Arson added
          (guide, enhancer, and market links in its item picker).
 *   1.0.0  Original by TiltGod5000.
 */

(() => {
    'use strict';

    // =========================================================================
    // CONFIG
    // =========================================================================

    const CONFIG = Object.freeze({
        DEBUG: false,
        SCRIPT_NAME: 'Torn Crimes Helper',
        API_BASE: 'https://api.torn.com/v2',
        API_COMMENT: 'CrimesHelper',
        STORAGE_PREFIX: 'tms_ch_',
        STORAGE_KEYS: Object.freeze({
            API_KEY: 'api_key',
            CHAIN: 'chain',
            SETTINGS: 'settings',
            SETTINGS_SHOWN: 'settings_shown',
            MIGRATED: 'migrated',
        }),
        DEFAULT_SETTINGS: Object.freeze({ catchUpOnLoad: true }),
        /** Storage entry written by 1.0.0, moved over once. */
        LEGACY_STORAGE_KEY: 'crimeChain',
        /** Event TornTools fires with each page fetch; used only if our own reader sees nothing. */
        TORNTOOLS_EVENT: 'tt-fetch',

        RATE_LIMIT: Object.freeze({ MAX_CALLS: 50, WINDOW_MS: 60 * 1000 }),
        REQUEST_TIMEOUT_MS: 20000,
        BACKOFF_MS: 60 * 1000,
        NOTICE_MS: 6000,
        OBSERVER_THROTTLE_MS: 250,
        RESET_CONFIRM_MS: 4000,

        /** Crime log category (1.0.0 used the same one). */
        LOG_CATEGORY: 136,
        LOG_PAGE_LIMIT: 100,
        MAX_LOG_PAGES: 10,
        LOG_PAGE_GAP_MS: 1500,
        /** Log titles start with these (1.0.0 matched the same prefixes). */
        LOG_PREFIX: Object.freeze({ SUCCESS: 'Crime success', FAILURE: 'Crime fail', CRITICAL: 'Crime critical' }),
        /** Outcome results in Torn's crime responses. */
        OUTCOME: Object.freeze({ SUCCESS: 'success', FAILURE: 'failure', CRITICAL: 'critical failure' }),

        MARKET_URL: 'https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=',

        /**
         * Torn's class names end in a random hash, so these match on the readable part.
         * MISSING_ITEM is Torn's greyed-out image for an item you have none of; it lost its old
         * "silhouette_" wrapper in a Torn update, which is what broke 1.0.0's links.
         */
        SELECTORS: Object.freeze({
            APP: '.crimes-app',
            HEADER: '.crimes-app-header',
            HEADER_RULE: '.crimes-app > hr',
            TORN_LINK: '[class*="link_"]',
            CRIME_TITLE: '.crime-root [class*="title__"]',
            MISSING_ITEM: 'img[class*="silhouetteImage"]',
            /** The tile's Add button when it has one (the badge goes beside it), else the tile itself. */
            TILE_BUTTON: 'button',
            TILE_CELL: '[class*="itemCell"]',
            /** Where missing items are looked for: the crime itself, and the item picker (Arson). */
            ITEM_SCOPES: '.crimes-app, [class*="itemSelector"]',
        }),

        /** Crime page (from the URL hash), forum guide, and enhancer item ID. */
        CRIMES: Object.freeze({
            searchforcash: { title: '[Crimes 2.0] Search For Cash: An In-Depth Guide', thread: 16343473, enhancer: 564 },
            bootlegging: { title: '[Crimes 2.0] Bootlegging: An in-depth guide', thread: 16341811, enhancer: 565 },
            graffiti: { title: '[Crimes 2.0] Graffiti: An In-Depth Guide', thread: 16344567, enhancer: 979 },
            shoplifting: { title: '[Crimes 2.0] Shoplifting: An In-Depth Guide', thread: 16346491, enhancer: 566 },
            cardskimming: { title: '[Crimes 2.0] Card Skimming: An In-Depth Guide', thread: 16350490, enhancer: 578 },
            burglary: { title: '[Crimes 2.0] Burglary: An In-Depth Guide', thread: 16353303, enhancer: 1351 },
            pickpocketing: { title: '[Crimes 2.0] Pickpocketing: An In-Depth Guide', thread: 16358739, enhancer: 567 },
            hustling: { title: '[Crimes 2.0] Hustling: An In-Depth Guide', thread: 16363421, enhancer: 1353 },
            disposal: { title: '[Crimes 2.0] Disposal: An In-Depth Guide', thread: 16367936, enhancer: 633 },
            cracking: { title: '[Crimes 2.0] Cracking: An In-Depth Guide', thread: 16373016, enhancer: 1354 },
            forgery: { title: '[Crimes 2.0] Forgery: An In-Depth Guide', thread: 16388086, enhancer: 1346 },
            scamming: { title: '[Crimes 2.0] Scamming: An In-Depth Guide', thread: 16418415, enhancer: 571 },
            arson: { title: '[Crimes 2.0] Arson: An In-Depth Guide', thread: 16510947, enhancer: 544 },
        }),
        GUIDE_URL: 'https://www.torn.com/forums.php#/p=threads&f=61&t=',

        IDS: Object.freeze({ SETTINGS: 'tms-ch-settings', NOTICE: 'tms-ch-notice' }),
        API_ERROR_MESSAGES: Object.freeze({
            0: "Torn's API had an unknown error. Try again shortly.",
            1: 'No API key was sent. Open Settings and enter your key.',
            2: 'Your API key is incorrect. Open Settings and enter it again.',
            3: 'Torn rejected the request type. The script may need an update.',
            4: 'Torn rejected the requested data. The script may need an update.',
            5: "Torn's API rate limit was reached. Try again in a minute.",
            6: 'Torn rejected an ID in the request.',
            7: 'This key cannot read that data.',
            8: 'Torn has temporarily blocked this IP address from the API.',
            9: "Torn's API is currently disabled.",
            10: 'The API key owner is in federal jail.',
            11: 'This key was changed too recently. Try again in a moment.',
            12: 'Torn could not read this API key. Try again shortly.',
            13: 'This API key is temporarily disabled.',
            14: 'This key has reached its daily read limit.',
            15: 'Torn could not load your logs right now. Try again shortly.',
            16: "This key's access level is too low. Crime log catch-up needs a Full Access key.",
            17: "Torn's API had a backend error. Try again shortly.",
            18: 'This API key is paused by its owner.',
            19: 'Torn says this account must move to Crimes 2.0 first.',
            20: 'This race has not finished yet.',
            21: 'Torn rejected the log category. The script may need an update.',
            22: 'This selection is only available in API v1.',
            23: 'This selection is only available in API v2.',
            24: 'This API endpoint is temporarily closed.',
            25: 'Torn rejected a requested stat.',
            26: 'Torn only allows a category or stats in this request.',
            27: 'Torn says this faction must move to Organized Crimes 2.0 first.',
            28: 'Torn rejected a log ID. The script may need an update.',
            29: 'Torn does not allow a category with interaction logs.',
            30: 'Torn could not find that file.',
            31: "Torn's city stats are temporarily unavailable.",
            32: 'This endpoint is closed until the attacking period.',
            33: 'No competition is running.',
        }),
    });

    const K = CONFIG.STORAGE_KEYS;
    const S = CONFIG.SELECTORS;
    /** The page's own window, where Torn's fetch lives (needs @sandbox JavaScript in Chrome). */
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    /**
     * Writes a debug message when debugging is enabled. Never pass the API key.
     * @param {...*} args Values to log.
     * @returns {void}
     */
    function log(...args) {
        if (CONFIG.DEBUG) console.debug('[CH]', ...args);
    }

    /**
     * Waits a number of milliseconds.
     * @param {number} ms Delay.
     * @returns {Promise<void>} Resolves after the delay.
     */
    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
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
     * Reads settings merged over the defaults.
     * @returns {{catchUpOnLoad: boolean}} Settings.
     */
    function getSettings() {
        const saved = Storage.get(K.SETTINGS, {});
        return { ...CONFIG.DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
    }

    /**
     * @typedef {Object} ChainState
     * @property {number} chain Current chain value.
     * @property {?number} lastTs Unix seconds of the last counted crime, or null when unknown.
     */

    /**
     * Reads the chain state. Read fresh before every change so two open tabs don't overwrite each other.
     * @returns {ChainState} State.
     */
    function getChainState() {
        const saved = Storage.get(K.CHAIN, null);
        const chain = Number(saved?.chain);
        const lastTs = Number(saved?.lastTs);
        return { chain: Number.isFinite(chain) && chain >= 0 ? chain : 0, lastTs: Number.isFinite(lastTs) && lastTs > 0 ? lastTs : null };
    }

    /**
     * Saves the chain state.
     * @param {ChainState} state State.
     * @returns {void}
     */
    function setChainState(state) {
        Storage.set(K.CHAIN, { chain: state.chain, lastTs: state.lastTs });
    }

    /**
     * Moves 1.0.0's count and key out of shared page storage, once. The key is deleted from page
     * storage (any script on Torn can read it there); the rest of the old entry is left for rollback.
     * @returns {void}
     */
    function migrateLegacy() {
        if (Storage.get(K.MIGRATED, false)) return;
        Storage.set(K.MIGRATED, true);
        let legacy = null;
        try {
            legacy = JSON.parse(pageWindow.localStorage.getItem(CONFIG.LEGACY_STORAGE_KEY) || 'null');
        } catch {
            return;
        }
        if (!legacy || typeof legacy !== 'object') return;
        const chain = Number(legacy.chain);
        const lastTs = Number(legacy.lastTimeStamp);
        if (!Storage.get(K.CHAIN, null) && Number.isFinite(chain) && chain >= 0) {
            setChainState({ chain, lastTs: Number.isFinite(lastTs) && lastTs > 0 ? lastTs : null });
        }
        if (typeof legacy.apiKey === 'string' && legacy.apiKey) {
            if (!getApiKey() && /^[A-Za-z0-9]{16}$/.test(legacy.apiKey)) Storage.set(K.API_KEY, legacy.apiKey);
            delete legacy.apiKey;
            try {
                pageWindow.localStorage.setItem(CONFIG.LEGACY_STORAGE_KEY, JSON.stringify(legacy));
            } catch (error) {
                log('Could not remove the old key from page storage:', error?.message);
            }
        }
        log('Moved 1.0.0 data');
    }

    // =========================================================================
    // CACHE
    // =========================================================================

    /*
     * Nothing here needs caching: crime results arrive from the page, and logs are read once per
     * page load from the last counted crime onward. The chain state above is the only stored data.
     */

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
                await sleep(this.calls[0] + WINDOW_MS - now);
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

    /**
     * @typedef {Object} UserLog One entry of /v2/user/log (spec schema UserLog).
     * @property {string} id Log entry ID.
     * @property {number} timestamp Unix seconds.
     * @property {{id: number, title: string, category: string}} details Log type.
     */

    const api = {
        /** Unix ms until which requests are paused after a rate-limit error. */
        backoffUntil: 0,

        /**
         * Sends one rate-limited GET request to Torn API v2.
         * @param {string} path Path such as "/user/log".
         * @param {Object<string, string|number>} [params={}] Query parameters.
         * @param {string} [key=getApiKey()] API key, sent only in the header.
         * @returns {Promise<Object>} Parsed response.
         * @throws {ApiRequestError} On missing key, back-off, network, HTTP, parsing, or API errors.
         */
        async get(path, params = {}, key = getApiKey()) {
            if (!key) throw new ApiRequestError(CONFIG.API_ERROR_MESSAGES[1], 1);
            if (Date.now() < this.backoffUntil) throw new ApiRequestError(CONFIG.API_ERROR_MESSAGES[5], 5);
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
            if (data?.error) {
                const error = toApiError(data.error);
                if (error.code === 5) this.backoffUntil = Date.now() + CONFIG.BACKOFF_MS;
                throw error;
            }
            if (response.status < 200 || response.status >= 300) throw new ApiRequestError(`Torn API HTTP ${response.status}.`);
            return data;
        },

        /**
         * Reads a key's access level and whether it can read the crime log.
         * @param {string} key Key to check.
         * @returns {Promise<{level: number, type: string, crimeLog: boolean}>} Access summary.
         * @throws {ApiRequestError} When the key is rejected.
         */
        async keyInfo(key) {
            const data = await this.get('/key/info', {}, key);
            const access = data?.info?.access;
            if (!access || !Number.isFinite(access.level)) throw new ApiRequestError('Unexpected key info format.');
            const logs = Array.isArray(access.log?.available) ? access.log.available : [];
            return {
                level: access.level,
                type: String(access.type || ''),
                crimeLog: logs.some((entry) => Number(entry?.category_id) === CONFIG.LOG_CATEGORY),
            };
        },

        /**
         * Reads one page of your crime logs.
         * @param {{from?: number, to?: number}} [range={}] Unix-second bounds: after `from`, up to and including `to`.
         * @returns {Promise<UserLog[]>} Log entries.
         * @throws {ApiRequestError} When the request fails.
         */
        async crimeLogs(range = {}) {
            const params = { cat: CONFIG.LOG_CATEGORY, limit: CONFIG.LOG_PAGE_LIMIT };
            if (range.from) params.from = range.from;
            if (range.to) params.to = range.to;
            const data = await this.get('/user/log', params);
            if (!Array.isArray(data?.log)) throw new ApiRequestError('Unexpected log format.');
            return data.log;
        },
    };

    // =========================================================================
    // DATA (no DOM access)
    // =========================================================================

    /** @typedef {'success'|'failure'|'critical'} CrimeResult */

    /**
     * Applies one crime result to the chain: success +1, failure halves it, critical failure resets it.
     * @param {number} chain Current chain.
     * @param {?CrimeResult} result Result, or null for anything else.
     * @returns {number} New chain.
     */
    function applyResult(chain, result) {
        if (result === 'success') return chain + 1;
        if (result === 'failure') return chain / 2;
        if (result === 'critical') return 0;
        return chain;
    }

    /**
     * Reads the result from Torn's crime response. 1.0.0 only reset on a critical failure that
     * came with an outcome ID, and that is kept.
     * @param {?{result?: string, ID?: *}} outcome DB.outcome from the response.
     * @returns {?CrimeResult} Result, or null when it doesn't count.
     */
    function resultFromOutcome(outcome) {
        const result = String(outcome?.result || '').toLowerCase();
        if (result === CONFIG.OUTCOME.SUCCESS) return 'success';
        if (result === CONFIG.OUTCOME.FAILURE) return 'failure';
        if (result === CONFIG.OUTCOME.CRITICAL && outcome.ID !== null && outcome.ID !== undefined) return 'critical';
        return null;
    }

    /**
     * Reads the result from a crime log title.
     * @param {string} title Log title, such as "Crime success".
     * @returns {?CrimeResult} Result, or null for other crime logs.
     */
    function resultFromLogTitle(title) {
        const text = String(title || '');
        if (text.startsWith(CONFIG.LOG_PREFIX.CRITICAL)) return 'critical';
        if (text.startsWith(CONFIG.LOG_PREFIX.SUCCESS)) return 'success';
        if (text.startsWith(CONFIG.LOG_PREFIX.FAILURE)) return 'failure';
        return null;
    }

    /**
     * Removes duplicate entries and orders logs oldest first. Logs in the same second keep Torn's
     * order (Torn returns newest first, so that order is reversed).
     * @param {UserLog[]} logs Entries in Torn's order, possibly from several pages.
     * @returns {UserLog[]} Unique entries, oldest first.
     */
    function sortLogsOldestFirst(logs) {
        const seen = new Set();
        const unique = logs.filter((entry) => {
            const id = String(entry?.id ?? '');
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return Number.isFinite(Number(entry.timestamp));
        });
        return unique.reverse().map((entry, index) => ({ entry, index }))
            .sort((a, b) => Number(a.entry.timestamp) - Number(b.entry.timestamp) || a.index - b.index)
            .map(({ entry }) => entry);
    }

    /**
     * Replays logs onto a starting chain.
     * @param {number} start Chain before the first log.
     * @param {UserLog[]} logs Entries, oldest first.
     * @returns {{chain: number, lastTs: ?number, counted: number}} Result and the newest timestamp.
     */
    function replayLogs(start, logs) {
        let chain = start;
        let lastTs = null;
        let counted = 0;
        for (const entry of logs) {
            const result = resultFromLogTitle(entry?.details?.title);
            if (result) {
                chain = applyResult(chain, result);
                counted += 1;
            }
            lastTs = Number(entry.timestamp);
        }
        return { chain, lastTs, counted };
    }

    /**
     * Whether a batch of logs (newest first, as Torn returns them) contains a critical failure.
     * @param {UserLog[]} logs Entries.
     * @returns {boolean} True when one was found.
     */
    function hasCritical(logs) {
        return logs.some((entry) => resultFromLogTitle(entry?.details?.title) === 'critical');
    }

    /**
     * Crime page key from the URL hash ("#/forgery" -> "forgery").
     * @param {string} hash location.hash.
     * @returns {string} Key, or an empty string on the crimes hub.
     */
    function crimeKeyFromHash(hash) {
        return /^#\/([a-z0-9]+)/i.exec(String(hash || ''))?.[1]?.toLowerCase() || '';
    }

    /**
     * Item ID from a Torn item image address ("/images/items/1321i/medium.png" -> 1321).
     * @param {string} src Image address.
     * @returns {?number} Item ID, or null.
     */
    function itemIdFromSrc(src) {
        const id = Number(/\/items\/(\d+)/.exec(String(src || ''))?.[1]);
        return Number.isInteger(id) && id > 0 ? id : null;
    }

    /**
     * Item name from Torn's labels. The image text is used when it has one:
     *   "Add: Adhesive Plastic, 0 units added, 0"  -> "Adhesive Plastic"
     *   "Plant Kabuki Mask as evidence, 0"         -> "Kabuki Mask"
     * Otherwise the button label (Arson's item picker leaves the image text empty):
     *   "Molotov Cocktail 0 owned Igniting is unavailable at this stage" -> "Molotov Cocktail"
     * @param {string} alt Image alt text.
     * @param {string} [label=''] The tile button's aria-label.
     * @returns {string} Name, or an empty string.
     */
    function itemName(alt, label = '') {
        const fromAlt = String(alt || '').split(',')[0]
            .replace(/^\s*(add|requires)\s*:\s*/i, '')
            .replace(/^\s*plant\s+(.+?)\s+as evidence\s*$/i, '$1')
            .trim();
        if (fromAlt) return fromAlt;
        return /^\s*(.+?)\s+\d[\d,]*\s+owned\b/i.exec(String(label || ''))?.[1]?.trim() || '';
    }

    /**
     * Item market address for one item.
     * @param {number} id Item ID.
     * @returns {string} URL.
     */
    function marketUrl(id) {
        return CONFIG.MARKET_URL + id;
    }

    /**
     * Formats the chain like 1.0.0 (two decimals, since failures halve it).
     * @param {number} chain Chain.
     * @returns {string} Text.
     */
    function formatChain(chain) {
        return chain.toFixed(2);
    }

    // =========================================================================
    // INTERCEPT (reads Torn's crime responses; never changes them)
    // =========================================================================

    const Intercept = {
        /**
         * Which reader delivered the first crimes data ("page" or "torntools"). Only that one is used
         * afterwards, so one result is never counted twice.
         * @type {?string}
         */
        source: null,
        /** @type {Array<function(Object): void>} */
        handlers: [],

        /**
         * Registers a handler for each crimes response body that has a DB object.
         * @param {function(Object): void} handler Receives the response's DB object.
         * @returns {void}
         */
        onData(handler) {
            this.handlers.push(handler);
        },

        /**
         * Passes a parsed response to the handlers if it is crimes data from the active reader.
         * @param {*} json Parsed body.
         * @param {string} source Reader name.
         * @returns {void}
         */
        deliver(json, source) {
            const db = json?.DB;
            if (!db || typeof db !== 'object') return;
            if (!this.source) {
                this.source = source;
                log('Reading crime data from', source);
            }
            if (this.source !== source) return;
            this.handlers.forEach((handler) => {
                try {
                    handler(db);
                } catch (error) {
                    console.error('[CH] Handler failed:', error);
                }
            });
        },

        /**
         * Reads a copy of one response body. Torn's own copy is untouched.
         * @param {Response} response Page fetch response.
         * @returns {Promise<void>} Resolves when read.
         */
        async inspect(response) {
            try {
                if (!/json/i.test(response?.headers?.get?.('content-type') || '')) return;
                this.deliver(await response.clone().json(), 'page');
            } catch (error) {
                log('Could not read a response:', error?.message);
            }
        },

        /**
         * Wraps the page's fetch so responses can be read, and listens to TornTools as a fallback.
         * Must run at document-start, before Torn loads the first crime.
         * @returns {void}
         */
        install() {
            try {
                const original = pageWindow.fetch;
                if (typeof original !== 'function') throw new Error('fetch not found');
                const self = this;
                const wrapped = function (...args) {
                    const promise = original.apply(pageWindow, args);
                    promise.then((response) => self.inspect(response), () => {});
                    return promise;
                };
                pageWindow.fetch = typeof exportFunction === 'function' ? exportFunction(wrapped, pageWindow) : wrapped;
            } catch (error) {
                console.warn('[CH] Could not read page requests; relying on TornTools if installed.', error?.message);
            }
            pageWindow.addEventListener(CONFIG.TORNTOOLS_EVENT, (event) => this.deliver(event?.detail?.json, 'torntools'));
        },
    };

    // =========================================================================
    // CHAIN
    // =========================================================================

    const Chain = {
        busy: false,
        /** @type {Array<function(): void>} */
        listeners: [],

        /**
         * Registers a callback for chain changes.
         * @param {function(): void} listener Callback.
         * @returns {void}
         */
        onChange(listener) {
            this.listeners.push(listener);
        },

        /**
         * Notifies listeners.
         * @returns {void}
         */
        changed() {
            this.listeners.forEach((listener) => listener());
        },

        /**
         * Counts one crime seen on this page.
         * @param {CrimeResult} result Result.
         * @returns {void}
         */
        record(result) {
            const state = getChainState();
            setChainState({ chain: applyResult(state.chain, result), lastTs: Math.floor(Date.now() / 1000) });
            this.changed();
        },

        /**
         * Sets the chain to 0 from now on.
         * @returns {void}
         */
        reset() {
            setChainState({ chain: 0, lastTs: Math.floor(Date.now() / 1000) });
            this.changed();
        },

        /**
         * Counts crimes logged since the last counted one (done elsewhere or with this page closed).
         * Rebuilds instead when there is no starting point or too many new logs for one page.
         * @returns {Promise<void>} Resolves when done; errors are shown as a notice.
         */
        async catchUp() {
            const { lastTs } = getChainState();
            if (!lastTs) return this.rebuild();
            if (this.busy) return undefined;
            this.busy = true;
            this.changed();
            try {
                const logs = await api.crimeLogs({ from: lastTs });
                if (logs.length >= CONFIG.LOG_PAGE_LIMIT) {
                    this.busy = false;
                    return this.rebuild();
                }
                if (logs.length) {
                    const state = getChainState();
                    const result = replayLogs(state.chain, sortLogsOldestFirst(logs).filter((entry) => Number(entry.timestamp) > (state.lastTs || 0)));
                    if (result.lastTs) setChainState({ chain: result.chain, lastTs: result.lastTs });
                    log('Caught up', result.counted, 'crimes');
                }
            } catch (error) {
                this.fail('Catch-up', error);
            } finally {
                this.busy = false;
                this.changed();
            }
            return undefined;
        },

        /**
         * Recounts from your crime log, going back to your last critical failure (at most
         * MAX_LOG_PAGES pages), and replaces the stored chain.
         * @returns {Promise<void>} Resolves when done; errors are shown as a notice.
         */
        async rebuild() {
            if (this.busy) return;
            this.busy = true;
            this.changed();
            try {
                const all = [];
                const seen = new Set();
                let page = await api.crimeLogs();
                for (let pages = 1; ; pages += 1) {
                    const fresh = page.filter((entry) => !seen.has(String(entry?.id)));
                    fresh.forEach((entry) => seen.add(String(entry?.id)));
                    all.push(...fresh);
                    // Stop at the newest critical failure, the end of the log, or the page cap.
                    // "to" includes its own second, so a page with nothing new means the end too.
                    if (!fresh.length || hasCritical(fresh) || page.length < CONFIG.LOG_PAGE_LIMIT || pages >= CONFIG.MAX_LOG_PAGES) break;
                    const oldest = Math.min(...page.map((entry) => Number(entry.timestamp)));
                    await sleep(CONFIG.LOG_PAGE_GAP_MS);
                    page = await api.crimeLogs({ to: oldest });
                }
                const ordered = sortLogsOldestFirst(all);
                let start = 0;
                ordered.forEach((entry, index) => {
                    if (resultFromLogTitle(entry?.details?.title) === 'critical') start = index;
                });
                const result = replayLogs(0, ordered.slice(start));
                setChainState({ chain: result.chain, lastTs: result.lastTs || Math.floor(Date.now() / 1000) });
                showNotice(`Crime chain rebuilt from ${ordered.length} log entr${ordered.length === 1 ? 'y' : 'ies'}: ${formatChain(result.chain)}.`);
            } catch (error) {
                this.fail('Rebuild', error);
            } finally {
                this.busy = false;
                this.changed();
            }
        },

        /**
         * Shows a readable error for a failed log read.
         * @param {string} action What failed.
         * @param {Error} error Error.
         * @returns {void}
         */
        fail(action, error) {
            const message = error?.message || String(error);
            showNotice(`${action} failed: ${message}`);
            if (error?.code === 2) openSettings();
            log(action, 'failed:', message);
        },
    };

    /** Enhancer data from the latest crimes response, tagged with the crime page it arrived on. */
    const Enhancer = {
        /** @type {?{crime: string, name: string, available: boolean}} */
        current: null,

        /**
         * Stores the enhancer from a crimes response.
         * @param {*} enhancer DB.currentUserStats.enhancer.
         * @returns {boolean} True when it changed.
         */
        update(enhancer) {
            if (!enhancer || typeof enhancer !== 'object') return false;
            const next = { crime: crimeKeyFromHash(location.hash), name: String(enhancer.name || 'Enhancer'), available: Boolean(enhancer.available) };
            const same = this.current && ['crime', 'name', 'available'].every((field) => this.current[field] === next[field]);
            this.current = next;
            return !same;
        },
    };

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
     * Injects the script's styles. All selectors use the tms-ch prefix.
     * @returns {void}
     */
    function injectStyles() {
        const { SETTINGS, NOTICE } = CONFIG.IDS;
        GM_addStyle(`
            .tms-ch-host { position: relative; }
            a.tms-ch-market { position: absolute; z-index: 2; top: 1px; left: 1px; display: flex; padding: 1px; border-radius: 2px; color: #8fd18f; opacity: 0.4; line-height: 0; transition: opacity 0.12s; }
            a.tms-ch-market svg { width: 12px; height: 12px; fill: currentColor; }
            .tms-ch-host:hover > a.tms-ch-market, a.tms-ch-market:focus-visible { opacity: 1; background: rgba(20,20,20,0.75); }
            a.tms-ch-market:hover { color: #fff; }
            .tms-ch-enhancer { padding-left: 1rem; font-size: inherit; }
            a.tms-ch-enhancer { color: #e05a4f; text-decoration: none; }
            a.tms-ch-enhancer:hover { text-decoration: underline; }
            a.tms-ch-guide { display: inline-flex; align-items: center; gap: 4px; }
            a.tms-ch-guide svg { width: 16px; height: 16px; fill: currentColor; }
            .tms-ch-chain { display: flex; align-items: center; gap: 6px; padding: 2px 0 6px; font-weight: bold; }
            .tms-ch-chain button { display: inline-flex; padding: 1px 3px; border: 0; background: none; color: inherit; cursor: pointer; }
            .tms-ch-chain button:disabled { cursor: progress; }
            .tms-ch-chain svg { width: 11px; height: 11px; fill: currentColor; }
            .tms-ch-chain.tms-ch-busy svg { animation: tms-ch-spin 1s linear infinite; }
            @keyframes tms-ch-spin { to { transform: rotate(360deg); } }
            #${SETTINGS} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); }
            #${SETTINGS} .tms-ch-dialog { box-sizing: border-box; width: 440px; max-width: 94vw; padding: 16px; border-radius: 6px; background: #1b1b1b; color: #e6e6e6; font: 13px/1.4 Arial, sans-serif; }
            #${SETTINGS} h2 { margin: 0 0 8px; font-size: 16px; }
            #${SETTINGS} input[type="text"] { box-sizing: border-box; width: 100%; margin: 8px 0; padding: 6px; -webkit-text-security: disc; }
            #${SETTINGS} label { display: block; margin: 8px 0; }
            #${SETTINGS} button { margin: 8px 6px 0 0; padding: 5px 10px; cursor: pointer; }
            #${SETTINGS} .tms-ch-section { margin-top: 12px; padding-top: 10px; border-top: 1px solid #333; }
            #${SETTINGS} .tms-ch-status { min-height: 18px; margin-top: 8px; color: #bbb; }
            #${NOTICE} { position: fixed; z-index: 100001; right: 16px; bottom: 16px; max-width: 340px; padding: 8px 12px; border-left: 4px solid #e64d1a; border-radius: 5px; background: #2a2a2a; color: #eee; font: 12px Arial, sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,0.5); }
        `);
    }

    /** SVG path data for the icons (fixed strings, not page or API data). Cart: Material Icons, Apache 2.0. */
    const ICONS = Object.freeze({
        refresh: { viewBox: '-0.5 0 24 24', d: 'm23.314 8.518v-7.832l-2.84 2.84c-2.172-2.176-5.175-3.522-8.493-3.522-6.627 0-12 5.373-12 12s5.373 12 12 12c4.424 0 8.289-2.394 10.37-5.958l.031-.057-2.662-1.536c-1.57 2.695-4.447 4.478-7.739 4.478-4.93 0-8.927-3.997-8.927-8.927s3.997-8.927 8.927-8.927c2.469 0 4.704 1.002 6.32 2.622l-2.82 2.82h7.834z' },
        cart: { viewBox: '0 0 24 24', d: 'M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1.003 1.003 0 0020 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z' },
        guide: { viewBox: '0 0 16 16', d: 'M1.25 2C.56 2 0 2.56 0 3.25v8.5C0 12.44.56 13 1.25 13H5c.9 0 1.48.2 1.81.45.32.23.44.51.44.8a.75.75 0 101.5 0c0-.29.12-.57.44-.8.33-.25.91-.45 1.81-.45h3.75c.69 0 1.25-.56 1.25-1.25v-8.5C16 2.56 15.44 2 14.75 2H11c-1.15 0-2.1.35-2.77 1A3.13 3.13 0 008 3.3 3.13 3.13 0 007.77 3C7.1 2.35 6.15 2 5 2H1.25zM7.25 5.42c0-.55-.19-1.02-.52-1.34-.33-.33-.88-.58-1.73-.58H1.5v8H5c.88 0 1.64.16 2.25.47V5.42zm1.5 6.55c.61-.31 1.37-.47 2.25-.47h3.5v-8H11c-.85 0-1.4.25-1.73.58-.33.32-.52.79-.52 1.34v6.55z' },
    });

    /**
     * Builds one icon.
     * @param {'refresh'|'guide'|'cart'} name Icon.
     * @returns {SVGSVGElement} Icon.
     */
    function buildIcon(name) {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', ICONS[name].viewBox);
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', ICONS[name].d);
        if (name === 'guide') path.setAttribute('fill-rule', 'evenodd');
        svg.append(path);
        return svg;
    }

    let noticeTimer = null;

    /**
     * Shows a small notice in the corner.
     * @param {string} message Text.
     * @returns {void}
     */
    function showNotice(message) {
        if (!document.body) return;
        document.getElementById(CONFIG.IDS.NOTICE)?.remove();
        const notice = createEl('div', { id: CONFIG.IDS.NOTICE, text: message, attrs: { role: 'status' } });
        document.body.append(notice);
        clearTimeout(noticeTimer);
        noticeTimer = setTimeout(() => notice.remove(), CONFIG.NOTICE_MS);
    }

    /**
     * Adds market badges to items you have none of, and removes badges from items you now have.
     * A tile with a button (Add, or Arson's item picker) gets the badge beside the button, never
     * inside it, so one click opens the market and nothing else. A tile without a button gets the
     * badge inside its own corner.
     * @param {Element[]} scopes Crimes app and any open item picker.
     * @returns {void}
     */
    function renderMarketLinks(scopes) {
        scopes.forEach((scope) => scope.querySelectorAll('a.tms-ch-market').forEach((badge) => {
            const prev = badge.previousElementSibling;
            const tile = prev?.matches?.(S.TILE_BUTTON) ? prev : badge.parentElement;
            const img = tile?.querySelector(S.MISSING_ITEM);
            if (!img || itemIdFromSrc(img.getAttribute('src')) !== Number(badge.dataset.item)) badge.remove();
        }));
        scopes.forEach((scope) => scope.querySelectorAll(S.MISSING_ITEM).forEach((img) => {
            const id = itemIdFromSrc(img.getAttribute('src'));
            // closest() alone would stop at the item cell inside the button, so ask for the button first.
            const button = img.closest(S.TILE_BUTTON);
            const cell = button ? null : img.closest(S.TILE_CELL);
            const host = button ? button.parentElement : cell;
            if (!id || !host) return;
            const existing = button ? button.nextElementSibling : cell.querySelector(':scope > a.tms-ch-market');
            if (existing?.classList.contains('tms-ch-market') && Number(existing.dataset.item) === id) return;
            if (existing?.classList.contains('tms-ch-market')) existing.remove();
            const name = itemName(img.getAttribute('alt'), button?.getAttribute('aria-label')) || `item ${id}`;
            host.classList.add('tms-ch-host');
            const badge = createEl('a', {
                className: 'tms-ch-market',
                title: `Open ${name} on the item market`,
                attrs: { href: marketUrl(id), target: '_blank', rel: 'noopener', 'data-item': String(id), 'aria-label': `Open ${name} on the item market` },
            }, [buildIcon('cart')]);
            badge.addEventListener('click', (event) => event.stopPropagation());
            if (button) button.after(badge);
            else cell.append(badge);
        }));
    }

    /**
     * Shows whether you own the current crime's enhancer, next to the crime title.
     * Nothing is shown until Torn has sent your enhancer for this crime.
     * @returns {void}
     */
    function renderEnhancer() {
        const title = document.querySelector(S.CRIME_TITLE);
        if (!title) return;
        const crimeKey = crimeKeyFromHash(location.hash);
        const crime = CONFIG.CRIMES[crimeKey];
        const info = Enhancer.current?.crime === crimeKey ? Enhancer.current : null;
        const existing = title.querySelector('.tms-ch-enhancer');
        if (!crime || !info) {
            existing?.remove();
            return;
        }
        const state = info.available ? 'owned' : `missing:${info.name}`;
        if (existing?.dataset.state === state) return;
        const badge = info.available
            ? createEl('span', { className: 'tms-ch-enhancer', text: '✅', title: `You own ${info.name}` })
            : createEl('a', {
                className: 'tms-ch-enhancer',
                text: `${info.name} NOT OWNED`,
                title: `Open ${info.name} on the item market`,
                attrs: { href: marketUrl(crime.enhancer), target: '_blank', rel: 'noopener' },
            });
        badge.dataset.state = state;
        if (existing) existing.replaceWith(badge);
        else title.append(badge);
    }

    /**
     * Shows the current crime's forum guide link in the header, matching Torn's link style.
     * @param {Element} root Crimes app.
     * @returns {void}
     */
    function renderGuideLink(root) {
        const header = root.querySelector(S.HEADER);
        if (!header) return;
        const crimeKey = crimeKeyFromHash(location.hash);
        const crime = CONFIG.CRIMES[crimeKey];
        const existing = header.querySelector('a.tms-ch-guide');
        if (!crime) {
            existing?.remove();
            return;
        }
        if (existing?.dataset.crime === crimeKey) return;
        const tornLink = header.querySelector(`${S.TORN_LINK}:not(.tms-ch-guide)`);
        const tornClass = [...(tornLink?.classList || [])].find((name) => name.startsWith('link'));
        const link = createEl('a', {
            className: `tms-ch-guide${tornClass ? ` ${tornClass}` : ''}`,
            title: 'Open the in-depth guide on the forums',
            attrs: { href: CONFIG.GUIDE_URL + crime.thread, target: '_blank', rel: 'noopener', 'data-crime': crimeKey },
        }, [buildIcon('guide'), createEl('span', { text: crime.title })]);
        if (existing) existing.replaceWith(link);
        else header.insertBefore(link, header.querySelector('a'));
    }

    /** The chain line under the header; built once and moved back if Torn re-renders. */
    const ChainView = {
        /** @type {?HTMLElement} */
        element: null,
        /** @type {?Text} */
        label: null,
        /** @type {?HTMLButtonElement} */
        button: null,

        /**
         * Builds the chain line.
         * @returns {HTMLElement} Element.
         */
        build() {
            this.label = document.createTextNode('');
            this.button = createEl('button', {
                attrs: { type: 'button' },
                onClick: () => {
                    if (getApiKey()) Chain.rebuild();
                    else openSettings();
                },
            }, [buildIcon('refresh')]);
            this.element = createEl('div', { className: 'tms-ch-chain' }, [this.label, this.button]);
            this.update();
            return this.element;
        },

        /**
         * Puts the chain line under the header if it isn't there.
         * @param {Element} root Crimes app.
         * @returns {void}
         */
        place(root) {
            if (!this.element) this.build();
            if (root.contains(this.element)) return;
            const rule = root.querySelector(S.HEADER_RULE);
            const header = root.querySelector(S.HEADER);
            if (rule) rule.before(this.element);
            else if (header) header.after(this.element);
        },

        /**
         * Updates the text and button from the stored chain.
         * @returns {void}
         */
        update() {
            if (!this.element) return;
            this.label.textContent = `Current Crime Chain: ${formatChain(getChainState().chain)}`;
            const hasKey = Boolean(getApiKey());
            const label = hasKey ? 'Rebuild from your crime log' : 'Add a Full Access key in Settings to rebuild from your crime log';
            this.button.title = label;
            this.button.setAttribute('aria-label', label);
            this.button.disabled = Chain.busy;
            this.element.classList.toggle('tms-ch-busy', Chain.busy);
        },
    };

    /**
     * Tests and saves a key from Settings. Needs Full Access, or a Custom key with the crime log.
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
            if (info.level < 4 && !(info.type === 'Custom' && info.crimeLog)) {
                status.textContent = `Key not saved. It is ${info.type || `access level ${info.level}`}; reading your crime log needs Full Access.`;
                return false;
            }
            Storage.set(K.API_KEY, key);
            input.value = '';
            input.placeholder = 'Key saved. Paste a new key to replace it.';
            status.textContent = `Key saved (${info.type || `access level ${info.level}`}).`;
            ChainView.update();
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
        if (!document.body || document.getElementById(CONFIG.IDS.SETTINGS)) return;
        Storage.set(K.SETTINGS_SHOWN, true);
        const input = createEl('input', {
            attrs: {
                type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'data-lpignore': 'true', 'data-1p-ignore': 'true',
                'aria-label': 'Torn API key', placeholder: getApiKey() ? 'Key saved. Paste a new key to replace it.' : 'Full Access API key (optional)',
            },
        });
        const status = createEl('div', { className: 'tms-ch-status', attrs: { role: 'status' } });
        const catchUp = createEl('input', { attrs: { type: 'checkbox' } });
        catchUp.checked = getSettings().catchUpOnLoad;
        catchUp.addEventListener('change', () => Storage.set(K.SETTINGS, { ...getSettings(), catchUpOnLoad: catchUp.checked }));
        let resetArmed = false;
        let resetTimer = null;
        const resetButton = createEl('button', {
            text: 'Reset chain to 0',
            attrs: { type: 'button' },
            onClick: () => {
                if (!resetArmed) {
                    resetArmed = true;
                    resetButton.textContent = 'Click again to reset';
                    resetTimer = setTimeout(() => {
                        resetArmed = false;
                        resetButton.textContent = 'Reset chain to 0';
                    }, CONFIG.RESET_CONFIRM_MS);
                    return;
                }
                clearTimeout(resetTimer);
                resetArmed = false;
                resetButton.textContent = 'Reset chain to 0';
                Chain.reset();
                status.textContent = 'Chain reset to 0.';
            },
        });
        const close = () => overlay.remove();
        const save = async () => {
            if (!input.value.trim()) return close();
            if (await saveKey(input, status) && getSettings().catchUpOnLoad) Chain.catchUp();
            return undefined;
        };
        const overlay = createEl('div', { id: CONFIG.IDS.SETTINGS }, [
            createEl('div', { className: 'tms-ch-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': `${CONFIG.SCRIPT_NAME} settings` } }, [
                createEl('h2', { text: CONFIG.SCRIPT_NAME }),
                createEl('div', { text: 'Market links, the enhancer check, guide links and the chain counter all work without a key. The counter counts crimes you do on this page.' }),
                createEl('div', { className: 'tms-ch-section', text: 'Optional: a Full Access key (logs need it) lets the counter catch up on crimes done on other devices or with this page closed. The key is stored only in Tampermonkey and sent only to api.torn.com.' }),
                input,
                createEl('button', { text: 'Save', attrs: { type: 'button' }, onClick: save }),
                createEl('button', {
                    text: 'Remove key',
                    attrs: { type: 'button' },
                    onClick: () => {
                        Storage.remove(K.API_KEY);
                        input.placeholder = 'Full Access API key (optional)';
                        status.textContent = 'API key removed.';
                        ChainView.update();
                    },
                }),
                createEl('label', {}, [catchUp, document.createTextNode(' Catch up from your crime log when the page loads')]),
                createEl('div', { className: 'tms-ch-section' }, [resetButton, createEl('button', { text: 'Close', attrs: { type: 'button' }, onClick: close })]),
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
    // OBSERVERS
    // =========================================================================

    /**
     * The crimes app plus any item picker Torn opened outside it (pickers inside the app are
     * already covered by the app itself).
     * @param {Element} root Crimes app.
     * @returns {Element[]} Elements to search for missing items.
     */
    function itemScopes(root) {
        const outside = [...document.querySelectorAll(S.ITEM_SCOPES)].filter((element) => element !== root && !root.contains(element));
        return [root, ...outside];
    }

    /**
     * Updates everything the script adds to the crimes app. Safe to call often: each part only
     * changes the page when something is missing or out of date.
     * @param {Element} root Crimes app.
     * @returns {void}
     */
    function renderAll(root) {
        [
            ['market links', () => renderMarketLinks(itemScopes(root))],
            ['enhancer', () => renderEnhancer()],
            ['guide link', () => renderGuideLink(root)],
            ['chain', () => ChainView.place(root)],
        ].forEach(([name, render]) => {
            try {
                render();
            } catch (error) {
                console.error(`[CH] Could not update the ${name}:`, error);
            }
        });
    }

    /**
     * Calls a function at most once per interval, with one trailing call so the last change is drawn.
     * @param {function(): void} fn Function.
     * @param {number} ms Interval.
     * @returns {function(): void} Throttled function.
     */
    function throttle(fn, ms) {
        let last = 0;
        let timer = null;
        return () => {
            const wait = last + ms - Date.now();
            if (wait <= 0 && !timer) {
                last = Date.now();
                fn();
                return;
            }
            if (!timer) {
                timer = setTimeout(() => {
                    timer = null;
                    last = Date.now();
                    fn();
                }, Math.max(wait, 0));
            }
        };
    }

    /**
     * Resolves with the first element matching a selector, waiting for it to appear.
     * @param {string} selector CSS selector.
     * @returns {Promise<Element>} Element.
     */
    function waitForElement(selector) {
        const found = document.querySelector(selector);
        if (found) return Promise.resolve(found);
        return new Promise((resolve) => {
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    observer.disconnect();
                    resolve(element);
                }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
        });
    }

    /**
     * Watches the page (Torn swaps crimes without reloading, and may open Arson's item picker
     * outside the crimes app) and redraws on changes.
     * @param {Element} root Crimes app.
     * @returns {function(): void} Redraw function, throttled.
     */
    function watchApp(root) {
        const redraw = throttle(() => renderAll(root), CONFIG.OBSERVER_THROTTLE_MS);
        // class/src changes too: Torn may swap the greyed-out image in place once you own the item.
        new MutationObserver(redraw).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'src'] });
        window.addEventListener('hashchange', redraw);
        return redraw;
    }

    // =========================================================================
    // INIT
    // =========================================================================

    /**
     * Entry point. Reading Torn's responses starts at once (document-start); the page parts start
     * when the crimes app appears.
     * @returns {void}
     */
    function init() {
        try {
            Intercept.install();
            migrateLegacy();
            GM_registerMenuCommand('Settings', () => openSettings());
            injectStyles();
        } catch (error) {
            console.error('[CH] Start-up failed:', error);
            return;
        }

        let redraw = () => {};
        Intercept.onData((db) => {
            if (Enhancer.update(db.currentUserStats?.enhancer)) redraw();
            const result = resultFromOutcome(db.outcome);
            if (result) Chain.record(result);
        });
        Chain.onChange(() => ChainView.update());

        waitForElement(S.APP).then((root) => {
            try {
                redraw = watchApp(root);
                renderAll(root);
                if (getApiKey() && getSettings().catchUpOnLoad) Chain.catchUp();
                if (!getApiKey() && !Storage.get(K.SETTINGS_SHOWN, false)) openSettings();
            } catch (error) {
                console.error('[CH] Could not start on the crimes page:', error);
                showNotice(`${CONFIG.SCRIPT_NAME} could not start: ${error.message || error}`);
            }
        });
    }

    init();
})();
