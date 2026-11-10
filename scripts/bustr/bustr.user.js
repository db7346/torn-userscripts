// ==UserScript==
// @name         BUSTR: Busting Reminder
// @namespace    torn-userscripts
// @version      2.1.1
// @description  Estimates how many busts you can do without getting jailed, and sorts the jail list by how hard each bust is.
// @author       Adobi & Ironhydedragon (rewrite by DadGum [3158823])
// @license      MIT
// @match        https://www.torn.com/jailview.php*
// @updateURL    https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/bustr/bustr.user.js
// @downloadURL  https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/bustr/bustr.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      api.torn.com
// @run-at       document-end
// ==/UserScript==

/*
 * PURPOSE
 *   Shows your current bust penalty, an estimated safe threshold, and how many
 *   busts you likely have left, above the jail list. Adds a hardness score to
 *   each player and sorts the list easiest first. Display only: it never clicks
 *   Bust or anything else for you.
 *
 * CREDITS AND LICENSE
 *   Based on BUSTR: Busting Reminder + PDA v1.0.11 by Adobi & Ironhydedragon, MIT License.
 *   The penalty and threshold math comes from that script.
 *
 * API KEY USAGE DISCLOSURE
 *   Data storage:        Key, settings, bust log times, and your bust attempts (penalty and target hardness),
 *                        locally in Tampermonkey storage.
 *   Data sharing:        None. Requests go only to api.torn.com.
 *   Purpose of use:      Estimating how many busts you can do before getting jailed.
 *   Key storage/sharing: Stored locally, sent only in the Authorization header to api.torn.com, never logged.
 *   Key access level:    Full Access. Torn only provides your log to Full Access keys.
 *
 * REQUESTS (jail page only, tagged comment=BUSTR)
 *   GET /v2/user/log?log=5360&from=<72 hours ago>  Every 60 seconds (configurable) while the page is visible; shared across tabs
 *   GET /v2/user/log?log=5360                      Your latest 100 busts, once every 24 hours, for the threshold estimate
 *   GET /v2/key/info                               Only when saving a key
 *   Usually 1-2 calls per minute while the jail page is open, and none elsewhere.
 *
 * CHANGELOG
 *   2.1.1  The threshold is estimated from your most recent 100 busts, like the original,
 *          so an old peak stops counting once it is that far back.
 *   2.1.0  Rows are shaded by your own past attempts: green if you have busted a harder target at
 *          a higher penalty, red if you were caught or failed on an easier one at a lower penalty.
 *   2.0.1  With two jail tabs open, a bust is no longer counted twice.
 *   2.0.0  Rewrite. Runs only on the jail page and uses API v2 with the key in a header.
 *          Reads every bust in the last 72 hours instead of only the newest 100 log entries.
 *          Fixed the threshold estimate ignoring your oldest streak, which could make it show 0,
 *          and an off-by-one error.
 *          Added a Settings panel, readable errors, a shared cache, and paused refreshes in hidden tabs.
 *          Removed PDA support.
 *   1.0.11 Original release by Adobi & Ironhydedragon.
 */

