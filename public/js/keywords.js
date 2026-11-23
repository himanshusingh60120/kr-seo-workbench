'use strict';
/* Keywords tab: opportunity finder (competitor gap + reports sitemap -> New report / Revamp; the last saved scan
   is reloaded from the Opportunities sheet; sortable by volume; more secondary keywords from the pages ranking in
   Google's top 10), must-use secondary keywords for every topic sent on, analyst verification (with the same
   suggestions and a "Must use" tick per keyword), manager approval, Research List. */
(function () {
  const KR = window.KR;
  const { $, $$, esc, fmtNum } = KR;
  const S = KR.state;

  const PRI = { High: 0, Medium: 1, Low: 2 };

  // ---------- helpers ----------
  function shortUrl(u) { return String(u || '').replace(/^https?:\/\/(www\.)?/, ''); }
  function link(u, label) { return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(label || shortUrl(u)) + '</a>' : ''; }
  function actionHtml(action, url) {
    const tag = action === 'Revamp' ? '<span class="tag comp">Revamp</span>' : '<span class="tag kr">New report</span>';
    return tag + (url ? ' <span class="small">' + link(url) + '</span>' : '');
  }
  function compsText(t) {
    return Object.keys(t.positions || {}).map((d) => d + (t.positions[d] ? ' #' + t.positions[d] : '')).join(', ');
  }
  function nv(v) { return v === null || v === undefined || v === '' || isNaN(Number(v)) ? -1 : Number(v); }
  function bySv(a, b) { return nv(b.sv) - nv(a.sv); }
  // Must-use keywords first, then by volume.
  function mustFirst(a, b) { return ((b.mustUse ? 1 : 0) - (a.mustUse ? 1 : 0)) || bySv(a, b); }
  const MUST_TAG = ' <span class="tag kr">must use</span>';
  function locId(label) {
    const opt = $$('#opLocation option').find((o) => o.textContent === label);
    return opt ? Number(opt.value) : 0;
  }
  function freshOpp(extra) {
    return Object.assign({ topics: [], loc: 0, locLabel: 'Global', sel: new Set(), sent: new Set(), open: new Set(), saved: null,
      f: { q: '', st: '', pr: '', sort: '', hidePipe: false, hideIrr: true } }, extra || {});
  }

  // Keyword difficulty in words, on the Mangools scale (0 to 100).
  KR.kdLabel = (kd) => {
    if (kd === null || kd === undefined || kd === '' || !Number.isFinite(Number(kd))) return '';
    const n = Number(kd);
    return n < 15 ? 'Very easy' : n < 30 ? 'Easy' : n < 50 ? 'Possible' : n < 70 ? 'Difficult' : n < 85 ? 'Hard' : 'Very hard';
  };
  KR.kdHtml = (kd) => {
    const l = KR.kdLabel(kd);
    return l ? fmtNum(kd) + '<div class="muted small">' + l + '</div>' : '–';
  };

  // ---------- Mangools pacing (3 calls / 30 s) ----------
  // One pace for every Mangools call in the tab (Keyword ideas uses it too, through KR.mgPaced).
  let lastMg = 0;
  async function pacedCall(endpoint, action, payload, prog) {
    const gap = 11000 - (Date.now() - lastMg);
    if (lastMg && gap > 0) await KR.countdown(Math.ceil(gap / 1000), prog, 'Pacing Mangools calls (3 per 30 s)');
    for (let attempt = 0; ; attempt++) {
      lastMg = Date.now();
      try {
        return await KR.api(endpoint, action, payload);
      } catch (e) {
        if (e.status === 429 && attempt < 3) { await KR.countdown(Math.min(Number(e.retryAfter) || 30, 90), prog, 'Mangools rate limit'); continue; }
        throw e;
      }
    }
  }
  function mgCall(action, payload, prog) { return pacedCall('keywords', action, payload, prog); }
  KR.mgPaced = pacedCall;

  // ---------- more secondary keywords from the Google top 10 ----------
  // o = { primary, title, loc, existingUrl, existing: [keywords already in the list] }
  async function suggestFromTop10(o, prog) {
    let s = prog.step('Google top 10 for "' + o.primary + '"…');
    const serp = await mgCall('serp', { kw: o.primary, location_id: o.loc || 0 }, prog);
    const items = (serp.organic || []).filter((x) => !x.kr).slice(0, 10).map((x) => ({ url: x.url, domain: x.domain, position: x.position, title: x.title }));
    if (!items.length) { s.fail('Mangools returned no Google results for this keyword.'); return []; }
    s.done('Top 10: ' + items.map((x) => x.domain).join(', '));
    s = prog.step('Reading the ' + items.length + ' ranking pages and picking secondary keywords…');
    const r = await KR.api('keywords', 'pageTerms', { primary: o.primary, title: o.title, serp: items, existing: o.existing, existingUrl: o.existingUrl || '' });
    s.done('Read ' + r.pagesRead + ' of ' + r.pagesTried + ' pages · ' + r.keywords.length + ' new keyword ideas');
    if (!r.keywords.length) return [];
    s = prog.step('Mangools: search volumes for ' + r.keywords.length + ' keywords…');
    let vols = [];
    try {
      const v = await mgCall('volumes', { keywords: r.keywords.map((k) => k.keyword), location_id: o.loc || 0 }, prog);
      vols = v.keywords || [];
      s.done('Search volumes added');
    } catch (e) {
      s.fail('Search volumes not available: ' + e.message);
    }
    const byKw = new Map(vols.map((k) => [k.kw, k]));
    return r.keywords.map((k) => {
      const v = byKw.get(k.keyword) || {};
      return {
        keyword: k.keyword,
        sv: v.sv === undefined ? null : v.sv,
        kd: v.kd === undefined ? null : v.kd,
        cpc: v.cpc === undefined ? null : v.cpc,
        why: k.why || '',
        sources: k.sources || [],
        seo: k.seo || ''
      };
    }).sort(bySv);
  }

  // =====================================================================
  // 1. FIND OPPORTUNITIES
  // =====================================================================
  function rankItem(t) {
    return { key: t.key, status: t.kr.status, url: t.kr.url, primary: t.primary.kw, sv: t.primary.sv, total: t.totalVolume, kd: t.kd, comps: compsText(t) };
  }

  function sortTopics() {
    S.opp.topics.sort((a, b) => {
      const ka = a.keep === false ? 1 : 0;
      const kb = b.keep === false ? 1 : 0;
      if (ka !== kb) return ka - kb;
      const pa = PRI[a.priority] === undefined ? 3 : PRI[a.priority];
      const pb = PRI[b.priority] === undefined ? 3 : PRI[b.priority];
      if (pa !== pb) return pa - pb;
      return b.score - a.score;
    });
  }

  // Shows the most recent scan from the Opportunities sheet when the page opens (unless a scan is already on screen).
  let loadingScan = false;
  async function loadLastScan() {
    if (loadingScan || (S.opp && S.opp.topics && S.opp.topics.length)) return;
    loadingScan = true;
    try {
      const r = await KR.api('keywords', 'lastScan');
      if (!r.topics || !r.topics.length) return;
      if (S.opp && S.opp.topics && S.opp.topics.length) return;
      S.opp = freshOpp({ topics: r.topics, loc: locId(r.location), locLabel: r.location || 'Global', saved: { at: r.scannedAt, by: r.scannedBy } });
      sortTopics();
      renderOpps();
    } catch (e) {
      /* Sheet not configured yet, or no scan saved: nothing to show. */
    } finally {
      loadingScan = false;
    }
  }

  async function runOpps() {
    const btn = $('#opRun');
    const prog = KR.progress('#opProgress');
    const comps = $$('#opComps input:checked').map((c) => c.value);
    if (!comps.length) { KR.toast('Tick at least one competitor.', 'err'); return; }
    const pages = Number($('#opPages').value) || 1;
    const loc = Number($('#opLocation').value) || 0;
    const locLabel = $('#opLocation').selectedOptions[0].textContent;
    KR.busy(btn, true, 'Scanning…');
    $('#opResults').classList.add('hidden');
    const O = S.opp = freshOpp({ loc, locLabel });
    try {
      const rows = [];
      for (const d of comps) {
        for (let p = 1; p <= pages; p++) {
          const s = prog.step('Mangools: keywords ' + d + ' ranks for and we do not' + (pages > 1 ? ' (page ' + p + ')' : '') + '…');
          let r;
          try {
            r = await mgCall('gap', { competitor: d, location_id: loc, page: p }, prog);
          } catch (e) {
            s.fail(d + ': ' + e.message);
            break;
          }
          r.keywords.forEach((k) => rows.push([k[0], k[1], k[2], k[3], k[4], r.domain]));
          s.done(d + ': ' + r.keywords.length.toLocaleString('en-US') + ' keywords' + (r.total ? ' (of ' + Number(r.total).toLocaleString('en-US') + ' gap keywords)' : ''));
          if (!r.pagination || !r.keywords.length) break;
        }
      }
      if (!rows.length) throw new Error('Mangools returned no competitor keywords. Check MANGOOLS_API_KEY and your remaining keyword lookups (free plans have only a few per day).');

      let s = prog.step('Grouping ' + rows.length.toLocaleString('en-US') + ' keywords into report topics and checking our reports sitemap…');
      const res = await KR.api('keywords', 'opportunities', { rows });
      O.topics = res.topics || [];
      const cnt = (st) => O.topics.filter((t) => t.kr.status === st).length;
      s.done(O.topics.length + ' report topics: ' + cnt('New report') + ' not published, ' + cnt('Revamp') + ' published (revamp), ' + cnt('Similar report exists') + ' with a similar report · checked against ' + Number(res.krReports).toLocaleString('en-US') + ' published reports');
      if (!O.topics.length) throw new Error('No report-style keywords (containing "market" or "industry") were found in the competitor data.');

      const toRank = O.topics.filter((t) => !t.inPipeline).slice(0, 75);
      if (toRank.length) {
        s = prog.step('AI: prioritising the top ' + toRank.length + ' topics…');
        let done = 0;
        await KR.runLimited(KR.chunk(toRank, 25).map((batch) => async () => {
          try {
            const out = await KR.api('keywords', 'rank', { items: batch.map(rankItem) });
            (out.items || []).forEach((x) => {
              const t = O.topics.find((y) => y.key === x.key);
              if (!t) return;
              t.ai = true;
              t.keep = x.keep;
              t.priority = x.priority;
              t.reason = x.reason;
              if (x.title) t.title = x.title;
              if (t.kr.status === 'Similar report exists') t.action = x.action;
            });
          } catch (e) {
            prog.error('AI prioritising failed for one batch: ' + e.message);
          }
          done += batch.length;
          s.set('AI: prioritising… ' + done + '/' + toRank.length);
        }), 3);
        s.done('AI prioritised ' + toRank.length + ' topics');
      }
      sortTopics();
      renderOpps();
      const n = Number($('#opAuto').value) || 0;
      if (n > 0) await autoSend(n, prog);
      saveScan();
    } catch (e) {
      prog.error(e.message);
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  async function autoSend(n, prog) {
    const O = S.opp;
    const pick = O.topics.filter((t) => t.priority === 'High' && t.keep !== false && !t.inPipeline && !O.sent.has(t.key)).slice(0, n);
    if (!pick.length) { prog.info('Auto-send: no new High-priority topics to send.'); return; }
    const s = prog.step('Sending the top ' + pick.length + ' High-priority topics to analyst verification…');
    try {
      const r = await sendTopics(pick, prog);
      s.done('Sent ' + r.saved + ' topics (' + r.rows + ' keywords) to analyst verification');
    } catch (e) {
      s.fail('Auto-send failed: ' + e.message);
    }
  }

  // Must-use secondary keywords: one Mangools lookup gives the volumes of the standard report searches for up to
  // 60 topics. Searches with volume (and the best-searched competitor variants) become "must use". If the lookup
  // fails, the server adds the standard report searches when the topic is saved.
  async function addMustHave(list, prog) {
    const todo = list.filter((t) => !t.mustDone);
    if (!todo.length) return;
    const st = prog.step('Mangools: must-use secondary keywords for ' + todo.length + ' topic' + (todo.length === 1 ? '' : 's') + '…');
    let made = 0;
    try {
      for (const batch of KR.chunk(todo, 60)) {
        const r = await mgCall('mustHave', {
          location_id: S.opp.loc || 0,
          items: batch.map((t) => ({ key: t.key, primary: t.primary.kw, existing: t.secondary.map((k) => ({ kw: k.kw, sv: k.sv })) }))
        }, prog);
        (r.items || []).forEach((it) => {
          const t = batch.find((x) => x.key === it.key);
          if (!t) return;
          (it.keywords || []).forEach((k) => {
            const cur = t.secondary.find((x) => x.kw === k.kw);
            if (cur) {
              if (k.mustUse) { cur.mustUse = true; cur.why = cur.why || k.why; }
              if (cur.sv === null || cur.sv === undefined) cur.sv = k.sv;
              return;
            }
            t.secondary.push({ kw: k.kw, sv: k.sv, kd: k.kd, cpc: k.cpc, src: k.mustUse ? 'Must-use search' : 'Report search variant', why: k.why || '', mustUse: !!k.mustUse });
          });
          t.mustDone = true;
          t.keywordCount = t.secondary.length + 1;
          made += t.secondary.filter((k) => k.mustUse).length;
        });
        if (r.note) prog.info(r.note);
      }
      st.done('Must-use secondary keywords chosen: ' + made + ' across ' + todo.length + ' topic' + (todo.length === 1 ? '' : 's'));
    } catch (e) {
      st.fail('Must-use keywords could not be looked up (' + e.message + '). The standard report searches will be added when the topics are saved.');
    }
  }

  async function sendTopics(input, prog) {
    const user = KR.requireUser();
    const O = S.opp;
    const list = (input || []).filter((t) => !t.inPipeline && !O.sent.has(t.key));
    if (!list.length) throw new Error('These topics are already in the pipeline.');
    await addMustHave(list, prog || KR.progress('#opProgress'));
    const groups = list.map((t) => {
      const comps = Object.keys(t.positions || {}).join(', ');
      const secs = t.secondary.slice().sort(mustFirst).slice(0, 25);
      return {
        reportName: t.title,
        seed: t.primary.kw,
        location: O.locLabel,
        action: t.action,
        existingUrl: t.kr.url || '',
        rows: [t.primary].concat(secs).map((k, i) => ({
          keyword: k.kw,
          type: i === 0 ? 'Primary' : 'Secondary',
          sv: k.sv, kd: k.kd, cpc: k.cpc, ppc: null,
          competitors: k.sources && k.sources.length ? k.sources.join(', ') : comps,
          source: i === 0 ? 'Competitor gap' : (k.src || 'Competitor gap'),
          reason: i === 0 ? (t.reason || ('Competitors rank for it (' + compsText(t) + ') and we do not.')) : (k.why || ('Variant searched for the same report; ranked by ' + comps + ' and not by us.')),
          placement: i === 0 ? 'Title, H1, meta and Overview' : '',
          mustUse: i === 0 ? false : !!k.mustUse
        }))
      };
    });
    const r = await KR.api('keywords', 'saveGroups', { user, groups });
    list.forEach((t) => { O.sent.add(t.key); O.sel.delete(t.key); });
    renderOppTable();
    return r;
  }

  function saveScan() {
    const O = S.opp;
    const topics = O.topics.filter((t) => t.keep !== false).slice(0, 300).map((t) => ({
      title: t.title, action: t.action, priority: t.priority, krStatus: t.kr.status, krUrl: t.kr.url || '',
      primary: t.primary.kw, primaryVolume: t.primary.sv, totalVolume: t.totalVolume, kd: t.kd, competitors: compsText(t),
      bestPosition: t.bestPosition, score: t.score, reason: t.reason || '', secondary: t.secondary.map((k) => k.kw).join(', '),
      inPipeline: O.sent.has(t.key) ? 'Sent for verification' : (t.inPipeline || '')
    }));
    if (!topics.length) return;
    KR.api('keywords', 'saveScan', { location: O.locLabel, topics })
      .then((r) => KR.toast('Saved ' + r.saved + ' opportunities to the "Opportunities" sheet.', 'ok'))
      .catch((e) => KR.toast('Opportunities were not saved to the sheet: ' + e.message, 'err'));
  }

  async function enrichTopic(t, btn) {
    const O = S.opp;
    KR.busy(btn, true, 'Reading top 10…');
    const prog = KR.progress('#opProgress');
    try {
      const sugg = await suggestFromTop10({ primary: t.primary.kw, title: t.title, loc: O.loc, existingUrl: t.kr.url || '', existing: [t.primary.kw].concat(t.secondary.map((k) => k.kw)) }, prog);
      let added = 0;
      sugg.forEach((k) => {
        if (t.secondary.some((x) => x.kw === k.keyword)) return;
        t.secondary.push({ kw: k.keyword, sv: k.sv, kd: k.kd, cpc: k.cpc, src: 'Top-10 pages', why: k.why, seo: k.seo, sources: k.sources });
        added++;
      });
      t.secondary.sort(bySv);
      t.keywordCount = t.secondary.length + 1;
      O.open.add(t.key);
      renderOppTable();
      KR.toast(added ? 'Added ' + added + ' secondary keywords from the top-10 pages to ' + t.title + '.' : 'No new secondary keywords were found on the top-10 pages.', added ? 'ok' : '');
    } catch (e) {
      prog.error(e.message);
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  function visibleTopics() {
    const O = S.opp;
    const f = O.f;
    const list = O.topics.filter((t) => {
      if (f.hidePipe && t.inPipeline && !O.sent.has(t.key)) return false;
      if (f.hideIrr && t.keep === false) return false;
      if (f.st && t.action !== f.st) return false;
      if (f.pr && t.priority !== f.pr) return false;
      if (f.q) {
        const hay = (t.title + ' ' + t.primary.kw + ' ' + t.secondary.map((k) => k.kw).join(' ')).toLowerCase();
        if (hay.indexOf(f.q) < 0) return false;
      }
      return true;
    });
    if (f.sort === 'sv') list.sort((a, b) => nv(b.primary.sv) - nv(a.primary.sv));
    else if (f.sort === 'total') list.sort((a, b) => nv(b.totalVolume) - nv(a.totalVolume));
    else if (f.sort === 'kd') list.sort((a, b) => (nv(a.kd) < 0 ? 999 : nv(a.kd)) - (nv(b.kd) < 0 ? 999 : nv(b.kd)));
    else if (f.sort === 'comps') list.sort((a, b) => Object.keys(b.positions || {}).length - Object.keys(a.positions || {}).length);
    return list;
  }

  function renderOpps() {
    const O = S.opp;
    const box = $('#opResults');
    box.classList.remove('hidden');
    const c = (fn) => O.topics.filter(fn).length;
    const sel = (v, cur) => (v === cur ? ' selected' : '');
    box.innerHTML = '<h2>Keyword opportunities</h2>' +
      (O.saved ? '<p class="note">Last scan from the Opportunities sheet: ' + esc(O.saved.at) + (O.saved.by ? ' by ' + esc(O.saved.by) : '') + ' · ' + esc(O.locLabel) + '. Click "Find opportunities" for a fresh scan.</p>' : '') +
      '<div class="summary">' +
      '<div class="cell"><div class="num">' + O.topics.length + '</div><div class="lbl">Report topics found</div></div>' +
      '<div class="cell"><div class="num">' + c((t) => t.action === 'New report' && t.keep !== false) + '</div><div class="lbl">New reports</div></div>' +
      '<div class="cell"><div class="num">' + c((t) => t.action === 'Revamp' && t.keep !== false) + '</div><div class="lbl">Revamps of published reports</div></div>' +
      '<div class="cell"><div class="num good">' + c((t) => t.priority === 'High' && t.keep !== false) + '</div><div class="lbl">High priority</div></div>' +
      '<div class="cell"><div class="num">' + c((t) => !!t.inPipeline || O.sent.has(t.key)) + '</div><div class="lbl">Already in the pipeline</div></div>' +
      '</div>' +
      '<div class="row">' +
      '<input id="opFilter" type="text" class="grow" placeholder="Filter by topic or keyword" value="' + esc(O.f.q) + '">' +
      '<select id="opSort" style="width:auto;margin:0"><option value=""' + sel('', O.f.sort) + '>Sort: priority</option><option value="sv"' + sel('sv', O.f.sort) + '>Sort: volume (high to low)</option><option value="total"' + sel('total', O.f.sort) + '>Sort: all-variants volume</option><option value="kd"' + sel('kd', O.f.sort) + '>Sort: KD (easiest first)</option><option value="comps"' + sel('comps', O.f.sort) + '>Sort: competitors ranking</option></select>' +
      '<select id="opStatus" style="width:auto;margin:0"><option value="">New + Revamp</option><option value="New report"' + sel('New report', O.f.st) + '>New reports only</option><option value="Revamp"' + sel('Revamp', O.f.st) + '>Revamps only</option></select>' +
      '<select id="opPriority" style="width:auto;margin:0"><option value="">All priorities</option><option' + sel('High', O.f.pr) + '>High</option><option' + sel('Medium', O.f.pr) + '>Medium</option><option' + sel('Low', O.f.pr) + '>Low</option></select>' +
      '</div>' +
      '<div class="row">' +
      '<label class="chk"><input type="checkbox" id="opHidePipe"' + (O.f.hidePipe ? ' checked' : '') + '> Hide topics already in the pipeline</label>' +
      '<label class="chk"><input type="checkbox" id="opHideIrr"' + (O.f.hideIrr ? ' checked' : '') + '> Hide not relevant</label>' +
      '<span class="grow"></span><button id="opSelHigh" class="btn tiny" type="button">Select all High</button><button id="opSelNone" class="btn tiny ghost" type="button">Clear selection</button>' +
      '<span class="hint" id="opSelCount"></span><button id="opSend" class="btn primary" type="button">Send selected to analyst verification</button></div>' +
      '<p class="hint">Sending a topic also picks its must-use secondary keywords (one Mangools lookup for all the topics sent together).</p>' +
      '<div id="opTable"></div>';
    renderOppTable();
  }

  function keywordsDetail(t) {
    const rows = [Object.assign({ isPrimary: true }, t.primary)].concat(t.secondary.slice().sort(mustFirst));
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Keyword</th><th>Type</th><th>Volume</th><th>KD</th><th>Source</th></tr></thead><tbody>' +
      rows.map((k) => '<tr><td>' + esc(k.kw) + (k.mustUse ? MUST_TAG : '') +
        (k.seo && !/^OK/.test(k.seo) ? '<div class="muted small">SEO: ' + esc(k.seo) + '</div>' : '') +
        (k.why ? '<div class="muted small">' + esc(k.why) + '</div>' : '') + '</td>' +
        '<td>' + (k.isPrimary ? 'Primary' : (k.mustUse ? 'Must use' : 'Secondary')) + '</td><td>' + fmtNum(k.sv) + '</td><td>' + KR.kdHtml(k.kd) + '</td>' +
        '<td class="small">' + (k.isPrimary ? '' : esc(k.src || 'Competitor gap') + (k.sources && k.sources.length ? '<div class="muted">' + esc(k.sources.join(', ')) + '</div>' : '')) + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  function oppRow(t) {
    const O = S.opp;
    const sent = O.sent.has(t.key);
    const locked = sent || !!t.inPipeline;
    const kr = t.kr || {};
    let actionCell;
    if (kr.status === 'Similar report exists') {
      actionCell = '<select data-oact="' + esc(t.key) + '" style="width:auto;margin:0"' + (locked ? ' disabled' : '') + '><option' + (t.action === 'New report' ? ' selected' : '') + '>New report</option><option' + (t.action === 'Revamp' ? ' selected' : '') + '>Revamp</option></select>' +
        '<div class="small">Similar: ' + link(kr.url, kr.name) + '</div>';
    } else if (kr.status === 'Revamp') {
      actionCell = '<span class="tag comp">Revamp</span><div class="small">' + link(kr.url, kr.name) + (kr.lastmod ? '<span class="muted"> · updated ' + esc(kr.lastmod) + '</span>' : '') + '</div>';
    } else {
      actionCell = '<span class="tag kr">New report</span><div class="muted small">not on our site</div>';
    }
    const comps = Object.keys(t.positions || {}).map((d) => esc(d.replace(/\.com$/, '')) + (t.positions[d] ? ' <b>#' + t.positions[d] + '</b>' : '')).join('<br>');
    const mustCount = t.secondary.filter((k) => k.mustUse).length;
    let html = '<tr' + (t.keep === false ? ' class="warn-row"' : '') + '>' +
      '<td><input type="checkbox" data-osel="' + esc(t.key) + '"' + (O.sel.has(t.key) ? ' checked' : '') + (locked ? ' disabled title="Already in the pipeline"' : '') + '></td>' +
      '<td><b>' + esc(t.title) + '</b><div class="muted small">' + esc(t.primary.kw) + ' · ' + t.keywordCount + ' keyword' + (t.keywordCount === 1 ? '' : 's') + (mustCount ? ' · ' + mustCount + ' must use' : '') + '</div>' +
      (t.inPipeline && !sent ? '<span class="tag">' + esc(t.inPipeline) + '</span>' : '') + (sent ? '<span class="tag ok">sent for verification</span>' : '') +
      (t.keep === false ? '<span class="tag bad">not relevant</span>' : '') + '</td>' +
      '<td>' + actionCell + '</td>' +
      '<td><span class="tag' + (t.priority === 'High' ? ' ok' : '') + '">' + esc(t.priority) + '</span>' + (t.ai ? '' : '<div class="muted small">by volume</div>') + '</td>' +
      '<td>' + fmtNum(t.primary.sv) + '<div class="muted small">all variants ' + fmtNum(t.totalVolume) + '</div></td>' +
      '<td>' + KR.kdHtml(t.kd) + '</td>' +
      '<td class="small">' + comps + '</td>' +
      '<td class="small">' + esc(t.reason || '') + '</td>' +
      '<td class="nowrap"><button class="btn tiny" type="button" data-okw="' + esc(t.key) + '">' + (O.open.has(t.key) ? 'Hide' : 'Keywords') + '</button> ' +
      (locked ? '' : '<button class="btn tiny ghost" type="button" data-omore="' + esc(t.key) + '" title="Read the pages ranking in Google\'s top 10 and add secondary keywords from them">More keywords</button>') + '</td></tr>';
    if (O.open.has(t.key)) html += '<tr><td></td><td colspan="8">' + keywordsDetail(t) + '</td></tr>';
    return html;
  }

  function renderOppTable() {
    const box = $('#opTable');
    if (!box) return;
    const list = visibleTopics();
    const shown = list.slice(0, 150);
    const arrow = (k) => (S.opp.f.sort === k ? ' &#9660;' : '');
    box.innerHTML = (list.length > shown.length ? '<p class="hint">Showing 150 of ' + list.length + ' topics. Use the filters to narrow down.</p>' : '') +
      (shown.length
        ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Report</th><th>Action</th>' +
          '<th data-osort="" style="cursor:pointer" title="Sort by priority">Priority' + arrow('') + '</th>' +
          '<th data-osort="sv" style="cursor:pointer" title="Sort by volume">Volume' + arrow('sv') + '</th>' +
          '<th data-osort="kd" style="cursor:pointer" title="Sort by KD, easiest first">Difficulty' + arrow('kd') + '</th>' +
          '<th data-osort="comps" style="cursor:pointer" title="Sort by competitors ranking">Competitors ranking' + arrow('comps') + '</th>' +
          '<th>Why take it up</th><th></th></tr></thead><tbody>' +
          shown.map(oppRow).join('') + '</tbody></table></div>'
        : '<p class="hint">No topics match these filters.</p>');
    updateSelCount();
  }

  function updateSelCount() {
    const el = $('#opSelCount');
    if (el) el.textContent = S.opp.sel.size ? S.opp.sel.size + ' selected' : '';
  }

  function findTopic(key) { return (S.opp.topics || []).find((t) => t.key === key); }

  function onOppInput(e) {
    if (e.target.id === 'opFilter') { S.opp.f.q = e.target.value.trim().toLowerCase(); renderOppTable(); }
  }

  function onOppChange(e) {
    const t = e.target;
    const O = S.opp;
    if (t.id === 'opSort') { O.f.sort = t.value; renderOppTable(); return; }
    if (t.id === 'opStatus') { O.f.st = t.value; renderOppTable(); return; }
    if (t.id === 'opPriority') { O.f.pr = t.value; renderOppTable(); return; }
    if (t.id === 'opHidePipe') { O.f.hidePipe = t.checked; renderOppTable(); return; }
    if (t.id === 'opHideIrr') { O.f.hideIrr = t.checked; renderOppTable(); return; }
    if (t.dataset.osel !== undefined) {
      if (t.checked) O.sel.add(t.dataset.osel); else O.sel.delete(t.dataset.osel);
      updateSelCount();
      return;
    }
    if (t.dataset.oact !== undefined) {
      const tp = findTopic(t.dataset.oact);
      if (tp) tp.action = t.value === 'Revamp' ? 'Revamp' : 'New report';
    }
  }

  async function onOppClick(e) {
    const O = S.opp;
    const th = e.target.closest('th[data-osort]');
    if (th) {
      O.f.sort = th.getAttribute('data-osort');
      const s = $('#opSort');
      if (s) s.value = O.f.sort;
      renderOppTable();
      return;
    }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'opSelHigh') {
      visibleTopics().forEach((t) => { if (t.priority === 'High' && t.keep !== false && !t.inPipeline && !O.sent.has(t.key)) O.sel.add(t.key); });
      renderOppTable();
    } else if (b.id === 'opSelNone') {
      O.sel.clear();
      renderOppTable();
    } else if (b.id === 'opSend') {
      const list = O.topics.filter((t) => O.sel.has(t.key) && !O.sent.has(t.key) && !t.inPipeline);
      if (!list.length) { KR.toast('Tick the topics to send first.'); return; }
      KR.busy(b, true, 'Sending…');
      try {
        const r = await sendTopics(list, KR.progress('#opProgress'));
        KR.toast('Sent ' + r.saved + ' topic(s) to analyst verification, with their must-use keywords.', 'ok');
      } catch (err) {
        KR.toast(err.message, 'err');
      } finally {
        KR.busy(b, false);
      }
    } else if (b.dataset.okw !== undefined) {
      if (O.open.has(b.dataset.okw)) O.open.delete(b.dataset.okw); else O.open.add(b.dataset.okw);
      renderOppTable();
    } else if (b.dataset.omore !== undefined) {
      const t = findTopic(b.dataset.omore);
      if (t) enrichTopic(t, b);
    }
  }

  // =====================================================================
  // 2. ANALYST VERIFICATION, 3. MANAGER APPROVAL, RESEARCH LIST
  // =====================================================================
  async function loadGroups() {
    const r = await KR.api('keywords', 'list');
    S.kwGroups = r.groups || [];
    return S.kwGroups;
  }

  function currentGroup() { return (S.kwGroups || []).find((x) => x.groupId === $('#kvGroup').value); }

  async function loadVerify() {
    const sel = $('#kvGroup');
    const box = $('#kvTable');
    box.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const groups = (await loadGroups()).filter((g) => g.status === 'Pending Verification');
      const cur = sel.value;
      sel.innerHTML = groups.length
        ? groups.map((g) => '<option value="' + esc(g.groupId) + '">' + esc(g.reportName) + ' · ' + esc(g.action) + ' · ' + esc(g.createdAt) + ' · ' + g.rows.length + ' keywords</option>').join('')
        : '<option value="">No keyword groups are waiting for verification</option>';
      if (cur && groups.some((g) => g.groupId === cur)) sel.value = cur;
      renderVerify();
    } catch (e) {
      box.innerHTML = '<p class="err">' + esc(e.message) + '</p>';
    }
  }

  function renderVerify() {
    const g = currentGroup();
    const box = $('#kvTable');
    if (!g) { box.innerHTML = '<p class="hint">Nothing to verify right now.</p>'; return; }
    if (S.kvSugg && S.kvSugg.groupId !== g.groupId) S.kvSugg = null;
    const rows = g.rows.filter((r) => r.type === 'Primary').concat(g.rows.filter((r) => r.type !== 'Primary').sort(mustFirst));
    box.innerHTML = '<p class="small">' + actionHtml(g.action, g.existingUrl) + ' <span class="muted">· Seed: ' + esc(g.seed) + ' · Location: ' + esc(g.location) + ' · Proposed by ' + esc(g.createdBy) + ' · must-use keywords first, then by volume</span></p>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Keyword</th><th>Type</th><th>Volume</th><th>Difficulty</th><th>Must use</th><th>Verdict</th><th>Reason (why it is, or is not, good for our page)</th></tr></thead><tbody>' +
      rows.map((r) => {
        const primary = r.type === 'Primary';
        return '<tr data-id="' + esc(r.id) + '"' + (primary ? ' data-primary="1"' : '') + '><td><b>' + esc(r.keyword) + '</b><div class="muted small">' + esc(r.placement || r.source) + '</div></td><td>' + esc(r.type) + '</td><td>' + fmtNum(r.sv) + '</td><td>' + KR.kdHtml(r.kd) + '</td>' +
          '<td>' + (primary ? '<span class="muted small">primary</span>' : '<label class="chk"><input type="checkbox" class="v-must"' + (r.mustUse ? ' checked' : '') + '> must use</label>') + '</td>' +
          '<td class="nowrap"><label class="chk"><input type="radio" name="v-' + esc(r.id) + '" value="Good"' + (r.verdict === 'Good' ? ' checked' : '') + '> Good</label><br><label class="chk"><input type="radio" name="v-' + esc(r.id) + '" value="Not good"' + (r.verdict === 'Not good' ? ' checked' : '') + '> Not good</label></td>' +
          '<td><textarea rows="2" class="v-reason">' + esc(r.analystReason || r.reason) + '</textarea></td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="row"><button class="btn" id="kvAllGood" type="button">Mark all Good</button><button class="btn ghost" id="kvMore" type="button">Suggest more secondary keywords (from top-10 pages)</button><span class="grow"></span><button class="btn primary" id="kvSubmit" type="button">Submit verification</button></div>' +
      '<div id="kvProgress" class="progress"></div><div id="kvMoreBox"></div>';
    renderMore();
  }

  async function moreForGroup(btn) {
    const g = currentGroup();
    if (!g) return;
    const primaryRow = g.rows.find((r) => r.type === 'Primary') || g.rows[0];
    KR.busy(btn, true, 'Reading top 10…');
    const prog = KR.progress('#kvProgress');
    try {
      const sugg = await suggestFromTop10({ primary: primaryRow.keyword, title: g.reportName, loc: locId(g.location), existingUrl: g.existingUrl || '', existing: g.rows.map((r) => r.keyword) }, prog);
      S.kvSugg = { groupId: g.groupId, list: sugg };
      renderMore();
    } catch (e) {
      prog.error(e.message);
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  function renderMore() {
    const box = $('#kvMoreBox');
    const sg = S.kvSugg;
    if (!box) return;
    if (!sg) { box.innerHTML = ''; return; }
    if (!sg.list.length) { box.innerHTML = '<p class="hint">No new secondary keywords were found on the top-10 pages.</p>'; return; }
    box.innerHTML = '<h3>Suggested from the top-10 pages (sorted by volume)</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Add</th><th>Keyword</th><th>Volume</th><th>Difficulty</th><th>Why</th><th>Seen on</th></tr></thead><tbody>' +
      sg.list.map((k, i) => '<tr><td><input type="checkbox" data-kvs="' + i + '"' + (/^OK/.test(k.seo || 'OK') ? ' checked' : '') + '></td>' +
        '<td><b>' + esc(k.keyword) + '</b>' + (k.seo && !/^OK/.test(k.seo) ? '<div class="muted small">SEO: ' + esc(k.seo) + '</div>' : '') + '</td>' +
        '<td>' + fmtNum(k.sv) + '</td><td>' + KR.kdHtml(k.kd) + '</td><td class="small">' + esc(k.why) + '</td><td class="small">' + esc((k.sources || []).join(', ')) + '</td></tr>').join('') +
      '</tbody></table></div><div class="row"><span class="grow"></span><button class="btn primary" id="kvAddMore" type="button">Add selected to this group</button></div>';
  }

  async function addMore(btn) {
    const sg = S.kvSugg;
    if (!sg) return;
    try {
      const rows = $$('#kvMoreBox input[data-kvs]').filter((c) => c.checked).map((c) => sg.list[Number(c.dataset.kvs)]).filter(Boolean)
        .map((k) => ({ keyword: k.keyword, sv: k.sv, kd: k.kd, cpc: k.cpc, why: k.why, sources: (k.sources || []).join(', '), source: 'Top-10 pages' }));
      if (!rows.length) throw new Error('Tick the keywords to add.');
      KR.busy(btn, true, 'Adding…');
      const r = await KR.api('keywords', 'addRows', { groupId: sg.groupId, rows });
      KR.toast('Added ' + r.added + ' keywords to the group.', 'ok');
      S.kvSugg = null;
      await loadVerify();
    } catch (e) {
      KR.toast(e.message, 'err');
      KR.busy(btn, false);
    }
  }

  async function submitVerify(btn) {
    try {
      const gid = $('#kvGroup').value;
      if (!gid) return;
      const verdicts = $$('#kvTable tr[data-id]').map((tr) => {
        const c = tr.querySelector('input[type=radio]:checked');
        const must = tr.querySelector('.v-must');
        return { id: tr.dataset.id, primary: tr.dataset.primary === '1', verdict: c ? c.value : '', reason: tr.querySelector('.v-reason').value.trim(), mustUse: must ? must.checked : undefined };
      });
      if (verdicts.some((v) => !v.verdict || !v.reason)) throw new Error('Choose Good or Not good and give a reason for every keyword.');
      const goodSecs = verdicts.filter((v) => !v.primary && v.verdict === 'Good');
      if (goodSecs.length && !goodSecs.some((v) => v.mustUse)) throw new Error('Tick "Must use" on at least one Good secondary keyword: every report needs must-use keywords.');
      KR.busy(btn, true, 'Submitting…');
      await KR.api('keywords', 'verify', { groupId: gid, verdicts: verdicts.map((v) => ({ id: v.id, verdict: v.verdict, reason: v.reason, mustUse: v.mustUse })) });
      KR.toast('Verification submitted and sent to the manager for approval.', 'ok');
      S.kvSugg = null;
      await loadVerify();
    } catch (e) {
      KR.toast(e.message, 'err');
      KR.busy(btn, false);
    }
  }

  async function loadApprove() {
    const box = $('#kaList');
    box.innerHTML = '<p class="hint">Loading…</p>';
    if (!$('#kaPin').value) $('#kaPin').value = KR.session.get('kr_mgr_pin', '');
    try {
      const groups = (await loadGroups()).filter((g) => g.status === 'Awaiting Approval');
      if (!groups.length) { box.innerHTML = '<p class="hint">No keyword groups are waiting for approval.</p>'; return; }
      box.innerHTML = groups.map((g) => {
        const rows = g.rows.filter((r) => r.type === 'Primary').concat(g.rows.filter((r) => r.type !== 'Primary').sort(mustFirst));
        return '<div class="group" data-gid="' + esc(g.groupId) + '"><div class="group-head"><b>' + esc(g.reportName) + '</b> ' + actionHtml(g.action, g.existingUrl) +
          ' <span class="muted small">' + esc(g.groupId) + ' · seed "' + esc(g.seed) + '" · verified by ' + esc((g.rows[0] && g.rows[0].analyst) || '') + '</span></div>' +
          '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Approve</th><th>Keyword</th><th>Type</th><th>Volume</th><th>Difficulty</th><th>Analyst verdict</th><th>Analyst reason</th></tr></thead><tbody>' +
          rows.map((r) => '<tr><td><input type="checkbox" data-aid="' + esc(r.id) + '"' + (r.verdict === 'Good' ? ' checked' : '') + '></td><td><b>' + esc(r.keyword) + '</b>' + (r.mustUse ? MUST_TAG : '') +
            (r.seoCheck && !/^OK/.test(r.seoCheck) ? '<div class="muted small">SEO: ' + esc(r.seoCheck) + '</div>' : '') + '</td><td>' + esc(r.type) + '</td><td>' + fmtNum(r.sv) + '</td><td>' + KR.kdHtml(r.kd) + '</td>' +
            '<td><span class="tag ' + (r.verdict === 'Good' ? 'ok' : 'bad') + '">' + esc(r.verdict) + '</span></td><td class="small">' + esc(r.analystReason) + '</td></tr>').join('') +
          '</tbody></table></div><div class="row"><input type="text" class="ka-note grow" placeholder="Note (optional)"><button class="btn danger" type="button" data-decide="reject">Reject</button><button class="btn primary" type="button" data-decide="approve">Approve to Research List</button></div></div>';
      }).join('');
    } catch (e) {
      box.innerHTML = '<p class="err">' + esc(e.message) + '</p>';
    }
  }

  // The approver is the signed-in person (the server checks it); only the manager PIN is asked for here.
  async function decide(btn) {
    const g = btn.closest('.group');
    try {
      const pin = $('#kaPin').value;
      if (!pin) throw new Error('Enter the manager PIN.');
      KR.session.set('kr_mgr_pin', pin);
      const approvedIds = $$('input[data-aid]', g).filter((c) => c.checked).map((c) => c.dataset.aid);
      KR.busy(btn, true, 'Saving…');
      const r = await KR.api('keywords', 'decide', { groupId: g.dataset.gid, pin, decision: btn.dataset.decide, note: $('.ka-note', g).value, approvedIds });
      KR.toast(btn.dataset.decide === 'approve'
        ? 'Approved (' + r.action + '): "' + r.primary + '" added to the Research List on ' + r.approvalDate + (r.mustUse && r.mustUse.length ? ', with ' + r.mustUse.length + ' must-use keywords.' : '.')
        : 'Keyword group rejected.', 'ok');
      await loadApprove();
    } catch (e) {
      KR.toast(e.message, 'err');
      KR.busy(btn, false);
    }
  }

  KR.loadResearch = async () => {
    const r = await KR.api('keywords', 'research');
    S.research = r.rows || [];
    return S.research;
  };

  KR.researchTable = (rows, withActions) => {
    if (!rows.length) return '<p class="hint">No approved keywords yet.</p>';
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Report</th><th>Action</th><th>Primary keyword</th><th>Must-use and secondary keywords</th><th>Approved</th><th>Live</th><th>Live date</th><th>Last live check</th>' + (withActions ? '<th></th>' : '') + '</tr></thead><tbody>' +
      rows.map((r, i) => {
        const liveLink = r.liveUrl ? '<div class="small">' + link(r.liveUrl) + '</div>' : '';
        let live;
        if (r.liveStatus === 'Live') live = '<span class="tag ok">Live</span>' + liveLink;
        else if (r.liveStatus === 'Revamp pending') live = '<span class="tag comp">Revamp pending</span>' + liveLink;
        else live = '<span class="tag">' + esc(r.liveStatus || 'Not live') + '</span>';
        return '<tr><td><b>' + esc(r.reportName) + '</b><div class="muted small">' + esc(r.groupId) + '</div></td>' +
          '<td>' + actionHtml(r.action, r.action === 'Revamp' ? '' : r.existingUrl) + '</td>' +
          '<td>' + esc(r.primary) + '<div class="muted small">Vol ' + fmtNum(r.sv) + ' · KD ' + fmtNum(r.kd) + '</div></td>' +
          '<td class="small">' + (r.mustUse ? '<div><b>Must use:</b> ' + esc(r.mustUse) + '</div>' : '<div class="muted">No must-use keywords recorded (approved before they were added)</div>') + (r.secondary ? '<div class="muted">' + esc(r.secondary) + '</div>' : '') + '</td>' +
          '<td class="small">' + esc(r.approvalDate) + '<div class="muted">' + esc(r.approvedBy) + '</div></td>' +
          '<td>' + live + '</td>' +
          '<td class="small">' + esc(r.liveDate) + (r.detectedOn ? '<div class="muted">detected ' + esc(r.detectedOn) + '</div>' : '') + '</td>' +
          '<td class="small">' + esc(r.lastCheck) + '<div class="muted">' + esc(r.checkSummary) + '</div></td>' +
          (withActions ? '<td>' + (r.liveStatus === 'Live' && r.liveUrl ? '<button class="btn tiny" type="button" data-lvcheck="' + i + '">Run live check</button>' : '') + '</td>' : '') + '</tr>';
      }).join('') +
      '</tbody></table></div>';
  };

  async function loadResearchList() {
    const box = $('#klTable');
    box.innerHTML = '<p class="hint">Loading…</p>';
    try { box.innerHTML = KR.researchTable(await KR.loadResearch(), false); }
    catch (e) { box.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; }
  }

  KR.initKeywords = () => {
    S.opp = freshOpp();
    S.kvSugg = null;
    $('#opRun').addEventListener('click', runOpps);
    const opp = $('#opResults');
    opp.addEventListener('input', onOppInput);
    opp.addEventListener('change', onOppChange);
    opp.addEventListener('click', onOppClick);

    $('#kvRefresh').addEventListener('click', loadVerify);
    $('#kvGroup').addEventListener('change', () => { S.kvSugg = null; renderVerify(); });
    $('#kvTable').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'kvAllGood') $$('#kvTable input[value="Good"]').forEach((r) => { r.checked = true; });
      if (b.id === 'kvSubmit') submitVerify(b);
      if (b.id === 'kvMore') moreForGroup(b);
      if (b.id === 'kvAddMore') addMore(b);
    });
    $('#kaRefresh').addEventListener('click', loadApprove);
    $('#kaList').addEventListener('click', (e) => { const b = e.target.closest('button[data-decide]'); if (b) decide(b); });
    $('#klRefresh').addEventListener('click', loadResearchList);
    KR.hooks.sub['kw-opps'] = loadLastScan;
    KR.hooks.sub['kw-verify'] = loadVerify;
    KR.hooks.sub['kw-approve'] = loadApprove;
    KR.hooks.sub['kw-list'] = loadResearchList;
    KR.hooks.tab.keywords = () => {
      const active = $('.subtabs[data-group="kw"] button.active');
      if (active && KR.hooks.sub[active.dataset.sub]) KR.hooks.sub[active.dataset.sub]();
    };
    loadLastScan();
  };
})();
