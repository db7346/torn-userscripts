// ==UserScript==
// @name         Torn Market Buy Confirm
// @namespace    dadgum.torn.market-buy-confirm
// @version      1.0.0
// @description  On the item market, moves Torn's own "Yes" confirm button to where "Buy" was, with a short guard against accidental double-clicks.
// @author       DadGum [3158823]
// @license      MIT
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @grant        GM_addStyle
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/market-buy-confirm/market-buy-confirm.user.js
// @downloadURL  https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/market-buy-confirm/market-buy-confirm.user.js
// ==/UserScript==

/*
 * PURPOSE
 *   When you press Buy on an item market listing, Torn replaces the row with
 *   "Buy 1x Item for $X?  Yes  No  ✕". This script moves Torn's own Yes button onto the spot
 *   where Buy was, so buying takes two clicks in the same place. For 0.4 seconds after Yes
 *   appears it ignores clicks, so a double-click on Buy can't confirm by accident.
 *
 *   It never clicks, submits or copies anything: you click Torn's real Yes button yourself, so a
 *   purchase still takes two clicks of yours. No, ✕ and the confirm text stay where Torn puts
 *   them. If anything doesn't match what the script expects, Torn's confirm is left untouched.
 *
 * API KEY USAGE DISCLOSURE
 *   This script uses no API key, makes no network requests and stores nothing.
 *
 * CHANGELOG
 *   1.0.0  First version.
 */

