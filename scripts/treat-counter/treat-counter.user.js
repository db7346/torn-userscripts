// ==UserScript==
// @name         Torn Treat Counter
// @namespace    dadgum.torn.treats
// @version      1.0.1
// @description  Live Halloween treat counter in the Torn sidebar (current treats + total collected), powered by the Torn API v2.
// @author       DadGum (rewrite) — based on "Treat counter" by m0tch, Grizh, Silmaril (MIT)
// @license      MIT
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @connect      api.torn.com
// @run-at       document-idle
// @homepageURL  https://github.com/db7346/torn-userscripts/tree/main/scripts/treat-counter
// @supportURL   https://github.com/db7346/torn-userscripts/issues
// @updateURL    https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/treat-counter/treat-counter.user.js
// @downloadURL  https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/treat-counter/treat-counter.user.js
// ==/UserScript==

/*
 * =============================================================================
 *  TORN TREAT COUNTER
 * =============================================================================
 *  Shows "Treats: <current> · <collected>/<goal>" in the sidebar points block
 *  during the Halloween event, and keeps it up to date without opening the
 *  basket.
 *
 *  Data sources
 *   - API  GET /user/halloween   (Minimal key) -> treats.current, treats.total
 *   - API  GET /torn/halloween   (Minimal key) -> basket upgrade requirements,
 *                                                 used only as a goal fallback
 *   - Page: basket view on item.php (free, instant read when you open it)
 *   - Page: attack-result treat dialog (triggers an immediate API refresh)
 *
 *  API KEY USAGE DISCLOSURE (per Torn API ToS)
 *   - Data storage:    Only locally in your browser (Tampermonkey storage).
 *   - Data sharing:    None. Nothing is sent anywhere except api.torn.com.
 *   - Purpose of use:  Displaying your own Halloween treat counts.
 *   - Key storage:     Stored locally in Tampermonkey storage; never logged,
 *                      never placed in a URL, sent only in the Authorization
 *                      header to api.torn.com.
 *   - Key access level: Minimal Access (Public Only is not enough).
 *
 *  API budget: ~1 call/min while a Torn tab is visible (shared across all open
 *  tabs), plus at most 1 extra call per 15 s after an attack treat dialog, plus
 *  1 call/day for /torn/halloween.
 *
 *  Changelog
 *   1.0.1  Added GitHub update/download URLs for Tampermonkey auto-updates.
 *   1.0.0  Clean rewrite: API polling, cross-tab shared state, settings panel,
 *          collected/goal display, full API error handling.
 * =============================================================================
 */

