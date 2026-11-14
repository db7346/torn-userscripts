// ==UserScript==
// @name         OC Helper
// @namespace    torn-userscripts
// @version      6.0.5
// @description  Overview of Organized Crimes 2.0: members not in crimes, members in each crime, and issues with any crimes. Also visible when flying.
// @author       DadGum (based on work by callmericky [3299880])
// @license      GPL-3.0-only
// @match        https://www.torn.com/*
// @updateURL    https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/oc-helper/oc-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/oc-helper/oc-helper.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      api.torn.com
// @connect      tornprobability.com
// @run-at       document-idle
// ==/UserScript==

/*
 * PURPOSE
 *   Shows your faction's Organized Crimes 2.0 at a glance. Read-only helper: it
 *   never joins a crime, clicks, or submits anything for you.
 *
 * CREDITS AND LICENSE
 *   Copyright (C) callmericky [3299880] / whatdoesthespacebardo
 *   Modifications Copyright (C) 2026 DadGum [3158823]
 *
 *   Modified from [TORN] OC 2.0 Helper v5.4.0 by callmericky [3299880] /
 *   whatdoesthespacebardo, licensed under GPL-3.0. First changed by DadGum on
 *   2026-11-08, last changed on 2026-11-14 (6.0.5), as listed in the changelog
 *   below. This file is free software under the GNU General Public License,
 *   version 3 (GPL-3.0-only), with no warranty. See the LICENSE file in this
 *   script's folder or https://www.gnu.org/licenses/gpl-3.0.html
 *
 * API KEY USAGE DISCLOSURE
 *   Data storage:        Key, settings, and cached faction, item, and success data, locally in Tampermonkey storage.
 *   Data sharing:        Crime names and slot pass rates for Planning crimes are sent to tornprobability.com
 *                        (a third party) unless turned off in Settings. Your key, your name, and member names are never sent.
 *   Purpose of use:      Showing your faction's Organized Crime status to you.
 *   Key storage/sharing: Stored locally, sent only in the Authorization header to api.torn.com, never logged.
 *   Key access level:    Minimal Access with faction API access.
 *
 * REQUESTS
 *   GET /v2/faction?selections=basic,crimes,members  At most once per 60 seconds, shared across tabs
 *   GET /v2/faction/crimes?cat=completed             Same refresh, up to 3 pages
 *   GET /v2/torn/{ids}/items                         New item IDs only, cached 7 days
 *   GET /v2/key/info                                 On save, and once to find your user ID
 *   tornprobability.com                              Scenario list cached 1 day; one lookup per crime and set of pass rates
 *   Torn requests are tagged comment=OCHelper. Failures wait 5 minutes before retrying.
 *
 * CHANGELOG
 *   6.0.5  License notices only: GPL-3.0-only (matching the original), copyright lines,
 *          modification dates, and a link to the license text. No behavior changes.
 *   6.0.4  A manual refresh now always gets new data, even if a load is already running.
 *          The travel overview matches your faction's exact ID.
 *          Success chance lookups run at most three at a time.
 *   6.0.3  The overview now hides when you leave the crimes tab.
 *   6.0.2  The key field no longer triggers the browser's save password prompt.
 *   6.0.1  Crime slot totals now include open slots in Recruiting crimes.
 *   6.0.0  Removed jQuery and PDA support, and moved the key out of request URLs.
 *          Added shared caching, last-good data on failure, and readable API errors.
 *          Fixed crashes from former members, item name errors, and repeated item lookups.
 *          Fetches crimes by page, and fixed the sidebar notice for Torn's current sidebar.
 *          Replaced the preferences page with a Settings panel and moved layout into CSS.
 *          Added third-party data disclosure.
 *   5.4.0  Original release by callmericky.
 */