(() => {
    'use strict';

    // =========================================================================
    // CONFIG
    // =========================================================================

    const CONFIG = Object.freeze({
        DEBUG: false,
        /** Clicks on the moved Yes are ignored for this long after it appears (double-click guard). */
        GUARD_MS: 400,
        /** Space kept between the moved Yes and Torn's ✕ close button, in pixels. */
        CLOSE_GAP_PX: 4,
        /** A Buy press older than this is not matched to a confirm that appears later. */
        PRESS_MAX_AGE_MS: 10000,
        /** Confirm text must start with this word (the item market's buy confirm). */
        CONFIRM_PREFIX: 'Buy',
        CONFIRM_YES_TEXT: 'Yes',
        RESIZE_THROTTLE_MS: 100,
        /**
         * Torn's class names end in a random hash, so these match on the readable part.
         * Taken from the item market's seller rows and buy confirm (November 2026).
         */
        SELECTORS: Object.freeze({
            ROW: '[class*="sellerRow"]',
            BUY_BUTTON: 'button[class*="buyButton"]',
            AMOUNT_INPUT: 'input[class*="input-money"]',
            CONFIRM: '[class*="confirmWrapper"]',
            CONFIRM_TEXT: '[class*="confirmText"]',
            CONFIRM_BUTTON: 'button[class*="confirmButton"]',
            CLOSE_BUTTON: 'button[class*="closeButton"]',
        }),
        CLASSES: Object.freeze({ MOVED: 'tms-mbc-moved', GUARDED: 'tms-mbc-guarded' }),
    });

    const S = CONFIG.SELECTORS;
    const C = CONFIG.CLASSES;

    /**
     * Writes a debug message when debugging is enabled.
     * @param {...*} args Values to log.
     * @returns {void}
     */
    function log(...args) {
        if (CONFIG.DEBUG) console.debug('[MBC]', ...args);
    }

    // =========================================================================
    // STORAGE / CACHE / API
    // =========================================================================

    /*
     * None: the script keeps only the last Buy press in memory and makes no requests.
     */

    // =========================================================================
    // DATA (no DOM access)
    // =========================================================================

    /**
     * @typedef {Object} Box A rectangle in page coordinates (CSS pixels, scroll included).
     * @property {number} left
     * @property {number} top
     * @property {number} width
     * @property {number} height
     */

    /**
     * Where the moved Yes should go: left edges lined up with Buy, centred on Buy's height, and
     * pulled left if needed so it stops CLOSE_GAP_PX short of the ✕ button.
     * @param {Box} buy Buy button's box when it was pressed.
     * @param {Box} yes Yes button's current box.
     * @param {?Box} close ✕ button's box, or null when there is none.
     * @returns {{dx: number, dy: number}} Shift to apply to Yes, in pixels.
     */
    function placement(buy, yes, close) {
        let left = buy.left;
        if (close) left = Math.min(left, close.left - CONFIG.CLOSE_GAP_PX - yes.width);
        const top = buy.top + buy.height / 2 - yes.height / 2;
        return { dx: Math.round(left - yes.left), dy: Math.round(top - yes.top) };
    }

    /**
     * Whether a confirm text is the item market's buy confirm ("Buy 1x Kabuki Mask for $11,888?").
     * @param {string} text Confirm text.
     * @returns {boolean} True for a buy confirm.
     */
    function isBuyConfirm(text) {
        return String(text || '').trim().startsWith(CONFIG.CONFIRM_PREFIX);
    }

    // =========================================================================
    // UI
    // =========================================================================

    /**
     * Injects the script's styles. The shift uses transform, so Yes keeps its place in Torn's layout
     * (No doesn't move) and only its drawn and clickable position changes.
     * @returns {void}
     */
    function injectStyles() {
        GM_addStyle(`
            .${C.MOVED} { position: relative; z-index: 2; transform: translate(var(--tms-mbc-dx, 0px), var(--tms-mbc-dy, 0px)); }
            .${C.GUARDED} { opacity: 0.55; cursor: wait; }
        `);
    }

    /**
     * An element's box in page coordinates.
     * @param {Element} element Element.
     * @returns {Box} Box.
     */
    function pageBox(element) {
        const rect = element.getBoundingClientRect();
        return { left: rect.left + window.scrollX, top: rect.top + window.scrollY, width: rect.width, height: rect.height };
    }

    /**
     * Finds Torn's Yes button in a confirm bar.
     * @param {Element} confirm Confirm bar.
     * @returns {?HTMLButtonElement} Yes, or null.
     */
    function findYes(confirm) {
        return [...confirm.querySelectorAll(S.CONFIRM_BUTTON)]
            .find((button) => button.textContent.trim() === CONFIG.CONFIRM_YES_TEXT) || null;
    }

    /**
     * Moves Yes onto the remembered Buy spot. Measures Yes in its own place first (shift cleared),
     * so it can be called again after a resize.
     * @param {HTMLButtonElement} yes Torn's Yes button.
     * @param {Box} buy Buy's box.
     * @param {Element} confirm Confirm bar.
     * @returns {void}
     */
    function moveYes(yes, buy, confirm) {
        yes.style.removeProperty('--tms-mbc-dx');
        yes.style.removeProperty('--tms-mbc-dy');
        const close = confirm.querySelector(S.CLOSE_BUTTON);
        const { dx, dy } = placement(buy, pageBox(yes), close ? pageBox(close) : null);
        yes.style.setProperty('--tms-mbc-dx', `${dx}px`);
        yes.style.setProperty('--tms-mbc-dy', `${dy}px`);
        yes.classList.add(C.MOVED);
        log('Moved Yes by', dx, dy);
    }

    // =========================================================================
    // OBSERVERS
    // =========================================================================

    /** The last Buy press: where Buy was, and the row it was in. */
    const Press = {
        /** @type {?{buy: Box, row: ?Element, offset: ?{left: number, top: number}, at: number}} */
        last: null,

        /**
         * Remembers where a Buy button is. Only watches; the press itself is untouched.
         * @param {HTMLButtonElement} button Buy button.
         * @returns {void}
         */
        remember(button) {
            const buy = pageBox(button);
            const row = button.closest(S.ROW);
            const rowBox = row ? pageBox(row) : null;
            this.last = {
                buy,
                row,
                offset: rowBox ? { left: buy.left - rowBox.left, top: buy.top - rowBox.top } : null,
                at: Date.now(),
            };
        },

        /**
         * Buy's box now: re-measured from its row if the row is still on the page (handles resizing),
         * otherwise as it was when pressed.
         * @returns {?Box} Box, or null when there is no recent press.
         */
        currentBuy() {
            const press = this.last;
            if (!press || Date.now() - press.at > CONFIG.PRESS_MAX_AGE_MS) return null;
            if (press.row?.isConnected && press.offset) {
                const rowBox = pageBox(press.row);
                return { ...press.buy, left: rowBox.left + press.offset.left, top: rowBox.top + press.offset.top };
            }
            return press.buy;
        },
    };

    /** Confirm bars handled so far, with their Yes button and when it became clickable. */
    const handled = new WeakMap();

    /**
     * Moves Yes in a newly shown buy confirm, and starts the double-click guard.
     * Leaves the confirm untouched when it isn't a buy confirm or there is no recent Buy press.
     * @param {Element} confirm Confirm bar.
     * @returns {void}
     */
    function handleConfirm(confirm) {
        if (handled.has(confirm)) return;
        if (!isBuyConfirm(confirm.querySelector(S.CONFIRM_TEXT)?.textContent)) return;
        const buy = Press.currentBuy();
        const yes = findYes(confirm);
        if (!buy || !yes) return;
        handled.set(confirm, { yes, readyAt: Date.now() + CONFIG.GUARD_MS });
        moveYes(yes, buy, confirm);
        yes.classList.add(C.GUARDED);
        setTimeout(() => yes.classList.remove(C.GUARDED), CONFIG.GUARD_MS);
    }

    /**
     * Blocks clicks on a moved Yes during its guard time. Runs in the capture phase on window, so
     * Torn never receives the click. Blocking is the only thing it ever does to a click.
     * @param {MouseEvent} event Click.
     * @returns {void}
     */
    function guardClick(event) {
        const confirm = event.target?.closest?.(S.CONFIRM);
        const entry = confirm && handled.get(confirm);
        if (!entry || !entry.yes.contains(event.target) || Date.now() >= entry.readyAt) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        log('Ignored a click on Yes during the guard');
    }

    /**
     * Remembers Buy's spot when it is clicked, or when Enter is pressed in a row's amount box.
     * @param {Event} event Click or keydown.
     * @returns {void}
     */
    function watchBuyPress(event) {
        const target = event.target;
        if (event.type === 'click') {
            const button = target?.closest?.(S.BUY_BUTTON);
            if (button) Press.remember(button);
            return;
        }
        if (event.key === 'Enter' && target?.matches?.(S.AMOUNT_INPUT)) {
            const button = target.closest(S.ROW)?.querySelector(S.BUY_BUTTON);
            if (button) Press.remember(button);
        }
    }

    /**
     * Calls a function at most once per interval, with one trailing call.
     * @param {function(): void} fn Function.
     * @param {number} ms Interval.
     * @returns {function(): void} Throttled function.
     */
    function throttle(fn, ms) {
        let timer = null;
        return () => {
            if (timer) return;
            timer = setTimeout(() => {
                timer = null;
                fn();
            }, ms);
        };
    }

    /**
     * Re-places any open moved Yes after the window is resized.
     * @returns {void}
     */
    function replaceOpenConfirms() {
        const buy = Press.currentBuy();
        if (!buy) return;
        document.querySelectorAll(S.CONFIRM).forEach((confirm) => {
            const entry = handled.get(confirm);
            if (entry?.yes.isConnected) moveYes(entry.yes, buy, confirm);
        });
    }

    /**
     * Watches for confirm bars as Torn adds them.
     * @returns {void}
     */
    function watchConfirms() {
        new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    if (node.matches(S.CONFIRM)) handleConfirm(node);
                    else node.querySelectorAll?.(S.CONFIRM).forEach(handleConfirm);
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
    }

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
            window.addEventListener('click', guardClick, true);
            document.addEventListener('click', watchBuyPress, true);
            document.addEventListener('keydown', watchBuyPress, true);
            window.addEventListener('resize', throttle(replaceOpenConfirms, CONFIG.RESIZE_THROTTLE_MS));
            watchConfirms();
            document.querySelectorAll(S.CONFIRM).forEach(handleConfirm);
        } catch (error) {
            console.error('[MBC] Could not start:', error);
        }
    }

    init();
})();
