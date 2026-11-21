'use strict';
/* In-house keywords. Loaded by main.js. Shown only to the people allowed to add them (the server decides).
   They paste report keywords, click "Check keywords" and see, for each one, the search volume, the scope
   (new report, revamp, or a similar report exists; already in the pipeline or not) and one line on why to take
   it up. Nothing is saved until they click "Add selected to the pipeline". */
(function () {
  const KR = window.KR;
  const { $, $$, esc, fmtNum } = KR;
  const H = { rows: [], locLabel: 'Global' };

  function shortUrl(u) { return String(u || '').replace(/^https?:\/\/(www\.)?/, ''); }
  function link(u, label) { return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(label || shortUrl(u)) + '</a>' : ''; }

  function scopeHtml(r, i) {
    let h;
    if (r.status === 'Revamp') {
      h = '<span class="tag comp">Revamp</span><div class="small">We already publish this report: ' + link(r.url, r.name) + '</div>';
    } else if (r.status === 'Similar report exists') {
      h = '<select data-ihact="' + i + '" style="width:auto;margin:0"><option>New report</option><option>Revamp</option></select>' +
        '<div class="small">A similar report exists: ' + link(r.url, r.name) + '</div>';
    } else {
      h = '<span class="tag kr">New report</span><div class="muted small">not on our site</div>';
    }
    if (r.inPipeline) h += '<div><span class="tag">' + esc(r.inPipeline) + '</span></div>';
    return h;
  }

  function render(notes) {
    const box = $('#ihTable');
    if (!H.rows.length) { box.innerHTML = notes || ''; return; }
    box.innerHTML = (notes || '') +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Add</th><th>Report</th><th>Volume</th><th>KD</th><th>Scope</th><th>Why take it up (you can edit this)</th></tr></thead><tbody>' +
      H.rows.map((r, i) => '<tr>' +
        '<td><input type="checkbox" data-ihsel="' + i + '"' + (r.inPipeline ? ' disabled title="Already in the pipeline"' : ' checked') + '></td>' +
        '<td><b>' + esc(r.title) + '</b><div class="muted small">' + esc(r.keyword) + '</div></td>' +
        '<td>' + fmtNum(r.sv) + '</td><td>' + fmtNum(r.kd) + '</td>' +
        '<td>' + scopeHtml(r, i) + '</td>' +
        '<td><textarea rows="2" data-ihwhy="' + i + '">' + esc(r.why) + '</textarea></td></tr>').join('') +
      '</tbody></table></div>' +
      '<div class="row"><span class="hint">Volumes are for ' + esc(H.locLabel) + '. Each keyword becomes one report topic and goes to analyst verification, where secondary keywords can be added.</span><span class="grow"></span>' +
      '<button id="ihAdd" class="btn primary" type="button">Add selected to the pipeline</button></div>';
  }

  async function check(btn) {
    const keywords = $('#ihInput').value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (!keywords.length) { KR.toast('Paste at least one keyword.', 'err'); return; }
    const locSel = $('#opLocation');
    const loc = locSel ? Number(locSel.value) || 0 : 0;
    H.locLabel = locSel && locSel.selectedOptions[0] ? locSel.selectedOptions[0].textContent : 'Global';
    const prog = KR.progress('#ihProgress');
    const s = prog.step('Getting search volumes, checking our published reports and the pipeline…');
    KR.busy(btn, true, 'Checking…');
    try {
      const r = await KR.api('keywords', 'inhouse', { keywords, location_id: loc });
      H.rows = r.rows || [];
      s.done('Checked ' + H.rows.length + ' keyword' + (H.rows.length === 1 ? '' : 's') + '. Nothing has been added yet.');
      let notes = '';
      if (r.volumeNote) notes += '<p class="note">Search volumes could not be loaded (' + esc(r.volumeNote) + '). You can still add the keywords.</p>';
      if (r.whyNote) notes += '<p class="note">The reasons could not be written (' + esc(r.whyNote) + '). Type them in the last column.</p>';
      if (r.skipped) notes += '<p class="note">Only the first 25 keywords were checked. Add the other ' + r.skipped + ' in a second batch.</p>';
      render(notes);
    } catch (e) {
      s.fail(e.message);
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  async function add(btn) {
    const items = [];
    $$('#ihTable input[data-ihsel]').forEach((c) => {
      if (!c.checked || c.disabled) return;
      const i = Number(c.getAttribute('data-ihsel'));
      const r = H.rows[i];
      if (!r) return;
      const sel = $('#ihTable select[data-ihact="' + i + '"]');
      const why = $('#ihTable textarea[data-ihwhy="' + i + '"]');
      const action = sel ? sel.value : r.action;
      items.push({ keyword: r.keyword, title: r.title, sv: r.sv, kd: r.kd, cpc: r.cpc, action, existingUrl: action === 'Revamp' ? r.url : '', why: why ? why.value.trim() : r.why });
    });
    if (!items.length) { KR.toast('Tick at least one keyword to add.', 'err'); return; }
    if (items.some((x) => !x.why)) { KR.toast('Every keyword needs a reason in the last column.', 'err'); return; }
    KR.busy(btn, true, 'Adding…');
    try {
      const r = await KR.api('keywords', 'inhouseAdd', { items, location: H.locLabel });
      KR.toast('Added ' + r.added + ' keyword' + (r.added === 1 ? '' : 's') + ' to analyst verification.' + (r.skipped && r.skipped.length ? ' Skipped (already in the pipeline): ' + r.skipped.join(', ') + '.' : ''), 'ok');
      const done = new Set(items.map((x) => x.keyword));
      H.rows = H.rows.filter((x) => !done.has(x.keyword));
      render('');
      if (!H.rows.length) $('#ihInput').value = '';
    } catch (e) {
      KR.toast(e.message, 'err');
      KR.busy(btn, false);
    }
  }

  KR.initInhouse = async () => {
    const host = $('#kw-opps');
    if (!host || $('#ihCard')) return;
    let info;
    try { info = await KR.api('keywords', 'inhouseInfo'); } catch (e) { return; }
    if (!info || !info.allowed) return;
    const card = document.createElement('div');
    card.id = 'ihCard';
    card.className = 'card';
    card.innerHTML = '<h2>Add in-house keywords</h2>' +
      '<p class="lead">Paste the report keywords chosen in-house, one per line (for example: smart helmet market). Click "Check keywords" to see the volume, the scope and the reason for each one. Nothing is added until you confirm.</p>' +
      '<textarea id="ihInput" rows="5" placeholder="smart helmet market&#10;green ammonia market"></textarea>' +
      '<div class="row"><span class="grow"></span><button id="ihCheck" class="btn primary" type="button">Check keywords</button></div>' +
      '<div id="ihProgress" class="progress"></div><div id="ihTable"></div>';
    host.insertBefore(card, host.firstChild);
    card.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'ihCheck') check(b);
      else if (b.id === 'ihAdd') add(b);
    });
  };
})();
