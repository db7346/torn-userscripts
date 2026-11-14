// ==UserScript==
// @name         Needles to Top
// @namespace    dadgum.torn.needles-to-top
// @version      2.0.0
// @description  Sorts chosen items (Tyrosine, Melatonin, Epinephrine, Serotonin by default) to the top of your Temporary items, in the order you set.
// @author       Elaine [2047176] (rewrite by DadGum [3158823])
// @license      MIT
// @match        https://www.torn.com/item.php*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/needles-to-top/needles-to-top.user.js
// @downloadURL  https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/needles-to-top/needles-to-top.user.js
// ==/UserScript==

/*
 * PURPOSE
 *   On your Items page, moves the Temporary items you choose to the top of the Temporary tab, in
 *   the order you set; everything else follows in Torn's own order. Pick and order the items in
 *   Settings (Tampermonkey menu). It only reorders rows on your own page: no clicks, no requests.
 *
 * CREDITS AND LICENSE
 *   Based on "Needles to top!" 1.8 by Elaine [2047176], released under the MIT License.
 *
 * API KEY USAGE DISCLOSURE
 *   This script uses no API key and makes no network requests. It stores only your list of top
 *   items, locally in Tampermonkey storage.
 *
 * CHANGELOG
 *   2.0.0  Rewrite. One ordered list, editable in a Settings panel. Matches items by ID. Sorts
 *          straight away (no half-second jump) and only when rows are added or removed, not when
 *          you open an item. Waits for the Temporary tab instead of polling every second. Fixed
 *          the @run-at line. No console logging unless debugging is on.
 *   1.8    Original by Elaine.
 */