(() => {
    'use strict';

    // =========================================================================
    // CONFIG
    // =========================================================================

    const CONFIG = Object.freeze({
        DEBUG: false,
        API_BASE: 'https://api.torn.com/v2',
        API_COMMENT: 'OCHelper',
        PROBABILITY_BASE: 'https://tornprobability.com:3000/api',
        STORAGE_PREFIX: 'tms_oc_',
        STORAGE_KEYS: Object.freeze({
            API_KEY: 'api_key',
            SETTINGS: 'settings',
            FACTION: 'faction',
            KEY_INFO: 'key_info',
            ITEMS: 'items',
            SCENARIOS: 'scenarios',
            PROBABILITIES: 'probabilities',
            FAILURE: 'api_failure',
            FETCH_LOCK: 'fetch_lock',
            SETTINGS_SHOWN: 'settings_shown',
        }),
        TTL: Object.freeze({
            FACTION_MS: 60 * 1000,
            KEY_INFO_MS: 7 * 24 * 60 * 60 * 1000,
            ITEM_MS: 7 * 24 * 60 * 60 * 1000,
            SCENARIOS_MS: 24 * 60 * 60 * 1000,
            PROBABILITY_MS: 24 * 60 * 60 * 1000,
            FAILURE_COOLDOWN_MS: 5 * 60 * 1000,
            FETCH_LOCK_MS: 20 * 1000,
        }),
        RATE_LIMIT: Object.freeze({ MAX_CALLS: 50, WINDOW_MS: 60 * 1000 }),
        REQUEST_TIMEOUT_MS: 20000,
        PROBABILITY_TIMEOUT_MS: 5000,
        LOCK_POLL_MS: 400,
        ELEMENT_WAIT_MS: 15000,
        TIMER_MS: 1000,
        PROBABILITY_CONCURRENCY: 3,
        PAGE_SIZE: 100,
        MAX_COMPLETED_PAGES: 3,
        MAX_EXTRA_AVAILABLE_PAGES: 2,
        ITEM_BATCH_SIZE: 100,
        SOON_AVAILABLE_SECONDS: 24 * 60 * 60,
        HIGHLIGHT_SECONDS: 12 * 60 * 60,
        HIGH_SUCCESS: 75,
        MID_SUCCESS: 50,
        NARROW_QUERY: '(max-width: 784px)',
        TINY_QUERY: '(max-width: 386px)',
        URLS: Object.freeze({
            CRIMES: 'https://www.torn.com/factions.php?step=your#/tab=crimes',
            PROFILE: 'https://www.torn.com/profiles.php?XID=',
            CRIME_LINK: 'https://www.torn.com/factions.php?step=your&type=12#/tab=crimes&crimeId=',
            SIDEBAR_CRIME_LINK: 'https://www.torn.com/factions.php?step=your&type=5#/tab=crimes&crimeId=',
            PROBABILITY_POST: 'https://www.torn.com/forums.php#/p=threads&f=67&t=16449999',
        }),
        IDS: Object.freeze({ VIEWER: 'tms-oc-viewer', SETTINGS: 'tms-oc-settings', NOTICE: 'tms-oc-sidebarNotice' }),
        // Torn's hashed suffixes change between builds, so sidebar matching uses the stable prefix.
        SELECTORS: Object.freeze({
            CRIMES_ROOT: 'div#faction-crimes',
            TRAVEL_ROOT: 'div#react-root',
            SIDEBAR: "[class*='userInformation___']",
        }),
        ICONS: Object.freeze({ ITEM: '\u{1F6E0}', ASC: '▴', DESC: '▾', INFINITY: '∞' }),
        ALLOWED_KEY_TYPES: Object.freeze(['Custom', 'Minimal Access', 'Limited Access', 'Full Access']),
        API_ERROR_MESSAGES: Object.freeze({
            1: 'No API key was sent. Open Settings and enter your key.',
            2: 'Your API key is incorrect. Open Settings and enter it again.',
            5: "Torn's API rate limit was reached. The script will try again later.",
            7: 'This key cannot read your faction. Enable faction API access for it in Torn.',
            8: 'Torn has temporarily blocked this IP address from the API.',
            9: "Torn's API is currently disabled.",
            10: 'The API key owner is in federal jail.',
            11: 'This key was changed too recently. Try again in a moment.',
            12: 'Torn could not read this API key. Try again shortly.',
            13: 'This API key is temporarily disabled.',
            14: 'This key has reached its daily read limit.',
            16: "This key's access level is too low. Use Minimal Access or higher with faction API access.",
            17: "Torn's API had a backend error. Try again shortly.",
            18: 'This API key is paused by its owner.',
            24: 'This API endpoint is temporarily closed.',
        }),
        DEFAULT_SETTINGS: Object.freeze({
            memberShow: 'member-show',
            crimesShow: 'crimes-hide',
            sortType: 'time-asc',
            memberSort: 'OC-desc',
            lastOC_yellow: 24,
            lastOC_red: 48,
            lastActivity: 96,
            memberIgnoreList: Object.freeze([]),
            showSidebarOC: 'sidebar-show',
            showNegativeTimes: 'negative-timer-hide',
            warnLowSuccessPercentage: 50,
            showProgressPercentage: 'progress-show',
            showSelfSuccessRate: 'self-success-show',
            showAllenoneScript: 'torn-probability-show',
            memberDirectionality: 'row-column',
        }),
    });

    // Constant markup only. Never add API or user text to these.
    const SVG = Object.freeze({
        COLLAPSED: '<svg width="8px" height="8px" viewBox="1 1 13 13" xmlns="http://www.w3.org/2000/svg"><polygon points="13,8 5,16 5,0" fill="currentColor"/></svg>',
        EXPANDED: '<svg width="8px" height="8px" viewBox="1 1 13 13" xmlns="http://www.w3.org/2000/svg"><polygon points="8,13 0,5 16,5" fill="currentColor"/></svg>',
        LAST_CRIME: '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 30 40"><path fill="currentColor" d="M397,168c-7.573,0-15,5.76-15,13.333,0,4.589,3.375,10.129,6.512,14.524a10.05,10.05,0,0,1,16.935-.067c3.22-4.457,6.553-9.865,6.553-14.457C412,173.76,404.573,168,397,168Zm-5.83,18.333a4.166,4.166,0,1,1,4.167-4.166A4.167,4.167,0,0,1,391.17,186.333Zm11.667,0A4.166,4.166,0,1,1,407,182.167,4.166,4.166,0,0,1,402.837,186.333ZM397,194.52a6.74,6.74,0,1,0,6.74,6.74A6.741,6.741,0,0,0,397,194.52Zm1.752,2.458a1.07,1.07,0,1,1-1.07,1.07A1.071,1.071,0,0,1,398.752,196.978Zm-3.574,0a1.07,1.07,0,1,1-1.068,1.07A1.071,1.071,0,0,1,395.178,196.978Zm-1.918,5.35a1.07,1.07,0,1,1,1.07-1.07A1.071,1.071,0,0,1,393.26,202.328Zm1.918,3.212a1.069,1.069,0,1,1,1.07-1.07A1.07,1.07,0,0,1,395.178,205.54Zm.752-4.28a1.07,1.07,0,1,1,1.07,1.07A1.071,1.071,0,0,1,395.93,201.26Zm2.822,4.28a1.069,1.069,0,1,1,1.07-1.07A1.071,1.071,0,0,1,398.752,205.54Zm1.988-3.212a1.07,1.07,0,1,1,1.07-1.07A1.069,1.069,0,0,1,400.74,202.328Z" transform="translate(-382 -168)"></path></svg>',
    });

    /**
     * @typedef {Object} FactionData
     * @property {{id: number}} basic Faction identity.
     * @property {Object[]} members Faction members.
     * @property {Object[]} crimes Available and completed crimes.
     */

    /**
     * @typedef {Object} FactionResult
     * @property {FactionData} data Faction data.
     * @property {boolean} stale True when the data is saved data after a failure.
     * @property {string} message Failure text for stale data.
     * @property {number} ts When the data was fetched.
     */

    /**
     * Writes a debug message when debugging is enabled. Never pass the API key.
     * @param {...*} args Values to log.
     * @returns {void}
     */
    function log(...args) {
        if (CONFIG.DEBUG) console.debug('[OC Helper]', ...args);
    }

    // =========================================================================
    // STORAGE
    // =========================================================================

    const Storage = {
        /**
         * Reads and deserializes a stored value.
         * @param {string} key Unprefixed storage key.
         * @param {*} fallback Value returned when missing or invalid.
         * @returns {*} Stored value or fallback.
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
         * @param {*} value JSON-serializable value.
         * @returns {void}
         */
        set(key, value) {
            GM_setValue(CONFIG.STORAGE_PREFIX + key, JSON.stringify(value));
        },

        /**
         * Removes a stored value.
         * @param {string} key Unprefixed storage key.
         * @returns {void}
         */
        remove(key) {
            GM_deleteValue(CONFIG.STORAGE_PREFIX + key);
        },
    };

    /**
     * Reads the saved API key.
     * @returns {string} API key, or an empty string.
     */
    function getApiKey() {
        return Storage.get(CONFIG.STORAGE_KEYS.API_KEY, '');
    }

    /**
     * Saves or clears the API key.
     * @param {string} key API key; empty clears it.
     * @returns {void}
     */
    function setApiKey(key) {
        const cleaned = String(key || '').trim();
        if (cleaned) Storage.set(CONFIG.STORAGE_KEYS.API_KEY, cleaned);
        else Storage.remove(CONFIG.STORAGE_KEYS.API_KEY);
    }

    /**
     * Reads settings, filling in defaults for anything missing.
     * @returns {Object} Settings.
     */
    function getSettings() {
        return mergeSettings(Storage.get(CONFIG.STORAGE_KEYS.SETTINGS, null));
    }

    // =========================================================================
    // CACHE
    // =========================================================================

    const Cache = {
        /**
         * Reads an entry regardless of age.
         * @param {string} key Unprefixed storage key.
         * @returns {{value: *, ts: number}|null} Entry, or null when missing.
         */
        peek(key) {
            const entry = Storage.get(key, null);
            return entry && Number.isFinite(entry.ts) && entry.value !== undefined ? entry : null;
        },

        /**
         * Reads a value only when it is younger than the TTL.
         * @param {string} key Unprefixed storage key.
         * @param {number} ttlMs Maximum age in milliseconds.
         * @returns {*|null} Cached value, or null when missing or expired.
         */
        get(key, ttlMs) {
            const entry = this.peek(key);
            return entry && Date.now() - entry.ts < ttlMs ? entry.value : null;
        },

        /**
         * Stores a value with the current time.
         * @param {string} key Unprefixed storage key.
         * @param {*} value JSON-serializable value.
         * @returns {void}
         */
        set(key, value) {
            Storage.set(key, { ts: Date.now(), value });
        },

        /**
         * Clears all cached API data and any retry cooldown, keeping the key and settings.
         * @returns {void}
         */
        clearApiData() {
            const K = CONFIG.STORAGE_KEYS;
            [K.FACTION, K.KEY_INFO, K.ITEMS, K.SCENARIOS, K.PROBABILITIES, K.FAILURE, K.FETCH_LOCK]
                .forEach((key) => Storage.remove(key));
        },
    };

    // =========================================================================
    // API
    // =========================================================================

    /** An API failure with Torn's error code when one was returned. */
    class ApiRequestError extends Error {
        /**
         * Creates an API error.
         * @param {string} message Readable message.
         * @param {number|null} [code=null] Torn API error code.
         */
        constructor(message, code = null) {
            super(message);
            this.name = 'ApiRequestError';
            this.code = code;
        }
    }

    /**
     * Waits for a number of milliseconds.
     * @param {number} ms Delay.
     * @returns {Promise<void>} Resolves after the delay.
     */
    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
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

    const api = {
        /**
         * Sends one rate-limited GET request to Torn API v2.
         * @param {string} path Path beginning with "/".
         * @param {Object<string, string|number>} [params={}] Query parameters.
         * @param {string} [key=getApiKey()] API key, sent only in the header.
         * @returns {Promise<Object>} Parsed response.
         * @throws {ApiRequestError} On network, HTTP, parsing, or API errors.
         */
        async get(path, params = {}, key = getApiKey()) {
            await RateLimiter.acquire();
            const url = new URL(CONFIG.API_BASE + path);
            Object.entries({ ...params, comment: CONFIG.API_COMMENT })
                .forEach(([name, value]) => url.searchParams.set(name, String(value)));

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url.href,
                    headers: { Authorization: `ApiKey ${key}`, Accept: 'application/json' },
                    timeout: CONFIG.REQUEST_TIMEOUT_MS,
                    onload: (response) => {
                        let data;
                        try {
                            data = JSON.parse(response.responseText);
                        } catch {
                            reject(new ApiRequestError(`Torn API returned an unreadable response (HTTP ${response.status}).`));
                            return;
                        }
                        if (data?.error) reject(toApiError(data.error));
                        else if (response.status < 200 || response.status >= 300) reject(new ApiRequestError(`Torn API HTTP ${response.status}.`));
                        else resolve(data);
                    },
                    onerror: () => reject(new ApiRequestError('Could not reach the Torn API.')),
                    ontimeout: () => reject(new ApiRequestError('The Torn API request timed out.')),
                });
            });
        },
    };

    /**
     * Sends a request to tornprobability.com. No Torn key or member names are included.
     * @param {string} method HTTP method.
     * @param {string} path Path under the probability API.
     * @param {Object} [body] JSON body.
     * @returns {Promise<*>} Parsed response.
     * @throws {Error} When the request fails.
     */
    function probabilityRequest(method, path, body) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url: `${CONFIG.PROBABILITY_BASE}${path}`,
                headers: body ? { 'Content-Type': 'application/json' } : {},
                data: body ? JSON.stringify(body) : undefined,
                timeout: CONFIG.PROBABILITY_TIMEOUT_MS,
                anonymous: true,
                onload: (response) => {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`tornprobability.com returned HTTP ${response.status}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(response.responseText));
                    } catch {
                        reject(new Error('tornprobability.com returned an unreadable response'));
                    }
                },
                onerror: () => reject(new Error('Could not reach tornprobability.com')),
                ontimeout: () => reject(new Error('tornprobability.com timed out')),
            });
        });
    }

    /**
     * Loads further pages of crimes.
     * @param {string} category Crime category.
     * @param {number} startOffset First offset.
     * @param {number} maxPages Maximum pages to load.
     * @param {(crimes: Object[]) => boolean} [isDone] Stops early when true.
     * @returns {Promise<Object[]>} Crimes.
     */
    async function fetchCrimePages(category, startOffset, maxPages, isDone = () => false) {
        const crimes = [];
        for (let page = 0; page < maxPages; page += 1) {
            const data = await api.get('/faction/crimes', {
                cat: category,
                limit: CONFIG.PAGE_SIZE,
                offset: startOffset + page * CONFIG.PAGE_SIZE,
            });
            if (!Array.isArray(data?.crimes)) throw new ApiRequestError('Unexpected crime list format.');
            crimes.push(...data.crimes);
            if (data.crimes.length < CONFIG.PAGE_SIZE || isDone(crimes)) break;
        }
        return crimes;
    }

    /**
     * Fetches current faction data and all crime pages.
     * @returns {Promise<FactionData>} Faction data with unused fields removed.
     * @throws {ApiRequestError} When a request fails or the format is unexpected.
     */
    async function fetchFactionData() {
        const main = await api.get('/faction', {
            selections: 'basic,crimes,members',
            cat: 'available',
            limit: CONFIG.PAGE_SIZE,
            striptags: 'true',
        });
        if (!main?.basic || !Array.isArray(main.members) || !Array.isArray(main.crimes)) {
            throw new ApiRequestError('Unexpected faction data format.');
        }

        const available = [...main.crimes];
        if (available.length >= CONFIG.PAGE_SIZE) {
            available.push(...await fetchCrimePages('available', CONFIG.PAGE_SIZE, CONFIG.MAX_EXTRA_AVAILABLE_PAGES));
        }

        const completed = await fetchCrimePages('completed', 0, CONFIG.MAX_COMPLETED_PAGES,
            (crimes) => hasCrimeForEveryMember(main.members, crimes));
        return slimFactionData(main, [...available, ...completed]);
    }

    /**
     * Records a failure and starts the retry cooldown.
     * @param {string} keyHash Hash of the key that failed.
     * @param {Error} error Failure.
     * @returns {void}
     */
    function recordFailure(keyHash, error) {
        Storage.set(CONFIG.STORAGE_KEYS.FAILURE, {
            keyHash,
            message: error.message || String(error),
            code: error.code ?? null,
            until: Date.now() + CONFIG.TTL.FAILURE_COOLDOWN_MS,
        });
    }

    /**
     * Waits briefly if another tab is already refreshing faction data.
     * @param {string} keyHash Hash of the current key.
     * @returns {Promise<{value: Object, ts: number}|null>} Fresh entry from the other tab, or null.
     */
    async function waitForOtherTab(keyHash) {
        const { FETCH_LOCK, FACTION } = CONFIG.STORAGE_KEYS;
        while ((Storage.get(FETCH_LOCK, null)?.until || 0) > Date.now()) {
            await sleep(CONFIG.LOCK_POLL_MS);
        }
        const entry = Cache.peek(FACTION);
        return entry?.value?.keyHash === keyHash && Date.now() - entry.ts < CONFIG.TTL.FACTION_MS ? entry : null;
    }

    /**
     * Fetches and caches faction data while holding the cross-tab lock.
     * @param {string} keyHash Hash of the current key.
     * @returns {Promise<{value: Object, ts: number}>} New cache entry.
     * @throws {ApiRequestError} When the fetch fails.
     */
    async function refreshFactionCache(keyHash) {
        const { FETCH_LOCK, FACTION, FAILURE } = CONFIG.STORAGE_KEYS;
        Storage.set(FETCH_LOCK, { until: Date.now() + CONFIG.TTL.FETCH_LOCK_MS });
        try {
            const data = await fetchFactionData();
            Cache.set(FACTION, { keyHash, data });
            Storage.remove(FAILURE);
            return Cache.peek(FACTION);
        } finally {
            Storage.remove(FETCH_LOCK);
        }
    }

    /**
     * Formats a cache entry as a load result.
     * @param {{value: Object, ts: number}} entry Cache entry.
     * @param {string} [message=''] Failure text for saved data.
     * @returns {FactionResult} Result.
     */
    function toFactionResult(entry, message = '') {
        return { data: entry.value.data, stale: Boolean(message), message, ts: entry.ts };
    }

    /**
     * Loads faction data, using the shared cache and last good data when possible.
     * @param {boolean} force True to skip the cache and cooldown.
     * @returns {Promise<FactionResult>} Result.
     * @throws {ApiRequestError} When no data is available.
     */
    async function loadFactionUncached(force) {
        const key = getApiKey();
        if (!key) throw new ApiRequestError('Add your API key in Settings to see the OC overview.', 1);

        const keyHash = simpleKeyHash(key);
        const saved = Cache.peek(CONFIG.STORAGE_KEYS.FACTION);
        const cached = saved?.value?.keyHash === keyHash ? saved : null;
        if (!force && cached && Date.now() - cached.ts < CONFIG.TTL.FACTION_MS) return toFactionResult(cached);

        const failure = Storage.get(CONFIG.STORAGE_KEYS.FAILURE, null);
        if (!force && failure?.keyHash === keyHash && failure.until > Date.now()) {
            if (cached) return toFactionResult(cached, failure.message);
            throw new ApiRequestError(failure.message, failure.code);
        }

        if (!force) {
            const fromOtherTab = await waitForOtherTab(keyHash);
            if (fromOtherTab) return toFactionResult(fromOtherTab);
        }

        try {
            return toFactionResult(await refreshFactionCache(keyHash));
        } catch (error) {
            recordFailure(keyHash, error);
            if (cached) return toFactionResult(cached, error.message || String(error));
            throw error;
        }
    }

    let factionRequest = null;
    let factionRequestForced = false;

    /**
     * Loads faction data, sharing one request within this tab.
     * @param {boolean} [force=false] True to skip the cache and cooldown.
     * @returns {Promise<FactionResult>} Result.
     * @throws {ApiRequestError} When no data is available.
     */
    function loadFaction(force = false) {
        if (factionRequest && force && !factionRequestForced) {
            return factionRequest.catch(() => null).then(() => loadFaction(true));
        }
        if (!factionRequest) {
            factionRequestForced = force;
            factionRequest = loadFactionUncached(force).finally(() => {
                factionRequest = null;
            });
        }
        return factionRequest;
    }

    /**
     * Finds the key owner's user ID, cached for each key.
     * @returns {Promise<number|null>} User ID, or null when unavailable.
     */
    async function loadUserId() {
        const key = getApiKey();
        if (!key) return null;
        const keyHash = simpleKeyHash(key);
        const cached = Cache.get(CONFIG.STORAGE_KEYS.KEY_INFO, CONFIG.TTL.KEY_INFO_MS);
        if (cached?.keyHash === keyHash) return cached.userId;

        try {
            const data = await api.get('/key/info');
            const userId = data?.info?.user?.id ?? null;
            Cache.set(CONFIG.STORAGE_KEYS.KEY_INFO, { keyHash, userId });
            return userId;
        } catch (error) {
            log('Could not read key info', error.message);
            return null;
        }
    }

    /**
     * Loads item names for the given IDs, requesting only unknown IDs.
     * @param {number[]} ids Item IDs.
     * @returns {Promise<Object<string, string>>} Names keyed by item ID.
     */
    async function loadItemNames(ids) {
        const { ITEMS } = CONFIG.STORAGE_KEYS;
        const now = Date.now();
        const stored = Storage.get(ITEMS, {}) || {};
        const unknown = ids.filter((id) => !(stored[id] && now - stored[id].ts < CONFIG.TTL.ITEM_MS));

        for (let start = 0; start < unknown.length; start += CONFIG.ITEM_BATCH_SIZE) {
            const batch = unknown.slice(start, start + CONFIG.ITEM_BATCH_SIZE);
            try {
                const data = await api.get(`/torn/${batch.join(',')}/items`);
                (data?.items || []).forEach((item) => {
                    stored[item.id] = { name: item.name, ts: now };
                });
            } catch (error) {
                log('Could not load item names', error.message);
                break;
            }
        }

        if (unknown.length) Storage.set(ITEMS, stored);
        return Object.fromEntries(ids.filter((id) => stored[id]).map((id) => [id, stored[id].name]));
    }

    /**
     * Loads the scenarios tornprobability.com supports.
     * @returns {Promise<string[]>} Scenario names.
     * @throws {Error} When the list cannot be loaded and nothing is saved.
     */
    async function loadScenarios() {
        const { SCENARIOS } = CONFIG.STORAGE_KEYS;
        const cached = Cache.get(SCENARIOS, CONFIG.TTL.SCENARIOS_MS);
        if (cached) return cached;
        try {
            const data = await probabilityRequest('GET', '/GetSupportedScenarios');
            const names = (Array.isArray(data) ? data : []).map((scenario) => scenario.name);
            Cache.set(SCENARIOS, names);
            return names;
        } catch (error) {
            const stale = Cache.peek(SCENARIOS);
            if (stale) return stale.value;
            throw error;
        }
    }

    /**
     * Gets one crime's overall success chance, reusing saved results for the same rates.
     * @param {Object} crime Planning crime.
     * @returns {Promise<string>} Percentage text.
     * @throws {Error} When the lookup fails.
     */
    async function loadCrimeProbability(crime) {
        const { PROBABILITIES } = CONFIG.STORAGE_KEYS;
        const rates = crime.slots.map((slot) => slot.checkpoint_pass_rate);
        const cacheKey = `${crime.id}:${rates.join(',')}`;
        const now = Date.now();
        const stored = Storage.get(PROBABILITIES, {}) || {};
        if (stored[cacheKey] && now - stored[cacheKey].ts < CONFIG.TTL.PROBABILITY_MS) return stored[cacheKey].value;

        const data = await probabilityRequest('POST', '/CalculateSuccess', { scenario: crime.name, parameters: rates });
        const value = (Number(data.successChance) * 100).toFixed(2);
        const kept = Object.fromEntries(Object.entries(Storage.get(PROBABILITIES, {}) || {})
            .filter(([, entry]) => now - entry.ts < CONFIG.TTL.PROBABILITY_MS));
        kept[cacheKey] = { value, ts: now };
        Storage.set(PROBABILITIES, kept);
        return value;
    }

    // =========================================================================
    // DATA (no DOM access)
    // =========================================================================

    /**
     * Creates a short non-secret fingerprint of a key for cache matching.
     * @param {string} key API key.
     * @returns {string} Hash.
     */
    function simpleKeyHash(key) {
        let hash = 0;
        const text = String(key || '');
        for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
        return String(hash);
    }

    /**
     * Merges saved settings over the defaults.
     * @param {Object|null} stored Saved settings.
     * @returns {Object} Complete settings.
     */
    function mergeSettings(stored) {
        const merged = { ...CONFIG.DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) };
        merged.memberIgnoreList = Array.isArray(merged.memberIgnoreList) ? merged.memberIgnoreList.map(String) : [];
        return merged;
    }

    /**
     * Escapes text placed in tooltips, which Torn renders as HTML.
     * @param {*} value Text.
     * @returns {string} Escaped text.
     */
    function escapeTooltip(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    /**
     * Checks whether a crime list includes every OC-eligible member.
     * @param {Object[]} members Faction members.
     * @param {Object[]} crimes Completed crimes.
     * @returns {boolean} True when no member's last crime is still unknown.
     */
    function hasCrimeForEveryMember(members, crimes) {
        const seen = new Set(crimes.flatMap((crime) => crime.slots.map((slot) => slot.user?.id)));
        return members
            .filter((member) => member.status?.state !== 'Fallen' && member.position !== 'Recruit')
            .every((member) => seen.has(member.id));
    }

    /**
     * Removes fields this script does not use, keeping cached data small.
     * @param {Object} main Main faction response.
     * @param {Object[]} crimes All crimes.
     * @returns {FactionData} Reduced data.
     */
    function slimFactionData(main, crimes) {
        return {
            basic: { id: main.basic.id },
            members: main.members.map(({ id, name, position, status, last_action: lastAction }) => ({
                id,
                name,
                position,
                status: { state: status?.state, description: status?.description },
                last_action: lastAction,
            })),
            crimes: crimes.map(({ rewards, ...crime }) => crime),
        };
    }

    /**
     * Records the latest completed crime time for each member in a crime.
     * @param {Object} crime Completed crime.
     * @param {Object<string, Object>} members Eligible members.
     * @returns {void}
     */
    function recordLastCrime(crime, members) {
        const lastCrimeTime = crime.executed_at || crime.ready_at;
        crime.slots.forEach((slot) => {
            const member = slot.user && members[slot.user.id];
            if (member && member.lastCrime < lastCrimeTime) member.lastCrime = lastCrimeTime;
        });
    }

    /**
     * Assigns members to an active crime and updates the model counts.
     * @param {Object} crime Active crime.
     * @param {Object} model Model being built.
     * @param {number|null} userId Key owner's ID.
     * @param {number} nowSec Current time in seconds.
     * @returns {void}
     */
    function recordActiveCrime(crime, model, userId, nowSec) {
        crime.slots.forEach((slot) => {
            const member = slot.user && model.members[slot.user.id];
            if (!member) return;
            member.crimeInfo = {
                crimeName: crime.name,
                crimeDifficulty: crime.difficulty,
                crimeId: crime.id,
                crimePosition: slot.position,
                crimeSuccess: slot.checkpoint_pass_rate,
                crimeProgress: slot.user.progress,
            };
            model.activeMembers += 1;
            if (crime.status === 'Planning' && crime.ready_at < nowSec + CONFIG.SOON_AVAILABLE_SECONDS) {
                model.soonAvailableMembers.push(slot.user.id);
            }
            if (Number(slot.user.id) === Number(userId)) {
                model.userInfo = member;
                member.crimeInfo.crimeTime = crime.ready_at;
            }
        });
    }

    /**
     * Adds a crime's empty slots to the available slot counts.
     * @param {Object} crime Active crime.
     * @param {Object} model Model being built.
     * @returns {void}
     */
    function countOpenSlots(crime, model) {
        crime.slots.filter((slot) => !slot.user).forEach(() => {
            model.availableCrimeSlots[crime.difficulty] = (model.availableCrimeSlots[crime.difficulty] || 0) + 1;
            model.availableCrimeSlotsCount += 1;
        });
    }

    /**
     * Sorts one active crime into its display list.
     * @param {Object} crime Active crime.
     * @param {Object} model Model being built.
     * @returns {void}
     */
    function addToCrimeList(crime, model) {
        if (crime.status === 'Planning') model.planning.push(crime);
        else if (crime.planning_at === null || crime.planning_at === undefined) model.uninitiated.push(crime);
        else model.recruiting.push(crime);
    }

    /**
     * Builds eligible member records and the counts that depend on them.
     * @param {Object[]} members Faction members.
     * @param {Set<string>} ignored Ignored member IDs.
     * @returns {{members: Object<string, Object>, skipped: Object[], skippedCount: number, fallenCount: number}} Member data.
     */
    function buildMemberRecords(members, ignored) {
        const records = {};
        const skipped = [];
        let skippedCount = 0;
        let fallenCount = 0;

        members.forEach((member) => {
            if (member.status.state === 'Fallen') {
                fallenCount += 1;
            } else if (member.position === 'Recruit') {
                skippedCount += 1;
                skipped.push({ id: member.id, name: member.name });
            } else {
                records[member.id] = {
                    id: member.id,
                    name: member.name,
                    last_action: member.last_action,
                    statusDesc: member.status.description,
                    status: member.status.state,
                    lastCrime: 0,
                };
                if (ignored.has(String(member.id))) skippedCount += 1;
            }
        });
        return { members: records, skipped, skippedCount, fallenCount };
    }

    /**
     * Converts faction data to the display model.
     * @param {FactionData} data Faction data.
     * @param {number|null} userId Key owner's ID.
     * @param {Object} settings Settings.
     * @param {number} nowSec Current time in seconds.
     * @returns {Object} Display model.
     */
    function analyzeFaction(data, userId, settings, nowSec) {
        const records = buildMemberRecords(data.members, new Set(settings.memberIgnoreList));
        const model = {
            userId,
            factionId: data.basic.id,
            members: records.members,
            allMembers: data.members,
            skippedMembers: records.skipped,
            totalMembers: data.members.length - records.skippedCount - records.fallenCount,
            activeMembers: 0,
            availableMembers: 0,
            soonAvailableMembers: [],
            userInfo: null,
            uninitiated: [],
            recruiting: [],
            planning: [],
            availableCrimeSlots: {},
            availableCrimeSlotsCount: 0,
            crimeCount: data.crimes.length,
        };

        data.crimes.filter((crime) => crime.status !== 'Expired').forEach((crime) => {
            if (crime.status === 'Successful' || crime.status === 'Failure') recordLastCrime(crime, model.members);
            if (crime.status === 'Recruiting' || crime.status === 'Planning') {
                if (crime.planning_at) recordActiveCrime(crime, model, userId, nowSec);
                countOpenSlots(crime, model);
                addToCrimeList(crime, model);
            }
        });

        model.availableMembers = model.totalMembers - model.activeMembers;
        model.availableList = Object.values(model.members).filter((member) => !member.crimeInfo);
        return model;
    }

    /**
     * Sorts one crime list. Rows are drawn last-first, so these directions match the labels.
     * @param {Object[]} crimes Crimes.
     * @param {string} sortType Sort setting.
     * @param {string} timeField Timestamp used for time sorts.
     * @returns {Object[]} Same array, sorted.
     */
    function sortCrimeList(crimes, sortType, timeField) {
        const comparators = {
            'level-desc': (a, b) => a.difficulty - b.difficulty,
            'level-asc': (a, b) => b.difficulty - a.difficulty,
            'time-desc': (a, b) => a[timeField] - b[timeField],
            'time-asc': (a, b) => b[timeField] - a[timeField],
        };
        return crimes.sort(comparators[sortType] || comparators['time-asc']);
    }

    /**
     * Sorts the members who are not in a crime.
     * @param {Object[]} members Members.
     * @param {string} memberSort Sort setting.
     * @returns {Object[]} Same array, sorted.
     */
    function sortMembers(members, memberSort) {
        const comparators = {
            'OC-asc': (a, b) => b.lastCrime - a.lastCrime,
            'OC-desc': (a, b) => a.lastCrime - b.lastCrime,
            'active-asc': (a, b) => a.last_action.timestamp - b.last_action.timestamp,
            'active-desc': (a, b) => b.last_action.timestamp - a.last_action.timestamp,
        };
        return members.sort(comparators[memberSort] || comparators['OC-desc']);
    }

    /**
     * Splits seconds into days, hours, minutes, and seconds.
     * @param {number} seconds Total seconds.
     * @returns {{d: number, h: number, m: number, s: number}} Parts.
     */
    function splitDuration(seconds) {
        const d = Math.floor(seconds / 86400);
        const h = Math.floor(seconds / 3600) - d * 24;
        const m = Math.floor(seconds / 60) - h * 60 - d * 1440;
        return { d, h, m, s: seconds - m * 60 - h * 3600 - d * 86400 };
    }

    /**
     * Formats a crime countdown.
     * @param {number} target Target time in seconds.
     * @param {number} nowSec Current time in seconds.
     * @param {boolean} showNegative True to count up after the target passes.
     * @returns {{text: string, highlight: string}} Display text and highlight name.
     */
    function formatCountdown(target, nowSec, showNegative) {
        let diff = target > nowSec ? target - nowSec : 0;
        let highlight = diff < CONFIG.HIGHLIGHT_SECONDS ? 'highlightText' : '';
        if (target < nowSec && showNegative) {
            diff = nowSec - target;
            highlight = 'highlightRed';
        }
        const { d, h, m, s } = splitDuration(diff);
        const text = [d, h, m, s].map((part) => String(part).padStart(2, '0')).join(':');
        return { text, highlight };
    }

    /**
     * Describes how long ago a member's last crime was.
     * @param {number} lastCrime Last crime time, or 0 when unknown.
     * @param {number} nowSec Current time in seconds.
     * @param {number} crimeCount Crimes searched.
     * @returns {string} Description.
     */
    function describeLastCrime(lastCrime, nowSec, crimeCount) {
        if (lastCrime === 0) return `User has not joined the last ${crimeCount} OCs`;
        const { d, h, m } = splitDuration(nowSec - lastCrime);
        const parts = [];
        if (d > 0) parts.push(`${d}d`);
        if (d > 0 || h > 0) parts.push(`${String(h).padStart(2, '0')}h`);
        if (d > 0 || h > 0 || m > 0) parts.push(`${String(m).padStart(2, '0')}m`);
        parts.push('ago');
        return parts.join(' ');
    }

    /**
     * Works out how a member not in a crime should be shown.
     * @param {Object} member Member record.
     * @param {Object} model Display model.
     * @param {Object} settings Settings.
     * @param {number} nowSec Current time in seconds.
     * @returns {{iconClass: string, nameClass: string, lastCrimeText: string, activityText: string}} Display details.
     */
    function buildMemberDisplay(member, model, settings, nowSec) {
        const sinceCrime = member.lastCrime === 0 ? -1 : nowSec - member.lastCrime;
        let iconClass = 'iconDefault';
        if (member.lastCrime === 0) iconClass = 'iconVeryRed';
        if (sinceCrime > Number.parseInt(settings.lastOC_yellow, 10) * 3600) iconClass = 'iconYellow';
        if (sinceCrime > Number.parseInt(settings.lastOC_red, 10) * 3600) iconClass = 'iconRed';

        let nameClass = '';
        if (nowSec - member.last_action.timestamp > Number.parseInt(settings.lastActivity, 10) * 3600) nameClass = 'inactive';
        if (member.status.toLowerCase() === 'federal') nameClass = 'federal';

        return {
            iconClass,
            nameClass,
            lastCrimeText: describeLastCrime(member.lastCrime, nowSec, model.crimeCount),
            activityText: `Last Action: ${member.last_action.relative}`,
        };
    }

    /**
     * Describes a crime's countdown label and target time.
     * @param {Object} crime Crime.
     * @param {number} nowSec Current time in seconds.
     * @param {boolean} narrow True on small screens.
     * @param {boolean} showNegative True to count up after the target passes.
     * @returns {{label: string, target: number, title: string, listClass: string}} Timing details.
     */
    function describeCrimeTiming(crime, nowSec, narrow, showNegative) {
        const pick = (short, long) => (narrow ? short : long);
        if (crime.status === 'Planning') {
            const delayed = crime.ready_at < nowSec && showNegative;
            return {
                label: delayed ? pick('D:', 'Delay: ') : pick('R:', 'Ready in: '),
                target: crime.ready_at,
                title: delayed ? 'Delay since crime should have started due to members not being available' : 'Time until this crime is ready to start',
                listClass: 'crimeFull',
            };
        }
        if (crime.planning_at === null || crime.planning_at === undefined) {
            return {
                label: pick('E:', 'Expires: '),
                target: crime.expired_at,
                title: 'Time until this crime is no longer be available',
                listClass: 'crimeUninitiated',
            };
        }
        const delayed = crime.ready_at < nowSec && showNegative;
        return {
            label: delayed ? pick('D:', 'Delay:') : pick('J:', 'Join in: '),
            target: crime.ready_at,
            title: delayed ? 'Delay in planning due to lack of members joining' : 'Time until this crime needs a new member to join to continue planning',
            listClass: 'crimeRecruiting',
        };
    }

    /**
     * Formats an item for display.
     * @param {number} id Item ID.
     * @param {Object<string, string>} itemNames Names keyed by item ID.
     * @returns {string} Tooltip-safe item label.
     */
    function formatItemLabel(id, itemNames) {
        return itemNames[id] ? `${escapeTooltip(itemNames[id])} [${id}]` : `Item #${id}`;
    }

    /**
     * Picks the success color for a filled slot.
     * @param {number} rate Pass rate.
     * @param {number} warnAt Low-success threshold.
     * @returns {string} Success class name.
     */
    function successClass(rate, warnAt) {
        if (rate < warnAt) return 'lowSuccess';
        if (rate > CONFIG.HIGH_SUCCESS) return 'highSuccess';
        return rate > CONFIG.MID_SUCCESS ? 'midSuccess' : 'lowSuccess';
    }

    /**
     * Numbers repeated positions within a crime.
     * @param {Object[]} slots Crime slots.
     * @returns {string[]} Position labels.
     */
    function labelPositions(slots) {
        const totals = {};
        slots.forEach((slot) => {
            totals[slot.position] = (totals[slot.position] || 0) + 1;
        });
        const used = {};
        return slots.map((slot) => {
            if (totals[slot.position] < 2) return slot.position;
            used[slot.position] = (used[slot.position] || 0) + 1;
            return `${slot.position} ${used[slot.position]}`;
        });
    }

    /**
     * Builds one crime slot's display details.
     * @param {Object} slot Crime slot.
     * @param {string} position Position label.
     * @param {Object} model Display model.
     * @param {Object} settings Settings.
     * @param {Object<string, string>} itemNames Names keyed by item ID.
     * @returns {Object} Slot display details.
     */
    function buildSlotDisplay(slot, position, model, settings, itemNames) {
        const member = slot.user ? model.members[slot.user.id] : null;
        const requirement = slot.item_requirement;
        const warnAt = Number(settings.warnLowSuccessPercentage) || 0;
        let itemTitle = '';
        if (requirement) {
            itemTitle = `Required item: ${formatItemLabel(requirement.id, itemNames)}`;
            if (requirement.is_reusable) itemTitle += ' (reusable)';
            if (requirement.is_available) itemTitle += '<br />Item is owned by member';
        }

        let successText = String(slot.checkpoint_pass_rate);
        let successStyle = 'textGray';
        if (slot.user) successStyle = successClass(slot.checkpoint_pass_rate, Number(settings.warnLowSuccessPercentage) || CONFIG.MID_SUCCESS);
        else if (settings.showSelfSuccessRate === 'self-success-hide') successText = '-';

        return {
            position,
            rate: slot.checkpoint_pass_rate,
            successText,
            successStyle,
            itemTitle,
            requirement,
            userId: slot.user?.id ?? null,
            member,
            memberName: member ? member.name : (slot.user ? `Former member [${slot.user.id}]` : null),
            progress: member?.crimeInfo?.crimeProgress ?? null,
            isUser: Boolean(slot.user) && Number(slot.user.id) === Number(model.userId),
            lowSuccess: Boolean(slot.user) && slot.checkpoint_pass_rate < warnAt,
            missingItem: Boolean(slot.user) && requirement?.is_available === false,
        };
    }

    /**
     * Builds the warning icon text and tooltip for a crime.
     * @param {Object[]} slots Slot display details.
     * @param {Object<string, string>} itemNames Names keyed by item ID.
     * @returns {{icon: string, title: string}} Warning details.
     */
    function buildCrimeWarnings(slots, itemNames) {
        const low = slots.filter((slot) => slot.lowSuccess)
            .map((slot) => `&nbsp;${slot.rate}% - ${escapeTooltip(slot.memberName)}`);
        const missing = slots.filter((slot) => slot.missingItem)
            .map((slot) => `&nbsp;${formatItemLabel(slot.requirement.id, itemNames)} - ${escapeTooltip(slot.memberName)}`);
        const blocks = [];
        if (low.length) blocks.push(`Low Success Chance:<br />${low.join('<br />')}`);
        if (missing.length) blocks.push(`Item Missing:<br />${missing.join('<br />')}`);
        const marks = `${low.length ? '%' : ''}${missing.length ? CONFIG.ICONS.ITEM : ''}`;
        return { icon: marks ? `[${marks}] ` : '', title: blocks.join('<br />') };
    }

    /**
     * Builds a tooltip listing counts by crime level.
     * @param {string} heading Tooltip heading.
     * @param {Object<string, number>} counts Counts keyed by level.
     * @param {string} [suffix=''] Text after each count.
     * @returns {string} Tooltip HTML.
     */
    function levelCountsTitle(heading, counts, suffix = '') {
        const lines = Object.entries(counts).map(([level, count]) => `Lvl ${level} x ${count}${suffix}<br />`);
        return `<span style="font-weight: bold">${heading}</span><br />${lines.join('')}`;
    }

    /**
     * Collects required item IDs from active crimes.
     * @param {Object} model Display model.
     * @returns {number[]} Unique item IDs.
     */
    function collectItemIds(model) {
        const crimes = [...model.uninitiated, ...model.recruiting, ...model.planning];
        return [...new Set(crimes.flatMap((crime) => crime.slots)
            .map((slot) => slot.item_requirement?.id)
            .filter(Boolean))];
    }

    // =========================================================================
    // UI
    // =========================================================================

    const view = {
        model: null,
        result: null,
        itemNames: {},
        probabilities: {},
        probabilityError: '',
        openCrimes: new Set(),
        expandedLists: new Set(),
        membersVisible: true,
        crimesVisible: false,
        settings: null,
        timerId: 0,
        ignoreDraft: [],
    };

    const narrowQuery = window.matchMedia(CONFIG.NARROW_QUERY);
    const tinyQuery = window.matchMedia(CONFIG.TINY_QUERY);

    /**
     * Creates an element without parsing HTML.
     * @param {string} tag Element tag name.
     * @param {{id?: string, className?: string, text?: string, title?: string, attrs?: Object<string, string>, onClick?: EventListener}} [options={}] Element options.
     * @param {Array<Node|string|null|false|undefined>} [children=[]] Children; empty values are skipped.
     * @returns {HTMLElement} Created element.
     */
    function createEl(tag, options = {}, children = []) {
        const element = document.createElement(tag);
        if (options.id) element.id = options.id;
        if (options.className) element.className = options.className;
        if (options.text !== undefined) element.textContent = options.text;
        if (options.title) element.setAttribute('title', options.title);
        Object.entries(options.attrs ?? {}).forEach(([name, value]) => element.setAttribute(name, value));
        if (options.onClick) element.addEventListener('click', options.onClick);
        element.append(...children.filter((child) => child !== null && child !== false && child !== undefined));
        return element;
    }

    /**
     * Prefixes one or more class names.
     * @param {...string} names Class names without the prefix; empty values are skipped.
     * @returns {string} Prefixed class list.
     */
    function cls(...names) {
        return names.filter(Boolean).map((name) => `tms-oc-${name}`).join(' ');
    }

    /**
     * Parses one of the script's constant SVG icons.
     * @param {string} markup Constant SVG markup from SVG.
     * @returns {Element} SVG element.
     */
    function parseSvg(markup) {
        return document.importNode(new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement, true);
    }

    /**
     * Injects the script's scoped styles.
     * @returns {void}
     */
    function injectStyles() {
        const V = `#${CONFIG.IDS.VIEWER}`;
        const S = `#${CONFIG.IDS.SETTINGS}`;
        GM_addStyle(`
            .tms-oc-root {
                --tms-oc-font: rgb(51,51,51); --tms-oc-link: #006699; --tms-oc-green: rgb(92,148,13);
                --tms-oc-yellow: rgb(199,139,7); --tms-oc-red: rgb(224,49,49); --tms-oc-blue: rgb(12,133,153);
                --tms-oc-user: rgb(238,241,228); --tms-oc-footer: rgb(242,242,242); --tms-oc-select: rgba(150,150,150,0.1);
                --tms-oc-active: rgba(150,150,150,0.2); --tms-oc-fancy: #fff; --tms-oc-icon: rgba(100,100,100,0.5);
                --tms-oc-icon-yellow: rgb(230,180,0); --tms-oc-icon-red: rgba(255,135,135,1);
                --tms-oc-panel: #fff; --tms-oc-line: #bbb;
            }
            body.dark-mode .tms-oc-root {
                --tms-oc-font: rgb(221,221,221); --tms-oc-link: rgb(116,192,252); --tms-oc-green: rgb(130,201,30);
                --tms-oc-yellow: rgb(252,196,25); --tms-oc-red: rgb(255,135,135); --tms-oc-blue: rgb(59,201,219);
                --tms-oc-user: rgb(63,68,45); --tms-oc-footer: rgb(51,51,51); --tms-oc-select: rgba(0,0,0,0.2);
                --tms-oc-active: rgba(0,0,0,0.3); --tms-oc-fancy: inherit; --tms-oc-icon: rgba(221,221,221,0.5);
                --tms-oc-icon-yellow: rgba(252,196,25,0.8); --tms-oc-icon-red: rgba(255,135,135,0.8);
                --tms-oc-panel: #2b2b2b; --tms-oc-line: #555;
            }
            .tms-oc-root.tms-oc-hidden, .tms-oc-root .tms-oc-hidden { display: none !important; }
            ${V} .title-black { position: relative; }
            ${V} .tms-oc-extraSettingsButton { color: rgb(116,192,252); cursor: pointer; margin-left: 6px; }
            ${V} .tms-oc-extraSettingsButton:hover { color: rgb(252,196,25); }
            ${V} .tms-oc-hideCrimesButton { position: absolute; right: 10px; cursor: pointer; }
            ${V} .tms-oc-hideLazyMembersButton { position: absolute; right: 100px; cursor: pointer; }
            ${V} .tms-oc-error { padding: 5px 0 5px 20px; }
            ${V} .tms-oc-error button { margin-left: 8px; cursor: pointer; }
            ${V} ul.table-body { display: flex; flex-direction: row; flex-wrap: wrap; }
            ${V} li.table-cell { display: flex; flex-direction: row; order: 420; }
            ${V} li.tms-oc-titleLiAvailableMembers { order: 0; }
            ${V} li.tms-oc-memberAvailable { order: 0; font-weight: normal; padding-left: 10px; }
            ${V} a { color: var(--tms-oc-link); text-decoration: none; }
            ${V} a:hover { text-decoration: underline; }
            ${V} .tms-oc-tableCrimeMemberName a, ${V} .tms-oc-tableMember a { color: inherit; }
            ${V} .tms-oc-textGray { color: rgb(153,153,153); }
            ${V} .tms-oc-memberTable div { font-size: 11px; line-height: 12px; padding: 5px 0; }
            ${V} div.tms-oc-titleCell { display: inline; font-family: "Fjalla One"; padding-left: 10px; width: 784px; box-sizing: border-box; }
            ${V} div.tms-oc-fancyBg { background: repeating-linear-gradient(90deg,#2e2e2e,#2e2e2e 2px,#282828 0,#282828 4px); color: var(--tms-oc-fancy); }
            ${V} div.tms-oc-tableLastCrime { width: 13px; display: inline-block; margin: auto; padding: 0 3px; }
            ${V} div.tms-oc-tableLastCrime svg { display: inline-block; margin: 0 auto -1px auto; }
            ${V} .tms-oc-iconDefault { color: var(--tms-oc-icon); }
            ${V} .tms-oc-iconYellow { color: var(--tms-oc-icon-yellow); }
            ${V} .tms-oc-iconRed { color: var(--tms-oc-icon-red); }
            ${V} .tms-oc-iconVeryRed { color: rgba(200,33,33,1); }
            ${V} div.tms-oc-tableMember { width: 148px; }
            ${V} div.tms-oc-tableStatus { width: 222px; text-align: left; }
            ${V} .tms-oc-statusText.okay { color: var(--tms-oc-green); }
            ${V} .tms-oc-statusText.abroad, ${V} .tms-oc-statusText.traveling { color: var(--tms-oc-blue); }
            ${V} .tms-oc-statusText.hospital, ${V} .tms-oc-statusText.jail, ${V} .tms-oc-statusText.federal { color: var(--tms-oc-red); }
            ${V} .tms-oc-memberName.federal { text-decoration: line-through; color: var(--tms-oc-red); }
            ${V} .tms-oc-memberName.inactive { color: var(--tms-oc-red); }
            ${V} div.tms-oc-tableCrimeMemberCount { width: 50px; }
            ${V} div.tms-oc-tableCrimePosition { width: 100px; font-size: 10px; }
            ${V} div.tms-oc-tableCrimeMemberName { width: 230px; }
            ${V} div.tms-oc-tableCrimeMemberStatus { width: auto; }
            ${V} div.tms-oc-tableCrimeMemberSuccess { width: 25px; text-align: center; }
            ${V} div.tms-oc-tableCrimeMemberItem { width: 40px; text-align: center; }
            ${V} .tms-oc-highSuccess, ${V} .tms-oc-itemHavetrue { color: var(--tms-oc-green); }
            ${V} .tms-oc-midSuccess { color: var(--tms-oc-yellow); }
            ${V} .tms-oc-lowSuccess, ${V} .tms-oc-itemHavefalse { color: var(--tms-oc-red); }
            ${V} div.tms-oc-tableCrime { width: 322px; }
            ${V} .tms-oc-crimeMouseoverWarning { margin-left: 10px; display: inline-block; color: var(--tms-oc-red); }
            ${V} div.tms-oc-tableCountdown { width: auto; }
            ${V} .tms-oc-highlightText { color: var(--tms-oc-yellow); font-weight: bold; }
            ${V} .tms-oc-highlightRed { color: var(--tms-oc-red); font-weight: bold; }
            ${V} .tms-oc-memberTableFooter { border-radius: 0 0 5px 5px; background-color: var(--tms-oc-footer); padding: 5px 5px 5px 10px; text-align: center; }
            ${V} .tms-oc-memberTableFooterFlex { display: flex; flex-wrap: wrap; flex-direction: row; }
            ${V} .tms-oc-memberTableFooterFlex div { padding: 2px 5px; flex-grow: 1; }
            ${V} li.tms-oc-crimeMemberLi { padding-left: 25px; background-color: var(--tms-oc-select); width: 784px; display: none; }
            ${V} li.tms-oc-crimeMemberLi.tms-oc-open { display: flex; }
            ${V} li.tms-oc-lastSlot { border-radius: 0 0 15px 15px; }
            ${V} li.tms-oc-crimeRow { padding-left: 20px; width: 784px; background-color: transparent; }
            ${V} li.tms-oc-crimeLiActive { background-color: var(--tms-oc-active); }
            ${V} li.tms-oc-userIndicator { background-color: var(--tms-oc-user); }
            ${V} .tms-oc-crimeToggle { cursor: pointer; }
            ${V}.tms-oc-crimesOff .tms-oc-crimeLi, ${V}.tms-oc-crimesOff li.tms-oc-crimeMemberLi { display: none; }
            ${V}.tms-oc-membersOff .tms-oc-availableMembers, ${V}.tms-oc-membersOff li.tms-oc-memberAvailable { display: none; }
            ${V} div.tms-oc-sortType { display: inline-block; padding-left: 626px; }
            ${V} div.tms-oc-sortTypeMember { display: inline; padding-left: 564px; }
            ${V} .tms-oc-sortType div, ${V} .tms-oc-sortTypeMember div { display: inline-block; font-family: Arial; padding: 0 0 0 5px; width: 35px; cursor: pointer; text-decoration: none; }
            ${V} .tms-oc-sortType div.tms-oc-sortOn, ${V} .tms-oc-sortTypeMember div.tms-oc-sortOn { text-decoration: underline; }
            ${V} .tms-oc-horizLine { border-bottom: 1px solid rgb(34,34,34); width: 100%; box-sizing: border-box; height: 3px; }
            ${V} .tms-oc-catCrimeTitle { width: 120px; display: inline-block; }
            ${V} .tms-oc-toggleCatCrimesButton { font-size: 11px; font-family: Arial; width: 50px; cursor: pointer; }
            ${V} .tms-oc-statusText:not(.tms-oc-hideSmall) { display: none; }
            ${V} .tms-oc-srOnly { position: absolute; overflow: hidden; width: 1px; height: 1px; clip: rect(1px,1px,1px,1px); padding: 0; border: 0; white-space: nowrap; }
            @media (max-width: 784px) and (min-width: 387px) {
                ${V} div.tms-oc-titleCell, ${V} li.tms-oc-crimeRow, ${V} li.tms-oc-crimeMemberLi { width: 386px; }
                ${V} div.tms-oc-sortType { padding-left: 228px; }
                ${V} div.tms-oc-sortTypeMember { padding-left: 166px; }
                ${V} li.tms-oc-memberAvailable { padding-left: 15px; }
                ${V} .tms-oc-hideSmall { display: none; }
                ${V} .tms-oc-statusText:not(.tms-oc-hideSmall) { display: inline; }
                ${V} div.tms-oc-tableStatus { width: 55px; }
                ${V} div.tms-oc-tableMember { width: 120px; }
                ${V} div.tms-oc-tableCrime { width: 210px; }
                ${V} div.tms-oc-tableCrimeMemberName { width: 220px; }
                ${V} div.tms-oc-tableCrimePosition { width: 70px; }
                ${V} div.tms-oc-tableCrimeMemberStatus { width: 90px; text-align: left; }
                ${V} div.tms-oc-tableCrimeMemberSuccess { width: 18px; }
                ${V} div.tms-oc-tableCrimeMemberItem { width: 30px; }
            }
            @media (max-width: 386px) {
                ${V} div.tms-oc-titleCell, ${V} li.tms-oc-crimeRow, ${V} li.tms-oc-crimeMemberLi { width: 320px; }
                ${V} div.tms-oc-sortType { padding-left: 162px; }
                ${V} div.tms-oc-sortTypeMember { padding-left: 100px; }
                ${V} li.tms-oc-crimeRow, ${V} li.tms-oc-memberAvailable { padding-left: 12px; }
                ${V} li.tms-oc-crimeMemberLi { padding-left: 18px; }
                ${V} .tms-oc-hideSmall { display: none; }
                ${V} .tms-oc-statusText:not(.tms-oc-hideSmall) { display: inline; }
                ${V} div.tms-oc-tableCrimeMemberCount { width: 40px; }
                ${V} div.tms-oc-tableStatus { width: 90px; }
                ${V} div.tms-oc-tableCrime { width: 190px; }
                ${V} div.tms-oc-tableCrimeMemberName { width: 165px; }
            }
            .tms-oc-sidebarLine a { text-decoration: none; color: inherit; }
            .tms-oc-sidebarLine .tms-oc-redtext { color: rgb(255,121,76); }
            ${S} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.55); }
            ${S} .tms-oc-panel { box-sizing: border-box; width: 640px; max-width: 94vw; max-height: 88vh; overflow-y: auto; padding: 16px; border: 1px solid var(--tms-oc-line); border-radius: 6px; color: var(--tms-oc-font); background: var(--tms-oc-panel); font-size: 12px; line-height: 1.4; }
            ${S} h2 { margin: 0 0 8px; font-size: 16px; }
            ${S} h3 { margin: 14px 0 6px; padding-top: 10px; border-top: 1px solid var(--tms-oc-line); font-size: 13px; }
            ${S} a { color: var(--tms-oc-link); }
            ${S} input[type="text"], ${S} input[type="password"], ${S} select { box-sizing: border-box; padding: 5px; margin-right: 6px; color: inherit; background: transparent; border: 1px solid var(--tms-oc-line); }
            ${S} .tms-oc-api-input { -webkit-text-security: disc; }
            ${S} option { color: #222; }
            ${S} button { margin: 2px 4px 2px 0; padding: 4px 10px; cursor: pointer; }
            ${S} fieldset { margin: 0 0 8px; padding: 0; border: 0; }
            ${S} legend { padding: 0; font-weight: bold; }
            ${S} .tms-oc-options label { margin-right: 12px; display: inline-block; }
            ${S} .tms-oc-numberRow { margin-bottom: 6px; }
            ${S} .tms-oc-numberRow input { width: 70px; margin-left: 6px; }
            ${S} .tms-oc-keyGood { color: var(--tms-oc-green); }
            ${S} .tms-oc-keyBad { color: var(--tms-oc-red); }
            ${S} .tms-oc-ignoreRow { display: flex; justify-content: space-between; align-items: center; }
            ${S} .tms-oc-actions { margin-top: 12px; }
        `);
    }

    /**
     * Creates the status display for a member.
     * @param {string} state Status state.
     * @param {string} description Status description.
     * @returns {HTMLElement[]} Short and long status elements.
     */
    function createStatusEls(state, description) {
        const stateClass = String(state).toLowerCase();
        const title = escapeTooltip(description);
        return [
            createEl('span', { className: `${cls('statusText')} ${stateClass}`, title, text: state }),
            createEl('span', { className: `${cls('statusText', 'hideSmall')} ${stateClass}`, title, text: description }),
        ];
    }

    /**
     * Creates a row for a member not in a crime.
     * @param {Object} member Member record.
     * @param {number} nowSec Current time in seconds.
     * @returns {HTMLElement} Row.
     */
    function createMemberRow(member, nowSec) {
        const { model, settings } = view;
        const display = buildMemberDisplay(member, model, settings, nowSec);
        const safeName = escapeTooltip(member.name);
        const isUser = Number(member.id) === Number(model.userId);
        return createEl('li', { className: `table-cell ${cls('memberAvailable', isUser && 'userIndicator')}` }, [
            createEl('div', {
                className: cls('tableCell', 'tableMember'),
                title: `${safeName} [${member.id}]<br />Last OC joined: ${display.lastCrimeText}<br />${escapeTooltip(display.activityText)}`,
            }, [
                createEl('div', { className: cls('tableLastCrime', display.iconClass) }, [
                    createEl('span', {}, [parseSvg(SVG.LAST_CRIME)]),
                ]),
                createEl('a', { attrs: { href: `${CONFIG.URLS.PROFILE}${member.id}` } }, [
                    createEl('span', { className: `${cls('memberName')} ${display.nameClass}`.trim(), text: member.name }),
                    createEl('span', { className: cls('srOnly'), text: `: Last OC joined: ${display.lastCrimeText}: ${display.activityText}` }),
                ]),
            ]),
            createEl('div', { className: cls('tableCell', 'tableStatus') }, [
                createEl('span', { className: cls('srOnly'), text: 'Status:' }),
                ...createStatusEls(member.status, member.statusDesc),
            ]),
        ]);
    }

    /**
     * Creates the clickable sort controls.
     * @param {string} wrapperClass Wrapper class name.
     * @param {Array<{id: string, field: string, label: string}>} options Sort options.
     * @param {string} current Current sort setting.
     * @param {(field: string) => void} onSort Called with the chosen field.
     * @returns {HTMLElement} Sort controls.
     */
    function createSortControls(wrapperClass, options, current, onSort) {
        const [currentField, direction] = current.split('-');
        return createEl('div', { className: cls(wrapperClass), text: 'Sort: ' }, options.map(({ id, field, label }) => {
            const active = field === currentField;
            const arrow = direction === 'desc' ? CONFIG.ICONS.DESC : CONFIG.ICONS.ASC;
            return createEl('div', {
                id,
                className: active ? cls('sortOn') : '',
                text: `${label}${active ? arrow : ''}`,
                onClick: () => onSort(field),
            });
        }));
    }

    /**
     * Toggles a sort field's direction and saves it.
     * @param {string} settingName Setting to change.
     * @param {string} field Chosen field.
     * @param {string} firstDirection Direction used when switching fields.
     * @returns {void}
     */
    function changeSort(settingName, field, firstDirection) {
        const current = view.settings[settingName];
        const opposite = firstDirection === 'asc' ? 'desc' : 'asc';
        view.settings[settingName] = current === `${field}-${firstDirection}` ? `${field}-${opposite}` : `${field}-${firstDirection}`;
        Storage.set(CONFIG.STORAGE_KEYS.SETTINGS, view.settings);
        collapseCrimes();
        renderOverview();
    }

    /**
     * Closes every expanded crime and list.
     * @returns {void}
     */
    function collapseCrimes() {
        view.openCrimes.clear();
        view.expandedLists.clear();
    }

    /**
     * Creates the rows for one crime slot.
     * @param {Object} slot Slot display details.
     * @param {number} crimeId Crime ID.
     * @param {boolean} isLast True for the crime's last slot.
     * @returns {HTMLElement} Row.
     */
    function createSlotRow(slot, crimeId, isLast) {
        const { settings } = view;
        const requirement = slot.requirement;
        const itemEl = requirement && createEl('span', { className: cls(`itemHave${requirement.is_available}`) }, [
            CONFIG.ICONS.ITEM,
            requirement.is_reusable && createEl('span', { text: CONFIG.ICONS.INFINITY, attrs: { style: 'vertical-align:top' } }),
        ]);

        let nameCell;
        if (slot.member) {
            nameCell = [
                createEl('a', { text: slot.member.name, attrs: { href: `${CONFIG.URLS.PROFILE}${slot.userId}` } }),
                settings.showProgressPercentage === 'progress-show' && slot.progress !== null
                    && createEl('span', { text: ` ${slot.progress}%`, attrs: { style: 'font-size: 9px' } }),
            ];
        } else if (slot.memberName) {
            nameCell = [createEl('span', { className: cls('textGray'), text: slot.memberName })];
        } else {
            nameCell = [createEl('span', { className: cls('textGray'), text: '    N/A' })];
        }

        const open = view.openCrimes.has(crimeId);
        return createEl('li', {
            className: `table-cell ${cls('crimeMemberLi', `crimeID_${crimeId}`, slot.isUser && 'userIndicator', isLast && 'lastSlot', open && 'open')}`,
        }, [
            createEl('div', { className: cls('tableCell', 'tableCrimeMemberSuccess') }, [
                createEl('span', { className: cls(slot.successStyle), text: slot.successText }),
            ]),
            createEl('div', { className: cls('tableCell', 'tableCrimeMemberItem'), title: slot.itemTitle }, [itemEl]),
            createEl('div', { className: cls('tableCell', 'hideSmall', 'tableCrimePosition'), text: slot.position }),
            createEl('div', { className: cls('tableCell', 'tableCrimeMemberName') }, nameCell),
            createEl('div', { className: cls('tableCell', 'tableCrimeMemberStatus') },
                slot.member ? createStatusEls(slot.member.status, slot.member.statusDesc) : []),
        ]);
    }

    /**
     * Creates a crime's summary row and its slot rows.
     * @param {Object} crime Crime.
     * @param {number} nowSec Current time in seconds.
     * @returns {HTMLElement[]} Rows.
     */
    function createCrimeRows(crime, nowSec) {
        const { model, settings, itemNames } = view;
        const positions = labelPositions(crime.slots);
        const slots = crime.slots.map((slot, index) => buildSlotDisplay(slot, positions[index], model, settings, itemNames));
        const timing = describeCrimeTiming(crime, nowSec, narrowQuery.matches, settings.showNegativeTimes === 'negative-timer-show');
        const warnings = buildCrimeWarnings(slots, itemNames);
        const open = view.openCrimes.has(crime.id);
        const hasUser = slots.some((slot) => slot.isUser);
        const toggle = () => toggleCrime(crime.id);
        const probability = view.probabilities[crime.id];

        const summary = createEl('li', {
            className: `table-cell ${cls('crimeLi', 'crimeRow', timing.listClass, `crimeID_${crime.id}`, hasUser && 'userIndicator', open && 'crimeLiActive')}`,
            attrs: { 'data-crime-id': String(crime.id) },
        }, [
            createEl('div', { className: cls('tableCell', 'tableCrimeMemberCount', 'crimeToggle'), onClick: toggle }, [
                createEl('span', {}, [parseSvg(open ? SVG.EXPANDED : SVG.COLLAPSED)]),
                `  ${slots.filter((slot) => slot.userId !== null).length} / ${slots.length}`,
            ]),
            createEl('div', { className: cls('tableCell', 'tableCrime') }, [
                createEl('span', { className: cls('crimeMouseoverWarning'), title: warnings.title, text: warnings.icon }),
                createEl('a', { text: `Lv${crime.difficulty} ${crime.name}`, attrs: { href: `${CONFIG.URLS.CRIME_LINK}${crime.id}` } }),
                probability && createEl('span', { className: cls('probability'), text: `  ${probability}%` }),
            ]),
            createEl('div', { className: cls('tableCell', 'tableCountdown', 'crimeToggle'), title: timing.title, onClick: toggle }, [
                createEl('span', { className: cls('countdownText'), text: timing.label }),
                ' ',
                createEl('span', { className: cls('countdown'), attrs: { 'data-countdown': String(timing.target) } }),
            ]),
        ]);

        return [summary, ...slots.map((slot, index) => createSlotRow(slot, crime.id, index === slots.length - 1))];
    }

    /**
     * Expands or collapses one crime.
     * @param {number} crimeId Crime ID.
     * @returns {void}
     */
    function toggleCrime(crimeId) {
        if (view.openCrimes.has(crimeId)) view.openCrimes.delete(crimeId);
        else view.openCrimes.add(crimeId);
        renderOverview();
    }

    /**
     * Expands or collapses all crimes in a list.
     * @param {string} listName Model list name.
     * @returns {void}
     */
    function toggleCrimeList(listName) {
        const crimes = view.model[listName];
        if (view.expandedLists.has(listName)) {
            view.expandedLists.delete(listName);
            crimes.forEach((crime) => view.openCrimes.delete(crime.id));
        } else {
            view.expandedLists.add(listName);
            crimes.forEach((crime) => view.openCrimes.add(crime.id));
        }
        renderOverview();
    }

    /**
     * Creates one crime category heading and its rows, newest draw first to match the sort labels.
     * @param {string} title Heading text.
     * @param {string} titleId Heading ID.
     * @param {string} listName Model list name.
     * @param {string} timeField Timestamp used for time sorts.
     * @param {number} nowSec Current time in seconds.
     * @returns {HTMLElement[]} Rows.
     */
    function createCrimeSection(title, titleId, listName, timeField, nowSec) {
        const crimes = sortCrimeList(view.model[listName], view.settings.sortType, timeField);
        const heading = createEl('li', { className: `table-cell ${cls('crimeLi', 'titleLi')}` }, [
            createEl('div', { className: cls('titleCell'), id: titleId }, [
                createEl('span', { className: cls('catCrimeTitle'), text: title }),
                ' ',
                createEl('span', {
                    className: cls('toggleCatCrimesButton'),
                    text: view.expandedLists.has(listName) ? '[ Hide all ]' : '[ Show all ]',
                    onClick: () => toggleCrimeList(listName),
                }),
            ]),
        ]);
        const rows = crimes.length
            ? [...crimes].reverse().flatMap((crime) => createCrimeRows(crime, nowSec))
            : [createEl('li', { className: `table-cell ${cls('crimeLi', 'crimeRow')}` }, [
                createEl('div', { className: cls('tableCell', 'tableCrime'), text: 'None' }),
            ])];
        return [heading, ...rows];
    }

    /**
     * Creates the rows for members not in a crime.
     * @param {number} nowSec Current time in seconds.
     * @returns {HTMLElement[]} Rows.
     */
    function createMemberSection(nowSec) {
        const { model, settings } = view;
        const ignored = new Set(settings.memberIgnoreList);
        const heading = createEl('li', { className: `table-cell ${cls('availableMembers', 'titleLiAvailableMembers')}` }, [
            createEl('div', { className: cls('titleCell', 'fancyBg') }, [
                'Members not in an OC',
                createSortControls('sortTypeMember', [
                    { id: 'tms-oc-sortOCButton', field: 'OC', label: 'OC' },
                    { id: 'tms-oc-sortActiveButton', field: 'active', label: 'active' },
                ], settings.memberSort, (field) => changeSort('memberSort', field, field === 'OC' ? 'asc' : 'desc')),
            ]),
        ]);
        const members = sortMembers(model.availableList, settings.memberSort)
            .filter((member) => !ignored.has(String(member.id)))
            .reverse()
            .map((member) => createMemberRow(member, nowSec));
        applyMemberColumns(members);
        return [heading, ...members];
    }

    /**
     * Applies column-first ordering to member rows when that setting is on.
     * @param {HTMLElement[]} rows Member rows in display order.
     * @returns {void}
     */
    function applyMemberColumns(rows) {
        if (view.settings.memberDirectionality !== 'column-row' || tinyQuery.matches) return;
        const firstColumn = Math.ceil(rows.length / 2);
        rows.forEach((row, index) => {
            row.style.order = String(index < firstColumn ? (index + 1) * 2 - 1 : (index - firstColumn + 1) * 2);
        });
    }

    /**
     * Fills the footer with member and crime slot totals.
     * @param {HTMLElement} footer Footer element.
     * @returns {void}
     */
    function renderFooter(footer) {
        const { model, settings } = view;
        const ignoredCount = settings.memberIgnoreList.length;
        const skipTitle = model.skippedMembers.length
            ? `Recruits unavailable for OCs:${model.skippedMembers.map((member) => `<br />${escapeTooltip(member.name)} [${member.id}]`).join('')}`
            : '';

        const soonCounts = {};
        model.soonAvailableMembers.forEach((id) => {
            const level = model.members[id].crimeInfo.crimeDifficulty;
            soonCounts[level] = (soonCounts[level] || 0) + 1;
        });

        footer.replaceChildren(createEl('div', { className: cls('memberTableFooterFlex') }, [
            createEl('div', { title: skipTitle, text: `${model.availableMembers} members available ${ignoredCount ? `(${ignoredCount} ignored)` : ''}`.trim() }),
            createEl('div', {
                className: cls('footerSoonAvailableMembers'),
                title: model.soonAvailableMembers.length ? levelCountsTitle('OCs finishing soon:', soonCounts, ' members') : '',
                text: `+${model.soonAvailableMembers.length} available within 24h`,
            }),
            createEl('div', {
                className: cls('footerCrimeSlots'),
                title: model.availableCrimeSlotsCount ? levelCountsTitle('Available slots:', model.availableCrimeSlots) : 'All crime slots are occupied by members',
                text: `${model.availableCrimeSlotsCount} crime slots available`,
            }),
            view.probabilityError && createEl('div', { className: cls('textGray'), text: view.probabilityError }),
        ]));
    }

    /**
     * Updates the show and hide buttons and visibility classes.
     * @param {HTMLElement} viewer Viewer element.
     * @returns {void}
     */
    function syncViewerToggles(viewer) {
        viewer.classList.toggle(cls('membersOff'), !view.membersVisible);
        viewer.classList.toggle(cls('crimesOff'), !view.crimesVisible);
        viewer.querySelector(`.${cls('hideLazyMembersButton')}`).textContent = view.membersVisible ? 'Hide Members' : 'Show Members';
        viewer.querySelector(`.${cls('hideCrimesButton')}`).textContent = view.crimesVisible ? 'Hide Crimes' : 'Show Crimes';
    }

    /**
     * Shows a message above the table, or clears it.
     * @param {string} message Message; empty hides it.
     * @param {boolean} [showSettingsButton=false] True to add a Settings button.
     * @returns {void}
     */
    function showViewerMessage(message, showSettingsButton = false) {
        const box = document.querySelector(`#${CONFIG.IDS.VIEWER} .${cls('error')}`);
        if (!box) return;
        box.classList.toggle(cls('hidden'), !message);
        box.replaceChildren(message, showSettingsButton
            ? createEl('button', { text: 'Open Settings', attrs: { type: 'button' }, onClick: openSettings })
            : '');
    }

    /**
     * Draws the overview from the current model.
     * @returns {void}
     */
    function renderOverview() {
        const viewer = document.getElementById(CONFIG.IDS.VIEWER);
        if (!viewer || !view.model) return;

        const nowSec = Math.floor(Date.now() / 1000);
        viewer.querySelector('ul.table-body').replaceChildren(
            ...createMemberSection(nowSec),
            createEl('li', { className: `table-cell ${cls('crimeLi', 'titleLi')}` }, [
                createEl('div', { className: cls('titleCell', 'fancyBg') }, [
                    'Crimes',
                    createSortControls('sortType', [
                        { id: 'tms-oc-sortLevelButton', field: 'level', label: 'level' },
                        { id: 'tms-oc-sortTimeButton', field: 'time', label: 'time' },
                    ], view.settings.sortType, (field) => changeSort('sortType', field, 'asc')),
                ]),
            ]),
            ...createCrimeSection('Uninitiated Crimes', 'tms-oc-titleUninitiated', 'uninitiated', 'expired_at', nowSec),
            createEl('li', { className: `table-cell ${cls('crimeLi', 'horizLine')}` }),
            ...createCrimeSection('Recruiting Crimes', 'tms-oc-titleRecruiting', 'recruiting', 'ready_at', nowSec),
            createEl('li', { className: `table-cell ${cls('crimeLi', 'horizLine')}` }),
            ...createCrimeSection('Full Crimes', 'tms-oc-titleFull', 'planning', 'ready_at', nowSec),
        );
        renderFooter(viewer.querySelector(`.${cls('memberTableFooter')}`));
        viewer.querySelector(`.${cls('memberTable')}`).classList.remove(cls('hidden'));
        viewer.querySelector(`.${cls('memberTableFooter')}`).classList.remove(cls('hidden'));
        syncViewerToggles(viewer);
        tickCountdowns();
    }

    /**
     * Updates every visible countdown.
     * @returns {void}
     */
    function tickCountdowns() {
        const viewer = document.getElementById(CONFIG.IDS.VIEWER);
        if (!viewer || viewer.classList.contains(cls('hidden')) || document.hidden || !view.settings) return;
        const nowSec = Math.floor(Date.now() / 1000);
        const showNegative = view.settings.showNegativeTimes === 'negative-timer-show';
        viewer.querySelectorAll(`.${cls('countdown')}`).forEach((element) => {
            const { text, highlight } = formatCountdown(Number(element.dataset.countdown), nowSec, showNegative);
            element.textContent = text;
            const className = cls('countdown', highlight);
            if (element.className !== className) element.className = className;
        });
    }

    /**
     * Creates the overview shell.
     * @returns {HTMLElement} Viewer element.
     */
    function createViewer() {
        const toggleMembers = () => {
            view.membersVisible = !view.membersVisible;
            syncViewerToggles(document.getElementById(CONFIG.IDS.VIEWER));
        };
        const toggleCrimes = () => {
            view.crimesVisible = !view.crimesVisible;
            collapseCrimes();
            renderOverview();
        };

        return createEl('div', { id: CONFIG.IDS.VIEWER, className: `category-wrap m-top10 ${cls('root')}` }, [
            createEl('div', { className: 'title-black top-round t-overflow' }, [
                'OC 2.0 Overview',
                createEl('span', { className: cls('extraSettingsButton'), title: 'Open Settings', text: '⚙', onClick: openSettings }),
                createEl('span', { className: cls('hideLazyMembersButton'), onClick: toggleMembers }),
                createEl('span', { className: cls('hideCrimesButton'), onClick: toggleCrimes }),
            ]),
            createEl('div', { className: `cont-gray ${cls('error', 'hidden')}` }),
            createEl('div', { className: `cont-gray ${cls('memberTable', 'hidden')}` }, [createEl('ul', { className: 'table-body' })]),
            createEl('div', { className: cls('memberTableFooter', 'hidden') }),
        ]);
    }

    /**
     * Waits for an element to appear.
     * @param {string} selector CSS selector.
     * @param {number} [timeoutMs=CONFIG.ELEMENT_WAIT_MS] Maximum wait.
     * @returns {Promise<Element|null>} Element, or null after the timeout.
     */
    function waitForElement(selector, timeoutMs = CONFIG.ELEMENT_WAIT_MS) {
        return new Promise((resolve) => {
            const existing = document.querySelector(selector);
            if (existing) {
                resolve(existing);
                return;
            }
            let timer = 0;
            const observer = new MutationObserver(() => {
                const found = document.querySelector(selector);
                if (!found) return;
                observer.disconnect();
                clearTimeout(timer);
                resolve(found);
            });
            observer.observe(document.body, { childList: true, subtree: true });
            timer = setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeoutMs);
        });
    }

    /**
     * Checks whether the page is the faction crimes tab.
     * @returns {boolean} True on the crimes tab.
     */
    function isCrimesPage() {
        const url = window.location.href;
        return url.includes('step=your') && url.includes('tab=crimes');
    }

    /**
     * Checks whether Torn says the player is traveling or abroad.
     * @returns {boolean} True when away.
     */
    function isAway() {
        return document.body.dataset.traveling === 'true' || document.body.dataset.abroad === 'true';
    }

    /**
     * Checks whether a page is the given faction's public page.
     * @param {number} factionId Faction ID.
     * @returns {boolean} True on that faction's page.
     */
    function isOwnFactionPage(factionId) {
        const match = window.location.href.match(/(?:[?&#/])ID=(\d+)/);
        return Number(match?.[1]) === Number(factionId);
    }

    /**
     * Applies view defaults from settings when the overview is first created.
     * @returns {void}
     */
    function applyViewDefaults() {
        view.settings = getSettings();
        view.membersVisible = view.settings.memberShow !== 'member-hide';
        view.crimesVisible = view.settings.crimesShow !== 'crimes-hide';
    }

    /**
     * Builds the display model from a load result.
     * @param {FactionResult} result Load result.
     * @returns {Promise<Object>} Display model.
     */
    async function buildModel(result) {
        const userId = await loadUserId();
        return analyzeFaction(result.data, userId, getSettings(), Math.floor(Date.now() / 1000));
    }

    /**
     * Runs a task for each item with limited concurrency, collecting every outcome.
     * @template T
     * @param {T[]} items Items to process.
     * @param {number} limit Maximum tasks running at once.
     * @param {(item: T) => Promise<void>} task Task for one item.
     * @returns {Promise<Array<{status: string}>>} One outcome per item.
     */
    async function settleWithLimit(items, limit, task) {
        const results = [];
        let next = 0;
        const worker = async () => {
            while (next < items.length) {
                const index = next;
                next += 1;
                try {
                    await task(items[index]);
                    results[index] = { status: 'fulfilled' };
                } catch (reason) {
                    results[index] = { status: 'rejected', reason };
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
        return results;
    }

    /**
     * Loads success chances in the background and redraws when they arrive.
     * @returns {Promise<void>} Resolves when lookups finish.
     */
    async function loadProbabilities() {
        if (view.settings.showAllenoneScript === 'torn-probability-hide') return;
        try {
            const scenarios = await loadScenarios();
            const crimes = view.model.planning.filter((crime) => scenarios.includes(crime.name));
            const results = await settleWithLimit(crimes, CONFIG.PROBABILITY_CONCURRENCY, async (crime) => {
                view.probabilities[crime.id] = await loadCrimeProbability(crime);
            });
            view.probabilityError = results.some((result) => result.status === 'rejected')
                ? 'Some success chances are unavailable from tornprobability.com.'
                : '';
        } catch (error) {
            log('Success chance lookup failed', error.message);
            view.probabilityError = 'Success chances are unavailable from tornprobability.com.';
        }
        renderOverview();
    }

    /**
     * Loads data and fills the overview.
     * @param {boolean} [force=false] True to skip the cache and cooldown.
     * @returns {Promise<void>} Resolves once drawn.
     */
    async function refreshOverview(force = false) {
        try {
            const result = await loadFaction(force);
            view.result = result;
            view.settings = getSettings();
            view.model = await buildModel(result);
            view.itemNames = await loadItemNames(collectItemIds(view.model));
            showViewerMessage(result.stale ? `Showing saved data from ${new Date(result.ts).toLocaleString()}. ${result.message}` : '');
            renderOverview();
            loadProbabilities();
        } catch (error) {
            showViewerMessage(error.message || String(error), error.code === 1 || error.code === 2 || error.code === 16);
        }
    }

    /**
     * Creates the overview at a location and loads it.
     * @param {Element} anchor Element the overview goes before.
     * @returns {void}
     */
    function insertViewer(anchor) {
        applyViewDefaults();
        anchor.before(createViewer());
        syncViewerToggles(document.getElementById(CONFIG.IDS.VIEWER));
        refreshOverview();
        if (!view.timerId) view.timerId = window.setInterval(tickCountdowns, CONFIG.TIMER_MS);
    }

    /**
     * Shows the overview on pages where it belongs and hides it elsewhere.
     * @returns {Promise<void>} Resolves when the page has been handled.
     */
    async function syncOverview() {
        const viewer = document.getElementById(CONFIG.IDS.VIEWER);
        if (isCrimesPage()) {
            if (viewer) {
                viewer.classList.remove(cls('hidden'));
                return;
            }
            const anchor = await waitForElement(CONFIG.SELECTORS.CRIMES_ROOT);
            if (anchor && !document.getElementById(CONFIG.IDS.VIEWER)) insertViewer(anchor);
            return;
        }

        if (viewer && !isAway()) viewer.classList.add(cls('hidden'));
        if (viewer || !isAway() || !window.location.href.includes('ID=') || !getApiKey()) return;

        try {
            const result = await loadFaction();
            if (!isOwnFactionPage(result.data.basic.id)) return;
            const anchor = await waitForElement(CONFIG.SELECTORS.TRAVEL_ROOT);
            if (anchor && !document.getElementById(CONFIG.IDS.VIEWER)) insertViewer(anchor);
        } catch (error) {
            log('Travel overview unavailable', error.message);
        }
    }

    /**
     * Adds or refreshes your OC status in the sidebar.
     * @returns {Promise<void>} Resolves when done.
     */
    async function syncSidebarNotice() {
        document.getElementById(CONFIG.IDS.NOTICE)?.remove();
        if (getSettings().showSidebarOC !== 'sidebar-show' || !getApiKey()) return;

        const sidebar = await waitForElement(CONFIG.SELECTORS.SIDEBAR);
        if (!sidebar) return;

        try {
            const model = await buildModel(await loadFaction());
            document.getElementById(CONFIG.IDS.NOTICE)?.remove();
            sidebar.append(createSidebarNotice(model.userInfo?.crimeInfo));
        } catch (error) {
            log('Sidebar notice unavailable', error.message);
        }
    }

    /**
     * Creates the sidebar OC line.
     * @param {Object|undefined} crimeInfo Your current crime, if any.
     * @returns {HTMLElement} Notice.
     */
    function createSidebarNotice(crimeInfo) {
        const title = crimeInfo
            ? `${escapeTooltip(crimeInfo.crimePosition)} (${crimeInfo.crimeSuccess}%)`
            : 'You are not currently participating in an OC.';
        const detail = crimeInfo
            ? createEl('a', { text: `Lv ${crimeInfo.crimeDifficulty} ${crimeInfo.crimeName}`, attrs: { href: `${CONFIG.URLS.SIDEBAR_CRIME_LINK}${crimeInfo.crimeId}` } })
            : createEl('a', { attrs: { href: CONFIG.URLS.CRIMES } }, [createEl('span', { className: cls('redtext'), text: 'No active OC.' })]);
        return createEl('div', { id: CONFIG.IDS.NOTICE, className: `${cls('root', 'sidebarLine')}`, title }, [
            createEl('a', { attrs: { href: CONFIG.URLS.CRIMES } }, [createEl('span', { text: 'OC 2.0:', attrs: { style: 'font-weight: bold' } })]),
            ' ',
            detail,
        ]);
    }

    /**
     * Creates a set of radio options.
     * @param {string} legend Question text.
     * @param {string} setting Setting name.
     * @param {Array<[string, string]>} options Value and label pairs.
     * @param {Object} draft Settings being edited.
     * @param {string} [hint=''] Tooltip text.
     * @returns {HTMLElement} Fieldset.
     */
    function createRadioField(legend, setting, options, draft, hint = '') {
        return createEl('fieldset', { title: hint }, [
            createEl('legend', { text: legend }),
            createEl('div', { className: cls('options') }, options.map(([value, label]) => {
                const input = createEl('input', { attrs: { type: 'radio', name: `tms-oc-${setting}`, value } });
                input.checked = draft[setting] === value;
                input.addEventListener('change', () => {
                    draft[setting] = value;
                });
                return createEl('label', {}, [input, ` ${label}`]);
            })),
        ]);
    }

    /**
     * Creates a whole-number setting row.
     * @param {string} label Field label.
     * @param {string} setting Setting name.
     * @param {string} suffix Text after the field.
     * @param {Object} draft Settings being edited.
     * @returns {HTMLElement} Row.
     */
    function createNumberField(label, setting, suffix, draft) {
        const input = createEl('input', { attrs: { type: 'text', size: '10', inputmode: 'numeric', 'data-setting': setting } });
        input.value = String(draft[setting]);
        return createEl('div', { className: cls('numberRow') }, [label, input, suffix]);
    }

    /**
     * Creates the display preference fields.
     * @param {Object} draft Settings being edited.
     * @returns {HTMLElement[]} Fields.
     */
    function createPreferenceFields(draft) {
        const yesNo = (yes, no) => [[yes, 'Yes'], [no, 'No']];
        return [
            createRadioField('Show OC information in sidebar?', 'showSidebarOC', yesNo('sidebar-show', 'sidebar-hide'), draft, 'Adds your current OC, or a warning if you are not in one, to the sidebar.'),
            createRadioField('Show countup timer if crime is delayed?', 'showNegativeTimes', yesNo('negative-timer-show', 'negative-timer-hide'), draft, 'Delayed crime timers turn red and count up instead of staying at zero.'),
            createRadioField('Show self success chance in empty crimes?', 'showSelfSuccessRate', yesNo('self-success-show', 'self-success-hide'), draft),
            createRadioField('Show overall success chance of full crimes?', 'showAllenoneScript', yesNo('torn-probability-show', 'torn-probability-hide'), draft, 'Only crimes with mapped routes can show a chance. See the disclosure below.'),
            createRadioField('On load, show "Members not in an OC" section?', 'memberShow', yesNo('member-show', 'member-hide'), draft),
            createRadioField('Default sort for "Members not in an OC"?', 'memberSort', [['OC-desc', 'OC: Asc'], ['OC-asc', 'OC: Desc'], ['active-asc', 'Active: Asc'], ['active-desc', 'Active: Desc']], draft),
            createRadioField('Ordering of member list (if 2 columns are shown)?', 'memberDirectionality', [['row-column', 'left-to-right, row then column'], ['column-row', 'top-to-bottom, column then row']], draft),
            createRadioField('On load, show "Crimes" section?', 'crimesShow', yesNo('crimes-show', 'crimes-hide'), draft),
            createRadioField('Default sort for "Crimes"?', 'sortType', [['time-asc', 'Time: Asc'], ['time-desc', 'Time: Desc'], ['level-asc', 'Level: Asc'], ['level-desc', 'Level: Desc']], draft),
            createRadioField('Show member crime planning %?', 'showProgressPercentage', yesNo('progress-show', 'progress-hide'), draft),
        ];
    }

    /**
     * Describes the permissions a key has for this script.
     * @param {Object} data Response from /key/info.
     * @returns {Array<{label: string, ok: boolean}>} Checks.
     */
    function checkKeyPermissions(data) {
        const info = data?.info || {};
        const faction = info.selections?.faction || [];
        const torn = info.selections?.torn || [];
        return [
            { label: 'Minimal Access (or higher)', ok: CONFIG.ALLOWED_KEY_TYPES.includes(info.access?.type) },
            { label: 'Faction API access', ok: info.access?.faction === true },
            { label: 'Faction basic', ok: faction.includes('basic') },
            { label: 'Faction crimes', ok: faction.includes('crimes') },
            { label: 'Faction members', ok: faction.includes('members') },
            { label: 'Torn items', ok: torn.includes('items') },
        ];
    }

    /**
     * Tests a key and saves it when every permission is present.
     * @param {HTMLInputElement} input Key field.
     * @param {HTMLElement} results Results area.
     * @returns {Promise<void>} Resolves after the test.
     */
    async function saveKeyFromInput(input, results) {
        const key = input.value.trim();
        if (!key) {
            results.replaceChildren('Paste a key first.');
            return;
        }

        results.replaceChildren('Testing...');
        try {
            const checks = checkKeyPermissions(await api.get('/key/info', {}, key));
            const good = checks.every((check) => check.ok);
            results.replaceChildren(
                ...checks.map((check) => createEl('div', { className: cls(check.ok ? 'keyGood' : 'keyBad'), text: `${check.label}: ${check.ok ? 'OK' : 'missing'}` })),
                createEl('div', { className: cls(good ? 'keyGood' : 'keyBad'), text: good ? 'Key saved.' : 'Key not saved. It is missing a required permission.' }),
            );
            if (!good) return;
            setApiKey(key);
            input.value = '';
            input.placeholder = 'Key saved. Paste a new key to replace it.';
            Cache.clearApiData();
            refreshEverything(true);
        } catch (error) {
            results.replaceChildren(createEl('div', { className: cls('keyBad'), text: `Key not saved. ${error.message || error}` }));
        }
    }

    /**
     * Refreshes the overview and sidebar after a change.
     * @param {boolean} [force=false] True to skip the cache.
     * @returns {void}
     */
    function refreshEverything(force = false) {
        if (document.getElementById(CONFIG.IDS.VIEWER)) refreshOverview(force).then(syncSidebarNotice);
        else syncOverview().then(syncSidebarNotice);
    }

    /**
     * Draws the ignored members list.
     * @param {HTMLElement} list List element.
     * @param {Object[]} members Faction members.
     * @returns {void}
     */
    function renderIgnoreList(list, members) {
        const byId = new Map(members.map((member) => [String(member.id), member]));
        view.ignoreDraft = view.ignoreDraft.filter((id) => byId.has(id));
        list.replaceChildren(...view.ignoreDraft.map((id) => createEl('div', { className: cls('ignoreRow') }, [
            createEl('span', { text: `${byId.get(id).name} [${id}]` }),
            createEl('span', { text: byId.get(id).last_action?.relative || '' }),
            createEl('button', {
                text: 'Remove',
                attrs: { type: 'button' },
                onClick: () => {
                    view.ignoreDraft = view.ignoreDraft.filter((item) => item !== id);
                    renderIgnoreList(list, members);
                },
            }),
        ])));
    }

    /**
     * Creates the member ignore controls and fills them from faction data.
     * @returns {HTMLElement} Section.
     */
    function createIgnoreSection() {
        const filter = createEl('input', { attrs: { type: 'text', placeholder: 'Filter members', 'aria-label': 'Filter members' } });
        const select = createEl('select', { attrs: { 'aria-label': 'Member to ignore' } });
        const list = createEl('div');
        const notice = createEl('div');
        let members = [];

        /**
         * Rebuilds the member choices from the filter.
         * @returns {void}
         */
        const fillSelect = () => {
            const search = filter.value.toLowerCase();
            select.replaceChildren(createEl('option', { attrs: { value: '' } }), ...members
                .filter((member) => member.name.toLowerCase().includes(search))
                .map((member) => createEl('option', { text: `${member.name} [${member.id}]`, attrs: { value: String(member.id) } })));
        };

        filter.addEventListener('input', fillSelect);
        const add = createEl('button', {
            text: 'Add',
            attrs: { type: 'button' },
            onClick: () => {
                if (select.value && !view.ignoreDraft.includes(select.value)) view.ignoreDraft.push(select.value);
                renderIgnoreList(list, members);
            },
        });

        loadFaction().then((result) => {
            members = [...result.data.members].sort((a, b) => a.name.localeCompare(b.name));
            fillSelect();
            renderIgnoreList(list, members);
        }).catch((error) => {
            notice.textContent = `Member list unavailable. ${error.message || error}`;
            add.disabled = true;
        });

        return createEl('div', {}, [notice, filter, select, add, list]);
    }

    /**
     * Copies edited number fields into the draft.
     * @param {HTMLElement} panel Settings panel.
     * @param {Object} draft Settings being edited.
     * @returns {string} Error text, or empty when valid.
     */
    function readNumberFields(panel, draft) {
        for (const input of panel.querySelectorAll('input[data-setting]')) {
            const value = Number(input.value);
            if (!Number.isInteger(value) || value < 0) return 'Enter whole numbers of 0 or more.';
            draft[input.dataset.setting] = value;
        }
        return '';
    }

    /**
     * Opens the Settings panel. The saved key is never placed in the page.
     * @returns {void}
     */
    function openSettings() {
        const { SETTINGS } = CONFIG.IDS;
        if (document.getElementById(SETTINGS)) return;

        const draft = getSettings();
        view.ignoreDraft = [...draft.memberIgnoreList];

        const keyInput = createEl('input', {
            className: cls('api-input'),
            attrs: { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'data-lpignore': 'true', 'data-1p-ignore': 'true', size: '28', 'aria-label': 'Torn API key', placeholder: getApiKey() ? 'Key saved. Paste a new key to replace it.' : 'Torn API key' },
        });
        const keyResults = createEl('div');
        const status = createEl('div', { attrs: { role: 'status', 'aria-live': 'polite' } });

        /**
         * Closes the panel.
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
         * Validates and saves the panel's settings.
         * @returns {void}
         */
        const save = () => {
            const problem = readNumberFields(panel, draft);
            if (problem) {
                status.textContent = problem;
                return;
            }
            draft.memberIgnoreList = [...view.ignoreDraft];
            Storage.set(CONFIG.STORAGE_KEYS.SETTINGS, draft);
            status.textContent = 'Settings saved!';
            view.settings = getSettings();
            refreshEverything();
        };

        /**
         * Restores default settings in storage and reopens the panel.
         * @returns {void}
         */
        const reset = () => {
            Storage.remove(CONFIG.STORAGE_KEYS.SETTINGS);
            close();
            view.settings = getSettings();
            refreshEverything();
            openSettings();
        };

        const panel = createEl('div', { className: cls('panel'), attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'OC Helper settings' } }, [
            createEl('h2', { text: 'OC Helper Settings' }),
            createEl('h3', { text: 'API Key' }),
            createEl('div', { text: 'Use Minimal Access or higher with faction API access. The key is stored only in Tampermonkey.' }),
            keyInput,
            createEl('button', { text: 'Test and save key', attrs: { type: 'button' }, onClick: () => saveKeyFromInput(keyInput, keyResults) }),
            createEl('button', {
                text: 'Delete key',
                attrs: { type: 'button' },
                onClick: () => {
                    setApiKey('');
                    Cache.clearApiData();
                    keyInput.placeholder = 'Torn API key';
                    keyResults.textContent = 'API key removed. To be sure it is secure, delete it on Torn too.';
                },
            }),
            keyResults,
            createEl('h3', { text: 'Preferences' }),
            ...createPreferenceFields(draft),
            createEl('h3', { text: 'Highlight & Indicator settings' }),
            createNumberField("Time since last OC for 'yellow' highlight:", 'lastOC_yellow', ' hours', draft),
            createNumberField("Time since last OC for 'red' highlight:", 'lastOC_red', ' hours', draft),
            createNumberField("Time since last activity for 'inactive' indicator:", 'lastActivity', ' hours', draft),
            createNumberField("Member slot 'low success' warning:", 'warnLowSuccessPercentage', ' %', draft),
            createEl('h3', { text: 'Member Ignore List' }),
            createIgnoreSection(),
            createEl('h3', { text: 'Data sharing disclosure' }),
            createEl('div', {}, [
                'When "Show overall success chance" is on, the crime name and each slot\'s pass rate for your faction\'s Planning crimes are sent to tornprobability.com, a third-party service. Your API key, your name, and member names are never sent. Turn that option off to stop sending this data. ',
                createEl('a', { text: 'Service forum post', attrs: { href: CONFIG.URLS.PROBABILITY_POST, target: '_blank', rel: 'noopener' } }),
            ]),
            createEl('div', { className: cls('actions') }, [
                createEl('button', { text: 'Save Changes', attrs: { type: 'button' }, onClick: save }),
                createEl('button', { text: 'Reset to Default', attrs: { type: 'button' }, onClick: reset }),
                createEl('button', { text: 'Close', attrs: { type: 'button' }, onClick: close }),
            ]),
            status,
        ]);

        const overlay = createEl('div', { id: SETTINGS, className: cls('root') }, [panel]);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close();
        });
        document.addEventListener('keydown', onKeydown);
        document.body.append(overlay);
        keyInput.focus();
    }

    /**
     * Clears cached API data and reloads it.
     * @returns {void}
     */
    function clearCacheCommand() {
        Cache.clearApiData();
        refreshEverything(true);
    }

    // =========================================================================
    // OBSERVERS
    // =========================================================================

    /**
     * Connects page navigation and screen size changes.
     * @returns {void}
     */
    function startWatchers() {
        window.addEventListener('hashchange', () => {
            syncOverview().catch((error) => log('Navigation update failed', error));
        });
        narrowQuery.addEventListener('change', renderOverview);
        tinyQuery.addEventListener('change', renderOverview);
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
            GM_registerMenuCommand('Clear cache', clearCacheCommand);
            startWatchers();
            syncOverview().catch((error) => console.error('[OC Helper] Overview failed.', error));
            syncSidebarNotice().catch((error) => console.error('[OC Helper] Sidebar failed.', error));

            if (!getApiKey() && !Storage.get(CONFIG.STORAGE_KEYS.SETTINGS_SHOWN, false)) {
                Storage.set(CONFIG.STORAGE_KEYS.SETTINGS_SHOWN, true);
                openSettings();
            }
        } catch (error) {
            console.error('[OC Helper] Failed to start.', error);
        }
    }

    init();
})();
