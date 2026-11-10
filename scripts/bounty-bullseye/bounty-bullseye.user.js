// ==UserScript==
// @name         Bounty Bullseye
// @namespace    torn-userscripts
// @version      1.0.0
// @description  Marks online and idle players in your sidebar Enemies and Targets lists who have an active bounty.
// @author       DadGum [3158823]
// @license      MIT
// @match        https://www.torn.com/*
// @updateURL    https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/bounty-bullseye/bounty-bullseye.user.js
// @downloadURL  https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/bounty-bullseye/bounty-bullseye.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      api.torn.com
// @run-at       document-idle
// ==/UserScript==

/*
 * PURPOSE
 *   Adds a small bullseye next to online or idle players in the sidebar Enemies
 *   and Targets lists when they have an active bounty. Hover it for the details.
 *   Display only: it never clicks or submits anything.
 *
 * API KEY USAGE DISCLOSURE
 *   Data storage:        Key and recent bounty results for players in those lists, locally in Tampermonkey storage.
 *   Data sharing:        None. Requests go only to api.torn.com.
 *   Purpose of use:      Showing which of your enemies and targets currently have bounties.
 *   Key storage/sharing: Stored locally, sent only in the Authorization header to api.torn.com, never logged.
 *   Key access level:    Public.
 *
 * REQUESTS (tagged comment=BountyBullseye)
 *   GET /v2/user/{id}/bounties   Public; only for online or idle players in the two lists, while the lists
 *                                are visible. Each player is rechecked every 10 minutes, at most 6 requests
 *                                per minute, shared across tabs. About 1 call per minute with 10 players online.
 *   GET /v2/key/info             Only when saving a key
 *
 * CHANGELOG
 *   1.0.0  First release.
 */

