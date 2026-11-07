// ==UserScript==
// @name         Torn Armory Notes
// @namespace    dadgum.torn.armorynotes
// @version      2.9.1
// @description  Colored labels and notes on individual weapons and armor (keyed by armory ID). Private notes on the Items page; shared faction notes in the Faction Armory.
// @author       DadGum
// @license      MIT
// @match        https://www.torn.com/item.php*
// @match        https://www.torn.com/factions.php*
// @match        https://www.torn.com/trade.php*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @connect      workers.dev
// @run-at       document-idle
// @homepageURL  https://github.com/db7346/torn-userscripts/tree/main/scripts/armory-notes
// @supportURL   https://github.com/db7346/torn-userscripts/issues
// @updateURL    https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/armory-notes/armory-notes.user.js
// @downloadURL  https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/armory-notes/armory-notes.user.js
// ==/UserScript==

/* =============================================================================
 * HEADER / DISCLOSURE
 * -----------------------------------------------------------------------------
 * Purpose
 *   Adds a small tag button next to every Primary, Secondary, Melee and
 *   Defensive (armor) item that has an armory ID. Click it to attach a short
 *   colored label and a free-text note. Notes are keyed by the item's unique
 *   armory ID, so they follow that exact weapon. Hover a label to read the
 *   full note.
 *
 *   Two kinds of notes:
 *   - Local notes (Items page): private, stored only in this browser.
 *   - Faction notes (Faction Armory): stored on your faction's notes server
 *     (a Cloudflare Worker your faction runs) and seen by every member who
 *     uses this script. Only members listed as editors can change them.
 *     If no server is set up, the Faction Armory uses local notes (v1 mode).
 *
 * Pages
 *   - item.php                       (rows view and thumbnail view)
 *   - factions.php#/tab=armoury      (Weapons and Armor tabs)
 *   - trade.php                      (trade view and add-items screen:
 *                                     faction notes, read-only; the other
 *                                     person's items are matched by stats)
 *
 * Author: DadGum
 *
 * Changelog
 *   2.9.1 (2026-11-07) Faction Armory > Deposit: faction notes show read-only
 *                      on your items (same list layout as the trade screen).
 *   2.9.0 (2026-11-07) Borrowed items: editors tick "Borrowed from <lender>"
 *                      on the trade (or fill "Borrowed from" in the note
 *                      editor); returned items are hidden instead of
 *                      "Missing" and come back with their tags. Editor
 *                      tools > Missing items: mark items sold, removed or
 *                      returned to their owner, in bulk. Tooltips show
 *                      "Borrowed from".
 *   2.8.3 (2026-11-04) API key disclosure brought up to date (no code change):
 *                      who runs the server, the view page link, and no more
 *                      Settings / server URL wording.
 *   2.8.2 (2026-11-03) Tampermonkey menu trimmed to five items: editor and
 *                      private-note commands moved into "Editor tools…" and
 *                      "Private notes…" panels; "Reload faction notes" is in
 *                      Sign in. "How it works" redesigned: wider, tabbed,
 *                      with a legend of the real icons and pills.
 *   2.8.1 (2026-11-03) "Sign in" replaces Settings: the faction's server URL
 *                      is built in, so the popup only asks for the API key,
 *                      and has a switch to hide tag icons on items without
 *                      notes. The note editor can no longer get stuck on
 *                      "Saving…" and shows "Saved" when done. Undo for 10
 *                      seconds after saving or deleting a note. One-time
 *                      "How it works" guide (menu item and ? in the editor).
 *   2.8.0 (2026-11-02) Filter bar above the Faction Armory list (search item,
 *                      label or note; Tagged only / Untagged bonus items).
 *                      Editors: "Log This As Traded" is highlighted when a
 *                      trade holds faction items and isn't logged yet.
 *                      Out-of-date scripts show an update notice once a day.
 *   2.7.0 (2026-11-02) "Manage editors (admin)" menu item: the notes admin
 *                      (ADMIN_ID on the server) adds and removes editors from
 *                      a faction member list, effective immediately. Editors
 *                      on the Faction Armory get a warning when the armory
 *                      sync failed or is over 12 hours old.
 *   2.6.2 (2026-11-02) Menu item "Clear faction notes cache" renamed to
 *                      "Reload faction notes (fix stale data)" so it doesn't
 *                      look destructive. Same behavior: nothing is deleted.
 *   2.6.1 (2026-11-01) "Sync armory now" within 5 minutes of the last sync now
 *                      shows a plain notice that the results are current,
 *                      instead of an error.
 *   2.6.0 (2026-11-01) "Sync armory now (editors)" menu item: the faction's
 *                      server reads the whole armory from the Torn API
 *                      (normally every 6 hours) for the spreadsheet and view
 *                      page: status, missing items, loans. Disclosure updated.
 *   2.5.0 (2026-11-01) Editors get a "Log This As Traded" checkbox on the
 *                      trade view: logs the trade's bonus armory items for
 *                      the spreadsheet ("Traded to …"); untick to undo.
 *                      Tampermonkey menu "Trade log" lists logged trades
 *                      with Remove buttons.
 *   2.4.0 (2026-11-01) Editors' browsers record every weapon/armor with a
 *                      bonus seen in the Faction Armory (name, stats,
 *                      bonuses, last seen) for the faction's spreadsheet.
 *                      Nothing changes in game for these items.
 *   2.3.0 (2026-11-01) Editors' browsers also record each noted item's
 *                      bonuses ("22% Execute") for the faction's spreadsheet
 *                      export. Stats are not recorded from a half-read row.
 *   2.2.0 (2026-11-01) Trade view: faction notes also show on the other
 *                      person's items, matched by item stats ("fingerprint":
 *                      name + damage + accuracy, or name + defence + bonus),
 *                      because Torn shows no ID for their items. Editors'
 *                      browsers record fingerprints from the armory and
 *                      Items page.
 *   2.1.1 (2026-11-01) Trade add-items confirmation step ("Are you sure you
 *                      wish to add…") now shows faction notes too.
 *   2.1.0 (2026-11-01) Trade pages: faction notes show read-only on your own
 *                      items in the trade view and on the add-items screen.
 *   2.0.2 (2026-11-01) Fixes: saving a note no longer hides other editors'
 *                      recent changes; without a key or outside the faction
 *                      the armory falls back to private notes; clearing the
 *                      cache mid-refresh is safe; partial uploads are
 *                      reported correctly; uploads split by size; polls only
 *                      redraw notes that changed.
 *   2.0.1 (2026-11-01) Editors can edit faction notes from the Items page
 *                      (click the faction pill), for items not in the
 *                      faction armory. Default server URL set.
 *   2.0.0 (2026-11-01) Shared faction notes: Faction Armory notes live on the
 *                      faction's server, refresh every 45 s while visible,
 *                      editors-only editing with "last edited by". Settings
 *                      panel (server URL + Public API key), upload (move)
 *                      local notes to the faction, faction notes shown
 *                      read-only on the Items page.
 *   1.0.0 (2026-11-01) Initial release: labels + notes per armory ID,
 *                      Items page (rows + thumbnails), Faction Armory,
 *                      JSON export / import (merge or replace), clear all.
 *
 * Torn API key usage disclosure
 *   - Key access level: PUBLIC. Only needed for faction notes; local notes
 *     work with no key at all.
 *   - Who runs the server: your faction's notes admin, on their own
 *     Cloudflare account. Its address is built into this copy of the script.
 *   - Data storage:
 *       In this browser (Tampermonkey storage): your local notes, your API
 *       key, your display choice, a sign-in token, and a cache of faction
 *       notes.
 *       On your faction's notes server (Cloudflare D1): faction notes and,
 *       for each change, the editor's Torn player ID and name; the faction
 *       armory's bonus weapons/armor (stats, bonuses, who they are loaned
 *       to; who lent an item to the faction; sold / removed marks), trades
 *       logged by editors, and the editor list (player ID, name, who added
 *       them). Your API key is NOT stored on the server.
 *     Exception, notes admin only: the admin may store ONE Limited key of
 *       their own as a server secret (ARMORY_API_KEY). The server uses it
 *       every 6 hours, and about 15 minutes after an editor logs a trade, to
 *       read the faction armory (faction/inventory, Limited, needs faction
 *       API access) and item stats (torn/itemdetails, only for items it has
 *       not seen before): usually 2-4 calls per sync. It also reads the
 *       faction member list (faction/members, Public) when the admin opens
 *       "Manage editors", at most once per 12 hours unless reloaded. All
 *       calls are tagged comment=ArmoryNotes. Members' keys are never stored.
 *   - Data sharing: faction notes are visible to members of your faction who
 *     use this script, and to anyone the notes admin gives the view page link
 *     (a read-only web page of the faction's armory list with notes, who
 *     items are loaned to, and who edited them). Nothing is shared with
 *     anyone else.
 *   - Purpose of use: annotating your own and your faction's items.
 *   - Key storage & sharing: the key stays in Tampermonkey storage. It is sent
 *     only over HTTPS, in the body of the sign-in request, to your faction's
 *     notes server (about once every 12 hours). The server uses it
 *     for one Torn API call (user basic,faction) to confirm who you are and
 *     that you are in the faction, then forgets it. The key is never logged
 *     and never put in a URL.
 *   - API calls: Torn API about 1 per 12 hours per member (sign-in, made by
 *     the server), plus the admin's armory sync (above).
 *     Faction server about 1.3 per minute while the Faction Armory is open
 *     and visible; none otherwise.
 *
 * Game-rule compliance
 *   Read-only helper. The script never clicks, equips, loans, sends, sells or
 *   otherwise acts in the game. It only reads item rows and adds its own UI.
 *   Network requests go only to the faction notes server, never to Torn.
 * ========================================================================== */

