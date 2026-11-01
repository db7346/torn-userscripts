// ==UserScript==
// @name         Torn Armory Notes
// @namespace    dadgum.torn.armorynotes
// @version      1.0.0
// @description  Attach a colored label and a private note to individual weapons and armor (keyed by armory ID) on the Items page and the Faction Armory.
// @author       DadGum
// @license      MIT
// @match        https://www.torn.com/item.php*
// @match        https://www.torn.com/factions.php*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
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
 *   armory ID, so they follow that exact weapon between your inventory and
 *   the faction armory. Hover a label to read the full note.
 *
 * Pages
 *   - item.php                       (rows view and thumbnail view)
 *   - factions.php#/tab=armoury      (Weapons and Armor tabs)
 *
 * Author: DadGum
 *
 * Changelog
 *   1.0.0 (2026-11-01) Initial release: labels + notes per armory ID,
 *                      Items page (rows + thumbnails), Faction Armory,
 *                      JSON export / import (merge or replace), clear all.
 *
 * Torn API key usage disclosure
 *   - Key access level: NONE. This script never asks for, stores, or uses an
 *     API key and makes no API calls (0 calls/min).
 *   - Data storage: labels and notes you type are stored only in Tampermonkey
 *     storage in this browser (GM_setValue). Nothing is stored remotely.
 *   - Data sharing: none. The script makes no network requests of any kind.
 *   - Purpose of use: personal annotation of your own / your faction's items.
 *   - Key storage & sharing: not applicable (no key).
 *
 * Game-rule compliance
 *   Read-only helper. The script never clicks, equips, loans, sends, sells or
 *   otherwise acts in the game. It only reads item rows and adds its own UI.
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
     * Where and how a note button is mounted inside a row.
     * @typedef {Object} MountSpec
     * @property {string} kind                                  - 'pill' | 'badge' | 'faction'.
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
    };

    /* =========================================================================
     * API
     * -------------------------------------------------------------------------
     * Intentionally empty: this script needs no Torn API data. Everything it
     * uses (armory ID, item ID, name, category) is already in the page.
     * ====================================================================== */

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
            const note = NoteStore.get(id);
            const tip = el('div', { cls: CLS.tip, attrs: { role: 'tooltip' } });
            if (note) {
                if (note.label) {
                    const color = Data.colorFor(note.color);
                    const title = el('div', { cls: CLS.tipTitle, text: note.label });
                    title.style.color = color.bg;
                    tip.append(title);
                }
                if (note.text) tip.append(el('div', { cls: CLS.tipBody, text: note.text }));
                const when = note.updated ? new Date(note.updated).toLocaleString() : 'unknown date';
                tip.append(el('div', { cls: CLS.tipMeta, text: `#${id} · updated ${when} · click to edit` }));
            } else {
                tip.append(el('div', { cls: CLS.tipBody, text: 'Click to add a label or note' }));
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
         * @param {{label: string, variant?: 'primary'|'danger', disabled?: boolean, onClick: () => void}[]} opts.actions - Buttons.
         * @returns {HTMLButtonElement[]} The action buttons, in order.
         */
        open({ title, message = '', content = [], actions }) {
            this.close();
            Editor.close();
            const buttons = actions.map((a) => {
                const variant = a.variant === 'primary' ? CLS.uiPrimary : a.variant === 'danger' ? CLS.uiDanger : '';
                const b = el('button', { cls: [CLS.uiBtn, variant], text: a.label, attrs: { type: 'button' } });
                b.disabled = Boolean(a.disabled);
                b.addEventListener('click', () => {
                    try {
                        a.onClick();
                    } catch (err) {
                        reportError(a.label, err);
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
     * Render a note button's contents and classes for its note (or lack of one).
     * @param {HTMLButtonElement} btn - Button with data-tms-an-id set.
     * @param {Note|null} note - Note to show.
     * @returns {void}
     */
    function renderNoteButton(btn, note) {
        const kind = btn.dataset[DATA_KIND];
        const kindCls = kind === 'badge' ? CLS.kindBadge : kind === 'faction' ? CLS.kindFaction : CLS.kindPill;
        const name = btn.dataset[DATA_NAME] || 'item';
        btn.className = [CLS.btn, kindCls, note ? CLS.btnNote : CLS.btnEmpty, note ? CLS.color(note.color) : ''].join(' ').trim();
        btn.replaceChildren();
        if (note?.label) {
            btn.append(el('span', { cls: CLS.label, text: note.label }));
        } else {
            btn.append(createTagIcon());
        }
        const aria = note
            ? `Note for ${name}: ${note.label || 'unlabelled'}. Click to edit.`
            : `Add note to ${name}`;
        btn.setAttribute('aria-label', aria);
        btn.dataset[DATA_SIG] = Data.noteSignature(note);
        if (kind === 'faction') btn.parentElement?.classList.toggle(CLS.factionHostNote, Boolean(note));
    }

    /**
     * Re-render every mounted button for one armory ID (e.g. after a save).
     * @param {string} id - Armory ID.
     * @returns {void}
     */
    function refreshId(id) {
        if (!Data.isValidArmoryId(id)) return;
        const note = NoteStore.get(id);
        document.querySelectorAll(`.${CLS.btn}[data-tms-an-id="${id}"]`).forEach((btn) => renderNoteButton(btn, note));
    }

    /**
     * Re-render every mounted button (e.g. after import or clear).
     * @returns {void}
     */
    function refreshAll() {
        document.querySelectorAll(`.${CLS.btn}`).forEach((btn) => renderNoteButton(btn, NoteStore.get(btn.dataset[DATA_ID])));
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
            const existing = NoteStore.get(id);
            let color = existing?.color ?? CONFIG.DEFAULT_COLOR;

            const listId = `${PREFIX}-labels`;
            const datalist = el('datalist', { attrs: { id: listId } });
            for (const label of Data.collectLabels(NoteStore.snapshot().notes)) {
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

            const save = () => {
                try {
                    const label = labelInput.value.trim();
                    const text = textArea.value.trimEnd();
                    if (!label && !text.trim()) {
                        if (existing) NoteStore.remove(id);
                    } else {
                        NoteStore.upsert(id, { label, color, text, itemName: name, itemId });
                    }
                    this.close();
                    refreshId(id);
                } catch (err) {
                    reportError('Could not save note', err);
                }
            };
            const remove = () => {
                try {
                    NoteStore.remove(id);
                    this.close();
                    refreshId(id);
                } catch (err) {
                    reportError('Could not delete note', err);
                }
            };

            const mkBtn = (text, variant, handler) => {
                const b = el('button', { cls: [CLS.uiBtn, variant], text, attrs: { type: 'button' } });
                b.addEventListener('click', handler);
                return b;
            };

            const pop = el('div', { cls: CLS.pop, attrs: { role: 'dialog', 'aria-label': `Note for ${name}` } }, [
                el('div', { cls: CLS.popHead, text: name }),
                el('div', { cls: CLS.popSub, text: `Armory ID #${id}` }),
                el('label', { cls: CLS.field }, [el('span', { text: `Label (max ${CONFIG.LABEL_MAX})` }), labelInput]),
                datalist,
                swatchWrap,
                el('label', { cls: CLS.field }, [el('span', { text: 'Note' }), textArea, counter]),
                el('div', { cls: CLS.actions }, [
                    existing ? mkBtn('Delete', CLS.uiDanger, remove) : null,
                    el('span', { cls: CLS.spacer }),
                    mkBtn('Cancel', '', () => this.close()),
                    mkBtn('Save', CLS.uiPrimary, save),
                ]),
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
                findHost: (row) => row.querySelector(CONFIG.SEL.ITEMS_NAME_WRAP),
                attach: (host, btn) => {
                    const nameEl = host.querySelector(`:scope > ${CONFIG.SEL.ITEMS_NAME}`);
                    if (nameEl) nameEl.after(btn);
                    else host.append(btn);
                },
            },
            {
                kind: 'badge',
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
        const note = NoteStore.get(id);
        const sig = Data.noteSignature(note);

        for (const spec of adapter.mounts) {
            const host = spec.findHost(row);
            if (!host) continue;
            let btn = host.querySelector(`:scope > .${CLS.btn}`);
            if (btn && btn.dataset[DATA_ID] === id && btn.dataset[DATA_SIG] === sig) continue;
            if (!btn) {
                btn = createNoteButton(spec.kind);
                spec.attach(host, btn);
            }
            btn.dataset[DATA_ID] = id;
            btn.dataset[DATA_NAME] = adapter.getName(row);
            btn.dataset[DATA_ITEM] = adapter.getItemId(row);
            renderNoteButton(btn, note);
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
     * Items page: watch the item category container.
     * @returns {Promise<void>}
     */
    async function startItemsPage() {
        const root = await waitForElement(CONFIG.SEL.ITEMS_ROOT, CONFIG.WAIT_FOR_TIMEOUT_MS);
        if (!root) {
            reportError('Items page', new Error('Item list not found (Torn layout may have changed).'));
            return;
        }
        new RootWatcher(ITEMS_ADAPTER).attach(root);
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
        GM_registerMenuCommand('Export notes (backup)', guard('Export', openExportDialog));
        GM_registerMenuCommand('Import notes (restore)', guard('Import', openImportDialog));
        GM_registerMenuCommand('Clear all notes', guard('Clear', openClearDialog));
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
            const path = location.pathname;
            if (path === CONFIG.PATHS.ITEMS) {
                startItemsPage().catch((err) => reportError('Items page', err));
            } else if (path === CONFIG.PATHS.FACTIONS) {
                startFactionPage();
            }
            log('Initialized', path, `${NoteStore.count()} notes`);
        } catch (err) {
            reportError('Initialization failed', err);
        }
    }

    init();
})();