(() => {
    'use strict';

    // =========================================================================
    // CONFIG
    // =========================================================================

    const CONFIG = Object.freeze({
        DEBUG: false,
        SCRIPT_NAME: 'Needles to Top',
        STORAGE_PREFIX: 'tms_ntt_',
        STORAGE_KEYS: Object.freeze({ TOP_ITEMS: 'top_items' }),
        /** Default order, the same one 1.8 produced. IDs are Torn item IDs. */
        DEFAULT_TOP: Object.freeze([
            Object.freeze({ id: 814, name: 'Tyrosine' }),
            Object.freeze({ id: 464, name: 'Melatonin' }),
            Object.freeze({ id: 463, name: 'Epinephrine' }),
            Object.freeze({ id: 465, name: 'Serotonin' }),
        ]),
        SELECTORS: Object.freeze({
            /** Torn's Temporary tab list (stable ID). */
            LIST_ID: 'temporary-items',
            /** Item rows carry the item ID and name as data attributes. */
            ROW_ID_ATTR: 'data-item',
            ROW_NAME_ATTR: 'data-sort',
        }),
        IDS: Object.freeze({ SETTINGS: 'tms-ntt-settings' }),
    });

    const S = CONFIG.SELECTORS;

    /**
     * Writes a debug message when debugging is enabled.
     * @param {...*} args Values to log.
     * @returns {void}
     */
    function log(...args) {
        if (CONFIG.DEBUG) console.debug('[NTT]', ...args);
    }

    // =========================================================================
    // STORAGE
    // =========================================================================

    /** @typedef {{id: number, name: string}} TopItem */

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
    };

    /**
     * Reads the top items list, falling back to the default when nothing valid is saved.
     * @returns {TopItem[]} Items in display order.
     */
    function getTopItems() {
        const saved = Storage.get(CONFIG.STORAGE_KEYS.TOP_ITEMS, null);
        const list = Array.isArray(saved) ? normalizeTopItems(saved) : null;
        return list ?? CONFIG.DEFAULT_TOP.map((item) => ({ ...item }));
    }

    /**
     * Saves the top items list.
     * @param {TopItem[]} items Items in display order.
     * @returns {void}
     */
    function setTopItems(items) {
        Storage.set(CONFIG.STORAGE_KEYS.TOP_ITEMS, normalizeTopItems(items));
    }

    // =========================================================================
    // CACHE / API
    // =========================================================================

    /*
     * None: the script reads only the page and makes no requests.
     */

    // =========================================================================
    // DATA (no DOM access)
    // =========================================================================

    /**
     * Cleans a top items list: valid IDs only, no duplicates, names as text.
     * @param {Array<*>} items Raw list.
     * @returns {TopItem[]} Clean list.
     */
    function normalizeTopItems(items) {
        const seen = new Set();
        return items.flatMap((item) => {
            const id = Number(item?.id);
            if (!Number.isInteger(id) || id <= 0 || seen.has(id)) return [];
            seen.add(id);
            return [{ id, name: String(item?.name || `Item ${id}`) }];
        });
    }

    /**
     * The order rows should be shown in: top items first in list order, then everything else in its
     * current order. Rows with the same item ID keep their current order between them.
     * @param {number[]} rowIds Item ID of each row, in current page order.
     * @param {number[]} topIds Top item IDs in display order.
     * @returns {number[]} Row indexes in the order to show them.
     */
    function sortedOrder(rowIds, topIds) {
        const rank = new Map(topIds.map((id, index) => [id, index]));
        return rowIds
            .map((id, index) => ({ index, rank: rank.has(id) ? rank.get(id) : Infinity }))
            .sort((a, b) => a.rank - b.rank || a.index - b.index)
            .map(({ index }) => index);
    }

    /**
     * Whether an order is the identity (nothing to move).
     * @param {number[]} order Row indexes.
     * @returns {boolean} True when every row is already in place.
     */
    function isInPlace(order) {
        return order.every((value, index) => value === index);
    }

    /**
     * Moves an entry up or down in a list.
     * @param {TopItem[]} items List.
     * @param {number} index Entry to move.
     * @param {-1|1} step -1 for up, 1 for down.
     * @returns {TopItem[]} New list (unchanged copy when the move is impossible).
     */
    function moveEntry(items, index, step) {
        const next = items.slice();
        const target = index + step;
        if (index < 0 || target < 0 || target >= next.length) return next;
        [next[index], next[target]] = [next[target], next[index]];
        return next;
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
     * Injects the Settings panel styles (all scoped to its ID).
     * @returns {void}
     */
    function injectStyles() {
        const id = CONFIG.IDS.SETTINGS;
        GM_addStyle(`
            #${id} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); }
            #${id} .tms-ntt-dialog { box-sizing: border-box; width: 380px; max-width: 94vw; max-height: 90vh; overflow: auto; padding: 16px; border-radius: 6px; background: #1b1b1b; color: #e6e6e6; font: 13px/1.4 Arial, sans-serif; }
            #${id} h2 { margin: 0 0 6px; font-size: 16px; }
            #${id} .tms-ntt-hint { margin-bottom: 10px; color: #aaa; }
            #${id} ol { margin: 0 0 12px; padding: 0; list-style: none; }
            #${id} li { display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid #2c2c2c; }
            #${id} li .tms-ntt-pos { width: 18px; color: #888; text-align: right; }
            #${id} li .tms-ntt-name { flex: 1; }
            #${id} li button { padding: 1px 7px; cursor: pointer; }
            #${id} li button:disabled { opacity: 0.35; cursor: default; }
            #${id} .tms-ntt-add { display: flex; gap: 6px; margin-bottom: 12px; }
            #${id} .tms-ntt-add select { flex: 1; padding: 3px; }
            #${id} .tms-ntt-footer button { margin: 0 6px 0 0; padding: 5px 10px; cursor: pointer; }
            #${id} .tms-ntt-empty { padding: 6px 0; color: #aaa; }
        `);
    }

    /**
     * Items currently in the Temporary tab, one entry per item ID, in page order.
     * @returns {TopItem[]} Items, or an empty list when the tab isn't loaded.
     */
    function itemsOnPage() {
        const list = document.getElementById(S.LIST_ID);
        const seen = new Set();
        return itemRows(list).flatMap((row) => {
            const id = Number(row.getAttribute(S.ROW_ID_ATTR));
            if (!Number.isInteger(id) || seen.has(id)) return [];
            seen.add(id);
            return [{ id, name: String(row.getAttribute(S.ROW_NAME_ATTR) || `Item ${id}`).trim() }];
        });
    }

    /**
     * Opens Settings: the top items in order with move and remove buttons, an Add list from the
     * Temporary tab, and Reset to default. Every change is saved and applied at once.
     * @returns {void}
     */
    function openSettings() {
        if (!document.body || document.getElementById(CONFIG.IDS.SETTINGS)) return;
        const listEl = createEl('ol', { attrs: { 'aria-label': 'Top items in order' } });
        const select = createEl('select', { attrs: { 'aria-label': 'Item to add' } });
        const addButton = createEl('button', { text: 'Add', attrs: { type: 'button' } });

        /**
         * Saves a new list and redraws the panel and the page.
         * @param {TopItem[]} items New list.
         * @returns {void}
         */
        const update = (items) => {
            setTopItems(items);
            draw();
            Sorter.sortNow();
        };

        /**
         * Redraws the list and the Add choices from storage and the page.
         * @returns {void}
         */
        const draw = () => {
            const items = getTopItems();
            listEl.replaceChildren(...(items.length ? items.map((item, index) => createEl('li', {}, [
                createEl('span', { className: 'tms-ntt-pos', text: `${index + 1}.` }),
                createEl('span', { className: 'tms-ntt-name', text: item.name }),
                rowButton('↑', `Move ${item.name} up`, index === 0, () => update(moveEntry(getTopItems(), index, -1))),
                rowButton('↓', `Move ${item.name} down`, index === items.length - 1, () => update(moveEntry(getTopItems(), index, 1))),
                rowButton('✕', `Remove ${item.name}`, false, () => update(getTopItems().filter((_, i) => i !== index))),
            ])) : [createEl('li', { className: 'tms-ntt-empty', text: 'No top items. Add some below.' })]));
            const chosen = new Set(items.map((item) => item.id));
            const choices = itemsOnPage().filter((item) => !chosen.has(item.id));
            select.replaceChildren(...(choices.length
                ? choices.map((item) => createEl('option', { text: item.name, attrs: { value: String(item.id) } }))
                : [createEl('option', { text: document.getElementById(S.LIST_ID) ? 'Every Temporary item is already added' : 'Open the Temporary tab to add items', attrs: { value: '' } })]));
            select.disabled = !choices.length;
            addButton.disabled = !choices.length;
        };

        addButton.addEventListener('click', () => {
            const id = Number(select.value);
            const item = itemsOnPage().find((entry) => entry.id === id);
            if (item) update([...getTopItems(), item]);
        });

        const close = () => overlay.remove();
        const overlay = createEl('div', { id: CONFIG.IDS.SETTINGS }, [
            createEl('div', { className: 'tms-ntt-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': `${CONFIG.SCRIPT_NAME} settings` } }, [
                createEl('h2', { text: CONFIG.SCRIPT_NAME }),
                createEl('div', { className: 'tms-ntt-hint', text: 'These Temporary items are shown first, in this order. Everything else follows in Torn\'s order.' }),
                listEl,
                createEl('div', { className: 'tms-ntt-add' }, [select, addButton]),
                createEl('div', { className: 'tms-ntt-footer' }, [
                    createEl('button', { text: 'Reset to default', attrs: { type: 'button' }, onClick: () => update(CONFIG.DEFAULT_TOP.map((item) => ({ ...item }))) }),
                    createEl('button', { text: 'Close', attrs: { type: 'button' }, onClick: close }),
                ]),
            ]),
        ]);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close();
        });
        overlay.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') close();
        });
        draw();
        document.body.append(overlay);
        overlay.querySelector('button')?.focus();
    }

    /**
     * Builds one small button for a row in Settings.
     * @param {string} text Label.
     * @param {string} label Accessible name.
     * @param {boolean} disabled Whether it is disabled.
     * @param {function(): void} onClick Click handler.
     * @returns {HTMLButtonElement} Button.
     */
    function rowButton(text, label, disabled, onClick) {
        const button = createEl('button', { text, title: label, attrs: { type: 'button', 'aria-label': label }, onClick });
        button.disabled = disabled;
        return button;
    }

    // =========================================================================
    // OBSERVERS
    // =========================================================================

    /**
     * The item rows directly inside a list.
     * @param {?Element} list Temporary list.
     * @returns {HTMLLIElement[]} Rows, in page order.
     */
    function itemRows(list) {
        if (!list) return [];
        return [...list.children].filter((child) => child.tagName === 'LI' && child.hasAttribute(S.ROW_ID_ATTR));
    }

    const Sorter = {
        /** @type {?Element} */
        list: null,
        /** @type {?MutationObserver} */
        observer: null,

        /**
         * Sorts the Temporary list if it isn't in order. Rows stay together where they were in the
         * list; anything else in it keeps its place. The script's own moves are then discarded from
         * the observer so they don't trigger another pass.
         * @returns {void}
         */
        sortNow() {
            const list = this.list;
            const rows = itemRows(list);
            if (rows.length < 2) return;
            const order = sortedOrder(rows.map((row) => Number(row.getAttribute(S.ROW_ID_ATTR))), getTopItems().map((item) => item.id));
            if (isInPlace(order)) return;
            const after = rows[rows.length - 1].nextSibling;
            order.forEach((index) => list.insertBefore(rows[index], after));
            this.observer?.takeRecords();
            log('Sorted', rows.length, 'rows');
        },

        /**
         * Starts watching a Temporary list for rows being added or removed (not changes inside rows).
         * @param {Element} list Temporary list.
         * @returns {void}
         */
        attach(list) {
            if (this.list === list) return;
            this.observer?.disconnect();
            this.list = list;
            this.observer = new MutationObserver(() => {
                try {
                    this.sortNow();
                } catch (error) {
                    console.error('[NTT] Sort failed:', error);
                }
            });
            this.observer.observe(list, { childList: true });
            this.sortNow();
        },

        /**
         * Watches the page for the Temporary list appearing or being replaced (tab switches).
         * @returns {void}
         */
        watchPage() {
            const check = () => {
                const list = document.getElementById(S.LIST_ID);
                if (list && list !== this.list) this.attach(list);
            };
            new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
            check();
        },
    };

    // =========================================================================
    // INIT
    // =========================================================================

    /**
     * Entry point.
     * @returns {void}
     */
    function init() {
        try {
            injectStyles();
            GM_registerMenuCommand('Settings', () => openSettings());
            Sorter.watchPage();
        } catch (error) {
            console.error('[NTT] Could not start:', error);
        }
    }

    init();
})();
