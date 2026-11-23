'use strict';
/* Keywords -> Keyword ideas. Loaded by main.js. Mangools keyword data in plain words:
   - Ideas for a keyword: related searches with monthly volume, a 12-month trend line, difficulty and ad value;
     filters for report-style searches, questions (good FAQ headings), rising interest and easy keywords.
   - What a page ranks for: the searches a competitor's page (or a domain) ranks for.
   - Who ranks on Google: the top 10, how strong those websites are, and where Kings Research ranks.
   Ticked keywords can be added to a keyword group waiting for analyst verification (optionally as must-use).
   Mangools calls are paced 11 s apart with the rest of the Keywords tab (KR.mgPaced in keywords.js). */
(function () {
  const KR = window.KR;
  const { $, esc, fmtNum } = KR;
  const X = { mode: 'ideas', rows: [], serp: null, info: '', target: '', filter: 'all', q: '', sort: 'sv', hideCountries: true, sel: new Set(), groups: [], groupsLoaded: false };

  const MODES = {
    ideas: {
      label: 'Ideas for a keyword', field: 'Keyword', ph: 'smart helmet market', run: 'Find keyword ideas',
      help: 'Searches people make around your keyword: how often, whether interest is rising, how hard it is to reach page 1 and what advertisers pay for it. Questions make good FAQ headings.'
    },
    page: {
      label: 'What a page ranks for', field: 'Page address or domain', ph: 'https://www.marketsandmarkets.com/Market-Reports/...', run: 'Show its keywords',
      help: 'Paste a competitor\'s report page (or a whole domain) to see the Google searches it ranks for. Good for finding secondary keywords we are missing.'
    },
    serp: {
      label: 'Who ranks on Google', field: 'Keyword', ph: 'smart helmet market', run: 'Show the top 10',
      help: 'The pages in Google\'s top 10 for a keyword, how strong their websites are, and where Kings Research ranks.'
    }
  };

  const FILTERS = [['all', 'All'], ['report', 'Report-style'], ['question', 'Questions (for FAQs)'], ['rising', 'Rising interest'], ['easy', 'Easy to rank']];

  function kdLabel(kd) { return KR.kdLabel ? KR.kdLabel(kd) : ''; }
  function isNum(v) { return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)); }
  function valueLabel(cpc) {
    if (!isNum(cpc)) return '';
    const n = Number(cpc);
    return n >= 3 ? 'High' : n >= 1 ? 'Medium' : 'Low';
  }

  // A small line of the last 12 months of searches.
  function spark(vals) {
    const v = (vals || []).map(Number).filter((n) => Number.isFinite(n));
    if (v.length < 3) return '';
    const max = Math.max.apply(null, v) || 1;
    const w = 64;
    const h = 18;
    const step = w / (v.length - 1);
    const pts = v.map((n, i) => (i * step).toFixed(1) + ',' + (h - 1 - (n / max) * (h - 2)).toFixed(1)).join(' ');
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="vertical-align:middle" aria-hidden="true"><polyline fill="none" stroke="#2B71E2" stroke-width="1.5" points="' + pts + '"/></svg>';
  }

  function trendHtml(k) {
    const s = spark(k.spark);
    if (!k.trend) return s || '–';
    const color = k.trend === 'rising' ? 'var(--green)' : k.trend === 'falling' ? 'var(--red)' : 'var(--slate)';
    const word = k.trend === 'rising' ? 'Rising' : k.trend === 'falling' ? 'Falling' : 'Stable';
    const ch = typeof k.change === 'number' ? ' ' + (k.change > 0 ? '+' : '') + k.change + '%' : '';
    return s + ' <span class="small" style="color:' + color + '">' + word + ch + '</span>';
  }

  function tags(k) {
    let t = '';
    if (k.question) t += ' <span class="tag kr">question</span>';
    if (k.country) t += ' <span class="tag">one country</span>';
    if (k.junk) t += ' <span class="tag bad">brand or off-topic</span>';
    return t;
  }

  // ---------- layout ----------
  function build() {
    const card = $('#kxCard');
    if (!card) return false;
    const loc = $('#opLocation');
    card.innerHTML = '<h2>Keyword ideas</h2>' +
      '<p class="lead">Mangools keyword data in plain words. Each search uses one Mangools lookup (the same search again within 24 hours is free).</p>' +
      '<div class="subtabs" id="kxModes">' + Object.keys(MODES).map((k) => '<button type="button" data-kxmode="' + k + '">' + esc(MODES[k].label) + '</button>').join('') + '</div>' +
      '<p class="hint" id="kxHelp"></p>' +
      '<div class="grid3">' +
      '<label><span id="kxFieldLabel">Keyword</span><input id="kxInput" type="text"></label>' +
      '<label>Location<select id="kxLoc">' + (loc ? loc.innerHTML : '<option value="0">Global</option>') + '</select></label>' +
      '<div class="row end"><button id="kxRun" class="btn primary" type="button">Find keyword ideas</button></div>' +
      '</div>' +
      '<div id="kxProgress" class="progress"></div><div id="kxResults"></div>';
    return true;
  }

  function setMode(mode) {
    X.mode = MODES[mode] ? mode : 'ideas';
    const m = MODES[X.mode];
    document.querySelectorAll('#kxModes [data-kxmode]').forEach((b) => b.classList.toggle('active', b.getAttribute('data-kxmode') === X.mode));
    $('#kxHelp').textContent = m.help;
    $('#kxFieldLabel').textContent = m.field;
    $('#kxInput').placeholder = m.ph;
    $('#kxRun').textContent = m.run;
    X.rows = [];
    X.serp = null;
    X.sel.clear();
    $('#kxResults').innerHTML = '';
    $('#kxProgress').innerHTML = '';
  }

  // ---------- keyword lists ----------
  function visible() {
    const q = X.q;
    const list = X.rows.filter((k) => {
      if (X.hideCountries && k.country) return false;
      if (X.filter === 'report' && !k.report) return false;
      if (X.filter === 'question' && !k.question) return false;
      if (X.filter === 'rising' && k.trend !== 'rising') return false;
      if (X.filter === 'easy' && !(isNum(k.kd) && Number(k.kd) < 30)) return false;
      if (q && k.kw.indexOf(q) < 0) return false;
      return true;
    });
    const n = (v) => (isNum(v) ? Number(v) : -1);
    if (X.sort === 'kd') list.sort((a, b) => (n(a.kd) < 0 ? 999 : n(a.kd)) - (n(b.kd) < 0 ? 999 : n(b.kd)));
    else if (X.sort === 'trend') list.sort((a, b) => (typeof b.change === 'number' ? b.change : -9999) - (typeof a.change === 'number' ? a.change : -9999));
    else if (X.sort === 'cpc') list.sort((a, b) => n(b.cpc) - n(a.cpc));
    else list.sort((a, b) => n(b.sv) - n(a.sv));
    return list;
  }

  function tableHtml(list) {
    const hasPos = list.some((k) => k.position);
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th><input type="checkbox" id="kxAll" title="Tick every keyword shown"></th><th>Keyword</th><th>Searches a month</th>' +
      '<th>Trend (12 months)</th><th>Difficulty</th><th>Ad value (CPC)</th>' + (hasPos ? '<th>Ranks</th>' : '') + '</tr></thead><tbody>' +
      list.map((k) => {
        const i = X.rows.indexOf(k);
        return '<tr><td><input type="checkbox" data-kxsel="' + i + '"' + (X.sel.has(i) ? ' checked' : '') + '></td>' +
          '<td><b>' + esc(k.kw) + '</b>' + tags(k) + (k.seo && !/^OK/.test(k.seo) ? '<div class="muted small">SEO: ' + esc(k.seo) + '</div>' : '') + '</td>' +
          '<td>' + fmtNum(k.sv) + '</td>' +
          '<td class="nowrap">' + trendHtml(k) + '</td>' +
          '<td>' + (KR.kdHtml ? KR.kdHtml(k.kd) : fmtNum(k.kd)) + '</td>' +
          '<td>' + (isNum(k.cpc) ? '$' + Number(k.cpc).toFixed(2) + '<div class="muted small">' + valueLabel(k.cpc) + '</div>' : '–') + '</td>' +
          (hasPos ? '<td>' + (k.position ? '#' + esc(k.position) : '–') + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function groupOptions() {
    return '<option value="">Choose a keyword group waiting for verification…</option>' +
      X.groups.map((g) => '<option value="' + esc(g.groupId) + '">' + esc(g.reportName) + ' · ' + g.rows.length + ' keywords</option>').join('');
  }

  function updateSel() {
    const el = $('#kxSelCount');
    if (el) el.textContent = X.sel.size ? X.sel.size + ' ticked' : '';
  }

  function renderTable() {
    const box = $('#kxTable');
    if (!box) return;
    const list = visible();
    const shown = list.slice(0, 200);
    box.innerHTML = (list.length > shown.length ? '<p class="hint">Showing 200 of ' + list.length + '. Use the filters to narrow down.</p>' : '') +
      (shown.length ? tableHtml(shown) : '<p class="hint">No keywords match these filters.</p>');
    updateSel();
  }

  function renderRows() {
    const box = $('#kxResults');
    if (!X.rows.length) { box.innerHTML = '<p class="hint">' + esc(X.info || 'No keywords found.') + '</p>'; return; }
    const count = {
      report: X.rows.filter((k) => k.report).length,
      question: X.rows.filter((k) => k.question).length,
      rising: X.rows.filter((k) => k.trend === 'rising').length,
      easy: X.rows.filter((k) => isNum(k.kd) && Number(k.kd) < 30).length
    };
    box.innerHTML = '<p class="small">' + esc(X.info) + '</p>' +
      '<div class="row">' + FILTERS.map((f) => '<button type="button" class="btn tiny' + (X.filter === f[0] ? ' primary' : ' ghost') + '" data-kxf="' + f[0] + '">' + esc(f[1]) + (f[0] !== 'all' ? ' (' + count[f[0]] + ')' : '') + '</button>').join('') + '</div>' +
      '<div class="row"><input id="kxFilter" type="text" class="grow" placeholder="Filter keywords" value="' + esc(X.q) + '">' +
      '<select id="kxSort" style="width:auto;margin:0"><option value="sv">Sort: most searched</option><option value="kd">Sort: easiest first</option><option value="trend">Sort: fastest rising</option><option value="cpc">Sort: highest ad value</option></select>' +
      '<label class="chk"><input type="checkbox" id="kxHideCountry"' + (X.hideCountries ? ' checked' : '') + '> Hide single-country searches</label></div>' +
      '<p class="hint">Difficulty is Mangools KD from 0 to 100: under 30 is easy to reach page 1, 50 and over is hard. Ad value is what advertisers pay per click: a high value means buyers search it.</p>' +
      '<div id="kxTable"></div>' +
      '<div class="group"><div class="row"><b>Use the ticked keywords</b><span class="hint" id="kxSelCount"></span></div>' +
      '<div class="row"><select id="kxGroup" class="grow" style="margin:0">' + groupOptions() + '</select>' +
      '<label class="chk"><input type="checkbox" id="kxMust"> Add as must-use</label>' +
      '<button id="kxAdd" class="btn primary" type="button">Add to the group</button><button id="kxCopy" class="btn ghost" type="button">Copy keywords</button></div>' +
      '<p class="hint">Added keywords go to analyst verification with their volume and difficulty, like every other secondary keyword.</p></div>';
    $('#kxSort').value = X.sort;
    renderTable();
  }

  // ---------- Google top 10 ----------
  function renderSerp() {
    const s = X.serp;
    const box = $('#kxResults');
    if (!s) { box.innerHTML = ''; return; }
    const organic = s.organic || [];
    const top = organic.slice(0, 10);
    const lines = [];
    lines.push(s.krPosition
      ? 'Kings Research ranks <b>#' + esc(s.krPosition) + '</b>' + (s.krUrl ? ' with <a href="' + esc(s.krUrl) + '" target="_blank" rel="noopener">this page</a>' : '') + '.'
      : 'Kings Research is <b>not in the top ' + organic.length + '</b> for this keyword.');
    lines.push(esc(s.competitorsInTop10) + ' of the top 10 are competitors we track.');
    if (isNum(s.kd)) lines.push('Ranking difficulty: <b>' + fmtNum(s.kd) + ' / 100' + (kdLabel(s.kd) ? ' (' + esc(kdLabel(s.kd)) + ')' : '') + '</b>.');
    if (isNum(s.avgDa)) lines.push('Average website strength of the top 10 (Moz Domain Authority): <b>' + esc(s.avgDa) + ' / 100</b>. Pages on websites close to our own strength can be beaten with a better page.');
    box.innerHTML = '<div class="note">' + lines.map((l) => '<div>' + l + '</div>').join('') + '</div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Page</th><th>Website strength (DA)</th><th>Page strength (PA)</th></tr></thead><tbody>' +
      top.map((x) => '<tr' + (x.kr ? ' class="kr-row"' : x.competitor ? ' class="comp-row"' : '') + '><td>' + esc(x.position) + '</td>' +
        '<td><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.title || x.url) + '</a><div class="muted small">' + esc(x.domain) + '</div>' +
        (x.kr ? '<span class="tag ok">Kings Research</span>' : '') + (x.competitor ? '<span class="tag comp">competitor</span>' : '') + '</td>' +
        '<td>' + fmtNum(x.da) + '</td><td>' + fmtNum(x.pa) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<p class="hint">Domain Authority and Page Authority are Moz scores from 0 to 100: higher means more links and trust.</p>';
  }

  // ---------- actions ----------
  async function loadGroups() {
    X.groupsLoaded = true;
    try {
      const r = await KR.api('keywords', 'list');
      X.groups = (r.groups || []).filter((g) => g.status === 'Pending Verification');
      const sel = $('#kxGroup');
      if (sel) sel.innerHTML = groupOptions();
    } catch (e) {
      X.groupsLoaded = false;
    }
  }

  async function run() {
    const btn = $('#kxRun');
    const val = $('#kxInput').value.trim();
    if (!val) { KR.toast(X.mode === 'page' ? 'Paste a page address or a domain first.' : 'Type a keyword first.', 'err'); return; }
    const loc = Number($('#kxLoc').value) || 0;
    const prog = KR.progress('#kxProgress');
    const paced = KR.mgPaced || ((ep, action, payload) => KR.api(ep, action, payload));
    KR.busy(btn, true, 'Looking up…');
    const st = prog.step(X.mode === 'serp' ? 'Mangools: Google top 10 for "' + val + '"…' : X.mode === 'page' ? 'Mangools: keywords this page ranks for…' : 'Mangools: keyword ideas for "' + val + '"…');
    try {
      if (X.mode === 'serp') {
        X.serp = await paced('explore', 'serp', { kw: val, location_id: loc }, prog);
        X.rows = [];
        st.done('Top ' + Math.min(10, (X.serp.organic || []).length) + ' read');
        renderSerp();
      } else {
        const r = X.mode === 'page'
          ? await paced('explore', 'pageKeywords', { url: val, location_id: loc }, prog)
          : await paced('explore', 'ideas', { seed: val, location_id: loc }, prog);
        X.rows = r.keywords || [];
        X.serp = null;
        X.sel.clear();
        X.filter = 'all';
        X.q = '';
        X.target = X.mode === 'page' ? val : '';
        X.info = (X.mode === 'page' ? fmtNum(r.total) + ' keywords this page ranks for' : fmtNum(r.total) + ' keyword ideas for "' + val + '"') +
          (r.total > X.rows.length ? ' (showing the ' + X.rows.length + ' most searched)' : '') + '.';
        st.done(X.info);
        renderRows();
        if (!X.groupsLoaded) loadGroups();
      }
    } catch (e) {
      st.fail(e.message);
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  function reasonOf(k) {
    const parts = [];
    if (isNum(k.sv)) parts.push(fmtNum(k.sv) + ' searches a month');
    if (k.trend) parts.push('interest ' + k.trend + (typeof k.change === 'number' ? ' (' + (k.change > 0 ? '+' : '') + k.change + '% on a year ago)' : ''));
    if (kdLabel(k.kd)) parts.push('difficulty ' + kdLabel(k.kd).toLowerCase());
    return parts.length ? parts.join('; ') + '.' : 'Found with Mangools keyword ideas.';
  }

  async function addToGroup(btn) {
    const gid = $('#kxGroup').value;
    const rows = Array.from(X.sel).map((i) => X.rows[i]).filter(Boolean);
    if (!rows.length) { KR.toast('Tick the keywords to add first.', 'err'); return; }
    if (!gid) { KR.toast('Choose the keyword group to add them to.', 'err'); return; }
    const must = $('#kxMust').checked;
    KR.busy(btn, true, 'Adding…');
    try {
      const r = await KR.api('keywords', 'addRows', {
        groupId: gid,
        rows: rows.slice(0, 30).map((k) => ({
          keyword: k.kw, sv: k.sv, kd: k.kd, cpc: k.cpc, why: reasonOf(k), sources: X.target,
          source: X.mode === 'page' ? 'Page keywords (Mangools)' : 'Keyword ideas (Mangools)', mustUse: must
        }))
      });
      KR.toast('Added ' + r.added + ' keyword(s) to the group' + (rows.length > 30 ? ' (30 at a time)' : '') + '.', 'ok');
      X.sel.clear();
      renderTable();
    } catch (e) {
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  function copySel(btn) {
    const list = Array.from(X.sel).map((i) => X.rows[i]).filter(Boolean).map((k) => k.kw);
    if (!list.length) { KR.toast('Tick the keywords to copy first.', 'err'); return; }
    KR.copy(list.join('\n'), btn);
  }

  KR.initExplorer = () => {
    if (!build()) return;
    setMode('ideas');
    const card = $('#kxCard');
    card.addEventListener('click', (e) => {
      const m = e.target.closest('[data-kxmode]');
      if (m) { setMode(m.getAttribute('data-kxmode')); return; }
      const f = e.target.closest('[data-kxf]');
      if (f) { X.filter = f.getAttribute('data-kxf'); renderRows(); return; }
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'kxRun') run();
      else if (b.id === 'kxAdd') addToGroup(b);
      else if (b.id === 'kxCopy') copySel(b);
    });
    card.addEventListener('input', (e) => {
      if (e.target.id === 'kxFilter') { X.q = e.target.value.trim().toLowerCase(); renderTable(); }
    });
    card.addEventListener('change', (e) => {
      const t = e.target;
      if (t.id === 'kxSort') { X.sort = t.value; renderTable(); }
      else if (t.id === 'kxHideCountry') { X.hideCountries = t.checked; renderTable(); }
      else if (t.id === 'kxAll') {
        visible().slice(0, 200).forEach((k) => {
          const i = X.rows.indexOf(k);
          if (t.checked) X.sel.add(i); else X.sel.delete(i);
        });
        renderTable();
      } else if (t.dataset && t.dataset.kxsel !== undefined) {
        const i = Number(t.dataset.kxsel);
        if (t.checked) X.sel.add(i); else X.sel.delete(i);
        updateSel();
      }
    });
    card.addEventListener('keydown', (e) => {
      if (e.target.id === 'kxInput' && e.key === 'Enter') { e.preventDefault(); run(); }
    });
    KR.hooks.sub['kw-ideas'] = () => { if (!X.groupsLoaded) loadGroups(); };
  };
})();
