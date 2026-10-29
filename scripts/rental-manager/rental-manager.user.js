// ==UserScript==
// @name         Torn Rental Manager
// @namespace    dadgum.torn.rental-manager
// @version      3.1.0
// @description  Queue of rental properties needing attention, one-click navigation, and auto-prefilled lease extensions. Torn API v2.
// @author       DadGum (rewrite) — based on "Easy Property Rent Extension" by IceBlueFire [776] (MIT)
// @license      MIT
// @match        https://www.torn.com/properties.php*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @connect      api.torn.com
// @run-at       document-idle
// @homepageURL  https://github.com/db7346/torn-userscripts/tree/main/scripts/rental-manager
// @supportURL   https://github.com/db7346/torn-userscripts/issues
// @updateURL    https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/rental-manager/rental-manager.user.js
// @downloadURL  https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/rental-manager/rental-manager.user.js
// ==/UserScript==

/*
 * =============================================================================
 *  TORN RENTAL MANAGER
 * =============================================================================
 *  On properties.php:
 *   - A card listing every owned property (of your chosen types) that needs
 *     attention: rented with N days or fewer left, or vacant.
 *   - Prev / Next navigation through that queue.
 *   - On the "Offer extension" tab, prefills cost and days from (in order):
 *       1. Your last agreement with this renter for this property (activity
 *          log; Full Access key only)
 *       2. The renter's current lease terms
 *       3. Your default cost/days
 *   - On the "Lease" (list for rent) tab, prefills your default cost/days.
 *   - Shows "Happy: N" in an empty slot on the property options page.
 *  You always click Submit yourself; the script never submits anything.
 *
 *  API KEY USAGE DISCLOSURE (per Torn API ToS)
 *   - Data storage:    Only locally in your browser (Tampermonkey storage).
 *   - Data sharing:    None. Nothing is sent anywhere except api.torn.com.
 *   - Purpose of use:  Managing your own rental properties.
 *   - Key storage:     Stored locally in Tampermonkey storage; never logged,
 *                      never placed in a URL, sent only in the Authorization
 *                      header to api.torn.com.
 *   - Key access level: Limited Access required. Full Access optional — it
 *                      enables prefill from your activity log.
 *
 *  API budget
 *   - /user/properties  ~1 call per 5 min of use (cached), +1 per manual refresh
 *   - /user/log         Full keys only, on the extension tab, cached 10 min
 *   - /key/info         Only when saving a key
 *
 *  Changelog
 *   3.1.0  Card shows only on the properties list and the extend/lease tabs
 *          (hidden on Vault and other option tabs).
 *   3.0.1  Added GitHub update/download URLs for Tampermonkey auto-updates.
 *   3.0.0  Rewrite: API v2 (Limited key works), single cached properties call,
 *          queue card UI, settings panel, no jQuery, hash routing instead of a
 *          page-wide observer, fill-once inputs, full API error handling.
 *          For-rent / for-sale properties are no longer counted as needing
 *          attention.
 *   2.3.0  Last version of the original by IceBlueFire.
 * =============================================================================
 */

