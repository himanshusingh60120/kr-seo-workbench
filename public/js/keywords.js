'use strict';
/* Keywords tab: Mangools research + AI selection, analyst verification, manager approval, Research List. */
(function () {
  const KR = window.KR;
  const { $, $$, esc, fmtNum } = KR;
  const S = KR.state;

  const GENERIC = new Set(['market', 'markets', 'industry', 'size', 'share', 'report', 'reports', 'global', 'analysis', 'trends', 'trend', 'forecast', 'growth', 'outlook', 'the', 'of', 'and', 'for', 'in', 'by', 'to', 'a']);

  // ---------- Mangools pacing (3 calls / 30 s) ----------
  let lastMg = 0;
  async function mgCall(action, payload, prog) {
    const gap = 11000 - (Date.now() - lastMg);
    if (lastMg && gap > 0) await KR.countdown(Math.ceil(gap / 1000), prog, 'Pacing Mangools calls (3 per 30 s)');
    for (let attempt = 0; ; attempt++) {
      lastMg = Date.now();
      try {
        return await KR.api('keywords', action, payload);
      } catch (e) {
        if (e.status === 429 && attempt < 3) { await KR.countdown(Math.min(Number(e.retryAfter) || 30, 90), prog, 'Mangools rate limit'); continue; }
        throw e;
      }
    }
  }

  function coreTokens(seed) {
    const words = String(seed).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const core = words.filter((w) => !GENERIC.has(w));
    return (core.length ? core : words).map((w) => (w.length > 5 ? w.slice(0, w.length - 2) : w));
  }

  function relevance(kw, core) {
    const toks = kw.split(/[^a-z0-9]+/).filter(Boolean);
    let hit = 0;
    core.forEach((c) => { if (toks.some((t) => t.indexOf(c) === 0)) hit++; });
    return core.length ? hit / core.length : 0;
  }

  function scoreKw(e, seed) {
    let s = Math.log10((e.sv || 0) + 10) * 10;
    if (e.kd !== null && e.kd !== undefined) s -= e.kd * 0.15;
    s += e.comps.length * 6;
    if (/\b(market|industry)\b/.test(e.kw)) s += 6;
    if (/\b(size|share|growth|forecast|trends?|analysis|report|outlook|cagr|value)\b/.test(e.kw)) s += 5;
    if (e.kw === seed) s += 50;
    if (e.kw.split(' ').length > 7) s -= 5;
    return Math.round(s * 10) / 10;
  }

  function mergeCandidates(seed, related, compSets) {
    const map = new Map();
    const add = (k, src, domain) => {
      if (!k || !k.kw) return;
      const key = k.kw.toLowerCase().replace(/\s+/g, ' ').trim();
      let e = map.get(key);
      if (!e) { e = { kw: key, sv: k.sv, kd: k.kd, cpc: k.cpc, ppc: k.ppc, sources: [], comps: [] }; map.set(key, e); }
      else {
        if ((k.sv || 0) > (e.sv || 0)) e.sv = k.sv;
        if (e.kd === null || e.kd === undefined) e.kd = k.kd;
        if (e.cpc === null || e.cpc === undefined) e.cpc = k.cpc;
      }
      if (e.sources.indexOf(src) < 0) e.sources.push(src);
      if (domain && e.comps.indexOf(domain) < 0) e.comps.push(domain);
    };
    related.forEach((k) => add(k, 'KWFinder'));
    compSets.forEach((cs) => (cs.keywords || []).forEach((k) => add(k, 'Competitor', cs.domain)));
    const core = coreTokens(seed);
    const list = Array.from(map.values());
    let filtered = list.filter((e) => relevance(e.kw, core) >= 1);
    if (filtered.length < 15) filtered = list.filter((e) => relevance(e.kw, core) >= 0.5);
    filtered.forEach((e) => { e.score = scoreKw(e, seed); });
    return filtered.sort((a, b) => b.score - a.score);
  }

  async function runResearch() {
    const btn = $('#kwRun');
    const prog = KR.progress('#kwProgress');
    const report = $('#kwReport').value.trim();
    const seed = ($('#kwSeed').value.trim() || report).toLowerCase();
    if (!seed) { KR.toast('Enter a report name or seed keyword.', 'err'); return; }
    const loc = Number($('#kwLocation').value) || 0;
    const locLabel = $('#kwLocation').selectedOptions[0].textContent;
    const depth = Number($('#kwDepth').value) || 0;
    KR.busy(btn, true, 'Researching…');
    $('#kwSerp').classList.add('hidden');
    $('#kwResults').classList.add('hidden');
    const kw = S.kw = { report: report || KR.titleCase(seed), seed, loc, locLabel, related: [], serp: null, comp: [], rows: [], others: [], ai: {} };
    try {
      let s = prog.step('KWFinder: fetching related keywords…');
      try { const r = await mgCall('related', { kw: seed, location_id: loc }, prog); kw.related = r.keywords || []; s.done('KWFinder: ' + kw.related.length + ' related keywords'); }
      catch (e) { s.fail('KWFinder failed: ' + e.message); }

      s = prog.step('SERPChecker: who ranks on Google for "' + seed + '"…');
      try {
        kw.serp = await mgCall('serp', { kw: seed, location_id: loc }, prog);
        s.done('SERP: ' + kw.serp.organic.length + ' results · KD ' + (kw.serp.kd === null ? 'n/a' : kw.serp.kd) + ' · competitors ranking: ' + kw.serp.organic.filter((o) => o.competitor).length);
        renderSerp();
      } catch (e) { s.fail('SERPChecker failed: ' + e.message); }

      const urls = [];
      if (kw.serp) kw.serp.organic.filter((o) => o.competitor).slice(0, depth).forEach((o) => urls.push(o.url));
      $('#kwCompUrls').value.split(/\s+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)).forEach((u) => { if (urls.indexOf(u) < 0) urls.push(u); });
      for (const url of urls) {
        s = prog.step('Competitor keywords: ' + url);
        try { const r = await mgCall('competitor', { url, location_id: loc }, prog); kw.comp.push(r); s.done('Competitor ' + r.domain + ': ' + r.keywords.length + ' ranking keywords'); }
        catch (e) { s.fail('Competitor ' + url + ': ' + e.message); }
      }
      if (!kw.related.length && !kw.comp.length) prog.info('No Mangools data, so the AI will propose keywords from its own knowledge. Check volumes manually.');

      const cands = mergeCandidates(seed, kw.related, kw.comp);
      kw.candidates = cands;
      s = prog.step('AI: choosing the primary and secondary keywords from ' + cands.length + ' candidates…');
      const out = await KR.api('keywords', 'analyze', {
        reportName: kw.report,
        seed,
        location: locLabel,
        kd: kw.serp ? kw.serp.kd : null,
        serp: kw.serp ? kw.serp.organic.slice(0, 10).map((o) => ({ position: o.position, domain: o.domain, title: o.title, competitor: o.competitor })) : [],
        candidates: cands.slice(0, 120).map((c) => ({ kw: c.kw, sv: c.sv, kd: c.kd, cpc: c.cpc, comps: c.comps.length }))
      });
      kw.ai = out || {};
      buildRows(kw.ai, cands);
      s.done('AI picked 1 primary and ' + Math.max(0, kw.rows.length - 1) + ' secondary keywords');
      renderResults();
    } catch (e) {
      prog.error(e.message);
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  function buildRows(out, cands) {
    const byKw = new Map(cands.map((c) => [c.kw, c]));
    const rows = [];
    const seen = new Set();
    const add = (k, type) => {
      if (!k || !k.keyword) return;
      const key = String(k.keyword).toLowerCase().replace(/\s+/g, ' ').trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      const c = byKw.get(key);
      rows.push({
        keyword: key, type,
        sv: c ? c.sv : null, kd: c ? c.kd : null, cpc: c ? c.cpc : null, ppc: c ? c.ppc : null,
        competitors: c ? c.comps.join(', ') : '', compCount: c ? c.comps.length : 0,
        source: c ? c.sources.join(' + ') : 'AI suggestion',
        reason: String(k.reason || ''), placement: String(k.placement || '')
      });
    };
    add(out.primary, 'Primary');
    (Array.isArray(out.secondary) ? out.secondary : []).forEach((k) => add(k, 'Secondary'));
    if (!rows.length && cands[0]) add({ keyword: cands[0].kw, reason: 'Highest-scoring candidate from Mangools data.' }, 'Primary');
    S.kw.rows = rows;
    S.kw.others = cands.filter((c) => !seen.has(c.kw)).slice(0, 80);
  }

  function renderSerp() {
    const s = S.kw.serp;
    if (!s) return;
    const box = $('#kwSerp');
    box.classList.remove('hidden');
    const kr = s.organic.find((o) => o.kr);
    box.innerHTML = '<h2>Google top 10 for "' + esc(s.kw) + '"</h2><p class="lead">Keyword difficulty ' + (s.kd === null ? 'n/a' : esc(s.kd)) + ' · ' + (kr ? 'Kings Research ranks #' + kr.position : 'Kings Research is not in the top results') + '</p>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Domain</th><th>Title</th><th>DA</th><th>PA</th><th>CF / TF</th></tr></thead><tbody>' +
      s.organic.slice(0, 10).map((o) => '<tr class="' + (o.competitor ? 'comp-row' : o.kr ? 'kr-row' : '') + '"><td>' + o.position + '</td><td>' + esc(o.domain) + (o.competitor ? ' <span class="tag comp">competitor</span>' : '') + (o.kr ? ' <span class="tag kr">us</span>' : '') + '</td><td><a href="' + esc(o.url) + '" target="_blank" rel="noopener">' + esc(o.title || o.url) + '</a></td><td>' + fmtNum(o.da) + '</td><td>' + fmtNum(o.pa) + '</td><td>' + fmtNum(o.cf) + ' / ' + fmtNum(o.tf) + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  function renderResults() {
    const kw = S.kw;
    const ai = kw.ai || {};
    const box = $('#kwResults');
    box.classList.remove('hidden');
    const faqs = Array.isArray(ai.faq_questions) ? ai.faq_questions : [];
    box.innerHTML = '<h2>Proposed keywords for "' + esc(kw.report) + '"</h2>' +
      (ai.strategy_note ? '<div class="note">' + esc(ai.strategy_note) + '</div>' : '') +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Keyword</th><th>Type</th><th>Volume</th><th>KD</th><th>CPC</th><th>Competitors</th><th>Why it is good for our page</th><th>Placement</th><th></th></tr></thead><tbody>' +
      kw.rows.map((r, i) => '<tr><td><b>' + esc(r.keyword) + '</b><div class="muted small">' + esc(r.source) + '</div></td>' +
        '<td><select data-kt="' + i + '"><option' + (r.type === 'Primary' ? ' selected' : '') + '>Primary</option><option' + (r.type === 'Secondary' ? ' selected' : '') + '>Secondary</option></select></td>' +
        '<td>' + fmtNum(r.sv) + '</td><td>' + fmtNum(r.kd) + '</td><td>' + (r.cpc === null || r.cpc === undefined ? '–' : '$' + esc(r.cpc)) + '</td>' +
        '<td title="' + esc(r.competitors) + '">' + (r.compCount || 0) + '</td>' +
        '<td><textarea rows="2" data-kr="' + i + '">' + esc(r.reason) + '</textarea></td>' +
        '<td class="small">' + esc(r.placement) + '</td>' +
        '<td><button class="btn tiny danger" type="button" data-kdel="' + i + '">Remove</button></td></tr>').join('') +
      '</tbody></table></div>' +
      '<div class="row"><input id="kwAddInput" type="text" placeholder="Add a keyword manually"><button id="kwAddBtn" class="btn" type="button">Add</button><span class="grow"></span>' +
      '<button id="kwSave" class="btn primary" type="button">Save for analyst verification</button></div>' +
      (faqs.length ? '<h3>FAQ keyword ideas</h3><ul class="small">' + faqs.map((q) => '<li>' + esc(q) + '</li>').join('') + '</ul>' : '') +
      '<details class="cat"><summary><span class="grow">More candidates (' + kw.others.length + ')</span></summary><div class="cat-body"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Keyword</th><th>Volume</th><th>KD</th><th>Competitors</th><th>Score</th><th></th></tr></thead><tbody>' +
      kw.others.map((c, i) => '<tr><td>' + esc(c.kw) + '</td><td>' + fmtNum(c.sv) + '</td><td>' + fmtNum(c.kd) + '</td><td>' + c.comps.length + '</td><td>' + esc(c.score) + '</td><td><button class="btn tiny" type="button" data-kadd="' + i + '">Add</button></td></tr>').join('') +
      '</tbody></table></div></div></details>';
  }

  function onResultsChange(e) {
    const t = e.target;
    if (t.dataset.kt !== undefined) {
      const i = Number(t.dataset.kt);
      if (t.value === 'Primary') S.kw.rows.forEach((r, k) => { r.type = k === i ? 'Primary' : 'Secondary'; });
      else S.kw.rows[i].type = 'Secondary';
      renderResults();
    }
  }

  function onResultsInput(e) {
    const t = e.target;
    if (t.dataset.kr !== undefined) S.kw.rows[Number(t.dataset.kr)].reason = t.value;
  }

  function onResultsClick(e) {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.kdel !== undefined) { S.kw.rows.splice(Number(t.dataset.kdel), 1); renderResults(); }
    else if (t.dataset.kadd !== undefined) {
      const c = S.kw.others.splice(Number(t.dataset.kadd), 1)[0];
      if (c) S.kw.rows.push({ keyword: c.kw, type: 'Secondary', sv: c.sv, kd: c.kd, cpc: c.cpc, ppc: c.ppc, competitors: c.comps.join(', '), compCount: c.comps.length, source: c.sources.join(' + '), reason: '', placement: '' });
      renderResults();
    } else if (t.id === 'kwAddBtn') {
      const v = $('#kwAddInput').value.trim().toLowerCase();
      if (!v) return;
      if (S.kw.rows.some((r) => r.keyword === v)) { KR.toast('That keyword is already in the list.'); return; }
      const c = (S.kw.candidates || []).find((x) => x.kw === v);
      S.kw.rows.push({ keyword: v, type: S.kw.rows.some((r) => r.type === 'Primary') ? 'Secondary' : 'Primary', sv: c ? c.sv : null, kd: c ? c.kd : null, cpc: c ? c.cpc : null, ppc: c ? c.ppc : null, competitors: c ? c.comps.join(', ') : '', compCount: c ? c.comps.length : 0, source: 'Manual', reason: '', placement: '' });
      renderResults();
    } else if (t.id === 'kwSave') saveKeywords(t);
  }

  async function saveKeywords(btn) {
    try {
      const user = KR.requireUser();
      KR.busy(btn, true, 'Saving…');
      const r = await KR.api('keywords', 'save', { user, reportName: S.kw.report, seed: S.kw.seed, location: S.kw.locLabel, rows: S.kw.rows });
      KR.toast('Saved ' + r.saved + ' keywords (group ' + r.groupId + '). Analysts can verify them now.', 'ok');
      KR.showSub('kw', 'kw-verify');
    } catch (e) {
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  // ---------- groups ----------
  async function loadGroups() {
    const r = await KR.api('keywords', 'list');
    S.kwGroups = r.groups || [];
    return S.kwGroups;
  }

  async function loadVerify() {
    const sel = $('#kvGroup');
    const box = $('#kvTable');
    box.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const groups = (await loadGroups()).filter((g) => g.status === 'Pending Verification');
      const cur = sel.value;
      sel.innerHTML = groups.length
        ? groups.map((g) => '<option value="' + esc(g.groupId) + '">' + esc(g.reportName) + ' · ' + esc(g.createdAt) + ' · ' + g.rows.length + ' keywords</option>').join('')
        : '<option value="">No keyword groups are waiting for verification</option>';
      if (cur && groups.some((g) => g.groupId === cur)) sel.value = cur;
      renderVerify();
    } catch (e) {
      box.innerHTML = '<p class="err">' + esc(e.message) + '</p>';
    }
  }

  function renderVerify() {
    const g = (S.kwGroups || []).find((x) => x.groupId === $('#kvGroup').value);
    const box = $('#kvTable');
    if (!g) { box.innerHTML = '<p class="hint">Nothing to verify right now.</p>'; return; }
    box.innerHTML = '<p class="small muted">Seed: ' + esc(g.seed) + ' · Location: ' + esc(g.location) + ' · Researched by ' + esc(g.createdBy) + '</p>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Keyword</th><th>Type</th><th>Volume</th><th>KD</th><th>Verdict</th><th>Reason (why it is, or is not, good for our page)</th></tr></thead><tbody>' +
      g.rows.map((r) => '<tr data-id="' + esc(r.id) + '"><td><b>' + esc(r.keyword) + '</b><div class="muted small">' + esc(r.placement) + '</div></td><td>' + esc(r.type) + '</td><td>' + fmtNum(r.sv) + '</td><td>' + fmtNum(r.kd) + '</td>' +
        '<td class="nowrap"><label class="chk"><input type="radio" name="v-' + esc(r.id) + '" value="Good"' + (r.verdict === 'Good' ? ' checked' : '') + '> Good</label><br><label class="chk"><input type="radio" name="v-' + esc(r.id) + '" value="Not good"' + (r.verdict === 'Not good' ? ' checked' : '') + '> Not good</label></td>' +
        '<td><textarea rows="2" class="v-reason">' + esc(r.analystReason || r.reason) + '</textarea></td></tr>').join('') +
      '</tbody></table></div><div class="row"><button class="btn" id="kvAllGood" type="button">Mark all Good</button><span class="grow"></span><button class="btn primary" id="kvSubmit" type="button">Submit verification</button></div>';
  }

  async function submitVerify(btn) {
    try {
      const user = KR.requireUser();
      const gid = $('#kvGroup').value;
      if (!gid) return;
      const verdicts = $$('#kvTable tr[data-id]').map((tr) => {
        const c = tr.querySelector('input[type=radio]:checked');
        return { id: tr.dataset.id, verdict: c ? c.value : '', reason: tr.querySelector('.v-reason').value.trim() };
      });
      if (verdicts.some((v) => !v.verdict || !v.reason)) throw new Error('Choose Good or Not good and give a reason for every keyword.');
      KR.busy(btn, true, 'Submitting…');
      await KR.api('keywords', 'verify', { groupId: gid, analyst: user, verdicts });
      KR.toast('Verification submitted and sent to the manager for approval.', 'ok');
      await loadVerify();
    } catch (e) {
      KR.toast(e.message, 'err');
      KR.busy(btn, false);
    }
  }

  async function loadApprove() {
    const box = $('#kaList');
    box.innerHTML = '<p class="hint">Loading…</p>';
    if (!$('#kaEmail').value) $('#kaEmail').value = KR.store.get('kr_mgr_email', '');
    if (!$('#kaPin').value) $('#kaPin').value = KR.session.get('kr_mgr_pin', '');
    try {
      const groups = (await loadGroups()).filter((g) => g.status === 'Awaiting Approval');
      if (!groups.length) { box.innerHTML = '<p class="hint">No keyword groups are waiting for approval.</p>'; return; }
      box.innerHTML = groups.map((g) => '<div class="group" data-gid="' + esc(g.groupId) + '"><div class="group-head"><b>' + esc(g.reportName) + '</b> <span class="muted small">' + esc(g.groupId) + ' · seed "' + esc(g.seed) + '" · verified by ' + esc((g.rows[0] && g.rows[0].analyst) || '') + '</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Approve</th><th>Keyword</th><th>Type</th><th>Volume</th><th>KD</th><th>Analyst verdict</th><th>Analyst reason</th></tr></thead><tbody>' +
        g.rows.map((r) => '<tr><td><input type="checkbox" data-aid="' + esc(r.id) + '"' + (r.verdict === 'Good' ? ' checked' : '') + '></td><td><b>' + esc(r.keyword) + '</b></td><td>' + esc(r.type) + '</td><td>' + fmtNum(r.sv) + '</td><td>' + fmtNum(r.kd) + '</td><td><span class="tag ' + (r.verdict === 'Good' ? 'ok' : 'bad') + '">' + esc(r.verdict) + '</span></td><td class="small">' + esc(r.analystReason) + '</td></tr>').join('') +
        '</tbody></table></div><div class="row"><input type="text" class="ka-note grow" placeholder="Note (optional)"><button class="btn danger" type="button" data-decide="reject">Reject</button><button class="btn primary" type="button" data-decide="approve">Approve to Research List</button></div></div>').join('');
    } catch (e) {
      box.innerHTML = '<p class="err">' + esc(e.message) + '</p>';
    }
  }

  async function decide(btn) {
    const g = btn.closest('.group');
    try {
      const email = $('#kaEmail').value.trim();
      const pin = $('#kaPin').value;
      if (!email || !pin) throw new Error('Enter the manager email and PIN.');
      KR.store.set('kr_mgr_email', email);
      KR.session.set('kr_mgr_pin', pin);
      const approvedIds = $$('input[data-aid]', g).filter((c) => c.checked).map((c) => c.dataset.aid);
      KR.busy(btn, true, 'Saving…');
      const r = await KR.api('keywords', 'decide', { groupId: g.dataset.gid, email, pin, decision: btn.dataset.decide, note: $('.ka-note', g).value, approvedIds });
      KR.toast(btn.dataset.decide === 'approve' ? 'Approved: "' + r.primary + '" added to the Research List on ' + r.approvalDate + '.' : 'Keyword group rejected.', 'ok');
      await loadApprove();
    } catch (e) {
      KR.toast(e.message, 'err');
      KR.busy(btn, false);
    }
  }

  // ---------- Research List ----------
  KR.loadResearch = async () => {
    const r = await KR.api('keywords', 'research');
    S.research = r.rows || [];
    return S.research;
  };

  KR.researchTable = (rows, withActions) => {
    if (!rows.length) return '<p class="hint">No approved keywords yet.</p>';
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Report</th><th>Primary keyword</th><th>Secondary keywords</th><th>Approved</th><th>Live</th><th>Live date</th><th>Last live check</th>' + (withActions ? '<th></th>' : '') + '</tr></thead><tbody>' +
      rows.map((r, i) => '<tr><td><b>' + esc(r.reportName) + '</b><div class="muted small">' + esc(r.groupId) + '</div></td>' +
        '<td>' + esc(r.primary) + '<div class="muted small">Vol ' + fmtNum(r.sv) + ' · KD ' + fmtNum(r.kd) + '</div></td>' +
        '<td class="small">' + esc(r.secondary) + '</td>' +
        '<td class="small">' + esc(r.approvalDate) + '<div class="muted">' + esc(r.approvedBy) + '</div></td>' +
        '<td>' + (r.liveStatus === 'Live' ? '<span class="tag ok">Live</span><div class="small"><a href="' + esc(r.liveUrl) + '" target="_blank" rel="noopener">' + esc(String(r.liveUrl || '').replace(/^https?:\/\/(www\.)?/, '')) + '</a></div>' : '<span class="tag">' + esc(r.liveStatus || 'Not live') + '</span>') + '</td>' +
        '<td class="small">' + esc(r.liveDate) + (r.detectedOn ? '<div class="muted">detected ' + esc(r.detectedOn) + '</div>' : '') + '</td>' +
        '<td class="small">' + esc(r.lastCheck) + '<div class="muted">' + esc(r.checkSummary) + '</div></td>' +
        (withActions ? '<td>' + (r.liveStatus === 'Live' && r.liveUrl ? '<button class="btn tiny" type="button" data-lvcheck="' + i + '">Run live check</button>' : '') + '</td>' : '') + '</tr>').join('') +
      '</tbody></table></div>';
  };

  async function loadResearchList() {
    const box = $('#klTable');
    box.innerHTML = '<p class="hint">Loading…</p>';
    try { box.innerHTML = KR.researchTable(await KR.loadResearch(), false); }
    catch (e) { box.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; }
  }

  KR.initKeywords = () => {
    $('#kwRun').addEventListener('click', runResearch);
    $('#kwReport').addEventListener('change', () => { if (!$('#kwSeed').value.trim()) $('#kwSeed').value = $('#kwReport').value.trim().toLowerCase(); });
    const res = $('#kwResults');
    res.addEventListener('change', onResultsChange);
    res.addEventListener('input', onResultsInput);
    res.addEventListener('click', onResultsClick);
    $('#kvRefresh').addEventListener('click', loadVerify);
    $('#kvGroup').addEventListener('change', renderVerify);
    $('#kvTable').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'kvAllGood') $$('#kvTable input[value="Good"]').forEach((r) => { r.checked = true; });
      if (b.id === 'kvSubmit') submitVerify(b);
    });
    $('#kaRefresh').addEventListener('click', loadApprove);
    $('#kaList').addEventListener('click', (e) => { const b = e.target.closest('button[data-decide]'); if (b) decide(b); });
    $('#klRefresh').addEventListener('click', loadResearchList);
    KR.hooks.sub['kw-verify'] = loadVerify;
    KR.hooks.sub['kw-approve'] = loadApprove;
    KR.hooks.sub['kw-list'] = loadResearchList;
  };
})();