(() => {
    'use strict';

    // =========================================================================
    // CONFIG
    // =========================================================================

    const CONFIG = Object.freeze({
        DEBUG: false,
        API_BASE: 'https://api.torn.com/v2',
        API_COMMENT: 'BUSTR',
        BUST_LOG_ID: 5360,
        STORAGE_PREFIX: 'tms_bustr_',
        STORAGE_KEYS: Object.freeze({
            API_KEY: 'api_key',
            SETTINGS: 'settings',
            RECENT: 'recent_busts',
            HISTORY: 'bust_history',
            SETTINGS_SHOWN: 'settings_shown',
            ATTEMPTS: 'attempts',
        }),
        LEGACY_KEYS: Object.freeze({ API_KEY: 'bustrApiKey', STATE: 'globalBustrState' }),
        DEFAULT_SETTINGS: Object.freeze({
            redLimit: 0,
            greenLimit: 3,
            refreshSeconds: 60,
            customThreshold: 0,
            showHardness: true,
            showShading: true,
        }),
        MIN_REFRESH_SECONDS: 30,
        PENALTY: Object.freeze({
            POINTS_PER_BUST: 128,
            HALF_LIFE_HOURS: 7.2,
            WINDOW_HOURS: 72,
            STREAK_SECONDS: 3 * 24 * 60 * 60,
        }),
        LOG_PAGE_SIZE: 100,
        MAX_HISTORY_ENTRIES: 1000,
        THRESHOLD_BUSTS: 100,
        HISTORY_TTL_MS: 24 * 60 * 60 * 1000,
        BACKOFF_MS: 60 * 1000,
        CONFIRM_DELAY_MS: 5000,
        RATE_LIMIT: Object.freeze({ MAX_CALLS: 50, WINDOW_MS: 60 * 1000 }),
        REQUEST_TIMEOUT_MS: 20000,
        OBSERVER_DEBOUNCE_MS: 150,
        HARDNESS_HOUR_OFFSET: 3,
        SELECTORS: Object.freeze({
            LIST: 'ul.user-info-list-wrap',
            ROW: ':scope > li',
            INFO: '.info-wrap',
            TIME: '.time',
            LEVEL: '.level',
            REASON: '.reason',
            CONFIRM_BUST: '.confirm-bust',
        }),
        BUST_SUCCESS: /^\s*You busted\b/i,
        BUST_CAUGHT: /you were caught and put in jail yourself/i,
        BUST_FAILED: /\bfailed\b/i,
        ATTEMPTS_MAX: 2000,
        ATTEMPTS_MAX_AGE_S: 60 * 24 * 60 * 60,
        FORGET_CONFIRM_MS: 4000,
        IDS: Object.freeze({ BAR: 'tms-bustr-bar', SETTINGS: 'tms-bustr-settings' }),
        CLASSES: Object.freeze({
            SORTED: 'tms-bustr-sorted',
            HARDNESS: 'tms-bustr-hardness',
            GREEN: 'tms-bustr-green',
            ORANGE: 'tms-bustr-orange',
            RED: 'tms-bustr-red',
            ERROR: 'tms-bustr-error',
            LIKELY: 'tms-bustr-likely',
            RISKY: 'tms-bustr-risky',
            MIXED: 'tms-bustr-mixed',
        }),
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
            16: "This key's access level is too low. BUSTR needs a Full Access key, because Torn only shares your log with those.",
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

    /**
     * Writes a debug message when debugging is enabled. Never pass the API key.
     * @param {...*} args Values to log.
     * @returns {void}
     */
    function log(...args) {
        if (CONFIG.DEBUG) console.debug('[BUSTR]', ...args);
    }

    // =========================================================================
    // STORAGE
    // =========================================================================

    const K = CONFIG.STORAGE_KEYS;

    const Storage = {
        /**
         * Reads and deserializes a stored value.
         * @param {string} key Unprefixed key.
         * @param {*} fallback Value returned when missing or invalid.
         * @returns {*} Stored value or fallback.
         */
        get(key, fallback) {
            const raw = GM_getValue(CONFIG.STORAGE_PREFIX + key, null);
            if (raw === null) return fallback;
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
     * Reads settings, filling in defaults and correcting invalid values.
     * @returns {{redLimit: number, greenLimit: number, refreshSeconds: number, customThreshold: number, showHardness: boolean, showShading: boolean}} Settings.
     */
    function getSettings() {
        const saved = { ...CONFIG.DEFAULT_SETTINGS, ...Storage.get(K.SETTINGS, {}) };
        const number = (value, fallback, min) => (Number.isFinite(Number(value)) && Number(value) >= min ? Number(value) : fallback);
        const defaults = CONFIG.DEFAULT_SETTINGS;
        return {
            redLimit: number(saved.redLimit, defaults.redLimit, -1000),
            greenLimit: number(saved.greenLimit, defaults.greenLimit, -1000),
            refreshSeconds: Math.max(CONFIG.MIN_REFRESH_SECONDS, number(saved.refreshSeconds, defaults.refreshSeconds, 0)),
            customThreshold: number(saved.customThreshold, 0, 0),
            showHardness: saved.showHardness !== false,
            showShading: saved.showShading !== false,
        };
    }

    /**
     * Moves a key saved by version 1 out of the page's storage, then removes the old data.
     * @returns {void}
     */
    function migrateLegacyStorage() {
        try {
            const legacy = localStorage.getItem(CONFIG.LEGACY_KEYS.API_KEY);
            if (legacy && !getApiKey()) {
                const key = JSON.parse(legacy);
                if (typeof key === 'string' && key.length === 16) Storage.set(K.API_KEY, key);
            }
            localStorage.removeItem(CONFIG.LEGACY_KEYS.API_KEY);
            localStorage.removeItem(CONFIG.LEGACY_KEYS.STATE);
        } catch (error) {
            log('Legacy storage migration skipped', error);
        }
    }

    /**
     * Reads saved bust attempts.
     * @returns {Array<{t: number, p: number, h: number, ok: boolean}>} Attempts: time (s), penalty, hardness, success.
     */
    function getAttempts() {
        const saved = Storage.get(K.ATTEMPTS, []);
        return Array.isArray(saved) ? saved : [];
    }

    /**
     * Saves one bust attempt, dropping old and excess entries.
     * @param {{t: number, p: number, h: number, ok: boolean}} attempt Attempt.
     * @returns {void}
     */
    function addAttempt(attempt) {
        const cutoff = attempt.t - CONFIG.ATTEMPTS_MAX_AGE_S;
        const kept = getAttempts().filter((entry) => entry.t >= cutoff);
        kept.push(attempt);
        Storage.set(K.ATTEMPTS, kept.slice(-CONFIG.ATTEMPTS_MAX));
    }

    // =========================================================================
    // CACHE
    // =========================================================================

    const Cache = {
        /**
         * Reads a cached value when younger than the TTL.
         * @param {string} key Unprefixed key.
         * @param {number} ttlMs Maximum age.
         * @returns {*|undefined} Value, or undefined when missing or stale.
         */
        get(key, ttlMs) {
            const entry = Storage.get(key, null);
            return entry && Date.now() - entry.ts < ttlMs ? entry.value : undefined;
        },

        /**
         * Reads a cached value regardless of age.
         * @param {string} key Unprefixed key.
         * @returns {*|undefined} Value, or undefined.
         */
        peek(key) {
            return Storage.get(key, null)?.value;
        },

        /**
         * Stores a value with the current time.
         * @param {string} key Unprefixed key.
         * @param {*} value Value.
         * @returns {void}
         */
        set(key, value) {
            Storage.set(key, { ts: Date.now(), value });
        },

        /**
         * Removes cached bust data.
         * @returns {void}
         */
        clear() {
            Storage.remove(K.RECENT);
            Storage.remove(K.HISTORY);
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
         * @param {string} path Path such as "/user/log".
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
     * Loads bust log entries, newest first, following pages back in time.
     * @param {{from?: number, maxEntries: number}} options Earliest timestamp (seconds) and entry limit.
     * @returns {Promise<Array<{id: string, timestamp: number}>>} Bust entries.
     * @throws {ApiRequestError} When a request fails or the format is unexpected.
     */
    async function fetchBustLog({ from, maxEntries }) {
        const entries = new Map();
        let to;
        while (entries.size < maxEntries) {
            const params = { log: CONFIG.BUST_LOG_ID, limit: CONFIG.LOG_PAGE_SIZE };
            if (from) params.from = from;
            if (to) params.to = to;
            const data = await api.get('/user/log', params);
            if (!Array.isArray(data?.log)) throw new ApiRequestError('Unexpected log format.');

            const before = entries.size;
            data.log.forEach((entry) => {
                if (entry?.id && Number.isFinite(entry.timestamp)) entries.set(entry.id, { id: entry.id, timestamp: entry.timestamp });
            });
            if (data.log.length < CONFIG.LOG_PAGE_SIZE || entries.size === before) break;
            to = Math.min(...data.log.map((entry) => entry.timestamp));
        }
        return sortNewestFirst([...entries.values()]).slice(0, maxEntries);
    }

    // =========================================================================
    // DATA (no DOM access)
    // =========================================================================

    /**
     * Sorts log entries newest first.
     * @param {Array<{timestamp: number}>} entries Log entries.
     * @returns {Array<{timestamp: number}>} New sorted array.
     */
    function sortNewestFirst(entries) {
        return [...entries].sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Joins log entry lists, removing duplicates by log ID.
     * @param {...Array<{id: string, timestamp: number}>} lists Entry lists.
     * @returns {Array<{id: string, timestamp: number}>} Merged entries, newest first.
     */
    function mergeEntries(...lists) {
        const byId = new Map();
        lists.flat().forEach((entry) => byId.set(entry.id, entry));
        return sortNewestFirst([...byId.values()]);
    }

    /**
     * Penalty points one bust contributes after a number of hours.
     * @param {number} hours Hours since the bust.
     * @returns {number} Points.
     */
    function bustWeight(hours) {
        const { POINTS_PER_BUST, HALF_LIFE_HOURS } = CONFIG.PENALTY;
        return POINTS_PER_BUST / 2 ** (hours / HALF_LIFE_HOURS);
    }

    /**
     * Calculates the current penalty from busts in the last 72 hours.
     * @param {number[]} timestamps Bust times in seconds.
     * @param {number} nowSeconds Current time in seconds.
     * @returns {number} Penalty score, rounded down.
     */
    function calcPenaltyScore(timestamps, nowSeconds) {
        const score = timestamps.reduce((total, ts) => {
            const hours = (nowSeconds - ts) / 3600;
            return hours >= 0 && hours <= CONFIG.PENALTY.WINDOW_HOURS ? total + bustWeight(hours) : total;
        }, 0);
        return Math.floor(score);
    }

    /**
     * Finds the length of the longest run of busts within three days of the run's first bust.
     * @param {number[]} timestamps Bust times in seconds, newest first.
     * @returns {number} Number of busts in the longest run.
     */
    function longestStreak(timestamps) {
        if (!timestamps.length) return 0;
        let longest = 0;
        let current = 1;
        let runStart = timestamps[0];
        for (let i = 1; i < timestamps.length; i += 1) {
            if (runStart - timestamps[i] <= CONFIG.PENALTY.STREAK_SECONDS) {
                current += 1;
            } else {
                longest = Math.max(longest, current);
                current = 1;
                runStart = timestamps[i];
            }
        }
        return Math.max(longest, current);
    }

    /**
     * Estimates your safe threshold as the highest penalty reached during a run as long as your longest streak.
     * @param {number[]} timestamps Bust times in seconds, newest first.
     * @returns {number} Estimated threshold, rounded down.
     */
    function estimateThreshold(timestamps) {
        const streak = longestStreak(timestamps);
        let best = 0;
        for (let i = 0; i + streak <= timestamps.length; i += 1) {
            let score = 0;
            for (let j = 0; j < streak; j += 1) score += bustWeight((timestamps[i] - timestamps[i + j]) / 3600);
            best = Math.max(best, score);
        }
        return Math.floor(best);
    }

    /**
     * Calculates the displayed bust stats.
     * @param {number[]} recent Bust times in the last 72 hours, newest first.
     * @param {number[]} history All known bust times, newest first.
     * @param {number} nowSeconds Current time in seconds.
     * @param {number} customThreshold Manual threshold, or 0 to estimate.
     * @returns {{penalty: number, threshold: number, available: number}} Stats.
     */
    function calcStats(recent, history, nowSeconds, customThreshold) {
        const penalty = calcPenaltyScore(recent, nowSeconds);
        const threshold = customThreshold > 0 ? customThreshold : estimateThreshold(history);
        const available = Math.floor((threshold - penalty) / CONFIG.PENALTY.POINTS_PER_BUST);
        return { penalty, threshold, available };
    }

    /**
     * Picks the color for a number of available busts.
     * @param {number} available Busts left.
     * @param {{redLimit: number, greenLimit: number}} settings Color limits.
     * @returns {'red'|'orange'|'green'} Color.
     */
    function pickColor(available, settings) {
        if (available <= settings.redLimit) return 'red';
        if (available >= settings.greenLimit) return 'green';
        return 'orange';
    }

    /**
     * Converts jail time text such as "1d 4h 30m" to hours.
     * @param {string} text Time text.
     * @returns {number} Hours.
     */
    function parseJailHours(text) {
        const unit = (pattern) => Number(text.match(pattern)?.[1] ?? 0);
        return unit(/(\d+)\s*d/) * 24 + unit(/(\d+)\s*h/) + unit(/(\d+)\s*m(?!s)/) / 60;
    }

    /**
     * Scores how hard a bust is; lower is easier.
     * @param {number} level Player level.
     * @param {number} hours Remaining jail time in hours.
     * @returns {number} Hardness score.
     */
    function calcHardness(level, hours) {
        return Math.floor(level * (hours + CONFIG.HARDNESS_HOUR_OFFSET));
    }

    /**
     * Judges a target from your past attempts.
     * @param {number} hardness Target hardness.
     * @param {number} penalty Your current penalty.
     * @param {Array<{p: number, h: number, ok: boolean}>} attempts Past attempts.
     * @returns {'likely'|'risky'|'mixed'|null} Likely when you busted a harder target at a higher penalty,
     *     risky when you were caught or failed on an easier target at a lower penalty, mixed when both, null when neither.
     */
    function classifyTarget(hardness, penalty, attempts) {
        const likely = attempts.some((a) => a.ok && a.p >= penalty && a.h >= hardness);
        const risky = attempts.some((a) => !a.ok && a.p <= penalty && a.h <= hardness);
        if (likely && risky) return 'mixed';
        if (likely) return 'likely';
        return risky ? 'risky' : null;
    }

    /**
     * Works out a bust result from its confirmation text.
     * @param {string} text Confirmation text.
     * @returns {'success'|'caught'|'failed'|null} Result, or null when it is not a result.
     */
    function parseBustResult(text) {
        if (CONFIG.BUST_SUCCESS.test(text)) return 'success';
        if (CONFIG.BUST_CAUGHT.test(text)) return 'caught';
        if (CONFIG.BUST_FAILED.test(text)) return 'failed';
        return null;
    }

    // =========================================================================
    // UI
    // =========================================================================

    /**
     * Creates an element without parsing HTML.
     * @param {string} tag Tag name.
     * @param {{id?: string, className?: string, text?: string, attrs?: Object<string, string>, onClick?: EventListener}} [options={}] Options.
     * @param {Array<Node|string|null|false|undefined>} [children=[]] Children; empty values are skipped.
     * @returns {HTMLElement} Element.
     */
    function createEl(tag, options = {}, children = []) {
        const element = document.createElement(tag);
        if (options.id) element.id = options.id;
        if (options.className) element.className = options.className;
        if (options.text !== undefined) element.textContent = options.text;
        Object.entries(options.attrs ?? {}).forEach(([name, value]) => element.setAttribute(name, value));
        if (options.onClick) element.addEventListener('click', options.onClick);
        element.append(...children.filter((child) => child !== null && child !== false && child !== undefined));
        return element;
    }

    /**
     * Injects the script's styles.
     * @returns {void}
     */
    function injectStyles() {
        const { BAR, SETTINGS } = CONFIG.IDS;
        const { SORTED, HARDNESS, GREEN, ORANGE, RED, ERROR, LIKELY, RISKY, MIXED } = CONFIG.CLASSES;
        GM_addStyle(`
            #${BAR} { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 6px; padding: 7px 10px; border-radius: 5px; background: #2a2a2a; color: #ddd; font-size: 13px; border-left: 4px solid #777; }
            #${BAR}.${GREEN} { border-left-color: #85b200; }
            #${BAR}.${ORANGE} { border-left-color: #d08000; }
            #${BAR}.${RED} { border-left-color: #e64d1a; }
            #${BAR} .tms-bustr-left { font-weight: 700; font-size: 14px; }
            #${BAR}.${GREEN} .tms-bustr-left { color: #85b200; }
            #${BAR}.${ORANGE} .tms-bustr-left { color: #ffbf00; }
            #${BAR}.${RED} .tms-bustr-left { color: #ffa8a8; }
            #${BAR} .tms-bustr-detail { color: #aaa; }
            #${BAR} .tms-bustr-spacer { flex: 1; }
            #${BAR} button { padding: 2px 8px; border-radius: 4px; border: 1px solid #555; background: #333; color: #ddd; cursor: pointer; font-size: 11px; }
            #${BAR} .${ERROR} { color: #ff8a80; }
            .${SORTED} { display: flex !important; flex-direction: column; }
            li.${LIKELY} { background: rgba(133, 178, 0, 0.18) !important; }
            li.${RISKY} { background: rgba(230, 77, 26, 0.18) !important; }
            li.${MIXED} { background: rgba(208, 128, 0, 0.18) !important; }
            .${HARDNESS} { display: inline-block; min-width: 34px; margin-right: 6px; padding: 0 4px; border-radius: 3px; background: #444; color: #fff; font-size: 10px; font-weight: 700; text-align: center; }
            #${SETTINGS} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); }
            .tms-bustr-panel { box-sizing: border-box; width: 440px; max-width: 94vw; padding: 16px; border-radius: 6px; background: #1b1b1b; color: #e6e6e6; font-size: 13px; line-height: 1.4; }
            .tms-bustr-panel h2 { margin: 0 0 8px; font-size: 16px; }
            .tms-bustr-panel label { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin: 6px 0; }
            .tms-bustr-panel input[type="number"] { width: 70px; padding: 3px; }
            .tms-bustr-panel button { margin: 8px 6px 0 0; padding: 5px 10px; cursor: pointer; }
            .tms-bustr-key { box-sizing: border-box; width: 100%; margin: 8px 0; padding: 6px; -webkit-text-security: disc; }
        `);
    }

    /**
     * Finds or creates the stats bar above the jail list.
     * @param {Element} list Jail list.
     * @returns {HTMLElement} Bar.
     */
    function ensureBar(list) {
        let bar = document.getElementById(CONFIG.IDS.BAR);
        if (!bar) bar = createEl('div', { id: CONFIG.IDS.BAR, attrs: { role: 'status' } });
        if (bar.nextElementSibling !== list) list.before(bar);
        return bar;
    }

    /**
     * Fills the bar with stats or a message.
     * @param {{stats?: {penalty: number, threshold: number, available: number}, message?: string, error?: Error, sorted?: boolean, shading?: number}} view What to show.
     *     shading is the number of learned attempts, when shading is on.
     * @returns {void}
     */
    function renderBar(view) {
        const list = document.querySelector(CONFIG.SELECTORS.LIST);
        if (!list) return;
        const bar = ensureBar(list);
        const { GREEN, ORANGE, RED, ERROR } = CONFIG.CLASSES;
        bar.classList.remove(GREEN, ORANGE, RED);
        const children = [];

        if (view.stats) {
            const { penalty, threshold, available } = view.stats;
            bar.classList.add({ green: GREEN, orange: ORANGE, red: RED }[pickColor(available, getSettings())]);
            const label = available === 1 ? '1 bust left' : `${available} busts left`;
            children.push(
                createEl('span', { className: 'tms-bustr-left', text: label }),
                createEl('span', { className: 'tms-bustr-detail', text: `Penalty ${penalty} / ${threshold}` }),
            );
        }
        if (view.message) children.push(createEl('span', { className: 'tms-bustr-detail', text: view.message }));
        if (view.error) children.push(createEl('span', { className: ERROR, text: view.error.message || String(view.error) }));
        if (view.sorted) children.push(createEl('span', { className: 'tms-bustr-detail', text: 'Sorted by hardness, easiest first' }));
        if (view.shading !== undefined) {
            const count = view.shading;
            const text = count
                ? `Shading from ${count} attempt${count === 1 ? '' : 's'}: green likely, red risky, orange mixed`
                : 'Shading starts after your first busts';
            children.push(createEl('span', { className: 'tms-bustr-detail', text }));
        }
        children.push(
            createEl('span', { className: 'tms-bustr-spacer' }),
            createEl('button', { text: 'Settings', attrs: { type: 'button' }, onClick: openSettings }),
        );
        bar.replaceChildren(...children);
    }

    /**
     * Reads one player row's level and jail time.
     * @param {Element} row Player row.
     * @returns {{level: number, hours: number}|null} Values, or null when missing.
     */
    function readRow(row) {
        const { TIME, LEVEL } = CONFIG.SELECTORS;
        const timeText = row.querySelector(TIME)?.textContent ?? '';
        const levelMatch = (row.querySelector(LEVEL)?.textContent ?? '').match(/(\d+)\s*$/);
        if (!levelMatch || !/\d/.test(timeText)) return null;
        return { level: Number(levelMatch[1]), hours: parseJailHours(timeText.replace(/TIME\s*:/i, '')) };
    }

    /**
     * Reads a row's hardness.
     * @param {Element} row Player row.
     * @returns {number|null} Hardness, or null when the row cannot be read.
     */
    function rowHardness(row) {
        const values = readRow(row);
        return values ? calcHardness(values.level, values.hours) : null;
    }

    /**
     * Adds or removes one row's hardness badge and sort position.
     * @param {Element} row Player row.
     * @param {number|null} score Hardness, or null to remove.
     * @returns {boolean} True when the row was given a position.
     */
    function syncBadge(row, score) {
        const { INFO, REASON } = CONFIG.SELECTORS;
        const { HARDNESS } = CONFIG.CLASSES;
        const target = row.querySelector(`${INFO} ${REASON}`);
        let badge = target?.querySelector(`.${HARDNESS}`);
        if (score === null || !target) {
            badge?.remove();
            row.style.removeProperty('order');
            return false;
        }
        if (!badge) {
            badge = createEl('span', { className: HARDNESS, attrs: { title: 'Hardness: level × (hours left + 3). Lower is easier.' } });
            target.prepend(badge);
        }
        if (badge.textContent !== String(score)) badge.textContent = String(score);
        if (row.style.order !== String(score)) row.style.order = String(score);
        return true;
    }

    /**
     * Sets one row's tint.
     * @param {Element} row Player row.
     * @param {'likely'|'risky'|'mixed'|null} verdict Verdict, or null for no tint.
     * @returns {void}
     */
    function syncTint(row, verdict) {
        const { LIKELY, RISKY, MIXED } = CONFIG.CLASSES;
        const wanted = { likely: LIKELY, risky: RISKY, mixed: MIXED }[verdict];
        [LIKELY, RISKY, MIXED].forEach((name) => {
            if (row.classList.contains(name) !== (name === wanted)) row.classList.toggle(name, name === wanted);
        });
    }

    /**
     * Applies hardness badges, sorting, and tints to the jail list.
     * @param {{showHardness: boolean, penalty: (number|null), attempts: (Array|null)}} options What to show; attempts null turns tints off.
     * @returns {boolean} True when the list was sorted.
     */
    function syncRows({ showHardness, penalty, attempts }) {
        const { LIST, ROW } = CONFIG.SELECTORS;
        const list = document.querySelector(LIST);
        if (!list) return false;

        let sortedAny = false;
        list.querySelectorAll(ROW).forEach((row) => {
            const score = rowHardness(row);
            if (syncBadge(row, showHardness ? score : null)) sortedAny = true;
            const verdict = attempts && penalty !== null && score !== null ? classifyTarget(score, penalty, attempts) : null;
            syncTint(row, verdict);
        });
        list.classList.toggle(CONFIG.CLASSES.SORTED, sortedAny);
        return sortedAny;
    }

    /**
     * Saves the settings panel's values.
     * @param {Object<string, HTMLInputElement>} fields Settings inputs.
     * @returns {void}
     */
    function saveSettingsFromFields(fields) {
        Storage.set(K.SETTINGS, {
            redLimit: Number(fields.redLimit.value),
            greenLimit: Number(fields.greenLimit.value),
            refreshSeconds: Number(fields.refreshSeconds.value),
            customThreshold: Number(fields.customThreshold.value),
            showHardness: fields.showHardness.checked,
            showShading: fields.showShading.checked,
        });
    }

    /**
     * Tests and saves a key from the Settings panel.
     * @param {HTMLInputElement} input Key field.
     * @param {HTMLElement} status Status element.
     * @returns {Promise<void>} Resolves after the test.
     */
    async function saveKeyFromInput(input, status) {
        const key = input.value.trim();
        if (!key) return;
        status.textContent = 'Checking key...';
        try {
            const data = await api.get('/key/info', {}, key);
            const level = data?.info?.access?.type || 'unknown';
            Storage.set(K.API_KEY, key);
            input.value = '';
            input.placeholder = 'Key saved. Paste a new key to replace it.';
            Cache.clear();
            status.textContent = /full/i.test(level)
                ? `Key saved (${level}).`
                : `Key saved (${level}), but BUSTR needs a Full Access key to read your log.`;
        } catch (error) {
            status.textContent = `Key not saved. ${error.message || error}`;
            throw error;
        }
    }

    /**
     * Creates a labeled number field for the Settings panel.
     * @param {string} text Label.
     * @param {number} value Current value.
     * @param {number} min Lowest allowed value.
     * @returns {{label: HTMLElement, input: HTMLInputElement}} Label and field.
     */
    function numberField(text, value, min) {
        const input = createEl('input', { attrs: { type: 'number', step: '1', min: String(min) } });
        input.value = String(value);
        return { label: createEl('label', {}, [text, input]), input };
    }

    /**
     * Opens the Settings panel. The saved key is never placed in the page.
     * @returns {void}
     */
    function openSettings() {
        if (document.getElementById(CONFIG.IDS.SETTINGS)) return;
        const settings = getSettings();
        const keyInput = createEl('input', {
            className: 'tms-bustr-key',
            attrs: {
                type: 'text',
                autocomplete: 'off',
                autocapitalize: 'off',
                spellcheck: 'false',
                'data-lpignore': 'true',
                'data-1p-ignore': 'true',
                'aria-label': 'Torn API key',
                placeholder: getApiKey() ? 'Key saved. Paste a new key to replace it.' : 'Full Access API key',
            },
        });
        const red = numberField('Red at this many busts left or fewer', settings.redLimit, -1000);
        const green = numberField('Green at this many busts left or more', settings.greenLimit, -1000);
        const refresh = numberField(`Refresh every (seconds, minimum ${CONFIG.MIN_REFRESH_SECONDS})`, settings.refreshSeconds, CONFIG.MIN_REFRESH_SECONDS);
        const custom = numberField('Manual threshold (0 = estimate it)', settings.customThreshold, 0);
        const hardness = createEl('input', { attrs: { type: 'checkbox' } });
        hardness.checked = settings.showHardness;
        const shading = createEl('input', { attrs: { type: 'checkbox' } });
        shading.checked = settings.showShading;
        const status = createEl('div', { attrs: { role: 'status' } });
        const fields = { redLimit: red.input, greenLimit: green.input, refreshSeconds: refresh.input, customThreshold: custom.input, showHardness: hardness, showShading: shading };
        let forgetArmedUntil = 0;
        const forget = createEl('button', {
            text: `Forget learned attempts (${getAttempts().length})`,
            attrs: { type: 'button' },
            onClick: () => {
                if (Date.now() > forgetArmedUntil) {
                    forgetArmedUntil = Date.now() + CONFIG.FORGET_CONFIRM_MS;
                    status.textContent = 'Click Forget again within a few seconds to delete your learned attempts.';
                    return;
                }
                Storage.remove(K.ATTEMPTS);
                forget.textContent = 'Forget learned attempts (0)';
                status.textContent = 'Learned attempts deleted.';
                Controller.render();
            },
        });

        const close = () => overlay.remove();
        const save = async () => {
            saveSettingsFromFields(fields);
            try {
                if (keyInput.value.trim()) await saveKeyFromInput(keyInput, status);
                else status.textContent = 'Settings saved.';
            } catch {
                return;
            }
            Controller.restart(true);
        };

        const overlay = createEl('div', { id: CONFIG.IDS.SETTINGS }, [
            createEl('div', { className: 'tms-bustr-panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'BUSTR settings' } }, [
                createEl('h2', { text: 'BUSTR' }),
                createEl('div', { text: 'Needs a Full Access key, because Torn only shares your log with those. The key is stored only in Tampermonkey and sent only to api.torn.com.' }),
                keyInput,
                red.label,
                green.label,
                refresh.label,
                custom.label,
                createEl('label', {}, ['Show hardness and sort the list', hardness]),
                createEl('label', {}, ['Shade rows by your past attempts', shading]),
                createEl('button', { text: 'Save', attrs: { type: 'button' }, onClick: save }),
                createEl('button', {
                    text: 'Remove key',
                    attrs: { type: 'button' },
                    onClick: () => {
                        Storage.remove(K.API_KEY);
                        Cache.clear();
                        keyInput.placeholder = 'Full Access API key';
                        status.textContent = 'API key removed.';
                        Controller.restart(true);
                    },
                }),
                forget,
                createEl('button', { text: 'Close', attrs: { type: 'button' }, onClick: close }),
                status,
            ]),
        ]);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close();
        });
        document.body.append(overlay);
        keyInput.focus();
    }

    // =========================================================================
    // CONTROLLER
    // =========================================================================

    const Controller = {
        timer: 0,
        backoffUntil: 0,
        loading: null,
        /** @type {number[]} Times (ms) of busts seen on the page but not yet confirmed by a log fetch. */
        pendingBusts: [],
        lastFetchAt: 0,
        stats: null,
        error: null,

        /**
         * Loads the last 72 hours of busts, from the shared cache when fresh.
         * @param {boolean} force Skip the cache.
         * @returns {Promise<Array<{id: string, timestamp: number}>>} Recent busts.
         * @throws {ApiRequestError} When loading fails.
         */
        async loadRecent(force) {
            const ttl = getSettings().refreshSeconds * 1000 - 1000;
            const cached = force ? undefined : Cache.get(K.RECENT, ttl);
            if (Array.isArray(cached?.entries)) {
                // Another tab may have fetched after a bust in this tab.
                this.lastFetchAt = Math.max(this.lastFetchAt, cached.startedAt || 0);
                return cached.entries;
            }
            const startedAt = Date.now();
            const from = Math.floor(startedAt / 1000) - CONFIG.PENALTY.WINDOW_HOURS * 3600;
            const entries = await fetchBustLog({ from, maxEntries: CONFIG.MAX_HISTORY_ENTRIES });
            this.lastFetchAt = Math.max(this.lastFetchAt, startedAt);
            Cache.set(K.RECENT, { startedAt, entries });
            return entries;
        },

        /**
         * Loads long bust history for the threshold estimate, once a day.
         * @returns {Promise<Array<{id: string, timestamp: number}>>} Past busts.
         * @throws {ApiRequestError} When loading fails and nothing is saved.
         */
        async loadHistory() {
            if (getSettings().customThreshold > 0) return [];
            const cached = Cache.get(K.HISTORY, CONFIG.HISTORY_TTL_MS);
            if (cached) return cached;
            try {
                const history = await fetchBustLog({ maxEntries: CONFIG.THRESHOLD_BUSTS });
                Cache.set(K.HISTORY, history);
                return history;
            } catch (error) {
                const saved = Cache.peek(K.HISTORY);
                if (saved) return saved;
                throw error;
            }
        },

        /**
         * Refreshes stats and redraws the bar.
         * @param {boolean} [force=false] Skip the recent-bust cache.
         * @returns {Promise<void>} Resolves when finished.
         */
        async refresh(force = false) {
            if (!getApiKey()) {
                this.stats = null;
                renderBar({ message: 'Add your Full Access API key in Settings to see how many busts you have left.', sorted: this.sorted() });
                return;
            }
            if (Date.now() < this.backoffUntil) return;
            if (this.loading) return this.loading;

            this.loading = (async () => {
                try {
                    const [recent, history] = await Promise.all([this.loadRecent(force), this.loadHistory()]);
                    // A log fetch that started after a bust already includes it.
                    this.pendingBusts = this.pendingBusts.filter((ms) => ms > this.lastFetchAt);
                    const recentTimes = [
                        ...recent.map((entry) => entry.timestamp),
                        ...this.pendingBusts.map((ms) => Math.floor(ms / 1000)),
                    ].sort((a, b) => b - a);
                    // The threshold only looks at your most recent busts, so old peaks age out.
                    const historyTimes = mergeEntries(history, recent).slice(0, CONFIG.THRESHOLD_BUSTS).map((entry) => entry.timestamp);
                    this.stats = calcStats(recentTimes, historyTimes, Math.floor(Date.now() / 1000), getSettings().customThreshold);
                    this.error = null;
                } catch (error) {
                    this.error = error;
                    if (error.code === 5) this.backoffUntil = Date.now() + CONFIG.BACKOFF_MS;
                } finally {
                    this.loading = null;
                    this.render();
                }
            })();
            return this.loading;
        },

        /**
         * Redraws the bar from the current state.
         * @returns {void}
         */
        render() {
            const shading = getSettings().showShading && this.stats ? getAttempts().length : undefined;
            renderBar({ stats: this.stats ?? undefined, error: this.error ?? undefined, sorted: this.sorted(), shading });
        },

        /**
         * Applies hardness badges, sorting, and tints to the current list.
         * @returns {boolean} True when sorted.
         */
        sorted() {
            const settings = getSettings();
            return syncRows({
                showHardness: settings.showHardness,
                penalty: this.stats?.penalty ?? null,
                attempts: settings.showShading ? getAttempts() : null,
            });
        },

        /**
         * Saves a bust attempt seen on the page, using the penalty from just before it.
         * @param {Element} confirm The row's confirmation element.
         * @param {boolean} ok True for a successful bust.
         * @returns {void}
         */
        recordAttempt(confirm, ok) {
            const row = confirm.closest('li');
            const hardness = row ? rowHardness(row) : null;
            if (!this.stats || hardness === null) return;
            addAttempt({ t: Math.floor(Date.now() / 1000), p: this.stats.penalty, h: hardness, ok });
        },

        /**
         * Records a bust seen on the page, shows it at once, and confirms from the log shortly after.
         * @returns {void}
         */
        recordBust() {
            if (!this.stats) return;
            this.pendingBusts.push(Date.now());
            const { POINTS_PER_BUST } = CONFIG.PENALTY;
            const penalty = this.stats.penalty + POINTS_PER_BUST;
            this.stats = { ...this.stats, penalty, available: Math.floor((this.stats.threshold - penalty) / POINTS_PER_BUST) };
            this.render();
            setTimeout(() => this.refresh(true), CONFIG.CONFIRM_DELAY_MS);
        },

        /**
         * Starts or restarts the refresh timer and redraws.
         * @param {boolean} [force=false] Skip the shared cache, for example after settings change.
         * @returns {void}
         */
        restart(force = false) {
            clearInterval(this.timer);
            this.backoffUntil = 0;
            this.refresh(force);
            this.timer = setInterval(() => {
                if (!document.hidden) this.refresh();
            }, getSettings().refreshSeconds * 1000);
        },
    };

    // =========================================================================
    // OBSERVERS
    // =========================================================================

    /** @type {WeakMap<Element, string>} The last result counted for each confirmation element. */
    const countedConfirmations = new WeakMap();
    let pageTimer = 0;

    /**
     * Checks whether a node belongs to this script.
     * @param {Node} node Node.
     * @returns {boolean} True for the script's own elements.
     */
    function isOwnNode(node) {
        const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        return Boolean(element?.closest(`#${CONFIG.IDS.BAR}, .${CONFIG.CLASSES.HARDNESS}`));
    }

    /**
     * Counts each newly shown bust result once: successes update the count, and every result is learned.
     * @param {MutationRecord[]} mutations Page changes.
     * @returns {void}
     */
    function detectBusts(mutations) {
        const confirms = new Set();
        mutations.forEach((mutation) => {
            const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
            const confirm = target?.closest(CONFIG.SELECTORS.CONFIRM_BUST);
            if (confirm) confirms.add(confirm);
        });
        confirms.forEach((confirm) => {
            const text = (confirm.textContent || '').trim();
            const result = parseBustResult(text);
            if (!result) {
                countedConfirmations.delete(confirm);
                return;
            }
            if (countedConfirmations.get(confirm) === text) return;
            countedConfirmations.set(confirm, text);
            Controller.recordAttempt(confirm, result === 'success');
            if (result === 'success') Controller.recordBust();
        });
    }

    /**
     * Checks whether a page change can affect the jail list.
     * @param {MutationRecord} mutation Page change.
     * @returns {boolean} True when the list should be updated.
     */
    function isListMutation(mutation) {
        if (isOwnNode(mutation.target)) return false;
        const changed = [...mutation.addedNodes, ...mutation.removedNodes];
        if (changed.length && changed.every(isOwnNode)) return false;
        const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
        const { LIST } = CONFIG.SELECTORS;
        return Boolean(target?.closest(LIST))
            || [...mutation.addedNodes].some((node) => node.nodeType === Node.ELEMENT_NODE && (node.matches(LIST) || node.querySelector(LIST)));
    }

    const pageObserver = new MutationObserver((mutations) => {
        const relevant = mutations.filter(isListMutation);
        if (!relevant.length) return;
        detectBusts(relevant);
        clearTimeout(pageTimer);
        pageTimer = setTimeout(() => Controller.render(), CONFIG.OBSERVER_DEBOUNCE_MS);
    });

    // =========================================================================
    // INIT
    // =========================================================================

    /**
     * Starts the script on the jail page.
     * @returns {void}
     */
    function init() {
        try {
            migrateLegacyStorage();
            injectStyles();
            GM_registerMenuCommand('Settings', openSettings);
            GM_registerMenuCommand('Clear cache', () => {
                Cache.clear();
                Controller.refresh(true);
            });

            pageObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) Controller.refresh();
            });
            window.addEventListener('pagehide', () => {
                pageObserver.disconnect();
                clearInterval(Controller.timer);
            }, { once: true });

            Controller.restart();
            if (!getApiKey() && !Storage.get(K.SETTINGS_SHOWN, false)) {
                Storage.set(K.SETTINGS_SHOWN, true);
                openSettings();
            }
        } catch (error) {
            console.error('[BUSTR] Failed to start.', error);
        }
    }

    init();
})();