(() => {
    'use strict';

    // =========================================================================
    // CONFIG
    // =========================================================================

    const CONFIG = Object.freeze({
        DEBUG: false,
        API_BASE: 'https://api.torn.com/v2',
        API_COMMENT: 'BountyBullseye',
        STORAGE_PREFIX: 'tms_bb_',
        STORAGE_KEYS: Object.freeze({
            API_KEY: 'api_key',
            RESULTS: 'results',
            SETTINGS_SHOWN: 'settings_shown',
        }),
        CHECK_TTL_MS: 10 * 60 * 1000,
        RESULT_MAX_AGE_MS: 24 * 60 * 60 * 1000,
        CLAIM_MS: 30 * 1000,
        REQUEST_GAP_MS: 10 * 1000,
        BACKOFF_MS: 60 * 1000,
        RESCAN_MS: 60 * 1000,
        OBSERVER_DEBOUNCE_MS: 250,
        RATE_LIMIT: Object.freeze({ MAX_CALLS: 50, WINDOW_MS: 60 * 1000 }),
        REQUEST_TIMEOUT_MS: 20000,
        // These sidebar sections have stable IDs; Torn's other class names are hashed.
        LIST_IDS: Object.freeze(['nav-enemies_list', 'nav-targets_list']),
        SELECTORS: Object.freeze({
            ROW: 'li',
            PROFILE_LINK: 'a[href*="profiles.php?XID="]',
            ACTIVE_STATUS: '[fill="url(#userStatusOnline)"], [fill="url(#userStatusIdle)"]',
        }),
        KEY_ERROR_CODES: Object.freeze([1, 2, 10, 13, 16, 18, 19]),
        IDS: Object.freeze({ SETTINGS: 'tms-bb-settings', NOTICE: 'tms-bb-notice' }),
        CLASSES: Object.freeze({ ICON: 'tms-bb-icon' }),
        API_ERROR_MESSAGES: Object.freeze({
            0: "Torn's API had an unknown error. Try again shortly.",
            1: 'No API key was sent. Open Settings and enter your key.',
            2: 'Your API key is incorrect. Open Settings and enter it again.',
            3: 'Torn rejected the request type. The script may need an update.',
            4: 'Torn rejected the requested data. The script may need an update.',
            5: "Torn's API rate limit was reached. Retrying in a minute.",
            6: 'Torn rejected a player ID.',
            7: 'This key cannot read that data.',
            8: 'Torn has temporarily blocked this IP address from the API.',
            9: "Torn's API is currently disabled.",
            10: 'The API key owner is in federal jail.',
            11: 'This key was changed too recently. Try again in a moment.',
            12: 'Torn could not read this API key. Try again shortly.',
            13: 'This API key is temporarily disabled.',
            14: 'This key has reached its daily read limit.',
            15: 'Torn returned a temporary error. Try again shortly.',
            16: "This key's access level is too low. Any Public key or higher works.",
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
        if (CONFIG.DEBUG) console.debug('[Bounty Bullseye]', ...args);
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

    // =========================================================================
    // CACHE
    // =========================================================================

    /**
     * @typedef {Object} BountySummary
     * @property {number} reward Reward per bounty.
     * @property {number} quantity Number of bounties in the listing.
     * @property {number} validUntil Expiry time in seconds.
     */

    /**
     * @typedef {Object} PlayerResult
     * @property {number} ts When the player was last checked (ms), or 0 when only claimed.
     * @property {number} [claimedAt] When a tab started checking the player (ms).
     * @property {BountySummary[]} bounties Active bounty listings.
     */

    const Results = {
        /**
         * Reads all saved player results.
         * @returns {Object<string, PlayerResult>} Results by player ID.
         */
        all() {
            const saved = Storage.get(K.RESULTS, {});
            return saved && typeof saved === 'object' ? saved : {};
        },

        /**
         * Reads one player's result.
         * @param {string} id Player ID.
         * @returns {PlayerResult|undefined} Result.
         */
        get(id) {
            return this.all()[id];
        },

        /**
         * Updates one player's result and drops results older than a day.
         * @param {string} id Player ID.
         * @param {Partial<PlayerResult>} value Fields to save.
         * @returns {void}
         */
        update(id, value) {
            const now = Date.now();
            const results = {};
            Object.entries(this.all()).forEach(([key, entry]) => {
                const age = now - Math.max(entry.ts || 0, entry.claimedAt || 0);
                if (age < CONFIG.RESULT_MAX_AGE_MS) results[key] = entry;
            });
            results[id] = { bounties: [], ts: 0, ...results[id], ...value };
            Storage.set(K.RESULTS, results);
        },

        /**
         * Removes all saved results.
         * @returns {void}
         */
        clear() {
            Storage.remove(K.RESULTS);
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
         * @param {string} path Path such as "/user/123/bounties".
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
     * Loads a player's active bounties.
     * @param {string} id Player ID.
     * @returns {Promise<BountySummary[]>} Bounty listings.
     * @throws {ApiRequestError} When the request fails or the format is unexpected.
     */
    async function fetchBounties(id) {
        const data = await api.get(`/user/${encodeURIComponent(id)}/bounties`);
        if (!Array.isArray(data?.bounties)) throw new ApiRequestError('Unexpected bounty format.');
        return summarizeBounties(data.bounties);
    }

    // =========================================================================
    // DATA (no DOM access)
    // =========================================================================

    /**
     * Keeps the bounty fields the script needs.
     * @param {Array<{reward: number, quantity: number, valid_until: number}>} bounties Bounties from the API.
     * @returns {BountySummary[]} Summaries.
     */
    function summarizeBounties(bounties) {
        return bounties
            .filter((bounty) => Number.isFinite(bounty?.reward) && Number.isFinite(bounty?.valid_until))
            .map((bounty) => ({ reward: bounty.reward, quantity: Math.max(1, Number(bounty.quantity) || 1), validUntil: bounty.valid_until }));
    }

    /**
     * Keeps only bounties that have not expired.
     * @param {BountySummary[]} bounties Bounties.
     * @param {number} nowSeconds Current time in seconds.
     * @returns {BountySummary[]} Active bounties.
     */
    function activeBounties(bounties, nowSeconds) {
        return (bounties || []).filter((bounty) => bounty.validUntil > nowSeconds);
    }

    /**
     * Formats a dollar amount with commas.
     * @param {number} value Amount.
     * @returns {string} Formatted amount.
     */
    function formatMoney(value) {
        return `$${Math.round(value).toLocaleString('en-US')}`;
    }

    /**
     * Formats a time span such as "3h 20m".
     * @param {number} seconds Seconds.
     * @returns {string} Formatted span.
     */
    function formatSpan(seconds) {
        const minutes = Math.max(1, Math.round(seconds / 60));
        const days = Math.floor(minutes / 1440);
        const hours = Math.floor((minutes % 1440) / 60);
        const mins = minutes % 60;
        if (days) return `${days}d ${hours}h`;
        if (hours) return `${hours}h ${mins}m`;
        return `${mins}m`;
    }

    /**
     * Describes a player's bounties for the hover text.
     * @param {BountySummary[]} bounties Active bounties.
     * @param {number} nowSeconds Current time in seconds.
     * @returns {string} Description.
     */
    function describeBounties(bounties, nowSeconds) {
        const count = bounties.reduce((total, bounty) => total + bounty.quantity, 0);
        const total = bounties.reduce((sum, bounty) => sum + bounty.reward * bounty.quantity, 0);
        const soonest = Math.min(...bounties.map((bounty) => bounty.validUntil));
        const label = count === 1 ? '1 bounty' : `${count} bounties`;
        return `${formatMoney(total)} · ${label} · soonest expires in ${formatSpan(soonest - nowSeconds)}`;
    }

    /**
     * Checks whether a player needs checking again.
     * @param {PlayerResult|undefined} result Saved result.
     * @param {number} now Current time (ms).
     * @returns {boolean} True when stale and not being checked by another tab.
     */
    function needsCheck(result, now) {
        if (!result) return true;
        if (result.claimedAt && now - result.claimedAt < CONFIG.CLAIM_MS && (result.ts || 0) < result.claimedAt) return false;
        return now - (result.ts || 0) >= CONFIG.CHECK_TTL_MS;
    }

    // =========================================================================
    // UI
    // =========================================================================

    const SVG_NS = 'http://www.w3.org/2000/svg';

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
     * Draws the bullseye icon.
     * @returns {SVGSVGElement} Icon.
     */
    function createBullseyeSvg() {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 12 12');
        svg.setAttribute('width', '11');
        svg.setAttribute('height', '11');
        svg.setAttribute('aria-hidden', 'true');
        [[5.5, '#e53935'], [3.9, '#ffffff'], [2.4, '#e53935'], [1, '#ffffff']].forEach(([radius, fill]) => {
            const circle = document.createElementNS(SVG_NS, 'circle');
            circle.setAttribute('cx', '6');
            circle.setAttribute('cy', '6');
            circle.setAttribute('r', String(radius));
            circle.setAttribute('fill', fill);
            svg.append(circle);
        });
        return svg;
    }

    /**
     * Injects the script's styles.
     * @returns {void}
     */
    function injectStyles() {
        const { SETTINGS, NOTICE } = CONFIG.IDS;
        GM_addStyle(`
            .${CONFIG.CLASSES.ICON} { display: inline-flex; align-items: center; margin-left: 4px; vertical-align: middle; cursor: help; flex-shrink: 0; }
            #${NOTICE} { position: fixed; right: 12px; bottom: 12px; z-index: 99999; display: flex; gap: 8px; align-items: center; max-width: 360px; padding: 8px 10px; border-radius: 6px; background: #2a2a2a; color: #ffb4a8; font: 12px/1.4 Arial, sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
            #${NOTICE} button { padding: 2px 8px; border: 1px solid #555; border-radius: 4px; background: #333; color: #ddd; cursor: pointer; font-size: 11px; }
            #${SETTINGS} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); }
            .tms-bb-panel { box-sizing: border-box; width: 420px; max-width: 94vw; padding: 16px; border-radius: 6px; background: #1b1b1b; color: #e6e6e6; font-size: 13px; line-height: 1.4; }
            .tms-bb-panel h2 { margin: 0 0 8px; font-size: 16px; }
            .tms-bb-panel button { margin: 8px 6px 0 0; padding: 5px 10px; cursor: pointer; }
            .tms-bb-key { box-sizing: border-box; width: 100%; margin: 8px 0; padding: 6px; -webkit-text-security: disc; }
        `);
    }

    /**
     * Shows a small notice in the corner, replacing any earlier one.
     * @param {string} message Message.
     * @param {boolean} [offerSettings=false] Whether to include a Settings button.
     * @returns {void}
     */
    function showNotice(message, offerSettings = false) {
        document.getElementById(CONFIG.IDS.NOTICE)?.remove();
        const notice = createEl('div', { id: CONFIG.IDS.NOTICE, attrs: { role: 'status' } }, [
            createEl('span', { text: `Bounty Bullseye: ${message}` }),
            offerSettings && createEl('button', { text: 'Settings', attrs: { type: 'button' }, onClick: openSettings }),
            createEl('button', { text: '×', attrs: { type: 'button', 'aria-label': 'Dismiss' }, onClick: () => notice.remove() }),
        ]);
        document.body.append(notice);
    }

    /**
     * Removes the corner notice.
     * @returns {void}
     */
    function clearNotice() {
        document.getElementById(CONFIG.IDS.NOTICE)?.remove();
    }

    /**
     * Adds, updates, or removes one row's bullseye.
     * @param {Element} link The player's profile link.
     * @param {string|null} description Hover text, or null to remove the icon.
     * @returns {void}
     */
    function syncIcon(link, description) {
        const existing = link.parentElement?.querySelector(`.${CONFIG.CLASSES.ICON}`);
        if (!description) {
            existing?.remove();
            return;
        }
        if (existing) {
            if (existing.title !== description) {
                existing.title = description;
                existing.setAttribute('aria-label', `Active bounty: ${description}`);
            }
            return;
        }
        const icon = createEl('span', {
            className: CONFIG.CLASSES.ICON,
            attrs: { title: description, role: 'img', 'aria-label': `Active bounty: ${description}` },
        });
        icon.append(createBullseyeSvg());
        link.after(icon);
    }

    /**
     * Tests and saves a key from the Settings panel.
     * @param {HTMLInputElement} input Key field.
     * @param {HTMLElement} status Status element.
     * @returns {Promise<void>} Resolves after the test.
     */
    async function saveKeyFromInput(input, status) {
        const key = input.value.trim();
        if (!key) {
            status.textContent = 'Paste a key first.';
            return;
        }
        status.textContent = 'Checking key...';
        try {
            const data = await api.get('/key/info', {}, key);
            Storage.set(K.API_KEY, key);
            input.value = '';
            input.placeholder = 'Key saved. Paste a new key to replace it.';
            status.textContent = `Key saved (${data?.info?.access?.type || 'access level unknown'}).`;
            clearNotice();
            Checker.resume();
        } catch (error) {
            status.textContent = `Key not saved. ${error.message || error}`;
        }
    }

    /**
     * Opens the Settings panel. The saved key is never placed in the page.
     * @returns {void}
     */
    function openSettings() {
        if (document.getElementById(CONFIG.IDS.SETTINGS)) return;
        const input = createEl('input', {
            className: 'tms-bb-key',
            attrs: {
                type: 'text',
                autocomplete: 'off',
                autocapitalize: 'off',
                spellcheck: 'false',
                'data-lpignore': 'true',
                'data-1p-ignore': 'true',
                'aria-label': 'Torn API key',
                placeholder: getApiKey() ? 'Key saved. Paste a new key to replace it.' : 'Public API key',
            },
        });
        const status = createEl('div', { attrs: { role: 'status' } });
        const close = () => overlay.remove();
        const overlay = createEl('div', { id: CONFIG.IDS.SETTINGS }, [
            createEl('div', { className: 'tms-bb-panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Bounty Bullseye settings' } }, [
                createEl('h2', { text: 'Bounty Bullseye' }),
                createEl('div', { text: 'Any Public key or higher works. The key is stored only in Tampermonkey and sent only to api.torn.com.' }),
                input,
                createEl('button', { text: 'Test and save key', attrs: { type: 'button' }, onClick: () => saveKeyFromInput(input, status) }),
                createEl('button', {
                    text: 'Remove key',
                    attrs: { type: 'button' },
                    onClick: () => {
                        Storage.remove(K.API_KEY);
                        input.placeholder = 'Public API key';
                        status.textContent = 'API key removed.';
                        scheduleScan();
                    },
                }),
                createEl('button', { text: 'Close', attrs: { type: 'button' }, onClick: close }),
                status,
            ]),
        ]);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close();
        });
        document.body.append(overlay);
        input.focus();
    }

    // =========================================================================
    // CHECKER (request queue)
    // =========================================================================

    const Checker = {
        /** @type {string[]} Player IDs waiting to be checked. */
        queue: [],
        running: false,
        lastRequestAt: 0,
        pausedUntil: 0,
        stopped: false,

        /**
         * Adds players to the queue and starts it.
         * @param {string[]} ids Player IDs.
         * @returns {void}
         */
        enqueue(ids) {
            ids.forEach((id) => {
                if (!this.queue.includes(id)) this.queue.push(id);
            });
            this.run();
        },

        /**
         * Allows checks again after a key change.
         * @returns {void}
         */
        resume() {
            this.stopped = false;
            this.pausedUntil = 0;
            scheduleScan();
        },

        /**
         * Works through the queue, one paced request at a time.
         * @returns {Promise<void>} Resolves when the queue is empty or paused.
         */
        async run() {
            if (this.running) return;
            this.running = true;
            try {
                while (this.queue.length && !this.stopped && getApiKey()) {
                    if (document.hidden) break;
                    const wait = Math.max(this.pausedUntil, this.lastRequestAt + CONFIG.REQUEST_GAP_MS) - Date.now();
                    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
                    const id = this.queue.shift();
                    if (!id || !isStillShownActive(id) || !needsCheck(Results.get(id), Date.now())) continue;
                    await this.check(id);
                }
            } finally {
                this.running = false;
            }
        },

        /**
         * Checks one player and redraws the lists.
         * @param {string} id Player ID.
         * @returns {Promise<void>} Resolves when finished.
         */
        async check(id) {
            this.lastRequestAt = Date.now();
            Results.update(id, { claimedAt: Date.now() });
            try {
                const bounties = await fetchBounties(id);
                Results.update(id, { ts: Date.now(), claimedAt: 0, bounties });
                renderLists();
            } catch (error) {
                log('Check failed', error);
                if (error.code === 5) {
                    this.pausedUntil = Date.now() + CONFIG.BACKOFF_MS;
                    this.queue.unshift(id);
                    Results.update(id, { claimedAt: 0 });
                } else if (CONFIG.KEY_ERROR_CODES.includes(error.code)) {
                    this.stopped = true;
                    this.queue = [];
                    Results.update(id, { claimedAt: 0 });
                } else {
                    Results.update(id, { ts: Date.now(), claimedAt: 0 });
                }
                showNotice(error.message || String(error), CONFIG.KEY_ERROR_CODES.includes(error.code));
            }
        },
    };

    // =========================================================================
    // LISTS
    // =========================================================================

    /**
     * Finds the Enemies and Targets list sections that are on screen.
     * @returns {Element[]} Visible sections.
     */
    function visibleSections() {
        return CONFIG.LIST_IDS
            .map((id) => document.getElementById(id))
            .filter((section) => section && section.getClientRects().length > 0);
    }

    /**
     * Reads a row's player ID and whether they are online or idle.
     * @param {Element} row List row.
     * @returns {{id: string, link: Element, active: boolean}|null} Player, or null when not a player row.
     */
    function readPlayerRow(row) {
        const { PROFILE_LINK, ACTIVE_STATUS } = CONFIG.SELECTORS;
        const link = row.querySelector(PROFILE_LINK);
        const id = link?.getAttribute('href')?.match(/XID=(\d+)/)?.[1];
        if (!link || !id) return null;
        return { id, link, active: Boolean(row.querySelector(ACTIVE_STATUS)) };
    }

    /**
     * Lists the player rows on screen in the visible sections; rows in a collapsed list are skipped.
     * @returns {Array<{id: string, link: Element, active: boolean}>} Players.
     */
    function visiblePlayers() {
        return visibleSections()
            .flatMap((section) => [...section.querySelectorAll(CONFIG.SELECTORS.ROW)])
            .filter((row) => row.getClientRects().length > 0)
            .map(readPlayerRow)
            .filter(Boolean);
    }

    /**
     * Checks whether a player is still shown as online or idle in a visible list.
     * @param {string} id Player ID.
     * @returns {boolean} True when still shown and active.
     */
    function isStillShownActive(id) {
        return visiblePlayers().some((player) => player.id === id && player.active);
    }

    /**
     * Draws or removes bullseyes on every row from saved results.
     * @returns {void}
     */
    function renderLists() {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const results = Results.all();
        CONFIG.LIST_IDS
            .map((id) => document.getElementById(id))
            .filter(Boolean)
            .flatMap((section) => [...section.querySelectorAll(CONFIG.SELECTORS.ROW)])
            .forEach((row) => {
                const player = readPlayerRow(row);
                if (!player) return;
                const bounties = player.active ? activeBounties(results[player.id]?.bounties, nowSeconds) : [];
                syncIcon(player.link, bounties.length ? describeBounties(bounties, nowSeconds) : null);
            });
    }

    /**
     * Redraws the lists and queues any online or idle players that need checking.
     * @returns {void}
     */
    function scan() {
        renderLists();
        if (!getApiKey() || document.hidden) return;
        const now = Date.now();
        const results = Results.all();
        const due = visiblePlayers()
            .filter((player) => player.active && needsCheck(results[player.id], now))
            .map((player) => player.id);
        if (due.length) Checker.enqueue([...new Set(due)]);
    }

    // =========================================================================
    // OBSERVERS
    // =========================================================================

    let scanTimer = 0;

    /**
     * Schedules one scan after page changes settle.
     * @returns {void}
     */
    function scheduleScan() {
        clearTimeout(scanTimer);
        scanTimer = setTimeout(scan, CONFIG.OBSERVER_DEBOUNCE_MS);
    }

    /**
     * Checks whether a page change touches one of the two lists, ignoring the script's own icons.
     * @param {MutationRecord} mutation Page change.
     * @returns {boolean} True when the lists should be rescanned.
     */
    function isListMutation(mutation) {
        const isIcon = (node) => node.nodeType === Node.ELEMENT_NODE && node.classList.contains(CONFIG.CLASSES.ICON);
        const changed = [...mutation.addedNodes, ...mutation.removedNodes];
        if (changed.length && changed.every(isIcon)) return false;
        const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
        if (target?.closest(`.${CONFIG.CLASSES.ICON}`)) return false;
        const sections = CONFIG.LIST_IDS.map((id) => `#${id}`).join(', ');
        return Boolean(target?.closest(sections))
            || [...mutation.addedNodes].some((node) => node.nodeType === Node.ELEMENT_NODE && (node.matches(sections) || node.querySelector(sections)));
    }

    const listObserver = new MutationObserver((mutations) => {
        if (mutations.some(isListMutation)) scheduleScan();
    });

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
            GM_registerMenuCommand('Clear cache', () => {
                Results.clear();
                scheduleScan();
            });
            listObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['fill', 'class', 'href'] });
            const timer = setInterval(() => {
                if (!document.hidden) scan();
            }, CONFIG.RESCAN_MS);
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) scheduleScan();
            });
            window.addEventListener('pagehide', () => {
                listObserver.disconnect();
                clearInterval(timer);
            }, { once: true });

            scan();
            if (!getApiKey() && !Storage.get(K.SETTINGS_SHOWN, false)) {
                Storage.set(K.SETTINGS_SHOWN, true);
                openSettings();
            }
        } catch (error) {
            console.error('[Bounty Bullseye] Failed to start.', error);
        }
    }

    init();
})();
