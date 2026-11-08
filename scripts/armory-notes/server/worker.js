import { viewHtml } from './view.mjs';

/**
 * Torn Armory Notes - shared faction notes server (Cloudflare Worker + D1).
 *
 * Endpoints (JSON in, JSON out):
 *   POST   /auth                 { key }  -> { token, expiresAt, player, faction, canEdit, isAdmin,
 *                                           minScriptVersion }
 *   GET    /notes?since=<ms>     faction members: notes changed at/after <ms> (0 = all live notes);
 *                                editors also get { sync } (armory sync health); everyone gets
 *                                minScriptVersion (older scripts tell the member to update) and,
 *                                when ?bv= differs from borrowVersion, { borrowed: {armoryId: name} }
 *   PUT    /notes/:armoryId      editors: create/update one note
 *   DELETE /notes/:armoryId      editors: delete one note
 *   POST   /notes/import         editors: bulk upload { notes: [...] } (never overwrites)
 *   POST   /notes/fingerprints   editors: record item stat fingerprints and bonuses
 *                                { items: [{ armoryId, fingerprint, bonuses }] }
 *   POST   /items/seen           editors: record bonus items seen in the faction armory
 *                                { items: [{ armoryId, itemName, itemId, category,
 *                                            fingerprint, bonuses }] }
 *   GET    /trades?limit=        editors: recent trade-log entries
 *   GET    /trades/:tradeId      editors: whether a trade is logged, and its items
 *   POST   /trades/:tradeId      editors: log a trade { from, to, items: [{ armoryId or
 *                                fingerprint, itemName, direction: 'out'|'in' }] }
 *                                (replaces earlier log; fingerprints are matched here)
 *   POST   /trades/:tradeId/borrow editors: { from, items } mark the lender's items in this trade as
 *                                borrowed from `from` (items not seen yet are matched by stats when
 *                                they reach the armory); { from: '' } undoes it
 *   POST   /items/borrowed       editors: { armoryId, from } set or clear "Borrowed from" on one item
 *   POST   /items/mark           editors: { ids, action: sold|removed|returned|clear, owner? }
 *   GET    /items/missing        editors: items currently "Missing" (for the Missing items panel)
 *   POST   /trades/:tradeId/check editors: which of { items } would be logged (read-only;
 *                                drives the "log this trade?" reminder)
 *   DELETE /trades/:tradeId[/:armoryId]  editors: remove a trade's log (or one item)
 *   POST   /armory/sync          editors: run the armory sync now (5-minute cooldown)
 *   GET    /admin/editors        admin: editor list + faction member list (?refresh=1 reloads members)
 *   PUT    /admin/editors/:pid   admin: make a faction member an editor
 *   DELETE /admin/editors/:pid   admin: remove an editor
 *   GET    /view?key=            read-only web page of the same list (needs the VIEW_TOKEN
 *                                secret; off when it is not set)
 *   GET    /export.csv?token=    bonus items + notes as CSV for a spreadsheet (needs the
 *                                EXPORT_TOKEN secret; off when it is not set)
 *
 * Sync: clients poll with ?since=<changed>. `changed_at` moves on every change
 * (including fingerprint updates); `updated_at` is the last edit shown to users.
 *
 * Identity: the member's PUBLIC Torn API key is sent to POST /auth only. The
 * Worker calls GET https://api.torn.com/v2/user?selections=basic,faction once,
 * checks faction.id === FACTION_ID, and returns an HMAC-signed token (12 h).
 * The key is never stored or logged. Editor rights are checked against the
 * `editors` table (managed by the admin from the script) on every write, so
 * removing an editor takes effect immediately. The admin is ADMIN_ID: the
 * player ID comes from Torn at sign-in, inside a token signed with
 * TOKEN_SECRET, so nobody can claim it without that player's API key.
 *
 * Environment (Cloudflare dashboard > Settings > Variables & Secrets):
 *   FACTION_ID   (text)    faction allowed to use this server
 *   ADMIN_ID     (text)    the notes admin's player ID: always an editor, manages editors
 *   EDITOR_IDS   (text)    optional, legacy: copied once into the `editors` table, then unused
 *   TOKEN_SECRET (secret)  random string for signing tokens
 *   EXPORT_TOKEN (secret)  optional: enables /export.csv for anyone with the link
 *   VIEW_TOKEN   (secret)  optional: enables /view for anyone with the link
 *   ARMORY_API_KEY (secret) optional: the notes admin's own Limited Torn API key
 *                          (needs faction API access). Every 6 hours (cron) the
 *                          Worker reads the whole faction armory with it:
 *                          faction/inventory (Limited) + torn/itemdetails (Public).
 *                          Also used for faction/members (Public) when the admin
 *                          opens "Manage editors" (cached 12 hours).
 *                          A second cron (every 15 minutes) re-syncs only after
 *                          an editor logged or removed a trade.
 *   DB           (D1 binding, see wrangler.toml)
 */

/* ===========================================================================
 * CONFIG
 * ======================================================================== */

const CONFIG = Object.freeze({
    TORN_API_URL: 'https://api.torn.com/v2/user?selections=basic,faction&comment=ArmoryNotes',
    TORN_KEY_INFO_URL: 'https://api.torn.com/v2/key/info?comment=ArmoryNotes',
    /**
     * Key access levels accepted at sign-in (Torn's key/info access.type). Only
     * Full Access is refused. If a feature ever needs more than Public, offer a
     * link that creates a Custom key with only the selections it needs.
     */
    ALLOWED_KEY_TYPES: ['Public Only', 'Minimal Access', 'Limited Access', 'Custom'],
    /** Activity rows kept, and how many the view page shows. */
    ACTIVITY_KEEP_MS: 90 * 24 * 60 * 60 * 1000,
    ACTIVITY_SHOWN: 150,
    TOKEN_TTL_MS: 12 * 60 * 60 * 1000,
    ALLOWED_ORIGINS: Object.freeze(['https://www.torn.com', 'https://torn.com']),
    MAX_BODY_BYTES: 512 * 1024,
    MAX_IMPORT: 1000,
    MAX_RESULTS: 5000,
    LABEL_MAX: 16,
    TEXT_MAX: 1000,
    NAME_MAX: 100,
    COLORS: Object.freeze(['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'gray']),
    ARMORY_ID_PATTERN: /^\d{1,20}$/,
    /** "w|name|damage|accuracy" or "a|name|defence|bonuses"; no control characters. */
    FINGERPRINT_PATTERN: /^[wa]\|[^\u0000-\u001f]{3,248}$/,
    MAX_FINGERPRINTS: 500,
    /** Readable bonus text, e.g. "22% Execute, 34% Stricken". */
    BONUSES_MAX: 200,
    EXPORT_TOKEN_MIN: 16,
    MAX_SEEN: 500,
    MAX_TRADE_ITEMS: 50,
    TRADE_ID_PATTERN: /^\d{1,20}$/,
    PLAYER_NAME_PATTERN: /^[A-Za-z0-9_-]{1,32}$/,
    TRADE_LIST_MAX: 200,
    /** Armory sync (Torn API v2, called by the Worker with ARMORY_API_KEY). */
    TORN_V2: 'https://api.torn.com/v2',
    SYNC_INVENTORY_LIMIT: 100,
    SYNC_INVENTORY_MAX_PAGES: 5,
    SYNC_DETAILS_PER_CALL: 25,
    /** New items whose stats are looked up per sync (stats never change, so known items are skipped). */
    SYNC_DETAILS_MAX_CALLS: 35,
    SYNC_COOLDOWN_MS: 5 * 60 * 1000,
    /** Cron that re-syncs only when a trade was logged since the last sync (must match wrangler.toml). */
    QUICK_SYNC_CRON: '*/15 * * * *',
    /** Faction member list (for "Manage editors") is cached this long. */
    MEMBERS_TTL_MS: 12 * 60 * 60 * 1000,
    MAX_EDITORS: 200,
    /** Scripts older than this tell the member (once a day) to update. Raise it when a server change needs a newer script. */
    MIN_SCRIPT_VERSION: '2.9.0',
    /** A "Borrowed from" mark for an item not seen yet is kept this long. */
    BORROW_PENDING_MS: 7 * 24 * 60 * 60 * 1000,
    /** Most items per "Mark sold / removed / returned" request. */
    MAX_MARK: 500,
    /** Longest lender name stored. */
    OWNER_MAX: 32,
    /** A trade logged up to this long before an item disappeared counts as the reason it left. */
    TRADE_GRACE_MS: 7 * 24 * 60 * 60 * 1000,
    /** Without the sync: an item counts as missing once other items of its type were seen this much later. */
    HEURISTIC_MISSING_MS: 36 * 60 * 60 * 1000,
    CATEGORIES: Object.freeze(['Primary', 'Secondary', 'Melee', 'Defensive']),
    API_KEY_PATTERN: /^[A-Za-z0-9]{16}$/,
});

/* ===========================================================================
 * HTTP helpers
 * ======================================================================== */

/** Error that maps directly to an HTTP response. */
class HttpError extends Error {
    /**
     * @param {number} status - HTTP status.
     * @param {string} code - Machine-readable code (the script maps these).
     * @param {string} message - Human-readable message.
     * @param {Object} [extra] - Extra fields (e.g. { tornCode }).
     */
    constructor(status, code, message, extra = {}) {
        super(message);
        this.status = status;
        this.code = code;
        this.extra = extra;
    }
}

/**
 * CORS headers for an allowed origin (none for others).
 * @param {Request} request - Incoming request.
 * @returns {Object<string,string>} Headers.
 */
function corsHeaders(request) {
    const origin = request.headers.get('Origin');
    if (!origin || !CONFIG.ALLOWED_ORIGINS.includes(origin)) return {};
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
    };
}

/**
 * Build a JSON response.
 * @param {Request} request - Incoming request (for CORS).
 * @param {number} status - HTTP status.
 * @param {*} body - JSON-serializable body.
 * @returns {Response} Response.
 */
function json(request, status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(request) },
    });
}

/**
 * Parse a JSON request body with a size limit.
 * @param {Request} request - Incoming request.
 * @returns {Promise<any>} Parsed body.
 * @throws {HttpError} 413 if too large, 400 if not JSON.
 */
async function readJson(request) {
    // Reject oversized bodies before reading them when the size is declared.
    const declared = Number(request.headers.get('Content-Length'));
    if (Number.isFinite(declared) && declared > CONFIG.MAX_BODY_BYTES) {
        throw new HttpError(413, 'too_large', 'Request body is too large.');
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).length > CONFIG.MAX_BODY_BYTES) {
        throw new HttpError(413, 'too_large', 'Request body is too large.');
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new HttpError(400, 'bad_json', 'Request body is not valid JSON.');
    }
}

/* ===========================================================================
 * Config / env
 * ======================================================================== */

/**
 * Read and validate the Worker's environment.
 * @param {Object} env - Worker env.
 * @returns {{factionId: number, adminId: number, legacyEditors: number[], secret: string, db: any,
 *            editorSet: (Promise<Set<number>>|null)}} Parsed settings.
 * @throws {HttpError} 500 if misconfigured.
 */
function settings(env) {
    const factionId = Number(env.FACTION_ID);
    if (!Number.isInteger(factionId) || factionId <= 0) {
        throw new HttpError(500, 'server_config', 'Server is missing FACTION_ID.');
    }
    if (!env.TOKEN_SECRET || String(env.TOKEN_SECRET).length < 16) {
        throw new HttpError(500, 'server_config', 'Server is missing TOKEN_SECRET (16+ characters).');
    }
    if (!env.DB) throw new HttpError(500, 'server_config', 'Server is missing the DB (D1) binding.');
    const legacyEditors = String(env.EDITOR_IDS ?? '')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
    const adminId = Number(String(env.ADMIN_ID ?? '').trim());
    return {
        factionId,
        adminId: Number.isInteger(adminId) && adminId > 0 ? adminId : 0,
        legacyEditors,
        secret: String(env.TOKEN_SECRET),
        db: env.DB,
        /** @type {Promise<Set<number>>|null} Editor IDs, loaded once per request. */
        editorSet: null,
    };
}

