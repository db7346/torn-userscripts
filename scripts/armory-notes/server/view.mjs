/**
 * Read-only "Faction Armory" view page served by the Worker at /view?key=….
 *
 * Security:
 *  - The data is embedded as JSON inside <script type="application/json">,
 *    with "<" escaped, and rendered with textContent only (no innerHTML), so
 *    note text can never run as code.
 *  - The page loads nothing from other sites. A strict Content-Security-Policy
 *    (set by the Worker) allows only this page's own nonce-tagged script/style.
 *  - Referrer-Policy: no-referrer keeps the key out of other sites' logs.
 *
 * Editor names (last edited by, previous edit by, trade logged by) are not in
 * the table; they appear only when a row is clicked. They are still part of the
 * page data, so this hides them from casual view, not from a determined viewer.
 */

/**
 * Escape text for an HTML text/attribute context.
 * @param {string} s - Text.
 * @returns {string} Escaped text.
 */
function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * JSON that is safe inside a <script> element.
 * @param {unknown} value - Data.
 * @returns {string} JSON text.
 */
function safeJson(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Build the view page.
 * @param {Object[]} rows - Rows from sheetRows().
 * @param {string} nonce - CSP nonce for the inline script and style.
 * @param {number} generatedAt - Epoch ms.
 * @param {{configured: boolean, lastOk: (number|null), lastError: string}} [sync] - Armory sync state.
 * @returns {string} HTML document.
 */
export function viewHtml(rows, nonce, generatedAt, sync = { configured: false, lastOk: null, lastError: '' }) {
    const n = esc(nonce);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Faction Armory</title>
<style nonce="${n}">
:root{--bg:#0d1117;--panel:#161b22;--row1:#1b1f24;--row2:#22272e;--line:#30363d;--text:#c9d1d9;--dim:#8b949e;
  --green:#3fb950;--green2:#7ee787;--red:#ff7b72;--blue:#79c0ff;--purple:#d2a8ff;--gold:#e3b341;--orange:#ffa566;--amber:#f0a35e}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font:14px/1.4 Arial,Helvetica,sans-serif}
header{padding:16px;border-bottom:2px solid var(--green);background:var(--panel)}
h1{margin:0 0 4px;font-size:20px;color:#fff}
.sub{color:var(--dim);font-size:12px}
.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 16px;background:var(--panel);border-bottom:1px solid var(--line);
  position:sticky;top:0;z-index:3}
.controls input[type=search],.controls select{background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:6px;
  padding:7px 9px;font:inherit;min-width:0}
.controls input[type=search]{flex:1 1 220px}
.controls label{display:flex;align-items:center;gap:6px;color:var(--dim);font-size:13px;white-space:nowrap}
.count{margin-left:auto;color:var(--dim);font-size:12px}
.wrap{overflow-x:auto;padding:0 0 24px}
table{border-collapse:collapse;width:100%;min-width:980px}
thead th{position:sticky;top:0;background:var(--bg);color:var(--green);font-size:12px;text-align:left;padding:10px 10px;
  border-bottom:2px solid var(--green);cursor:pointer;user-select:none;white-space:nowrap}
thead th[aria-sort=ascending]::after{content:" \\25B2";font-size:9px}
thead th[aria-sort=descending]::after{content:" \\25BC";font-size:9px}
thead th.num,td.num{text-align:right}
thead th[draggable=true]{cursor:grab}
thead th.dragging{opacity:.4}
thead th.drop-l{box-shadow:inset 3px 0 0 var(--gold)}
thead th.drop-r{box-shadow:inset -3px 0 0 var(--gold)}
.btn{background:var(--bg);color:var(--dim);border:1px solid var(--line);border-radius:6px;padding:6px 10px;font:inherit;font-size:13px;cursor:pointer}
.btn:hover:not(:disabled){color:var(--text);border-color:var(--dim)}
.btn:disabled{opacity:.45;cursor:default}
tbody tr.main{cursor:pointer}
tbody tr.main.a{background:var(--row1)}
tbody tr.main.b{background:var(--row2)}
tbody tr.main:hover{background:#2d333b}
td{padding:7px 10px;border-bottom:1px solid #21262d;vertical-align:top}
td.item{color:#fff;font-weight:700;white-space:nowrap}
td.item::before{content:"\\25B8";display:inline-block;width:14px;color:var(--dim);transition:transform .15s}
tr.open td.item::before{transform:rotate(90deg)}
.chip{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:9px;font-size:11px;font-weight:700;vertical-align:1px}
.chip i{font-style:normal;font-weight:400;opacity:.75;margin-right:3px}
.chip-dmg{background:#3d1a1a;color:var(--red)}.chip-acc{background:#16263d;color:var(--blue)}.chip-def{background:#2a1d40;color:var(--purple)}
td.note{max-width:320px;white-space:pre-wrap;word-break:break-word}
.cat-Primary{color:var(--orange)}.cat-Secondary{color:var(--blue)}.cat-Melee{color:var(--green2)}.cat-Armor{color:var(--purple);font-weight:700}
.src-armory{color:var(--green2)}.src-out{color:var(--amber);font-style:italic}
.dmg{color:var(--red);font-weight:700}.acc{color:var(--blue);font-weight:700}.def{color:var(--purple);font-weight:700}
.bon{color:var(--gold);font-weight:700}
.lbl{display:inline-block;padding:1px 8px;border-radius:9px;font-weight:700;font-size:12px;white-space:nowrap}
.c-red{background:#d9534f;color:#fff}.c-orange{background:#f0883e;color:#1a1a1a}.c-yellow{background:#e3b341;color:#1a1a1a}
.c-green{background:#3fb950;color:#0d1117}.c-teal{background:#2aa198;color:#fff}.c-blue{background:#4493f8;color:#fff}
.c-purple{background:#a371f7;color:#fff}.c-gray{background:#8b949e;color:#0d1117}
.trade{color:var(--green2);font-weight:700;white-space:nowrap}
.tabs{display:flex;gap:4px;padding:0 16px;background:var(--panel)}
.tab{appearance:none;border:1px solid var(--line);border-bottom:none;background:var(--bg);color:var(--dim);font:bold 14px Arial,Helvetica,sans-serif;
  padding:9px 18px;border-radius:8px 8px 0 0;cursor:pointer}
.tab[aria-selected=true]{background:var(--green);color:#0d1117;border-color:var(--green)}
.tab .n{font-weight:400;font-size:12px;opacity:.8;margin-left:4px}
.st{display:inline-block;padding:1px 8px;border-radius:9px;font-size:12px;font-weight:700;white-space:nowrap}
.st-in{background:#123321;color:var(--green2)}.st-traded{background:#1b2f4a;color:var(--blue)}
.st-missing{background:#4a1515;color:#ff9b94}.st-returned{background:#3a3212;color:#e3b341}.st-out{background:#3d2912;color:var(--amber);font-style:italic}
.loan{color:var(--dim);white-space:nowrap}
.warn{color:#ff9b94}
.when{display:block;color:var(--dim);font-size:11px;font-weight:400}
tr.detail td{background:#0f141a;border-bottom:1px solid var(--line);padding:10px 16px 12px 34px}
.dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;font-size:13px}
.dl dt{color:var(--dim)}.dl dd{margin:0;color:var(--text)}
.empty{padding:24px 16px;color:var(--dim)}
@media (max-width:640px){header,.controls{padding-left:16px;padding-right:16px}.count{width:100%;margin-left:0}}
</style>
</head>
<body>
<header>
  <h1>Faction Armory</h1>
  <div class="sub">Weapons and armor with bonuses. Click a row for details. Page built <span id="gen"></span> TCT · <span id="sync"></span></div>
</header>
<div class="tabs" role="tablist">
  <button class="tab" role="tab" id="tab-weapons" data-type="weapons" aria-selected="true">Weapons<span class="n" id="n-weapons"></span></button>
  <button class="tab" role="tab" id="tab-armor" data-type="armor" aria-selected="false">Armor<span class="n" id="n-armor"></span></button>
</div>
<div class="controls">
  <input id="q" type="search" placeholder="Search item, label, note, bonus…" aria-label="Search">
  <select id="sort" aria-label="Sort by stat"></select>
  <select id="cat" aria-label="Category"><option value="">All categories</option><option>Primary</option><option>Secondary</option><option>Melee</option></select>
  <select id="src" aria-label="Status"><option value="">Any status</option><option value="in">In armory</option><option value="loaned">Loaned out</option><option value="traded">Traded</option><option value="returned">Returned, not deposited</option><option value="missing">Missing</option><option value="out">Not in armory</option></select>
  <label><input id="lab" type="checkbox"> Labeled only</label>
  <label><input id="trd" type="checkbox"> Traded only</label>
  <button type="button" class="btn" id="reset-cols" title="Put the columns back in their default order">Reset columns</button>
  <span class="count" id="count"></span>
</div>
<div class="wrap">
  <table>
    <thead><tr id="head"></tr></thead>
    <tbody id="body"></tbody>
  </table>
  <div class="empty" id="empty" hidden>No items match.</div>
</div>
<script type="application/json" id="data">${safeJson({ generatedAt, rows, sync })}</script>
<script nonce="${n}">
(function () {
  'use strict';
  var DATA = JSON.parse(document.getElementById('data').textContent);
  var COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'gray'];
  var state = { k: '', dir: 1, open: {}, type: 'weapons' };
  var $ = function (id) { return document.getElementById(id); };
  function tct(ms) { return ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : ''; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== '') e.textContent = text; return e; }
  function num(v) { return typeof v === 'number' ? v.toFixed(2) : ''; }
  $('gen').textContent = tct(DATA.generatedAt);
  var sy = DATA.sync || {};
  if (!sy.configured) $('sync').textContent = 'armory sync not set up (status based on editors’ armory views)';
  else if (sy.lastOk) { $('sync').textContent = 'armory synced ' + tct(sy.lastOk) + ' TCT'; }
  else $('sync').textContent = 'armory sync has not run yet';
  if (sy.configured && sy.lastError) { var w = el('span', 'warn', ' · last sync failed: ' + sy.lastError); $('sync').appendChild(w); }

  // Default column order per tab. 'item' is always first and can't be moved.
  var DEFAULT_COLS = {
    weapons: ['item', 'category', 'status', 'loanedTo', 'label', 'note', 'bonuses', 'tradeAt'],
    armor: ['item', 'status', 'loanedTo', 'label', 'note', 'bonuses', 'tradeAt']
  };
  // Stats are shown as chips beside the item name and sorted from the "Sort by" menu.
  var STATS = {
    weapons: [['damage', 'DMG', 'chip-dmg', 'Damage'], ['accuracy', 'ACC', 'chip-acc', 'Accuracy']],
    armor: [['defence', 'DEF', 'chip-def', 'Defence']]
  };
  // Each viewer's own column order, saved in their browser (may be unavailable).
  var ORDER_KEY = 'tms-an-view-cols-';
  function loadOrder(type) {
    var def = DEFAULT_COLS[type], saved = [];
    try { saved = JSON.parse(localStorage.getItem(ORDER_KEY + type) || '[]'); } catch (e) { saved = []; }
    if (!Array.isArray(saved)) saved = [];
    // Keep known, movable columns in the saved order; columns added later go at the end.
    var out = saved.filter(function (k, i) { return k !== 'item' && def.indexOf(k) !== -1 && saved.indexOf(k) === i; });
    def.forEach(function (k) { if (k !== 'item' && out.indexOf(k) === -1) out.push(k); });
    return ['item'].concat(out);
  }
  function saveOrder(type) {
    try {
      if (isDefaultOrder(type)) localStorage.removeItem(ORDER_KEY + type);
      else localStorage.setItem(ORDER_KEY + type, JSON.stringify(COLS[type].slice(1)));
    } catch (e) { /* storage blocked: the order still applies until the page is closed */ }
  }
  function isDefaultOrder(type) { return COLS[type].join() === DEFAULT_COLS[type].join(); }
  var COLS = { weapons: loadOrder('weapons'), armor: loadOrder('armor') };
  // Move column k to just before (or after) column target on the current tab.
  function moveCol(k, target, after) {
    var cols = COLS[state.type];
    if (k === target || k === 'item' || cols.indexOf(k) === -1 || cols.indexOf(target) === -1) return;
    cols.splice(cols.indexOf(k), 1);
    var at = cols.indexOf(target) + (after ? 1 : 0);
    cols.splice(Math.max(1, at), 0, k);
    saveOrder(state.type); renderHead(); render();
  }
  var TITLES = { item: 'Item', category: 'Category', status: 'Status', loanedTo: 'Loaned to', label: 'Label', note: 'Note',
    damage: 'Damage', accuracy: 'Accuracy', defence: 'Defence', bonuses: 'Bonuses', tradeAt: 'Last trade' };
  var NUM = { damage: 'dmg', accuracy: 'acc', defence: 'def' };
  function cell(k, r) {
    var td;
    if (k === 'item') {
      td = el('td', 'item', r.item);
      (STATS[r.type] || []).forEach(function (s) {
        if (typeof r[s[0]] !== 'number') return;
        var c = el('span', 'chip ' + s[2]); c.title = s[3];
        c.appendChild(el('i', '', s[1])); c.appendChild(document.createTextNode(num(r[s[0]])));
        td.appendChild(c);
      });
      return td;
    }
    if (k === 'category') return el('td', 'cat-' + r.category, r.category);
    if (k === 'status') { td = el('td'); td.appendChild(el('span', 'st st-' + r.statusKind, r.status)); return td; }
    if (k === 'loanedTo') return el('td', 'loan', r.loanedTo);
    if (k === 'label') { td = el('td'); if (r.label) td.appendChild(el('span', 'lbl ' + (COLORS.indexOf(r.color) >= 0 ? 'c-' + r.color : 'c-blue'), r.label)); return td; }
    if (k === 'note') return el('td', 'note', r.note);
    if (NUM[k]) return el('td', 'num ' + NUM[k], num(r[k]));
    if (k === 'bonuses') return el('td', 'bon', r.bonuses);
    if (k === 'tradeAt') { td = el('td'); if (r.tradedTo) { var s = el('span', 'trade', 'Traded to ' + r.tradedTo); s.appendChild(el('span', 'when', tct(r.tradeAt))); td.appendChild(s); } return td; }
    return el('td');
  }
  // Bonus text is "60% Assassinate, 20% Execute": pull out names and percentages.
  function bonusParts(text) {
    var out = [];
    String(text || '').split(',').forEach(function (part) {
      var m = /^\\s*(\\d+(?:\\.\\d+)?)%\\s*(.+?)\\s*$/.exec(part);
      if (m) out.push({ pct: Number(m[1]), name: m[2].toLowerCase() });
    });
    return out;
  }
  function sortVal(k, r) {
    if (k === 'status') return r.statusKind + r.status;
    if (k === 'bonuses') {
      // A-Z by the first bonus name, then highest % first within the same bonus.
      var b = bonusParts(r.bonuses)[0];
      return b ? b.name + '|' + String(100000 - Math.round(b.pct * 100)).padStart(6, '0') : '';
    }
    if (k === 'bonusPct') {
      var ps = bonusParts(r.bonuses).map(function (x) { return x.pct; });
      return ps.length ? Math.max.apply(null, ps) : '';
    }
    return r[k];
  }
  function inTab(r) { return r.type === state.type; }
  function matches(r) {
    if (!inTab(r)) return false;
    var q = $('q').value.trim().toLowerCase(), st = $('src').value;
    if (state.type === 'weapons' && $('cat').value && r.category !== $('cat').value) return false;
    if (st === 'loaned' ? !r.loanedTo : st && r.statusKind !== st) return false;
    if ($('lab').checked && !r.label) return false;
    if ($('trd').checked && !r.tradedTo) return false;
    if (!q) return true;
    return [r.item, r.category, r.status, r.loanedTo, r.label, r.note, r.bonuses, r.tradedTo].join(' ').toLowerCase().indexOf(q) !== -1;
  }
  function cmp(a, b) {
    var k = state.k; if (!k) return 0;
    var x = sortVal(k, a), y = sortVal(k, b);
    var ex = x === '' || x === null || x === undefined, ey = y === '' || y === null || y === undefined;
    if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1; // blanks last
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * state.dir;
  }
  function detailRow(r, span) {
    var tr = el('tr', 'detail'); var td = el('td'); td.colSpan = span;
    var dl = el('dl', 'dl');
    function add(k, v) { dl.appendChild(el('dt', '', k)); dl.appendChild(el('dd', '', v || '—')); }
    add('Armory ID', r.armoryId);
    add('Status', r.status);
    add('Last edited', r.lastEditedBy ? r.lastEditedBy + ', ' + tct(r.lastEdited) : '');
    add('Previous edit', r.prevBy ? r.prevBy + ', ' + tct(r.prevAt) : '');
    add('Last trade', r.tradedTo ? (r.tradedFrom ? r.tradedFrom + ' → ' : '') + r.tradedTo + ', ' + tct(r.tradeAt) : '');
    add('Trade logged by', r.tradeLoggedBy);
    td.appendChild(dl); tr.appendChild(td); return tr;
  }
  /** Fill the "Sort by" menu for the current tab; it reflects a stat sort in progress. */
  function renderSortMenu() {
    var sel = $('sort'); sel.textContent = '';
    var none = el('option', '', 'Sort by stat…'); none.value = ''; sel.appendChild(none);
    STATS[state.type].concat([['bonusPct', '', '', 'Bonus %']]).forEach(function (s) {
      var hi = el('option', '', s[3] + ' (high → low)'); hi.value = s[0] + ':-1'; sel.appendChild(hi);
      var lo = el('option', '', s[3] + ' (low → high)'); lo.value = s[0] + ':1'; sel.appendChild(lo);
    });
    var cur = state.k + ':' + state.dir;
    sel.value = Array.prototype.some.call(sel.options, function (o) { return o.value === cur; }) ? cur : '';
  }
  $('sort').addEventListener('change', function () {
    var v = $('sort').value;
    if (!v) { state.k = ''; state.dir = 1; } else { state.k = v.split(':')[0]; state.dir = Number(v.split(':')[1]); }
    renderHead(); render();
  });
  var dragKey = '';
  function clearDropMarks() {
    Array.prototype.forEach.call($('head').children, function (h) { h.classList.remove('drop-l', 'drop-r'); });
  }
  /** True when the pointer is over the right half of a header (drop after it). */
  function isAfter(th, e) { var b = th.getBoundingClientRect(); return e.clientX > b.left + b.width / 2; }
  function renderHead() {
    var head = $('head'); head.textContent = '';
    COLS[state.type].forEach(function (k) {
      var th = el('th', NUM[k] ? 'num' : '', TITLES[k]); th.setAttribute('data-k', k);
      if (state.k === k) th.setAttribute('aria-sort', state.dir === 1 ? 'ascending' : 'descending');
      th.addEventListener('click', function () { state.dir = state.k === k ? -state.dir : 1; state.k = k; renderHead(); render(); });
      if (k !== 'item') {
        th.draggable = true;
        th.title = 'Click to sort · drag to move';
        th.addEventListener('dragstart', function (e) {
          dragKey = k; th.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', k); } catch (err) { /* some browsers restrict types */ }
        });
        th.addEventListener('dragend', function () { dragKey = ''; th.classList.remove('dragging'); clearDropMarks(); });
      } else {
        th.title = 'Click to sort';
      }
      th.addEventListener('dragover', function (e) {
        if (!dragKey || dragKey === k) return;
        var after = isAfter(th, e);
        if (k === 'item' && !after) return; // nothing goes before Item
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        clearDropMarks(); th.classList.add(after ? 'drop-r' : 'drop-l');
      });
      th.addEventListener('dragleave', function () { th.classList.remove('drop-l', 'drop-r'); });
      th.addEventListener('drop', function (e) {
        if (!dragKey) return;
        e.preventDefault();
        var from = dragKey; dragKey = ''; clearDropMarks();
        moveCol(from, k, isAfter(th, e) || k === 'item');
      });
      head.appendChild(th);
    });
    $('cat').hidden = state.type !== 'weapons';
    renderSortMenu();
    $('reset-cols').disabled = isDefaultOrder(state.type);
  }
  function render() {
    var cols = COLS[state.type];
    var rows = DATA.rows.filter(matches).slice();
    if (state.k) rows.sort(cmp);
    var body = $('body'); body.textContent = '';
    rows.forEach(function (r, i) {
      var tr = el('tr', 'main ' + (i % 2 ? 'b' : 'a') + (state.open[r.armoryId] ? ' open' : ''));
      tr.tabIndex = 0; tr.setAttribute('aria-expanded', state.open[r.armoryId] ? 'true' : 'false');
      cols.forEach(function (k) { tr.appendChild(cell(k, r)); });
      function toggle() { state.open[r.armoryId] = !state.open[r.armoryId]; render(); }
      tr.addEventListener('click', toggle);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      body.appendChild(tr);
      if (state.open[r.armoryId]) body.appendChild(detailRow(r, cols.length));
    });
    var total = DATA.rows.filter(inTab).length;
    $('empty').hidden = rows.length > 0;
    $('count').textContent = rows.length + ' of ' + total + ' items';
  }
  ['weapons', 'armor'].forEach(function (t) {
    $('n-' + t).textContent = '(' + DATA.rows.filter(function (r) { return r.type === t; }).length + ')';
    $('tab-' + t).addEventListener('click', function () {
      state.type = t; state.k = ''; state.dir = 1;
      ['weapons', 'armor'].forEach(function (x) { $('tab-' + x).setAttribute('aria-selected', String(x === t)); });
      renderHead(); render();
    });
  });
  ['q', 'cat', 'src', 'lab', 'trd'].forEach(function (id) { $(id).addEventListener('input', render); $(id).addEventListener('change', render); });
  $('reset-cols').addEventListener('click', function () {
    COLS[state.type] = DEFAULT_COLS[state.type].slice();
    saveOrder(state.type); renderHead(); render();
  });
  renderHead();
  render();
})();
</script>
</body>
</html>`;
}
