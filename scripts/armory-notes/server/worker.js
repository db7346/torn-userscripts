/**
 * Torn Armory Notes - shared faction notes server (Cloudflare Worker + D1).
 *
 * Endpoints (JSON in, JSON out):
 *   POST   /auth                 { key }  -> { token, expiresAt, player, faction, canEdit }
 *   GET    /notes?since=<ms>     faction members: notes changed at/after <ms> (0 = all live notes)
 *   PUT    /notes/:armoryId      editors: create/update one note
 *   DELETE /notes/:armoryId      editors: delete one note
 *   POST   /notes/import         editors: bulk upload { notes: [...] } (never overwrites)
 *
 * Identity: the member's PUBLIC Torn API key is sent to POST /auth only. The
 * Worker calls GET https://api.torn.com/v2/user?selections=basic,faction once,
 * checks faction.id === FACTION_ID, and returns an HMAC-signed token (12 h).
 * The key is never stored or logged. Editor rights are checked against
 * EDITOR_IDS on every write, so removing an editor takes effect immediately.
 *
 * Environment (Cloudflare dashboard > Settings > Variables & Secrets):
 *   FACTION_ID   (text)    faction allowed to use this server
 *   EDITOR_IDS   (text)    comma-separated player IDs allowed to edit
 *   TOKEN_SECRET (secret)  random string for signing tokens
 *   DB           (D1 binding, see wrangler.toml)
 */

/* ===========================================================================
 * CONFIG
 * ======================================================================== */

const CONFIG = Object.freeze({
    TORN_API_URL: 'https://api.torn.com/v2/user?selections=basic,faction&comment=ArmoryNotes',
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
    const text = await request.text();
    if (text.length > CONFIG.MAX_BODY_BYTES) throw new HttpError(413, 'too_large', 'Request body is too large.');
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
 * @returns {{factionId: number, editors: Set<number>, secret: string, db: any}} Parsed settings.
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
    const editors = new Set(
        String(env.EDITOR_IDS ?? '')
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n) && n > 0),
    );
    return { factionId, editors, secret: String(env.TOKEN_SECRET), db: env.DB };
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
 * Require editor rights (checked live against EDITOR_IDS).
 * @param {{pid: number}} user - Claims.
 * @param {{editors: Set<number>}} cfg - Settings.
 * @returns {void}
 * @throws {HttpError} 403 if not an editor.
 */
function requireEditor(user, cfg) {
    if (!cfg.editors.has(user.pid)) throw new HttpError(403, 'not_editor', 'You are not allowed to edit faction notes.');
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
 * @returns {{label: string, color: string, text: string, itemName: string, itemId: string}} Clean note.
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
    return { label, color, text, itemName, itemId };
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

    let data;
    try {
        const res = await fetch(CONFIG.TORN_API_URL, { headers: { Authorization: `ApiKey ${key}` } });
        data = await res.json();
    } catch {
        throw new HttpError(502, 'torn_unreachable', 'Could not reach the Torn API. Try again shortly.');
    }
    if (data?.error) {
        // Pass Torn's ApiError code through so the script can show the right message.
        throw new HttpError(401, 'torn_error', String(data.error.error ?? 'Torn API error'), { tornCode: Number(data.error.code) });
    }
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
        canEdit: cfg.editors.has(pid),
    });
}

/**
 * GET /notes?since=<ms> - changed notes (including tombstones).
 * @param {Request} request - Request.
 * @param {URL} url - Parsed URL.
 * @param {ReturnType<typeof settings>} cfg - Settings.
 * @returns {Promise<Response>} Response.
 */
async function handleList(request, url, cfg) {
    const user = await requireUser(request, cfg);
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    // A full load (since=0) skips tombstones; incremental loads include them.
    const sql = since === 0
        ? 'SELECT * FROM notes WHERE deleted = 0 ORDER BY updated_at LIMIT ?2'
        : 'SELECT * FROM notes WHERE updated_at >= ?1 ORDER BY updated_at LIMIT ?2';
    const { results } = await cfg.db.prepare(sql).bind(since, CONFIG.MAX_RESULTS).all();
    return json(request, 200, {
        serverTime: Date.now(),
        canEdit: cfg.editors.has(user.pid),
        notes: (results ?? []).map(rowToNote),
        hasMore: (results ?? []).length >= CONFIG.MAX_RESULTS,
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
        `INSERT INTO notes (armory_id, label, color, text, item_name, item_id, updated_at, updated_by_id, updated_by_name, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0)
         ON CONFLICT(armory_id) DO UPDATE SET
           label = excluded.label, color = excluded.color, text = excluded.text,
           item_name = CASE WHEN excluded.item_name <> '' THEN excluded.item_name ELSE notes.item_name END,
           item_id = CASE WHEN excluded.item_id <> '' THEN excluded.item_id ELSE notes.item_id END,
           updated_at = excluded.updated_at, updated_by_id = excluded.updated_by_id,
           updated_by_name = excluded.updated_by_name, deleted = 0`,
    ).bind(id, n.label, n.color, n.text, n.itemName, n.itemId, now, user.pid, user.name);
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
    requireEditor(user, cfg);
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
    requireEditor(user, cfg);
    const id = armoryId(rawId);
    const now = Date.now();
    await cfg.db.batch([
        cfg.db.prepare(
            `UPDATE notes SET deleted = 1, label = '', text = '', updated_at = ?2, updated_by_id = ?3, updated_by_name = ?4
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
    requireEditor(user, cfg);
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
            if (path === '/notes' && request.method === 'GET') return await handleList(request, url, cfg);
            if (path === '/notes/import' && request.method === 'POST') return await handleImport(request, cfg);
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
};