/* ===========================================================================
 * Tokens (HMAC-SHA256, stateless)
 * ======================================================================== */

const enc = new TextEncoder();

/**
 * base64url-encode bytes or a string.
 * @param {Uint8Array|string} data - Input.
 * @returns {string} base64url text.
 */
function b64url(data) {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode base64url text to bytes.
 * @param {string} text - base64url text.
 * @returns {Uint8Array} Bytes.
 */
function fromB64url(text) {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
    const bin = atob(b64);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * Import the HMAC key.
 * @param {string} secret - TOKEN_SECRET.
 * @returns {Promise<CryptoKey>} Key.
 */
function hmacKey(secret) {
    return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/**
 * Create a signed token.
 * @param {{pid: number, name: string, fid: number, exp: number}} payload - Claims.
 * @param {string} secret - TOKEN_SECRET.
 * @returns {Promise<string>} Token "payload.signature".
 */
async function signToken(payload, secret) {
    const body = b64url(JSON.stringify(payload));
    const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
    return `${body}.${b64url(new Uint8Array(sig))}`;
}

/**
 * Verify a token from the Authorization header.
 * @param {Request} request - Incoming request.
 * @param {{secret: string, factionId: number}} cfg - Settings.
 * @returns {Promise<{pid: number, name: string, fid: number, exp: number}>} Claims.
 * @throws {HttpError} 401 if missing, invalid or expired.
 */
async function requireUser(request, cfg) {
    const header = request.headers.get('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const [body, sig] = token.split('.');
    if (!body || !sig) throw new HttpError(401, 'token_missing', 'Sign in required.');
    let ok = false;
    try {
        ok = await crypto.subtle.verify('HMAC', await hmacKey(cfg.secret), fromB64url(sig), enc.encode(body));
    } catch {
        ok = false;
    }
    if (!ok) throw new HttpError(401, 'token_invalid', 'Session is invalid. Please sign in again.');
    let claims;
    try {
        claims = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    } catch {
        throw new HttpError(401, 'token_invalid', 'Session is invalid. Please sign in again.');
    }
    if (!claims || typeof claims.exp !== 'number' || claims.exp < Date.now()) {
        throw new HttpError(401, 'token_expired', 'Session expired. Please sign in again.');
    }
    if (claims.fid !== cfg.factionId) throw new HttpError(403, 'not_member', 'This session is not for this faction.');
    return claims;
}

/**
 * Editor IDs from the `editors` table, loaded once per request. The first time,
 * the legacy EDITOR_IDS variable is copied into the table (marked in sync_state
 * so it never happens again, even if every editor is later removed). If the
 * table does not exist yet (migration 0006 not run), EDITOR_IDS is used as is.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Set<number>>} Editor player IDs (not including the admin).
 */
function loadEditors(cfg) {
    if (!cfg.editorSet) {
        cfg.editorSet = (async () => {
            let rows;
            try {
                // One query: the editors, plus a -1 marker once the legacy list was copied.
                ({ results: rows } = await cfg.db.prepare(
                    "SELECT player_id AS id FROM editors UNION ALL SELECT -1 AS id FROM sync_state WHERE k = 'editors_seeded'",
                ).all());
            } catch (err) {
                if (/no such table/i.test(String(err?.message ?? err))) return new Set(cfg.legacyEditors);
                throw err;
            }
            const ids = new Set((rows ?? []).map((r) => Number(r.id)));
            if (!ids.has(-1)) {
                const now = Date.now();
                await cfg.db.batch([
                    cfg.db.prepare(
                        `INSERT OR IGNORE INTO editors (player_id, player_name, added_by_id, added_by_name, added_at)
                         SELECT value, '', 0, 'old editor list', ?2 FROM json_each(?1)`,
                    ).bind(JSON.stringify(cfg.legacyEditors), now),
                    cfg.db.prepare("INSERT OR REPLACE INTO sync_state (k, v) VALUES ('editors_seeded', ?1)").bind(String(now)),
                ]);
                cfg.legacyEditors.forEach((id) => ids.add(id));
            }
            ids.delete(-1);
            return ids;
        })();
    }
    return cfg.editorSet;
}

/**
 * Whether a player may edit (the admin always can).
 * @param {number} pid - Player ID.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<boolean>} True for editors.
 */
async function isEditor(pid, cfg) {
    return (cfg.adminId !== 0 && pid === cfg.adminId) || (await loadEditors(cfg)).has(pid);
}

/**
 * Require editor rights (checked live on every request).
 * @param {{pid: number}} user - Claims.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<void>}
 * @throws {HttpError} 403 if not an editor.
 */
async function requireEditor(user, cfg) {
    if (!(await isEditor(user.pid, cfg))) throw new HttpError(403, 'not_editor', 'You are not allowed to edit faction notes.');
}

/**
 * Require the notes admin (ADMIN_ID).
 * @param {{pid: number}} user - Claims.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {void}
 * @throws {HttpError} 403 if ADMIN_ID is not set or this is someone else.
 */
function requireAdmin(user, cfg) {
    if (!cfg.adminId) throw new HttpError(403, 'admin_off', 'No admin is set on the server (ADMIN_ID variable).');
    if (user.pid !== cfg.adminId) throw new HttpError(403, 'not_admin', 'Only the notes admin can manage editors.');
}

/* ===========================================================================
 * Validation
 * ======================================================================== */

/**
 * Validate an armory ID path/body value.
 * @param {unknown} id - Candidate.
 * @returns {string} The ID.
 * @throws {HttpError} 400 if invalid.
 */
function armoryId(id) {
    const s = String(id ?? '');
    if (!CONFIG.ARMORY_ID_PATTERN.test(s)) throw new HttpError(400, 'bad_id', 'Invalid armory ID.');
    return s;
}

/**
 * Sanitize a note body.
 * @param {unknown} raw - Candidate note.
 * @returns {{label: string, color: string, text: string, itemName: string, itemId: string, fingerprint: (string|null)}}
 *   Clean note. fingerprint is null when not sent (keep the stored one).
 * @throws {HttpError} 400 if empty or invalid.
 */
function cleanNote(raw) {
    if (!raw || typeof raw !== 'object') throw new HttpError(400, 'bad_note', 'Note must be an object.');
    const label = String(raw.label ?? '').trim().slice(0, CONFIG.LABEL_MAX);
    const text = String(raw.text ?? '').trimEnd().slice(0, CONFIG.TEXT_MAX);
    if (!label && !text.trim()) throw new HttpError(400, 'empty_note', 'A note needs a label or text.');
    const color = CONFIG.COLORS.includes(raw.color) ? raw.color : 'blue';
    const itemName = String(raw.itemName ?? '').slice(0, CONFIG.NAME_MAX);
    const itemId = /^\d{1,10}$/.test(String(raw.itemId ?? '')) ? String(raw.itemId) : '';
    return {
        label, color, text, itemName, itemId,
        fingerprint: cleanFingerprint(raw.fingerprint),
        bonuses: cleanBonuses(raw.bonuses),
    };
}

/**
 * Validate optional bonus text ("22% Execute"). Empty is allowed (no bonus).
 * @param {unknown} b - Candidate.
 * @returns {string|null} Clean text, or null if missing or invalid (keep stored).
 */
function cleanBonuses(b) {
    if (typeof b !== 'string' || b.length > CONFIG.BONUSES_MAX || /[\u0000-\u001f]/.test(b)) return null;
    return b.trim();
}

/**
 * Validate an optional item fingerprint.
 * @param {unknown} fp - Candidate.
 * @returns {string|null} The fingerprint, or null if missing or invalid.
 */
function cleanFingerprint(fp) {
    return typeof fp === 'string' && CONFIG.FINGERPRINT_PATTERN.test(fp) ? fp : null;
}

/**
 * Convert a DB row to the API shape.
 * @param {Object} row - notes row.
 * @returns {Object} API note.
 */
function rowToNote(row) {
    return {
        armoryId: row.armory_id,
        label: row.label,
        color: row.color,
        text: row.text,
        itemName: row.item_name,
        itemId: row.item_id,
        updated: row.updated_at,
        changed: row.changed_at || row.updated_at,
        fingerprint: row.fingerprint ?? '',
        bonuses: row.bonuses ?? '',
        updatedById: row.updated_by_id,
        updatedByName: row.updated_by_name,
        deleted: row.deleted === 1,
    };
}

/* ===========================================================================
 * Handlers
 * ======================================================================== */

/**
 * POST /auth - verify a Public key with Torn and issue a session token.
 * @param {Request} request - Request.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} Response.
 */
async function handleAuth(request, cfg) {
    const body = await readJson(request);
    const key = String(body?.key ?? '').trim();
    if (!CONFIG.API_KEY_PATTERN.test(key)) {
        throw new HttpError(400, 'bad_key_format', 'That does not look like a Torn API key (16 letters/numbers).');
    }

    /**
     * One Torn call with the member's key (header only, never in the URL).
     * @param {string} url - Endpoint.
     * @returns {Promise<Object>} Parsed body.
     */
    const torn = async (url) => {
        let body;
        try {
            const res = await fetch(url, { headers: { Authorization: `ApiKey ${key}` } });
            body = await res.json();
        } catch {
            throw new HttpError(502, 'torn_unreachable', 'Could not reach the Torn API. Try again shortly.');
        }
        if (body?.error) {
            // Pass Torn's ApiError code through so the script can show the right message.
            throw new HttpError(401, 'torn_error', String(body.error.error ?? 'Torn API error'), { tornCode: Number(body.error.code) });
        }
        return body;
    };
    // Refuse Full Access keys: this script never needs them.
    const keyType = String((await torn(CONFIG.TORN_KEY_INFO_URL))?.info?.access?.type ?? '');
    if (!CONFIG.ALLOWED_KEY_TYPES.includes(keyType)) {
        throw new HttpError(403, 'key_level',
            `${keyType || 'This'} keys aren't accepted, to keep your account safe. Please use a Public key (a Limited or Custom key also works).`);
    }
    const data = await torn(CONFIG.TORN_API_URL);
    const pid = Number(data?.profile?.id);
    const name = String(data?.profile?.name ?? '');
    const fid = Number(data?.faction?.id ?? 0);
    if (!Number.isInteger(pid) || pid <= 0) throw new HttpError(502, 'torn_bad_response', 'Unexpected response from the Torn API.');
    if (fid !== cfg.factionId) {
        throw new HttpError(403, 'not_member', 'Faction notes are only available to members of this faction.');
    }

    const exp = Date.now() + CONFIG.TOKEN_TTL_MS;
    const token = await signToken({ pid, name, fid, exp }, cfg.secret);
    return json(request, 200, {
        token,
        expiresAt: exp,
        player: { id: pid, name },
        faction: { id: fid, name: String(data.faction?.name ?? '') },
        canEdit: await isEditor(pid, cfg),
        isAdmin: cfg.adminId !== 0 && pid === cfg.adminId,
        minScriptVersion: CONFIG.MIN_SCRIPT_VERSION,
    });
}

/**
 * GET /notes?since=<ms> - changed notes (including tombstones).
 * @param {Request} request - Request.
 * @param {URL} url - Parsed URL.
 * @param {Object} env - Worker env (for the sync key check).
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} Response.
 */
async function handleList(request, url, env, cfg) {
    const user = await requireUser(request, cfg);
    const canEdit = await isEditor(user.pid, cfg);
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    // A full load (since=0) skips tombstones; incremental loads include them.
    const sql = since === 0
        ? 'SELECT * FROM notes WHERE deleted = 0 ORDER BY changed_at LIMIT ?2'
        : 'SELECT * FROM notes WHERE changed_at >= ?1 ORDER BY changed_at LIMIT ?2';
    const { results } = await cfg.db.prepare(sql).bind(since, CONFIG.MAX_RESULTS).all();
    // Borrowed items (for "Borrowed from" in tooltips and the editor): only sent when changed.
    const ver = await cfg.db.prepare("SELECT v FROM sync_state WHERE k = 'borrow_ver'").first();
    const borrowVersion = String(ver?.v ?? '0');
    let borrowed;
    if (url.searchParams.get('bv') !== borrowVersion) {
        const { results: b } = await cfg.db.prepare("SELECT armory_id, borrowed_from FROM tracked_items WHERE borrowed_from <> ''").all();
        borrowed = Object.fromEntries((b ?? []).map((r) => [r.armory_id, r.borrowed_from]));
    }
    return json(request, 200, {
        serverTime: Date.now(),
        borrowVersion,
        ...(borrowed ? { borrowed } : {}),
        canEdit,
        isAdmin: cfg.adminId !== 0 && user.pid === cfg.adminId,
        minScriptVersion: CONFIG.MIN_SCRIPT_VERSION,
        notes: (results ?? []).map(rowToNote),
        hasMore: (results ?? []).length >= CONFIG.MAX_RESULTS,
        // Editors get the armory sync health, so their script can warn when it breaks.
        ...(canEdit ? { sync: await syncHealth(env, cfg) } : {}),
    });
}

/**
 * Upsert statement for one note.
 * @param {any} db - D1 binding.
 * @param {string} id - Armory ID.
 * @param {ReturnType<typeof cleanNote>} n - Note.
 * @param {{pid: number, name: string}} user - Editor.
 * @param {number} now - Timestamp.
 * @returns {any} Prepared statement.
 */
function upsertStmt(db, id, n, user, now) {
    return db.prepare(
        `INSERT INTO notes (armory_id, label, color, text, item_name, item_id, updated_at, updated_by_id, updated_by_name,
                            deleted, fingerprint, changed_at, bonuses)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, COALESCE(?10, ''), ?7, COALESCE(?11, ''))
         ON CONFLICT(armory_id) DO UPDATE SET
           label = excluded.label, color = excluded.color, text = excluded.text,
           item_name = CASE WHEN excluded.item_name <> '' THEN excluded.item_name ELSE notes.item_name END,
           item_id = CASE WHEN excluded.item_id <> '' THEN excluded.item_id ELSE notes.item_id END,
           fingerprint = COALESCE(?10, notes.fingerprint),
           bonuses = COALESCE(?11, notes.bonuses),
           updated_at = excluded.updated_at, changed_at = excluded.changed_at, updated_by_id = excluded.updated_by_id,
           updated_by_name = excluded.updated_by_name, deleted = 0`,
    ).bind(id, n.label, n.color, n.text, n.itemName, n.itemId, now, user.pid, user.name, n.fingerprint ?? null, n.bonuses ?? null);
}

/**
 * Log statement.
 * @param {any} db - D1 binding.
 * @param {string} id - Armory ID.
 * @param {string} action - 'upsert' | 'delete' | 'import'.
 * @param {ReturnType<typeof cleanNote>|null} n - Note (null for delete).
 * @param {{pid: number, name: string}} user - Editor.
 * @param {number} now - Timestamp.
 * @returns {any} Prepared statement.
 */
function logStmt(db, id, action, n, user, now) {
    return db.prepare(
        'INSERT INTO note_log (armory_id, action, label, color, text, at, by_id, by_name) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
    ).bind(id, action, n?.label ?? null, n?.color ?? null, n?.text ?? null, now, user.pid, user.name);
}

/**
 * PUT /notes/:id - create or update a note (editors).
 * @param {Request} request - Request.
 * @param {string} rawId - Path ID.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} Response.
 */
async function handlePut(request, rawId, cfg) {
    const user = await requireUser(request, cfg);
    await requireEditor(user, cfg);
    const id = armoryId(rawId);
    const note = cleanNote(await readJson(request));
    const now = Date.now();
    await cfg.db.batch([upsertStmt(cfg.db, id, note, user, now), logStmt(cfg.db, id, 'upsert', note, user, now)]);
    const row = await cfg.db.prepare('SELECT * FROM notes WHERE armory_id = ?1').bind(id).first();
    return json(request, 200, { note: rowToNote(row) });
}

/**
 * DELETE /notes/:id - tombstone a note (editors).
 * @param {Request} request - Request.
 * @param {string} rawId - Path ID.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} Response.
 */
async function handleDelete(request, rawId, cfg) {
    const user = await requireUser(request, cfg);
    await requireEditor(user, cfg);
    const id = armoryId(rawId);
    const now = Date.now();
    await cfg.db.batch([
        cfg.db.prepare(
            `UPDATE notes SET deleted = 1, label = '', text = '', fingerprint = '', bonuses = '', updated_at = ?2, changed_at = ?2,
                    updated_by_id = ?3, updated_by_name = ?4
             WHERE armory_id = ?1`,
        ).bind(id, now, user.pid, user.name),
        logStmt(cfg.db, id, 'delete', null, user, now),
    ]);
    const row = await cfg.db.prepare('SELECT * FROM notes WHERE armory_id = ?1').bind(id).first();
    return json(request, 200, { note: row ? rowToNote(row) : { armoryId: id, deleted: true, updated: now } });
}

/**
 * POST /notes/import - bulk insert (editors). Existing live notes are never overwritten.
 * @param {Request} request - Request.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} Response.
 */
async function handleImport(request, cfg) {
    const user = await requireUser(request, cfg);
    await requireEditor(user, cfg);
    const body = await readJson(request);
    const list = Array.isArray(body?.notes) ? body.notes : null;
    if (!list) throw new HttpError(400, 'bad_import', 'Expected { notes: [...] }.');
    if (list.length > CONFIG.MAX_IMPORT) throw new HttpError(413, 'too_many', `At most ${CONFIG.MAX_IMPORT} notes per import.`);

    const ids = [];
    const clean = new Map();
    const invalid = [];
    for (const raw of list) {
        try {
            const id = armoryId(raw?.armoryId);
            clean.set(id, cleanNote(raw));
            ids.push(id);
        } catch {
            invalid.push(String(raw?.armoryId ?? ''));
        }
    }

    // Which IDs already have a live (non-deleted) shared note?
    const existing = new Set();
    for (let i = 0; i < ids.length; i += 90) {
        const chunk = ids.slice(i, i + 90);
        const marks = chunk.map((_, j) => `?${j + 1}`).join(',');
        const { results } = await cfg.db
            .prepare(`SELECT armory_id FROM notes WHERE deleted = 0 AND armory_id IN (${marks})`)
            .bind(...chunk)
            .all();
        for (const r of results ?? []) existing.add(r.armory_id);
    }

    const now = Date.now();
    const added = [];
    const stmts = [];
    for (const [id, n] of clean) {
        if (existing.has(id)) continue;
        stmts.push(upsertStmt(cfg.db, id, n, user, now), logStmt(cfg.db, id, 'import', n, user, now));
        added.push(id);
    }
    for (let i = 0; i < stmts.length; i += 100) await cfg.db.batch(stmts.slice(i, i + 100));

    return json(request, 200, { added, skipped: [...existing], invalid });
}

/**
 * POST /notes/fingerprints - record item stat fingerprints and bonus text
 * (editors). Only live notes are touched, and only when something differs. Moves
 * `changed_at` so other members' polls pick it up, but not `updated_at` or the
 * editor name (this is not an edit of the note).
 * @param {Request} request - Request.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} Response with the changed notes.
 */
async function handleFingerprints(request, cfg) {
    const user = await requireUser(request, cfg);
    await requireEditor(user, cfg);
    const body = await readJson(request);
    const list = Array.isArray(body?.items) ? body.items : null;
    if (!list) throw new HttpError(400, 'bad_fingerprints', 'Expected { items: [...] }.');
    if (list.length > CONFIG.MAX_FINGERPRINTS) throw new HttpError(413, 'too_many', `At most ${CONFIG.MAX_FINGERPRINTS} items per request.`);

    /** @type {Map<string, {fp: string, bonuses: (string|null)}>} */
    const updates = new Map();
    for (const raw of list) {
        const fp = cleanFingerprint(raw?.fingerprint);
        const id = String(raw?.armoryId ?? '');
        if (fp && CONFIG.ARMORY_ID_PATTERN.test(id)) updates.set(id, { fp, bonuses: cleanBonuses(raw?.bonuses) });
    }
    // Only notes that exist, are live and differ change.
    const ids = [...updates.keys()];
    const toChange = [];
    for (let i = 0; i < ids.length; i += 90) {
        const chunk = ids.slice(i, i + 90);
        const marks = chunk.map((_, j) => `?${j + 1}`).join(',');
        const { results } = await cfg.db
            .prepare(`SELECT armory_id, fingerprint, bonuses FROM notes WHERE deleted = 0 AND armory_id IN (${marks})`)
            .bind(...chunk)
            .all();
        for (const r of results ?? []) {
            const u = updates.get(r.armory_id);
            if (r.fingerprint !== u.fp || (u.bonuses !== null && r.bonuses !== u.bonuses)) toChange.push(r.armory_id);
        }
    }
    const now = Date.now();
    const stmts = toChange.map((id) => cfg.db.prepare(
        'UPDATE notes SET fingerprint = ?2, bonuses = COALESCE(?4, bonuses), changed_at = ?3 WHERE armory_id = ?1 AND deleted = 0',
    ).bind(id, updates.get(id).fp, now, updates.get(id).bonuses));
    for (let i = 0; i < stmts.length; i += 100) await cfg.db.batch(stmts.slice(i, i + 100));

    const notes = [];
    for (let i = 0; i < toChange.length; i += 90) {
        const chunk = toChange.slice(i, i + 90);
        const marks = chunk.map((_, j) => `?${j + 1}`).join(',');
        const { results } = await cfg.db.prepare(`SELECT * FROM notes WHERE armory_id IN (${marks})`).bind(...chunk).all();
        notes.push(...(results ?? []).map(rowToNote));
    }
    return json(request, 200, { updated: notes.length, notes });
}

/**
 * POST /items/seen - record weapons/armor with a bonus seen in the faction
 * armory (editors). These are not notes: nothing shows in game for them;
 * they list every bonus item in the spreadsheet, with a blank label until
 * someone adds a note. Each call refreshes last_seen.
 * @param {Request} request - Request.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} Response with the count recorded.
 */
async function handleItemsSeen(request, cfg) {
    const user = await requireUser(request, cfg);
    await requireEditor(user, cfg);
    const body = await readJson(request);
    const list = Array.isArray(body?.items) ? body.items : null;
    if (!list) throw new HttpError(400, 'bad_items', 'Expected { items: [...] }.');
    if (list.length > CONFIG.MAX_SEEN) throw new HttpError(413, 'too_many', `At most ${CONFIG.MAX_SEEN} items per request.`);

    const now = Date.now();
    const rows = [];
    const seen = new Set();
    for (const raw of list) {
        const id = String(raw?.armoryId ?? '');
        const bonuses = cleanBonuses(raw?.bonuses);
        if (!CONFIG.ARMORY_ID_PATTERN.test(id) || !bonuses || seen.has(id)) continue; // bonus items only
        seen.add(id);
        rows.push({
            u: id,
            n: String(raw?.itemName ?? '').slice(0, CONFIG.NAME_MAX),
            i: /^\d{1,10}$/.test(String(raw?.itemId ?? '')) ? String(raw.itemId) : '',
            c: CONFIG.CATEGORIES.includes(raw?.category) ? raw.category : '',
            f: cleanFingerprint(raw?.fingerprint),
            b: bonuses,
        });
    }
    // One statement for all rows (D1's free plan limits queries per request).
    if (rows.length) {
        await cfg.db.prepare(
            `INSERT INTO tracked_items (armory_id, item_name, item_id, category, fingerprint, bonuses,
                                        first_seen, last_seen, seen_by_id, seen_by_name, in_armory, missing_since)
             SELECT json_extract(value, '$.u'), json_extract(value, '$.n'), json_extract(value, '$.i'),
                    json_extract(value, '$.c'), COALESCE(json_extract(value, '$.f'), ''), json_extract(value, '$.b'),
                    ?2, ?2, ?3, ?4, 1, NULL
             FROM json_each(?1) WHERE true
             ON CONFLICT(armory_id) DO UPDATE SET
               item_name = CASE WHEN excluded.item_name <> '' THEN excluded.item_name ELSE tracked_items.item_name END,
               item_id = CASE WHEN excluded.item_id <> '' THEN excluded.item_id ELSE tracked_items.item_id END,
               category = CASE WHEN excluded.category <> '' THEN excluded.category ELSE tracked_items.category END,
               fingerprint = CASE WHEN excluded.fingerprint <> '' THEN excluded.fingerprint ELSE tracked_items.fingerprint END,
               bonuses = excluded.bonuses, last_seen = excluded.last_seen,
               seen_by_id = excluded.seen_by_id, seen_by_name = excluded.seen_by_name,
               in_armory = 1, missing_since = NULL, disposition = ''`,
        ).bind(JSON.stringify(rows), now, user.pid, user.name).run();
        await applyBorrowPending(cfg.db, now);
    }
    return json(request, 200, { recorded: rows.length });
}

/* ===========================================================================
 * Trade log (editors tick "Log This As Traded" on a trade page)
 * ======================================================================== */

/**
 * Armory IDs that may be logged: weapons/armor with a bonus that were seen in
 * the faction armory, or that have a faction note with a bonus recorded.
 * @param {any} db - D1 binding.
 * @param {string[]} ids - Candidate armory IDs.
 * @returns {Promise<Map<string, string>>} Eligible ID -> item name.
 */
async function eligibleTradeItems(db, ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 45) {
        const chunk = ids.slice(i, i + 45);
        const marks = chunk.map((_, j) => `?${j + 1}`).join(',');
        const { results } = await db.prepare(
            `SELECT armory_id, item_name FROM tracked_items WHERE bonuses <> '' AND armory_id IN (${marks})
             UNION
             SELECT armory_id, item_name FROM notes WHERE deleted = 0 AND bonuses <> '' AND armory_id IN (${marks})`,
        ).bind(...chunk).all();
        for (const r of results ?? []) if (!out.has(r.armory_id) || !out.get(r.armory_id)) out.set(r.armory_id, r.item_name);
    }
    return out;
}

/**
 * The one armory ID whose recorded stats match a fingerprint.
 * @param {any} db - D1 binding.
 * @param {string|null} fp - Fingerprint.
 * @returns {Promise<string>} Armory ID, or '' if none or ambiguous (no guessing).
 */
async function armoryIdByFingerprint(db, fp) {
    if (!fp) return '';
    const { results } = await db.prepare(
        `SELECT armory_id FROM tracked_items WHERE fingerprint = ?1
         UNION SELECT armory_id FROM notes WHERE deleted = 0 AND fingerprint = ?1 LIMIT 2`,
    ).bind(fp).all();
    return (results ?? []).length === 1 ? results[0].armory_id : '';
}

/**
 * Validate a trade ID from the path.
 * @param {string} raw - Path segment.
 * @returns {string} Trade ID.
 * @throws {HttpError} 400 if invalid.
 */
function tradeId(raw) {
    const s = String(raw ?? '');
    if (!CONFIG.TRADE_ID_PATTERN.test(s)) throw new HttpError(400, 'bad_trade', 'Invalid trade ID.');
    return s;
}

/**
 * Convert trade_log rows to the API shape.
 * @param {Object} r - Row.
 * @returns {Object} Entry.
 */
function tradeRow(r) {
    return {
        tradeId: r.trade_id, armoryId: r.armory_id, itemName: r.item_name, from: r.from_name, to: r.to_name,
        loggedAt: r.logged_at, loggedById: r.logged_by_id, loggedByName: r.logged_by_name,
    };
}

/**
 * GET /trades/:tradeId - whether this trade is logged.
 * @param {Request} request - Request.
 * @param {string} rawId - Trade ID.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} { logged, borrowed, items }.
 */
async function handleTradeGet(request, rawId, cfg) {
    const user = await requireUser(request, cfg);
    await requireEditor(user, cfg);
    const id = tradeId(rawId);
    const { results } = await cfg.db.prepare('SELECT * FROM trade_log WHERE trade_id = ?1 ORDER BY id').bind(id).all();
    const b = await cfg.db.prepare(
        `SELECT (SELECT COUNT(*) FROM tracked_items WHERE borrowed_trade_id = ?1)
              + (SELECT COUNT(*) FROM borrow_pending WHERE trade_id = ?1) AS n`,
    ).bind(id).first();
    return json(request, 200, { logged: (results ?? []).length > 0, borrowed: Number(b?.n) > 0, items: (results ?? []).map(tradeRow) });
}

/**
 * GET /trades?limit= - recent log entries (newest first).
 * @param {Request} request - Request.
 * @param {URL} url - URL.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} { items }.
 */
async function handleTradeList(request, url, cfg) {
    const user = await requireUser(request, cfg);
    await requireEditor(user, cfg);
    const limit = Math.min(CONFIG.TRADE_LIST_MAX, Math.max(1, Number(url.searchParams.get('limit')) || 100));
    const { results } = await cfg.db.prepare('SELECT * FROM trade_log ORDER BY logged_at DESC, id DESC LIMIT ?1').bind(limit).all();
    return json(request, 200, { items: (results ?? []).map(tradeRow) });
}

/**
 * POST /trades/:tradeId - log a trade. Only eligible items are kept; an
 * earlier log of the same trade is replaced.
 * @param {Request} request - Request.
 * @param {string} rawId - Trade ID.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} { logged: [...], skipped: [armoryId] }.
 */
async function handleTradeLog(request, rawId, cfg) {
    const user = await requireUser(request, cfg);
    await requireEditor(user, cfg);
    const id = tradeId(rawId);
    const body = await readJson(request);
    const from = String(body?.from ?? '');
    const to = String(body?.to ?? '');
    // Only a party to the trade can log it: "from" is the logger's own side.
    if (from.toLowerCase() !== String(user.name).toLowerCase()) {
        throw new HttpError(403, 'not_party', 'You can only log trades you are part of.');
    }
    if (!CONFIG.PLAYER_NAME_PATTERN.test(from) || !CONFIG.PLAYER_NAME_PATTERN.test(to)) {
        throw new HttpError(400, 'bad_trade', 'Trade needs both player names.');
    }
    const { wanted, eligible } = await resolveTradeItems(cfg, body);
    const now = Date.now();
    const stmts = [cfg.db.prepare('DELETE FROM trade_log WHERE trade_id = ?1').bind(id)];
    const logged = [];
    for (const [aid, w] of wanted) {
        if (!eligible.has(aid)) continue;
        // 'out' = from the logger's side to the other player; 'in' = the reverse.
        const [src, dst] = w.direction === 'in' ? [to, from] : [from, to];
        const itemName = eligible.get(aid) || w.name;
        stmts.push(cfg.db.prepare(
            `INSERT INTO trade_log (trade_id, armory_id, item_name, from_name, to_name, logged_at, logged_by_id, logged_by_name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        ).bind(id, aid, itemName, src, dst, now, user.pid, user.name));
        logged.push({ armoryId: aid, itemName, from: src, to: dst });
    }
    if (!logged.length) {
        return json(request, 200, { logged: [], skipped: [...wanted.keys()] }); // nothing eligible: leave any earlier log alone
    }
    stmts.push(activityStmt(cfg.db, {
        kind: 'trade', user, armoryId: logged.length === 1 ? logged[0].armoryId : '',
        detail: `Logged trade #${id} with ${to}: ${logged.map((x) => x.itemName || x.armoryId).slice(0, 6).join(', ')}${logged.length > 6 ? ` (+${logged.length - 6} more)` : ''}`,
    }));
    await cfg.db.batch(stmts);
    await markSyncWanted(cfg);
    return json(request, 200, { logged, skipped: [...wanted.keys()].filter((aid) => !eligible.has(aid)) });
}

/**
 * Turn a trade's item list into armory IDs (yours by ID, theirs matched by
 * stats) and find the ones that count: bonus items from the armory or with a
 * faction note.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @param {{items?: Object[]}} body - Request body.
 * @returns {Promise<{wanted: Map<string, {direction: string, name: string}>, eligible: Map<string, string>}>}
 *   All matched items, and the eligible ones (armory ID -> item name).
 */
async function resolveTradeItems(cfg, body) {
    const list = Array.isArray(body?.items) ? body.items.slice(0, CONFIG.MAX_TRADE_ITEMS) : [];
    const wanted = new Map();
    for (const it of list) {
        let aid = String(it?.armoryId ?? '');
        if (!CONFIG.ARMORY_ID_PATTERN.test(aid)) {
            // The other person's items have no ID on the page: match by stats.
            aid = await armoryIdByFingerprint(cfg.db, cleanFingerprint(it?.fingerprint));
            if (!aid) continue;
        }
        wanted.set(aid, { direction: it?.direction === 'in' ? 'in' : 'out', name: String(it?.itemName ?? '').slice(0, CONFIG.NAME_MAX) });
    }
    const eligible = await eligibleTradeItems(cfg.db, [...wanted.keys()]);
    return { wanted, eligible };
}

/**
 * POST /trades/:tradeId/check - which items of this trade would be logged
 * (read-only; the script highlights "Log This As Traded" when there are any).
 * @param {Request} request - Request.
 * @param {string} rawId - Trade ID.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} { items: [{ armoryId, itemName }] }.
 */
async function handleTradeCheck(request, rawId, cfg) {
    const user = await requireUser(request, cfg);
    await requireEditor(user, cfg);
    tradeId(rawId);
    const { wanted, eligible } = await resolveTradeItems(cfg, await readJson(request));
    const items = [...wanted.entries()]
        .filter(([aid]) => eligible.has(aid))
        .map(([aid, w]) => ({ armoryId: aid, itemName: eligible.get(aid) || w.name }));
    return json(request, 200, { items });
}

/* ---- Activity log ---------------------------------------------------------- */

/**
 * Statement that records one line in the activity log (run it alone or in a batch).
 * @param {any} db - D1 binding.
 * @param {{kind: string, user?: {pid: number, name: string}|null, armoryId?: string, detail: string}} e - Entry.
 * @returns {any} Prepared statement.
 */
function activityStmt(db, { kind, user = null, armoryId = '', detail }) {
    return db.prepare('INSERT INTO activity (at, kind, actor_id, actor_name, armory_id, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
        .bind(Date.now(), kind, user?.pid ?? 0, user?.name ?? '', armoryId, String(detail).slice(0, 500));
}

/**
 * Item names for a list of armory IDs, for readable activity lines.
 * @param {any} db - D1 binding.
 * @param {string[]} ids - Armory IDs.
 * @returns {Promise<string>} e.g. "AK-47, 9mm Uzi (+3 more)".
 */
async function itemNames(db, ids) {
    const { results } = await db.prepare(
        'SELECT item_name FROM tracked_items WHERE armory_id IN (SELECT value FROM json_each(?1)) LIMIT 6',
    ).bind(JSON.stringify(ids.slice(0, 6))).all();
    const names = (results ?? []).map((r) => r.item_name || 'item');
    return names.join(', ') + (ids.length > names.length ? ` (+${ids.length - names.length} more)` : '');
}

/**
 * Recent activity for the view page: note changes (note_log) and everything
 * else (activity), newest first.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<{at: number, kind: string, actor: string, armoryId: string, item: string, detail: string}[]>} Entries.
 */
async function recentActivity(cfg) {
    const n = CONFIG.ACTIVITY_SHOWN;
    const { results } = await cfg.db.prepare(
        `SELECT * FROM (
           SELECT l.at AS at, 'note' AS kind, l.by_name AS actor, l.armory_id AS armory_id,
                  l.action AS action, l.label AS label, '' AS detail
           FROM note_log l ORDER BY l.at DESC LIMIT ?1)
         UNION ALL
         SELECT * FROM (
           SELECT a.at, a.kind, a.actor_name, a.armory_id, '', '', a.detail
           FROM activity a ORDER BY a.at DESC LIMIT ?1)
         ORDER BY at DESC LIMIT ?1`,
    ).bind(n).all();
    const ids = [...new Set((results ?? []).map((r) => r.armory_id).filter(Boolean))];
    const names = new Map();
    if (ids.length) {
        const { results: nm } = await cfg.db.prepare(
            `SELECT armory_id, item_name FROM tracked_items WHERE armory_id IN (SELECT value FROM json_each(?1))
             UNION SELECT armory_id, item_name FROM notes WHERE armory_id IN (SELECT value FROM json_each(?1))`,
        ).bind(JSON.stringify(ids)).all();
        for (const r of nm ?? []) if (r.item_name && !names.has(r.armory_id)) names.set(r.armory_id, r.item_name);
    }
    return (results ?? []).map((r) => {
        let detail = r.detail;
        if (r.kind === 'note') {
            detail = r.action === 'delete' ? 'Deleted the note'
                : r.action === 'import' ? `Uploaded a note${r.label ? ` "${r.label}"` : ''}`
                    : `Saved the note${r.label ? ` "${r.label}"` : ''}`;
        }
        return { at: r.at, kind: r.kind, actor: r.actor || '', armoryId: r.armory_id || '', item: names.get(r.armory_id) || '', detail };
    });
}

/* ---- Borrowed items and sold / removed marks ----------------------------- */

/**
 * Tidy a lender's name.
 * @param {unknown} raw - Candidate.
 * @returns {string} Name ('' if empty).
 */
function cleanOwner(raw) {
    return String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, CONFIG.OWNER_MAX);
}

/**
 * Record that the borrowed list changed (scripts reload it on their next poll).
 * @param {any} db - D1 binding.
 * @returns {Promise<void>}
 */
async function bumpBorrowVersion(db) {
    await writeSyncState(db, { borrow_ver: Date.now() });
}

/**
 * Apply "Borrowed from" marks waiting for items that have now reached the
 * armory (matched by stats), and drop expired ones. One cheap query when
 * nothing is waiting.
 * @param {any} db - D1 binding.
 * @param {number} now - Epoch ms.
 * @returns {Promise<number>} Items marked.
 */
async function applyBorrowPending(db, now) {
    const waiting = await db.prepare('SELECT COUNT(*) AS n FROM borrow_pending').first();
    if (!Number(waiting?.n)) return 0;
    const cutoff = now - CONFIG.BORROW_PENDING_MS;
    const [upd] = await db.batch([
        db.prepare(
            `UPDATE tracked_items SET borrowed_from = p.borrowed_from, borrowed_at = p.created_at,
                    borrowed_by_name = p.borrowed_by_name, borrowed_trade_id = p.trade_id
             FROM borrow_pending AS p
             WHERE tracked_items.fingerprint = p.fingerprint AND tracked_items.fingerprint <> ''
               AND tracked_items.in_armory = 1 AND p.created_at >= ?1`,
        ).bind(cutoff),
        db.prepare(
            `DELETE FROM borrow_pending WHERE created_at < ?1
               OR fingerprint IN (SELECT fingerprint FROM tracked_items WHERE in_armory = 1 AND borrowed_from <> '')`,
        ).bind(cutoff),
    ]);
    const n = Number(upd?.meta?.changes) || 0;
    if (n) {
        await activityStmt(db, { kind: 'borrowed', detail: `${n} borrowed item${n === 1 ? '' : 's'} reached the armory and were matched by stats` }).run();
        await bumpBorrowVersion(db);
    }
    return n;
}

/**
 * POST /trades/:tradeId/borrow - mark the lender's items in this trade as
 * borrowed (or undo it with from: ''). Items already known are marked now;
 * the rest are matched by stats when they reach the armory (within 7 days).
 * @param {Request} request - Request.
 * @param {string} rawId - Trade ID.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} { marked, pending } or { cleared }.
 */
async function handleTradeBorrow(request, rawId, cfg) {
    const user = await requireUser(request, cfg);
    await requireEditor(user, cfg);
    const id = tradeId(rawId);
    const body = await readJson(request);
    const from = cleanOwner(body?.from);
    if (!from) {
        const [a, b] = await cfg.db.batch([
            cfg.db.prepare(
                `UPDATE tracked_items SET borrowed_from = '', borrowed_at = NULL, borrowed_by_name = '', borrowed_trade_id = ''
                 WHERE borrowed_trade_id = ?1`,
            ).bind(id),
            cfg.db.prepare('DELETE FROM borrow_pending WHERE trade_id = ?1').bind(id),
            activityStmt(cfg.db, { kind: 'borrowed', user, detail: `Removed the "Borrowed" marks of trade #${id}` }),
        ]);
        await bumpBorrowVersion(cfg.db);
        return json(request, 200, { cleared: (Number(a?.meta?.changes) || 0) + (Number(b?.meta?.changes) || 0) });
    }
    const list = Array.isArray(body?.items) ? body.items.slice(0, CONFIG.MAX_TRADE_ITEMS) : [];
    const known = [];
    const pending = [];
    for (const it of list) {
        const fp = cleanFingerprint(it?.fingerprint);
        if (!fp) continue;
        // Only armory items can carry the mark; anything else waits until it reaches the armory.
        const { results } = await cfg.db.prepare('SELECT armory_id FROM tracked_items WHERE fingerprint = ?1 LIMIT 2').bind(fp).all();
        if ((results ?? []).length === 1) known.push(results[0].armory_id);
        else if (!pending.includes(fp)) pending.push(fp);
    }
    const now = Date.now();
    await cfg.db.batch([
        cfg.db.prepare(
            `UPDATE tracked_items SET borrowed_from = ?2, borrowed_at = ?3, borrowed_by_name = ?4, borrowed_trade_id = ?5
             WHERE armory_id IN (SELECT value FROM json_each(?1))`,
        ).bind(JSON.stringify(known), from, now, user.name, id),
        cfg.db.prepare(
            `INSERT INTO borrow_pending (fingerprint, borrowed_from, borrowed_by_name, trade_id, created_at)
             SELECT value, ?2, ?3, ?4, ?5 FROM json_each(?1) WHERE true
             ON CONFLICT(fingerprint) DO UPDATE SET borrowed_from = excluded.borrowed_from,
               borrowed_by_name = excluded.borrowed_by_name, trade_id = excluded.trade_id, created_at = excluded.created_at`,
        ).bind(JSON.stringify(pending), from, user.name, id, now),
        activityStmt(cfg.db, {
            kind: 'borrowed', user,
            detail: `Marked ${known.length + pending.length} item${known.length + pending.length === 1 ? '' : 's'} from trade #${id} as borrowed from ${from}`,
        }),
    ]);
    await bumpBorrowVersion(cfg.db);
    return json(request, 200, { marked: known.length, pending: pending.length });
}

/**
 * POST /items/borrowed - set or clear "Borrowed from" on one armory item.
 * @param {Request} request - Request.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} { armoryId, borrowedFrom }.
 */
async function handleItemBorrowed(request, cfg) {
    const user = await requireUser(request, cfg);
    await requireEditor(user, cfg);
    const body = await readJson(request);
    const id = armoryId(body?.armoryId);
    const from = cleanOwner(body?.from);
    const res = await cfg.db.prepare(
        `UPDATE tracked_items SET borrowed_from = ?2, borrowed_at = ?3, borrowed_by_name = ?4, borrowed_trade_id = ''
         WHERE armory_id = ?1`,
    ).bind(id, from, from ? Date.now() : null, from ? user.name : '').run();
    if (!Number(res?.meta?.changes)) {
        throw new HttpError(404, 'not_tracked', 'Only bonus weapons and armor seen in the faction armory can be marked as borrowed.');
    }
    await activityStmt(cfg.db, {
        kind: 'borrowed', user, armoryId: id, detail: from ? `Marked as borrowed from ${from}` : 'Cleared "Borrowed from"',
    }).run();
    await bumpBorrowVersion(cfg.db);
    return json(request, 200, { armoryId: id, borrowedFrom: from });
}

/**
 * POST /items/mark - mark items sold or removed, returned to their owner
 * (treated as borrowed, so hidden while gone), or clear a sold/removed mark.
 * @param {Request} request - Request.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} { updated }.
 */
async function handleItemsMark(request, cfg) {
    const user = await requireUser(request, cfg);
    await requireEditor(user, cfg);
    const body = await readJson(request);
    const ids = [...new Set((Array.isArray(body?.ids) ? body.ids : []).map(String).filter((x) => CONFIG.ARMORY_ID_PATTERN.test(x)))];
    if (!ids.length) throw new HttpError(400, 'bad_items', 'No valid armory IDs.');
    if (ids.length > CONFIG.MAX_MARK) throw new HttpError(413, 'too_many', `At most ${CONFIG.MAX_MARK} items at once.`);
    const action = String(body?.action ?? '');
    const now = Date.now();
    let stmt;
    if (action === 'sold' || action === 'removed') {
        stmt = cfg.db.prepare(
            `UPDATE tracked_items SET disposition = ?2, disposition_at = ?3, disposition_by_name = ?4
             WHERE armory_id IN (SELECT value FROM json_each(?1))`,
        ).bind(JSON.stringify(ids), action, now, user.name);
    } else if (action === 'clear') {
        stmt = cfg.db.prepare(
            `UPDATE tracked_items SET disposition = '', disposition_at = NULL, disposition_by_name = ''
             WHERE armory_id IN (SELECT value FROM json_each(?1))`,
        ).bind(JSON.stringify(ids));
    } else if (action === 'returned') {
        const owner = cleanOwner(body?.owner);
        if (!owner) throw new HttpError(400, 'no_owner', "Enter the owner's name.");
        stmt = cfg.db.prepare(
            `UPDATE tracked_items SET borrowed_from = ?2, borrowed_at = ?3, borrowed_by_name = ?4, borrowed_trade_id = ''
             WHERE armory_id IN (SELECT value FROM json_each(?1))`,
        ).bind(JSON.stringify(ids), owner, now, user.name);
    } else {
        throw new HttpError(400, 'bad_action', 'Unknown action.');
    }
    const res = await stmt.run();
    const n = Number(res?.meta?.changes) || 0;
    if (n) {
        const what = { sold: 'sold', removed: 'removed', clear: 'not sold / removed', returned: `returned to ${cleanOwner(body?.owner)}` }[action];
        await activityStmt(cfg.db, {
            kind: 'marked', user, armoryId: ids.length === 1 ? ids[0] : '',
            detail: `Marked ${n} item${n === 1 ? '' : 's'} as ${what}: ${await itemNames(cfg.db, ids)}`,
        }).run();
    }
    if (action === 'returned') await bumpBorrowVersion(cfg.db);
    return json(request, 200, { updated: n });
}

/**
 * GET /items/missing - items whose status is "Missing since …", newest first.
 * @param {Request} request - Request.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} { items: [{ armoryId, item, type, bonuses, label, missingSince }] }.
 */
async function handleItemsMissing(request, cfg) {
    const user = await requireUser(request, cfg);
    await requireEditor(user, cfg);
    const items = (await sheetRows(cfg))
        .filter((r) => r.statusKind === 'missing')
        .sort((a, b) => (b.missingSince ?? 0) - (a.missingSince ?? 0))
        .map((r) => ({ armoryId: r.armoryId, item: r.item, type: r.type, bonuses: r.bonuses, label: r.label, missingSince: r.missingSince }));
    return json(request, 200, { items });
}

/**
 * DELETE /trades/:tradeId[/:armoryId] - remove a trade's log, or one item.
 * @param {Request} request - Request.
 * @param {string} rawId - Trade ID.
 * @param {string|undefined} rawArmoryId - Optional armory ID.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} { removed }.
 */
async function handleTradeDelete(request, rawId, rawArmoryId, cfg) {
    const user = await requireUser(request, cfg);
    await requireEditor(user, cfg);
    const id = tradeId(rawId);
    const stmt = rawArmoryId === undefined
        ? cfg.db.prepare('DELETE FROM trade_log WHERE trade_id = ?1').bind(id)
        : cfg.db.prepare('DELETE FROM trade_log WHERE trade_id = ?1 AND armory_id = ?2').bind(id, armoryId(rawArmoryId));
    const res = await stmt.run();
    if (res?.meta?.changes) {
        await activityStmt(cfg.db, {
            kind: 'trade', user, armoryId: rawArmoryId === undefined ? '' : armoryId(rawArmoryId),
            detail: rawArmoryId === undefined ? `Removed the log of trade #${id}` : `Removed one item from the log of trade #${id}`,
        }).run();
        await markSyncWanted(cfg);
    }
    return json(request, 200, { removed: res?.meta?.changes ?? null });
}

/* ===========================================================================
 * CSV export
 * ======================================================================== */

/**
 * Constant-time string comparison (for the export token).
 * @param {string} a - First.
 * @param {string} b - Second.
 * @returns {boolean} True if equal.
 */
function safeEqual(a, b) {
    const x = enc.encode(String(a));
    const y = enc.encode(String(b));
    let diff = x.length ^ y.length;
    for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
    return diff === 0;
}

/**
 * One CSV cell: quoted, line breaks flattened, and text that a spreadsheet
 * would run as a formula (=, +, -, @) prefixed with an apostrophe.
 * @param {unknown} v - Value (numbers are written as-is).
 * @returns {string} CSV cell.
 */
function csvCell(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    let t = String(v ?? '').replace(/\r?\n/g, ' / ');
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return `"${t.replace(/"/g, '""')}"`;
}

/**
 * Epoch ms as "YYYY-MM-DD HH:MM" in Torn City Time (UTC); '' if missing.
 * @param {number|null|undefined} ms - Timestamp.
 * @returns {string} Formatted time.
 */
function tct(ms) {
    return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '';
}

/**
 * Stats from a fingerprint ("w|name|dmg|acc" or "a|name|def|bonuses").
 * @param {string} fp - Fingerprint.
 * @returns {{damage: (number|string), accuracy: (number|string), defence: (number|string)}} Stats ('' if unknown).
 */
function statsFromFingerprint(fp) {
    const parts = String(fp ?? '').split('|');
    const num = (s) => (s && /^\d+(\.\d+)?$/.test(s) ? Number(s) : '');
    if (parts[0] === 'w') return { damage: num(parts[2]), accuracy: num(parts[3]), defence: '' };
    if (parts[0] === 'a') return { damage: '', accuracy: '', defence: num(parts[2]) };
    return { damage: '', accuracy: '', defence: '' };
}

/**
 * "weapons" or "armor" for a row.
 * @param {string} category - Torn category (Primary/Secondary/Melee/Defensive) or ''.
 * @param {string} fp - Fingerprint ("a|…" = armor).
 * @returns {'weapons'|'armor'} Type.
 */
function itemType(category, fp) {
    if (category === 'Defensive') return 'armor';
    if (category) return 'weapons';
    return String(fp ?? '').startsWith('a|') ? 'armor' : 'weapons';
}

/**
 * Whether a logged trade brought the item TO the editor who logged it
 * (logged with direction 'in'). Only trade parties can log a trade, so the
 * receiver being the logger means the item came back to the faction side.
 * @param {{to_name: string, logged_by_name: string}} trade - trade_log row.
 * @returns {boolean} True for an incoming item.
 */
function isIncomingTrade(trade) {
    return String(trade.to_name ?? '').toLowerCase() === String(trade.logged_by_name ?? '').toLowerCase();
}

/**
 * One row per weapon/armor with a bonus: armory items first, then bonus items
 * with a faction note that were never seen in the armory. Shared by the CSV
 * export and the view page.
 *
 * Status:
 *  - "In armory"            in the armory at the last sync (or seen recently)
 *  - "Traded to X"          gone from the armory, and an editor logged a trade for it
 *  - "Missing since <date>" gone from the armory with no logged trade
 *  - "Not in armory"        a faction note on an item never seen in the armory
 * With the armory sync this is exact. Without it, an item counts as gone once
 * other items of its type were seen 36 hours after it.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Object[]>} Rows (times are epoch ms or null; stats numbers or '').
 */
async function sheetRows(cfg) {
    const { results: noteRows } = await cfg.db.prepare(
        `SELECT n.*,
           (SELECT by_name FROM note_log l WHERE l.armory_id = n.armory_id ORDER BY at DESC, id DESC LIMIT 1 OFFSET 1) AS prev_by,
           (SELECT at      FROM note_log l WHERE l.armory_id = n.armory_id ORDER BY at DESC, id DESC LIMIT 1 OFFSET 1) AS prev_at
         FROM notes n WHERE n.deleted = 0`,
    ).all();
    const { results: itemRows } = await cfg.db.prepare("SELECT * FROM tracked_items WHERE bonuses <> ''").all();
    const { results: tradeRows } = await cfg.db.prepare(
        `SELECT t.* FROM trade_log t
         WHERE t.id = (SELECT t2.id FROM trade_log t2 WHERE t2.armory_id = t.armory_id ORDER BY t2.logged_at DESC, t2.id DESC LIMIT 1)`,
    ).all();
    const lastTrade = new Map((tradeRows ?? []).map((t) => [t.armory_id, t]));
    const syncActive = Boolean((await readSyncState(cfg.db)).last_ok);

    const latestSeen = { weapons: 0, armor: 0 };
    for (const t of itemRows ?? []) {
        const ty = itemType(t.category, t.fingerprint);
        latestSeen[ty] = Math.max(latestSeen[ty], t.last_seen ?? 0);
    }
    const rows = new Map();
    for (const t of itemRows ?? []) rows.set(t.armory_id, { item: t, note: null });
    for (const n of noteRows ?? []) {
        const item = rows.get(n.armory_id)?.item ?? null;
        if (item || n.bonuses) rows.set(n.armory_id, { item, note: n });
    }
    const CATEGORY_NAMES = { Defensive: 'Armor' };
    return [...rows.entries()]
        .map(([id, { item, note }]) => {
            const fp = item?.fingerprint || note?.fingerprint || '';
            const st = statsFromFingerprint(fp);
            const trade = lastTrade.get(id);
            const type = itemType(item?.category ?? '', fp);
            let status = 'Not in armory';
            let statusKind = 'out';
            let missingSince = null;
            if (item) {
                let gone = item.in_armory === 0;
                missingSince = gone ? (item.missing_since ?? item.last_seen) : null;
                if (!syncActive && !gone && (item.last_seen ?? 0) < latestSeen[type] - CONFIG.HEURISTIC_MISSING_MS) {
                    gone = true;
                    missingSince = item.last_seen;
                }
                if (gone && item.borrowed_from) return null; // borrowed and given back: hidden until it returns
                if (!gone && item.borrowed_from) {
                    status = `In armory · Borrowed from ${item.borrowed_from}`;
                    statusKind = 'borrowed';
                } else if (!gone) {
                    status = 'In armory';
                    statusKind = 'in';
                } else if (item.disposition === 'sold' || item.disposition === 'removed') {
                    const when = tct(item.disposition_at).slice(0, 10);
                    status = `${item.disposition === 'sold' ? 'Sold' : 'Removed'} (${when}${item.disposition_by_name ? `, ${item.disposition_by_name}` : ''})`;
                    statusKind = item.disposition;
                } else if (trade && trade.logged_at >= (missingSince ?? 0) - CONFIG.TRADE_GRACE_MS) {
                    if (isIncomingTrade(trade)) {
                        // An editor logged receiving it: they hold it until they deposit it.
                        status = `Returned to ${trade.to_name} (not deposited)`;
                        statusKind = 'returned';
                    } else {
                        status = `Traded to ${trade.to_name}`;
                        statusKind = 'traded';
                    }
                } else {
                    status = `Missing since ${tct(missingSince).slice(0, 10)}`;
                    statusKind = 'missing';
                }
            }
            return {
                type,
                item: item?.item_name || note?.item_name || '',
                category: item?.category ? (CATEGORY_NAMES[item.category] ?? item.category) : '',
                source: item ? 'Armory' : 'Not in armory',
                status, statusKind, missingSince,
                loanedTo: statusKind === 'in' || statusKind === 'borrowed' ? (item?.loaned_to ?? '') : '',
                borrowedFrom: item?.borrowed_from ?? '',
                label: note?.label ?? '', note: note?.text ?? '', color: note?.color ?? '',
                armoryId: id, damage: st.damage, accuracy: st.accuracy, defence: st.defence,
                bonuses: item?.bonuses || note?.bonuses || '',
                lastEditedBy: note?.updated_by_name ?? '', lastEdited: note?.updated_at ?? null,
                prevBy: note?.prev_by ?? '', prevAt: note?.prev_at ?? null,
                tradedTo: trade?.to_name ?? '', tradedFrom: trade?.from_name ?? '',
                tradeAt: trade?.logged_at ?? null, tradeLoggedBy: trade?.logged_by_name ?? '',
            };
        })
        .filter(Boolean)
        .sort((a, b) => Number(a.source !== 'Armory') - Number(b.source !== 'Armory')
            || a.item.localeCompare(b.item) || a.armoryId.localeCompare(b.armoryId));
}

/**
 * GET /export.csv?token=… - live faction notes for a spreadsheet
 * (e.g. Google Sheets =IMPORTDATA). Off unless EXPORT_TOKEN is set.
 * @param {Request} request - Request.
 * @param {URL} url - Parsed URL.
 * @param {Object} env - Worker env.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} CSV response.
 */
async function handleExport(request, url, env, cfg) {
    const expected = String(env.EXPORT_TOKEN ?? '');
    if (expected.length < CONFIG.EXPORT_TOKEN_MIN) throw new HttpError(404, 'not_found', 'Not found.');
    if (!safeEqual(url.searchParams.get('token') ?? '', expected)) throw new HttpError(403, 'bad_token', 'Invalid export token.');

    // ?type=weapons or ?type=armor gives one tab's rows and columns; no type = everything.
    const type = ['weapons', 'armor'].includes(url.searchParams.get('type')) ? url.searchParams.get('type') : 'all';
    const col = (title, get) => ({ title, get });
    const head = [col('Item', (r) => r.item)];
    if (type !== 'armor') head.push(col('Category', (r) => r.category));
    head.push(col('Status', (r) => r.status), col('Loaned to', (r) => r.loanedTo), col('Label', (r) => r.label),
        col('Note', (r) => r.note), col('Color', (r) => r.color), col('Armory ID', (r) => r.armoryId));
    if (type !== 'armor') head.push(col('Damage', (r) => r.damage), col('Accuracy', (r) => r.accuracy));
    if (type !== 'weapons') head.push(col('Defence', (r) => r.defence));
    head.push(
        col('Bonuses', (r) => r.bonuses),
        col('Last edited by', (r) => r.lastEditedBy), col('Last edited (TCT)', (r) => tct(r.lastEdited)),
        col('Previous edit by', (r) => r.prevBy), col('Previous edit (TCT)', (r) => tct(r.prevAt)),
        col('Last trade', (r) => (r.tradedTo ? `Traded to ${r.tradedTo}` : '')), col('Last trade (TCT)', (r) => tct(r.tradeAt)),
        col('Trade logged by', (r) => r.tradeLoggedBy),
    );
    const lines = [head.map((c) => csvCell(c.title)).join(',')];
    for (const r of await sheetRows(cfg)) {
        if (type !== 'all' && r.type !== type) continue;
        lines.push(head.map((c) => csvCell(c.get(r))).join(','));
    }
    return new Response(`${lines.join('\r\n')}\r\n`, {
        status: 200,
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'inline; filename="armory-notes.csv"',
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex',
        },
    });
}

/**
 * GET /view?key=… - read-only page listing the same rows as the export, for
 * sharing without a Google account. Off unless VIEW_TOKEN is set.
 * @param {Request} request - Request.
 * @param {URL} url - Parsed URL.
 * @param {Object} env - Worker env.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} HTML response.
 */
async function handleView(request, url, env, cfg) {
    const expected = String(env.VIEW_TOKEN ?? '');
    const plain = (status, text) => new Response(text, {
        status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    });
    if (expected.length < CONFIG.EXPORT_TOKEN_MIN) return plain(404, 'Not found.');
    if (!safeEqual(url.searchParams.get('key') ?? '', expected)) return plain(403, 'This link is not valid. Ask your faction for the current one.');
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const sync = await readSyncState(cfg.db);
    const syncInfo = { configured: Boolean(env.ARMORY_API_KEY), lastOk: Number(sync.last_ok) || null, lastError: sync.last_error_at > (sync.last_ok || 0) ? sync.last_error ?? '' : '' };
    return new Response(viewHtml(await sheetRows(cfg), nonce, Date.now(), syncInfo, await recentActivity(cfg)), {
        status: 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex, nofollow',
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; `
                + "img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        },
    });
}

/* ===========================================================================
 * Armory sync (whole faction armory from the Torn API, every 6 hours)
 * ======================================================================== */

/**
 * Read the sync bookkeeping (last_run, last_ok, last_error, last_error_at, summary).
 * @param {any} db - D1 binding.
 * @returns {Promise<Object<string, *>>} Values (numbers where numeric).
 */
async function readSyncState(db) {
    const { results } = await db.prepare('SELECT k, v FROM sync_state').all();
    const out = {};
    for (const r of results ?? []) out[r.k] = /^\d+$/.test(r.v) ? Number(r.v) : r.v;
    return out;
}

/**
 * Write sync bookkeeping values in one statement.
 * @param {any} db - D1 binding.
 * @param {Object<string, (string|number)>} values - Keys and values.
 * @returns {Promise<void>}
 */
async function writeSyncState(db, values) {
    const rows = Object.entries(values).map(([k, v]) => ({ k, v: String(v) }));
    await db.prepare(
        `INSERT INTO sync_state (k, v) SELECT json_extract(value, '$.k'), json_extract(value, '$.v') FROM json_each(?1) WHERE true
         ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
    ).bind(JSON.stringify(rows)).run();
}

/**
 * Armory sync health for editors' scripts.
 * @param {Object} env - Worker env.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<{configured: boolean, lastOk: (number|null), lastError: string, lastErrorAt: (number|null)}>} Health.
 */
async function syncHealth(env, cfg) {
    const st = await readSyncState(cfg.db);
    return {
        configured: Boolean(env.ARMORY_API_KEY),
        lastOk: Number(st.last_ok) || null,
        lastError: typeof st.last_error === 'string' ? st.last_error : '',
        lastErrorAt: Number(st.last_error_at) || null,
    };
}

/**
 * Ask for a sync soon: the 15-minute cron runs one if a trade was logged or
 * removed since the last sync.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<void>}
 */
async function markSyncWanted(cfg) {
    await writeSyncState(cfg.db, { sync_wanted: Date.now() });
}

/**
 * Whether the quick cron should sync now: a trade changed since the last
 * sync started, and the last sync is outside the cooldown.
 * @param {Object<string, *>} st - readSyncState() result.
 * @param {number} now - Epoch ms.
 * @returns {boolean} True to sync.
 */
function quickSyncDue(st, now) {
    const wanted = Number(st.sync_wanted) || 0;
    const lastRun = Number(st.last_run) || 0;
    return wanted > lastRun && now - lastRun >= CONFIG.SYNC_COOLDOWN_MS;
}

/**
 * GET a Torn API v2 path with the armory key (header auth, never in the URL).
 * @param {string} path - Path and query, starting with "/".
 * @param {string} key - Limited API key.
 * @returns {Promise<any>} JSON.
 * @throws {Error} With Torn's error code and message.
 */
async function tornGet(path, key) {
    const sep = path.includes('?') ? '&' : '?';
    let data;
    try {
        const res = await fetch(`${CONFIG.TORN_V2}${path}${sep}comment=ArmoryNotes`, { headers: { Authorization: `ApiKey ${key}` } });
        data = await res.json();
    } catch {
        throw new Error('Could not reach the Torn API.');
    }
    if (data?.error) throw new Error(`Torn API error ${data.error.code}: ${data.error.error}`);
    return data;
}

/**
 * Fingerprint from API item details; must match the script's makeFingerprint().
 * @param {string} name - Item name.
 * @param {{damage: ?number, accuracy: ?number, armor: ?number}|null} stats - Stats.
 * @param {{title: string, value: number}[]} bonuses - Bonuses.
 * @returns {string|null} Fingerprint, or null if stats are missing.
 */
function apiFingerprint(name, stats, bonuses) {
    const n = String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/\|/g, '/');
    const fix = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : null);
    let fp = null;
    if (n && fix(stats?.damage) && fix(stats?.accuracy)) {
        fp = `w|${n}|${fix(stats.damage)}|${fix(stats.accuracy)}`;
    } else if (n && fix(stats?.armor)) {
        const b = (bonuses ?? []).map((x) => `${String(x.title).toLowerCase().replace(/[|,:]/g, '')}:${x.value}`).sort().join(',');
        fp = `a|${n}|${fix(stats.armor)}|${b}`;
    }
    return cleanFingerprint(fp);
}

/**
 * Read the whole faction armory (weapons + armor) and update tracked_items:
 * new items get their stats looked up (stats never change, so known items are
 * skipped), every present item is marked "in armory" with its loan, and items
 * no longer in the armory get "missing since". Uses a handful of D1 queries
 * regardless of armory size.
 * @param {Object} env - Worker env (needs ARMORY_API_KEY).
 * @returns {Promise<Object>} Summary.
 */
async function runArmorySync(env) {
    const cfg = settings(env);
    const key = String(env.ARMORY_API_KEY ?? '').trim();
    if (!/^[A-Za-z0-9]{16}$/.test(key)) return { ok: false, error: 'ARMORY_API_KEY is not set (or is not a 16-character key).' };
    const now = Date.now();
    await writeSyncState(cfg.db, { last_run: now });
    try {
        /** @type {Map<string, {name: string, itemId: string, type: string, loaned: ({id: number, name: string}|null)}>} */
        const present = new Map();
        for (const cat of ['weapons', 'armor']) {
            for (let page = 0, offset = 0; page < CONFIG.SYNC_INVENTORY_MAX_PAGES; page += 1, offset += CONFIG.SYNC_INVENTORY_LIMIT) {
                const data = await tornGet(`/faction/inventory?cat=${cat}&limit=${CONFIG.SYNC_INVENTORY_LIMIT}&offset=${offset}`, key);
                const list = Array.isArray(data?.inventory) ? data.inventory : [];
                for (const e of list) {
                    for (const uid of Array.isArray(e?.uids) ? e.uids : []) {
                        present.set(String(uid), {
                            name: String(e.name ?? '').slice(0, CONFIG.NAME_MAX),
                            itemId: String(e.id ?? ''),
                            type: CONFIG.CATEGORIES.includes(e.type) ? e.type : (cat === 'armor' ? 'Defensive' : ''),
                            loaned: e.loaned && typeof e.loaned === 'object' ? { id: Number(e.loaned.id) || 0, name: String(e.loaned.name ?? '') } : null,
                        });
                    }
                }
                if (list.length < CONFIG.SYNC_INVENTORY_LIMIT) break;
            }
        }
        const uids = [...present.keys()].filter((u) => CONFIG.ARMORY_ID_PATTERN.test(u));
        if (!uids.length) throw new Error('The faction armory came back empty; nothing was changed.');

        // Look up stats only for items not tracked yet.
        const { results: known } = await cfg.db.prepare(
            'SELECT armory_id FROM tracked_items WHERE armory_id IN (SELECT value FROM json_each(?1))',
        ).bind(JSON.stringify(uids)).all();
        const knownSet = new Set((known ?? []).map((r) => r.armory_id));
        const fresh = uids.filter((u) => !knownSet.has(u)).slice(0, CONFIG.SYNC_DETAILS_PER_CALL * CONFIG.SYNC_DETAILS_MAX_CALLS);
        const newRows = [];
        for (let i = 0; i < fresh.length; i += CONFIG.SYNC_DETAILS_PER_CALL) {
            const data = await tornGet(`/torn/${fresh.slice(i, i + CONFIG.SYNC_DETAILS_PER_CALL).join(',')}/itemdetails`, key);
            let list = data?.itemdetails;
            if (!Array.isArray(list)) list = list && typeof list === 'object' ? [list] : [];
            for (const d of list) {
                const uid = String(d?.uid ?? '');
                const inv = present.get(uid);
                if (!inv) continue;
                const bonuses = Array.isArray(d.bonuses) ? d.bonuses : [];
                newRows.push({
                    u: uid, n: inv.name || String(d.name ?? ''), i: inv.itemId, c: inv.type,
                    f: apiFingerprint(inv.name || d.name, d.stats, bonuses) ?? '',
                    // Items without a bonus are remembered (so they are not looked up again) but never listed.
                    b: bonuses.map((x) => `${x.value}% ${x.title}`).join(', ').slice(0, CONFIG.BONUSES_MAX),
                    l: inv.loaned?.name ?? '', li: inv.loaned?.id ?? 0,
                });
            }
        }
        if (newRows.length) {
            await cfg.db.prepare(
                `INSERT INTO tracked_items (armory_id, item_name, item_id, category, fingerprint, bonuses, first_seen, last_seen,
                                            seen_by_id, seen_by_name, in_armory, missing_since, loaned_to, loaned_to_id)
                 SELECT json_extract(value, '$.u'), json_extract(value, '$.n'), json_extract(value, '$.i'), json_extract(value, '$.c'),
                        json_extract(value, '$.f'), json_extract(value, '$.b'), ?2, ?2, 0, 'Armory sync', 1, NULL,
                        json_extract(value, '$.l'), json_extract(value, '$.li')
                 FROM json_each(?1) WHERE true
                 ON CONFLICT(armory_id) DO NOTHING`,
            ).bind(JSON.stringify(newRows), now).run();
        }
        // Everything present: in the armory, with its current loan.
        const presentRows = uids.map((u) => ({ u, l: present.get(u).loaned?.name ?? '', li: present.get(u).loaned?.id ?? 0, c: present.get(u).type }));
        await cfg.db.prepare(
            `UPDATE tracked_items SET in_armory = 1, missing_since = NULL, last_seen = ?2, disposition = '',
                    loaned_to = json_extract(j.value, '$.l'), loaned_to_id = json_extract(j.value, '$.li'),
                    category = CASE WHEN category = '' THEN json_extract(j.value, '$.c') ELSE category END
             FROM json_each(?1) AS j WHERE tracked_items.armory_id = json_extract(j.value, '$.u')`,
        ).bind(JSON.stringify(presentRows), now).run();
        // Everything else that was in the armory: gone since now.
        const gone = await cfg.db.prepare(
            `UPDATE tracked_items SET in_armory = 0, missing_since = COALESCE(missing_since, ?2), loaned_to = '', loaned_to_id = 0
             WHERE in_armory = 1 AND armory_id NOT IN (SELECT value FROM json_each(?1))`,
        ).bind(JSON.stringify(uids), now).run();
        const borrowedMatched = await applyBorrowPending(cfg.db, now);
        const summary = {
            ok: true, at: now, inArmory: uids.length, newlyLookedUp: newRows.length, borrowedMatched,
            newBonusItems: newRows.filter((r) => r.b).length, markedMissing: gone?.meta?.changes ?? null,
            remainingToLookUp: Math.max(0, uids.filter((u) => !knownSet.has(u)).length - fresh.length),
        };
        await writeSyncState(cfg.db, { last_ok: now, summary: JSON.stringify(summary) });
        await cfg.db.batch([
            activityStmt(cfg.db, {
                kind: 'sync',
                detail: `Armory sync: ${uids.length} items in the armory`
                    + (summary.markedMissing ? `, ${summary.markedMissing} newly gone` : ''),
            }),
            cfg.db.prepare('DELETE FROM activity WHERE at < ?1').bind(now - CONFIG.ACTIVITY_KEEP_MS),
        ]);
        return summary;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await writeSyncState(cfg.db, { last_error: message, last_error_at: Date.now() });
        await activityStmt(cfg.db, { kind: 'sync', detail: `Armory sync failed: ${message}` }).run().catch(() => {});
        console.error('Armory sync failed:', message); // never logs the key
        return { ok: false, error: message };
    }
}

/**
 * POST /armory/sync - run the sync now (editors; at most every 5 minutes).
 * @param {Request} request - Request.
 * @param {Object} env - Worker env.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} Summary.
 */
async function handleSyncNow(request, env, cfg) {
    const user = await requireUser(request, cfg);
    await requireEditor(user, cfg);
    if (!env.ARMORY_API_KEY) throw new HttpError(400, 'sync_off', 'Armory sync is not set up (ARMORY_API_KEY secret missing).');
    const st = await readSyncState(cfg.db);
    const wait = (Number(st.last_run) || 0) + CONFIG.SYNC_COOLDOWN_MS - Date.now();
    if (wait > 0) throw new HttpError(429, 'sync_cooldown', `Synced recently. Try again in ${Math.ceil(wait / 60000)} min.`);
    const result = await runArmorySync(env);
    if (!result.ok) throw new HttpError(502, 'sync_failed', result.error);
    return json(request, 200, result);
}

/* ===========================================================================
 * Admin: manage editors
 * ======================================================================== */

/**
 * Faction member list for the editor picker, from cache (12 hours) or
 * GET /v2/faction/members (Public; made with ARMORY_API_KEY).
 * @param {Object} env - Worker env.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @param {boolean} force - Reload even if the cache is fresh.
 * @returns {Promise<{members: {id: number, name: string, position: string}[], fetchedAt: (number|null), error: string}>} Members.
 */
async function factionMembers(env, cfg, force) {
    const st = await readSyncState(cfg.db);
    let cached = [];
    try {
        cached = JSON.parse(typeof st.members_json === 'string' ? st.members_json : '[]');
    } catch {
        cached = [];
    }
    const fetchedAt = Number(st.members_at) || null;
    if (!force && fetchedAt && Date.now() - fetchedAt < CONFIG.MEMBERS_TTL_MS && cached.length) {
        return { members: cached, fetchedAt, error: '' };
    }
    const key = String(env.ARMORY_API_KEY ?? '').trim();
    if (!/^[A-Za-z0-9]{16}$/.test(key)) {
        return { members: cached, fetchedAt, error: 'The member list needs the ARMORY_API_KEY secret. You can still add editors by player ID.' };
    }
    try {
        const data = await tornGet('/faction/members', key);
        const members = (Array.isArray(data?.members) ? data.members : [])
            .map((m) => ({ id: Number(m?.id), name: String(m?.name ?? '').slice(0, 32), position: String(m?.position ?? '').slice(0, 40) }))
            .filter((m) => Number.isInteger(m.id) && m.id > 0)
            .sort((a, b) => a.name.localeCompare(b.name));
        if (!members.length) throw new Error('Torn returned no faction members.');
        const now = Date.now();
        await writeSyncState(cfg.db, { members_json: JSON.stringify(members), members_at: now });
        return { members, fetchedAt: now, error: '' };
    } catch (err) {
        return { members: cached, fetchedAt, error: `Could not load the member list: ${err instanceof Error ? err.message : String(err)}` };
    }
}

/**
 * Current editors (not including the admin), with names filled in from the
 * member list where known.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @param {{id: number, name: string, position: string}[]} members - Member list.
 * @returns {Promise<Object[]>} Editors.
 */
async function editorList(cfg, members) {
    await loadEditors(cfg); // copies EDITOR_IDS the first time
    const { results } = await cfg.db.prepare('SELECT * FROM editors ORDER BY player_name, player_id').all();
    const byId = new Map(members.map((m) => [m.id, m]));
    // The admin is always an editor and is listed separately (they may also be in the copied EDITOR_IDS).
    return (results ?? []).filter((r) => Number(r.player_id) !== cfg.adminId).map((r) => {
        const m = byId.get(Number(r.player_id));
        return {
            id: Number(r.player_id),
            name: m?.name || r.player_name || '',
            position: m?.position ?? '',
            inFaction: members.length ? Boolean(m) : null,
            addedBy: r.added_by_name || '',
            addedAt: r.added_at || null,
        };
    });
}

/**
 * GET /admin/editors[?refresh=1] - editors, admin and faction members.
 * @param {Request} request - Request.
 * @param {URL} url - Parsed URL.
 * @param {Object} env - Worker env.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} { admin, editors, members, membersFetchedAt, membersError }.
 */
async function handleEditorsGet(request, url, env, cfg) {
    const user = await requireUser(request, cfg);
    requireAdmin(user, cfg);
    const m = await factionMembers(env, cfg, url.searchParams.get('refresh') === '1');
    return json(request, 200, {
        admin: { id: cfg.adminId, name: user.name },
        editors: await editorList(cfg, m.members),
        members: m.members,
        membersFetchedAt: m.fetchedAt,
        membersError: m.error,
    });
}

/**
 * Validate a player ID path value.
 * @param {string} raw - Candidate.
 * @returns {number} Player ID.
 * @throws {HttpError} 400 if invalid.
 */
function playerId(raw) {
    const n = Number(raw);
    if (!/^\d{1,10}$/.test(String(raw)) || !Number.isInteger(n) || n <= 0) throw new HttpError(400, 'bad_player', 'Invalid player ID.');
    return n;
}

/**
 * PUT /admin/editors/:pid - make a player an editor.
 * @param {Request} request - Request.
 * @param {string} rawPid - Player ID.
 * @param {Object} env - Worker env.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} { editors }.
 */
async function handleEditorAdd(request, rawPid, env, cfg) {
    const user = await requireUser(request, cfg);
    requireAdmin(user, cfg);
    const pid = playerId(rawPid);
    if (pid === cfg.adminId) throw new HttpError(400, 'is_admin', 'You are the admin, so you are always an editor.');
    const m = await factionMembers(env, cfg, false);
    const member = m.members.find((x) => x.id === pid);
    if (m.members.length && !member) throw new HttpError(400, 'not_member', `Player ${pid} is not in the faction member list. Reload the list if they joined recently.`);
    const editors = await loadEditors(cfg);
    if (!editors.has(pid) && editors.size >= CONFIG.MAX_EDITORS) throw new HttpError(400, 'too_many', 'Editor limit reached.');
    await cfg.db.prepare(
        `INSERT INTO editors (player_id, player_name, added_by_id, added_by_name, added_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(player_id) DO UPDATE SET player_name = excluded.player_name`,
    ).bind(pid, member?.name ?? '', user.pid, user.name, Date.now()).run();
    await activityStmt(cfg.db, { kind: 'editors', user, detail: `Made ${member?.name || `player ${pid}`} [${pid}] an editor` }).run();
    return json(request, 200, { editors: await editorList(cfg, m.members) });
}

/**
 * DELETE /admin/editors/:pid - remove an editor (takes effect on their next change).
 * @param {Request} request - Request.
 * @param {string} rawPid - Player ID.
 * @param {Object} env - Worker env.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} { editors }.
 */
async function handleEditorRemove(request, rawPid, env, cfg) {
    const user = await requireUser(request, cfg);
    requireAdmin(user, cfg);
    const pid = playerId(rawPid);
    if (pid === cfg.adminId) throw new HttpError(400, 'is_admin', 'The admin cannot be removed. Change ADMIN_ID in Cloudflare instead.');
    await loadEditors(cfg); // make sure the legacy list was copied first, so it cannot come back
    const gone = await cfg.db.prepare('DELETE FROM editors WHERE player_id = ?1').bind(pid).run();
    const m = await factionMembers(env, cfg, false);
    if (Number(gone?.meta?.changes)) {
        const who = m.members.find((x) => x.id === pid)?.name || `player ${pid}`;
        await activityStmt(cfg.db, { kind: 'editors', user, detail: `Removed ${who} [${pid}] as an editor` }).run();
    }
    return json(request, 200, { editors: await editorList(cfg, m.members) });
}

/* ===========================================================================
 * Router
 * ======================================================================== */

export default {
    /**
     * Worker entry point.
     * @param {Request} request - Incoming request.
     * @param {Object} env - Bindings and variables.
     * @returns {Promise<Response>} Response.
     */
    async fetch(request, env) {
        try {
            // No Origin check: requests come from GM_xmlhttpRequest (extension
            // origin varies by browser) and auth is a bearer token, not a cookie,
            // so cross-site request forgery does not apply. CORS headers are
            // only sent for torn.com origins.
            if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });

            const url = new URL(request.url);
            const path = url.pathname.replace(/\/+$/, '') || '/';
            if (path === '/' && request.method === 'GET') return json(request, 200, { ok: true, service: 'torn-armory-notes' });

            const cfg = settings(env);
            if (path === '/auth' && request.method === 'POST') return await handleAuth(request, cfg);
            if (path === '/notes' && request.method === 'GET') return await handleList(request, url, env, cfg);
            if (path === '/notes/import' && request.method === 'POST') return await handleImport(request, cfg);
            if (path === '/notes/fingerprints' && request.method === 'POST') return await handleFingerprints(request, cfg);
            if (path === '/items/seen' && request.method === 'POST') return await handleItemsSeen(request, cfg);
            if (path === '/items/borrowed' && request.method === 'POST') return await handleItemBorrowed(request, cfg);
            if (path === '/items/mark' && request.method === 'POST') return await handleItemsMark(request, cfg);
            if (path === '/items/missing' && request.method === 'GET') return await handleItemsMissing(request, cfg);
            if (path === '/trades' && request.method === 'GET') return await handleTradeList(request, url, cfg);
            const t = path.match(/^\/trades\/([^/]+)(?:\/([^/]+))?$/);
            if (t && !t[2] && request.method === 'GET') return await handleTradeGet(request, t[1], cfg);
            if (t && !t[2] && request.method === 'POST') return await handleTradeLog(request, t[1], cfg);
            if (t && t[2] === 'check' && request.method === 'POST') return await handleTradeCheck(request, t[1], cfg);
            if (t && t[2] === 'borrow' && request.method === 'POST') return await handleTradeBorrow(request, t[1], cfg);
            if (t && request.method === 'DELETE') return await handleTradeDelete(request, t[1], t[2], cfg);
            if (path === '/export.csv' && request.method === 'GET') return await handleExport(request, url, env, cfg);
            if (path === '/view' && request.method === 'GET') return await handleView(request, url, env, cfg);
            if (path === '/armory/sync' && request.method === 'POST') return await handleSyncNow(request, env, cfg);
            if (path === '/admin/editors' && request.method === 'GET') return await handleEditorsGet(request, url, env, cfg);
            const ed = path.match(/^\/admin\/editors\/([^/]+)$/);
            if (ed && request.method === 'PUT') return await handleEditorAdd(request, ed[1], env, cfg);
            if (ed && request.method === 'DELETE') return await handleEditorRemove(request, ed[1], env, cfg);
            const m = path.match(/^\/notes\/([^/]+)$/);
            if (m && request.method === 'PUT') return await handlePut(request, m[1], cfg);
            if (m && request.method === 'DELETE') return await handleDelete(request, m[1], cfg);
            throw new HttpError(404, 'not_found', 'Not found.');
        } catch (err) {
            if (err instanceof HttpError) {
                return json(request, err.status, { error: { code: err.code, message: err.message, ...err.extra } });
            }
            console.error('Unhandled error:', err?.message ?? err); // never logs keys or bodies
            return json(request, 500, { error: { code: 'server_error', message: 'Unexpected server error.' } });
        }
    },

    /**
     * Cron triggers (wrangler.toml): the 6-hour full sync always runs; the
     * 15-minute one only when a trade was logged or removed since the last sync.
     * @param {ScheduledController} event - Event (event.cron is the schedule string).
     * @param {Object} env - Bindings and variables.
     * @param {ExecutionContext} ctx - Context.
     * @returns {void}
     */
    scheduled(event, env, ctx) {
        if (!env.ARMORY_API_KEY) return;
        const run = async () => {
            if (event.cron === CONFIG.QUICK_SYNC_CRON && !quickSyncDue(await readSyncState(settings(env).db), Date.now())) return;
            await runArmorySync(env);
        };
        ctx.waitUntil(run().catch((err) => console.error('Armory sync crashed:', err?.message ?? err)));
    },
};
