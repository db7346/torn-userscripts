// ==UserScript==
// @name         Clean Player Names
// @namespace    http://tampermonkey.net/
// @version      3.0.0
// @description  Replaces Torn's pixel honor bar names with a larger, more legible font, while maintaining color outlines for staff roles and those that opt to display blue name.
// @author       DadGum [3158823]
// @license      MIT
// @match        https://www.torn.com/*
// @updateURL    https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/clean-player-names/clean-player-names.user.js
// @downloadURL  https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/clean-player-names/clean-player-names.user.js
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

/*
 * PURPOSE
 *   Draws player names over honor bars in a more legible font. Display only:
 *   it never clicks or submits anything.
 *
 * API KEY USAGE DISCLOSURE
 *   Data storage:        None.
 *   Data sharing:        None by this script. The Manrope font loads from Google Fonts on Torn pages.
 *   Purpose of use:      Making player names easier to read.
 *   Key storage/sharing: Not applicable. No API key is requested or stored.
 *   Key access level:    Not applicable. The Torn API is not used.
 *
 * TEMPLATE NOTE
 *   The Storage, Cache, and API modules are omitted because this script uses none of them.
 *
 * CHANGELOG
 *   3.0.0  Renamed from Torn: More Legible Player Names.
 *          Names and outlines now update when Torn reuses a name bar.
 *          Reads the name from Torn's name element, so other scripts' text cannot be picked up.
 *          Debounced page monitoring, prefixed class names, and restructured the script.
 *          Updates now come from GitHub.
 *   2.4    Previous release.
 */