(function () {
    'use strict';

    // =========================================================================
    //  CONFIG — every tunable value lives here
    // =========================================================================
    const CONFIG = Object.freeze({
        SCRIPT_NAME: 'RentalManager',
        STORAGE_PREFIX: 'tms-rent:',
        CSS_PREFIX: 'tms-rent',
        DEBUG: false,

        API_BASE: 'https://api.torn.com/v2',
        API_TIMEOUT_MS: 15000,
        RATE_LIMIT_PER_MIN: 50,
        BACKOFF_ON_LIMIT_MS: 2 * 60 * 1000,

        PROPERTIES_TTL_MS: 5 * 60 * 1000,
        LOG_TTL_MS: 10 * 60 * 1000,
        PAGE_SIZE: 100,          // API max for /user/properties and /user/log
        MAX_PAGES: 5,            // safety cap on property pagination (500 properties)

        LOG_IDS: [5937, 5943],   // rental agreement + rental extension (same IDs as the original)

        WAIT_TIMEOUT_MS: 10000,
        OBSERVER_THROTTLE_MS: 300,
        NOTICE_DURATION_MS: 6000,
        SUBMIT_CACHE_BUST_DELAY_MS: 3000,

        DEFAULT_SETTINGS: Object.freeze({
            daysThreshold: 2,
            defaultDays: 30,
            defaultCost: 23000000,
            propertyTypes: [13],
            accent: '#8ABEEF',
        }),

        PROPERTY_TYPES: Object.freeze({
            1: 'Trailer', 2: 'Apartment', 3: 'Semi-Detached House', 4: 'Detached House',
            5: 'Beach House', 6: 'Chalet', 7: 'Villa', 8: 'Penthouse', 9: 'Mansion',
            10: 'Ranch', 11: 'Palace', 12: 'Castle', 13: 'Private Island',
        }),

        SELECTORS: Object.freeze({
            PAGE_WRAP: '#properties-page-wrap',
            CARD_ANCHOR: '#properties-page-wrap .content-title.m-bottom10',
            EXT_FORM: '.offerExtension-form',
            EXT_RENTER_LINK: '.offerExtension-form a.h.t-blue',
            EXT_COST: '.offerExtension.input-money[data-name="offercost"]',
            EXT_DAYS: '.offerExtension.input-money[data-name="days"]',
            EXT_SUBMIT: '.offerExtension-form input[type="submit"]',
            LEASE_COST: '#market input.lease.input-money[data-name="money"]',
            LEASE_DAYS: '#market input.lease.input-money[data-name="days"]',
            LEASE_SUBMIT: '#market input[type="submit"]',
            OPTIONS_EMPTY_SLOT: 'ul.options-list.left li.empty',
        }),

        TABS: Object.freeze({ EXTEND: 'offerExtension', LEASE: 'lease' }),
    });

    const P = CONFIG.CSS_PREFIX;
    const IDS = Object.freeze({
        CARD: `${P}-card`,
        MODAL: `${P}-modal`,
        NOTICE: `${P}-notice`,
    });
    const KEYS = Object.freeze({
        API_KEY: 'apiKey',
        KEY_ACCESS: 'keyAccess',
        SETTINGS: 'settings',
        PROPERTIES: 'cache:properties',
        LOG: 'cache:log',
        PAUSED_UNTIL: 'pausedUntil',
    });
    const FILLED_ATTR = `data-${P}-filled`;

    // =========================================================================
    //  Types (shapes taken from TornAPI3.1.0.txt)
    // =========================================================================
    /**
     * @typedef {{id: number, name: string}} BasicUser
     */
    /**
     * @typedef {Object} UserProperty  One item of GET /user/properties (Limited key)
     * @property {number} id                       Property instance ID
     * @property {BasicUser} owner
     * @property {{id: number, name: string}} property  Property type
     * @property {number} happy
     * @property {'none'|'in_use'|'for_sale'|'rented'|'for_rent'} status
     * @property {BasicUser} [rented_by]           status === 'rented'
     * @property {number} [cost]                   Lease cost (assumed: total for the period)
     * @property {number} [cost_per_day]
     * @property {number} [rental_period]          Days
     * @property {number} [rental_period_remaining] Days
     * @property {{cost: number, period: number, created_at: number}|null} [lease_extension]
     */
    /**
     * @typedef {Object} UserLog  One item of GET /user/log
     * @property {string} id
     * @property {number} timestamp
     * @property {{id: number, title: string, category: string}} details
     * @property {Object} data  Undocumented key/values. Expected (v1 names): property_id, renter, days, rent
     */
    /**
     * @typedef {Object} Settings
     * @property {number} daysThreshold
     * @property {number} defaultDays
     * @property {number} defaultCost
     * @property {number[]} propertyTypes
     * @property {string} accent  Hex color
     */
    /**
     * @typedef {Object} Terms  What we prefill
     * @property {number} cost
     * @property {number} days
     * @property {'log'|'lease'|'defaults'} source
     */

    // =========================================================================
    //  Utilities
    // =========================================================================

    /**
     * Debug logger, silent unless CONFIG.DEBUG. Never pass the API key.
     * @param {...*} args Values to log.
     * @returns {void}
     */
    function log(...args) {
        if (CONFIG.DEBUG) console.log(`[${CONFIG.SCRIPT_NAME}]`, ...args);
    }

    /**
     * Throttle with trailing call (Torn pages mutate constantly, so debounce may never fire).
     * @param {Function} fn Function to throttle.
     * @param {number} waitMs Minimum gap in ms.
     * @returns {Function}
     */
    function throttle(fn, waitMs) {
        let last = 0;
        let timer = null;
        return (...args) => {
            const wait = waitMs - (Date.now() - last);
            clearTimeout(timer);
            const run = () => {
                last = Date.now();
                fn(...args);
            };
            if (wait <= 0) run();
            else timer = setTimeout(run, wait);
        };
    }

    /**
     * Resolves after a delay.
     * @param {number} ms Delay.
     * @returns {Promise<void>}
     */
    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Waits until predicate() returns a truthy value, re-checking on DOM changes.
     * @template T
     * @param {() => T} predicate Returns the value to resolve with, or falsy to keep waiting.
     * @param {number} [timeoutMs=CONFIG.WAIT_TIMEOUT_MS] Give up after this long.
     * @returns {Promise<T|null>} The value, or null on timeout.
     */
    function waitFor(predicate, timeoutMs = CONFIG.WAIT_TIMEOUT_MS) {
        const first = predicate();
        if (first) return Promise.resolve(first);
        return new Promise((resolve) => {
            const check = throttle(() => {
                const value = predicate();
                if (value) finish(value);
            }, 100);
            const observer = new MutationObserver(check);
            const timer = setTimeout(() => finish(null), timeoutMs);
            /** @param {T|null} value */
            function finish(value) {
                observer.disconnect();
                clearTimeout(timer);
                resolve(value);
            }
            observer.observe(document.body, {
                childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'],
            });
        });
    }

    /**
     * True if an element is rendered (not display:none, and not inside a hidden parent).
     * @param {Element|null} node Element.
     * @returns {boolean}
     */
    function isVisible(node) {
        return Boolean(node && node.getClientRects().length);
    }

    /**
     * Reads the hash route, e.g. "#/p=options&ID=123&tab=lease".
     * @returns {{p: string|null, id: string|null, tab: string|null}}
     */
    function readRoute() {
        const params = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
        return { p: params.get('p'), id: params.get('ID'), tab: params.get('tab') };
    }

    /**
     * Builds the in-page link to a property's tab.
     * @param {number|string} id Property instance ID.
     * @param {string} tab Tab name.
     * @returns {string}
     */
    function propertyHref(id, tab) {
        return `#/p=options&ID=${id}&tab=${tab}`;
    }

    /**
     * Short money format: 23000000 -> "$23.0m", 766667 -> "$767k".
     * @param {number|null|undefined} n Amount.
     * @returns {string}
     */
    function money(n) {
        if (!Number.isFinite(n)) return '—';
        const abs = Math.abs(n);
        if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}b`;
        if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}m`;
        if (abs >= 1e3) return `$${Math.round(n / 1e3)}k`;
        return `$${n}`;
    }

    /**
     * Element factory. Props that exist on the element are set as properties,
     * others as attributes. Strings in children become text nodes (no innerHTML).
     * @param {string} tag Tag name.
     * @param {Object} [props={}] Properties/attributes.
     * @param {Array<Node|string|null|false>} [children=[]] Children; falsy entries skipped.
     * @returns {HTMLElement}
     */
    function el(tag, props = {}, children = []) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (v == null) continue;
            if (k === 'dataset') Object.assign(node.dataset, v);
            else if (k in node) node[k] = v;
            else node.setAttribute(k, v);
        }
        for (const c of children) if (c) node.append(c);
        return node;
    }

    // =========================================================================
    //  Storage — namespaced GM storage with JSON (de)serialization
    // =========================================================================
    const Storage = {
        /**
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
         * @param {string} key Unprefixed key.
         * @param {*} value Serializable value.
         * @returns {void}
         */
        set(key, value) {
            GM_setValue(CONFIG.STORAGE_PREFIX + key, JSON.stringify(value));
        },

        /**
         * @param {string} key Unprefixed key.
         * @returns {void}
         */
        remove(key) {
            GM_deleteValue(CONFIG.STORAGE_PREFIX + key);
        },
    };

    // =========================================================================
    //  Cache — TTL wrapper over Storage
    // =========================================================================
    const Cache = {
        /**
         * @param {string} key Unprefixed key.
         * @param {number} ttlMs Max age.
         * @returns {*|null} Data if fresh.
         */
        get(key, ttlMs) {
            const entry = Storage.get(key);
            if (!entry || Date.now() - entry.savedAt > ttlMs) return null;
            return entry.data;
        },

        /**
         * @param {string} key Unprefixed key.
         * @param {*} data Serializable data.
         * @returns {void}
         */
        set(key, data) {
            Storage.set(key, { savedAt: Date.now(), data });
        },

        /**
         * Age of a cache entry in ms, or null if missing.
         * @param {string} key Unprefixed key.
         * @returns {number|null}
         */
        age(key) {
            const entry = Storage.get(key);
            return entry ? Date.now() - entry.savedAt : null;
        },

        /** @returns {void} */
        clearAll() {
            Storage.remove(KEYS.PROPERTIES);
            Storage.remove(KEYS.LOG);
            Storage.remove(KEYS.PAUSED_UNTIL);
        },
    };

    // =========================================================================
    //  Settings
    // =========================================================================
    const SettingsStore = {
        /** @returns {Settings} Stored settings merged over defaults. */
        read() {
            return { ...CONFIG.DEFAULT_SETTINGS, ...Storage.get(KEYS.SETTINGS, {}) };
        },

        /**
         * Validates and saves settings.
         * @param {Partial<Settings>} next New values.
         * @returns {Settings}
         * @throws {Error} With a readable message if a value is invalid.
         */
        save(next) {
            const s = { ...SettingsStore.read(), ...next };
            const posInt = (v, name) => {
                if (!Number.isInteger(v) || v < 0) throw new Error(`${name} must be a whole number of 0 or more.`);
            };
            posInt(s.daysThreshold, 'Days threshold');
            posInt(s.defaultDays, 'Default days');
            posInt(s.defaultCost, 'Default cost');
            if (!s.propertyTypes.length) throw new Error('Pick at least one property type.');
            if (!/^#[0-9a-f]{6}$/i.test(s.accent)) throw new Error('Accent must be a hex color like #8ABEEF.');
            Storage.set(KEYS.SETTINGS, s);
            return s;
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
        16: 'Key access level too low — Limited Access or higher is required.',
        17: 'Torn backend error — try again shortly.',
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

    /** Sliding 60-second window limiter for this tab. */
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
         * GET an API v2 path. The key goes in the Authorization header only.
         * @param {string} path e.g. '/user/properties'
         * @param {Object<string, string|number>} [params={}] Query params.
         * @param {string} [keyOverride] Key to use instead of the stored one.
         * @returns {Promise<Object>} Parsed body.
         * @throws {ApiError}
         */
        async get(path, params = {}, keyOverride) {
            const key = keyOverride ?? Storage.get(KEYS.API_KEY);
            if (!key) throw new ApiError(1, API_ERROR_MESSAGES[1]);
            if (Date.now() < (Storage.get(KEYS.PAUSED_UNTIL) ?? 0)) {
                throw new ApiError(5, API_ERROR_MESSAGES[5]);
            }

            await RateLimiter.acquire();
            const query = new URLSearchParams({ ...params, comment: CONFIG.SCRIPT_NAME });
            log('GET', path, params);

            const body = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: `${CONFIG.API_BASE}${path}?${query}`,
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
                if (code === 5) Storage.set(KEYS.PAUSED_UNTIL, Date.now() + CONFIG.BACKOFF_ON_LIMIT_MS);
                throw new ApiError(code, API_ERROR_MESSAGES[code] ?? body.error.error ?? 'API error.');
            }
            return body;
        },

        /**
         * All properties you own (paginated), Limited key for extended fields.
         * @returns {Promise<UserProperty[]>}
         * @throws {ApiError}
         */
        async fetchProperties() {
            const all = [];
            for (let page = 0; page < CONFIG.MAX_PAGES; page++) {
                const body = await Api.get('/user/properties', {
                    filters: 'ownedByUser',
                    limit: CONFIG.PAGE_SIZE,
                    offset: page * CONFIG.PAGE_SIZE,
                });
                if (!Array.isArray(body?.properties)) {
                    throw new ApiError(-1, 'Unexpected /user/properties response — the API may have changed.');
                }
                all.push(...body.properties);
                if (!body._metadata?.links?.next || body.properties.length < CONFIG.PAGE_SIZE) break;
            }
            return all;
        },

        /**
         * Recent rental agreement/extension logs (Full key only).
         * @returns {Promise<UserLog[]>}
         * @throws {ApiError}
         */
        async fetchRentalLogs() {
            const body = await Api.get('/user/log', { log: CONFIG.LOG_IDS.join(','), limit: CONFIG.PAGE_SIZE });
            if (!Array.isArray(body?.log)) {
                throw new ApiError(-1, 'Unexpected /user/log response — the API may have changed.');
            }
            return body.log;
        },
    };

    // =========================================================================
    //  Data — pure functions (no DOM)
    // =========================================================================
    const Data = {
        /**
         * Splits owned properties into the attention queue.
         * Rented with <= threshold days left (soonest first), then vacant.
         * Excludes your residence (in_use) and anything already for rent/sale.
         * @param {UserProperty[]} properties All owned properties.
         * @param {Settings} settings Current settings.
         * @returns {{queue: UserProperty[], total: number}}
         */
        buildQueue(properties, settings) {
            const mine = properties.filter((p) => settings.propertyTypes.includes(p.property?.id));
            const expiring = mine
                .filter((p) => p.status === 'rented' && p.rental_period_remaining <= settings.daysThreshold)
                .sort((a, b) => a.rental_period_remaining - b.rental_period_remaining);
            const vacant = mine.filter((p) => p.status === 'none');
            return { queue: [...expiring, ...vacant], total: mine.length };
        },

        /**
         * The tab a queue entry should open on.
         * @param {UserProperty} p Property.
         * @returns {string}
         */
        tabFor(p) {
            return p.status === 'rented' ? CONFIG.TABS.EXTEND : CONFIG.TABS.LEASE;
        },

        /**
         * Finds the newest agreement in the logs for a property + renter.
         * Uses the v1 data key names; returns null if they aren't present.
         * @param {UserLog[]} logs Rental logs.
         * @param {string|number} propertyId Property instance ID.
         * @param {string|number} renterId Renter's user ID.
         * @returns {{cost: number, days: number}|null}
         */
        termsFromLogs(logs, propertyId, renterId) {
            const match = [...logs]
                .sort((a, b) => b.timestamp - a.timestamp)
                .find((l) => String(l.data?.property_id) === String(propertyId)
                    && String(l.data?.renter) === String(renterId));
            const cost = Number(match?.data?.rent);
            const days = Number(match?.data?.days);
            return Number.isFinite(cost) && Number.isFinite(days) && cost > 0 && days > 0 ? { cost, days } : null;
        },

        /**
         * Current lease terms of a rented property.
         * @param {UserProperty|undefined} p Property.
         * @returns {{cost: number, days: number}|null}
         */
        termsFromLease(p) {
            return p?.status === 'rented' && p.cost > 0 && p.rental_period > 0
                ? { cost: p.cost, days: p.rental_period }
                : null;
        },
    };

    // =========================================================================
    //  Repository — cached data access (dedupes concurrent requests)
    // =========================================================================
    const Repo = {
        /** @type {Promise<UserProperty[]>|null} */
        inflightProperties: null,
        /** @type {Promise<UserLog[]>|null} */
        inflightLogs: null,

        /**
         * Owned properties, from cache when fresh.
         * @param {{force?: boolean}} [opts]
         * @returns {Promise<UserProperty[]>}
         * @throws {ApiError}
         */
        properties({ force = false } = {}) {
            if (!force) {
                const cached = Cache.get(KEYS.PROPERTIES, CONFIG.PROPERTIES_TTL_MS);
                if (cached) return Promise.resolve(cached);
            }
            Repo.inflightProperties ??= Api.fetchProperties()
                .then((data) => {
                    Cache.set(KEYS.PROPERTIES, data);
                    return data;
                })
                .finally(() => {
                    Repo.inflightProperties = null;
                });
            return Repo.inflightProperties;
        },

        /**
         * Rental logs, from cache when fresh. Only call with a Full key.
         * @returns {Promise<UserLog[]>}
         * @throws {ApiError}
         */
        logs() {
            const cached = Cache.get(KEYS.LOG, CONFIG.LOG_TTL_MS);
            if (cached) return Promise.resolve(cached);
            Repo.inflightLogs ??= Api.fetchRentalLogs()
                .then((data) => {
                    Cache.set(KEYS.LOG, data);
                    return data;
                })
                .finally(() => {
                    Repo.inflightLogs = null;
                });
            return Repo.inflightLogs;
        },

        /**
         * True if the saved key can read logs.
         * @returns {boolean}
         */
        canReadLogs() {
            const access = Storage.get(KEYS.KEY_ACCESS);
            return access === 'Full Access' || access === 'Custom';
        },
    };

    // =========================================================================
    //  UI — styles
    // =========================================================================
    GM_addStyle(`
        #${IDS.CARD} {
            --${P}-accent: #8ABEEF;
            --${P}-accent-dark: color-mix(in srgb, var(--${P}-accent) 60%, #000);
            --${P}-bg: #f7f7f7; --${P}-row: #fff; --${P}-row-hover: #eef4fb; --${P}-border: #dcdcdc;
            --${P}-text: #333; --${P}-muted: #777; --${P}-danger: #d9534f; --${P}-warn: #e6a23c; --${P}-idle: #9aa5b1;
            margin: 10px 0; border-radius: 8px; overflow: hidden; font-family: Arial, sans-serif; font-size: 12px;
            color: var(--${P}-text); background: var(--${P}-bg); border: 1px solid var(--${P}-border);
            box-shadow: 0 2px 6px rgba(0,0,0,.12);
        }
        body.dark-mode #${IDS.CARD} {
            --${P}-bg: #2a2a2a; --${P}-row: #333; --${P}-row-hover: #3b4148; --${P}-border: #444;
            --${P}-text: #ddd; --${P}-muted: #9a9a9a; box-shadow: 0 2px 8px rgba(0,0,0,.45);
        }
        #${IDS.CARD} .${P}-head {
            display: flex; align-items: center; gap: 8px; padding: 8px 12px; color: #fff;
            background: linear-gradient(135deg, var(--${P}-accent), var(--${P}-accent-dark));
        }
        #${IDS.CARD} .${P}-title { font-weight: 700; font-size: 13px; letter-spacing: .3px; text-shadow: 0 1px 2px rgba(0,0,0,.35); }
        #${IDS.CARD} .${P}-badge {
            margin-left: auto; padding: 2px 8px; border-radius: 999px; font-weight: 700; font-size: 11px;
            background: rgba(0,0,0,.25); white-space: nowrap;
        }
        #${IDS.CARD} .${P}-icon-btn {
            border: 0; background: rgba(255,255,255,.18); color: #fff; width: 24px; height: 24px; border-radius: 6px;
            cursor: pointer; font-size: 13px; line-height: 24px; padding: 0; transition: background .15s;
        }
        #${IDS.CARD} .${P}-icon-btn:hover { background: rgba(255,255,255,.32); }
        #${IDS.CARD} .${P}-icon-btn.${P}-spin { animation: ${P}-spin .8s linear infinite; }
        @keyframes ${P}-spin { to { transform: rotate(360deg); } }
        #${IDS.CARD} .${P}-list { position: relative; list-style: none; margin: 0; padding: 6px; display: grid; gap: 4px; max-height: 320px; overflow-y: auto; }
        #${IDS.CARD} .${P}-row {
            display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 2px 10px;
            padding: 7px 10px; border-radius: 6px; background: var(--${P}-row); border: 1px solid transparent;
            transition: background .15s, border-color .15s;
        }
        #${IDS.CARD} .${P}-row:hover { background: var(--${P}-row-hover); }
        #${IDS.CARD} .${P}-row.${P}-current { border-color: var(--${P}-accent); background: var(--${P}-row-hover); }
        #${IDS.CARD} .${P}-dot { width: 8px; height: 8px; border-radius: 50%; grid-row: span 2; }
        #${IDS.CARD} .${P}-dot.${P}-urgent { background: var(--${P}-danger); box-shadow: 0 0 0 3px color-mix(in srgb, var(--${P}-danger) 25%, transparent); }
        #${IDS.CARD} .${P}-dot.${P}-soon { background: var(--${P}-warn); }
        #${IDS.CARD} .${P}-dot.${P}-vacant { background: transparent; border: 2px solid var(--${P}-idle); width: 6px; height: 6px; }
        #${IDS.CARD} .${P}-name { font-weight: 700; }
        #${IDS.CARD} .${P}-name small { font-weight: 400; color: var(--${P}-muted); margin-left: 4px; }
        #${IDS.CARD} .${P}-meta { color: var(--${P}-muted); }
        #${IDS.CARD} .${P}-meta a { color: inherit; text-decoration: underline dotted; }
        #${IDS.CARD} .${P}-status { font-weight: 700; }
        #${IDS.CARD} .${P}-status.${P}-urgent { color: var(--${P}-danger); }
        #${IDS.CARD} .${P}-status.${P}-soon { color: var(--${P}-warn); }
        #${IDS.CARD} .${P}-action {
            grid-row: span 2; align-self: center; padding: 5px 10px; border-radius: 6px; font-weight: 700; font-size: 11px;
            text-decoration: none; color: #fff; background: var(--${P}-accent-dark); white-space: nowrap; transition: filter .15s;
        }
        #${IDS.CARD} .${P}-action:hover { filter: brightness(1.15); }
        #${IDS.CARD} .${P}-empty, #${IDS.CARD} .${P}-msg { padding: 14px 12px; text-align: center; color: var(--${P}-muted); }
        #${IDS.CARD} .${P}-msg.${P}-error { color: var(--${P}-danger); }
        #${IDS.CARD} .${P}-foot {
            display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px;
            border-top: 1px solid var(--${P}-border); color: var(--${P}-muted);
        }
        #${IDS.CARD} .${P}-nav {
            padding: 4px 10px; border-radius: 6px; text-decoration: none; font-weight: 700; color: var(--${P}-text);
            border: 1px solid var(--${P}-border); background: var(--${P}-row);
        }
        #${IDS.CARD} .${P}-nav:hover { border-color: var(--${P}-accent); }
        #${IDS.CARD} .${P}-nav.${P}-disabled { opacity: .4; pointer-events: none; }
        #${IDS.CARD} .${P}-prefill { padding: 6px 12px; border-top: 1px solid var(--${P}-border); color: var(--${P}-muted); }
        #${IDS.CARD} .${P}-prefill b { color: var(--${P}-text); }

        li.${P}-happy .desc { font-weight: 700; }

        #${IDS.NOTICE} {
            position: fixed; right: 16px; bottom: 16px; z-index: 100001; max-width: 340px; background: #2b2b2b; color: #eee;
            border-left: 4px solid #8ABEEF; border-radius: 6px; padding: 8px 12px; font: 12px/1.4 Arial, sans-serif;
            box-shadow: 0 2px 8px rgba(0,0,0,.5);
        }

        #${IDS.MODAL} { position: fixed; inset: 0; z-index: 100002; background: rgba(0,0,0,.6);
            display: flex; align-items: center; justify-content: center; }
        #${IDS.MODAL} .${P}-panel { background: #2b2b2b; color: #ddd; width: 420px; max-width: calc(100vw - 32px);
            max-height: calc(100vh - 32px); overflow-y: auto; border-radius: 8px; padding: 16px;
            font: 13px/1.5 Arial, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.6); }
        #${IDS.MODAL} h3 { margin: 0 0 4px; font-size: 15px; color: #8ABEEF; }
        #${IDS.MODAL} .${P}-hint { color: #999; font-size: 12px; margin-bottom: 8px; }
        #${IDS.MODAL} label { display: block; margin-top: 10px; font-weight: 700; }
        #${IDS.MODAL} input[type=text], #${IDS.MODAL} input[type=password], #${IDS.MODAL} input[type=number] {
            width: 100%; box-sizing: border-box; margin-top: 4px; padding: 6px; background: #1b1b1b; color: #eee;
            border: 1px solid #555; border-radius: 4px; }
        #${IDS.MODAL} .${P}-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
        #${IDS.MODAL} .${P}-types { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; margin-top: 4px; font-weight: 400; }
        #${IDS.MODAL} .${P}-types label { margin: 0; font-weight: 400; }
        #${IDS.MODAL} input[type=color] { margin-top: 4px; width: 60px; height: 28px; border: 0; background: none; padding: 0; }
        #${IDS.MODAL} .${P}-row-btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
        #${IDS.MODAL} button { padding: 5px 12px; border-radius: 4px; border: 1px solid #555; background: #3a3a3a; color: #eee; cursor: pointer; }
        #${IDS.MODAL} button.${P}-primary { background: #8ABEEF; border-color: #8ABEEF; color: #111; font-weight: 700; }
        #${IDS.MODAL} .${P}-status-line { min-height: 18px; font-size: 12px; margin-top: 8px; color: #aaa; }
        #${IDS.MODAL} .${P}-status-line.${P}-bad { color: #e06c5a; }
        #${IDS.MODAL} .${P}-status-line.${P}-good { color: #7cc36a; }
    `);

    // =========================================================================
    //  UI — notice
    // =========================================================================
    const Notice = {
        /** @type {string|null} */
        lastMessage: null,

        /**
         * Shows a temporary toast (de-duplicated against the previous message).
         * @param {string} message Text.
         * @returns {void}
         */
        show(message) {
            if (message === Notice.lastMessage && document.getElementById(IDS.NOTICE)) return;
            Notice.lastMessage = message;
            document.getElementById(IDS.NOTICE)?.remove();
            const box = el('div', { id: IDS.NOTICE, textContent: `Rental Manager: ${message}` });
            document.body.append(box);
            setTimeout(() => box.remove(), CONFIG.NOTICE_DURATION_MS);
        },
    };

    // =========================================================================
    //  UI — queue card
    // =========================================================================
    const Card = {
        /** @type {Terms|null} Last prefill applied on this view, shown in the card. */
        prefill: null,
        /** @type {{type: 'loading'|'error', text: string}|null} */
        message: null,
        /** @type {UserProperty[]|null} */
        properties: null,
        /** @type {boolean} */
        refreshing: false,

        /**
         * Whether the card belongs on this route: the properties list (with or
         * without a hash) and the extension/lease tabs, but no other option tabs.
         * @param {{p: string|null, tab: string|null}} route Current route.
         * @returns {boolean}
         */
        shouldShow(route) {
            return route.p == null
                || route.p === 'properties'
                || route.tab === CONFIG.TABS.EXTEND
                || route.tab === CONFIG.TABS.LEASE;
        },

        /**
         * Inserts the card shell if missing, or removes it on routes where it doesn't belong.
         * @returns {HTMLElement|null} The card, or null if hidden here or the page anchor isn't there yet.
         */
        ensure() {
            let card = document.getElementById(IDS.CARD);
            if (!Card.shouldShow(readRoute())) {
                card?.remove();
                return null;
            }
            if (card) return card;
            const anchor = document.querySelector(CONFIG.SELECTORS.CARD_ANCHOR);
            const wrap = document.querySelector(CONFIG.SELECTORS.PAGE_WRAP);
            if (!anchor && !wrap) return null;
            card = el('div', { id: IDS.CARD });
            if (anchor) anchor.after(card);
            else wrap.prepend(card);
            Card.render();
            return card;
        },

        /**
         * Loads properties (cache or API) and re-renders.
         * @param {{force?: boolean}} [opts]
         * @returns {Promise<void>}
         */
        async load({ force = false } = {}) {
            if (!Storage.get(KEYS.API_KEY)) {
                Card.message = { type: 'error', text: 'No API key set — open settings (⚙) to add one.' };
                return Card.render();
            }
            if (!Card.properties) Card.message = { type: 'loading', text: 'Loading your properties…' };
            Card.refreshing = true;
            Card.render();
            try {
                Card.properties = await Repo.properties({ force });
                Card.message = null;
            } catch (err) {
                Card.message = { type: 'error', text: err.message };
                Notice.show(err.message);
                if (err.code === 2 || err.code === 16) Settings.open();
            } finally {
                Card.refreshing = false;
                Card.render();
            }
        },

        /**
         * Renders the full card from current state. Pure DOM build, no innerHTML.
         * @returns {void}
         */
        render() {
            const card = document.getElementById(IDS.CARD);
            if (!card) return;
            const settings = SettingsStore.read();
            card.style.setProperty(`--${P}-accent`, settings.accent);

            const { queue, total } = Card.properties
                ? Data.buildQueue(Card.properties, settings)
                : { queue: [], total: 0 };
            const route = readRoute();
            const currentIndex = queue.findIndex((p) => String(p.id) === route.id);

            const refreshBtn = el('button', {
                type: 'button', title: 'Refresh from API', textContent: '↻',
                className: `${P}-icon-btn${Card.refreshing ? ` ${P}-spin` : ''}`,
            });
            refreshBtn.addEventListener('click', () => Card.load({ force: true }));
            const gearBtn = el('button', { type: 'button', title: 'Settings', textContent: '⚙', className: `${P}-icon-btn` });
            gearBtn.addEventListener('click', () => Settings.open());

            const head = el('div', { className: `${P}-head` }, [
                el('span', { className: `${P}-title`, textContent: 'Rental Manager' }),
                Card.properties && el('span', {
                    className: `${P}-badge`,
                    textContent: `${queue.length} / ${total} need attention`,
                    title: `Rented with ≤ ${settings.daysThreshold} days left, or vacant`,
                }),
                el('span', { style: Card.properties ? '' : 'margin-left:auto' }),
                refreshBtn,
                gearBtn,
            ]);

            let body;
            if (Card.message && !Card.properties) {
                body = el('div', { className: `${P}-msg ${Card.message.type === 'error' ? `${P}-error` : ''}`, textContent: Card.message.text });
            } else if (!queue.length) {
                body = el('div', { className: `${P}-empty`, textContent: 'All caught up — nothing needs attention.' });
            } else {
                body = el('ul', { className: `${P}-list` }, queue.map((p, i) => Card.row(p, i === currentIndex, settings)));
            }

            const errorStrip = Card.message?.type === 'error' && Card.properties
                ? el('div', { className: `${P}-msg ${P}-error`, textContent: Card.message.text })
                : null;

            card.replaceChildren(...[
                head,
                errorStrip,
                body,
                Card.prefill ? Card.prefillLine(Card.prefill) : null,
                queue.length ? Card.footer(queue, currentIndex) : null,
            ].filter(Boolean)); // replaceChildren would render null as the text "null"
            // Keep the current row visible inside the list without scrolling the page.
            const list = card.querySelector(`.${P}-list`);
            const current = list?.querySelector(`.${P}-current`);
            if (list && current) list.scrollTop = Math.max(0, current.offsetTop - 6);
        },

        /**
         * One queue row.
         * @param {UserProperty} p Property.
         * @param {boolean} isCurrent Highlight as the one being viewed.
         * @param {Settings} settings Settings.
         * @returns {HTMLElement}
         */
        row(p, isCurrent, settings) {
            const rented = p.status === 'rented';
            const left = p.rental_period_remaining;
            const urgency = !rented ? 'vacant' : left <= 1 ? 'urgent' : 'soon';
            const typeName = p.property?.name ?? CONFIG.PROPERTY_TYPES[p.property?.id] ?? 'Property';

            const renter = rented && p.rented_by
                ? el('a', {
                    href: `/profiles.php?XID=${p.rented_by.id}`,
                    textContent: `${p.rented_by.name} [${p.rented_by.id}]`,
                })
                : null;

            const meta = rented
                ? el('div', { className: `${P}-meta` }, [
                    el('span', { className: `${P}-status ${P}-${urgency}`, textContent: `${left}d left` }),
                    ' · ', renter, ' · ',
                    `${money(p.cost)} / ${p.rental_period}d (${money(p.cost_per_day)}/day)`,
                    p.lease_extension ? ` · extension offered: ${money(p.lease_extension.cost)} / ${p.lease_extension.period}d` : '',
                ])
                : el('div', { className: `${P}-meta` }, [
                    el('span', { className: `${P}-status`, textContent: 'Vacant' }),
                    ` · default ${money(settings.defaultCost)} / ${settings.defaultDays}d`,
                ]);

            return el('li', { className: `${P}-row${isCurrent ? ` ${P}-current` : ''}` }, [
                el('span', { className: `${P}-dot ${P}-${urgency}` }),
                el('div', { className: `${P}-name` }, [typeName, el('small', { textContent: `#${p.id}` })]),
                el('a', {
                    className: `${P}-action`,
                    href: propertyHref(p.id, Data.tabFor(p)),
                    textContent: rented ? 'Extend →' : 'List →',
                }),
                meta,
            ]);
        },

        /**
         * Prev / position / Next footer.
         * @param {UserProperty[]} queue Queue.
         * @param {number} index Current index or -1.
         * @returns {HTMLElement}
         */
        footer(queue, index) {
            const prev = index > 0 ? queue[index - 1] : null;
            const next = index < queue.length - 1 ? queue[index === -1 ? 0 : index + 1] : null;
            const nav = (target, label) => el('a', {
                className: `${P}-nav${target ? '' : ` ${P}-disabled`}`,
                href: target ? propertyHref(target.id, Data.tabFor(target)) : '#',
                textContent: label,
            });
            return el('div', { className: `${P}-foot` }, [
                nav(prev, '‹ Prev'),
                el('span', { textContent: index >= 0 ? `Viewing ${index + 1} of ${queue.length}` : `${queue.length} in queue` }),
                nav(next, index === -1 ? 'Start ›' : 'Next ›'),
            ]);
        },

        /**
         * "Prefilled from …" line.
         * @param {Terms} t Applied terms.
         * @returns {HTMLElement}
         */
        prefillLine(t) {
            const label = { log: 'your last agreement (activity log)', lease: 'the current lease', defaults: 'your defaults' }[t.source];
            return el('div', { className: `${P}-prefill` }, [
                'Prefilled ', el('b', { textContent: `${money(t.cost)} / ${t.days}d` }), ` from ${label}.`,
            ]);
        },
    };

    // =========================================================================
    //  UI — settings modal
    // =========================================================================
    const Settings = {
        /**
         * Opens the settings modal.
         * @returns {void}
         */
        open() {
            if (document.getElementById(IDS.MODAL)) return;
            const s = SettingsStore.read();
            const access = Storage.get(KEYS.KEY_ACCESS);

            const keyInput = el('input', {
                type: 'password', autocomplete: 'off',
                placeholder: access ? `Saved (${access}) — paste a new key to replace` : 'Paste your API key (Limited or Full)',
            });
            const numInput = (value) => el('input', { type: 'number', min: '0', step: '1', value: String(value) });
            const threshold = numInput(s.daysThreshold);
            const defDays = numInput(s.defaultDays);
            const defCost = numInput(s.defaultCost);
            const accent = el('input', { type: 'color', value: s.accent });

            const typeBoxes = Object.entries(CONFIG.PROPERTY_TYPES).map(([id, name]) => {
                const box = el('input', { type: 'checkbox', value: id, checked: s.propertyTypes.includes(Number(id)) });
                return { box, label: el('label', {}, [box, ` ${name}`]) };
            });

            const status = el('div', { className: `${P}-status-line` });
            const setStatus = (text, kind) => {
                status.textContent = text;
                status.className = `${P}-status-line${kind ? ` ${P}-${kind}` : ''}`;
            };

            const save = el('button', { type: 'button', className: `${P}-primary`, textContent: 'Save' });
            const removeKey = el('button', { type: 'button', textContent: 'Remove key' });
            const close = el('button', { type: 'button', textContent: 'Close' });

            const panel = el('div', { className: `${P}-panel` }, [
                el('h3', { textContent: 'Rental Manager settings' }),
                el('div', {
                    className: `${P}-hint`,
                    textContent: 'Limited Access key required. A Full Access key also enables prefill from your activity log. '
                        + 'Stored only in Tampermonkey on this browser and sent only to api.torn.com.',
                }),
                el('label', {}, ['API key', keyInput]),
                el('div', { className: `${P}-grid2` }, [
                    el('label', {}, ['Flag when days left ≤', threshold]),
                    el('label', {}, ['Accent color', el('br'), accent]),
                    el('label', {}, ['Default lease days', defDays]),
                    el('label', {}, ['Default lease cost ($)', defCost]),
                ]),
                el('label', {}, ['Property types to manage']),
                el('div', { className: `${P}-types` }, typeBoxes.map((t) => t.label)),
                status,
                el('div', { className: `${P}-row-btns` }, [removeKey, close, save]),
            ]);
            const modal = el('div', { id: IDS.MODAL }, [panel]);

            save.addEventListener('click', async () => {
                save.disabled = true;
                try {
                    SettingsStore.save({
                        daysThreshold: Number(threshold.value),
                        defaultDays: Number(defDays.value),
                        defaultCost: Number(defCost.value),
                        propertyTypes: typeBoxes.filter((t) => t.box.checked).map((t) => Number(t.box.value)),
                        accent: accent.value,
                    });
                    const newKey = keyInput.value.trim();
                    if (newKey) {
                        setStatus('Checking key…');
                        const type = await Settings.validateKey(newKey);
                        Storage.set(KEYS.API_KEY, newKey);
                        Storage.set(KEYS.KEY_ACCESS, type);
                        Cache.clearAll();
                        keyInput.value = '';
                        keyInput.placeholder = `Saved (${type}) — paste a new key to replace`;
                        setStatus(`Saved. Key access: ${type}${Repo.canReadLogs() ? ' — log prefill enabled.' : '.'}`, 'good');
                        Card.load({ force: true });
                    } else {
                        setStatus('Saved.', 'good');
                        Card.render();
                    }
                } catch (err) {
                    setStatus(err.message, 'bad');
                } finally {
                    save.disabled = false;
                }
            });

            removeKey.addEventListener('click', () => {
                Storage.remove(KEYS.API_KEY);
                Storage.remove(KEYS.KEY_ACCESS);
                Cache.clearAll();
                Card.properties = null;
                Card.load();
                setStatus('Key removed.', 'good');
            });

            close.addEventListener('click', () => modal.remove());
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.remove();
            });

            document.body.append(modal);
            if (!access) keyInput.focus();
        },

        /**
         * Validates a key with /key/info. Requires Limited or higher (or Custom).
         * @param {string} key Candidate key.
         * @returns {Promise<string>} Access type label.
         * @throws {ApiError|Error}
         */
        async validateKey(key) {
            const body = await Api.get('/key/info', {}, key);
            const type = body?.info?.access?.type;
            if (!type) throw new Error('Could not read key info.');
            if (type === 'Public Only' || type === 'Minimal Access') {
                throw new Error(`This is a ${type} key — Limited Access or higher is required.`);
            }
            return type;
        },
    };

    // =========================================================================
    //  Page features — prefill forms, happy badge
    // =========================================================================
    const Features = {
        /**
         * Sets a value on every matching input that we haven't filled yet.
         * Marking each input means re-renders get filled once, and your own
         * edits are never overwritten.
         * @param {string} selector Input selector.
         * @param {number} value Value.
         * @returns {boolean} True if at least one input was filled.
         */
        fillOnce(selector, value) {
            let filled = false;
            for (const input of document.querySelectorAll(selector)) {
                if (input.hasAttribute(FILLED_ATTR)) continue;
                input.value = String(value);
                input.setAttribute(FILLED_ATTR, '1');
                filled = true;
            }
            return filled;
        },

        /**
         * Resolves the prefill terms for an extension.
         * @param {string} propertyId Property ID from the route.
         * @param {string|null} renterId Renter from the form.
         * @returns {Promise<Terms>}
         */
        async extensionTerms(propertyId, renterId) {
            const settings = SettingsStore.read();
            let properties = Card.properties;
            if (!properties) {
                try {
                    properties = await Repo.properties();
                } catch (err) {
                    log('Properties unavailable for prefill', err.message);
                }
            }
            const property = properties?.find((p) => String(p.id) === propertyId);
            const renter = renterId ?? (property?.rented_by ? String(property.rented_by.id) : null);

            if (renter && Repo.canReadLogs()) {
                try {
                    const fromLog = Data.termsFromLogs(await Repo.logs(), propertyId, renter);
                    if (fromLog) return { ...fromLog, source: 'log' };
                } catch (err) {
                    log('Log lookup failed', err.code, err.message);
                    if (err.code !== 5) Notice.show(`Log lookup failed: ${err.message} Using lease terms instead.`);
                }
            }
            const fromLease = Data.termsFromLease(property);
            if (fromLease) return { ...fromLease, source: 'lease' };
            return { cost: settings.defaultCost, days: settings.defaultDays, source: 'defaults' };
        },

        /**
         * Offer-extension tab: wait for the form, then prefill once.
         * @param {string} propertyId Property ID.
         * @returns {Promise<void>}
         */
        async prefillExtension(propertyId) {
            const S = CONFIG.SELECTORS;
            const form = await waitFor(() => document.querySelector(S.EXT_COST) && document.querySelector(S.EXT_FORM));
            if (!form || readRoute().id !== propertyId) return;
            const renterId = document.querySelector(S.EXT_RENTER_LINK)?.getAttribute('href')?.match(/XID=(\d+)/)?.[1] ?? null;

            const terms = await Features.extensionTerms(propertyId, renterId);
            if (readRoute().id !== propertyId || readRoute().tab !== CONFIG.TABS.EXTEND) return; // navigated away
            const a = Features.fillOnce(S.EXT_COST, terms.cost);
            const b = Features.fillOnce(S.EXT_DAYS, terms.days);
            if (a || b) {
                document.querySelectorAll(S.EXT_SUBMIT).forEach((btn) => { btn.disabled = false; });
                Card.prefill = terms;
                Card.render();
            }
        },

        /**
         * Lease (list for rent) tab: wait for the visible form, then prefill defaults once.
         * @param {string} propertyId Property ID.
         * @returns {Promise<void>}
         */
        async prefillLease(propertyId) {
            const S = CONFIG.SELECTORS;
            const input = await waitFor(() => {
                const node = document.querySelector(S.LEASE_COST);
                return isVisible(node) ? node : null;
            });
            if (!input || readRoute().id !== propertyId) return;
            const settings = SettingsStore.read();
            const a = Features.fillOnce(S.LEASE_COST, settings.defaultCost);
            const b = Features.fillOnce(S.LEASE_DAYS, settings.defaultDays);
            if (a || b) {
                document.querySelectorAll(S.LEASE_SUBMIT).forEach((btn) => { btn.disabled = false; });
                Card.prefill = { cost: settings.defaultCost, days: settings.defaultDays, source: 'defaults' };
                Card.render();
            }
        },

        /**
         * Shows "Happy: N" in the first empty options slot.
         * @param {string} propertyId Property ID.
         * @returns {Promise<void>}
         */
        async happyBadge(propertyId) {
            const slot = await waitFor(() => document.querySelector(CONFIG.SELECTORS.OPTIONS_EMPTY_SLOT));
            if (!slot || slot.closest('ul')?.querySelector(`.${P}-happy`)) return;
            const property = (Card.properties ?? Cache.get(KEYS.PROPERTIES, Infinity))?.find((p) => String(p.id) === propertyId);
            if (!property || readRoute().id !== propertyId) return;
            slot.classList.remove('empty');
            slot.classList.add(`${P}-happy`);
            slot.querySelector('.p-icon')?.replaceChildren(el('i', { className: 'property-option-info' }));
            const desc = slot.querySelector('.desc');
            if (desc) desc.textContent = `Happy: ${property.happy.toLocaleString('en-US')}`;
        },

        /**
         * After you click Submit on a lease/extension form, refresh data shortly after.
         * Passive listener — it never clicks or submits anything itself.
         * @returns {void}
         */
        watchSubmits() {
            document.addEventListener('click', (e) => {
                const target = e.target instanceof Element ? e.target : null;
                if (!target?.matches(`${CONFIG.SELECTORS.EXT_SUBMIT}, ${CONFIG.SELECTORS.LEASE_SUBMIT}`)) return;
                setTimeout(() => {
                    Storage.remove(KEYS.LOG);
                    Card.load({ force: true });
                }, CONFIG.SUBMIT_CACHE_BUST_DELAY_MS);
            }, true);
        },
    };

    // =========================================================================
    //  Router — runs features for the current hash route
    // =========================================================================
    const Router = {
        /** @type {string|null} Last handled route, to keep the prefill note on re-runs. */
        lastKey: null,

        /**
         * Handles the current route.
         * @returns {void}
         */
        handle() {
            const route = readRoute();
            const key = `${route.p}|${route.id}|${route.tab}`;
            log('Route', route);
            if (key !== Router.lastKey) Card.prefill = null;
            Router.lastKey = key;
            Card.ensure();
            Card.render();
            if (!route.id) return;
            const run = (promise) => promise.catch((err) => {
                console.error(`[${CONFIG.SCRIPT_NAME}]`, err);
                Notice.show('Something went wrong — see console for details.');
            });
            if (route.tab === CONFIG.TABS.EXTEND) run(Features.prefillExtension(route.id));
            else if (route.tab === CONFIG.TABS.LEASE) run(Features.prefillLease(route.id));
            if (route.p === 'options') run(Features.happyBadge(route.id));
        },
    };

    // =========================================================================
    //  Observers — re-insert the card if the page re-renders it away
    // =========================================================================
    const Observers = {
        /**
         * @param {Element} wrap #properties-page-wrap
         * @returns {void}
         */
        watchPage(wrap) {
            const check = throttle(() => {
                if (!document.getElementById(IDS.CARD) && Card.ensure()) Router.handle();
            }, CONFIG.OBSERVER_THROTTLE_MS);
            new MutationObserver(check).observe(wrap, { childList: true, subtree: true });
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
        GM_registerMenuCommand('Rental Manager: Settings', () => Settings.open());
        GM_registerMenuCommand('Rental Manager: Clear cache', () => {
            Cache.clearAll();
            Notice.show('Cache cleared.');
            Card.load({ force: true });
        });

        const wrap = await waitFor(() => document.querySelector(CONFIG.SELECTORS.PAGE_WRAP));
        if (!wrap) {
            log('Properties page wrapper not found.');
            return;
        }

        Observers.watchPage(wrap);
        Features.watchSubmits();
        window.addEventListener('hashchange', () => Router.handle());

        Router.handle();
        if (!Storage.get(KEYS.API_KEY)) Settings.open();
        await Card.load();
        Router.handle(); // re-run with data loaded (happy badge, highlight)
    }

    init().catch((err) => {
        console.error(`[${CONFIG.SCRIPT_NAME}] init failed:`, err);
        Notice.show('Failed to start — see console for details.');
    });
})();