(function () {
    'use strict';

    /* =========================================================================
     * CONFIG
     * ====================================================================== */

    const PREFIX = 'tms-an';

    const CONFIG = Object.freeze({
        /** Set true to print debug logs to the console. */
        DEBUG: false,
        SCRIPT_NAME: 'Torn Armory Notes',
        PREFIX,

        /** GM storage key holding the notes database (versioned). */
        STORAGE_KEY: 'tms-armorynotes:v1',
        SCHEMA_VERSION: 1,
        /** Marker written into export files so imports can be recognised. */
        EXPORT_APP_ID: 'torn-armory-notes',
        EXPORT_FILE_PREFIX: 'torn-armory-notes',

        /** Item categories that get a note button (Torn's own category names). */
        TRACKED_CATEGORIES: Object.freeze(['Primary', 'Secondary', 'Melee', 'Defensive']),
        /** Armory IDs are plain integers; anything else is ignored. */
        ARMORY_ID_PATTERN: /^\d{1,20}$/,

        LABEL_MAX: 16,
        TEXT_MAX: 1000,
        DEFAULT_COLOR: 'blue',
        /** Label palette. Stored by key, so only these colors can ever be applied. */
        COLORS: Object.freeze([
            Object.freeze({ key: 'red', name: 'Red', bg: '#d9534f', fg: '#ffffff' }),
            Object.freeze({ key: 'orange', name: 'Orange', bg: '#f0883e', fg: '#1a1a1a' }),
            Object.freeze({ key: 'yellow', name: 'Yellow', bg: '#e3b341', fg: '#1a1a1a' }),
            Object.freeze({ key: 'green', name: 'Green', bg: '#3fb950', fg: '#0d1117' }),
            Object.freeze({ key: 'teal', name: 'Teal', bg: '#2aa198', fg: '#ffffff' }),
            Object.freeze({ key: 'blue', name: 'Blue', bg: '#4493f8', fg: '#ffffff' }),
            Object.freeze({ key: 'purple', name: 'Purple', bg: '#a371f7', fg: '#ffffff' }),
            Object.freeze({ key: 'gray', name: 'Gray', bg: '#8b949e', fg: '#0d1117' }),
        ]),

        /* ---- Faction sharing ---------------------------------------------- */

        /**
         * Your faction's notes server (the Cloudflare Worker URL, e.g.
         * "https://torn-armory-notes.yourname.workers.dev"). Built in: members
         * only enter their API key. Empty = faction sharing off (private notes only).
         */
        DEFAULT_SERVER_URL: 'https://torn-armory-notes.dbeanwomble.workers.dev',
        SETTINGS_KEY: 'tms-armorynotes:settings:v1',
        SESSION_KEY: 'tms-armorynotes:session:v1',
        SHARED_CACHE_KEY: 'tms-armorynotes:shared:v1',
        SEEN_FACTION_KEY: 'tms-armorynotes:seen:v1',
        SETUP_PROMPTED_KEY: 'tms-armorynotes:setup-prompted:v1',
        /** Set once the "How it works" guide was shown. */
        HELP_SEEN_KEY: 'tms-armorynotes:help-seen:v1',
        /** The note editor stops waiting for the server after this long. */
        SAVE_WATCHDOG_MS: 20000,
        /** "Saved" shows in the editor this long before it closes. */
        SAVED_FLASH_MS: 700,
        /** How long the Undo button stays after a save or delete. */
        UNDO_MS: 10000,
        ITEMS_SENT_KEY: 'tms-armorynotes:items-sent:v1',
        /** When the "please update" notice was last shown (epoch ms). */
        UPDATE_NAG_KEY: 'tms-armorynotes:update-nag:v1',
        UPDATE_NAG_MS: 24 * 60 * 60 * 1000,
        INSTALL_URL: 'https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/armory-notes/armory-notes.user.js',
        SHARED_FETCHED_KEY: 'tms-armorynotes:shared-fetched:v1',
        AUTH_FAILURE_KEY: 'tms-armorynotes:auth-failure:v1',
        SHARED_CACHE_VERSION: 1,
        API_KEY_PATTERN: /^[A-Za-z0-9]{16}$/,

        /** Faction Armory refresh interval while the tab is visible. */
        SHARED_POLL_MS: 45000,
        /** Warn editors when the last successful armory sync is older than this (it runs every 6 hours). */
        SYNC_STALE_MS: 12 * 60 * 60 * 1000,
        /** Items page: refresh the faction-note cache if older than this. */
        ITEMS_SHARED_MAX_AGE_MS: 60 * 1000,
        /** Sign in again this long before the session token expires. */
        TOKEN_RENEW_MARGIN_MS: 5 * 60 * 1000,
        REQUEST_TIMEOUT_MS: 15000,
        /** Wait after "too many requests" or a network failure. */
        BACKOFF_MS: 60000,
        /** Our own cap on requests to the notes server (sliding 60 s window). */
        SERVER_RATE_LIMIT: Object.freeze({ MAX: 30, WINDOW_MS: 60000 }),
        /** Max pages fetched in one refresh (server returns up to 5000 notes per page). */
        SHARED_MAX_PAGES: 5,
        /** Notes per upload request (server accepts up to 1000). */
        UPLOAD_CHUNK: 500,
        /** Max upload request size in bytes (server accepts up to 512 KiB). */
        UPLOAD_MAX_BYTES: 400 * 1024,
        /** Armory IDs remembered from the faction armory (pre-ticks the upload list). */
        SEEN_MAX: 5000,
        SEEN_FLUSH_MS: 2000,
        EDITOR_NAME_MAX: 40,
        /** Same rule as the server: "w|…" or "a|…", no control characters. */
        FINGERPRINT_PATTERN: /^[wa]\|[^\u0000-\u001f]{3,248}$/,
        BONUSES_MAX: 200,
        /** Fingerprints sent per request, and the wait before sending a batch. */
        FINGERPRINT_BATCH: 200,
        FINGERPRINT_FLUSH_MS: 3000,
        /** Bonus items: re-report an unchanged item after this long (keeps "last seen" fresh). */
        ITEM_RESEEN_MS: 12 * 60 * 60 * 1000,
        ITEM_BATCH: 250,
        ITEMS_SENT_MAX: 5000,

        /**
         * Torn API error codes (ApiError schema, Torn API v2). The server passes
         * Torn's code through when sign-in fails; these are the messages shown.
         */
        TORN_ERRORS: Object.freeze({
            0: 'Unknown Torn API error.',
            1: 'API key is empty. Enter your key with "Sign in" in the Tampermonkey menu.',
            2: 'Incorrect API key. Re-enter it with "Sign in" in the Tampermonkey menu.',
            3: 'Wrong request type (script bug, please report).',
            4: 'Wrong fields requested (script bug, please report).',
            5: 'Too many API requests. Waiting a minute before trying again.',
            6: 'Incorrect ID.',
            7: 'Incorrect ID-entity relation.',
            8: 'Your IP is temporarily blocked by Torn for abuse.',
            9: 'The Torn API is disabled right now. Try again later.',
            10: 'Key owner is in federal jail.',
            11: 'Key change cooldown. Try again in a moment.',
            12: 'Torn could not read the key. Try again shortly.',
            13: 'API key is temporarily disabled because the owner is inactive.',
            14: 'Daily read limit reached for this key.',
            15: 'Log is temporarily unavailable.',
            16: 'Key access level too low. A Public key (or higher) is required.',
            17: 'Torn API backend error. Try again later.',
            18: 'API key is paused by its owner.',
            19: 'Must migrate to Crimes 2.0.',
            20: 'Race not finished.',
            21: 'Incorrect category.',
            22: 'Selection only available in API v1.',
            23: 'Selection only available in API v2.',
            24: 'This Torn API endpoint is closed temporarily.',
            25: 'Invalid stat requested.',
            26: 'Only a category or stats are allowed.',
            27: 'Must migrate to Organized Crimes 2.0.',
            28: 'Incorrect log ID.',
            29: 'Category selection unavailable for interaction logs.',
            30: 'File does not exist.',
            31: 'City stats are unavailable right now.',
            32: 'Endpoint closed until the attacking period.',
            33: 'No competition available.',
        }),
        /** Torn codes worth retrying later; all others need the user to act. */
        TORN_TRANSIENT_CODES: Object.freeze([0, 5, 9, 11, 12, 15, 17, 24]),

        OBSERVER_DEBOUNCE_MS: 150,
        WAIT_FOR_TIMEOUT_MS: 15000,
        NOTICE_MS: 4000,
        /** Delay before re-applying the armory filter after buttons change. */
        FILTER_DEBOUNCE_MS: 60,

        /** Layout sizes (px). */
        ITEMS_PILL_MAX_PX: 110,
        FACTION_PILL_MAX_PX: 74,
        FACTION_PAD_EMPTY_PX: 20,
        FACTION_PAD_NOTE_PX: 82,
        POPOVER_WIDTH_PX: 260,
        TOOLTIP_MAX_PX: 280,
        FLOAT_GAP_PX: 6,
        VIEWPORT_MARGIN_PX: 8,
        Z_INDEX_BASE: 100000,

        PATHS: Object.freeze({ ITEMS: '/item.php', FACTIONS: '/factions.php', TRADE: '/trade.php' }),
        /** Substring of location.hash that identifies the faction armory tab. */
        FACTION_HASH_TOKEN: 'tab=armoury',

        /**
         * DOM selectors. Torn's markup on these two pages uses stable, un-hashed
         * class names and data attributes (verified against pasted HTML on
         * 2026-11-01). The fragile ones are noted.
         */
        SEL: Object.freeze({
            // Items page (item.php)
            ITEMS_ROOT: '#category-wrap',
            ITEMS_ROW: 'li[data-armoryid]',
            ITEMS_NAME_WRAP: ':scope > .title-wrap .name-wrap',
            ITEMS_NAME: '.name',
            ITEMS_THUMB: ':scope > .thumbnail-wrap .thumbnail',
            // Faction armory (factions.php#/tab=armoury)
            FACTION_ROOT: '#faction-armoury',
            FACTION_ROW: 'ul.item-list > li',
            /** The armory list, and its header row (the filter bar goes above the header). */
            FACTION_LIST: 'ul.item-list',
            FACTION_LIST_TITLE: 'ul.list-title',
            FACTION_ID_HOLDER: ':scope > .img-wrap[data-armoryid]',
            FACTION_NAME: ':scope > .name',
            // Fragile: category is read from the visible "Type" column text.
            FACTION_TYPE: ':scope > .type',
            // Trade pages (trade.php). Root is replaced or refilled on navigation.
            TRADE_ROOT: '#trade-container',
            // Add-items screen and its confirmation step: rows carry the armory ID
            // only inside React's data-reactid (".…$Secondary.$13077564088" in the
            // item list, ".0.3.0.$13077564088" in the confirmation list). Rows are
            // filtered by that pattern. Fragile: this attribute disappears if
            // Torn upgrades React; notes then stop showing here.
            // Candidate rows; only those whose id ends in "$<digits>" are used.
            TRADE_ADD_ROW: 'li[data-reactid]',
            TRADE_ADD_NAME_WRAP: ':scope > .title-wrap .name-wrap',
            TRADE_ADD_NAME: '.t-overflow',
            TRADE_ADD_IMG: ':scope > .title-wrap img[src*="/images/items/"]',
            // Trade view: only your own items have an armory ID, inside the
            // "Remove from trade" link. The other person's items have none.
            TRADE_VIEW_ROW: '.trade-cont .user .cont > li ul.desc > li',
            TRADE_VIEW_REMOVE: ':scope > .del a[href*="armoryID="]',
            TRADE_VIEW_NAME: ':scope > .name',
            // Item stats, used for fingerprints. The trade view keeps them in
            // the info icon's title (HTML text, parsed as a string, never rendered).
            TRADE_VIEW_INFO: ':scope > .name i.networth-info-icon',
            // Trade view: the "This trade expires…" bar right above the trade,
            // and the two players' names in the column headings.
            TRADE_CONT: '.trade-cont',
            TRADE_BAR: '.info-msg-cont',
            TRADE_MY_NAME: '.trade-cont .user.left .title-divider',
            TRADE_PARTNER_NAME: '.trade-cont .user.right > .title-black',
            TRADE_ID_LINK: 'a[href*="ID="]',
            ITEMS_STATS: ':scope .bonuses-wrap',
            FACTION_STATS: ':scope > ul.bonuses',
        }),
    });

    /** Prefixed class names used by this script (all scoped under PREFIX). */
    const CLS = Object.freeze({
        btn: `${PREFIX}-btn`,
        btnEmpty: `${PREFIX}-btn--empty`,
        btnNote: `${PREFIX}-btn--note`,
        kindPill: `${PREFIX}-btn--pill`,
        kindBadge: `${PREFIX}-btn--badge`,
        kindFaction: `${PREFIX}-btn--faction`,
        kindShared: `${PREFIX}-btn--shared`,
        kindTrade: `${PREFIX}-btn--trade`,
        btnHidden: `${PREFIX}-btn--hidden`,
        btnReadOnly: `${PREFIX}-btn--ro`,
        btnHoverOnly: `${PREFIX}-btn--hover`,
        popMeta: `${PREFIX}-pop-meta`,
        checklist: `${PREFIX}-checklist`,
        checkRow: `${PREFIX}-check`,
        linkRow: `${PREFIX}-links`,
        status: `${PREFIX}-status`,
        /** Marks any element this script adds (so observers ignore it). */
        own: `${PREFIX}-own`,
        logBox: `${PREFIX}-logbox`,
        logBoxNudge: `${PREFIX}-logbox--nudge`,
        logWrap: `${PREFIX}-logwrap`,
        borrowBox: `${PREFIX}-borrowbox`,
        filterBar: `${PREFIX}-filter`,
        rowHidden: `${PREFIX}-row--hidden`,
        logHost: `${PREFIX}-loghost`,
        logGroup: `${PREFIX}-loggroup`,
        logItem: `${PREFIX}-logitem`,
        addRow: `${PREFIX}-addrow`,
        dim: `${PREFIX}-dim`,
        label: `${PREFIX}-label`,
        icon: `${PREFIX}-icon`,
        thumbHost: `${PREFIX}-thost`,
        factionHost: `${PREFIX}-fhost`,
        factionHostNote: `${PREFIX}-fhost--note`,
        tip: `${PREFIX}-tip`,
        tipTitle: `${PREFIX}-tip-title`,
        tipBody: `${PREFIX}-tip-body`,
        tipMeta: `${PREFIX}-tip-meta`,
        pop: `${PREFIX}-pop`,
        popHead: `${PREFIX}-pop-head`,
        popSub: `${PREFIX}-pop-sub`,
        field: `${PREFIX}-field`,
        counter: `${PREFIX}-counter`,
        swatches: `${PREFIX}-swatches`,
        swatch: `${PREFIX}-swatch`,
        swatchOn: `${PREFIX}-swatch--on`,
        actions: `${PREFIX}-actions`,
        spacer: `${PREFIX}-spacer`,
        uiBtn: `${PREFIX}-ui-btn`,
        uiPrimary: `${PREFIX}-ui-btn--primary`,
        uiDanger: `${PREFIX}-ui-btn--danger`,
        overlay: `${PREFIX}-overlay`,
        modal: `${PREFIX}-modal`,
        modalBody: `${PREFIX}-modal-body`,
        notices: `${PREFIX}-notices`,
        notice: `${PREFIX}-notice`,
        noticeError: `${PREFIX}-notice--error`,
        noticeBtn: `${PREFIX}-notice-btn`,
        help: `${PREFIX}-help`,
        helpTabs: `${PREFIX}-help-tabs`,
        helpTab: `${PREFIX}-help-tab`,
        legend: `${PREFIX}-legend`,
        tips: `${PREFIX}-tips`,
        modalWide: `${PREFIX}-modal--wide`,
        toolList: `${PREFIX}-tools`,
        sample: `${PREFIX}-sample`,
        inlineRow: `${PREFIX}-inline`,
        popStatus: `${PREFIX}-pop-status`,
        popHelp: `${PREFIX}-pop-help`,
        color: (key) => `${PREFIX}-c-${key}`,
    });

    const TRACKED = new Set(CONFIG.TRACKED_CATEGORIES);
    const COLOR_KEYS = new Set(CONFIG.COLORS.map((c) => c.key));
    const DATA_ID = 'tmsAnId'; // -> data-tms-an-id
    const DATA_NAME = 'tmsAnName';
    const DATA_ITEM = 'tmsAnItem';
    const DATA_KIND = 'tmsAnKind';
    const DATA_SIG = 'tmsAnSig';
    const DATA_SRC = 'tmsAnSrc'; // 'local' | 'shared'
    const DATA_FP = 'tmsAnFp';   // item stat fingerprint (on buttons and rows)
    const DATA_BONUS = 'tmsAnBonus'; // readable bonus text, e.g. "22% Execute"
    const TORN_TRANSIENT = new Set(CONFIG.TORN_TRANSIENT_CODES);

    /**
     * Debug logger, silent unless CONFIG.DEBUG is true.
     * @param {...unknown} args - Values to log.
     * @returns {void}
     */
    function log(...args) {
        if (CONFIG.DEBUG) console.debug(`[${CONFIG.SCRIPT_NAME}]`, ...args);
    }

    /* =========================================================================
     * TYPEDEFS
     * ====================================================================== */

    /**
     * A single stored note.
     * @typedef {Object} Note
     * @property {string} label    - Short label (may be empty if text is set).
     * @property {string} color    - One of CONFIG.COLORS[].key.
     * @property {string} text     - Free-text note (may be empty if label is set).
     * @property {string} itemName - Item name when last saved (for readable backups).
     * @property {string} itemId   - Torn item type ID when last saved.
     * @property {number} updated  - Epoch ms of last save.
     */

    /**
     * The persisted notes database.
     * @typedef {Object} NoteDb
     * @property {number} version              - Schema version (CONFIG.SCHEMA_VERSION).
     * @property {Object<string, Note>} notes  - Notes keyed by armory ID.
     */

    /**
     * A faction (shared) note: a Note plus who last changed it and the item's
     * stat fingerprint ('' until an editor's browser has seen the item).
     * @typedef {Note & {updatedById: number, updatedByName: string, fingerprint: string, bonuses: string}} SharedNote
     */

    /**
     * Stats read from an item row or tooltip.
     * @typedef {Object} ItemStats
     * @property {number|null} damage
     * @property {number|null} accuracy
     * @property {number|null} defence
     * @property {{name: string, value: string}[]} bonuses
     */

    /**
     * A note as returned by the notes server (GET /notes, PUT/DELETE /notes/:id).
     * @typedef {Object} ServerNote
     * @property {string} armoryId
     * @property {string} label
     * @property {string} color
     * @property {string} text
     * @property {string} itemName
     * @property {string} itemId
     * @property {number} updated        - Server epoch ms of the last edit.
     * @property {number} [changed]      - Server epoch ms of any change (sync marker).
     * @property {string} [fingerprint]  - Item stat fingerprint.
     * @property {number} updatedById
     * @property {string} updatedByName
     * @property {boolean} deleted       - Tombstone (note was deleted).
     */

    /**
     * Signed-in session returned by POST /auth (stored locally; contains no API key).
     * @typedef {Object} Session
     * @property {string} token
     * @property {number} expiresAt                  - Epoch ms.
     * @property {{id: number, name: string}} player
     * @property {{id: number, name: string}} faction
     * @property {boolean} canEdit
     * @property {boolean} isAdmin                   - The notes admin (manages editors).
     * @property {string} serverUrl                  - Server this token belongs to.
     */

    /**
     * Local settings.
     * @typedef {Object} Settings
     * @property {string} serverUrl     - Notes server base URL (built in: CONFIG.DEFAULT_SERVER_URL).
     * @property {string} apiKey        - Torn Public API key ('' = not set).
     * @property {boolean} showEmptyTags - Show tag icons on items without notes (off: only on hover).
     */

    /**
     * A note source used by buttons and the editor.
     * @typedef {Object} NoteSource
     * @property {'local'|'shared'} kind
     * @property {(id: string) => (Note|SharedNote|null)} get
     * @property {() => Object<string, Note>} notes
     * @property {() => boolean} canEdit
     * @property {(id: string, fields: Object) => Promise<void>} save
     * @property {(id: string) => Promise<void>} remove
     */

    /**
     * Where and how a note button is mounted inside a row.
     * @typedef {Object} MountSpec
     * @property {string} kind                                  - 'pill' | 'badge' | 'faction' | 'shared'.
     * @property {() => ('local'|'shared')} source              - Which notes this button shows.
     * @property {(row: Element) => (Element|null)} findHost   - Locates the host element.
     * @property {(host: Element, btn: HTMLElement) => void} attach - Inserts the button.
     */

    /**
     * Page-specific knowledge of how to read item rows.
     * @typedef {Object} PageAdapter
     * @property {string} name                                    - Adapter name (for logs).
     * @property {string} rowSelector                             - Selects candidate rows.
     * @property {(row: Element) => (string|undefined)} getId     - Armory ID.
     * @property {(row: Element) => (string|undefined)} getCategory - Torn category name.
     * @property {(row: Element) => string} getItemId             - Item type ID.
     * @property {(row: Element) => string} getName               - Item display name.
     * @property {MountSpec[]} mounts                             - Button mount points.
     * @property {(row: Element) => (ItemStats|null)} [getStats]  - Item stats (null if unreadable).
     * @property {(row: Element) => boolean} [accepts]            - Row filter applied before getId.
     * @property {boolean} [dynamicIds]                           - IDs come from fingerprints; rows are
     *   rescanned when faction notes change and buttons removed when no note matches.
     * @property {boolean} [backfill]                             - Editors record fingerprints from this page.
     * @property {boolean} [trackItems]                           - Editors record bonus items from this page.
     * @property {(root: Element) => void} [afterScan]           - Runs after each scan of the root.
     * @property {boolean} [anyCategory]                          - Skip the category filter
     *   (pages that only show existing faction notes).
     */

    /* =========================================================================
     * STORAGE (GM storage wrapper, JSON (de)serialization)
     * ====================================================================== */

    const Storage = {
        /**
         * Read and JSON-parse a value from GM storage.
         * @param {string} key - Storage key (already namespaced by caller).
         * @param {*} fallback - Returned when nothing is stored.
         * @returns {*} The parsed value or the fallback.
         * @throws {Error} If the stored value exists but is not valid JSON.
         */
        read(key, fallback) {
            const raw = GM_getValue(key, null);
            if (raw === null || raw === undefined) return fallback;
            if (typeof raw !== 'string') return raw;
            try {
                return JSON.parse(raw);
            } catch (err) {
                throw new Error(`Stored data for "${key}" is not valid JSON.`);
            }
        },

        /**
         * JSON-serialize and write a value to GM storage.
         * @param {string} key - Storage key.
         * @param {*} value - JSON-serializable value.
         * @returns {void}
         */
        write(key, value) {
            GM_setValue(key, JSON.stringify(value));
        },

        /**
         * Like read(), but returns the fallback for unreadable data instead of
         * throwing (for caches and settings that can safely start over).
         * @param {string} key - Storage key.
         * @param {*} fallback - Returned when nothing usable is stored.
         * @returns {*} The parsed value or the fallback.
         */
        readSafe(key, fallback) {
            try {
                return Storage.read(key, fallback);
            } catch (err) {
                log(`Ignoring unreadable stored value for ${key}`);
                return fallback;
            }
        },
    };

    /* =========================================================================
     * DATA (pure functions, no DOM access)
     * ====================================================================== */

    const Data = {
        /**
         * Create an empty notes database.
         * @returns {NoteDb} Empty database.
         */
        emptyDb() {
            return { version: CONFIG.SCHEMA_VERSION, notes: {} };
        },

        /**
         * Check that a value is a plausible armory ID.
         * @param {unknown} id - Candidate ID.
         * @returns {boolean} True for a numeric string.
         */
        isValidArmoryId(id) {
            return typeof id === 'string' && CONFIG.ARMORY_ID_PATTERN.test(id);
        },

        /**
         * Sanitize an untrusted note object. Unknown colors fall back to the
         * default; over-long strings are truncated.
         * @param {unknown} raw - Candidate note.
         * @returns {Note|null} A clean note, or null if empty/invalid.
         */
        normalizeNote(raw) {
            if (!raw || typeof raw !== 'object') return null;
            const label = String(raw.label ?? '').trim().slice(0, CONFIG.LABEL_MAX);
            const text = String(raw.text ?? '').trimEnd().slice(0, CONFIG.TEXT_MAX);
            if (!label && !text.trim()) return null;
            const color = COLOR_KEYS.has(raw.color) ? raw.color : CONFIG.DEFAULT_COLOR;
            const updated = Number.isFinite(raw.updated) && raw.updated > 0 ? raw.updated : 0;
            return {
                label,
                color,
                text,
                itemName: String(raw.itemName ?? '').slice(0, 100),
                itemId: /^\d{1,10}$/.test(String(raw.itemId ?? '')) ? String(raw.itemId) : '',
                updated,
            };
        },

        /**
         * Validate and sanitize a whole database object.
         * @param {unknown} raw - Candidate database (null/undefined means "nothing stored").
         * @returns {{db: NoteDb, skipped: number}} Clean database and count of dropped entries.
         * @throws {Error} If the object is not a recognised notes database.
         */
        normalizeDb(raw) {
            if (raw === null || raw === undefined) return { db: Data.emptyDb(), skipped: 0 };
            const notesOk = raw && typeof raw.notes === 'object' && raw.notes !== null && !Array.isArray(raw.notes);
            if (typeof raw !== 'object' || raw.version !== CONFIG.SCHEMA_VERSION || !notesOk) {
                throw new Error('Unrecognized notes data format or version.');
            }
            const db = Data.emptyDb();
            let skipped = 0;
            for (const [id, value] of Object.entries(raw.notes)) {
                const note = Data.isValidArmoryId(id) ? Data.normalizeNote(value) : null;
                if (note) db.notes[id] = note;
                else skipped += 1;
            }
            return { db, skipped };
        },

        /**
         * Merge incoming notes into current notes; the newer `updated` wins.
         * @param {Object<string, Note>} current - Existing notes.
         * @param {Object<string, Note>} incoming - Notes being imported.
         * @returns {{notes: Object<string, Note>, added: number, updated: number, kept: number}} Result and stats.
         */
        mergeNotes(current, incoming) {
            const notes = { ...current };
            let added = 0;
            let updated = 0;
            let kept = 0;
            for (const [id, note] of Object.entries(incoming)) {
                const existing = notes[id];
                if (!existing) {
                    notes[id] = note;
                    added += 1;
                } else if (note.updated > existing.updated) {
                    notes[id] = note;
                    updated += 1;
                } else {
                    kept += 1;
                }
            }
            return { notes, added, updated, kept };
        },

        /**
         * Parse the text of a backup file.
         * @param {string} text - File contents.
         * @returns {{db: NoteDb, skipped: number}} Parsed database and dropped-entry count.
         * @throws {Error} If the file is not JSON or not a notes backup.
         */
        parseBackup(text) {
            let obj;
            try {
                obj = JSON.parse(text);
            } catch (err) {
                throw new Error('That file is not valid JSON.');
            }
            if (!obj || typeof obj !== 'object') throw new Error('That file is not a notes backup.');
            if (obj.app !== undefined && obj.app !== CONFIG.EXPORT_APP_ID) {
                throw new Error('That file was made by a different script.');
            }
            return Data.normalizeDb({ version: obj.version, notes: obj.notes });
        },

        /**
         * Build the export payload for a database.
         * @param {NoteDb} db - Database to export.
         * @param {Date} now - Export timestamp.
         * @returns {Object} JSON-serializable backup object.
         */
        buildBackup(db, now) {
            return {
                app: CONFIG.EXPORT_APP_ID,
                version: db.version,
                exportedAt: now.toISOString(),
                count: Object.keys(db.notes).length,
                notes: db.notes,
            };
        },

        /**
         * Build a dated backup file name.
         * @param {Date} now - Date to embed.
         * @returns {string} File name like "torn-armory-notes-2026-11-01.json".
         */
        backupFileName(now) {
            const pad = (n) => String(n).padStart(2, '0');
            const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
            return `${CONFIG.EXPORT_FILE_PREFIX}-${date}.json`;
        },

        /**
         * Unique, sorted list of labels already in use (for autocomplete).
         * @param {Object<string, Note>} notes - All notes.
         * @returns {string[]} Labels.
         */
        collectLabels(notes) {
            const set = new Set();
            for (const note of Object.values(notes)) if (note.label) set.add(note.label);
            return [...set].sort((a, b) => a.localeCompare(b));
        },

        /**
         * Short signature used to skip re-rendering unchanged buttons.
         * @param {Note|null} note - Note or null.
         * @returns {string} Signature.
         */
        noteSignature(note) {
            return note ? `${note.updated}|${note.color}|${note.label}|${note.text.length}` : '-';
        },

        /**
         * Look up a palette entry by key.
         * @param {string} key - Color key.
         * @returns {{key: string, name: string, bg: string, fg: string}} Palette entry (default if unknown).
         */
        colorFor(key) {
            return CONFIG.COLORS.find((c) => c.key === key)
                ?? CONFIG.COLORS.find((c) => c.key === CONFIG.DEFAULT_COLOR);
        },

        /**
         * Sanitize a note from the server (or the local faction-note cache).
         * @param {unknown} raw - Candidate ServerNote.
         * @returns {{id: string, updated: number, changed: number, note: (SharedNote|null)}|null}
         *   null if unusable; note is null for a deletion (tombstone). `changed`
         *   is the sync marker (falls back to `updated` for older servers).
         */
        normalizeSharedNote(raw) {
            if (!raw || typeof raw !== 'object') return null;
            const id = String(raw.armoryId ?? '');
            const updated = Number(raw.updated);
            if (!Data.isValidArmoryId(id) || !Number.isFinite(updated) || updated <= 0) return null;
            const changedRaw = Number(raw.changed);
            const changed = Number.isFinite(changedRaw) && changedRaw > 0 ? changedRaw : updated;
            if (raw.deleted) return { id, updated, changed, note: null };
            const base = Data.normalizeNote({ ...raw, updated });
            if (!base) return { id, updated, changed, note: null };
            const byId = Number(raw.updatedById);
            return {
                id,
                updated,
                changed,
                note: {
                    ...base,
                    updatedById: Number.isInteger(byId) && byId > 0 ? byId : 0,
                    updatedByName: String(raw.updatedByName ?? '').slice(0, CONFIG.EDITOR_NAME_MAX),
                    fingerprint: Data.isFingerprint(raw.fingerprint) ? raw.fingerprint : '',
                    bonuses: Data.isBonusText(raw.bonuses) ? raw.bonuses : '',
                },
            };
        },

        /**
         * Check the shape of a Torn API key (does not prove it works).
         * @param {string} key - Candidate key.
         * @returns {boolean} True for 16 letters/digits.
         */
        isApiKeyFormat(key) {
            return CONFIG.API_KEY_PATTERN.test(String(key ?? ''));
        },

        /**
         * Compare two dotted version strings numerically ("2.10.0" > "2.9.1").
         * @param {string} a - Version.
         * @param {string} b - Version.
         * @returns {number} -1, 0 or 1.
         */
        compareVersions(a, b) {
            const pa = String(a).split('.').map((x) => Number.parseInt(x, 10) || 0);
            const pb = String(b).split('.').map((x) => Number.parseInt(x, 10) || 0);
            for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
                const d = (pa[i] ?? 0) - (pb[i] ?? 0);
                if (d) return d < 0 ? -1 : 1;
            }
            return 0;
        },

        /**
         * Human "time ago" text.
         * @param {number} ms - Past epoch ms.
         * @param {number} now - Current epoch ms.
         * @returns {string} e.g. "just now", "5 min ago", "3 h ago", "2 d ago".
         */
        relativeTime(ms, now) {
            const s = Math.max(0, Math.round((now - ms) / 1000));
            if (s < 45) return 'just now';
            const m = Math.round(s / 60);
            if (m < 60) return `${m} min ago`;
            const h = Math.round(m / 60);
            if (h < 48) return `${h} h ago`;
            return `${Math.round(h / 24)} d ago`;
        },

        /**
         * Split notes into upload chunks, each at most `maxCount` notes and
         * `maxBytes` of JSON. Only the fields the server accepts are sent.
         * @param {Array<Note & {armoryId: string}>} notes - Notes.
         * @param {number} maxCount - Max notes per chunk.
         * @param {number} maxBytes - Max UTF-8 bytes of JSON per chunk.
         * @returns {Object[][]} Chunks.
         */
        chunkForUpload(notes, maxCount, maxBytes) {
            const enc = new TextEncoder();
            const chunks = [];
            let current = [];
            let size = 16; // {"notes":[]}
            for (const n of notes) {
                const item = { armoryId: n.armoryId, label: n.label, color: n.color, text: n.text, itemName: n.itemName, itemId: n.itemId };
                const len = enc.encode(JSON.stringify(item)).length + 1;
                if (current.length && (current.length >= maxCount || size + len > maxBytes)) {
                    chunks.push(current);
                    current = [];
                    size = 16;
                }
                current.push(item);
                size += len;
            }
            if (current.length) chunks.push(current);
            return chunks;
        },

        /**
         * Whether a value is a well-formed fingerprint.
         * @param {unknown} fp - Candidate.
         * @returns {boolean} True if valid.
         */
        isFingerprint(fp) {
            return typeof fp === 'string' && CONFIG.FINGERPRINT_PATTERN.test(fp);
        },

        /**
         * Whether a value is acceptable bonus text (may be empty).
         * @param {unknown} b - Candidate.
         * @returns {boolean} True if valid.
         */
        isBonusText(b) {
            return typeof b === 'string' && b.length <= CONFIG.BONUSES_MAX && !/[\u0000-\u001f]/.test(b);
        },

        /**
         * Readable bonus text for the spreadsheet: "22% Execute, 34% Stricken".
         * @param {{name: string, value: string}[]} bonuses - Parsed bonuses.
         * @returns {string} Text ('' if none).
         */
        formatBonuses(bonuses) {
            const text = (bonuses ?? []).map((b) => (b.value ? `${b.value}% ${b.name}` : b.name)).join(', ');
            return text.slice(0, CONFIG.BONUSES_MAX);
        },

        /**
         * Parse bonus name(s) and value(s) from Torn's bonus tooltip HTML, e.g.
         * "<b>Impenetrable</b><br/>20% decreased incoming bullet damage".
         * Plain string parsing: the HTML is never rendered.
         * @param {string} html - Tooltip HTML text.
         * @returns {{name: string, value: string}[]} Bonuses (value '' if no %).
         */
        parseBonuses(html) {
            const out = [];
            const re = /<b>([^<]{1,40})<\/b>\s*<br\s*\/?>([^<]*)/gi;
            let m;
            while ((m = re.exec(String(html ?? '')))) {
                const pct = /(\d+(?:\.\d+)?)\s*%/.exec(m[2]);
                out.push({ name: m[1].trim(), value: pct ? pct[1] : '' });
            }
            return out;
        },

        /**
         * Read stats from the trade view's info-icon tooltip HTML (string only).
         * @param {string} html - Tooltip HTML text.
         * @returns {ItemStats} Stats.
         */
        statsFromTooltip(html) {
            const text = String(html ?? '');
            const stat = (kind) => {
                const m = new RegExp(`bonus-attachment-item-${kind}-bonus['"][^>]*>\\s*</i>\\s*<span>\\s*([\\d.]+)\\s*</span>`, 'i').exec(text);
                return m ? Number(m[1]) : null;
            };
            return { damage: stat('damage'), accuracy: stat('accuracy'), defence: stat('defence'), bonuses: Data.parseBonuses(text) };
        },

        /**
         * Build an item fingerprint. Weapons: name + damage + accuracy (mods do
         * not change these). Armor: name + defence + bonuses (defence alone is
         * less unique). Two decimals, lower-case name.
         * @param {string} name - Item name.
         * @param {ItemStats} stats - Item stats.
         * @returns {string} Fingerprint, or '' if the stats are incomplete.
         */
        makeFingerprint(name, stats) {
            const n = String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/\|/g, '/');
            const fix = (v) => (Number.isFinite(v) ? v.toFixed(2) : null);
            if (!n || !stats) return '';
            let fp = '';
            if (fix(stats.damage) && fix(stats.accuracy)) {
                fp = `w|${n}|${fix(stats.damage)}|${fix(stats.accuracy)}`;
            } else if (fix(stats.defence)) {
                const bonuses = (stats.bonuses ?? [])
                    .map((b) => `${String(b.name).toLowerCase().replace(/[|,:]/g, '')}:${b.value}`)
                    .sort()
                    .join(',');
                fp = `a|${n}|${fix(stats.defence)}|${bonuses}`;
            }
            return Data.isFingerprint(fp) ? fp : '';
        },

        /**
         * Armory ID from a React id: ".1.2.1.$=10:0.2:$Secondary.$13077564088"
         * (item list) or ".0.3.0.$13077564088" (confirmation list, no category).
         * @param {string|null|undefined} reactId - data-reactid value.
         * @returns {{id: string, category: string}|null} Parsed parts, or null.
         */
        parseTradeReactId(reactId) {
            const m = /(?:\$([^.$]+)\.)?\.?\$(\d{1,20})$/.exec(String(reactId ?? ''));
            return m ? { category: m[1] ?? '', id: m[2] } : null;
        },

        /**
         * Armory ID from a trade "remove" link (…&armoryID=13077564088&…).
         * @param {string|null|undefined} href - Link href.
         * @returns {string|undefined} Armory ID.
         */
        armoryIdFromHref(href) {
            return /[?&#]armoryID=(\d{1,20})(?:&|$)/.exec(String(href ?? ''))?.[1];
        },

        /**
         * Item type ID from an item image URL (/images/items/18/large.png).
         * @param {string|null|undefined} src - Image src.
         * @returns {string} Item ID or ''.
         */
        itemIdFromImage(src) {
            return /\/images\/items\/(\d{1,10})\//.exec(String(src ?? ''))?.[1] ?? '';
        },

        /**
         * Short non-cryptographic hash (FNV-1a), used to fingerprint settings
         * without storing the API key a second time.
         * @param {string} text - Input.
         * @returns {string} 8-character hex hash.
         */
        hash(text) {
            let h = 0x811c9dc5;
            for (let i = 0; i < text.length; i += 1) {
                h ^= text.charCodeAt(i);
                h = Math.imul(h, 0x01000193) >>> 0;
            }
            return h.toString(16).padStart(8, '0');
        },

        /**
         * Readable message for a Torn API error code.
         * @param {number} code - ApiError code.
         * @returns {string} Message.
         */
        tornErrorMessage(code) {
            return CONFIG.TORN_ERRORS[code] ?? `Torn API error ${code}.`;
        },
    };

    /* =========================================================================
     * CACHE (in-memory copy of the notes database, backed by GM storage)
     * -------------------------------------------------------------------------
     * Reads come from memory. Every write re-reads storage first, applies the
     * change, then writes, so two open Torn tabs do not overwrite each other.
     * If stored data is ever unreadable, the store goes read-only rather than
     * silently replacing it.
     * ====================================================================== */

    const NoteStore = {
        /** @type {NoteDb} */
        _db: Data.emptyDb(),
        _readOnly: false,

        /**
         * Load notes from GM storage into memory.
         * @returns {void}
         * @throws {Error} If stored data is corrupt (store becomes read-only).
         */
        load() {
            try {
                const { db, skipped } = Data.normalizeDb(Storage.read(CONFIG.STORAGE_KEY, null));
                this._db = db;
                if (skipped) log(`Dropped ${skipped} invalid stored entries on load.`);
            } catch (err) {
                this._readOnly = true;
                throw err;
            }
        },

        /**
         * Get the note for an armory ID.
         * @param {string} id - Armory ID.
         * @returns {Note|null} The note or null.
         */
        get(id) {
            return this._db.notes[id] ?? null;
        },

        /**
         * Snapshot of the current database.
         * @returns {NoteDb} Database (treat as read-only).
         */
        snapshot() {
            return this._db;
        },

        /**
         * Number of stored notes.
         * @returns {number} Count.
         */
        count() {
            return Object.keys(this._db.notes).length;
        },

        /**
         * Whether stored data was unreadable at load time.
         * @returns {boolean} True if writes other than Replace/Clear are blocked.
         */
        isReadOnly() {
            return this._readOnly;
        },

        /**
         * Read-modify-write against fresh storage.
         * @param {(notes: Object<string, Note>) => (Object<string, Note>|void)} fn - Mutator; may return a replacement notes object.
         * @param {Object} [opts] - Options.
         * @param {boolean} [opts.overwrite=false] - Skip reading storage and write a full replacement
         *   (used by Replace/Clear, which are also the way out of the read-only state).
         * @returns {void}
         * @throws {Error} If the store is read-only (non-overwrite) or storage fails.
         */
        _mutate(fn, { overwrite = false } = {}) {
            if (this._readOnly && !overwrite) {
                throw new Error('Notes are read-only because stored data could not be read. Use Import > Replace all, or Clear all notes.');
            }
            const db = overwrite ? Data.emptyDb() : Data.normalizeDb(Storage.read(CONFIG.STORAGE_KEY, null)).db;
            const replaced = fn(db.notes);
            if (replaced) db.notes = replaced;
            Storage.write(CONFIG.STORAGE_KEY, db);
            this._db = db;
            this._readOnly = false;
        },

        /**
         * Create or update a note.
         * @param {string} id - Armory ID.
         * @param {Omit<Note, 'updated'>} fields - Note fields.
         * @returns {void}
         * @throws {Error} On invalid ID or storage failure.
         */
        upsert(id, fields) {
            if (!Data.isValidArmoryId(id)) throw new Error('Invalid armory ID.');
            const note = Data.normalizeNote({ ...fields, updated: Date.now() });
            this._mutate((notes) => {
                if (note) notes[id] = note;
                else delete notes[id];
            });
        },

        /**
         * Delete a note.
         * @param {string} id - Armory ID.
         * @returns {void}
         */
        remove(id) {
            this._mutate((notes) => {
                delete notes[id];
            });
        },

        /**
         * Merge imported notes (newer wins).
         * @param {NoteDb} incoming - Imported database.
         * @returns {{added: number, updated: number, kept: number}} Merge stats.
         */
        merge(incoming) {
            let stats = { added: 0, updated: 0, kept: 0 };
            this._mutate((notes) => {
                const result = Data.mergeNotes(notes, incoming.notes);
                stats = { added: result.added, updated: result.updated, kept: result.kept };
                return result.notes;
            });
            return stats;
        },

        /**
         * Replace every note with an imported set.
         * @param {NoteDb} incoming - Imported database.
         * @returns {void}
         */
        replaceAll(incoming) {
            this._mutate(() => ({ ...incoming.notes }), { overwrite: true });
        },

        /**
         * Delete all notes.
         * @returns {void}
         */
        clear() {
            this._mutate(() => ({}), { overwrite: true });
        },

        /**
         * Delete several notes at once (after a successful upload).
         * @param {string[]} ids - Armory IDs.
         * @returns {void}
         */
        removeMany(ids) {
            if (!ids.length) return;
            this._mutate((notes) => {
                for (const id of ids) delete notes[id];
            });
        },
    };

    /* ---- Settings (API key + display; the server URL is built in) ---------- */

    const SettingsStore = {
        /** @type {Settings|null} Memory copy (settings change only through set()). */
        _mem: null,

        /**
         * Current settings (defaults filled in).
         * @returns {Settings} Settings (treat as read-only).
         */
        get() {
            if (!this._mem) {
                const raw = Storage.readSafe(CONFIG.SETTINGS_KEY, null) ?? {};
                this._mem = Object.freeze({
                    // Built in; a URL saved by an older version is ignored.
                    serverUrl: CONFIG.DEFAULT_SERVER_URL,
                    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
                    showEmptyTags: raw.showEmptyTags !== false,
                });
            }
            return this._mem;
        },

        /**
         * Save settings (merged with the current ones; the server URL is not stored).
         * @param {Partial<Settings>} changes - Fields to change (already validated).
         * @returns {void}
         */
        set(changes) {
            const cur = this.get();
            Storage.write(CONFIG.SETTINGS_KEY, {
                apiKey: changes.apiKey ?? cur.apiKey,
                showEmptyTags: changes.showEmptyTags ?? cur.showEmptyTags,
            });
            this._mem = null;
        },
    };

    /* ---- Faction notes cache ----------------------------------------------- */
    // In-memory copy of the faction notes, persisted to GM storage so pages
    // render instantly and still show notes while the server is unreachable.

    const SharedStore = {
        /** @type {Object<string, SharedNote>} */
        _notes: {},
        /** Highest server `updated` seen; next poll asks for changes since then. */
        _since: 0,
        _fetchedAt: 0,
        _serverUrl: '',
        /** @type {Promise<string[]>|null} */
        _inflight: null,
        /** Bumped on every reset so a refresh started before it is discarded. */
        _gen: 0,
        /** @type {Map<string, string|null>|null} fingerprint -> armory ID (null if ambiguous). */
        _fpIndex: null,
        /** @type {Object<string, string>} armory ID -> lender (items borrowed by the faction). */
        _borrowed: {},
        /** Server's version of the borrowed list ('' = not loaded this page). */
        _bv: '',

        /**
         * Who lent this item to the faction ('' if not borrowed).
         * @param {string} id - Armory ID.
         * @returns {string} Lender's name.
         */
        borrowedFrom(id) {
            return Object.hasOwn(this._borrowed, id) ? this._borrowed[id] : '';
        },

        /**
         * Update one item's lender locally after an editor changed it.
         * @param {string} id - Armory ID.
         * @param {string} from - Lender ('' = not borrowed).
         * @returns {void}
         */
        setBorrowed(id, from) {
            if (from) this._borrowed[id] = from;
            else delete this._borrowed[id];
        },

        /**
         * Load the cache for the configured server (discarded if for another server).
         * @returns {void}
         */
        load() {
            const url = SettingsStore.get().serverUrl;
            this._reset(url);
            const c = Storage.readSafe(CONFIG.SHARED_CACHE_KEY, null);
            if (!c || c.version !== CONFIG.SHARED_CACHE_VERSION || c.serverUrl !== url || !url) return;
            if (!c.notes || typeof c.notes !== 'object') return;
            for (const [id, value] of Object.entries(c.notes)) {
                const n = Data.normalizeSharedNote({ ...value, armoryId: id });
                if (n?.note) this._notes[id] = n.note;
            }
            this._since = Number.isFinite(c.since) ? c.since : 0;
            const fetched = Storage.readSafe(CONFIG.SHARED_FETCHED_KEY, 0);
            this._fetchedAt = Number.isFinite(fetched) ? fetched : 0;
        },

        /**
         * Empty the in-memory cache.
         * @param {string} serverUrl - Server the cache now belongs to.
         * @returns {void}
         */
        _reset(serverUrl) {
            this._gen += 1;
            this._inflight = null;
            this._fpIndex = null;
            this._notes = {};
            this._borrowed = {};
            this._bv = '';
            this._since = 0;
            this._fetchedAt = 0;
            this._serverUrl = serverUrl;
        },

        /**
         * Delete the cache from memory and storage.
         * @returns {void}
         */
        clear() {
            this._reset(SettingsStore.get().serverUrl);
            Storage.write(CONFIG.SHARED_CACHE_KEY, null);
            Storage.write(CONFIG.SHARED_FETCHED_KEY, 0);
        },

        /**
         * Persist the cache.
         * @returns {void}
         */
        _persist() {
            Storage.write(CONFIG.SHARED_CACHE_KEY, {
                version: CONFIG.SHARED_CACHE_VERSION,
                serverUrl: this._serverUrl,
                since: this._since,
                notes: this._notes,
            });
        },

        /**
         * Faction note for an armory ID.
         * @param {string} id - Armory ID.
         * @returns {SharedNote|null} Note or null.
         */
        get(id) {
            return this._notes[id] ?? null;
        },

        /**
         * All cached faction notes (treat as read-only).
         * @returns {Object<string, SharedNote>} Notes by armory ID.
         */
        notes() {
            return this._notes;
        },

        /**
         * Epoch ms of the last successful refresh (0 = never).
         * @returns {number} Timestamp.
         */
        fetchedAt() {
            return this._fetchedAt;
        },

        /**
         * Apply server notes (including deletions) to the cache.
         * @param {unknown[]} list - ServerNote objects.
         * @param {{advanceSince?: boolean}} [opts] - advanceSince: move the poll
         *   marker forward. Only full poll results may do this; a single saved
         *   note must not, or other editors' slightly older changes are skipped.
         * @returns {string[]} Armory IDs whose note changed.
         */
        apply(list, { advanceSince = true } = {}) {
            const changed = [];
            for (const raw of list) {
                const n = Data.normalizeSharedNote(raw);
                if (!n) continue;
                if (advanceSince && Number.isFinite(n.changed)) this._since = Math.max(this._since, n.changed);
                const prev = this._notes[n.id];
                if (!n.note) {
                    if (prev) {
                        delete this._notes[n.id];
                        changed.push(n.id);
                    }
                } else if (!prev || Data.noteSignature(prev) !== Data.noteSignature(n.note)
                    || prev.updatedById !== n.note.updatedById || prev.fingerprint !== n.note.fingerprint
                    || prev.bonuses !== n.note.bonuses) {
                    this._notes[n.id] = n.note;
                    changed.push(n.id);
                }
            }
            if (changed.length) this._fpIndex = null;
            return changed;
        },

        /**
         * Armory ID of the faction note whose item has this fingerprint.
         * @param {string} fp - Fingerprint.
         * @returns {string|undefined} Armory ID, or undefined if none or more than one.
         */
        idByFingerprint(fp) {
            if (!fp) return undefined;
            if (!this._fpIndex) {
                this._fpIndex = new Map();
                for (const [id, note] of Object.entries(this._notes)) {
                    if (!note.fingerprint) continue;
                    // Two notes with identical stats: refuse to guess.
                    this._fpIndex.set(note.fingerprint, this._fpIndex.has(note.fingerprint) ? null : id);
                }
            }
            return this._fpIndex.get(fp) ?? undefined;
        },

        /**
         * Apply server notes from an editor action (no poll marker change) and save.
         * @param {unknown[]} list - ServerNote objects.
         * @returns {string[]} Changed IDs.
         */
        applyOwn(list) {
            const changed = this.apply(list, { advanceSince: false });
            if (changed.length) this._persist();
            return changed;
        },

        /**
         * Fetch changes from the server (one request at a time).
         * @returns {Promise<string[]>} Armory IDs whose note changed.
         * @throws {ServerError} On server/network/auth failure.
         */
        refresh() {
            if (!this._inflight) {
                const p = this._refresh().finally(() => {
                    if (this._inflight === p) this._inflight = null;
                });
                this._inflight = p;
            }
            return this._inflight;
        },

        /**
         * Refresh implementation (pages through results if the server has more).
         * @returns {Promise<string[]>} Changed IDs.
         */
        async _refresh() {
            const url = SettingsStore.get().serverUrl;
            if (url !== this._serverUrl) this._reset(url);
            const gen = this._gen;
            const sinceBefore = this._since;
            const changed = [];
            for (let page = 0; page < CONFIG.SHARED_MAX_PAGES; page += 1) {
                const data = await Server.request('GET', `/notes?since=${encodeURIComponent(String(this._since))}&bv=${encodeURIComponent(this._bv)}`);
                // The cache was cleared or the server changed while waiting: drop this result.
                if (gen !== this._gen) return [];
                if (!data || !Array.isArray(data.notes)) throw new ServerError('bad_response', 'Unexpected response from the notes server.');
                changed.push(...this.apply(data.notes));
                if (data.borrowed && typeof data.borrowed === 'object') this._borrowed = { ...data.borrowed };
                if (typeof data.borrowVersion === 'string') this._bv = data.borrowVersion;
                if (typeof data.canEdit === 'boolean') Session.setCanEdit(data.canEdit);
                if (typeof data.isAdmin === 'boolean') Session.setIsAdmin(data.isAdmin);
                if (data.sync && typeof data.sync === 'object') SyncHealth.update(data.sync);
                UpdateCheck.check(data.minScriptVersion);
                if (!data.hasMore) break;
            }
            this._fetchedAt = Date.now();
            Storage.write(CONFIG.SHARED_FETCHED_KEY, this._fetchedAt);
            // The poll query uses >=, so the newest note comes back every time;
            // only rewrite the cache when something actually changed.
            if (changed.length || this._since !== sinceBefore) this._persist();
            return changed;
        },

        /**
         * Create or update a faction note (editors only; server enforces it).
         * @param {string} id - Armory ID.
         * @param {{label: string, color: string, text: string, itemName: string, itemId: string}} fields - Note fields.
         * @returns {Promise<void>}
         * @throws {ServerError} On failure.
         */
        async save(id, fields) {
            const data = await Server.request('PUT', `/notes/${encodeURIComponent(id)}`, { body: fields });
            this.applyOwn([data?.note]);
        },

        /**
         * Delete a faction note (editors only).
         * @param {string} id - Armory ID.
         * @returns {Promise<void>}
         * @throws {ServerError} On failure.
         */
        async remove(id) {
            const data = await Server.request('DELETE', `/notes/${encodeURIComponent(id)}`);
            this.applyOwn([data?.note ?? { armoryId: id, deleted: true, updated: Date.now() }]);
        },

        /**
         * Upload notes; the server never overwrites an existing faction note.
         * Sent in chunks limited by count and by size.
         * @param {Array<Note & {armoryId: string}>} notes - Notes to upload.
         * @returns {Promise<{added: string[], skipped: string[], invalid: string[]}>} Result.
         * @throws {ServerError} On failure. `err.partial` holds the result of the
         *   chunks that were saved before the failure.
         */
        async importNotes(notes) {
            const result = { added: [], skipped: [], invalid: [] };
            try {
                for (const chunk of Data.chunkForUpload(notes, CONFIG.UPLOAD_CHUNK, CONFIG.UPLOAD_MAX_BYTES)) {
                    const data = await Server.request('POST', '/notes/import', { body: { notes: chunk } });
                    for (const key of ['added', 'skipped', 'invalid']) {
                        if (Array.isArray(data?.[key])) result[key].push(...data[key].map(String));
                    }
                }
            } catch (err) {
                if (err && typeof err === 'object') err.partial = result;
                throw err;
            }
            return result;
        },
    };

    /* ---- Armory IDs seen in the faction armory ---------------------------- */
    // Only used to pre-tick the "Upload local notes" list.

    const SeenIds = {
        /** @type {Set<string>|null} */
        _set: null,
        _flush: null,

        /**
         * Lazily load the set.
         * @returns {Set<string>} Seen IDs.
         */
        _load() {
            if (!this._set) {
                const arr = Storage.readSafe(CONFIG.SEEN_FACTION_KEY, []);
                this._set = new Set(Array.isArray(arr) ? arr.filter((id) => Data.isValidArmoryId(id)) : []);
                this._flush = debounce(() => {
                    Storage.write(CONFIG.SEEN_FACTION_KEY, [...this._set].slice(-CONFIG.SEEN_MAX));
                }, CONFIG.SEEN_FLUSH_MS);
            }
            return this._set;
        },

        /**
         * Remember an armory ID (saved shortly after).
         * @param {string} id - Armory ID.
         * @returns {void}
         */
        add(id) {
            const set = this._load();
            if (set.has(id)) return;
            set.add(id);
            this._flush();
        },

        /**
         * Whether an ID has been seen in the faction armory.
         * @param {string} id - Armory ID.
         * @returns {boolean} True if seen.
         */
        has(id) {
            return this._load().has(id);
        },
    };

    /* ---- Fingerprint backfill (editors only) ------------------------------- */
    // When an editor's browser shows a noted item with stats, its fingerprint
    // is sent so everyone can match the item on trade pages, where Torn shows
    // no ID for the other person's items. Batched, and each ID/fingerprint pair
    // is sent at most once per page load.

    const FingerprintSync = {
        /** @type {Map<string, {fp: string, bonuses: string}>} */
        _queue: new Map(),
        /** @type {Map<string, string>} ID -> "fp\nbonuses" already sent. */
        _sent: new Map(),
        _timer: 0,

        /**
         * Queue a noted item's fingerprint and bonus text (no-op unless needed).
         * @param {string} id - Armory ID.
         * @param {string} fp - Fingerprint.
         * @param {string} bonuses - Bonus text ("22% Execute").
         * @returns {void}
         */
        offer(id, fp, bonuses) {
            if (!Data.isFingerprint(fp) || !Data.isBonusText(bonuses) || !Shared.isActive() || !Shared.canEdit()) return;
            const note = SharedStore.get(id);
            const key = `${fp}\n${bonuses}`;
            if (!note || (note.fingerprint === fp && note.bonuses === bonuses) || this._sent.get(id) === key) return;
            this._queue.set(id, { fp, bonuses });
            clearTimeout(this._timer);
            this._timer = setTimeout(() => {
                this.flush().catch((err) => handleSharedError('Faction notes', err, { quiet: true }));
            }, CONFIG.FINGERPRINT_FLUSH_MS);
        },

        /**
         * Send queued fingerprints.
         * @returns {Promise<void>}
         * @throws {ServerError} On failure.
         */
        async flush() {
            const items = [...this._queue].map(([armoryId, v]) => ({ armoryId, fingerprint: v.fp, bonuses: v.bonuses }));
            this._queue.clear();
            for (const it of items) this._sent.set(it.armoryId, `${it.fingerprint}\n${it.bonuses}`);
            for (let i = 0; i < items.length; i += CONFIG.FINGERPRINT_BATCH) {
                const data = await Server.request('POST', '/notes/fingerprints', { body: { items: items.slice(i, i + CONFIG.FINGERPRINT_BATCH) } });
                if (Array.isArray(data?.notes) && SharedStore.applyOwn(data.notes).length) rescanDynamic();
                log(`Recorded ${data?.updated ?? 0} fingerprint(s)`);
            }
        },
    };

    /* ---- Bonus items seen in the Faction Armory (editors only) -------------- */
    // Every weapon/armor with a bonus that an editor's browser sees in the
    // armory is reported once, then again only if it changes or 12 hours have
    // passed (to keep "last seen" current). These are not notes: they only
    // feed the faction's spreadsheet export.

    const ItemSync = {
        /** @type {Map<string, Object>} */
        _queue: new Map(),
        /** @type {{serverUrl: string, items: Object<string, [string, number]>}|null} id -> [key, sentAt] */
        _sent: null,
        _timer: 0,

        /**
         * Load the "already reported" map (reset when the server changes).
         * @returns {{serverUrl: string, items: Object<string, [string, number]>}} Map.
         */
        _load() {
            const url = SettingsStore.get().serverUrl;
            if (!this._sent || this._sent.serverUrl !== url) {
                const stored = Storage.readSafe(CONFIG.ITEMS_SENT_KEY, null);
                this._sent = stored && stored.serverUrl === url && stored.items && typeof stored.items === 'object'
                    ? stored
                    : { serverUrl: url, items: {} };
            }
            return this._sent;
        },

        /**
         * Report a bonus item if it is new, changed or due for a "last seen" refresh.
         * @param {string} id - Armory ID.
         * @param {{itemName: string, itemId: string, category: string, fingerprint: string, bonuses: string}} item - Item.
         * @returns {void}
         */
        offer(id, item) {
            if (!item.bonuses || !Data.isBonusText(item.bonuses) || !Data.isFingerprint(item.fingerprint)) return;
            if (!Shared.isActive() || !Shared.canEdit()) return;
            const key = `${item.fingerprint}\n${item.bonuses}\n${item.itemName}`;
            const prev = this._load().items[id];
            if (prev && prev[0] === key && Date.now() - prev[1] < CONFIG.ITEM_RESEEN_MS) return;
            if (this._queue.has(id)) return;
            this._queue.set(id, { armoryId: id, ...item, _key: key });
            clearTimeout(this._timer);
            this._timer = setTimeout(() => {
                this.flush().catch((err) => handleSharedError('Faction notes', err, { quiet: true }));
            }, CONFIG.FINGERPRINT_FLUSH_MS);
        },

        /**
         * Send queued items and remember them.
         * @returns {Promise<void>}
         * @throws {ServerError} On failure (unsent items are retried on a later view).
         */
        async flush() {
            const items = [...this._queue.values()];
            this._queue.clear();
            for (let i = 0; i < items.length; i += CONFIG.ITEM_BATCH) {
                const chunk = items.slice(i, i + CONFIG.ITEM_BATCH);
                await Server.request('POST', '/items/seen', { body: { items: chunk.map(({ _key, ...rest }) => rest) } });
                const sent = this._load();
                const now = Date.now();
                for (const it of chunk) sent.items[it.armoryId] = [it._key, now];
                const ids = Object.keys(sent.items);
                if (ids.length > CONFIG.ITEMS_SENT_MAX) {
                    ids.sort((a, b) => sent.items[a][1] - sent.items[b][1]);
                    for (const old of ids.slice(0, ids.length - CONFIG.ITEMS_SENT_MAX)) delete sent.items[old];
                }
                Storage.write(CONFIG.ITEMS_SENT_KEY, sent);
                log(`Reported ${chunk.length} bonus item(s)`);
            }
        },
    };

    /* =========================================================================
     * API (faction notes server)
     * -------------------------------------------------------------------------
     * The script never calls api.torn.com itself. It talks only to the
     * faction's notes server, which makes the one Torn API call needed to
     * verify a member at sign-in (GET /v2/user?selections=basic,faction,
     * Public key, comment=ArmoryNotes).
     * ====================================================================== */

    /** Error from the notes server, the network, or sign-in. */
    class ServerError extends Error {
        /**
         * @param {string} code - Machine code (server code, or 'network', 'timeout', ...).
         * @param {string} message - Readable message.
         * @param {Object} [extra] - { status, tornCode, needsKey, transient }.
         */
        constructor(code, message, extra = {}) {
            super(message);
            this.name = 'ServerError';
            this.code = code;
            this.status = extra.status ?? 0;
            this.tornCode = extra.tornCode;
            /** True when the user must fix their key in Settings. */
            this.needsKey = Boolean(extra.needsKey);
            /** True when retrying later may succeed. */
            this.transient = Boolean(extra.transient);
        }
    }

    /**
     * Promise wrapper around GM_xmlhttpRequest.
     * @param {{method: string, url: string, headers: Object<string,string>, body?: string}} req - Request.
     * @returns {Promise<{status: number, text: string}>} Response.
     * @throws {ServerError} On network failure or timeout.
     */
    function gmRequest(req) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: req.method,
                url: req.url,
                headers: req.headers,
                data: req.body,
                timeout: CONFIG.REQUEST_TIMEOUT_MS,
                onload: (res) => resolve({ status: res.status, text: res.responseText ?? '' }),
                onerror: () => reject(new ServerError('network', 'Could not reach the faction notes server.', { transient: true })),
                ontimeout: () => reject(new ServerError('timeout', 'The faction notes server did not respond in time.', { transient: true })),
                onabort: () => reject(new ServerError('aborted', 'Request was cancelled.', { transient: true })),
            });
        });
    }

    /** Sliding-window rate limiter: waits until a slot is free. */
    class RateLimiter {
        /**
         * @param {number} max - Requests allowed per window.
         * @param {number} windowMs - Window length.
         */
        constructor(max, windowMs) {
            this.max = max;
            this.windowMs = windowMs;
            /** @type {number[]} */
            this.stamps = [];
            this.chain = Promise.resolve();
        }

        /**
         * Reserve a slot (requests are released in order).
         * @returns {Promise<void>} Resolves when the request may go.
         */
        acquire() {
            const take = async () => {
                for (;;) {
                    const now = Date.now();
                    this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
                    if (this.stamps.length < this.max) {
                        this.stamps.push(now);
                        return;
                    }
                    await new Promise((r) => setTimeout(r, this.windowMs - (now - this.stamps[0]) + 10));
                }
            };
            const slot = this.chain.then(take);
            this.chain = slot.catch(() => {});
            return slot;
        }
    }

    const Server = {
        _limiter: new RateLimiter(CONFIG.SERVER_RATE_LIMIT.MAX, CONFIG.SERVER_RATE_LIMIT.WINDOW_MS),

        /**
         * Call the notes server.
         * @param {'GET'|'POST'|'PUT'|'DELETE'} method - HTTP method.
         * @param {string} path - Path starting with '/'.
         * @param {Object} [opts] - Options.
         * @param {Object} [opts.body] - JSON body.
         * @param {boolean} [opts.auth=true] - Attach the session token (signing in if needed).
         * @param {boolean} [opts.retried=false] - Internal: already retried after an expired token.
         * @returns {Promise<any>} Parsed JSON.
         * @throws {ServerError} On any failure.
         */
        async request(method, path, { body, auth = true, retried = false } = {}) {
            let { serverUrl } = SettingsStore.get();
            if (!serverUrl) throw new ServerError('not_configured', 'Faction sharing is not set up in this copy of the script.');
            const headers = { Accept: 'application/json' };
            if (body !== undefined) headers['Content-Type'] = 'application/json';
            if (auth) {
                const session = await Session.ensure();
                headers.Authorization = `Bearer ${session.token}`;
                serverUrl = session.serverUrl; // the token only belongs to the server that issued it
            }
            await this._limiter.acquire();
            const res = await gmRequest({ method, url: serverUrl + path, headers, body: body === undefined ? undefined : JSON.stringify(body) });

            let data = null;
            try {
                data = res.text ? JSON.parse(res.text) : null;
            } catch (err) {
                data = null;
            }
            if (res.status >= 200 && res.status < 300 && data) return data;

            const e = data?.error ?? {};
            const code = typeof e.code === 'string' ? e.code : `http_${res.status}`;
            const message = typeof e.message === 'string' && e.message
                ? e.message
                : `Faction notes server error (HTTP ${res.status}). Try again later.`;
            const err = new ServerError(code, message, {
                status: res.status,
                tornCode: Number.isInteger(e.tornCode) ? e.tornCode : undefined,
                transient: res.status >= 500 || res.status === 429,
            });
            if (auth && !retried && res.status === 401 && code.startsWith('token_')) {
                Session.clear(); // token expired or server secret changed: sign in again once
                return this.request(method, path, { body, auth, retried: true });
            }
            if (code === 'not_editor') Session.setCanEdit(false);
            throw err;
        },
    };

    /**
     * Armory sync health, as sent to editors with GET /notes.
     * @typedef {Object} SyncHealthInfo
     * @property {boolean} configured     - ARMORY_API_KEY is set on the server.
     * @property {(number|null)} lastOk   - Last successful sync (epoch ms).
     * @property {string} lastError       - Last failure message ('' if none).
     * @property {(number|null)} lastErrorAt - Last failure time (epoch ms).
     */

    /**
     * Warns editors on the Faction Armory, once per page load, when the armory
     * sync is broken or stale. Uses data that comes with the notes, so it adds
     * no requests.
     */
    const SyncHealth = {
        _warned: false,

        /**
         * Problem with the sync, if any (pure).
         * @param {SyncHealthInfo} h - Health from the server.
         * @param {number} now - Epoch ms.
         * @returns {string} Readable problem, or '' when healthy (or not set up).
         */
        problem(h, now) {
            if (!h?.configured) return '';
            const lastOk = Number(h.lastOk) || 0;
            const lastErrorAt = Number(h.lastErrorAt) || 0;
            if (lastErrorAt > lastOk && h.lastError) {
                return `Armory sync failed (${h.lastError}). Check that the sync key still exists in Torn and that its owner has faction API access.`;
            }
            if (!lastOk) return 'The armory sync has not run yet. Use Tampermonkey menu > Editor tools > Sync armory now.';
            if (now - lastOk > CONFIG.SYNC_STALE_MS) {
                return `The armory sync last worked ${Data.relativeTime(lastOk, now)} (it should run every 6 hours). Try Tampermonkey menu > Editor tools > Sync armory now.`;
            }
            return '';
        },

        /**
         * Show a warning once per page load, on the Faction Armory only.
         * @param {SyncHealthInfo} h - Health from the server.
         * @returns {void}
         */
        update(h) {
            if (this._warned || !PageState.factionArmoryOpen) return;
            const msg = this.problem(h, Date.now());
            if (!msg) return;
            this._warned = true;
            Notice.show(msg, true);
        },
    };

    /**
     * Tells members on an old script to update, at most once a day. The server
     * sends the oldest version it supports with sign-in and with the notes.
     */
    const UpdateCheck = {
        /**
         * This script's installed version (Tampermonkey's GM_info; '' if unavailable).
         * @returns {string} Version.
         */
        current() {
            try {
                return typeof GM_info !== 'undefined' ? String(GM_info?.script?.version ?? '') : '';
            } catch {
                return '';
            }
        },

        /**
         * Show the update notice if this script is older than `minVersion`
         * and the notice was not shown in the last 24 hours.
         * @param {unknown} minVersion - From the server.
         * @returns {void}
         */
        check(minVersion) {
            const cur = this.current();
            if (typeof minVersion !== 'string' || !minVersion || !cur) return;
            if (Data.compareVersions(cur, minVersion) >= 0) return;
            const now = Date.now();
            if (now - (Number(Storage.readSafe(CONFIG.UPDATE_NAG_KEY, 0)) || 0) < CONFIG.UPDATE_NAG_MS) return;
            Storage.write(CONFIG.UPDATE_NAG_KEY, now);
            Notice.show(`This script (version ${cur}) is out of date; your faction's server needs ${minVersion} or newer.`, true, {
                link: { text: 'Update now', href: CONFIG.INSTALL_URL },
                ms: CONFIG.NOTICE_MS * 4,
            });
        },
    };

    const Session = {
        /** @type {Session|null} */
        _mem: null,
        /** @type {Promise<Session>|null} */
        _inflight: null,
        /**
         * Last sign-in failure, so a bad key or non-member is not re-checked
         * with Torn on every poll. Permanent failures (wrong key, not in the
         * faction) are also saved, so they are not re-checked on every page
         * load either. Cleared when settings change or on Save & sign in.
         * @type {{sig: string, err: ServerError, until: number}|null}
         */
        _failure: null,
        _failureLoaded: false,

        /**
         * Settings fingerprint (a hash, so the key is not stored twice).
         * @param {Settings} s - Settings.
         * @returns {string} Fingerprint.
         */
        _sig(s) {
            return Data.hash(`${s.serverUrl}\n${s.apiKey}`);
        },

        /**
         * Current failure for these settings, loading a saved permanent one once.
         * @param {Settings} settings - Current settings.
         * @returns {{sig: string, err: ServerError, until: number}|null} Failure.
         */
        _currentFailure(settings) {
            if (!this._failure && !this._failureLoaded) {
                this._failureLoaded = true;
                const f = Storage.readSafe(CONFIG.AUTH_FAILURE_KEY, null);
                if (f && typeof f.sig === 'string' && typeof f.message === 'string') {
                    const err = new ServerError(String(f.code ?? 'auth_failed'), f.message, { needsKey: Boolean(f.needsKey) });
                    err.fromCache = true;
                    this._failure = { sig: f.sig, err, until: Infinity };
                }
            }
            const f = this._failure;
            return f && f.sig === this._sig(settings) && Date.now() < f.until ? f : null;
        },

        /**
         * Whether sign-in is known to fail until the user changes something
         * (wrong key, not in the faction).
         * @returns {boolean} True if blocked.
         */
        isBlocked() {
            return this._currentFailure(SettingsStore.get())?.until === Infinity;
        },

        /**
         * Message of the current sign-in failure, if any.
         * @returns {string} Message or ''.
         */
        failureMessage() {
            return this._currentFailure(SettingsStore.get())?.err.message ?? '';
        },

        /**
         * Forget any remembered sign-in failure (memory and storage).
         * @returns {void}
         */
        clearFailure() {
            this._failure = null;
            this._failureLoaded = true;
            Storage.write(CONFIG.AUTH_FAILURE_KEY, null);
        },

        /**
         * Current session without signing in (may be stale or null).
         * @returns {Session|null} Session.
         */
        peek() {
            if (!this._mem) this._mem = Storage.readSafe(CONFIG.SESSION_KEY, null);
            const s = this._mem;
            return s && s.serverUrl === SettingsStore.get().serverUrl ? s : null;
        },

        /**
         * Whether a session is usable right now.
         * @param {Session|null} s - Session.
         * @param {string} serverUrl - Configured server.
         * @returns {boolean} True if valid.
         */
        _valid(s, serverUrl) {
            return Boolean(s && typeof s.token === 'string' && s.serverUrl === serverUrl
                && s.expiresAt - CONFIG.TOKEN_RENEW_MARGIN_MS > Date.now());
        },

        /**
         * Return a valid session, signing in if needed (one sign-in at a time).
         * @returns {Promise<Session>} Session.
         * @throws {ServerError} If sign-in fails.
         */
        ensure() {
            const settings = SettingsStore.get();
            const stored = Storage.readSafe(CONFIG.SESSION_KEY, null); // another tab may have signed in
            if (this._valid(stored, settings.serverUrl)) {
                this._mem = stored;
                return Promise.resolve(stored);
            }
            const f = this._currentFailure(settings);
            if (f) return Promise.reject(f.err);
            if (!this._inflight) {
                this._inflight = this._signIn(settings).finally(() => {
                    this._inflight = null;
                });
            }
            return this._inflight;
        },

        /**
         * POST /auth with the stored key.
         * @param {Settings} settings - Current settings.
         * @returns {Promise<Session>} New session.
         * @throws {ServerError} With a readable message.
         */
        async _signIn(settings) {
            if (!settings.apiKey) {
                throw new ServerError('no_key', 'Add your Public API key with "Sign in" in the Tampermonkey menu to see faction notes.', { needsKey: true });
            }
            let data;
            try {
                data = await Server.request('POST', '/auth', { body: { key: settings.apiKey }, auth: false });
            } catch (err) {
                const mapped = this._mapAuthError(err);
                const sig = this._sig(settings);
                this._failure = { sig, err: mapped, until: mapped.transient ? Date.now() + CONFIG.BACKOFF_MS : Infinity };
                if (!mapped.transient) {
                    Storage.write(CONFIG.AUTH_FAILURE_KEY, { sig, code: mapped.code, message: mapped.message, needsKey: mapped.needsKey });
                }
                throw mapped;
            }
            if (!data || typeof data.token !== 'string' || !Number.isFinite(data.expiresAt)) {
                throw new ServerError('bad_response', 'Unexpected sign-in response from the notes server.');
            }
            /** @type {Session} */
            const session = {
                token: data.token,
                expiresAt: data.expiresAt,
                player: { id: Number(data.player?.id) || 0, name: String(data.player?.name ?? '') },
                faction: { id: Number(data.faction?.id) || 0, name: String(data.faction?.name ?? '') },
                canEdit: data.canEdit === true,
                isAdmin: data.isAdmin === true,
                serverUrl: settings.serverUrl,
            };
            this.clearFailure();
            UpdateCheck.check(data.minScriptVersion);
            this._mem = session;
            Storage.write(CONFIG.SESSION_KEY, session);
            ensureEditorMenu();
            log('Signed in as', session.player.name, session.canEdit ? '(editor)' : '(viewer)');
            return session;
        },

        /**
         * Turn a sign-in failure into a user-facing error.
         * @param {unknown} err - Raw error.
         * @returns {ServerError} Mapped error.
         */
        _mapAuthError(err) {
            if (!(err instanceof ServerError)) return new ServerError('unknown', String(err), { transient: true });
            if (err.code === 'torn_error') {
                const code = err.tornCode ?? 0;
                return new ServerError('torn_error', Data.tornErrorMessage(code), {
                    status: err.status,
                    tornCode: code,
                    needsKey: code === 1 || code === 2 || code === 16,
                    transient: TORN_TRANSIENT.has(code),
                });
            }
            if (err.code === 'bad_key_format') return new ServerError(err.code, err.message, { needsKey: true });
            if (err.code === 'torn_unreachable') return new ServerError(err.code, err.message, { transient: true });
            return err;
        },

        /**
         * Update the editor flag (the server re-checks it on every request).
         * @param {boolean} canEdit - New value.
         * @returns {void}
         */
        setCanEdit(canEdit) {
            const s = this.peek();
            if (!s || s.canEdit === canEdit) return;
            s.canEdit = canEdit;
            Storage.write(CONFIG.SESSION_KEY, s);
            ensureEditorMenu();
        },

        /**
         * Update the admin flag (the server re-checks it on every admin request).
         * @param {boolean} isAdmin - New value.
         * @returns {void}
         */
        setIsAdmin(isAdmin) {
            const s = this.peek();
            if (!s || s.isAdmin === isAdmin) return;
            s.isAdmin = isAdmin;
            Storage.write(CONFIG.SESSION_KEY, s);
        },

        /**
         * Forget the session and any remembered sign-in failure.
         * @returns {void}
         */
        clear() {
            this._mem = null;
            this.clearFailure();
            Storage.write(CONFIG.SESSION_KEY, null);
        },
    };

    /** Small facade used by the UI. */
    const Shared = {
        _lastError: '',

        /**
         * Whether faction sharing is configured (server URL set).
         * @returns {boolean} True if on.
         */
        isConfigured() {
            return Boolean(SettingsStore.get().serverUrl);
        },

        /**
         * Whether faction notes are in use: a server and key are set and sign-in
         * is not known to fail. Otherwise the Faction Armory uses private notes.
         * @returns {boolean} True if active.
         */
        isActive() {
            return this.isConfigured() && Boolean(SettingsStore.get().apiKey) && !Session.isBlocked();
        },

        /**
         * Whether the signed-in member may edit faction notes.
         * @returns {boolean} True for editors.
         */
        canEdit() {
            return Session.peek()?.canEdit === true;
        },

        /**
         * Refresh faction notes and re-render buttons. Errors are reported
         * (once per distinct message when quiet) and never thrown.
         * @param {{quiet?: boolean}} [opts] - quiet: used by background polling.
         * @returns {Promise<boolean>} True on success.
         */
        async refreshAndRender({ quiet = false } = {}) {
            if (!this.isActive()) return false;
            const before = `${this.isActive()}|${this.canEdit()}`;
            const stateChanged = () => before !== `${this.isActive()}|${this.canEdit()}`;
            try {
                const changed = await SharedStore.refresh();
                this._lastError = '';
                maybeShowHelp();
                if (stateChanged()) rerenderAll();
                else changed.forEach((id) => refreshId(id));
                if (changed.length) rescanDynamic();
                return true;
            } catch (err) {
                handleSharedError('Faction notes', err, { quiet });
                if (stateChanged()) rerenderAll(); // e.g. editor rights removed, or sign-in now blocked
                return false;
            }
        },
    };

    /* =========================================================================
     * UI
     * ====================================================================== */

    /**
     * Inject the script's scoped stylesheet.
     * @returns {void}
     */
    function injectStyles() {
        const z = CONFIG.Z_INDEX_BASE;
        const colorRules = CONFIG.COLORS
            .map((c) => `.${CLS.color(c.key)}{background:${c.bg} !important;color:${c.fg} !important;}`)
            .join('\n');
        const panel = 'background:#1f2329;color:#e6e6e6;border:1px solid #3a3f47;border-radius:6px;'
            + 'box-shadow:0 6px 18px rgba(0,0,0,.45);font:12px/1.4 Arial,Helvetica,sans-serif;';

        GM_addStyle(`
.${CLS.btn}{appearance:none;border:0;margin:0;padding:0 3px;background:none;font:inherit;font-size:11px;
  font-weight:700;line-height:16px;height:16px;cursor:pointer;box-sizing:border-box;display:inline-flex;
  align-items:center;gap:3px;vertical-align:middle;border-radius:8px;white-space:nowrap;overflow:hidden;color:inherit;}
.${CLS.btn}:focus-visible{outline:2px solid #4493f8;outline-offset:1px;}
.${CLS.btnEmpty}{color:#999;opacity:.55;background:transparent;}
.${CLS.btnEmpty}:hover,.${CLS.btnEmpty}:focus-visible{opacity:1;color:#bbb;}
.${CLS.btnNote}{padding:0 6px;}
.${CLS.label}{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.${CLS.icon}{flex:0 0 auto;width:11px;height:11px;}
.${CLS.kindPill}{margin-left:6px;max-width:${CONFIG.ITEMS_PILL_MAX_PX}px;}
.${CLS.thumbHost}{position:relative;}
.${CLS.kindBadge}{position:absolute;top:2px;left:2px;z-index:6;height:14px;line-height:14px;font-size:10px;
  max-width:calc(100% - 4px);}
.${CLS.kindBadge}.${CLS.btnEmpty}{opacity:0;background:rgba(0,0,0,.55);color:#ddd;}
.${CLS.thumbHost}:hover .${CLS.kindBadge}.${CLS.btnEmpty},
.${CLS.kindBadge}.${CLS.btnEmpty}:focus-visible{opacity:.9;}
.${CLS.factionHost}{position:relative !important;box-sizing:border-box !important;
  padding-right:${CONFIG.FACTION_PAD_EMPTY_PX}px !important;}
.${CLS.factionHostNote}{padding-right:${CONFIG.FACTION_PAD_NOTE_PX}px !important;}
.${CLS.kindFaction}{position:absolute;right:2px;top:50%;transform:translateY(-50%);
  max-width:${CONFIG.FACTION_PILL_MAX_PX}px;}
.${CLS.kindShared}{margin-left:4px;max-width:${CONFIG.ITEMS_PILL_MAX_PX}px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.55);}
.${CLS.kindTrade}{margin:0 4px;max-width:${CONFIG.ITEMS_PILL_MAX_PX}px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.55);
  float:none;vertical-align:middle;}
.${CLS.btnReadOnly}{cursor:help;}
.${CLS.btnHoverOnly}{opacity:0 !important;}
li:hover .${CLS.btnHoverOnly},.${CLS.thumbHost}:hover .${CLS.btnHoverOnly},
.${CLS.btnHoverOnly}:focus-visible{opacity:.55 !important;}
.${CLS.btnHidden}{display:none !important;}
${colorRules}
.${CLS.tip}{position:absolute;z-index:${z + 1};max-width:${CONFIG.TOOLTIP_MAX_PX}px;padding:6px 8px;
  pointer-events:none;${panel}}
.${CLS.tipTitle}{font-weight:700;margin-bottom:2px;}
.${CLS.tipBody}{white-space:pre-wrap;word-break:break-word;}
.${CLS.tipMeta}{margin-top:4px;color:#9aa0a6;font-size:11px;}
.${CLS.pop}{position:absolute;z-index:${z};width:${CONFIG.POPOVER_WIDTH_PX}px;padding:10px;box-sizing:border-box;${panel}}
.${CLS.popHead}{font-weight:700;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.${CLS.popSub}{color:#9aa0a6;font-size:11px;margin-bottom:8px;}
.${CLS.field}{display:block;margin:0 0 8px;}
.${CLS.field} > span{display:block;color:#9aa0a6;font-size:11px;margin-bottom:3px;}
.${CLS.pop} input,.${CLS.pop} textarea{width:100%;box-sizing:border-box;background:#14171b;color:#e6e6e6;
  border:1px solid #3a3f47;border-radius:4px;padding:4px 6px;font:12px Arial,Helvetica,sans-serif;}
.${CLS.pop} textarea{height:84px;resize:vertical;}
.${CLS.counter}{text-align:right;color:#9aa0a6;font-size:10px;margin-top:2px;}
.${CLS.swatches}{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 8px;}
.${CLS.swatch}{appearance:none;width:18px;height:18px;border-radius:50%;border:2px solid transparent;
  padding:0;cursor:pointer;box-sizing:border-box;}
.${CLS.swatchOn}{border-color:#ffffff;box-shadow:0 0 0 1px #000;}
.${CLS.actions}{display:flex;gap:6px;align-items:center;margin-top:4px;}
.${CLS.spacer}{flex:1 1 auto;}
.${CLS.uiBtn}{appearance:none;border:1px solid #3a3f47;background:#2b3038;color:#e6e6e6;border-radius:4px;
  padding:4px 10px;font:12px Arial,Helvetica,sans-serif;cursor:pointer;}
.${CLS.uiBtn}:hover{background:#353b45;}
.${CLS.uiBtn}:disabled{opacity:.45;cursor:default;}
.${CLS.uiPrimary}{background:#2f6fd0;border-color:#2f6fd0;color:#fff;}
.${CLS.uiPrimary}:hover{background:#3a7be0;}
.${CLS.uiDanger}{background:#7d2b2b;border-color:#a33;color:#fff;}
.${CLS.uiDanger}:hover{background:#933333;}
.${CLS.overlay}{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:${z + 2};display:flex;
  align-items:center;justify-content:center;}
.${CLS.modal}{width:340px;max-width:calc(100vw - 32px);padding:14px;box-sizing:border-box;${panel}}
.${CLS.modal} h3{margin:0 0 8px;font-size:14px;}
.${CLS.modalBody}{margin-bottom:10px;white-space:pre-wrap;}
.${CLS.modal} input[type="file"]{display:block;margin:8px 0;color:#e6e6e6;max-width:100%;}
.${CLS.modal} input[type="text"],.${CLS.modal} input[type="password"]{width:100%;box-sizing:border-box;background:#14171b;
  color:#e6e6e6;border:1px solid #3a3f47;border-radius:4px;padding:4px 6px;font:12px Arial,Helvetica,sans-serif;}
.${CLS.modal} select,.${CLS.modal} input[type="number"]{box-sizing:border-box;background:#14171b;color:#e6e6e6;
  border:1px solid #3a3f47;border-radius:4px;padding:4px 6px;font:12px Arial,Helvetica,sans-serif;min-width:0;}
.${CLS.addRow}{display:flex;gap:6px;align-items:center;margin:4px 0;}
.${CLS.addRow} select,.${CLS.addRow} input{flex:1 1 auto;}
.${CLS.dim}{color:#9aa0a6;font-size:11px;}
.${CLS.popMeta}{color:#9aa0a6;font-size:11px;margin:-4px 0 8px;}
.${CLS.status}{margin:4px 0 10px;color:#c9d1d9;white-space:pre-wrap;}
.${CLS.checklist}{max-height:240px;overflow:auto;border:1px solid #3a3f47;border-radius:4px;padding:4px;margin:6px 0 10px;}
.${CLS.checkRow}{display:flex;gap:6px;align-items:flex-start;padding:2px 0;cursor:pointer;}
.${CLS.checkRow} input{margin:2px 0 0;flex:0 0 auto;}
.${CLS.linkRow}{display:flex;gap:6px;}
.${CLS.logHost}{position:relative !important;}
.${CLS.logWrap}{position:absolute;right:12px;top:50%;transform:translateY(-50%);z-index:5;display:flex;gap:6px;align-items:center;}
.${CLS.logBox}{display:flex;align-items:center;
  gap:6px;font:bold 12px Arial,Helvetica,sans-serif;color:#e6e6e6;cursor:pointer;user-select:none;
  background:rgba(0,0,0,.35);border:1px solid #555;border-radius:4px;padding:3px 8px;}
.${CLS.logBox} input{margin:0;cursor:pointer;}
.${CLS.logBox}[aria-busy="true"]{opacity:.6;cursor:progress;}
.${CLS.logGroup}{border-bottom:1px solid #3a3f47;padding:6px 0;}
.${CLS.logGroup} > div:first-child{display:flex;align-items:center;gap:6px;font-weight:700;margin-bottom:3px;}
.${CLS.logItem}{display:flex;align-items:center;gap:6px;padding:2px 0 2px 8px;}
.${CLS.logItem} > span,.${CLS.logGroup} > div:first-child > span{flex:1 1 auto;}
.${CLS.notices}{position:fixed;right:16px;bottom:16px;z-index:${z + 3};display:flex;flex-direction:column;gap:6px;}
.${CLS.notice}{padding:8px 10px;max-width:320px;${panel}}
.${CLS.noticeError}{border-color:#d9534f;}
.${CLS.notice} a{color:#79c0ff;text-decoration:underline;}
.${CLS.noticeBtn}{margin-left:6px;padding:1px 8px;}
.${CLS.modalWide}{width:560px;}
.${CLS.help}{margin-bottom:12px;}
.${CLS.help} > div > h4:first-child{margin-top:0;}
.${CLS.helpTabs}{display:flex;gap:4px;border-bottom:1px solid #3a3f47;margin:0 0 12px;}
.${CLS.helpTab}{appearance:none;border:1px solid transparent;border-bottom:none;background:none;color:#9aa0a6;
  font:bold 12px Arial,Helvetica,sans-serif;padding:6px 12px;border-radius:5px 5px 0 0;cursor:pointer;margin-bottom:-1px;}
.${CLS.helpTab}[aria-selected="true"]{background:#14171b;color:#e6e6e6;border-color:#3a3f47;}
.${CLS.help} h4{margin:14px 0 8px;font-size:12px;color:#3fb950;text-transform:uppercase;letter-spacing:.04em;}
.${CLS.legend}{display:grid;grid-template-columns:118px 1fr;gap:9px 14px;align-items:center;margin-bottom:14px;}
.${CLS.legend} > div:nth-child(odd){display:flex;align-items:center;gap:6px;}
.${CLS.legend} .${CLS.btn}{cursor:default;margin:0;pointer-events:none;}
.${CLS.legend} .${CLS.btnEmpty}{opacity:.9;color:#bbb;}
.${CLS.legend} .${CLS.logBox}{position:static;transform:none;pointer-events:none;}
.${CLS.tips}{margin:0;padding:0;list-style:none;border-top:1px solid #3a3f47;}
.${CLS.tips} li{padding:7px 0 7px 14px;border-bottom:1px solid #2a2f36;position:relative;line-height:1.45;}
.${CLS.tips} li::before{content:"";position:absolute;left:2px;top:13px;width:5px;height:5px;border-radius:50%;background:#3fb950;}
.${CLS.tips} b{color:#e6e6e6;}
.${CLS.sample}{margin:0 0 12px;}
.${CLS.sample} .${CLS.logBox}{position:static;transform:none;display:inline-flex;pointer-events:none;}
.${CLS.inlineRow}{display:flex;align-items:center;gap:8px;margin:10px 0 14px;padding-top:10px;border-top:1px solid #3a3f47;
  color:#9aa0a6;font-size:11px;}
.${CLS.toolList}{display:flex;flex-direction:column;gap:8px;margin:4px 0 12px;}
.${CLS.toolList} > div{display:grid;grid-template-columns:150px 1fr;gap:10px;align-items:center;}
.${CLS.toolList} .${CLS.uiBtn}{width:100%;}
.${CLS.toolList} span{color:#9aa0a6;font-size:11px;}
.${CLS.popStatus}{font-size:11px;color:#ff9b94;margin:4px 0 0;white-space:pre-wrap;}
.${CLS.popStatus}:empty{display:none;}
.${CLS.popHelp}{float:right;appearance:none;border:1px solid #3a3f47;background:#14171b;color:#9aa0a6;border-radius:50%;
  width:18px;height:18px;line-height:16px;padding:0;font:bold 11px Arial,Helvetica,sans-serif;cursor:pointer;margin-left:6px;}
.${CLS.popHelp}:hover{color:#e6e6e6;border-color:#9aa0a6;}
.${CLS.logBoxNudge}{border-color:#e3b341;background:rgba(227,179,65,.25);box-shadow:0 0 0 2px rgba(227,179,65,.45);}
.${CLS.filterBar}{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 8px;font:12px Arial,Helvetica,sans-serif;
  color:inherit;border-bottom:1px solid rgba(128,128,128,.35);}
.${CLS.filterBar} input,.${CLS.filterBar} select{font:12px Arial,Helvetica,sans-serif;color:inherit;background:transparent;
  border:1px solid rgba(128,128,128,.55);border-radius:4px;padding:3px 6px;}
.${CLS.filterBar} input{flex:1 1 180px;min-width:120px;}
.${CLS.filterBar} select option{color:#000;}
.${CLS.filterBar} span{opacity:.75;margin-left:auto;white-space:nowrap;}
.${CLS.rowHidden}{display:none !important;}
`);
    }

    /**
     * Minimal element builder. Text is always set via textContent.
     * @param {string} tag - Tag name.
     * @param {Object} [props] - Options.
     * @param {string|string[]} [props.cls] - Class name(s).
     * @param {string} [props.text] - Text content.
     * @param {Object<string,string>} [props.attrs] - Attributes to set.
     * @param {Node[]} [children] - Child nodes.
     * @returns {HTMLElement} The element.
     */
    function el(tag, props = {}, children = []) {
        const node = document.createElement(tag);
        if (props.cls) node.className = Array.isArray(props.cls) ? props.cls.join(' ') : props.cls;
        if (props.text !== undefined) node.textContent = props.text;
        for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
        for (const child of children) if (child) node.append(child);
        return node;
    }

    /**
     * Build the small tag SVG icon.
     * @returns {SVGElement} Icon element.
     */
    function createTagIcon() {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('class', CLS.icon);
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('fill-rule', 'evenodd');
        path.setAttribute('d', 'M1 1h6.6L15 8.4 8.4 15 1 7.6V1zm3.5 2a1.5 1.5 0 100 3 1.5 1.5 0 000-3z');
        svg.append(path);
        return svg;
    }

    /**
     * Build the small "faction" (two people) SVG icon used on shared pills.
     * @returns {SVGElement} Icon element.
     */
    function createSharedIcon() {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('class', CLS.icon);
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('d', 'M5.5 2a2.5 2.5 0 110 5 2.5 2.5 0 010-5zm5.5 1a2 2 0 110 4 2 2 0 010-4zM0 14c0-2.8 2.2-5 5-5h1c2.8 0 5 2.2 5 5H0zm12 0c0-1.7-.6-3.2-1.6-4.4.2 0 .4-.1.6-.1h.5c2.5 0 4.5 2 4.5 4.5H12z');
        svg.append(path);
        return svg;
    }

    /**
     * Position a floating element below (or above) an anchor, clamped to the viewport.
     * @param {HTMLElement} floating - Element with position:absolute, already in the DOM.
     * @param {Element} anchor - Reference element.
     * @returns {void}
     */
    function placeNear(floating, anchor) {
        const r = anchor.getBoundingClientRect();
        const f = floating.getBoundingClientRect();
        const gap = CONFIG.FLOAT_GAP_PX;
        const margin = CONFIG.VIEWPORT_MARGIN_PX;
        let top = r.bottom + gap;
        if (top + f.height > window.innerHeight - margin && r.top - gap - f.height > margin) {
            top = r.top - gap - f.height;
        }
        const left = Math.min(Math.max(r.left, margin), window.innerWidth - f.width - margin);
        floating.style.top = `${Math.round(top + window.scrollY)}px`;
        floating.style.left = `${Math.round(Math.max(left, margin) + window.scrollX)}px`;
    }

    /* ---- Notices --------------------------------------------------------- */

    const Notice = {
        /** @type {HTMLElement|null} */
        _wrap: null,

        /**
         * Show a small, auto-dismissing message.
         * @param {string} message - Text to show.
         * @param {boolean} [isError=false] - Style as an error.
         * @param {{link?: {text: string, href: string}, action?: {text: string, onClick: () => Promise<void>}, ms?: number}} [opts]
         *   Optional link, one button (e.g. Undo; the notice closes when it is clicked) and duration.
         * @returns {void}
         */
        show(message, isError = false, opts = {}) {
            if (!this._wrap || !this._wrap.isConnected) {
                this._wrap = el('div', { cls: CLS.notices, attrs: { role: 'status', 'aria-live': 'polite' } });
                document.body.append(this._wrap);
            }
            const item = el('div', { cls: [CLS.notice, isError ? CLS.noticeError : ''], text: `${CONFIG.SCRIPT_NAME}: ${message}` });
            if (opts.link) {
                item.append(' ', el('a', { text: opts.link.text, attrs: { href: opts.link.href, target: '_blank', rel: 'noopener noreferrer' } }));
            }
            if (opts.action) {
                const b = el('button', { cls: [CLS.uiBtn, CLS.noticeBtn], text: opts.action.text, attrs: { type: 'button' } });
                b.addEventListener('click', () => {
                    b.disabled = true;
                    item.remove();
                    opts.action.onClick().catch((err) => reportError(opts.action.text, err));
                });
                item.append(' ', b);
            }
            this._wrap.append(item);
            setTimeout(() => item.remove(), opts.ms ?? CONFIG.NOTICE_MS * (isError ? 2 : 1));
        },
    };

    /**
     * Report an error to the user and the console. Never fails silently.
     * @param {string} context - What was being attempted.
     * @param {unknown} err - The error.
     * @returns {void}
     */
    function reportError(context, err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${CONFIG.SCRIPT_NAME}] ${context}:`, err);
        try {
            Notice.show(`${context}: ${message}`, true);
        } catch (noticeErr) {
            console.error(`[${CONFIG.SCRIPT_NAME}] could not show notice`, noticeErr);
        }
    }

    /**
     * Report a faction-sharing error. Background (quiet) errors are shown once
     * per distinct message so polling does not spam. A bad or missing key
     * opens Settings once per page load.
     * @param {string} context - What was being attempted.
     * @param {unknown} err - The error.
     * @param {{quiet?: boolean}} [opts] - Options.
     * @returns {void}
     */
    function handleSharedError(context, err, { quiet = false } = {}) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof ServerError && err.needsKey && !err.fromCache && !handleSharedError.promptedKey) {
            handleSharedError.promptedKey = true;
            openSignInDialog(message);
        }
        if (quiet && message === Shared._lastError) {
            log(`${context} (repeat): ${message}`);
            return;
        }
        Shared._lastError = message;
        reportError(context, err);
    }
    handleSharedError.promptedKey = false;

    /* ---- Note sources ------------------------------------------------------ */

    /** @type {{local: NoteSource, shared: NoteSource}} */
    const Sources = {
        local: {
            kind: 'local',
            get: (id) => NoteStore.get(id),
            notes: () => NoteStore.snapshot().notes,
            canEdit: () => true,
            save: async (id, fields) => NoteStore.upsert(id, fields),
            remove: async (id) => NoteStore.remove(id),
        },
        shared: {
            kind: 'shared',
            get: (id) => SharedStore.get(id),
            notes: () => SharedStore.notes(),
            canEdit: () => Shared.canEdit(),
            save: (id, fields) => SharedStore.save(id, fields),
            remove: (id) => SharedStore.remove(id),
        },
    };

    /**
     * Note source for a button.
     * @param {HTMLElement} btn - Note button.
     * @returns {NoteSource} Source.
     */
    function sourceOf(btn) {
        return btn.dataset[DATA_SRC] === 'shared' ? Sources.shared : Sources.local;
    }

    /**
     * Render signature: re-render only when the source, edit right or note changes.
     * @param {'local'|'shared'} srcKind - Source kind.
     * @param {Note|null} note - Note.
     * @returns {string} Signature.
     */
    function buttonSig(srcKind, note) {
        return `${srcKind}|${Sources[srcKind].canEdit() ? 'e' : 'r'}|${Data.noteSignature(note)}`;
    }

    /* ---- Tooltip --------------------------------------------------------- */
    // A custom tooltip is used instead of the native `title` attribute because
    // Torn's own tooltip code renders some `title` attributes as HTML.

    const Tooltip = {
        /** @type {HTMLElement|null} */
        _node: null,

        /**
         * Show the tooltip for a note button.
         * @param {HTMLElement} btn - The note button.
         * @returns {void}
         */
        show(btn) {
            this.hide();
            const id = btn.dataset[DATA_ID];
            const src = sourceOf(btn);
            const note = src.get(id);
            const editable = isEditable(btn);
            const tip = el('div', { cls: CLS.tip, attrs: { role: 'tooltip' } });
            if (note) {
                if (note.label) {
                    const color = Data.colorFor(note.color);
                    const title = el('div', { cls: CLS.tipTitle, text: note.label });
                    title.style.color = color.bg;
                    tip.append(title);
                }
                if (note.text) tip.append(el('div', { cls: CLS.tipBody, text: note.text }));
                const lender = src.kind === 'shared' ? SharedStore.borrowedFrom(id) : '';
                if (lender) tip.append(el('div', { cls: CLS.tipBody, text: `Borrowed from ${lender}` }));
                const action = editable ? 'click to edit' : 'read-only';
                let meta;
                if (src.kind === 'shared') {
                    const who = note.updatedByName || (note.updatedById ? `#${note.updatedById}` : 'unknown');
                    meta = `Faction note · edited by ${who} ${Data.relativeTime(note.updated, Date.now())} · ${action}`;
                } else {
                    const when = note.updated ? new Date(note.updated).toLocaleString() : 'unknown date';
                    meta = `#${id} · updated ${when} · ${action}`;
                }
                tip.append(el('div', { cls: CLS.tipMeta, text: meta }));
            } else {
                tip.append(el('div', {
                    cls: CLS.tipBody,
                    text: src.kind === 'shared' ? 'Click to add a faction note' : 'Click to add a label or note',
                }));
            }
            document.body.append(tip);
            placeNear(tip, btn);
            this._node = tip;
        },

        /**
         * Hide the tooltip.
         * @returns {void}
         */
        hide() {
            this._node?.remove();
            this._node = null;
        },
    };

    /* ---- Modal ----------------------------------------------------------- */

    const Modal = {
        /** @type {HTMLElement|null} */
        _overlay: null,
        /** @type {((e: KeyboardEvent) => void)|null} */
        _onKey: null,

        /**
         * Open a modal dialog. Only one is shown at a time.
         * @param {Object} opts - Options.
         * @param {string} opts.title - Heading text.
         * @param {string} [opts.message] - Body text.
         * @param {Node[]} [opts.content] - Extra nodes under the message.
         * @param {{label: string, variant?: 'primary'|'danger', disabled?: boolean, onClick: () => (void|Promise<void>)}[]} opts.actions
         *   Buttons. An async onClick disables all buttons until it settles.
         * @param {boolean} [opts.wide=false] - Wider dialog (the guide).
         * @returns {HTMLButtonElement[]} The action buttons, in order.
         */
        open({ title, message = '', content = [], actions, wide = false }) {
            this.close();
            Editor.close();
            /** @type {HTMLButtonElement[]} */
            const buttons = actions.map((a) => {
                const variant = a.variant === 'primary' ? CLS.uiPrimary : a.variant === 'danger' ? CLS.uiDanger : '';
                const b = el('button', { cls: [CLS.uiBtn, variant], text: a.label, attrs: { type: 'button' } });
                b.disabled = Boolean(a.disabled);
                b.addEventListener('click', async () => {
                    let result;
                    try {
                        result = a.onClick();
                    } catch (err) {
                        reportError(a.label, err);
                        return;
                    }
                    if (!(result instanceof Promise)) return;
                    const before = buttons.map((x) => x.disabled);
                    buttons.forEach((x) => { x.disabled = true; });
                    try {
                        await result;
                    } catch (err) {
                        reportError(a.label, err);
                    } finally {
                        // Restore only if the dialog is still the same one.
                        if (b.isConnected) buttons.forEach((x, i) => { x.disabled = before[i]; });
                    }
                });
                return b;
            });
            const box = el('div', { cls: [CLS.modal, wide ? CLS.modalWide : ''], attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title } }, [
                el('h3', { text: title }),
                message ? el('div', { cls: CLS.modalBody, text: message }) : null,
                ...content,
                el('div', { cls: CLS.actions }, [el('span', { cls: CLS.spacer }), ...buttons]),
            ]);
            const overlay = el('div', { cls: CLS.overlay }, [box]);
            overlay.addEventListener('mousedown', (e) => {
                if (e.target === overlay) this.close();
            });
            this._onKey = (e) => {
                if (e.key === 'Escape') this.close();
            };
            document.addEventListener('keydown', this._onKey);
            document.body.append(overlay);
            this._overlay = overlay;
            buttons[buttons.length - 1]?.focus();
            return buttons;
        },

        /**
         * Close the modal if open.
         * @returns {void}
         */
        close() {
            this._overlay?.remove();
            this._overlay = null;
            if (this._onKey) document.removeEventListener('keydown', this._onKey);
            this._onKey = null;
        },
    };

    /* ---- Note buttons ---------------------------------------------------- */

    /**
     * Create an (unrendered) note button.
     * @param {string} kind - 'pill' | 'badge' | 'faction'.
     * @returns {HTMLButtonElement} Button.
     */
    function createNoteButton(kind) {
        const btn = /** @type {HTMLButtonElement} */ (el('button', { attrs: { type: 'button' } }));
        btn.dataset[DATA_KIND] = kind;
        // Keep clicks away from Torn's row handlers (row expand / item info).
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Read-only for faction viewers (editor rights are checked again by the server).
            if (!isEditable(btn)) return;
            Tooltip.hide();
            try {
                Editor.open(btn);
            } catch (err) {
                reportError('Could not open editor', err);
            }
        });
        btn.addEventListener('mouseenter', () => Tooltip.show(btn));
        btn.addEventListener('mouseleave', () => Tooltip.hide());
        btn.addEventListener('focus', () => Tooltip.show(btn));
        btn.addEventListener('blur', () => Tooltip.hide());
        return btn;
    }

    /**
     * Whether clicking this button may open the editor. Trade-page pills are
     * always read-only (trades are where mistakes cost money).
     * @param {HTMLElement} btn - Note button.
     * @returns {boolean} True if editable.
     */
    function isEditable(btn) {
        return btn.dataset[DATA_KIND] !== 'trade' && sourceOf(btn).canEdit();
    }

    /** Button kinds that only appear when a note exists (never offer "add"). */
    const NOTE_ONLY_KINDS = new Set(['shared', 'trade']);

    /** Class for each button kind. */
    const KIND_CLASS = Object.freeze({
        pill: CLS.kindPill,
        badge: CLS.kindBadge,
        faction: CLS.kindFaction,
        shared: CLS.kindShared,
        trade: CLS.kindTrade,
    });

    /**
     * Render a note button from its source's current note.
     * Hidden when there is nothing to show and the user cannot add a note
     * (faction viewers). The Items-page faction pill never offers "add": new
     * faction notes are created in the armory, so nothing is shared by accident.
     * @param {HTMLButtonElement} btn - Button with data-tms-an-id and -src set.
     * @returns {void}
     */
    function renderNoteButton(btn) {
        const kind = btn.dataset[DATA_KIND];
        const src = sourceOf(btn);
        const note = src.get(btn.dataset[DATA_ID]);
        const editable = isEditable(btn);
        const hidden = !note && (!editable || NOTE_ONLY_KINDS.has(kind));
        // "Show tag icons on items without notes" off: empty icons appear only on hover/focus.
        const hoverOnly = !note && !hidden && !SettingsStore.get().showEmptyTags;
        const name = btn.dataset[DATA_NAME] || 'item';

        btn.className = [
            CLS.btn,
            KIND_CLASS[kind] ?? CLS.kindPill,
            note ? CLS.btnNote : CLS.btnEmpty,
            note ? CLS.color(note.color) : '',
            editable ? '' : CLS.btnReadOnly,
            hidden ? CLS.btnHidden : '',
            hoverOnly ? CLS.btnHoverOnly : '',
        ].filter(Boolean).join(' ');

        btn.replaceChildren();
        if (NOTE_ONLY_KINDS.has(kind)) btn.append(createSharedIcon());
        if (note?.label) btn.append(el('span', { cls: CLS.label, text: note.label }));
        else if (!NOTE_ONLY_KINDS.has(kind)) btn.append(createTagIcon());

        const what = src.kind === 'shared' ? 'Faction note' : 'Note';
        let aria = `Add ${what.toLowerCase()} to ${name}`;
        if (note) aria = `${what} for ${name}: ${note.label || 'unlabelled'}.${editable ? ' Click to edit.' : ''}`;
        btn.setAttribute('aria-label', aria);
        if (hidden) btn.setAttribute('tabindex', '-1');
        else btn.removeAttribute('tabindex');
        btn.dataset[DATA_SIG] = buttonSig(src.kind, note);

        if (kind === 'faction' && btn.parentElement) {
            btn.parentElement.classList.toggle(CLS.factionHost, !hidden);
            btn.parentElement.classList.toggle(CLS.factionHostNote, Boolean(note));
            ArmoryFilter.schedule(); // a note appeared, changed or went away
        }
    }

    /**
     * Re-render every mounted button for one armory ID (e.g. after a save).
     * @param {string} id - Armory ID.
     * @returns {void}
     */
    function refreshId(id) {
        if (!Data.isValidArmoryId(id)) return;
        document.querySelectorAll(`.${CLS.btn}[data-tms-an-id="${id}"]`).forEach((btn) => renderNoteButton(btn));
    }

    /**
     * Re-render every mounted button (e.g. after import, clear or a refresh).
     * @returns {void}
     */
    function refreshAll() {
        document.querySelectorAll(`.${CLS.btn}`).forEach((btn) => renderNoteButton(btn));
    }

    /**
     * Re-decorate every watched row (picks up a switch between faction and
     * private notes) and re-render every button.
     * @returns {void}
     */
    function rerenderAll() {
        Watchers.forEach((w) => w.scan());
        refreshAll();
    }

    /**
     * After faction notes or fingerprints change, re-decorate rows that depend
     * on them: rows matched by fingerprint (the other person's trade items),
     * and rows that record fingerprints (a note may have just arrived).
     * Unchanged buttons are skipped by their signature, so this is cheap.
     * @returns {void}
     */
    function rescanDynamic() {
        Watchers.forEach((w) => {
            if (w.adapter.dynamicIds || w.adapter.backfill) w.scan();
        });
    }

    /* ---- Editor popover --------------------------------------------------- */

    const Editor = {
        /** @type {HTMLElement|null} */
        _node: null,
        /** @type {HTMLButtonElement|null} */
        _anchor: null,
        /** @type {((e: MouseEvent) => void)|null} */
        _onDocDown: null,

        /**
         * Open the editor for a note button.
         * @param {HTMLButtonElement} btn - The clicked note button.
         * @returns {void}
         */
        open(btn) {
            const reopening = this._anchor === btn;
            this.close();
            if (reopening) return; // second click on the same button toggles closed

            const id = btn.dataset[DATA_ID];
            const name = btn.dataset[DATA_NAME] || 'Item';
            const itemId = btn.dataset[DATA_ITEM] || '';
            const src = sourceOf(btn);
            const shared = src.kind === 'shared';
            const existing = src.get(id);
            let color = existing?.color ?? CONFIG.DEFAULT_COLOR;
            let busy = false;

            const listId = `${PREFIX}-labels`;
            const datalist = el('datalist', { attrs: { id: listId } });
            for (const label of Data.collectLabels(src.notes())) {
                const opt = document.createElement('option');
                opt.value = label;
                datalist.append(opt);
            }

            const labelInput = el('input', { attrs: { type: 'text', maxlength: String(CONFIG.LABEL_MAX), list: listId, placeholder: 'e.g. Keep, Sell, Loan' } });
            labelInput.value = existing?.label ?? '';

            const textArea = el('textarea', { attrs: { maxlength: String(CONFIG.TEXT_MAX), placeholder: 'Notes about this item…' } });
            textArea.value = existing?.text ?? '';
            const counter = el('div', { cls: CLS.counter });
            // Faction notes only: who lent this item to the faction (blank = ours).
            const borrowedBefore = shared ? SharedStore.borrowedFrom(id) : '';
            const borrowInput = shared
                ? el('input', { attrs: { type: 'text', maxlength: '32', placeholder: 'Player name, if lent to the faction', autocomplete: 'off' } })
                : null;
            if (borrowInput) borrowInput.value = borrowedBefore;
            const updateCounter = () => {
                counter.textContent = `${textArea.value.length}/${CONFIG.TEXT_MAX}`;
            };
            textArea.addEventListener('input', updateCounter);
            updateCounter();

            const swatchWrap = el('div', { cls: CLS.swatches, attrs: { role: 'group', 'aria-label': 'Label color' } });
            const swatches = CONFIG.COLORS.map((c) => {
                const s = el('button', { cls: [CLS.swatch, CLS.color(c.key)], attrs: { type: 'button', 'aria-label': c.name, title: c.name } });
                s.dataset.color = c.key;
                s.addEventListener('click', () => {
                    color = c.key;
                    swatches.forEach((x) => {
                        const on = x.dataset.color === color;
                        x.classList.toggle(CLS.swatchOn, on);
                        x.setAttribute('aria-pressed', String(on));
                    });
                });
                const on = c.key === color;
                s.classList.toggle(CLS.swatchOn, on);
                s.setAttribute('aria-pressed', String(on));
                swatchWrap.append(s);
                return s;
            });

            const mkBtn = (text, variant, handler) => {
                const b = el('button', { cls: [CLS.uiBtn, variant], text, attrs: { type: 'button' } });
                b.addEventListener('click', handler);
                return b;
            };
            const deleteBtn = existing ? mkBtn('Delete', CLS.uiDanger, () => remove()) : null;
            // Stays usable while saving, so the editor can always be closed.
            const cancelBtn = mkBtn('Cancel', '', () => this.close());
            const saveBtn = mkBtn('Save', CLS.uiPrimary, () => save());
            const statusLine = el('div', { cls: CLS.popStatus, attrs: { role: 'status', 'aria-live': 'polite' } });

            /**
             * Disable the form while a (possibly remote) save runs. Cancel
             * turns into Close and stays enabled.
             * @param {boolean} on - Busy state.
             * @param {string} [label] - Save button text while busy.
             * @returns {void}
             */
            const setBusy = (on, label = 'Saving…') => {
                busy = on;
                [deleteBtn, saveBtn, labelInput, textArea, borrowInput, ...swatches].forEach((x) => {
                    if (x) x.disabled = on;
                });
                saveBtn.textContent = on ? label : 'Save';
                cancelBtn.textContent = on ? 'Close' : 'Cancel';
            };

            /**
             * Run a save/delete with a safety net: if the server does not
             * answer within SAVE_WATCHDOG_MS the form is released again (the
             * change may still arrive). On success shows "Saved"/"Deleted"
             * briefly, closes, refreshes the item and offers Undo.
             * @param {() => Promise<void>} action - Work to do.
             * @param {string} context - Error context.
             * @param {string} busyLabel - Button text while running.
             * @param {string} doneLabel - Button text on success.
             * @param {() => {message: string, undo: () => Promise<void>}|null} undoFor - Undo offer, computed after success.
             * @returns {Promise<void>}
             */
            const run = async (action, context, busyLabel, doneLabel, undoFor) => {
                if (busy) return;
                setBusy(true, busyLabel);
                statusLine.textContent = '';
                let timedOut = false;
                const timer = setTimeout(() => {
                    timedOut = true;
                    if (this._node !== pop) return;
                    setBusy(false);
                    statusLine.textContent = 'No reply from the server. Your change may have saved; reload the page to check before trying again.';
                }, CONFIG.SAVE_WATCHDOG_MS);
                try {
                    await action();
                    clearTimeout(timer);
                    refreshId(id);
                    const offer = undoFor();
                    if (offer) {
                        Notice.show(offer.message, false, {
                            ms: CONFIG.UNDO_MS,
                            action: {
                                text: 'Undo',
                                onClick: async () => {
                                    try {
                                        await offer.undo();
                                        Notice.show('Undone.');
                                    } catch (err) {
                                        if (shared) handleSharedError('Undo', err);
                                        else reportError('Undo', err);
                                    } finally {
                                        refreshId(id);
                                    }
                                },
                            },
                        });
                    }
                    if (this._node === pop) {
                        if (timedOut) {
                            // The form was already released (the user may be editing again): don't close it.
                            statusLine.textContent = 'The server answered after all: your change was saved. You can close this.';
                        } else {
                            saveBtn.textContent = doneLabel;
                            setTimeout(() => {
                                if (this._node === pop) this.close();
                            }, CONFIG.SAVED_FLASH_MS);
                        }
                    }
                } catch (err) {
                    clearTimeout(timer);
                    if (this._node === pop) setBusy(false);
                    if (shared) handleSharedError(context, err);
                    else reportError(context, err);
                    refreshId(id); // e.g. editor rights were revoked
                }
            };

            /**
             * Fields that put a note back the way it was (for Undo).
             * @param {Object} n - Earlier note.
             * @returns {Object} Save fields.
             */
            const fieldsOf = (n) => {
                const f = { label: n.label ?? '', color: n.color ?? CONFIG.DEFAULT_COLOR, text: n.text ?? '', itemName: n.itemName || name, itemId: n.itemId || itemId };
                if (shared && Data.isFingerprint(n.fingerprint)) {
                    f.fingerprint = n.fingerprint;
                    f.bonuses = n.bonuses ?? '';
                }
                return f;
            };
            // Snapshot of the note before this edit (the store may replace the object).
            const before = existing ? { ...existing } : null;
            /** Undo offer after a save or delete: restore `before`, or remove a new note. */
            const undoOffer = (verb) => () => ({
                message: `${shared ? 'Faction note' : 'Note'} ${verb} for ${name}.`,
                undo: () => (before ? src.save(id, fieldsOf(before)) : src.remove(id)),
            });

            const save = () => run(async () => {
                const label = labelInput.value.trim();
                const text = textArea.value.trimEnd();
                if (!label && !text.trim()) {
                    if (existing) await src.remove(id);
                } else {
                    const fields = { label, color, text, itemName: name, itemId };
                    if (shared && Data.isFingerprint(btn.dataset[DATA_FP])) {
                        fields.fingerprint = btn.dataset[DATA_FP];
                        fields.bonuses = btn.dataset[DATA_BONUS] ?? '';
                    }
                    await src.save(id, fields);
                }
                const borrowedNow = borrowInput ? borrowInput.value.trim() : borrowedBefore;
                if (borrowInput && borrowedNow !== borrowedBefore) {
                    await Server.request('POST', '/items/borrowed', { body: { armoryId: id, from: borrowedNow } });
                    SharedStore.setBorrowed(id, borrowedNow);
                }
            }, 'Could not save note', 'Saving…', 'Saved ✓', () => {
                const now = src.get(id);
                if (!now && !before) return null; // nothing was saved (both fields empty on a new note)
                return undoOffer(now ? 'saved' : 'deleted')();
            });
            const remove = () => run(() => src.remove(id), 'Could not delete note', 'Deleting…', 'Deleted ✓', undoOffer('deleted'));

            let meta = null;
            if (shared && existing) {
                const who = existing.updatedByName || (existing.updatedById ? `#${existing.updatedById}` : 'unknown');
                meta = el('div', { cls: CLS.popMeta, text: `Last edited by ${who}, ${Data.relativeTime(existing.updated, Date.now())}` });
            }

            const helpBtn = el('button', { cls: CLS.popHelp, text: '?', attrs: { type: 'button', title: 'How Armory Notes works', 'aria-label': 'How Armory Notes works' } });
            helpBtn.addEventListener('click', () => openHelpDialog());
            const pop = el('div', { cls: CLS.pop, attrs: { role: 'dialog', 'aria-label': `${shared ? 'Faction note' : 'Note'} for ${name}` } }, [
                helpBtn,
                el('div', { cls: CLS.popHead, text: name }),
                el('div', { cls: CLS.popSub, text: shared ? `Faction note · Armory ID #${id}` : `Armory ID #${id}` }),
                meta,
                el('label', { cls: CLS.field }, [el('span', { text: `Label (max ${CONFIG.LABEL_MAX})` }), labelInput]),
                datalist,
                swatchWrap,
                el('label', { cls: CLS.field }, [el('span', { text: 'Note' }), textArea, counter]),
                borrowInput ? el('label', { cls: CLS.field }, [el('span', { text: 'Borrowed from (hidden while it is given back)' }), borrowInput]) : null,
                statusLine,
                el('div', { cls: CLS.actions }, [deleteBtn, el('span', { cls: CLS.spacer }), cancelBtn, saveBtn]),
            ]);

            // Stop popover clicks from reaching Torn's row/document handlers.
            pop.addEventListener('click', (e) => e.stopPropagation());
            pop.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    this.close();
                } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.target === labelInput)) {
                    e.preventDefault();
                    save();
                }
            });

            document.body.append(pop);
            placeNear(pop, btn);
            this._node = pop;
            this._anchor = btn;
            this._onDocDown = (e) => {
                const t = /** @type {Node} */ (e.target);
                if (!pop.contains(t) && !btn.contains(t)) this.close(false);
            };
            document.addEventListener('mousedown', this._onDocDown, true);
            labelInput.focus();
        },

        /**
         * Close the editor without saving.
         * @param {boolean} [restoreFocus=true] - Return focus to the note button.
         * @returns {void}
         */
        close(restoreFocus = true) {
            if (!this._node) return;
            this._node.remove();
            if (this._onDocDown) document.removeEventListener('mousedown', this._onDocDown, true);
            const anchor = this._anchor;
            this._node = null;
            this._anchor = null;
            this._onDocDown = null;
            if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
        },
    };

    /* ---- Backup / restore dialogs ---------------------------------------- */

    /**
     * Open the export dialog (download is triggered by a real user click).
     * @returns {void}
     */
    function openExportDialog() {
        const count = NoteStore.count();
        Modal.open({
            title: 'Export notes',
            message: `${count} note${count === 1 ? '' : 's'} stored in this browser.\nThe backup is a JSON file you can import later.`,
            actions: [
                { label: 'Cancel', onClick: () => Modal.close() },
                {
                    label: 'Download',
                    variant: 'primary',
                    disabled: count === 0,
                    onClick: () => {
                        const now = new Date();
                        const json = JSON.stringify(Data.buildBackup(NoteStore.snapshot(), now), null, 2);
                        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
                        const a = el('a', { attrs: { href: url, download: Data.backupFileName(now) } });
                        document.body.append(a);
                        a.click();
                        a.remove();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                        Modal.close();
                        Notice.show(`Exported ${count} note${count === 1 ? '' : 's'}.`);
                    },
                },
            ],
        });
    }

    /**
     * Open the import dialog: pick a file, then Merge or Replace.
     * @returns {void}
     */
    function openImportDialog() {
        /** @type {NoteDb|null} */
        let parsed = null;
        const status = el('div', { cls: CLS.modalBody, text: 'Choose a backup file.' });
        const fileInput = el('input', { attrs: { type: 'file', accept: '.json,application/json' } });
        const current = NoteStore.count();

        const buttons = Modal.open({
            title: 'Import notes',
            message: `Merge: keeps your ${current} current note${current === 1 ? '' : 's'}; for the same item the newer note wins.\nReplace: discards current notes and uses only the file.`,
            content: [fileInput, status],
            actions: [
                { label: 'Cancel', onClick: () => Modal.close() },
                {
                    label: 'Replace all',
                    variant: 'danger',
                    disabled: true,
                    onClick: () => {
                        if (!parsed) return;
                        NoteStore.replaceAll(parsed);
                        Modal.close();
                        refreshAll();
                        Notice.show(`Replaced with ${Object.keys(parsed.notes).length} imported notes.`);
                    },
                },
                {
                    label: 'Merge',
                    variant: 'primary',
                    disabled: true,
                    onClick: () => {
                        if (!parsed) return;
                        const s = NoteStore.merge(parsed);
                        Modal.close();
                        refreshAll();
                        Notice.show(`Imported: ${s.added} added, ${s.updated} updated, ${s.kept} unchanged.`);
                    },
                },
            ],
        });
        const [, replaceBtn, mergeBtn] = buttons;

        fileInput.addEventListener('change', async () => {
            parsed = null;
            replaceBtn.disabled = true;
            mergeBtn.disabled = true;
            const file = fileInput.files?.[0];
            if (!file) return;
            try {
                const { db, skipped } = Data.parseBackup(await file.text());
                parsed = db;
                const n = Object.keys(db.notes).length;
                status.textContent = `File contains ${n} valid note${n === 1 ? '' : 's'}${skipped ? ` (${skipped} invalid skipped)` : ''}.`;
                replaceBtn.disabled = false;
                mergeBtn.disabled = n === 0;
            } catch (err) {
                status.textContent = `Cannot import: ${err instanceof Error ? err.message : String(err)}`;
            }
        });
    }

    /**
     * Open the clear-all confirmation dialog.
     * @returns {void}
     */
    function openClearDialog() {
        const count = NoteStore.count();
        const unreadable = NoteStore.isReadOnly();
        let message = 'There are no notes to delete.';
        if (unreadable) message = 'Stored notes could not be read. Deleting will reset storage so notes can be saved again.';
        else if (count) message = `Permanently delete all ${count} note${count === 1 ? '' : 's'} in this browser?\nExport a backup first if you may want them back.`;
        Modal.open({
            title: 'Clear all notes',
            message,
            actions: [
                { label: 'Cancel', onClick: () => Modal.close() },
                { label: 'Export first', disabled: count === 0, onClick: () => openExportDialog() },
                {
                    label: 'Delete all',
                    variant: 'danger',
                    disabled: count === 0 && !unreadable,
                    onClick: () => {
                        NoteStore.clear();
                        Modal.close();
                        refreshAll();
                        Notice.show('All notes deleted.');
                    },
                },
            ],
        });
    }

    /* ---- Faction sharing dialogs -------------------------------------------- */

    /**
     * Describe the current sign-in state.
     * @returns {string} Status text.
     */
    function sessionStatusText() {
        if (!Shared.isConfigured()) return 'Faction sharing is off (no server URL). The Faction Armory uses local notes.';
        if (!SettingsStore.get().apiKey) return 'Not signed in: add your Public API key. Until then the Faction Armory shows your private notes.';
        if (Session.isBlocked()) return `Faction notes are off: ${Session.failureMessage()}\nThe Faction Armory shows your private notes.`;
        const s = Session.peek();
        if (!s) return 'Not signed in yet.';
        const role = s.isAdmin ? 'admin (manages editors)' : s.canEdit ? 'editor (can change faction notes)' : 'viewer (read-only)';
        const faction = s.faction.name ? ` · ${s.faction.name}` : '';
        return `Signed in as ${s.player.name} [${s.player.id}]${faction}\nRole: ${role}`;
    }

    /**
     * Open the Sign in dialog: Torn API key, plus the tag-icon display switch.
     * @param {string} [reason] - Optional message shown at the top (e.g. why it opened).
     * @returns {void}
     */
    function openSignInDialog(reason = '') {
        const current = SettingsStore.get();
        const keyInput = el('input', { attrs: { type: 'password', maxlength: '16', placeholder: '16-character Public key', autocomplete: 'off', spellcheck: 'false' } });
        keyInput.value = current.apiKey;
        const status = el('div', { cls: CLS.status, text: sessionStatusText() });
        const tagsBox = /** @type {HTMLInputElement} */ (el('input', { attrs: { type: 'checkbox' } }));
        tagsBox.checked = current.showEmptyTags;
        // Applies at once (no sign-in needed).
        tagsBox.addEventListener('change', () => {
            SettingsStore.set({ showEmptyTags: tagsBox.checked });
            refreshAll();
        });

        const reloadBtn = el('button', { cls: CLS.uiBtn, text: 'Reload faction notes', attrs: { type: 'button' } });
        reloadBtn.addEventListener('click', () => {
            Modal.close();
            reloadFactionNotes();
        });
        const reloadRow = el('div', { cls: CLS.inlineRow }, [el('span', { text: 'Faction notes look out of date?' }), reloadBtn]);

        /**
         * Validate and store the key, then sign in.
         * @returns {Promise<void>}
         */
        const saveAndSignIn = async () => {
            const apiKey = keyInput.value.trim();
            if (apiKey && !Data.isApiKeyFormat(apiKey)) {
                status.textContent = 'An API key is 16 letters and numbers. Create a Public key in Torn: Settings > API Keys.';
                return;
            }
            const before = SettingsStore.get();
            SettingsStore.set({ apiKey });
            Session.clearFailure(); // an explicit Save always tries again (e.g. after joining the faction)
            if (before.apiKey !== apiKey) {
                Session.clear();
                SharedStore.load();
                handleSharedError.promptedKey = false;
            }
            onSharingChanged();
            if (!apiKey) {
                status.textContent = sessionStatusText();
                Notice.show('Saved. Add your API key to see faction notes.');
                return;
            }
            status.textContent = 'Signing in…';
            try {
                await Session.ensure();
                await SharedStore.refresh();
                Shared._lastError = '';
                rerenderAll();
                status.textContent = sessionStatusText();
                Modal.close();
                Notice.show(`Signed in. ${Object.keys(SharedStore.notes()).length} faction notes loaded.`);
                maybeShowHelp();
            } catch (err) {
                rerenderAll();
                status.textContent = `Sign-in failed: ${err instanceof Error ? err.message : String(err)}`;
            }
        };

        Modal.open({
            title: 'Sign in to Armory Notes',
            message: (reason ? `${reason}\n\n` : '')
                + 'Enter a Torn API key with Public access to see your faction\'s notes. '
                + 'The key is stored only in this browser and sent only to your faction\'s notes server when you sign in.',
            content: [
                el('label', { cls: CLS.field }, [el('span', { text: 'Torn API key (Public access)' }), keyInput]),
                status,
                el('label', { cls: CLS.checkRow }, [tagsBox, el('span', { text: 'Show tag icons on items without notes (off: they appear only when you hover an item)' })]),
                reloadRow,
            ],
            actions: [
                {
                    label: 'Sign out',
                    onClick: () => {
                        SettingsStore.set({ apiKey: '' });
                        keyInput.value = '';
                        Session.clear();
                        SharedStore.clear();
                        onSharingChanged();
                        status.textContent = sessionStatusText();
                        Notice.show('Signed out. Your key was removed from this browser. The Faction Armory now shows your private notes.');
                    },
                },
                { label: 'Cancel', onClick: () => Modal.close() },
                { label: 'Save & sign in', variant: 'primary', onClick: saveAndSignIn },
            ],
        });
        keyInput.focus();
    }

    /**
     * A non-interactive copy of a note pill, for the guide's legend.
     * @param {{kind: string, label?: string, color?: string, shared?: boolean}} o - Look.
     * @returns {HTMLElement} Sample pill.
     */
    function samplePill({ kind, label = '', color = '', shared = false }) {
        const pill = el('span', {
            cls: [CLS.btn, KIND_CLASS[kind] ?? CLS.kindPill, label ? CLS.btnNote : CLS.btnEmpty, label ? CLS.color(color) : ''],
            attrs: { 'aria-hidden': 'true' },
        });
        if (shared) pill.append(createSharedIcon());
        if (label) pill.append(el('span', { cls: CLS.label, text: label }));
        else pill.append(createTagIcon());
        return pill;
    }

    /**
     * One legend row: sample(s) on the left, explanation on the right.
     * @param {Node[]} samples - Sample elements.
     * @param {string} text - Explanation.
     * @returns {HTMLElement[]} The two grid cells.
     */
    function legendRow(samples, text) {
        return [el('div', {}, samples), el('div', { text })];
    }

    /**
     * Tips list; "**x**" in a tip becomes bold (built with textContent only).
     * @param {string[]} tips - Lines.
     * @returns {HTMLElement} List.
     */
    function tipList(tips) {
        return el('ul', { cls: CLS.tips }, tips.map((t) => el('li', {}, t.split(/\*\*(.+?)\*\*/).map((part, i) => (i % 2 ? el('b', { text: part }) : document.createTextNode(part))))));
    }

    /**
     * Guide content: "Basics" for everyone, "Editors" for editors.
     * @param {boolean} isEditor - Include the Editors tab.
     * @returns {{name: string, body: HTMLElement}[]} Tabs.
     */
    function helpTabs(isEditor) {
        const basics = el('div', {}, [
            el('h4', { text: 'What you will see' }),
            el('div', { cls: CLS.legend }, [
                ...legendRow([samplePill({ kind: 'pill' })], 'Empty tag: click it to add your own private note.'),
                ...legendRow([samplePill({ kind: 'pill', label: 'Keep', color: 'blue' }), samplePill({ kind: 'pill', label: 'Sell', color: 'green' })],
                    'Your private note. Only you see it, and it is stored only in this browser.'),
                ...legendRow([samplePill({ kind: 'shared', label: 'War', color: 'red', shared: true })],
                    'Faction note (people icon). Everyone in the faction with the script sees it.'),
                ...legendRow([samplePill({ kind: 'trade', label: 'War', color: 'red', shared: true })],
                    'On trade pages faction notes are read-only, on your items and the other person\'s.'),
            ]),
            el('h4', { text: 'Tips' }),
            tipList([
                '**Hover** any pill to read the full note and see who edited it last, and when.',
                '**Filter bar** above the Faction Armory: search by label or note, or show tagged / untagged items (on the page you are viewing).',
                '**Back up** your private notes: Tampermonkey menu > Private notes.',
                '**Too many tag icons?** Turn them off in Sign in; they then appear only when you hover an item.',
            ]),
        ]);
        const tabs = [{ name: 'Basics', body: basics }];
        if (isEditor) {
            const box = el('label', { cls: [CLS.logBox, CLS.logBoxNudge], attrs: { 'aria-hidden': 'true' } },
                [el('input', { attrs: { type: 'checkbox', tabindex: '-1' } }), el('span', { text: 'Log This As Traded (2 faction items)' })]);
            tabs.push({
                name: 'Editors',
                body: el('div', {}, [
                    el('h4', { text: 'Trades' }),
                    el('div', { cls: CLS.sample }, [box]),
                    tipList([
                        'Tick **Log This As Traded** in the "This trade expires" bar to record the trade. It turns yellow when a trade has faction items that are not logged yet.',
                        'Made a mistake? Untick it, or use **Editor tools > Trade log** to remove an entry.',
                        'Someone lending items to the faction? Tick **Borrowed from …** on their trade. When the items go back they are hidden instead of "Missing", and they keep their tags if they come back.',
                        'Sold or gave something away? **Editor tools > Missing items** marks items sold, removed or returned to their owner, many at once.',
                    ]),
                    el('h4', { text: 'Notes' }),
                    tipList([
                        '**Click** any armory item to tag it. **Enter** or **Ctrl+Enter** saves, **Esc** cancels.',
                        '**Undo** appears for 10 seconds after you save or delete a note.',
                        '**Editor tools** (Tampermonkey menu): Trade log, Sync armory now, Upload local notes, and Manage editors (admin).',
                        'A red **"Armory sync failed"** or **"last worked … ago"** notice means the automatic sync needs attention: tell the notes admin.',
                    ]),
                ]),
            });
        }
        return tabs;
    }

    /**
     * Open the "How it works" guide (menu item, ? in the note editor, and
     * once after the first sign-in).
     * @returns {void}
     */
    function openHelpDialog() {
        Storage.write(CONFIG.HELP_SEEN_KEY, true);
        const tabs = helpTabs(Shared.isActive() && Shared.canEdit());
        const body = el('div', { cls: CLS.help });
        const bar = el('div', { cls: CLS.helpTabs, attrs: { role: 'tablist' } });
        const show = (i) => {
            body.replaceChildren(tabs[i].body);
            [...bar.children].forEach((b, j) => b.setAttribute('aria-selected', String(i === j)));
        };
        tabs.forEach((t, i) => {
            const b = el('button', { cls: CLS.helpTab, text: t.name, attrs: { type: 'button', role: 'tab' } });
            b.addEventListener('click', () => show(i));
            bar.append(b);
        });
        show(0);
        Modal.open({
            title: 'How Armory Notes works',
            content: tabs.length > 1 ? [bar, body] : [body],
            actions: [{ label: 'Got it', variant: 'primary', onClick: () => Modal.close() }],
            wide: true,
        });
    }

    /**
     * Show the guide once, the first time someone is signed in (never over
     * another dialog or the note editor).
     * @returns {void}
     */
    function maybeShowHelp() {
        if (Storage.readSafe(CONFIG.HELP_SEEN_KEY, false)) return;
        if (!Shared.isActive() || !Session.peek()) return;
        if (Modal._overlay || Editor._node) return;
        openHelpDialog();
    }

    /**
     * Open the "upload local notes to the faction" dialog (editors only).
     * Uploaded notes are moved: removed locally once the server accepts them.
     * @returns {Promise<void>}
     */
    async function openUploadDialog() {
        if (!Shared.isConfigured() || !SettingsStore.get().apiKey) {
            openSignInDialog('Set up faction sharing before uploading notes.');
            return;
        }
        if (NoteStore.isReadOnly()) {
            reportError('Upload', new Error('Local notes could not be read. Fix them first (Import or Clear).'));
            return;
        }
        const local = NoteStore.snapshot().notes;
        const ids = Object.keys(local);
        if (!ids.length) {
            Notice.show('You have no local notes to upload.');
            return;
        }
        let session;
        try {
            session = await Session.ensure();
            await SharedStore.refresh();
        } catch (err) {
            handleSharedError('Upload', err);
            return;
        }
        if (!session.canEdit && !Shared.canEdit()) {
            Modal.open({
                title: 'Upload local notes',
                message: 'Only faction note editors can upload notes. Ask your faction\'s notes admin to add your player ID.',
                actions: [{ label: 'OK', variant: 'primary', onClick: () => Modal.close() }],
            });
            return;
        }

        // Seen in the faction armory first, then by item name.
        ids.sort((a, b) => (Number(SeenIds.has(b)) - Number(SeenIds.has(a)))
            || (local[a].itemName || '').localeCompare(local[b].itemName || ''));

        /** @type {Map<string, HTMLInputElement>} */
        const boxes = new Map();
        const list = el('div', { cls: CLS.checklist });
        for (const id of ids) {
            const note = local[id];
            const already = Boolean(SharedStore.get(id));
            const box = /** @type {HTMLInputElement} */ (el('input', { attrs: { type: 'checkbox' } }));
            box.checked = SeenIds.has(id) && !already;
            box.disabled = already;
            boxes.set(id, box);
            const text = `${note.label || '(no label)'} · ${note.itemName || 'Item'} #${id}`
                + (already ? ' · already has a faction note' : SeenIds.has(id) ? ' · seen in faction armory' : '');
            list.append(el('label', { cls: CLS.checkRow }, [box, el('span', { text })]));
        }
        const counter = el('div', { cls: CLS.status });
        const updateCounter = () => {
            const n = [...boxes.values()].filter((b) => b.checked).length;
            counter.textContent = `${n} selected`;
            if (uploadBtn) uploadBtn.disabled = n === 0;
        };
        list.addEventListener('change', updateCounter);
        const setAll = (on) => {
            boxes.forEach((b) => { if (!b.disabled) b.checked = on; });
            updateCounter();
        };
        const mkLink = (text, fn) => {
            const b = el('button', { cls: CLS.uiBtn, text, attrs: { type: 'button' } });
            b.addEventListener('click', fn);
            return b;
        };

        let uploadBtn = null;
        const buttons = Modal.open({
            title: 'Upload local notes to faction',
            message: 'Ticked notes become faction notes that every member can see, and are then removed from this browser\'s '
                + 'local notes. Items that already have a faction note are skipped. Items seen in the faction armory are ticked for you.',
            content: [
                el('div', { cls: CLS.linkRow }, [mkLink('Select all', () => setAll(true)), mkLink('Select none', () => setAll(false))]),
                list,
                counter,
            ],
            actions: [
                { label: 'Cancel', onClick: () => Modal.close() },
                {
                    label: 'Upload',
                    variant: 'primary',
                    onClick: async () => {
                        const chosen = [...boxes].filter(([, b]) => b.checked && !b.disabled).map(([id]) => ({ armoryId: id, ...local[id] }));
                        if (!chosen.length) return;
                        counter.textContent = `Uploading ${chosen.length}…`;
                        let result;
                        try {
                            result = await SharedStore.importNotes(chosen);
                        } catch (err) {
                            const partial = err?.partial?.added ?? [];
                            if (partial.length) {
                                try {
                                    NoteStore.removeMany(partial);
                                } catch (removeErr) {
                                    reportError('Uploaded, but could not remove the local copies', removeErr);
                                }
                                Modal.close();
                                Notice.show(`Upload stopped partway: ${partial.length} note${partial.length === 1 ? ' was' : 's were'} uploaded and moved out of local notes. The rest stayed local; try again to upload them.`);
                            } else {
                                counter.textContent = 'Upload failed. Nothing was removed locally.';
                            }
                            handleSharedError('Upload', err);
                            await Shared.refreshAndRender({ quiet: true });
                            refreshAll();
                            return;
                        }
                        try {
                            NoteStore.removeMany(result.added);
                        } catch (err) {
                            reportError('Uploaded, but could not remove the local copies', err);
                        }
                        await Shared.refreshAndRender({ quiet: true });
                        Modal.close();
                        refreshAll();
                        const parts = [`Uploaded ${result.added.length} note${result.added.length === 1 ? '' : 's'} (moved out of local notes).`];
                        if (result.skipped.length) parts.push(`${result.skipped.length} already had a faction note and stayed local.`);
                        if (result.invalid.length) parts.push(`${result.invalid.length} were invalid and stayed local.`);
                        Notice.show(parts.join(' '));
                    },
                },
            ],
        });
        uploadBtn = buttons[1];
        updateCounter();
        log('Upload dialog for', session.player.name);
    }

    /**
     * Called after sharing settings change: re-decorate rows and start/stop polling.
     * @returns {void}
     */
    function onSharingChanged() {
        rerenderAll();
        if (PageState.factionArmoryOpen && Shared.isActive()) SharedSync.start();
        if (!Shared.isActive()) SharedSync.stop();
    }

    /* ---- Trade log ("Log This As Traded", editors only) --------------------- */
    // A manual switch: ticking it records the trade's bonus armory items for
    // the faction spreadsheet ("Traded to …"); unticking removes the record.
    // It never touches the trade itself.

    const TradeLogBox = {
        /** @type {Map<string, boolean>} trade ID -> logged (this page load). */
        _state: new Map(),
        /** @type {Map<string, boolean>} trade ID -> "Borrowed" ticked (this page load). */
        _borrowState: new Map(),

        /**
         * Trade ID of the open trade.
         * @param {Element} root - Trade container.
         * @returns {string} Trade ID or ''.
         */
        _tradeId(root) {
            const fromHash = /[?&#/]ID=(\d{1,20})/.exec(location.hash)?.[1];
            if (fromHash) return fromHash;
            const href = root.querySelector(CONFIG.SEL.TRADE_ID_LINK)?.getAttribute('href') ?? '';
            return /[?&#]ID=(\d{1,20})/.exec(href)?.[1] ?? '';
        },

        /**
         * Add, keep or remove the checkbox (idempotent; runs after every scan).
         * @param {Element} root - Trade container.
         * @returns {void}
         */
        ensure(root) {
            const existing = root.querySelector(`.${CLS.logBox}:not(.${CLS.borrowBox})`);
            const oldWrap = root.querySelector(`.${CLS.logWrap}`);
            const cont = root.querySelector(CONFIG.SEL.TRADE_CONT);
            const tradeId = cont ? this._tradeId(root) : '';
            if (!cont || !tradeId || !Shared.isActive() || !Shared.canEdit()) {
                oldWrap?.remove();
                return;
            }
            if (existing && existing.dataset.tradeId === tradeId) {
                this._maybeCheck(root, existing); // items may have changed or finished loading
                this._updateBorrow(root);
                return;
            }
            oldWrap?.remove();
            const bar = cont.previousElementSibling?.matches(CONFIG.SEL.TRADE_BAR) ? cont.previousElementSibling : null;
            if (!bar) return; // layout changed: no place for the box
            bar.classList.add(CLS.logHost);
            const input = /** @type {HTMLInputElement} */ (el('input', { attrs: { type: 'checkbox' } }));
            const box = el('label', { cls: [CLS.logBox, CLS.own], attrs: { title: 'Editors: record this trade in the faction spreadsheet' } },
                [input, el('span', { text: 'Log This As Traded' })]);
            box.dataset.tradeId = tradeId;
            // Keep clicks away from Torn's own handlers on the bar.
            box.addEventListener('click', (e) => e.stopPropagation());
            input.addEventListener('change', () => {
                this._toggle(root, tradeId, input, box).catch((err) => reportError('Trade log', err));
            });
            const bInput = /** @type {HTMLInputElement} */ (el('input', { attrs: { type: 'checkbox' } }));
            const bBox = el('label', {
                cls: [CLS.logBox, CLS.borrowBox, CLS.own],
                attrs: { title: 'Editors: the other person is lending these items to the faction. When they go back, they are hidden instead of "Missing", and keep their tags if they return.' },
            }, [bInput, el('span', { text: 'Borrowed' })]);
            bBox.dataset.tradeId = tradeId;
            bBox.hidden = true;
            bBox.addEventListener('click', (e) => e.stopPropagation());
            bInput.addEventListener('change', () => {
                this._toggleBorrow(root, tradeId, bInput, bBox).catch((err) => reportError('Borrowed items', err));
            });
            bar.append(el('div', { cls: [CLS.logWrap, CLS.own] }, [bBox, box]));
            this._loadState(root, tradeId, input, box);
        },

        /**
         * The other person's bonus weapons/armor in this trade (by stats), for "Borrowed".
         * @param {Element} root - Trade container.
         * @returns {{fingerprint: string}[]} Items.
         */
        _lenderItems(root) {
            const out = [];
            root.querySelectorAll(CONFIG.SEL.TRADE_VIEW_ROW).forEach((row) => {
                if (row.querySelector(CONFIG.SEL.TRADE_VIEW_REMOVE)) return; // your own side
                const { fp, bonuses } = rowItemInfo(row, TRADE_PARTNER_ADAPTER);
                if (fp && bonuses) out.push({ fingerprint: fp });
            });
            return out;
        },

        /**
         * Show the "Borrowed from <lender>" box when the other person offers
         * bonus weapons/armor (or it is already ticked).
         * @param {Element} root - Trade container.
         * @returns {void}
         */
        _updateBorrow(root) {
            const bBox = root.querySelector(`.${CLS.borrowBox}`);
            if (!bBox) return;
            const input = bBox.querySelector('input');
            const partner = ownText(root.querySelector(CONFIG.SEL.TRADE_PARTNER_NAME));
            const n = this._lenderItems(root).length;
            const text = bBox.querySelector('span');
            const label = partner ? `Borrowed from ${partner}` : 'Borrowed';
            if (text && text.textContent !== label) text.textContent = label;
            bBox.hidden = !(n > 0 || input?.checked);
        },

        /**
         * Mark (or unmark) the other person's bonus items as borrowed from them.
         * @param {Element} root - Trade container.
         * @param {string} tradeId - Trade ID.
         * @param {HTMLInputElement} input - Checkbox.
         * @param {HTMLElement} box - Label.
         * @returns {Promise<void>}
         */
        async _toggleBorrow(root, tradeId, input, box) {
            const want = input.checked;
            this._busy(box, input, true);
            try {
                if (want) {
                    const partner = ownText(root.querySelector(CONFIG.SEL.TRADE_PARTNER_NAME));
                    if (!partner) throw new Error('Could not read the other player\'s name from this trade.');
                    const items = this._lenderItems(root);
                    if (!items.length) {
                        input.checked = false;
                        Notice.show(`${partner} isn't offering any bonus weapons or armor in this trade.`);
                        return;
                    }
                    const data = await Server.request('POST', `/trades/${tradeId}/borrow`, { body: { from: partner, items } });
                    const total = (data?.marked ?? 0) + (data?.pending ?? 0);
                    Notice.show(`Marked ${total} item${total === 1 ? '' : 's'} as borrowed from ${partner}.`
                        + (data?.pending ? ' New items are matched when they reach the armory.' : ''));
                } else {
                    await Server.request('POST', `/trades/${tradeId}/borrow`, { body: { from: '' } });
                    Notice.show('Borrowed marks removed for this trade.');
                }
                this._borrowState.set(tradeId, input.checked);
                Shared.refreshAndRender();
            } catch (err) {
                input.checked = !want;
                handleSharedError('Borrowed items', err);
            } finally {
                this._busy(box, input, false);
                this._updateBorrow(root);
            }
        },

        /**
         * Show whether the trade is already logged (one request per trade per page load).
         * @param {Element} root - Trade container.
         * @param {string} tradeId - Trade ID.
         * @param {HTMLInputElement} input - Checkbox.
         * @param {HTMLElement} box - Label.
         * @returns {void}
         */
        _loadState(root, tradeId, input, box) {
            if (this._state.has(tradeId)) {
                input.checked = this._state.get(tradeId);
                const bInput = root.querySelector(`.${CLS.borrowBox} input`);
                if (bInput) bInput.checked = this._borrowState.get(tradeId) === true;
                this._updateBorrow(root);
                this._maybeCheck(root, box);
                return;
            }
            this._busy(box, input, true);
            Server.request('GET', `/trades/${tradeId}`)
                .then((data) => {
                    this._state.set(tradeId, data?.logged === true);
                    input.checked = data?.logged === true;
                    this._borrowState.set(tradeId, data?.borrowed === true);
                    const bInput = root.querySelector(`.${CLS.borrowBox} input`);
                    if (bInput) bInput.checked = data?.borrowed === true;
                    this._updateBorrow(root);
                })
                .catch((err) => handleSharedError('Trade log', err, { quiet: true }))
                .finally(() => {
                    this._busy(box, input, false);
                    this._maybeCheck(root, box);
                });
        },

        /**
         * For a trade that is not logged, ask the server which items would be
         * logged, and highlight the box if there are any. Asks again only when
         * the trade's items change. Read-only: never ticks the box.
         * @param {Element} root - Trade container.
         * @param {HTMLElement} box - Label.
         * @returns {void}
         */
        _maybeCheck(root, box) {
            const tradeId = box.dataset.tradeId;
            if (!this._state.has(tradeId)) return; // logged state still loading; called again when it arrives
            const body = this._collect(root);
            const sig = JSON.stringify(body.items);
            if (box.dataset.checkSig === sig) return;
            box.dataset.checkSig = sig;
            if (!body.items.length) {
                this._setNudge(box, []);
                return;
            }
            Server.request('POST', `/trades/${tradeId}/check`, { body: { items: body.items } })
                .then((data) => {
                    if (box.isConnected && box.dataset.checkSig === sig) this._setNudge(box, Array.isArray(data?.items) ? data.items : []);
                })
                .catch((err) => handleSharedError('Trade log', err, { quiet: true }));
        },

        /**
         * Highlight (or not) the box for the faction items found in the trade.
         * @param {HTMLElement} box - Label.
         * @param {{armoryId: string, itemName: string}[]} items - Items that would be logged.
         * @returns {void}
         */
        _setNudge(box, items) {
            box.dataset.nudge = String(items.length);
            const input = box.querySelector('input');
            const text = box.querySelector('span');
            const n = items.length;
            if (text) text.textContent = n ? `Log This As Traded (${n} faction item${n === 1 ? '' : 's'})` : 'Log This As Traded';
            box.title = n
                ? `This trade has faction items that aren't logged yet: ${items.map((i) => i.itemName || `#${i.armoryId}`).join(', ')}. Tick to log them.`
                : 'Editors: record this trade in the faction spreadsheet';
            box.classList.toggle(CLS.logBoxNudge, n > 0 && !input?.checked);
        },

        /**
         * @param {HTMLElement} box - Label.
         * @param {HTMLInputElement} input - Checkbox.
         * @param {boolean} on - Busy state.
         * @returns {void}
         */
        _busy(box, input, on) {
            input.disabled = on;
            box.setAttribute('aria-busy', String(on));
        },

        /**
         * The trade's items that might be armory items: yours by armory ID,
         * theirs by stats (the server does the matching).
         * @param {Element} root - Trade container.
         * @returns {{from: string, to: string, items: Object[]}} Request body.
         */
        _collect(root) {
            const me = ownText(root.querySelector(CONFIG.SEL.TRADE_MY_NAME)) || Session.peek()?.player.name || '';
            const partner = ownText(root.querySelector(CONFIG.SEL.TRADE_PARTNER_NAME));
            const items = [];
            root.querySelectorAll(CONFIG.SEL.TRADE_VIEW_ROW).forEach((row) => {
                const name = ownText(row.querySelector(CONFIG.SEL.TRADE_VIEW_NAME));
                if (row.querySelector(CONFIG.SEL.TRADE_VIEW_REMOVE)) {
                    const id = TRADE_VIEW_ADAPTER.getId(row);
                    if (Data.isValidArmoryId(id)) items.push({ armoryId: id, itemName: name, direction: 'out' });
                } else {
                    const { fp } = rowItemInfo(row, TRADE_PARTNER_ADAPTER);
                    if (fp) items.push({ fingerprint: fp, itemName: name, direction: 'in' });
                }
            });
            return { from: me, to: partner, items };
        },

        /**
         * Log or un-log the trade after the checkbox changes.
         * @param {Element} root - Trade container.
         * @param {string} tradeId - Trade ID.
         * @param {HTMLInputElement} input - Checkbox.
         * @param {HTMLElement} box - Label.
         * @returns {Promise<void>}
         */
        async _toggle(root, tradeId, input, box) {
            const want = input.checked;
            this._busy(box, input, true);
            try {
                if (want) {
                    const body = this._collect(root);
                    if (!body.from || !body.to) throw new Error('Could not read the players\' names from this trade.');
                    const data = await Server.request('POST', `/trades/${tradeId}`, { body });
                    const n = data?.logged?.length ?? 0;
                    if (!n) {
                        input.checked = false;
                        Notice.show('Nothing logged: this trade has no bonus weapons or armor from the armory or with a faction note.');
                    } else {
                        Notice.show(`Logged ${n} item${n === 1 ? '' : 's'} as traded. The spreadsheet updates within an hour.`);
                    }
                    this._state.set(tradeId, n > 0);
                } else {
                    await Server.request('DELETE', `/trades/${tradeId}`);
                    this._state.set(tradeId, false);
                    Notice.show('Trade log removed for this trade.');
                }
                box.classList.toggle(CLS.logBoxNudge, Number(box.dataset.nudge) > 0 && !input.checked);
            } catch (err) {
                input.checked = !want;
                handleSharedError('Trade log', err);
            } finally {
                this._busy(box, input, false);
            }
        },
    };

    /**
     * Tampermonkey menu: ask the server to read the whole faction armory now
     * (it also does this every 6 hours). Editors only; 5-minute cooldown.
     * @returns {Promise<void>}
     */
    async function syncArmoryNow() {
        if (!Shared.isActive()) {
            openSignInDialog('Set up faction sharing first.');
            return;
        }
        if (!Shared.canEdit()) {
            Notice.show('Only faction note editors can sync the armory.');
            return;
        }
        Notice.show('Syncing the faction armory… this takes a few seconds.');
        try {
            const r = await Server.request('POST', '/armory/sync');
            const parts = [`Armory synced: ${r.inArmory ?? '?'} items in the armory`];
            if (r.newBonusItems) parts.push(`${r.newBonusItems} new bonus item${r.newBonusItems === 1 ? '' : 's'}`);
            if (r.markedMissing) parts.push(`${r.markedMissing} no longer in the armory`);
            if (r.remainingToLookUp) parts.push(`${r.remainingToLookUp} more to look up next sync`);
            Notice.show(`${parts.join(', ')}. The spreadsheet updates within an hour; the view page right away.`);
        } catch (err) {
            // The server allows one sync per 5 minutes. Hitting that limit is not a
            // failure: the last sync's results are already in place.
            if (err instanceof ServerError && err.code === 'sync_cooldown') {
                Notice.show('The armory was synced less than 5 minutes ago, so the results are already current.');
                return;
            }
            handleSharedError('Armory sync', err);
        }
    }

    /**
     * Tampermonkey menu: list recent logged trades with Remove buttons (editors).
     * @returns {Promise<void>}
     */
    async function openTradeLogDialog() {
        if (!Shared.isActive()) {
            openSignInDialog('Set up faction sharing first.');
            return;
        }
        if (!Shared.canEdit()) {
            Notice.show('Only faction note editors can view or change the trade log.');
            return;
        }
        let data;
        try {
            data = await Server.request('GET', '/trades?limit=100');
        } catch (err) {
            handleSharedError('Trade log', err);
            return;
        }
        const entries = Array.isArray(data?.items) ? data.items : [];
        /** @type {Map<string, Object[]>} */
        const groups = new Map();
        for (const e of entries) {
            if (!groups.has(e.tradeId)) groups.set(e.tradeId, []);
            groups.get(e.tradeId).push(e);
        }
        const list = el('div', { cls: CLS.checklist });
        const mkBtn = (text, onClick) => {
            const b = el('button', { cls: [CLS.uiBtn, CLS.uiDanger], text, attrs: { type: 'button' } });
            b.addEventListener('click', async () => {
                b.disabled = true;
                try {
                    await onClick();
                } catch (err) {
                    b.disabled = false;
                    handleSharedError('Trade log', err);
                }
            });
            return b;
        };
        for (const [tradeId, items] of groups) {
            const when = new Date(items[0].loggedAt).toLocaleString();
            const group = el('div', { cls: CLS.logGroup });
            const head = el('div', {}, [el('span', { text: `Trade #${tradeId} · ${when} · logged by ${items[0].loggedByName || 'unknown'}` })]);
            head.append(mkBtn('Remove trade', async () => {
                await Server.request('DELETE', `/trades/${tradeId}`);
                TradeLogBox._state.delete(tradeId);
                group.remove();
                Notice.show(`Removed trade #${tradeId} from the log.`);
            }));
            group.append(head);
            for (const it of items) {
                const row = el('div', { cls: CLS.logItem }, [el('span', { text: `${it.itemName || `#${it.armoryId}`}: traded to ${it.to} (from ${it.from})` })]);
                row.append(mkBtn('Remove', async () => {
                    await Server.request('DELETE', `/trades/${tradeId}/${it.armoryId}`);
                    TradeLogBox._state.delete(tradeId);
                    row.remove();
                    if (!group.querySelector(`.${CLS.logItem}`)) group.remove();
                    Notice.show(`Removed ${it.itemName || 'item'} from trade #${tradeId}.`);
                }));
                group.append(row);
            }
            list.append(group);
        }
        Modal.open({
            title: 'Trade log',
            message: entries.length
                ? 'Recent trades logged with "Log This As Traded". Remove an entry if a trade fell through; the spreadsheet updates within an hour.'
                : 'No trades have been logged yet.',
            content: entries.length ? [list] : [],
            actions: [{ label: 'Close', variant: 'primary', onClick: () => Modal.close() }],
        });
    }

    /**
     * One editor as returned by GET /admin/editors.
     * @typedef {Object} EditorEntry
     * @property {number} id
     * @property {string} name
     * @property {string} position
     * @property {(boolean|null)} inFaction - null when the member list is unavailable.
     * @property {string} addedBy
     * @property {(number|null)} addedAt
     */

    /**
     * Text for one editor row (pure).
     * @param {EditorEntry} e - Editor.
     * @returns {string} e.g. "Oman [123] · Officer · added by DadGum".
     */
    function editorRowText(e) {
        const parts = [`${e.name || 'Unknown'} [${e.id}]`];
        if (e.inFaction === false) parts.push('no longer in the faction');
        else if (e.position) parts.push(e.position);
        if (e.addedBy) parts.push(`added by ${e.addedBy}`);
        return parts.join(' · ');
    }

    /**
     * Tampermonkey menu: the notes admin adds and removes editors. The server
     * checks that the caller is ADMIN_ID; changes apply on the editor's next
     * request (their buttons update on the next refresh).
     * @returns {Promise<void>}
     */
    async function openEditorsDialog() {
        if (!Shared.isActive()) {
            openSignInDialog('Set up faction sharing first.');
            return;
        }
        // Known non-admin (the flag comes with every notes refresh): answer locally.
        // Unknown (older session) falls through; the server decides either way.
        if (Session.peek()?.isAdmin === false) {
            Notice.show('Only the notes admin can manage editors.');
            return;
        }
        /** @param {boolean} refresh - Reload the member list from Torn. */
        const load = (refresh) => Server.request('GET', `/admin/editors${refresh ? '?refresh=1' : ''}`);
        let data;
        try {
            data = await load(false);
        } catch (err) {
            handleSharedError('Manage editors', err);
            return;
        }
        Session.setIsAdmin(true);

        const list = el('div', { cls: CLS.checklist });
        const addRow = el('div', { cls: CLS.addRow });
        const info = el('div', { cls: CLS.dim });

        /** Re-render everything from `data`. */
        const render = () => {
            const editors = Array.isArray(data?.editors) ? data.editors : [];
            const members = Array.isArray(data?.members) ? data.members : [];
            list.replaceChildren(
                el('div', { cls: CLS.logItem }, [el('span', { text: `${data?.admin?.name || 'You'} [${data?.admin?.id ?? ''}] · admin, always an editor` })]),
                ...editors.map((e) => {
                    const remove = el('button', { cls: [CLS.uiBtn, CLS.uiDanger], text: 'Remove', attrs: { type: 'button' } });
                    remove.addEventListener('click', () => mutate(remove, 'DELETE', e.id, `Removed ${e.name || e.id} as an editor.`));
                    return el('div', { cls: CLS.logItem }, [el('span', { text: editorRowText(e) }), remove]);
                }),
            );
            if (!editors.length) list.append(el('div', { cls: [CLS.logItem, CLS.dim], text: 'No other editors yet.' }));

            const taken = new Set([...editors.map((e) => e.id), Number(data?.admin?.id)]);
            const candidates = members.filter((m) => !taken.has(m.id));
            const addBtn = el('button', { cls: [CLS.uiBtn, CLS.uiPrimary], text: 'Add editor', attrs: { type: 'button' } });
            let picker;
            if (members.length) {
                picker = el('select', { attrs: { 'aria-label': 'Faction member' } }, [
                    el('option', { text: candidates.length ? 'Choose a faction member…' : 'Everyone is already an editor', attrs: { value: '' } }),
                    ...candidates.map((m) => el('option', { text: `${m.name} [${m.id}]${m.position ? ` · ${m.position}` : ''}`, attrs: { value: String(m.id) } })),
                ]);
            } else {
                picker = el('input', { attrs: { type: 'number', min: '1', placeholder: 'Player ID', 'aria-label': 'Player ID' } });
            }
            addBtn.addEventListener('click', () => {
                const pid = String(picker.value ?? '').trim();
                if (!/^\d{1,10}$/.test(pid)) {
                    Notice.show(members.length ? 'Choose a faction member first.' : 'Enter a player ID first.', true);
                    return;
                }
                const name = members.find((m) => String(m.id) === pid)?.name ?? pid;
                mutate(addBtn, 'PUT', pid, `${name} is now an editor.`);
            });
            addRow.replaceChildren(picker, addBtn);

            const when = data?.membersFetchedAt ? `Member list from ${Data.relativeTime(data.membersFetchedAt, Date.now())}.` : '';
            info.replaceChildren(document.createTextNode([data?.membersError, when].filter(Boolean).join(' ')));
        };

        /**
         * Add or remove one editor, then re-render from the server's answer.
         * @param {HTMLButtonElement} btn - Button to disable while working.
         * @param {'PUT'|'DELETE'} method - Add or remove.
         * @param {(number|string)} pid - Player ID.
         * @param {string} done - Notice on success.
         * @returns {Promise<void>}
         */
        const mutate = async (btn, method, pid, done) => {
            btn.disabled = true;
            try {
                const res = await Server.request(method, `/admin/editors/${encodeURIComponent(String(pid))}`);
                data = { ...data, editors: Array.isArray(res?.editors) ? res.editors : data.editors };
                render();
                Notice.show(done);
            } catch (err) {
                btn.disabled = false;
                handleSharedError('Manage editors', err);
            }
        };

        render();
        Modal.open({
            title: 'Manage editors',
            message: 'Editors can add and change faction notes, log trades and sync the armory. Changes apply right away; '
                + 'a removed editor can no longer save anything, and their buttons update on their next refresh.',
            content: [list, addRow, info],
            actions: [
                {
                    label: 'Reload member list',
                    onClick: async () => {
                        try {
                            data = await load(true);
                            render();
                        } catch (err) {
                            handleSharedError('Manage editors', err);
                        }
                    },
                },
                { label: 'Close', variant: 'primary', onClick: () => Modal.close() },
            ],
        });
    }

    /* ---- Page adapters (DOM reading) -------------------------------------- */

    /**
     * Text of an element's own text nodes, ignoring injected child elements.
     * @param {Element|null} node - Element.
     * @returns {string} Trimmed text.
     */
    function ownText(node) {
        if (!node) return '';
        return [...node.childNodes]
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent)
            .join('')
            .trim();
    }

    /** @type {PageAdapter} */
    const ITEMS_ADAPTER = {
        name: 'items',
        rowSelector: CONFIG.SEL.ITEMS_ROW,
        getId: (row) => row.dataset.armoryid,
        getCategory: (row) => row.dataset.category,
        getItemId: (row) => row.dataset.item ?? '',
        getName: (row) => ownText(row.querySelector(`${CONFIG.SEL.ITEMS_NAME_WRAP} ${CONFIG.SEL.ITEMS_NAME}`)),
        getStats: (row) => statsFromIcons(row.querySelector(CONFIG.SEL.ITEMS_STATS)),
        backfill: true,
        mounts: [
            {
                kind: 'pill',
                source: () => 'local',
                findHost: (row) => row.querySelector(CONFIG.SEL.ITEMS_NAME_WRAP),
                attach: (host, btn) => {
                    const nameEl = host.querySelector(`:scope > ${CONFIG.SEL.ITEMS_NAME}`);
                    if (nameEl) nameEl.after(btn);
                    else host.append(btn);
                },
            },
            {
                // Faction note, shown only when one exists (editable by editors).
                kind: 'shared',
                source: () => 'shared',
                findHost: (row) => row.querySelector(CONFIG.SEL.ITEMS_NAME_WRAP),
                attach: (host, btn) => {
                    const after = host.querySelector(`:scope > .${CLS.btn}[data-tms-an-kind="pill"]`)
                        ?? host.querySelector(`:scope > ${CONFIG.SEL.ITEMS_NAME}`);
                    if (after) after.after(btn);
                    else host.append(btn);
                },
            },
            {
                kind: 'badge',
                source: () => 'local',
                findHost: (row) => row.querySelector(CONFIG.SEL.ITEMS_THUMB),
                attach: (host, btn) => {
                    host.classList.add(CLS.thumbHost);
                    host.append(btn);
                },
            },
        ],
    };

    /** @type {PageAdapter} */
    /**
     * Filter bar above the Faction Armory list (everyone). Only shows or hides
     * rows Torn has already loaded on the current page; it never clicks or
     * changes anything in Torn.
     */
    const ArmoryFilter = {
        /** Shared by every bar (weapons and armour tabs). */
        state: { q: '', mode: 'all' },
        /** @type {Element|null} Armory root, for re-applying after buttons change. */
        _root: null,
        _schedule: null,

        /**
         * Add the bar above each armory list that has note buttons, then filter.
         * Idempotent: runs after every scan.
         * @param {Element} root - Armory root.
         * @returns {void}
         */
        ensure(root) {
            this._root = root;
            root.querySelectorAll(CONFIG.SEL.FACTION_LIST).forEach((list) => {
                if (!list.querySelector(`.${CLS.btn}[data-tms-an-kind="faction"]`)) return;
                const title = list.previousElementSibling?.matches(CONFIG.SEL.FACTION_LIST_TITLE) ? list.previousElementSibling : null;
                const anchor = title ?? list;
                if (anchor.previousElementSibling?.classList.contains(CLS.filterBar)) return;
                anchor.before(this._buildBar());
            });
            this.apply();
        },

        /**
         * Build one filter bar.
         * @returns {HTMLElement} Bar.
         */
        _buildBar() {
            const q = el('input', { attrs: { type: 'search', placeholder: 'Filter this page: item, label or note…', 'aria-label': 'Filter armory items' } });
            const mode = el('select', { attrs: { 'aria-label': 'Show' } }, [
                el('option', { text: 'All items', attrs: { value: 'all' } }),
                el('option', { text: 'Tagged only', attrs: { value: 'tagged' } }),
                el('option', { text: 'Untagged bonus items', attrs: { value: 'untagged' } }),
            ]);
            q.value = this.state.q;
            mode.value = this.state.mode;
            const onChange = () => {
                this.state = { q: q.value, mode: mode.value };
                this.apply();
            };
            q.addEventListener('input', onChange);
            mode.addEventListener('change', onChange);
            // Keep typing away from Torn's own keyboard shortcuts.
            q.addEventListener('keydown', (e) => e.stopPropagation());
            return el('div', { cls: [CLS.filterBar, CLS.own] }, [q, mode, el('span')]);
        },

        /**
         * Whether a row passes the filter (pure apart from reading the row).
         * @param {Element} row - Armory row.
         * @param {Element} btn - Its faction note button.
         * @returns {boolean} True to show.
         */
        _matches(row, btn) {
            const note = sourceOf(btn).get(btn.dataset[DATA_ID]);
            if (this.state.mode === 'tagged' && !note) return false;
            if (this.state.mode === 'untagged' && (note || !row.dataset[DATA_BONUS])) return false;
            const q = this.state.q.trim().toLowerCase();
            if (!q) return true;
            return [btn.dataset[DATA_NAME], note?.label, note?.text, row.dataset[DATA_BONUS]]
                .some((v) => String(v ?? '').toLowerCase().includes(q));
        },

        /**
         * Show/hide rows and update each bar's count.
         * @returns {void}
         */
        apply() {
            const root = this._root;
            if (!root?.isConnected) return;
            const active = this.state.mode !== 'all' || this.state.q.trim() !== '';
            root.querySelectorAll(CONFIG.SEL.FACTION_LIST).forEach((list) => {
                let shown = 0;
                let total = 0;
                list.querySelectorAll(':scope > li').forEach((row) => {
                    const btn = row.querySelector(`.${CLS.btn}[data-tms-an-kind="faction"]`);
                    if (!btn) return;
                    total += 1;
                    const show = !active || this._matches(row, btn);
                    if (show) shown += 1;
                    row.classList.toggle(CLS.rowHidden, !show);
                });
                const title = list.previousElementSibling?.matches(CONFIG.SEL.FACTION_LIST_TITLE) ? list.previousElementSibling : list;
                const bar = title.previousElementSibling?.classList.contains(CLS.filterBar) ? title.previousElementSibling : null;
                if (!bar) return;
                const [q, mode, count] = bar.children;
                if (q.value !== this.state.q) q.value = this.state.q;
                if (mode.value !== this.state.mode) mode.value = this.state.mode;
                count.textContent = active ? `Showing ${shown} of ${total} on this page` : '';
            });
        },

        /**
         * Re-apply soon (after note buttons were re-rendered).
         * @returns {void}
         */
        schedule() {
            if (!this._root) return;
            if (!this._schedule) this._schedule = debounce(() => this.apply(), CONFIG.FILTER_DEBOUNCE_MS);
            this._schedule();
        },
    };

    const FACTION_ADAPTER = {
        name: 'faction',
        rowSelector: CONFIG.SEL.FACTION_ROW,
        getId: (row) => row.querySelector(CONFIG.SEL.FACTION_ID_HOLDER)?.dataset.armoryid,
        getCategory: (row) => row.querySelector(CONFIG.SEL.FACTION_TYPE)?.textContent.trim(),
        getItemId: (row) => row.querySelector(CONFIG.SEL.FACTION_ID_HOLDER)?.dataset.itemid ?? '',
        getName: (row) => ownText(row.querySelector(CONFIG.SEL.FACTION_NAME)),
        getStats: (row) => statsFromIcons(row.querySelector(CONFIG.SEL.FACTION_STATS)),
        backfill: true,
        trackItems: true,
        afterScan: (root) => ArmoryFilter.ensure(root),
        mounts: [
            {
                kind: 'faction',
                // Faction notes when signed in (or signing in); otherwise private
                // notes, as in v1 (no server, no key, or not in the faction).
                source: () => (Shared.isActive() ? 'shared' : 'local'),
                findHost: (row) => row.querySelector(CONFIG.SEL.FACTION_NAME),
                attach: (host, btn) => {
                    host.classList.add(CLS.factionHost);
                    host.append(btn);
                },
            },
        ],
    };

    /** Trade page, add-items screen: your inventory, faction notes read-only. @type {PageAdapter} */
    const TRADE_ADD_ADAPTER = {
        name: 'trade-add',
        rowSelector: CONFIG.SEL.TRADE_ADD_ROW,
        anyCategory: true, // faction notes only exist on weapons/armor anyway
        getId: (row) => Data.parseTradeReactId(row.getAttribute('data-reactid'))?.id,
        getCategory: (row) => Data.parseTradeReactId(row.getAttribute('data-reactid'))?.category,
        getItemId: (row) => Data.itemIdFromImage(row.querySelector(CONFIG.SEL.TRADE_ADD_IMG)?.getAttribute('src')),
        getName: (row) => row.querySelector(`${CONFIG.SEL.TRADE_ADD_NAME_WRAP} ${CONFIG.SEL.TRADE_ADD_NAME}`)?.textContent.trim() ?? '',
        mounts: [
            {
                kind: 'trade',
                source: () => 'shared',
                findHost: (row) => row.querySelector(CONFIG.SEL.TRADE_ADD_NAME_WRAP),
                attach: (host, btn) => {
                    const nameEl = host.querySelector(`:scope > ${CONFIG.SEL.TRADE_ADD_NAME}`);
                    if (nameEl) nameEl.after(btn);
                    else host.append(btn);
                },
            },
        ],
    };

    /**
     * Faction Armory > Deposit list: Torn renders it with the same component as
     * the trade add-items screen (armory ID in data-reactid, same name box), so
     * it reuses that adapter. Read-only faction notes, like on trades.
     * @type {PageAdapter}
     */
    const DEPOSIT_ADAPTER = { ...TRADE_ADD_ADAPTER, name: 'faction-deposit' };

    /** Trade page, trade view: your own items only (theirs carry no armory ID). @type {PageAdapter} */
    const TRADE_VIEW_ADAPTER = {
        name: 'trade-view',
        rowSelector: CONFIG.SEL.TRADE_VIEW_ROW,
        anyCategory: true,
        getId: (row) => Data.armoryIdFromHref(row.querySelector(CONFIG.SEL.TRADE_VIEW_REMOVE)?.getAttribute('href')),
        getCategory: () => '',
        getItemId: (row) => /[?&#]itemID=(\d{1,10})/.exec(row.querySelector(CONFIG.SEL.TRADE_VIEW_REMOVE)?.getAttribute('href') ?? '')?.[1] ?? '',
        getName: (row) => ownText(row.querySelector(CONFIG.SEL.TRADE_VIEW_NAME)),
        getStats: (row) => tradeRowStats(row),
        backfill: true,
        afterScan: (root) => TradeLogBox.ensure(root),
        mounts: [
            {
                kind: 'trade',
                source: () => 'shared',
                findHost: (row) => row.querySelector(CONFIG.SEL.TRADE_VIEW_NAME),
                attach: (host, btn) => {
                    // Right after the item name, before buttons other scripts add.
                    const firstEl = [...host.children].find((c) => !c.classList.contains(CLS.btn));
                    if (firstEl) host.insertBefore(btn, firstEl);
                    else host.append(btn);
                },
            },
        ],
    };

    /**
     * Read stats from a row's stat icons (armory, Items page). Bonus names and
     * values come from the icons' title text, parsed as a string.
     * @param {Element|null} container - Element holding the stat list.
     * @returns {ItemStats|null} Stats, or null if no container.
     */
    function statsFromIcons(container) {
        if (!container) return null;
        const stat = (kind) => {
            const icon = container.querySelector(`i[class*="bonus-attachment-item-${kind}-bonus"]`);
            const value = icon?.parentElement?.querySelector('span')?.textContent.trim();
            return value && /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;
        };
        const bonuses = [];
        let incomplete = false;
        container.querySelectorAll('i[class*="bonus-attachment-"]').forEach((icon) => {
            if (/bonus-attachment-(item-|blank-)/.test(icon.className)) return;
            const parsed = Data.parseBonuses(icon.getAttribute('title'));
            // Torn's tooltip code blanks the title while the icon is hovered.
            if (!parsed.length) incomplete = true;
            bonuses.push(...parsed);
        });
        if (incomplete) return null;
        return { damage: stat('damage'), accuracy: stat('accuracy'), defence: stat('defence'), bonuses };
    }

    /**
     * Stats of a trade-view row, from its info icon's tooltip text.
     * @param {Element} row - Trade row.
     * @returns {ItemStats|null} Stats, or null if the tooltip text is missing.
     */
    function tradeRowStats(row) {
        const html = row.querySelector(CONFIG.SEL.TRADE_VIEW_INFO)?.getAttribute('title') ?? '';
        return html ? Data.statsFromTooltip(html) : null;
    }

    /**
     * Trade view, the other person's items: no armory ID on the page, so the
     * faction note is found by the item's stat fingerprint. @type {PageAdapter}
     */
    const TRADE_PARTNER_ADAPTER = {
        name: 'trade-partner',
        rowSelector: CONFIG.SEL.TRADE_VIEW_ROW,
        anyCategory: true,
        dynamicIds: true,
        accepts: (row) => !row.querySelector(CONFIG.SEL.TRADE_VIEW_REMOVE), // your rows are handled by ID
        getStats: (row) => tradeRowStats(row),
        getId: (row) => SharedStore.idByFingerprint(rowItemInfo(row, TRADE_PARTNER_ADAPTER).fp),
        getCategory: () => '',
        getItemId: () => '',
        getName: (row) => ownText(row.querySelector(CONFIG.SEL.TRADE_VIEW_NAME)),
        mounts: TRADE_VIEW_ADAPTER.mounts,
    };

    /**
     * A row's fingerprint and bonus text, remembered on the row: Torn's
     * tooltip code may blank a title while it is hovered, and a half-read row
     * must not replace a good reading.
     * @param {Element} row - Item row.
     * @param {PageAdapter} adapter - Page adapter.
     * @returns {{fp: string, bonuses: string}} Fingerprint ('' if unknown) and bonus text.
     */
    function rowItemInfo(row, adapter) {
        const stats = adapter.getStats?.(row) ?? null;
        const fp = stats ? Data.makeFingerprint(adapter.getName(row), stats) : '';
        if (fp) {
            row.dataset[DATA_FP] = fp;
            row.dataset[DATA_BONUS] = Data.formatBonuses(stats.bonuses);
        }
        return { fp: row.dataset[DATA_FP] ?? '', bonuses: row.dataset[DATA_BONUS] ?? '' };
    }

    /**
     * Add or refresh note buttons on one row. Idempotent: unchanged buttons
     * are left alone so our own DOM writes do not retrigger observers.
     * @param {Element} row - Candidate item row.
     * @param {PageAdapter} adapter - Page adapter.
     * @returns {void}
     */
    function decorateRow(row, adapter) {
        if (adapter.accepts && !adapter.accepts(row)) return;
        const id = adapter.getId(row);
        if (!Data.isValidArmoryId(id)) {
            // A fingerprint match that went away: remove its button.
            if (adapter.dynamicIds) {
                for (const spec of adapter.mounts) {
                    spec.findHost(row)?.querySelector(`:scope > .${CLS.btn}[data-tms-an-kind="${spec.kind}"]`)?.remove();
                }
            }
            return;
        }
        if (!adapter.anyCategory && !TRACKED.has(adapter.getCategory(row))) return;
        if (adapter === FACTION_ADAPTER) SeenIds.add(id);
        const { fp, bonuses } = rowItemInfo(row, adapter);
        if (adapter.backfill && fp) FingerprintSync.offer(id, fp, bonuses);
        if (adapter.trackItems && fp && bonuses) {
            ItemSync.offer(id, {
                itemName: adapter.getName(row), itemId: adapter.getItemId(row),
                category: adapter.getCategory(row) ?? '', fingerprint: fp, bonuses,
            });
        }

        for (const spec of adapter.mounts) {
            const host = spec.findHost(row);
            if (!host) continue;
            const srcKind = spec.source();
            const sig = buttonSig(srcKind, Sources[srcKind].get(id));
            let btn = host.querySelector(`:scope > .${CLS.btn}[data-tms-an-kind="${spec.kind}"]`);
            if (btn && btn.dataset[DATA_ID] === id && btn.dataset[DATA_SIG] === sig) continue;
            if (!btn) {
                btn = createNoteButton(spec.kind);
                spec.attach(host, btn);
            }
            btn.dataset[DATA_ID] = id;
            btn.dataset[DATA_SRC] = srcKind;
            btn.dataset[DATA_NAME] = adapter.getName(row);
            btn.dataset[DATA_ITEM] = adapter.getItemId(row);
            if (fp) {
                btn.dataset[DATA_FP] = fp;
                btn.dataset[DATA_BONUS] = bonuses;
            }
            renderNoteButton(btn);
        }
    }

    /* =========================================================================
     * OBSERVERS
     * ====================================================================== */

    /**
     * Debounce a function.
     * @param {() => void} fn - Function to debounce.
     * @param {number} ms - Delay.
     * @returns {() => void} Debounced function.
     */
    function debounce(fn, ms) {
        let timer = 0;
        return () => {
            clearTimeout(timer);
            timer = setTimeout(fn, ms);
        };
    }

    /**
     * Resolve with the first element matching a selector, or null on timeout.
     * Uses a MutationObserver (no polling); always disconnects.
     * @param {string} selector - CSS selector.
     * @param {number} timeoutMs - Max wait.
     * @returns {Promise<Element|null>} The element or null.
     */
    function waitForElement(selector, timeoutMs) {
        const found = document.querySelector(selector);
        if (found) return Promise.resolve(found);
        return new Promise((resolve) => {
            const obs = new MutationObserver(() => {
                const match = document.querySelector(selector);
                if (match) {
                    obs.disconnect();
                    clearTimeout(timer);
                    resolve(match);
                }
            });
            const timer = setTimeout(() => {
                obs.disconnect();
                resolve(null);
            }, timeoutMs);
            obs.observe(document.body, { childList: true, subtree: true });
        });
    }

    /**
     * True if a mutation only concerns this script's own nodes.
     * @param {MutationRecord} rec - Mutation record.
     * @returns {boolean} True to ignore.
     */
    function isOwnMutation(rec) {
        const target = rec.target.nodeType === Node.ELEMENT_NODE ? rec.target : rec.target.parentElement;
        if (target?.closest(`.${CLS.btn}, .${CLS.own}`)) return true;
        const nodes = [...rec.addedNodes, ...rec.removedNodes];
        return nodes.length > 0 && nodes.every((n) => n.nodeType === Node.ELEMENT_NODE
            && (n.classList.contains(CLS.btn) || n.classList.contains(CLS.own)));
    }

    /** Watchers currently attached (rescanned when sharing settings change). @type {Set<RootWatcher>} */
    const Watchers = new Set();

    /** Page-level state shared between observers and dialogs. */
    const PageState = {
        /** True while the Faction Armory tab is open and watched. */
        factionArmoryOpen: false,
    };

    /** Watches one container and decorates rows as Torn (re)renders them. */
    class RootWatcher {
        /**
         * @param {PageAdapter} adapter - Page adapter for rows in this root.
         * @param {() => void} [onRootLost] - Called if the root leaves the DOM.
         */
        constructor(adapter, onRootLost) {
            this.adapter = adapter;
            this.onRootLost = onRootLost;
            /** @type {Element|null} */
            this.root = null;
            /** @type {MutationObserver|null} */
            this.observer = null;
            /** @type {MutationObserver|null} */
            this.parentObserver = null;
            this.scheduleScan = debounce(() => this.scan(), CONFIG.OBSERVER_DEBOUNCE_MS);
        }

        /**
         * Start watching a root element (no-op if already watching it).
         * @param {Element} root - Container to observe.
         * @returns {void}
         */
        attach(root) {
            if (this.root === root && root.isConnected) return;
            this.detach();
            this.root = root;
            this.observer = new MutationObserver((records) => {
                if (records.some((r) => !isOwnMutation(r))) this.scheduleScan();
            });
            this.observer.observe(root, { childList: true, subtree: true });
            if (this.onRootLost && root.parentNode) {
                this.parentObserver = new MutationObserver(() => {
                    if (!root.isConnected) {
                        this.detach();
                        this.onRootLost();
                    }
                });
                this.parentObserver.observe(root.parentNode, { childList: true });
            }
            Watchers.add(this);
            log(`Watching ${this.adapter.name} root`);
            this.scan();
        }

        /**
         * Stop watching.
         * @returns {void}
         */
        detach() {
            this.observer?.disconnect();
            this.parentObserver?.disconnect();
            this.observer = null;
            this.parentObserver = null;
            Watchers.delete(this);
            if (this.root) log(`Stopped watching ${this.adapter.name} root`);
            this.root = null;
        }

        /**
         * Decorate every row currently in the root.
         * @returns {void}
         */
        scan() {
            if (!this.root?.isConnected) return;
            try {
                this.root.querySelectorAll(this.adapter.rowSelector).forEach((row) => decorateRow(row, this.adapter));
                this.adapter.afterScan?.(this.root);
            } catch (err) {
                reportError(`Could not add note buttons (${this.adapter.name})`, err);
            }
        }
    }

    /**
     * Polls the notes server for faction-note changes while the Faction Armory
     * is open. Paused while the tab is hidden; catches up when it is shown.
     */
    const SharedSync = {
        _active: false,
        _timer: 0,
        /** @type {(() => void)|null} */
        _onVisibility: null,

        /**
         * Start polling (no-op if already running or sharing is off).
         * @returns {void}
         */
        start() {
            if (this._active || !Shared.isActive()) return;
            this._active = true;
            this._onVisibility = () => {
                if (!document.hidden && this._active && Date.now() - SharedStore.fetchedAt() >= CONFIG.SHARED_POLL_MS) this._tick();
            };
            document.addEventListener('visibilitychange', this._onVisibility);
            log('Faction note polling started');
            this._tick();
        },

        /**
         * Stop polling.
         * @returns {void}
         */
        stop() {
            if (!this._active) return;
            this._active = false;
            clearTimeout(this._timer);
            if (this._onVisibility) document.removeEventListener('visibilitychange', this._onVisibility);
            this._onVisibility = null;
            log('Faction note polling stopped');
        },

        /**
         * Refresh now (if visible) and schedule the next refresh.
         * @returns {Promise<void>}
         */
        async _tick() {
            clearTimeout(this._timer);
            if (!this._active) return;
            if (!document.hidden) await Shared.refreshAndRender({ quiet: true });
            if (!Shared.isActive()) {
                this.stop(); // sign-in now blocked (wrong key, not in faction): nothing to poll
                return;
            }
            if (this._active) {
                clearTimeout(this._timer);
                this._timer = setTimeout(() => this._tick(), CONFIG.SHARED_POLL_MS);
            }
        },
    };

    /**
     * Items page: watch the item category container. Faction notes are shown
     * read-only from the cache, refreshed once if it is old.
     * @returns {Promise<void>}
     */
    async function startItemsPage() {
        const root = await waitForElement(CONFIG.SEL.ITEMS_ROOT, CONFIG.WAIT_FOR_TIMEOUT_MS);
        if (!root) {
            reportError('Items page', new Error('Item list not found (Torn layout may have changed).'));
            return;
        }
        new RootWatcher(ITEMS_ADAPTER).attach(root);
        await refreshSharedIfStale();
    }

    /**
     * Refresh faction notes once if the cache is older than a minute
     * (pages without polling: Items and Trade).
     * @returns {Promise<void>}
     */
    async function refreshSharedIfStale() {
        if (Shared.isActive() && Date.now() - SharedStore.fetchedAt() > CONFIG.ITEMS_SHARED_MAX_AGE_MS) {
            await Shared.refreshAndRender({ quiet: true });
        }
    }

    /**
     * Trade page: watch the trade container on both the trade view and the
     * add-items screen. Torn swaps the content on in-page navigation, so the
     * watchers re-attach whenever the container is replaced.
     * @returns {void}
     */
    function startTradePage() {
        let syncToken = 0;
        const sync = async () => {
            const token = ++syncToken;
            const root = await waitForElement(CONFIG.SEL.TRADE_ROOT, CONFIG.WAIT_FOR_TIMEOUT_MS);
            if (token !== syncToken || !root) return;
            addWatcher.attach(root);
            viewWatcher.attach(root);
            partnerWatcher.attach(root);
        };
        const addWatcher = new RootWatcher(TRADE_ADD_ADAPTER, () => sync());
        const viewWatcher = new RootWatcher(TRADE_VIEW_ADAPTER);
        const partnerWatcher = new RootWatcher(TRADE_PARTNER_ADAPTER);
        window.addEventListener('hashchange', () => {
            Tooltip.hide();
            sync();
        });
        sync().then(() => refreshSharedIfStale()).catch((err) => reportError('Trade page', err));
    }

    /**
     * First Faction Armory visit with a server configured but no key: open
     * Settings once so the member can sign in.
     * @returns {void}
     */
    function maybePromptSetup() {
        if (!Shared.isConfigured() || SettingsStore.get().apiKey) return;
        if (Storage.readSafe(CONFIG.SETUP_PROMPTED_KEY, false)) return;
        Storage.write(CONFIG.SETUP_PROMPTED_KEY, true);
        openSignInDialog('Welcome! This copy of Armory Notes shares notes with your faction. '
            + 'If you are in that faction, add a Public API key to see them. '
            + 'If not, click Cancel: the Faction Armory will use your private notes instead.');
    }

    /**
     * Faction page: watch the armory only while its tab is open.
     * @returns {void}
     */
    function startFactionPage() {
        let syncToken = 0;
        const sync = async () => {
            const token = ++syncToken;
            if (!location.hash.includes(CONFIG.FACTION_HASH_TOKEN)) {
                watcher.detach();
                depositWatcher.detach();
                PageState.factionArmoryOpen = false;
                SharedSync.stop();
                return;
            }
            const root = await waitForElement(CONFIG.SEL.FACTION_ROOT, CONFIG.WAIT_FOR_TIMEOUT_MS);
            if (token !== syncToken) return; // superseded by a newer navigation
            if (!root) {
                // Not an error: the armory may be hidden for members without access.
                log('Faction armory container not found.');
                return;
            }
            watcher.attach(root);
            depositWatcher.attach(root);
            PageState.factionArmoryOpen = true;
            SharedSync.start();
            maybePromptSetup();
        };
        const watcher = new RootWatcher(FACTION_ADAPTER, () => sync());
        const depositWatcher = new RootWatcher(DEPOSIT_ADAPTER);
        window.addEventListener('hashchange', () => {
            Editor.close(false);
            Tooltip.hide();
            sync();
        });
        sync();
    }

    /* =========================================================================
     * INIT
     * ====================================================================== */

    /**
     * Throw away this browser's copy of the faction notes and load them again
     * (signs in again). Deletes nothing.
     * @returns {void}
     */
    function reloadFactionNotes() {
        SharedStore.clear();
        Session.clear();
        refreshAll();
        Notice.show('Reloading faction notes from the server. Nothing was deleted.');
        if (PageState.factionArmoryOpen) Shared.refreshAndRender();
    }

    /**
     * One row of the Missing items list (pure).
     * @param {{item: string, label: string, bonuses: string, missingSince: (number|null)}} m - Item.
     * @returns {string} e.g. "9mm Uzi · War · 16% Powerful · missing 3 days ago".
     */
    function missingRowText(m) {
        return [m.item || 'Unknown item', m.label, m.bonuses, m.missingSince ? `missing ${Data.relativeTime(m.missingSince, Date.now())}` : '']
            .filter(Boolean).join(' · ');
    }

    /**
     * Editor tools > Missing items: tick items that left the armory without a
     * logged trade and mark them sold, removed, or returned to their owner
     * (borrowed items, then hidden until they come back).
     * @returns {Promise<void>}
     */
    async function openMissingItemsDialog() {
        if (!Shared.isActive() || !Shared.canEdit()) {
            Notice.show('Missing items is only for faction note editors.');
            return;
        }
        let items;
        try {
            items = (await Server.request('GET', '/items/missing'))?.items ?? [];
        } catch (err) {
            handleSharedError('Missing items', err);
            return;
        }
        const list = el('div', { cls: CLS.checklist });
        const owner = el('input', { attrs: { type: 'text', maxlength: '32', placeholder: "Owner's name", autocomplete: 'off' } });
        const status = el('div', { cls: CLS.status });
        /** @type {HTMLInputElement[]} */
        let boxes = [];
        const render = () => {
            boxes = [];
            list.replaceChildren(...items.map((m) => {
                const cb = /** @type {HTMLInputElement} */ (el('input', { attrs: { type: 'checkbox' } }));
                cb.dataset.id = m.armoryId;
                boxes.push(cb);
                return el('label', { cls: CLS.checkRow }, [cb, el('span', { text: missingRowText(m) })]);
            }));
            if (!items.length) list.append(el('div', { cls: CLS.dim, text: 'Nothing is missing. 🎉' }));
            status.textContent = items.length ? `${items.length} missing item${items.length === 1 ? '' : 's'}.` : '';
        };
        const selected = () => boxes.filter((b) => b.checked).map((b) => b.dataset.id);
        /**
         * Apply an action to the ticked items, then reload the list.
         * @param {'sold'|'removed'|'returned'} action - What happened to them.
         * @returns {Promise<void>}
         */
        const mark = async (action) => {
            const ids = selected();
            if (!ids.length) {
                status.textContent = 'Tick at least one item first.';
                return;
            }
            const body = { ids, action };
            if (action === 'returned') {
                body.owner = owner.value.trim();
                if (!body.owner) {
                    status.textContent = "Enter the owner's name first.";
                    owner.focus();
                    return;
                }
            }
            try {
                const res = await Server.request('POST', '/items/mark', { body });
                const n = res?.updated ?? ids.length;
                const what = { sold: 'sold', removed: 'removed', returned: `returned to ${body.owner}` }[action];
                Notice.show(`Marked ${n} item${n === 1 ? '' : 's'} as ${what}.`);
                items = (await Server.request('GET', '/items/missing'))?.items ?? [];
                render();
            } catch (err) {
                handleSharedError('Missing items', err);
            }
        };
        const selectAll = el('button', { cls: CLS.uiBtn, text: 'Select all', attrs: { type: 'button' } });
        selectAll.addEventListener('click', () => {
            const all = boxes.length > 0 && boxes.every((b) => b.checked);
            boxes.forEach((b) => { b.checked = !all; });
        });
        render();
        Modal.open({
            title: 'Missing items',
            message: 'Items that left the armory without a logged trade. Tick them and say what happened. '
                + 'Sold or removed items stay listed with that status; items returned to their owner are hidden until they come back.',
            content: [el('div', { cls: CLS.inlineRow }, [selectAll]), list,
                el('label', { cls: CLS.field }, [el('span', { text: 'Owner (only for Returned to owner)' }), owner]), status],
            actions: [
                { label: 'Mark sold', onClick: () => mark('sold') },
                { label: 'Mark removed', onClick: () => mark('removed') },
                { label: 'Returned to owner', onClick: () => mark('returned') },
                { label: 'Close', variant: 'primary', onClick: () => Modal.close() },
            ],
            wide: true,
        });
    }

    /**
     * A panel of buttons, each with a one-line description (used for the
     * grouped Tampermonkey menu items).
     * @param {string} title - Dialog title.
     * @param {string} message - Intro text.
     * @param {{label: string, help: string, danger?: boolean, run: () => (void|Promise<void>)}[]} tools - Buttons.
     * @returns {void}
     */
    function openToolPanel(title, message, tools) {
        const list = el('div', { cls: CLS.toolList }, tools.map((t) => {
            const b = el('button', { cls: [CLS.uiBtn, t.danger ? CLS.uiDanger : ''], text: t.label, attrs: { type: 'button' } });
            b.addEventListener('click', () => {
                Modal.close();
                Promise.resolve()
                    .then(() => t.run())
                    .catch((err) => reportError(t.label, err));
            });
            return el('div', {}, [b, el('span', { text: t.help })]);
        }));
        Modal.open({ title, message, content: [list], actions: [{ label: 'Close', onClick: () => Modal.close() }] });
    }

    /**
     * Tampermonkey menu: editor tools (trade log, sync, upload; Manage editors for the admin).
     * @returns {void}
     */
    function openEditorTools() {
        if (!Shared.isActive()) {
            openSignInDialog('Sign in first.');
            return;
        }
        if (!Shared.canEdit()) {
            Notice.show('Editor tools are only for faction note editors.');
            return;
        }
        const tools = [
            { label: 'Trade log', help: 'Trades logged with "Log This As Traded"; remove mistakes.', run: openTradeLogDialog },
            { label: 'Sync armory now', help: 'Read the whole faction armory now (it also runs every 6 hours).', run: syncArmoryNow },
            { label: 'Missing items', help: 'Mark items that left the armory as sold, removed or returned to their owner.', run: openMissingItemsDialog },
            { label: 'Upload local notes', help: 'Move your private notes into faction notes.', run: openUploadDialog },
        ];
        if (Session.peek()?.isAdmin) {
            tools.push({ label: 'Manage editors', help: 'Admin: add or remove editors.', run: openEditorsDialog });
        }
        openToolPanel('Editor tools', '', tools);
    }

    /**
     * Tampermonkey menu: private (local) notes backup tools.
     * @returns {void}
     */
    function openPrivateNotesTools() {
        const n = NoteStore.count();
        openToolPanel('Private notes', `${n} private note${n === 1 ? '' : 's'} stored in this browser.`, [
            { label: 'Export backup', help: 'Download your private notes as a file.', run: openExportDialog },
            { label: 'Import', help: 'Restore from a backup file (merge or replace).', run: openImportDialog },
            { label: 'Clear all', help: 'Delete every private note in this browser.', danger: true, run: openClearDialog },
        ]);
    }

    /** Whether "Editor tools…" was added to the menu (it is added once someone is known to be an editor). */
    let editorMenuAdded = false;

    /**
     * Add "Editor tools…" to the Tampermonkey menu once the user is an
     * editor (at start-up from the saved session, or after signing in).
     * @param {(label: string, fn: () => void) => () => void} [guard] - Error wrapper.
     * @returns {void}
     */
    function ensureEditorMenu(guard = menuGuard) {
        if (editorMenuAdded || !Session.peek()?.canEdit) return;
        editorMenuAdded = true;
        GM_registerMenuCommand('Editor tools…', guard('Editor tools', openEditorTools));
    }

    /**
     * Wrap a menu handler so errors are reported, not thrown.
     * @param {string} label - Context for errors.
     * @param {() => void} fn - Handler.
     * @returns {() => void} Wrapped handler.
     */
    function menuGuard(label, fn) {
        return () => {
            try {
                fn();
            } catch (err) {
                reportError(label, err);
            }
        };
    }

    /**
     * Register Tampermonkey menu commands: Sign in, How it works, Refresh
     * faction notes, Editor tools… (editors only) and Private notes….
     * @returns {void}
     */
    function registerMenu() {
        const guard = menuGuard;
        GM_registerMenuCommand('Sign in', guard('Sign in', () => openSignInDialog()));
        GM_registerMenuCommand('How it works', guard('How it works', openHelpDialog));
        GM_registerMenuCommand('Refresh faction notes', guard('Refresh', () => {
            if (!Shared.isActive()) {
                openSignInDialog(Session.isBlocked() ? `Faction notes are off: ${Session.failureMessage()}` : 'Sign in first.');
                return;
            }
            Shared.refreshAndRender().then((ok) => {
                if (ok) Notice.show(`Faction notes refreshed (${Object.keys(SharedStore.notes()).length}).`);
            });
        }));
        ensureEditorMenu(guard);
        GM_registerMenuCommand('Private notes…', guard('Private notes', openPrivateNotesTools));
    }

    /**
     * Single entry point.
     * @returns {void}
     */
    function init() {
        try {
            injectStyles();
            registerMenu();
            try {
                NoteStore.load();
            } catch (err) {
                reportError('Saved notes could not be read; notes are read-only until fixed (Import a backup or Clear)', err);
            }
            SharedStore.load();
            const path = location.pathname;
            if (path === CONFIG.PATHS.ITEMS) {
                startItemsPage().catch((err) => reportError('Items page', err));
            } else if (path === CONFIG.PATHS.TRADE) {
                startTradePage();
            } else if (path === CONFIG.PATHS.FACTIONS) {
                startFactionPage();
            }
            log('Initialized', path, `${NoteStore.count()} local notes`, `${Object.keys(SharedStore.notes()).length} faction notes cached`);
        } catch (err) {
            reportError('Initialization failed', err);
        }
    }

    init();
})();