(() => {
    'use strict';

    // =========================================================================
    // CONFIG
    // =========================================================================

    const CONFIG = Object.freeze({
        FONT_URL: 'https://fonts.googleapis.com/css2?family=Manrope:wght@700&display=swap',
        OBSERVER_DEBOUNCE_MS: 100,
        OUTLINE_PROPERTY: '--tms-lpn-outline',
        DEFAULT_OUTLINE: '#000',
        // Checked in order; the first class a name bar has decides its outline.
        ROLE_OUTLINES: Object.freeze([
            Object.freeze({ className: 'admin', color: '#ff4d4d' }),
            Object.freeze({ className: 'officer', color: '#3B9932' }),
            Object.freeze({ className: 'moderator', color: '#ff9c40' }),
            Object.freeze({ className: 'helper', color: '#c080ff' }),
            Object.freeze({ className: 'blue', color: '#310AF5' }),
        ]),
        CLASSES: Object.freeze({ TEXT: 'tms-lpn-text' }),
        SELECTORS: Object.freeze({
            WRAP: '.honor-text-wrap',
            SPRITE: '.honor-text-svg',
            NAME: '.honor-text:not(.honor-text-svg)',
            IMAGE: 'img[alt]',
        }),
        OBSERVED_ATTRIBUTES: Object.freeze(['alt', 'aria-label', 'class', 'data-title']),
    });

    // =========================================================================
    // DATA (no DOM access)
    // =========================================================================

    /**
     * Picks the outline color for a name bar's classes.
     * @param {string[]} classNames Classes on the name bar.
     * @returns {string} CSS color.
     */
    function getOutlineColor(classNames) {
        const role = CONFIG.ROLE_OUTLINES.find(({ className }) => classNames.includes(className));
        return role ? role.color : CONFIG.DEFAULT_OUTLINE;
    }

    /**
     * Returns the first usable name from a list of candidates.
     * @param {Array<string|null|undefined>} candidates Possible names, best first.
     * @returns {string} Trimmed name, or an empty string.
     */
    function firstName(candidates) {
        return candidates.map((value) => String(value ?? '').trim()).find(Boolean) || '';
    }

    // =========================================================================
    // UI
    // =========================================================================

    /**
     * Injects the font and the script's styles.
     * @returns {void}
     */
    function injectStyles() {
        const font = document.createElement('link');
        font.href = CONFIG.FONT_URL;
        font.rel = 'stylesheet';
        document.head.append(font);

        const { TEXT } = CONFIG.CLASSES;
        const outline = `var(${CONFIG.OUTLINE_PROPERTY})`;
        GM_addStyle(`
            .${TEXT} {
                font-family: 'Manrope', sans-serif !important;
                font-weight: 700 !important;
                font-size: 12px !important;
                color: white !important;
                text-transform: uppercase !important;
                letter-spacing: 0.5px !important;
                pointer-events: none !important;
                position: absolute !important;
                top: 50%;
                left: 0;
                transform: translateY(-50%);
                width: 100% !important;
                height: auto;
                display: flex !important;
                align-items: center;
                justify-content: center;
                text-align: center !important;
                line-height: 1 !important;
                margin: 0 !important;
                padding: 0 !important;
                z-index: 10 !important;
                text-shadow:
                    -1px -1px 0 ${outline},
                     1px -1px 0 ${outline},
                    -1px  1px 0 ${outline},
                     1px  1px 0 ${outline} !important;
            }

            ${CONFIG.SELECTORS.SPRITE} {
                display: none !important;
            }
        `);
    }

    /**
     * Reads a player's name from a name bar.
     * @param {Element} wrap Name bar.
     * @returns {string} Player name, or an empty string.
     */
    function readPlayerName(wrap) {
        const { NAME, IMAGE } = CONFIG.SELECTORS;
        return firstName([
            wrap.querySelector(NAME)?.textContent,
            wrap.querySelector(IMAGE)?.getAttribute('alt'),
            wrap.getAttribute('data-title'),
            wrap.getAttribute('aria-label'),
        ]);
    }

    /**
     * Finds this script's text element in a name bar.
     * @param {Element} wrap Name bar.
     * @returns {HTMLElement|null} Text element.
     */
    function findTextElement(wrap) {
        return wrap.querySelector(`:scope > .${CONFIG.CLASSES.TEXT}`);
    }

    /**
     * Adds, updates, or removes the legible name for one name bar.
     * @param {Element} wrap Name bar.
     * @returns {void}
     */
    function syncNameBar(wrap) {
        const name = readPlayerName(wrap);
        let element = findTextElement(wrap);

        if (!name) {
            element?.remove();
            return;
        }

        if (!element) {
            element = document.createElement('div');
            element.className = CONFIG.CLASSES.TEXT;
            wrap.append(element);
        }
        if (element.textContent !== name) element.textContent = name;

        const color = getOutlineColor(Array.from(wrap.classList));
        if (element.style.getPropertyValue(CONFIG.OUTLINE_PROPERTY) !== color) {
            element.style.setProperty(CONFIG.OUTLINE_PROPERTY, color);
        }
    }

    /**
     * Updates every name bar on the page.
     * @returns {void}
     */
    function syncAllNameBars() {
        document.querySelectorAll(CONFIG.SELECTORS.WRAP).forEach(syncNameBar);
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
     * Checks whether a node is, or is inside, this script's text.
     * @param {Node} node Node to check.
     * @returns {boolean} True for this script's own text.
     */
    function isOwnNode(node) {
        const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        return Boolean(element?.closest(`.${CONFIG.CLASSES.TEXT}`));
    }

    /**
     * Checks whether a node is, or contains, a name bar.
     * @param {Node} node Node to check.
     * @returns {boolean} True when it holds a name bar.
     */
    function containsNameBar(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        const { WRAP } = CONFIG.SELECTORS;
        return node.matches(WRAP) || Boolean(node.querySelector(WRAP));
    }

    /**
     * Decides whether a page change can affect a displayed name.
     * @param {MutationRecord} mutation Page change.
     * @returns {boolean} True when name bars should be updated.
     */
    function isRelevantMutation(mutation) {
        if (isOwnNode(mutation.target)) return false;
        const added = Array.from(mutation.addedNodes);
        if (added.some(containsNameBar)) return true;

        const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
        if (!target?.closest(CONFIG.SELECTORS.WRAP)) return false;

        const changed = [...added, ...Array.from(mutation.removedNodes)];
        return mutation.type !== 'childList' || changed.some((node) => !isOwnNode(node));
    }

    /**
     * Starts watching the page and stops when it unloads.
     * @returns {void}
     */
    function startObserver() {
        const scheduleSync = debounce(syncAllNameBars, CONFIG.OBSERVER_DEBOUNCE_MS);
        const observer = new MutationObserver((mutations) => {
            if (mutations.some(isRelevantMutation)) scheduleSync();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: [...CONFIG.OBSERVED_ATTRIBUTES],
        });
        window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
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
            syncAllNameBars();
            startObserver();
        } catch (error) {
            console.error('[Clean Player Names] Failed to start.', error);
        }
    }

    init();
})();