(function () {
    'use strict';

    // =========================================================================
    //  CONFIG — every tunable value lives here
    // =========================================================================
    const CONFIG = Object.freeze({
        SCRIPT_NAME: 'TreatCounter',
        STORAGE_PREFIX: 'tms-treats:',
        DEBUG: false,

        API_BASE: 'https://api.torn.com/v2',
        API_TIMEOUT_MS: 15000,
        RATE_LIMIT_PER_MIN: 50,            // hard cap for this script
        BACKOFF_ON_LIMIT_MS: 2 * 60 * 1000, // after error code 5

        POLL_INTERVAL_MS: 60 * 1000,
        FRESHNESS_SLACK_MS: 5 * 1000,      // skip a poll if another tab fetched this recently
        FORCED_REFRESH_MIN_GAP_MS: 15 * 1000,
        FORCED_REFRESH_DELAY_MS: 1500,     // give the server a moment to credit the treats
        TORN_HALLOWEEN_TTL_MS: 24 * 60 * 60 * 1000,

        // Event window (UTC). Month is 0-based for Date.UTC.
        EVENT_START: { month: 9, day: 25, hour: 12 }, // Oct 25 12:00 UTC
        EVENT_END: { month: 10, day: 1, hour: 12 },   // Nov 1 12:00 UTC

        OBSERVER_DEBOUNCE_MS: 300,
        NOTICE_DURATION_MS: 6000,

        SELECTORS: Object.freeze({
            SIDEBAR_ROOT: '#sidebarroot',
            POINTS_BLOCK: "div[class^='points']",           // hashed: points___xxxx
            POINT_ROW: "p[class*='point-block___']",        // used only to copy native styling
            POINT_LABEL: "span[class*='name___']",          // used only to copy native styling
            ITEM_CATEGORY_WRAP: '#category-wrap',
            BASKET_AVAILABLE: '.available-treats',
            ATTACK_TREAT_DIALOG: '.dialog-title__halloween',
        }),

        PAGE_MATCH: Object.freeze({
            ITEMS: /\/item\.php/,
            ATTACK: /page\.php\?sid=attack/,
        }),

        // Text patterns read from the basket view
        PATTERNS: Object.freeze({
            AVAILABLE: /([\d,]+)\s*Treats?\b/i,                       // "124 Treats"
            COLLECTED: /([\d,]+)\s*\/\s*([\d,]+)\s*Treats?\s+Collected/i, // "1573 / 2500 Treats Collected"
        }),

        CSS_PREFIX: 'tms-treats',
    });

    const IDS = Object.freeze({
        COUNTER: `${CONFIG.CSS_PREFIX}-counter`,
        TOOLTIP: `${CONFIG.CSS_PREFIX}-tooltip`,
        MODAL: `${CONFIG.CSS_PREFIX}-modal`,
        NOTICE: `${CONFIG.CSS_PREFIX}-notice`,
    });

    const KEYS = Object.freeze({
        API_KEY: 'apiKey',
        STATE: 'state',
        LAST_FETCH: 'lastFetchAt',
        PAUSED_UNTIL: 'pausedUntil',
        BLOCKING_ERROR: 'blockingError',
        TORN_HALLOWEEN: 'cache:tornHalloween',
    });

    // =========================================================================
    //  Types (shapes taken from TornAPI3.1.0.txt)
    // =========================================================================
    /**
     * @typedef {Object} UserHalloweenResponse  GET /user/halloween
     * @property {{treats: {total: number, current: number},
     *             basket_upgrades: Array<{id: number, timestamp: number}>}} halloween
     */
    /**
     * @typedef {Object} TornHalloweenResponse  GET /torn/halloween
     * @property {{basket_upgrades: Array<{id: number, name: string, description: string,
     *             flavor: string, cost: number, requirement: number}>}} halloween
     */
    /**
     * @typedef {Object} KeyInfoResponse  GET /key/info (only fields we use)
     * @property {{access: {level: number, type: string}}} info
     */
    /**
     * @typedef {Object} TreatState  What we persist and render
     * @property {number|null} current    Spendable treats
     * @property {number|null} total      Cumulative treats collected
     * @property {number|null} goal       Next collected target (e.g. 2500)
     * @property {'basket'|'upgrades'|null} goalSource  Where the goal came from
     * @property {number} updatedAt       Epoch ms of the last successful read
     * @property {'api'|'page'} source    Where current/total last came from
     */

    // =========================================================================
    //  Utilities
    // =========================================================================

    /**
     * Debug logger, silent unless CONFIG.DEBUG is true. Never pass the API key.
     * @param {...*} args Values to log.
     * @returns {void}
     */
    function log(...args) {
        if (CONFIG.DEBUG) console.log(`[${CONFIG.SCRIPT_NAME}]`, ...args);
    }

    /**
     * Returns a throttled version of fn: runs at most once per waitMs, always
     * including a trailing call. Used instead of debounce because Torn pages have
     * ticking timers, so mutations never go quiet and a debounce might never fire.
     * @param {Function} fn Function to throttle.
     * @param {number} waitMs Minimum gap in ms.
     * @returns {Function} Throttled function.
     */
    function throttle(fn, waitMs) {
        let last = 0;
        let timer = null;
        return (...args) => {
            const wait = waitMs - (Date.now() - last);
            clearTimeout(timer);
            if (wait <= 0) {
                last = Date.now();
                fn(...args);
            } else {
                timer = setTimeout(() => {
                    last = Date.now();
                    fn(...args);
                }, wait);
            }
        };
    }

    /**
     * Resolves after the given delay.
     * @param {number} ms Delay in ms.
     * @returns {Promise<void>}
     */
    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Parses "1,573" -> 1573. Returns null for anything non-numeric.
     * @param {string|undefined} text Raw number text.
     * @returns {number|null}
     */
    function parseCount(text) {
        if (!text) return null;
        const n = Number(String(text).replace(/,/g, ''));
        return Number.isFinite(n) ? n : null;
    }

    /**
     * Formats a number with thousands separators.
     * @param {number|null} n Number to format.
     * @returns {string}
     */
    function fmt(n) {
        return n == null ? '—' : n.toLocaleString('en-US');
    }

    /**
     * Human-friendly "x ago" for a timestamp.
     * @param {number} ts Epoch ms.
     * @returns {string}
     */
    function timeAgo(ts) {
        if (!ts) return 'never';
        const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
        if (s < 60) return `${s}s ago`;
        const m = Math.round(s / 60);
        return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
    }

    /**
     * Waits for a selector to appear in the document.
     * @param {string} selector CSS selector.
     * @param {number} [timeoutMs=30000] Give up after this long.
     * @returns {Promise<Element|null>} The element, or null on timeout.
     */
    function waitForElement(selector, timeoutMs = 30000) {
        const existing = document.querySelector(selector);
        if (existing) return Promise.resolve(existing);
        return new Promise((resolve) => {
            const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) {
                    observer.disconnect();
                    clearTimeout(timer);
                    resolve(el);
                }
            });
            const timer = setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeoutMs);
            observer.observe(document.documentElement, { childList: true, subtree: true });
        });
    }

    /**
     * True if "now" is inside this year's event window (UTC).
     * @param {Date} [now=new Date()] Reference time.
     * @returns {boolean}
     */
    function isEventActive(now = new Date()) {
        const y = now.getUTCFullYear();
        const { EVENT_START: s, EVENT_END: e } = CONFIG;
        const start = Date.UTC(y, s.month, s.day, s.hour);
        const end = Date.UTC(y, e.month, e.day, e.hour);
        return now.getTime() >= start && now.getTime() < end;
    }

    // =========================================================================
    //  Storage — namespaced GM storage with JSON (de)serialization
    // =========================================================================
    const Storage = {
        /**
         * Reads a value.
         * @param {string} key Unprefixed key.
         * @param {*} [fallback=null] Returned when missing or unparsable.
         * @returns {*}
         */
        get(key, fallback = null) {
            const raw = GM_getValue(CONFIG.STORAGE_PREFIX + key, null);
            if (raw == null) return fallback;
            try {
                return JSON.parse(raw);
            } catch {
                return fallback;
            }
        },

        /**
         * Writes a value (JSON-serialized).
         * @param {string} key Unprefixed key.
         * @param {*} value Serializable value.
         * @returns {void}
         */
        set(key, value) {
            GM_setValue(CONFIG.STORAGE_PREFIX + key, JSON.stringify(value));
        },

        /**
         * Deletes a value.
         * @param {string} key Unprefixed key.
         * @returns {void}
         */
        remove(key) {
            GM_deleteValue(CONFIG.STORAGE_PREFIX + key);
        },

        /**
         * Subscribes to changes made by any tab (including this one).
         * @param {string} key Unprefixed key.
         * @param {(value: *) => void} callback Receives the parsed new value.
         * @returns {void}
         */
        onChange(key, callback) {
            GM_addValueChangeListener(CONFIG.STORAGE_PREFIX + key, (_name, _old, raw) => {
                try {
                    callback(raw == null ? null : JSON.parse(raw));
                } catch {
                    callback(null);
                }
            });
        },
    };

    // =========================================================================
    //  Cache — TTL wrapper over Storage
    // =========================================================================
    const Cache = {
        /**
         * Returns cached data if still fresh.
         * @param {string} key Unprefixed key.
         * @param {number} ttlMs Max age in ms.
         * @returns {*|null}
         */
        get(key, ttlMs) {
            const entry = Storage.get(key);
            if (!entry || Date.now() - entry.savedAt > ttlMs) return null;
            return entry.data;
        },

        /**
         * Stores data with the current timestamp.
         * @param {string} key Unprefixed key.
         * @param {*} data Serializable data.
         * @returns {void}
         */
        set(key, data) {
            Storage.set(key, { savedAt: Date.now(), data });
        },

        /**
         * Removes every cache entry this script owns (keeps key + state).
         * @returns {void}
         */
        clearAll() {
            Storage.remove(KEYS.TORN_HALLOWEEN);
            Storage.remove(KEYS.LAST_FETCH);
            Storage.remove(KEYS.PAUSED_UNTIL);
            Storage.remove(KEYS.BLOCKING_ERROR);
        },
    };

    // =========================================================================
    //  API — client, rate limiter, error mapping
    // =========================================================================

    /** Readable messages for every ApiError code in TornAPI3.1.0.txt. */
    const API_ERROR_MESSAGES = Object.freeze({
        0: 'Unknown API error.',
        1: 'No API key set.',
        2: 'Incorrect API key.',
        3: 'Wrong request type.',
        4: 'Wrong fields requested.',
        5: 'Too many API requests — pausing for a couple of minutes.',
        6: 'Incorrect ID.',
        7: 'Incorrect ID–entity relation.',
        8: 'Your IP is temporarily blocked by the API.',
        9: 'The Torn API is disabled right now.',
        10: 'Key owner is in federal jail.',
        11: 'Key change cooldown — try again shortly.',
        12: 'Key read error — try again shortly.',
        13: 'Key is temporarily disabled.',
        14: 'Daily read limit reached.',
        15: 'Log unavailable.',
        16: 'Key access level too low — Minimal Access or higher is required.',
        17: 'Torn backend error — will retry.',
        18: 'This API key is paused.',
        19: 'Must migrate to Crimes 2.0.',
        20: 'Race not finished.',
        21: 'Incorrect category.',
        22: 'Only available in API v1.',
        23: 'Only available in API v2.',
        24: 'Endpoint temporarily closed.',
        25: 'Invalid stat requested.',
        26: 'Only category or stats allowed.',
        27: 'Must migrate to Organized Crimes 2.0.',
        28: 'Incorrect log ID.',
        29: 'Category selection unavailable for interaction logs.',
        30: 'File does not exist.',
        31: 'City stats cron failed.',
        32: 'Endpoint closed until the attacking period.',
        33: 'No competition is running right now.',
    });

    /** Codes that will not fix themselves: stop polling until the key changes. */
    const BLOCKING_CODES = new Set([1, 2, 10, 13, 16, 18]);

    /** Error thrown for any failed API call. */
    class ApiError extends Error {
        /**
         * @param {number} code Torn API error code, or -1 for network/parse errors.
         * @param {string} message Readable message.
         */
        constructor(code, message) {
            super(message);
            this.name = 'ApiError';
            this.code = code;
        }
    }

    /** Sliding 60-second window limiter shared by every request in this tab. */
    const RateLimiter = {
        /** @type {number[]} */
        stamps: [],

        /**
         * Resolves when a request slot is free, then claims it.
         * @returns {Promise<void>}
         */
        async acquire() {
            for (;;) {
                const now = Date.now();
                this.stamps = this.stamps.filter((t) => now - t < 60000);
                if (this.stamps.length < CONFIG.RATE_LIMIT_PER_MIN) {
                    this.stamps.push(now);
                    return;
                }
                await sleep(60000 - (now - this.stamps[0]) + 50);
            }
        },
    };

    const Api = {
        /**
         * GET an API v2 path. Key goes in the Authorization header only.
         * @param {string} path e.g. '/user/halloween'
         * @param {Object<string, string|number>} [params={}] Extra query params.
         * @param {string} [keyOverride] Use this key instead of the stored one (for validation).
         * @returns {Promise<Object>} Parsed JSON body.
         * @throws {ApiError} On missing key, network failure, bad JSON, or API error body.
         */
        async get(path, params = {}, keyOverride) {
            const key = keyOverride ?? Storage.get(KEYS.API_KEY);
            if (!key) throw new ApiError(1, API_ERROR_MESSAGES[1]);

            await RateLimiter.acquire();

            const query = new URLSearchParams({ ...params, comment: CONFIG.SCRIPT_NAME });
            const url = `${CONFIG.API_BASE}${path}?${query}`;
            log('GET', path);

            const body = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    headers: { Authorization: `ApiKey ${key}` },
                    timeout: CONFIG.API_TIMEOUT_MS,
                    onload: (res) => {
                        try {
                            resolve(JSON.parse(res.responseText));
                        } catch {
                            reject(new ApiError(-1, `Unreadable API response (HTTP ${res.status}).`));
                        }
                    },
                    onerror: () => reject(new ApiError(-1, 'Network error reaching api.torn.com.')),
                    ontimeout: () => reject(new ApiError(-1, 'API request timed out.')),
                });
            });

            if (body?.error) {
                const code = Number(body.error.code);
                throw new ApiError(code, API_ERROR_MESSAGES[code] ?? body.error.error ?? 'API error.');
            }
            return body;
        },
    };

    // =========================================================================
    //  Data — pure functions (no DOM)
    // =========================================================================
    const Data = {
        /**
         * Validates and extracts treat counts from /user/halloween.
         * The endpoint is marked unstable in the spec, so check the shape.
         * @param {UserHalloweenResponse} body API body.
         * @returns {{current: number, total: number}}
         * @throws {ApiError} If the shape is not what the spec describes.
         */
        parseUserHalloween(body) {
            const treats = body?.halloween?.treats;
            if (!Number.isFinite(treats?.current) || !Number.isFinite(treats?.total)) {
                throw new ApiError(-1, 'Unexpected /user/halloween response — the API may have changed.');
            }
            return { current: treats.current, total: treats.total };
        },

        /**
         * Fallback goal: the smallest upgrade requirement above the total collected.
         * ASSUMPTION (verify in game): `requirement` is a collected-treats threshold.
         * @param {TornHalloweenResponse|null} body Cached /torn/halloween body.
         * @param {number} total Treats collected.
         * @returns {number|null}
         */
        nextRequirement(body, total) {
            const reqs = (body?.halloween?.basket_upgrades ?? [])
                .map((u) => u.requirement)
                .filter((r) => Number.isFinite(r) && r > total)
                .sort((a, b) => a - b);
            return reqs[0] ?? null;
        },

        /**
         * Parses basket text into counts.
         * @param {string} text innerText of the basket area.
         * @returns {{current: number|null, total: number|null, goal: number|null}}
         */
        parseBasketText(text) {
            const collected = CONFIG.PATTERNS.COLLECTED.exec(text);
            // Remove the "x / y Treats Collected" part so AVAILABLE can't match it.
            const rest = collected ? text.replace(collected[0], ' ') : text;
            const available = CONFIG.PATTERNS.AVAILABLE.exec(rest);
            return {
                current: parseCount(available?.[1]),
                total: parseCount(collected?.[1]),
                goal: parseCount(collected?.[2]),
            };
        },

        /**
         * Merges new values into a state object, ignoring nulls.
         * @param {TreatState|null} prev Previous state.
         * @param {Partial<TreatState>} next New values.
         * @returns {TreatState}
         */
        merge(prev, next) {
            const out = { current: null, total: null, goal: null, goalSource: null, updatedAt: 0, source: 'api', ...prev };
            for (const [k, v] of Object.entries(next)) if (v != null) out[k] = v;
            return out;
        },
    };

    // =========================================================================
    //  State — single source of truth, shared across tabs via GM storage
    // =========================================================================
    const State = {
        /** @returns {TreatState|null} */
        read() {
            return Storage.get(KEYS.STATE);
        },

        /**
         * Merges and persists; other tabs re-render through the change listener.
         * @param {Partial<TreatState>} partial New values.
         * @returns {TreatState}
         */
        update(partial) {
            const next = Data.merge(State.read(), { ...partial, updatedAt: Date.now() });
            Storage.set(KEYS.STATE, next);
            return next;
        },
    };

    // =========================================================================
    //  UI — styles, counter, tooltip, notice, settings modal
    // =========================================================================
    const P = CONFIG.CSS_PREFIX;

    GM_addStyle(`
        #${IDS.COUNTER} { cursor: pointer; display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 4px; }
        #${IDS.COUNTER} .${P}-value { font-weight: bold; }
        #${IDS.COUNTER} .${P}-progress { color: #999; font-size: 11px; }
        #${IDS.COUNTER}.${P}-error .${P}-value { color: #e06c5a; }
        #${IDS.COUNTER}.${P}-stale .${P}-value { opacity: .6; }
        #${IDS.TOOLTIP} {
            position: fixed; z-index: 100000; background: #222; color: #ddd; border: 1px solid #444;
            border-radius: 4px; padding: 6px 8px; font: 12px/1.5 Arial, sans-serif; pointer-events: none;
            box-shadow: 0 2px 6px rgba(0,0,0,.5); white-space: nowrap;
        }
        #${IDS.NOTICE} {
            position: fixed; right: 16px; bottom: 16px; z-index: 100001; max-width: 320px;
            background: #2b2b2b; color: #eee; border-left: 4px solid #fd7f2c; border-radius: 4px;
            padding: 8px 12px; font: 12px/1.4 Arial, sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,.5);
        }
        #${IDS.MODAL} { position: fixed; inset: 0; z-index: 100002; background: rgba(0,0,0,.6);
            display: flex; align-items: center; justify-content: center; }
        #${IDS.MODAL} .${P}-panel { background: #2b2b2b; color: #ddd; width: 340px; max-width: calc(100vw - 32px);
            border-radius: 6px; padding: 16px; font: 13px/1.5 Arial, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.6); }
        #${IDS.MODAL} h3 { margin: 0 0 8px; font-size: 15px; color: #fd7f2c; }
        #${IDS.MODAL} input { width: 100%; box-sizing: border-box; margin: 6px 0; padding: 6px;
            background: #1b1b1b; color: #eee; border: 1px solid #555; border-radius: 4px; }
        #${IDS.MODAL} .${P}-row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
        #${IDS.MODAL} button { padding: 5px 12px; border-radius: 4px; border: 1px solid #555;
            background: #3a3a3a; color: #eee; cursor: pointer; }
        #${IDS.MODAL} button.${P}-primary { background: #fd7f2c; border-color: #fd7f2c; color: #111; }
        #${IDS.MODAL} .${P}-status { min-height: 18px; font-size: 12px; color: #aaa; }
        #${IDS.MODAL} .${P}-status.${P}-bad { color: #e06c5a; }
        #${IDS.MODAL} .${P}-status.${P}-good { color: #7cc36a; }
    `);

    /**
     * Small element factory.
     * @param {string} tag Tag name.
     * @param {Object} [props={}] Properties/attributes (className, textContent, type, ...).
     * @param {Array<Node|string>} [children=[]] Children; strings become text nodes.
     * @returns {HTMLElement}
     */
    function el(tag, props = {}, children = []) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (k in node) node[k] = v;
            else node.setAttribute(k, v);
        }
        for (const c of children) node.append(c);
        return node;
    }

    const UI = {
        /** @type {string|null} Current error message shown on the counter. */
        errorMessage: null,

        /**
         * Builds the counter row, copying Torn's native classes so it matches the sidebar.
         * @param {Element} pointsBlock Sidebar points container.
         * @returns {HTMLElement}
         */
        buildCounter(pointsBlock) {
            const nativeRow = pointsBlock.querySelector(CONFIG.SELECTORS.POINT_ROW);
            const nativeLabel = pointsBlock.querySelector(CONFIG.SELECTORS.POINT_LABEL);

            const row = el('p', { id: IDS.COUNTER, className: nativeRow?.className ?? '' }, [
                el('span', { className: nativeLabel?.className ?? '', textContent: 'Treats:' }),
                el('span', { className: `${P}-value`, textContent: '…' }),
                el('span', { className: `${P}-progress` }),
            ]);
            row.addEventListener('mouseenter', () => UI.showTooltip(row));
            row.addEventListener('mouseleave', UI.hideTooltip);
            row.addEventListener('click', () => Settings.open());
            return row;
        },

        /**
         * Inserts the counter if the sidebar exists and it is missing.
         * @returns {boolean} True if the counter is in the DOM after the call.
         */
        ensureCounter() {
            if (document.getElementById(IDS.COUNTER)) return true;
            const block = document.querySelector(`${CONFIG.SELECTORS.SIDEBAR_ROOT} ${CONFIG.SELECTORS.POINTS_BLOCK}`);
            if (!block) return false;
            block.append(UI.buildCounter(block));
            UI.render();
            return true;
        },

        /**
         * Renders the stored state (or error) into the counter.
         * @returns {void}
         */
        render() {
            const row = document.getElementById(IDS.COUNTER);
            if (!row) return;
            const state = State.read();
            const value = row.querySelector(`.${P}-value`);
            const progress = row.querySelector(`.${P}-progress`);

            value.textContent = state?.current != null ? fmt(state.current) : UI.errorMessage ? '⚠' : '…';
            if (state?.total != null) {
                progress.textContent = state.goal ? `· ${fmt(state.total)}/${fmt(state.goal)}` : `· ${fmt(state.total)}`;
            } else {
                progress.textContent = '';
            }

            const stale = !state?.updatedAt || Date.now() - state.updatedAt > CONFIG.POLL_INTERVAL_MS * 3;
            row.classList.toggle(`${P}-error`, Boolean(UI.errorMessage));
            row.classList.toggle(`${P}-stale`, stale);
        },

        /**
         * Shows a tooltip under the counter with full details.
         * @param {HTMLElement} anchor Counter row.
         * @returns {void}
         */
        showTooltip(anchor) {
            UI.hideTooltip();
            const s = State.read();
            const lines = [
                `Available: ${fmt(s?.current ?? null)}`,
                `Collected: ${fmt(s?.total ?? null)}${s?.goal ? ` / ${fmt(s.goal)}` : ''}`,
                s?.goalSource === 'upgrades' ? 'Goal: next upgrade requirement (estimate)' : null,
                `Updated ${timeAgo(s?.updatedAt)} (${s?.source ?? '—'})`,
                UI.errorMessage ? `⚠ ${UI.errorMessage}` : null,
                'Click for settings',
            ].filter(Boolean);

            const tip = el('div', { id: IDS.TOOLTIP });
            lines.forEach((line, i) => {
                if (i) tip.append(el('br'));
                tip.append(line);
            });
            const rect = anchor.getBoundingClientRect();
            tip.style.top = `${rect.bottom + 6}px`;
            tip.style.left = `${rect.left}px`;
            document.body.append(tip);
        },

        /** @returns {void} */
        hideTooltip() {
            document.getElementById(IDS.TOOLTIP)?.remove();
        },

        /**
         * Shows a temporary notice in the bottom-right corner.
         * @param {string} message Text to show.
         * @returns {void}
         */
        notice(message) {
            document.getElementById(IDS.NOTICE)?.remove();
            const box = el('div', { id: IDS.NOTICE, textContent: `Treat Counter: ${message}` });
            document.body.append(box);
            setTimeout(() => box.remove(), CONFIG.NOTICE_DURATION_MS);
        },

        /**
         * Sets or clears the error shown on the counter; notifies once per new message.
         * @param {string|null} message Error text, or null to clear.
         * @returns {void}
         */
        setError(message) {
            if (message && message !== UI.errorMessage) UI.notice(message);
            UI.errorMessage = message;
            UI.render();
        },
    };

    // =========================================================================
    //  Settings — API key panel
    // =========================================================================
    const Settings = {
        /**
         * Opens the settings modal.
         * @returns {void}
         */
        open() {
            if (document.getElementById(IDS.MODAL)) return;
            UI.hideTooltip();

            const hasKey = Boolean(Storage.get(KEYS.API_KEY));
            const input = el('input', {
                type: 'password',
                placeholder: hasKey ? 'Key saved — paste a new one to replace' : 'Paste your API key (Minimal Access)',
                autocomplete: 'off',
            });
            const status = el('div', { className: `${P}-status` });
            const save = el('button', { className: `${P}-primary`, type: 'button', textContent: 'Save & test' });
            const clear = el('button', { type: 'button', textContent: 'Remove key' });
            const close = el('button', { type: 'button', textContent: 'Close' });

            const panel = el('div', { className: `${P}-panel` }, [
                el('h3', { textContent: 'Treat Counter settings' }),
                el('div', { textContent: 'Needs a Minimal Access key. Stored only in Tampermonkey on this browser and sent only to api.torn.com.' }),
                input,
                status,
                el('div', { className: `${P}-row` }, [clear, close, save]),
            ]);
            const modal = el('div', { id: IDS.MODAL }, [panel]);

            const setStatus = (text, kind) => {
                status.textContent = text;
                status.className = `${P}-status${kind ? ` ${P}-${kind}` : ''}`;
            };

            save.addEventListener('click', async () => {
                const key = input.value.trim();
                if (!key) return setStatus('Paste a key first.', 'bad');
                save.disabled = true;
                setStatus('Checking key…');
                try {
                    const access = await Settings.validateKey(key);
                    Storage.set(KEYS.API_KEY, key);
                    Storage.remove(KEYS.BLOCKING_ERROR);
                    Storage.remove(KEYS.PAUSED_UNTIL);
                    UI.setError(null);
                    setStatus(`Saved. Access level: ${access}.`, 'good');
                    input.value = '';
                    Poller.refresh({ force: true });
                } catch (err) {
                    setStatus(err.message, 'bad');
                } finally {
                    save.disabled = false;
                }
            });

            clear.addEventListener('click', () => {
                Storage.remove(KEYS.API_KEY);
                setStatus('Key removed.', 'good');
                UI.setError('No API key set — click the counter to add one.');
            });

            close.addEventListener('click', () => modal.remove());
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.remove();
            });

            document.body.append(modal);
            input.focus();
        },

        /**
         * Checks a key with /key/info and rejects Public Only keys.
         * @param {string} key Candidate key.
         * @returns {Promise<string>} Access type label, e.g. "Minimal Access".
         * @throws {ApiError|Error} If the key is invalid or too low.
         */
        async validateKey(key) {
            /** @type {KeyInfoResponse} */
            const body = await Api.get('/key/info', {}, key);
            const type = body?.info?.access?.type;
            if (!type) throw new Error('Could not read key info.');
            if (type === 'Public Only') throw new Error('This is a Public Only key — Minimal Access or higher is required.');
            return type;
        },
    };

    // =========================================================================
    //  Poller — API refresh with cross-tab coordination
    // =========================================================================
    const Poller = {
        /** @type {number} */
        lastForcedAt: 0,
        /** @type {boolean} */
        inFlight: false,

        /**
         * Fetches /user/halloween and updates shared state, unless another tab
         * fetched recently, the tab is hidden, or polling is paused/blocked.
         * @param {{force?: boolean}} [opts] force: ignore freshness (still rate-limited).
         * @returns {Promise<void>}
         */
        async refresh({ force = false } = {}) {
            if (Poller.inFlight) return;
            if (!force && document.hidden) return;

            const blocking = Storage.get(KEYS.BLOCKING_ERROR);
            if (blocking) return UI.setError(blocking);
            if (!Storage.get(KEYS.API_KEY)) return UI.setError('No API key set — click the counter to add one.');
            if (Date.now() < (Storage.get(KEYS.PAUSED_UNTIL) ?? 0)) return;

            const lastFetch = Storage.get(KEYS.LAST_FETCH) ?? 0;
            const minGap = force ? CONFIG.FORCED_REFRESH_MIN_GAP_MS : CONFIG.POLL_INTERVAL_MS - CONFIG.FRESHNESS_SLACK_MS;
            if (Date.now() - lastFetch < minGap) return;

            Poller.inFlight = true;
            Storage.set(KEYS.LAST_FETCH, Date.now()); // claim the slot so other tabs skip
            try {
                const { current, total } = Data.parseUserHalloween(await Api.get('/user/halloween'));
                const prev = State.read();
                const goalPatch = await Poller.resolveGoal(prev, total);
                State.update({ current, total, ...goalPatch, source: 'api' });
                UI.setError(null);
            } catch (err) {
                Poller.handleError(err);
            } finally {
                Poller.inFlight = false;
                UI.render();
            }
        },

        /**
         * Keeps a basket-read goal while it's still ahead of total; otherwise
         * falls back to the next upgrade requirement from /torn/halloween.
         * @param {TreatState|null} prev Previous state.
         * @param {number} total Current collected total.
         * @returns {Promise<Partial<TreatState>>}
         */
        async resolveGoal(prev, total) {
            if (prev?.goalSource === 'basket' && prev.goal > total) return {};
            let upgrades = Cache.get(KEYS.TORN_HALLOWEEN, CONFIG.TORN_HALLOWEEN_TTL_MS);
            if (!upgrades) {
                try {
                    upgrades = await Api.get('/torn/halloween');
                    Cache.set(KEYS.TORN_HALLOWEEN, upgrades);
                } catch (err) {
                    log('Goal lookup failed', err.code, err.message);
                    return {};
                }
            }
            const goal = Data.nextRequirement(upgrades, total);
            return goal ? { goal, goalSource: 'upgrades' } : {};
        },

        /**
         * Maps an ApiError to pause/block/notice behavior.
         * @param {Error} err Error from the API layer.
         * @returns {void}
         */
        handleError(err) {
            const code = err instanceof ApiError ? err.code : -1;
            log('Refresh failed', code, err.message);
            if (code === 5) {
                Storage.set(KEYS.PAUSED_UNTIL, Date.now() + CONFIG.BACKOFF_ON_LIMIT_MS);
            } else if (BLOCKING_CODES.has(code)) {
                const msg = `${err.message} Click the counter to update your key.`;
                Storage.set(KEYS.BLOCKING_ERROR, msg);
                if (code === 2 || code === 16) Settings.open();
                return UI.setError(msg);
            }
            UI.setError(err.message);
        },

        /**
         * Immediate refresh after an in-game treat event (attack dialog).
         * Delayed slightly so the server has credited the treats.
         * @returns {Promise<void>}
         */
        async refreshSoon() {
            if (Date.now() - Poller.lastForcedAt < CONFIG.FORCED_REFRESH_MIN_GAP_MS) return;
            Poller.lastForcedAt = Date.now();
            await sleep(CONFIG.FORCED_REFRESH_DELAY_MS);
            Poller.refresh({ force: true });
        },

        /**
         * Starts the interval and visibility handling.
         * @returns {void}
         */
        start() {
            Poller.refresh();
            setInterval(() => Poller.refresh(), CONFIG.POLL_INTERVAL_MS);
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) Poller.refresh();
            });
        },
    };

    // =========================================================================
    //  Observers — sidebar re-render, basket view, attack dialog
    // =========================================================================
    const Observers = {
        /**
         * Re-inserts the counter if React re-renders the sidebar.
         * @param {Element} sidebarRoot #sidebarroot
         * @returns {void}
         */
        watchSidebar(sidebarRoot) {
            const check = throttle(() => UI.ensureCounter(), CONFIG.OBSERVER_DEBOUNCE_MS);
            new MutationObserver(check).observe(sidebarRoot, { childList: true, subtree: true });
        },

        /**
         * Reads counts from the basket view on item.php (no API call).
         * @returns {Promise<void>}
         */
        async watchBasket() {
            const wrap = await waitForElement(CONFIG.SELECTORS.ITEM_CATEGORY_WRAP);
            if (!wrap) return;
            const read = throttle(() => {
                const available = wrap.querySelector(CONFIG.SELECTORS.BASKET_AVAILABLE);
                if (!available) return;
                // The collected bar sits near .available-treats; scan its container.
                const scope = available.parentElement ?? available;
                const parsed = Data.parseBasketText(scope.innerText);
                if (parsed.current == null && parsed.total == null) return;
                const prev = State.read();
                if (prev?.current === parsed.current && prev?.total === parsed.total && prev?.goal === parsed.goal) return;
                log('Basket read', parsed);
                State.update({
                    ...parsed,
                    goalSource: parsed.goal != null ? 'basket' : undefined,
                    source: 'page',
                });
            }, CONFIG.OBSERVER_DEBOUNCE_MS);
            new MutationObserver(read).observe(wrap, { childList: true, subtree: true });
            read();
        },

        /**
         * On the attack page, refreshes from the API once the treat dialog appears.
         * @returns {void}
         */
        watchAttack() {
            let seen = false;
            const check = throttle(() => {
                const found = Boolean(document.querySelector(CONFIG.SELECTORS.ATTACK_TREAT_DIALOG));
                if (found && !seen) Poller.refreshSoon();
                seen = found;
            }, CONFIG.OBSERVER_DEBOUNCE_MS);
            new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
        },
    };

    // =========================================================================
    //  Init
    // =========================================================================

    /**
     * Entry point.
     * @returns {Promise<void>}
     */
    async function init() {
        if (!isEventActive()) {
            log('Outside the Halloween event window — idle.');
            return;
        }

        GM_registerMenuCommand('Treat Counter: Settings', () => Settings.open());
        GM_registerMenuCommand('Treat Counter: Clear cache', () => {
            Cache.clearAll();
            UI.setError(null);
            UI.notice('Cache cleared.');
            Poller.refresh({ force: true });
        });

        // Any tab's update re-renders every tab.
        Storage.onChange(KEYS.STATE, () => UI.render());

        const sidebar = await waitForElement(CONFIG.SELECTORS.SIDEBAR_ROOT);
        if (sidebar) {
            await waitForElement(`${CONFIG.SELECTORS.SIDEBAR_ROOT} ${CONFIG.SELECTORS.POINTS_BLOCK}`);
            UI.ensureCounter();
            Observers.watchSidebar(sidebar);
        }

        const href = location.href;
        if (CONFIG.PAGE_MATCH.ITEMS.test(href)) Observers.watchBasket();
        if (CONFIG.PAGE_MATCH.ATTACK.test(href)) Observers.watchAttack();

        if (!Storage.get(KEYS.API_KEY)) {
            UI.setError('No API key set — click the counter to add one.');
            Settings.open();
        }

        Poller.start();
    }

    init().catch((err) => {
        console.error(`[${CONFIG.SCRIPT_NAME}] init failed:`, err);
        UI.notice('Failed to start — see console for details.');
    });
})();
