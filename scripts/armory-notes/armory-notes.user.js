// ==UserScript==
// @name         Torn Armory Notes
// @namespace    dadgum.torn.armorynotes
// @version      2.0.1
// @description  Colored labels and notes on individual weapons and armor (keyed by armory ID). Private notes on the Items page; shared faction notes in the Faction Armory.
// @author       DadGum
// @license      MIT
// @match        https://www.torn.com/item.php*
// @match        https://www.torn.com/factions.php*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
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
 *
 * Author: DadGum
 *
 * Changelog
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
 *   - Data storage:
 *       In this browser (Tampermonkey storage): your local notes, your API
 *       key, the server URL, a sign-in token, and a cache of faction notes.
 *       On your faction's notes server (Cloudflare D1): faction notes and,
 *       for each change, the editor's Torn player ID and name. Your API key
 *       is NOT stored on the server.
 *   - Data sharing: faction notes are visible to members of your faction who
 *     use this script. Nothing is shared with anyone else.
 *   - Purpose of use: annotating your own and your faction's items.
 *   - Key storage & sharing: the key stays in Tampermonkey storage. It is sent
 *     only over HTTPS, in the body of the sign-in request, to the faction
 *     server set in Settings (about once every 12 hours). The server uses it
 *     for one Torn API call (user basic,faction) to confirm who you are and
 *     that you are in the faction, then forgets it. The key is never logged
 *     and never put in a URL.
 *   - API calls: Torn API about 1 per 12 hours (sign-in, made by the server).
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
         * "https://torn-armory-notes.yourname.workers.dev"). Fill this in before
         * sharing the script so members only have to enter their key. Leave
         * empty to start with sharing off; members can still set it in Settings.
         */
        DEFAULT_SERVER_URL: 'https://torn-armory-notes.dbeanwomble.workers.dev',
        SETTINGS_KEY: 'tms-armorynotes:settings:v1',
        SESSION_KEY: 'tms-armorynotes:session:v1',
        SHARED_CACHE_KEY: 'tms-armorynotes:shared:v1',
        SEEN_FACTION_KEY: 'tms-armorynotes:seen:v1',
        SETUP_PROMPTED_KEY: 'tms-armorynotes:setup-prompted:v1',
        SHARED_CACHE_VERSION: 1,
        /** Server URLs must be HTTPS with no query or fragment. */
        SERVER_URL_PATTERN: /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[^\s?#]*)?$/,
        API_KEY_PATTERN: /^[A-Za-z0-9]{16}$/,

        /** Faction Armory refresh interval while the tab is visible. */
        SHARED_POLL_MS: 45000,
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
        /** Armory IDs remembered from the faction armory (pre-ticks the upload list). */
        SEEN_MAX: 5000,
        SEEN_FLUSH_MS: 2000,
        EDITOR_NAME_MAX: 40,

        /**
         * Torn API error codes (ApiError schema, Torn API v2). The server passes
         * Torn's code through when sign-in fails; these are the messages shown.
         */
        TORN_ERRORS: Object.freeze({
            0: 'Unknown Torn API error.',
            1: 'API key is empty. Enter your key in Settings.',
            2: 'Incorrect API key. Re-enter it in Settings.',
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

        PATHS: Object.freeze({ ITEMS: '/item.php', FACTIONS: '/factions.php' }),
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
            FACTION_ID_HOLDER: ':scope > .img-wrap[data-armoryid]',
            FACTION_NAME: ':scope > .name',
            // Fragile: category is read from the visible "Type" column text.
            FACTION_TYPE: ':scope > .type',
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
        btnHidden: `${PREFIX}-btn--hidden`,
        btnReadOnly: `${PREFIX}-btn--ro`,
        popMeta: `${PREFIX}-pop-meta`,
        checklist: `${PREFIX}-checklist`,
        checkRow: `${PREFIX}-check`,
        linkRow: `${PREFIX}-links`,
        status: `${PREFIX}-status`,
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
     * A faction (shared) note: a Note plus who last changed it.
     * @typedef {Note & {updatedById: number, updatedByName: string}} SharedNote
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
     * @property {number} updated        - Server epoch ms.
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
     * @property {string} serverUrl                  - Server this token belongs to.
     */

    /**
     * Local settings.
     * @typedef {Object} Settings
     * @property {string} serverUrl - Notes server base URL ('' = sharing off).
     * @property {string} apiKey    - Torn Public API key ('' = not set).
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
         * @returns {{id: string, updated: number, note: (SharedNote|null)}|null}
         *   null if unusable; note is null for a deletion (tombstone).
         */
        normalizeSharedNote(raw) {
            if (!raw || typeof raw !== 'object') return null;
            const id = String(raw.armoryId ?? '');
            const updated = Number(raw.updated);
            if (!Data.isValidArmoryId(id) || !Number.isFinite(updated) || updated <= 0) return null;
            if (raw.deleted) return { id, updated, note: null };
            const base = Data.normalizeNote({ ...raw, updated });
            if (!base) return { id, updated, note: null };
            const byId = Number(raw.updatedById);
            return {
                id,
                updated,
                note: {
                    ...base,
                    updatedById: Number.isInteger(byId) && byId > 0 ? byId : 0,
                    updatedByName: String(raw.updatedByName ?? '').slice(0, CONFIG.EDITOR_NAME_MAX),
                },
            };
        },

        /**
         * Validate and tidy a notes-server URL typed by the user.
         * @param {string} text - Raw input.
         * @returns {string} URL without trailing slash, or '' when empty.
         * @throws {Error} If not an https:// URL without query/fragment.
         */
        normalizeServerUrl(text) {
            const url = String(text ?? '').trim().replace(/\/+$/, '');
            if (!url) return '';
            if (!CONFIG.SERVER_URL_PATTERN.test(url)) {
                throw new Error('Server URL must look like https://name.workers.dev (https only, no ? or #).');
            }
            return url;
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

    /* ---- Settings (server URL + API key) ---------------------------------- */

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
                    serverUrl: typeof raw.serverUrl === 'string' ? raw.serverUrl : CONFIG.DEFAULT_SERVER_URL,
                    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
                });
            }
            return this._mem;
        },

        /**
         * Save settings.
         * @param {Settings} settings - New settings (already validated).
         * @returns {void}
         */
        set(settings) {
            Storage.write(CONFIG.SETTINGS_KEY, { serverUrl: settings.serverUrl, apiKey: settings.apiKey });
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
            this._fetchedAt = Number.isFinite(c.fetchedAt) ? c.fetchedAt : 0;
        },

        /**
         * Empty the in-memory cache.
         * @param {string} serverUrl - Server the cache now belongs to.
         * @returns {void}
         */
        _reset(serverUrl) {
            this._notes = {};
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
                fetchedAt: this._fetchedAt,
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
         * @returns {string[]} Armory IDs whose note changed.
         */
        apply(list) {
            const changed = [];
            for (const raw of list) {
                const n = Data.normalizeSharedNote(raw);
                if (!n) continue;
                this._since = Math.max(this._since, n.updated);
                const prev = this._notes[n.id];
                if (!n.note) {
                    if (prev) {
                        delete this._notes[n.id];
                        changed.push(n.id);
                    }
                } else if (!prev || Data.noteSignature(prev) !== Data.noteSignature(n.note) || prev.updatedById !== n.note.updatedById) {
                    this._notes[n.id] = n.note;
                    changed.push(n.id);
                }
            }
            return changed;
        },

        /**
         * Fetch changes from the server (one request at a time).
         * @returns {Promise<string[]>} Armory IDs whose note changed.
         * @throws {ServerError} On server/network/auth failure.
         */
        refresh() {
            if (!this._inflight) {
                this._inflight = this._refresh().finally(() => {
                    this._inflight = null;
                });
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
            const changed = [];
            for (let page = 0; page < CONFIG.SHARED_MAX_PAGES; page += 1) {
                const data = await Server.request('GET', `/notes?since=${encodeURIComponent(String(this._since))}`);
                if (!data || !Array.isArray(data.notes)) throw new ServerError('bad_response', 'Unexpected response from the notes server.');
                changed.push(...this.apply(data.notes));
                if (typeof data.canEdit === 'boolean') Session.setCanEdit(data.canEdit);
                if (!data.hasMore) break;
            }
            this._fetchedAt = Date.now();
            this._persist();
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
            this.apply([data?.note]);
            this._persist();
        },

        /**
         * Delete a faction note (editors only).
         * @param {string} id - Armory ID.
         * @returns {Promise<void>}
         * @throws {ServerError} On failure.
         */
        async remove(id) {
            const data = await Server.request('DELETE', `/notes/${encodeURIComponent(id)}`);
            this.apply([data?.note ?? { armoryId: id, deleted: true, updated: Date.now() }]);
            this._persist();
        },

        /**
         * Upload notes; the server never overwrites an existing faction note.
         * @param {Array<Note & {armoryId: string}>} notes - Notes to upload.
         * @returns {Promise<{added: string[], skipped: string[], invalid: string[]}>} Result.
         * @throws {ServerError} On failure (earlier chunks may already be saved).
         */
        async importNotes(notes) {
            const result = { added: [], skipped: [], invalid: [] };
            for (let i = 0; i < notes.length; i += CONFIG.UPLOAD_CHUNK) {
                const chunk = notes.slice(i, i + CONFIG.UPLOAD_CHUNK).map((n) => ({
                    armoryId: n.armoryId, label: n.label, color: n.color, text: n.text, itemName: n.itemName, itemId: n.itemId,
                }));
                const data = await Server.request('POST', '/notes/import', { body: { notes: chunk } });
                for (const key of ['added', 'skipped', 'invalid']) {
                    if (Array.isArray(data?.[key])) result[key].push(...data[key].map(String));
                }
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
            const { serverUrl } = SettingsStore.get();
            if (!serverUrl) throw new ServerError('not_configured', 'Faction sharing is not set up. Open Settings from the Tampermonkey menu.');
            const headers = { Accept: 'application/json' };
            if (body !== undefined) headers['Content-Type'] = 'application/json';
            if (auth) headers.Authorization = `Bearer ${(await Session.ensure()).token}`;
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
                : `Faction notes server error (HTTP ${res.status}). Check the server URL in Settings.`;
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

    const Session = {
        /** @type {Session|null} */
        _mem: null,
        /** @type {Promise<Session>|null} */
        _inflight: null,
        /**
         * Last sign-in failure, so a bad key or non-member is not re-checked
         * with Torn on every poll. Cleared when settings change.
         * @type {{sig: string, err: ServerError, until: number}|null}
         */
        _failure: null,

        /**
         * Settings fingerprint (memory only, never logged).
         * @param {Settings} s - Settings.
         * @returns {string} Fingerprint.
         */
        _sig(s) {
            return `${s.serverUrl}\n${s.apiKey}`;
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
            const f = this._failure;
            if (f && f.sig === this._sig(settings) && Date.now() < f.until) return Promise.reject(f.err);
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
                throw new ServerError('no_key', 'Add your Public API key in Settings to see faction notes.', { needsKey: true });
            }
            let data;
            try {
                data = await Server.request('POST', '/auth', { body: { key: settings.apiKey }, auth: false });
            } catch (err) {
                const mapped = this._mapAuthError(err);
                this._failure = {
                    sig: this._sig(settings),
                    err: mapped,
                    until: mapped.transient ? Date.now() + CONFIG.BACKOFF_MS : Infinity,
                };
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
                serverUrl: settings.serverUrl,
            };
            this._failure = null;
            this._mem = session;
            Storage.write(CONFIG.SESSION_KEY, session);
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
        },

        /**
         * Forget the session and any remembered sign-in failure.
         * @returns {void}
         */
        clear() {
            this._mem = null;
            this._failure = null;
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
            if (!this.isConfigured() || !SettingsStore.get().apiKey) return false;
            try {
                await SharedStore.refresh();
                this._lastError = '';
                refreshAll();
                return true;
            } catch (err) {
                handleSharedError('Faction notes', err, { quiet });
                refreshAll(); // canEdit may have changed
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
.${CLS.btnReadOnly}{cursor:help;}
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
.${CLS.popMeta}{color:#9aa0a6;font-size:11px;margin:-4px 0 8px;}
.${CLS.status}{margin:4px 0 10px;color:#c9d1d9;white-space:pre-wrap;}
.${CLS.checklist}{max-height:240px;overflow:auto;border:1px solid #3a3f47;border-radius:4px;padding:4px;margin:6px 0 10px;}
.${CLS.checkRow}{display:flex;gap:6px;align-items:flex-start;padding:2px 0;cursor:pointer;}
.${CLS.checkRow} input{margin:2px 0 0;flex:0 0 auto;}
.${CLS.linkRow}{display:flex;gap:6px;}
.${CLS.notices}{position:fixed;right:16px;bottom:16px;z-index:${z + 3};display:flex;flex-direction:column;gap:6px;}
.${CLS.notice}{padding:8px 10px;max-width:320px;${panel}}
.${CLS.noticeError}{border-color:#d9534f;}
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
         * @returns {void}
         */
        show(message, isError = false) {
            if (!this._wrap || !this._wrap.isConnected) {
                this._wrap = el('div', { cls: CLS.notices, attrs: { role: 'status', 'aria-live': 'polite' } });
                document.body.append(this._wrap);
            }
            const item = el('div', { cls: [CLS.notice, isError ? CLS.noticeError : ''], text: `${CONFIG.SCRIPT_NAME}: ${message}` });
            this._wrap.append(item);
            setTimeout(() => item.remove(), CONFIG.NOTICE_MS * (isError ? 2 : 1));
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
        if (err instanceof ServerError && err.needsKey && !handleSharedError.promptedKey) {
            handleSharedError.promptedKey = true;
            openSettingsDialog(message);
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
            const editable = src.canEdit();
            const tip = el('div', { cls: CLS.tip, attrs: { role: 'tooltip' } });
            if (note) {
                if (note.label) {
                    const color = Data.colorFor(note.color);
                    const title = el('div', { cls: CLS.tipTitle, text: note.label });
                    title.style.color = color.bg;
                    tip.append(title);
                }
                if (note.text) tip.append(el('div', { cls: CLS.tipBody, text: note.text }));
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
         * @returns {HTMLButtonElement[]} The action buttons, in order.
         */
        open({ title, message = '', content = [], actions }) {
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
            const box = el('div', { cls: CLS.modal, attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title } }, [
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
            if (!sourceOf(btn).canEdit()) return;
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

    /** Class for each button kind. */
    const KIND_CLASS = Object.freeze({
        pill: CLS.kindPill,
        badge: CLS.kindBadge,
        faction: CLS.kindFaction,
        shared: CLS.kindShared,
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
        const editable = src.canEdit();
        const hidden = !note && (!editable || kind === 'shared');
        const name = btn.dataset[DATA_NAME] || 'item';

        btn.className = [
            CLS.btn,
            KIND_CLASS[kind] ?? CLS.kindPill,
            note ? CLS.btnNote : CLS.btnEmpty,
            note ? CLS.color(note.color) : '',
            editable ? '' : CLS.btnReadOnly,
            hidden ? CLS.btnHidden : '',
        ].filter(Boolean).join(' ');

        btn.replaceChildren();
        if (kind === 'shared') btn.append(createSharedIcon());
        if (note?.label) btn.append(el('span', { cls: CLS.label, text: note.label }));
        else if (kind !== 'shared') btn.append(createTagIcon());

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
            const cancelBtn = mkBtn('Cancel', '', () => this.close());
            const saveBtn = mkBtn('Save', CLS.uiPrimary, () => save());

            /**
             * Disable the form while a (possibly remote) save runs.
             * @param {boolean} on - Busy state.
             * @param {string} [label] - Save button text while busy.
             * @returns {void}
             */
            const setBusy = (on, label = 'Saving…') => {
                busy = on;
                [deleteBtn, cancelBtn, saveBtn, labelInput, textArea, ...swatches].forEach((x) => {
                    if (x) x.disabled = on;
                });
                saveBtn.textContent = on ? label : 'Save';
            };

            /**
             * Run a save/delete, then close and refresh; on failure keep the form open.
             * @param {() => Promise<void>} action - Work to do.
             * @param {string} context - Error context.
             * @param {string} busyLabel - Button text while running.
             * @returns {Promise<void>}
             */
            const run = async (action, context, busyLabel) => {
                if (busy) return;
                setBusy(true, busyLabel);
                try {
                    await action();
                    if (this._node === pop) this.close();
                    refreshId(id);
                } catch (err) {
                    if (this._node === pop) setBusy(false);
                    if (shared) handleSharedError(context, err);
                    else reportError(context, err);
                    refreshId(id); // e.g. editor rights were revoked
                }
            };

            const save = () => run(async () => {
                const label = labelInput.value.trim();
                const text = textArea.value.trimEnd();
                if (!label && !text.trim()) {
                    if (existing) await src.remove(id);
                } else {
                    await src.save(id, { label, color, text, itemName: name, itemId });
                }
            }, 'Could not save note', 'Saving…');
            const remove = () => run(() => src.remove(id), 'Could not delete note', 'Deleting…');

            let meta = null;
            if (shared && existing) {
                const who = existing.updatedByName || (existing.updatedById ? `#${existing.updatedById}` : 'unknown');
                meta = el('div', { cls: CLS.popMeta, text: `Last edited by ${who}, ${Data.relativeTime(existing.updated, Date.now())}` });
            }

            const pop = el('div', { cls: CLS.pop, attrs: { role: 'dialog', 'aria-label': `${shared ? 'Faction note' : 'Note'} for ${name}` } }, [
                el('div', { cls: CLS.popHead, text: name }),
                el('div', { cls: CLS.popSub, text: shared ? `Faction note · Armory ID #${id}` : `Armory ID #${id}` }),
                meta,
                el('label', { cls: CLS.field }, [el('span', { text: `Label (max ${CONFIG.LABEL_MAX})` }), labelInput]),
                datalist,
                swatchWrap,
                el('label', { cls: CLS.field }, [el('span', { text: 'Note' }), textArea, counter]),
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
        if (!SettingsStore.get().apiKey) return 'Not signed in: add your Public API key.';
        const s = Session.peek();
        if (!s) return 'Not signed in yet.';
        const role = s.canEdit ? 'editor (can change faction notes)' : 'viewer (read-only)';
        const faction = s.faction.name ? ` · ${s.faction.name}` : '';
        return `Signed in as ${s.player.name} [${s.player.id}]${faction}\nRole: ${role}`;
    }

    /**
     * Open the Settings dialog (server URL + Public API key).
     * @param {string} [reason] - Optional message shown at the top (e.g. why it opened).
     * @returns {void}
     */
    function openSettingsDialog(reason = '') {
        const current = SettingsStore.get();
        const urlInput = el('input', { attrs: { type: 'text', placeholder: 'https://torn-armory-notes.example.workers.dev', spellcheck: 'false', autocomplete: 'off' } });
        urlInput.value = current.serverUrl;
        const keyInput = el('input', { attrs: { type: 'password', maxlength: '16', placeholder: '16-character Public key', autocomplete: 'off', spellcheck: 'false' } });
        keyInput.value = current.apiKey;
        const status = el('div', { cls: CLS.status, text: sessionStatusText() });

        /**
         * Validate and store the form, then sign in.
         * @returns {Promise<void>}
         */
        const saveAndSignIn = async () => {
            let serverUrl;
            try {
                serverUrl = Data.normalizeServerUrl(urlInput.value);
            } catch (err) {
                status.textContent = err.message;
                return;
            }
            const apiKey = keyInput.value.trim();
            if (apiKey && !Data.isApiKeyFormat(apiKey)) {
                status.textContent = 'An API key is 16 letters and numbers. Create a Public key in Torn: Settings > API Keys.';
                return;
            }
            const before = SettingsStore.get();
            SettingsStore.set({ serverUrl, apiKey });
            if (before.serverUrl !== serverUrl || before.apiKey !== apiKey) {
                Session.clear();
                if (before.serverUrl !== serverUrl) SharedStore.clear();
                SharedStore.load();
                handleSharedError.promptedKey = false;
            }
            onSharingChanged();
            if (!serverUrl || !apiKey) {
                status.textContent = sessionStatusText();
                Notice.show(serverUrl ? 'Saved. Add your API key to see faction notes.' : 'Saved. Faction sharing is off.');
                return;
            }
            status.textContent = 'Signing in…';
            try {
                await Session.ensure();
                await SharedStore.refresh();
                Shared._lastError = '';
                refreshAll();
                status.textContent = sessionStatusText();
                Modal.close();
                Notice.show(`Signed in. ${Object.keys(SharedStore.notes()).length} faction notes loaded.`);
            } catch (err) {
                refreshAll();
                status.textContent = `Sign-in failed: ${err instanceof Error ? err.message : String(err)}`;
            }
        };

        Modal.open({
            title: 'Armory Notes settings',
            message: (reason ? `${reason}\n\n` : '')
                + 'Faction notes need your faction\'s notes server and a Torn API key with Public access. '
                + 'The key is stored only in this browser and sent only to that server when you sign in.',
            content: [
                el('label', { cls: CLS.field }, [el('span', { text: 'Faction notes server URL' }), urlInput]),
                el('label', { cls: CLS.field }, [el('span', { text: 'Torn API key (Public access)' }), keyInput]),
                status,
            ],
            actions: [
                {
                    label: 'Sign out',
                    onClick: () => {
                        SettingsStore.set({ serverUrl: SettingsStore.get().serverUrl, apiKey: '' });
                        keyInput.value = '';
                        Session.clear();
                        SharedStore.clear();
                        onSharingChanged();
                        status.textContent = sessionStatusText();
                        Notice.show('Signed out. Your key was removed from this browser.');
                    },
                },
                { label: 'Cancel', onClick: () => Modal.close() },
                { label: 'Save & sign in', variant: 'primary', onClick: saveAndSignIn },
            ],
        });
        (current.serverUrl ? keyInput : urlInput).focus();
    }

    /**
     * Open the "upload local notes to the faction" dialog (editors only).
     * Uploaded notes are moved: removed locally once the server accepts them.
     * @returns {Promise<void>}
     */
    async function openUploadDialog() {
        if (!Shared.isConfigured() || !SettingsStore.get().apiKey) {
            openSettingsDialog('Set up faction sharing before uploading notes.');
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
                            counter.textContent = 'Upload failed. Nothing was removed locally.';
                            handleSharedError('Upload', err);
                            await Shared.refreshAndRender({ quiet: true });
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
        Watchers.forEach((w) => w.scan());
        refreshAll();
        if (PageState.factionArmoryOpen) SharedSync.start();
        if (!Shared.isConfigured()) SharedSync.stop();
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
    const FACTION_ADAPTER = {
        name: 'faction',
        rowSelector: CONFIG.SEL.FACTION_ROW,
        getId: (row) => row.querySelector(CONFIG.SEL.FACTION_ID_HOLDER)?.dataset.armoryid,
        getCategory: (row) => row.querySelector(CONFIG.SEL.FACTION_TYPE)?.textContent.trim(),
        getItemId: (row) => row.querySelector(CONFIG.SEL.FACTION_ID_HOLDER)?.dataset.itemid ?? '',
        getName: (row) => ownText(row.querySelector(CONFIG.SEL.FACTION_NAME)),
        mounts: [
            {
                kind: 'faction',
                // Faction notes when sharing is set up; otherwise local notes (v1 behavior).
                source: () => (Shared.isConfigured() ? 'shared' : 'local'),
                findHost: (row) => row.querySelector(CONFIG.SEL.FACTION_NAME),
                attach: (host, btn) => {
                    host.classList.add(CLS.factionHost);
                    host.append(btn);
                },
            },
        ],
    };

    /**
     * Add or refresh note buttons on one row. Idempotent: unchanged buttons
     * are left alone so our own DOM writes do not retrigger observers.
     * @param {Element} row - Candidate item row.
     * @param {PageAdapter} adapter - Page adapter.
     * @returns {void}
     */
    function decorateRow(row, adapter) {
        const id = adapter.getId(row);
        if (!Data.isValidArmoryId(id)) return;
        if (!TRACKED.has(adapter.getCategory(row))) return;
        if (adapter === FACTION_ADAPTER) SeenIds.add(id);

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
        if (target?.closest(`.${CLS.btn}`)) return true;
        const nodes = [...rec.addedNodes, ...rec.removedNodes];
        return nodes.length > 0 && nodes.every((n) => n.nodeType === Node.ELEMENT_NODE && n.classList.contains(CLS.btn));
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
            if (this._active || !Shared.isConfigured()) return;
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
        if (Shared.isConfigured() && Date.now() - SharedStore.fetchedAt() > CONFIG.ITEMS_SHARED_MAX_AGE_MS) {
            await Shared.refreshAndRender({ quiet: true });
        }
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
        openSettingsDialog('Welcome! Your faction shares armory notes. Add a Public API key to see them.');
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
            PageState.factionArmoryOpen = true;
            SharedSync.start();
            maybePromptSetup();
        };
        const watcher = new RootWatcher(FACTION_ADAPTER, () => sync());
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
     * Register Tampermonkey menu commands.
     * @returns {void}
     */
    function registerMenu() {
        const guard = (label, fn) => () => {
            try {
                fn();
            } catch (err) {
                reportError(label, err);
            }
        };
        GM_registerMenuCommand('Settings (faction sharing)', guard('Settings', () => openSettingsDialog()));
        GM_registerMenuCommand('Refresh faction notes', guard('Refresh', () => {
            if (!Shared.isConfigured() || !SettingsStore.get().apiKey) {
                openSettingsDialog('Set up faction sharing first.');
                return;
            }
            Shared.refreshAndRender().then((ok) => {
                if (ok) Notice.show(`Faction notes refreshed (${Object.keys(SharedStore.notes()).length}).`);
            });
        }));
        GM_registerMenuCommand('Upload local notes to faction', guard('Upload', () => {
            openUploadDialog().catch((err) => reportError('Upload', err));
        }));
        GM_registerMenuCommand('Clear faction notes cache', guard('Clear cache', () => {
            SharedStore.clear();
            Session.clear();
            refreshAll();
            Notice.show('Faction notes cache cleared. Notes reload on the next refresh.');
            if (PageState.factionArmoryOpen) Shared.refreshAndRender();
        }));
        GM_registerMenuCommand('Export local notes (backup)', guard('Export', openExportDialog));
        GM_registerMenuCommand('Import local notes (restore)', guard('Import', openImportDialog));
        GM_registerMenuCommand('Clear all local notes', guard('Clear', openClearDialog));
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
