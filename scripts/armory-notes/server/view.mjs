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
 * @returns {string} HTML document.
 */
export function viewHtml(rows, nonce, generatedAt) {
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
tbody tr.main{cursor:pointer}
tbody tr.main.a{background:var(--row1)}
tbody tr.main.b{background:var(--row2)}
tbody tr.main:hover{background:#2d333b}
td{padding:7px 10px;border-bottom:1px solid #21262d;vertical-align:top}
td.item{color:#fff;font-weight:700;white-space:nowrap}
td.item::before{content:"\\25B8";display:inline-block;width:14px;color:var(--dim);transition:transform .15s}
tr.open td.item::before{transform:rotate(90deg)}
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
  <div class="sub">Weapons and armor with bonuses. Click a row for details. Updated <span id="gen"></span> (TCT).</div>
</header>
<div class="controls">
  <input id="q" type="search" placeholder="Search item, label, note, bonus…" aria-label="Search">
  <select id="cat" aria-label="Category"><option value="">All categories</option><option>Primary</option><option>Secondary</option><option>Melee</option><option>Armor</option></select>
  <select id="src" aria-label="Source"><option value="">Armory + not in armory</option><option>Armory</option><option>Not in armory</option></select>
  <label><input id="lab" type="checkbox"> Labeled only</label>
  <label><input id="trd" type="checkbox"> Traded only</label>
  <span class="count" id="count"></span>
</div>
<div class="wrap">
  <table>
    <thead><tr>
      <th data-k="item">Item</th><th data-k="category">Category</th><th data-k="source">Source</th><th data-k="label">Label</th>
      <th data-k="note">Note</th><th data-k="damage" class="num">Damage</th><th data-k="accuracy" class="num">Accuracy</th>
      <th data-k="defence" class="num">Defence</th><th data-k="bonuses">Bonuses</th><th data-k="tradeAt">Last trade</th>
    </tr></thead>
    <tbody id="body"></tbody>
  </table>
  <div class="empty" id="empty" hidden>No items match.</div>
</div>
<script type="application/json" id="data">${safeJson({ generatedAt, rows })}</script>
<script nonce="${n}">
(function () {
  'use strict';
  var DATA = JSON.parse(document.getElementById('data').textContent);
  var COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'gray'];
  var state = { k: '', dir: 1, open: {} };
  var $ = function (id) { return document.getElementById(id); };
  function tct(ms) { return ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : ''; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== '') e.textContent = text; return e; }
  function num(v) { return typeof v === 'number' ? v.toFixed(2) : ''; }
  $('gen').textContent = tct(DATA.generatedAt);

  function matches(r) {
    var q = $('q').value.trim().toLowerCase();
    if ($('cat').value && r.category !== $('cat').value) return false;
    if ($('src').value && r.source !== $('src').value) return false;
    if ($('lab').checked && !r.label) return false;
    if ($('trd').checked && !r.tradedTo) return false;
    if (!q) return true;
    return [r.item, r.category, r.source, r.label, r.note, r.bonuses, r.tradedTo].join(' ').toLowerCase().indexOf(q) !== -1;
  }
  function cmp(a, b) {
    var k = state.k; if (!k) return 0;
    var x = a[k], y = b[k];
    var ex = x === '' || x === null, ey = y === '' || y === null;
    if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1; // blanks last
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * state.dir;
  }
  function detailRow(r) {
    var tr = el('tr', 'detail'); var td = el('td'); td.colSpan = 10;
    var dl = el('dl', 'dl');
    function add(k, v) { dl.appendChild(el('dt', '', k)); dl.appendChild(el('dd', '', v || '—')); }
    add('Armory ID', r.armoryId);
    add('Last edited', r.lastEditedBy ? r.lastEditedBy + ', ' + tct(r.lastEdited) : '');
    add('Previous edit', r.prevBy ? r.prevBy + ', ' + tct(r.prevAt) : '');
    add('Last trade', r.tradedTo ? (r.tradedFrom ? r.tradedFrom + ' \\u2192 ' : '') + r.tradedTo + ', ' + tct(r.tradeAt) : '');
    add('Trade logged by', r.tradeLoggedBy);
    td.appendChild(dl); tr.appendChild(td); return tr;
  }
  function render() {
    var rows = DATA.rows.filter(matches).slice();
    if (state.k) rows.sort(cmp);
    var body = $('body'); body.textContent = '';
    rows.forEach(function (r, i) {
      var tr = el('tr', 'main ' + (i % 2 ? 'b' : 'a') + (state.open[r.armoryId] ? ' open' : ''));
      tr.tabIndex = 0; tr.setAttribute('aria-expanded', state.open[r.armoryId] ? 'true' : 'false');
      tr.appendChild(el('td', 'item', r.item));
      tr.appendChild(el('td', 'cat-' + r.category, r.category));
      tr.appendChild(el('td', r.source === 'Armory' ? 'src-armory' : 'src-out', r.source));
      var lt = el('td'); if (r.label) lt.appendChild(el('span', 'lbl ' + (COLORS.indexOf(r.color) >= 0 ? 'c-' + r.color : 'c-blue'), r.label)); tr.appendChild(lt);
      tr.appendChild(el('td', 'note', r.note));
      tr.appendChild(el('td', 'num dmg', num(r.damage)));
      tr.appendChild(el('td', 'num acc', num(r.accuracy)));
      tr.appendChild(el('td', 'num def', num(r.defence)));
      tr.appendChild(el('td', 'bon', r.bonuses));
      var tt = el('td'); if (r.tradedTo) { var s = el('span', 'trade', 'Traded to ' + r.tradedTo); s.appendChild(el('span', 'when', tct(r.tradeAt))); tt.appendChild(s); } tr.appendChild(tt);
      function toggle() { state.open[r.armoryId] = !state.open[r.armoryId]; render(); }
      tr.addEventListener('click', toggle);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      body.appendChild(tr);
      if (state.open[r.armoryId]) body.appendChild(detailRow(r));
    });
    $('empty').hidden = rows.length > 0;
    $('count').textContent = rows.length + ' of ' + DATA.rows.length + ' items';
  }
  document.querySelectorAll('thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      state.dir = state.k === k ? -state.dir : 1; state.k = k;
      document.querySelectorAll('thead th').forEach(function (h) { h.removeAttribute('aria-sort'); });
      th.setAttribute('aria-sort', state.dir === 1 ? 'ascending' : 'descending');
      render();
    });
  });
  ['q', 'cat', 'src', 'lab', 'trd'].forEach(function (id) { $(id).addEventListener('input', render); $(id).addEventListener('change', render); });
  render();
})();
</script>
</body>
</html>`;
}
