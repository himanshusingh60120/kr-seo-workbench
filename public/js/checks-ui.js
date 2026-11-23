'use strict';
/* Shared check UI: issue lists, the fact-check pipeline (earlier verdicts are reused, new ones are checked,
   and a "Deep check" button re-checks one claim with OpenAI web search), and the page-check runner used by
   Publish Check (preview pages: no Report Snapshot / Table of Contents) and Live Tracker (live pages: everything).
   Publish and Live checks also check the report's primary and must-use keywords from the Research List
   (shown and saved under "Meta & SEO"). */
(function () {
  const KR = window.KR;
  const { esc } = KR;

  const SEV_ORDER = { error: 0, warning: 1, check: 2 };
  function sevRank(x) { return SEV_ORDER[x.severity] !== undefined ? SEV_ORDER[x.severity] : 9; }

  KR.issuesHtml = (issues, emptyMsg) => {
    const list = (issues || []).slice().sort((a, b) => sevRank(a) - sevRank(b));
    if (!list.length) return '<p class="ok-msg">' + esc(emptyMsg || 'No issues found.') + '</p>';
    return list.map((x) => '<div class="issue"><span class="sev ' + esc(x.severity) + '">' + esc(x.severity) + '</span>' +
      (x.section ? '<span class="sec">' + esc(x.section) + '</span>' : '') +
      '<div>' + esc(x.problem) + '</div>' +
      (x.quote ? '<div class="quote">' + esc(x.quote) + '</div>' : '') +
      (x.fix ? '<div class="fix">Fix: ' + esc(x.fix) + '</div>' : '') + '</div>').join('');
  };

  KR.countSev = (issues) => {
    const c = { error: 0, warning: 0, check: 0 };
    (issues || []).forEach((x) => { if (c[x.severity] !== undefined) c[x.severity]++; });
    return c;
  };

  // ---------- fact check ----------
  // Builds the issue list and the external link suggestions from the claim verdicts (also after a Deep check).
  KR.factIssues = (facts) => {
    const issues = [];
    const suggestions = [];
    (facts.claims || []).forEach((c) => {
      // "lite" (web search + Jev) and "link" (the sentence's own link + Jev) cannot write a correction,
      // so a contradiction from them is a warning until a Deep check confirms it.
      const light = c.engine === 'lite' || c.engine === 'link';
      if (c.verdict === 'Contradicted') {
        issues.push({
          severity: light ? 'warning' : 'error', section: 'Fact', quote: c.sentence,
          problem: (c.engine === 'link' ? 'The page this sentence links to reports it differently. ' : light ? 'A source found on the web reports this differently. ' : 'Contradicted by sources: ') + (c.note || c.claim),
          fix: c.correction || (light ? 'Open the source and correct the statement, or click "Deep check" for a suggested correction.' : 'Correct the statement to match the source.')
        });
      } else if (c.verdict === 'Partially supported') {
        issues.push({ severity: 'warning', section: 'Fact', quote: c.sentence, problem: 'Partly correct: ' + (c.note || c.claim), fix: c.correction || 'Correct the detail that differs from the source.' });
      } else if (c.verdict === 'Unverifiable') {
        issues.push({ severity: 'check', section: 'Fact', quote: c.sentence, problem: 'No reliable source found for: ' + c.claim, fix: c.hasLink ? 'Open the existing link and confirm it supports the sentence.' : 'Add a source link or remove the claim.' });
      } else if (c.verdict === 'Check manually') {
        issues.push({ severity: 'check', section: 'Fact', quote: c.sentence, problem: 'Could not be confirmed automatically: ' + c.claim + (c.note ? ' (' + c.note + ')' : ''), fix: (c.sourceUrl ? 'Open the source shown in the claims table and confirm it' : 'Find a source and confirm it') + ', or click "Deep check".' });
      }
      if (!c.hasLink && c.sourceUrl && (c.verdict === 'Supported' || c.verdict === 'Partially supported')) {
        suggestions.push({ anchor: c.anchor || '', url: c.sourceUrl, title: c.sourceTitle || '', claim: c.claim, reachable: c.reachable, verdict: c.verdict });
      } else if (!c.hasLink && c.verdict === 'Supported') {
        issues.push({ severity: 'check', section: 'Source link', quote: c.sentence, problem: 'Claim has no source link.', fix: 'Link the organization name to its press release or official page.' });
      }
    });
    facts.issues = issues;
    facts.suggestions = suggestions;
    facts.status = issues.length ? 'Issues' : 'OK';
    return facts;
  };

  function slim(c) { return { id: c.id, key: c.key, sentence: c.sentence, claim: c.claim, anchor: c.anchor, date: c.date, linkUrl: c.linkUrl || '' }; }

  // Finds the facts, reuses verdicts saved by earlier checks (no cost), and verifies only the new ones.
  KR.factCheck = async (content, links, useWeb, step, reportName) => {
    const hrefs = (links || []).filter((l) => l && l.text && l.href).map((l) => ({ text: l.text, href: l.href }));
    const c = await KR.api('rd', 'claims', { content, links: hrefs, max: 12 });
    const claims = c.claims || [];
    const info = c.info || {};
    if (!claims.length) return { status: 'OK', issues: [], claims: [], suggestions: [], searched: false, webUsed: !!useWeb, info, reused: 0, reportName: reportName || '' };
    const verified = {};
    claims.forEach((cl) => {
      if (cl.cached) verified[cl.id] = Object.assign({ id: cl.id, fromCache: true, searched: true, reachable: null }, cl.cached);
    });
    const todo = claims.filter((cl) => !cl.cached);
    const reused = claims.length - todo.length;
    let searched = reused > 0;
    let searchError = '';
    if (useWeb && todo.length) {
      let done = 0;
      const batches = KR.chunk(todo, 3);
      await KR.runLimited(batches.map((batch) => async () => {
        try {
          const r = await KR.api('rd', 'verify', { claims: batch.map(slim), reportName: reportName || '' });
          (r.results || []).forEach((x) => { verified[x.id] = x; });
          searched = searched || !!r.searched;
          if (r.searchError) searchError = r.searchError;
        } catch (e) {
          batch.forEach((cl) => { verified[cl.id] = { id: cl.id, verdict: 'Error', note: e.message }; });
        }
        done += batch.length;
        if (step) step.set('Verifying facts… ' + done + '/' + todo.length + (reused ? ' (' + reused + ' reused from earlier checks)' : ''));
      }), 3);
    }
    const merged = claims.map((cl) => {
      const m = Object.assign({}, cl, verified[cl.id] || { verdict: useWeb ? 'Error' : 'Not checked' });
      delete m.cached;
      return m;
    });
    return KR.factIssues({ claims: merged, searched, searchError, webUsed: !!useWeb, info, reused, reportName: reportName || '' });
  };

  function reachTag(r) {
    return r === false ? ' <span class="tag bad">not reachable</span>' : '';
  }

  // Each rendered fact list is registered here so the "Deep check" button can find its claim.
  KR._facts = {};
  let factSeq = 0;
  function register(facts) {
    if (!facts._key || KR._facts[facts._key] !== facts) facts._key = 'f' + (++factSeq) + '-' + Date.now().toString(36);
    KR._facts[facts._key] = facts;
    return facts._key;
  }

  function pct(n) { return typeof n === 'number' ? ' <span class="muted small">' + Math.round(n * 100) + '%</span>' : ''; }

  function verdictCell(c) {
    const cls = c.verdict === 'Supported' ? 'ok' : (c.verdict === 'Contradicted' || c.verdict === 'Error') ? 'bad' : '';
    let h = '<span class="tag ' + cls + '">' + esc(c.verdict) + '</span>' + pct(c.confidence);
    if (c.fromCache) h += '<div class="muted small">reused' + (c.checkedAt ? ', checked ' + esc(String(c.checkedAt).slice(0, 10)) : '') + '</div>';
    if (c.lite) h += '<div class="muted small">Lite engine: ' + esc(c.lite.verdict) + pct(c.lite.confidence) + '</div>';
    return h;
  }

  function deepButton(c, key) {
    const fresh = c.engine === 'deep' && !c.fromCache && c.verdict !== 'Error';
    if (fresh) return '';
    return '<button class="btn tiny" type="button" data-deep="' + esc(c.id) + '" data-fkey="' + esc(key) + '" title="Checks this one claim again with OpenAI web search (about 1 to 3 cents)">' +
      (c.engine === 'deep' ? 'Re-check' : 'Deep check') + '</button>';
  }

  KR.factsHtml = (facts) => {
    if (!facts) return '';
    if (facts.error) return '<p class="err">' + esc(facts.error) + '</p>';
    const key = register(facts);
    const info = facts.info || {};
    let html = '';
    if (facts.webUsed && !facts.searched) html += '<p class="note">No source could be looked up in this run' + (facts.searchError ? ' (' + esc(facts.searchError) + ')' : '') + '. The note beside each claim says why.</p>';
    if (info.triageError) html += '<p class="note">Jev could not pick the facts (' + esc(info.triageError) + '), so the OpenAI model did it for this run.</p>';
    if (info.cacheError) html += '<p class="note">The "Fact Cache" sheet could not be read (' + esc(info.cacheError) + '), so no earlier verdicts were reused.</p>';
    if (!facts.claims || !facts.claims.length) return html + '<p class="ok-msg">No third-party factual claims found to verify.</p>';
    if (facts.reused) html += '<p class="hint">' + facts.reused + ' of ' + facts.claims.length + ' claims were checked earlier, so their saved verdicts are shown at no cost.</p>';
    html += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Claim</th><th>Verdict</th><th>Correction / note</th><th>Source</th><th></th></tr></thead><tbody>' +
      facts.claims.map((c) => '<tr><td>' + esc(c.claim) + (c.hasLink ? ' <span class="tag ok">linked</span>' : '') + '<div class="muted small">' + esc(c.sentence) + '</div></td>' +
        '<td>' + verdictCell(c) + '</td>' +
        '<td class="small">' + esc(c.correction || '') + (c.correction && c.note ? '<br>' : '') + esc(c.note || '') + '</td>' +
        '<td class="small">' + (c.sourceUrl ? '<a href="' + esc(c.sourceUrl) + '" target="_blank" rel="noopener">' + esc(c.sourceTitle || c.sourceUrl) + '</a>' + reachTag(c.reachable) : '–') + '</td>' +
        '<td>' + deepButton(c, key) + '</td></tr>').join('') + '</tbody></table></div>';
    return html;
  };

  KR.suggestionsHtml = (sugs) => {
    if (!sugs || !sugs.length) return '<p class="hint">No external link suggestions (claims are already linked, or no matching reliable source was found).</p>';
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Anchor text</th><th>Link to</th><th>Supports the claim</th><th></th></tr></thead><tbody>' +
      sugs.map((s) => '<tr><td><b>' + esc(s.anchor || '(choose the organization name)') + '</b></td>' +
        '<td class="small"><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title || s.url) + '</a><div class="muted">' + esc(s.url) + '</div>' + (s.reachable === false ? '<span class="tag bad">not reachable, find another source</span>' : '') + '</td>' +
        '<td class="small">' + esc(s.claim) + '</td>' +
        '<td><button class="btn tiny" type="button" data-copy="' + esc('<a href="' + s.url + '" target="_blank" rel="noopener noreferrer">' + (s.anchor || '') + '</a>') + '">Copy HTML</button></td></tr>').join('') +
      '</tbody></table></div>';
  };

  // Issues, the claims table and the link suggestions in one block that a Deep check can refresh in place.
  KR.factsInner = (facts) => {
    if (!facts.claims || !facts.claims.length) return KR.factsHtml(facts);
    return KR.issuesHtml(facts.issues, 'All checked facts are supported.') +
      '<h3>Claims checked</h3>' + KR.factsHtml(facts) +
      '<h3>External link suggestions</h3>' + KR.suggestionsHtml(facts.suggestions);
  };

  KR.factsBlock = (facts) => {
    if (!facts) return '';
    if (facts.error) return '<p class="err">' + esc(facts.error) + '</p>';
    return '<div data-factsblock="1">' + KR.factsInner(facts) + '</div>';
  };

  async function deepCheck(btn) {
    const facts = KR._facts[btn.getAttribute('data-fkey')];
    const c = facts && (facts.claims || []).find((x) => String(x.id) === btn.getAttribute('data-deep'));
    if (!c) { KR.toast('This result is no longer on the page. Run the check again.', 'err'); return; }
    KR.busy(btn, true, 'Checking…');
    try {
      const r = await KR.api('rd', 'verify', { engine: 'deep', claims: [slim(c)], reportName: facts.reportName || '' });
      const v = (r.results || [])[0];
      if (!v) throw new Error('No result came back.');
      delete c.lite;
      Object.assign(c, { correction: '', sourceUrl: '', sourceTitle: '', note: '', reachable: null, confidence: null }, v, { fromCache: false, checkedAt: '' });
      KR.factIssues(facts);
      const box = btn.closest('[data-factsblock]');
      if (box) box.innerHTML = KR.factsInner(facts);
      KR.toast('Deep check: ' + c.verdict + '.', c.verdict === 'Supported' ? 'ok' : '');
    } catch (e) {
      KR.busy(btn, false);
      KR.toast(e.message, 'err');
    }
  }

  // ---------- report keywords on the page (Publish / Live) ----------
  // The report is found in the Research List by its URL, or else by its name (the H1). Its primary keyword and
  // every must-use keyword must appear on the page; a missing one is an error.
  function urlKey(u) {
    return String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/(preview\/)?(report|snapshot|toc)\//, '/').replace(/\/+$/, '');
  }
  function nameKey(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(market|markets|industry)\b/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function reEscape(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // Case-insensitive, flexible spaces/hyphens, "and" = "&", singular/plural of the last word (as in the RD tab).
  function kwRe(kw) {
    const words = String(kw || '').toLowerCase().replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!words.length) return null;
    const pat = words.map((w, i) => {
      if (w === 'and' || w === '&') return '(?:and|&)';
      if (i === words.length - 1) {
        const base = /s$/.test(w) && w.length > 3 ? w.slice(0, -1) : w;
        return reEscape(base) + '(?:s|es)?';
      }
      return reEscape(w);
    }).join('[\\s\\u00a0-]+');
    return new RegExp('(?<![A-Za-z0-9])' + pat + '(?![A-Za-z0-9])', 'i');
  }

  async function keywordCheck(page, opts, results, prog) {
    const st = prog.step('Checking the report keywords from the Research List…');
    let rows = [];
    try {
      rows = await KR.loadResearch();
    } catch (e) {
      st.fail('Report keywords not checked: the Research List could not be read (' + e.message + ').');
      return;
    }
    const keys = [urlKey(page.finalUrl), urlKey(opts.url)].filter(Boolean);
    const nk = nameKey(page.h1);
    const hit = rows.find((r) => [r.liveUrl, r.existingUrl].some((u) => u && keys.indexOf(urlKey(u)) >= 0)) ||
      (nk ? rows.find((r) => nameKey(r.reportName) === nk || nameKey(r.primary) === nk) : null);
    if (!hit) { st.done('Report keywords: this page is not in the Research List, so there are no keywords to check.'); return; }
    const text = [page.h1, page.meta && page.meta.title, page.descriptionText].concat((page.faqs || []).map((f) => f.q + ' ' + f.a)).join('\n');
    const must = String(hit.mustUse || '').split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
    const missing = (kw) => { const re = kwRe(kw); return !!re && !re.test(text); };
    const issues = [];
    if (hit.primary && missing(hit.primary)) {
      issues.push({ severity: 'error', section: 'Keywords', quote: '', problem: 'The primary keyword "' + hit.primary + '" is not on the page.', fix: 'Use it in the H1, the Overview heading and the first paragraph.' });
    }
    must.forEach((kw) => {
      if (missing(kw)) issues.push({ severity: 'error', section: 'Keywords', quote: '', problem: 'Must-use keyword "' + kw + '" is not on the page.', fix: 'Add "' + kw + '" naturally to the description.' });
    });
    const target = results.meta || (results.meta = { status: 'OK', issues: [] });
    target.issues = (target.issues || []).concat(issues);
    if (issues.length && target.status !== 'Error') target.status = 'Issues';
    target.keywords = { report: hit.reportName, primary: hit.primary, mustUse: must };
    st.done('Report keywords ("' + hit.reportName + '"): ' + (issues.length ? issues.length + ' missing' : 'primary and ' + must.length + ' must-use keyword(s) all on the page') + (must.length ? '' : ' · no must-use keywords recorded for this report'));
  }

  // ---------- page check (Publish / Live) ----------
  const CHECKS = [
    ['data', 'Data consistency'], ['facts', 'Facts'], ['faq', 'FAQs'], ['image', 'Image'], ['language', 'Spelling & grammar'],
    ['meta', 'Meta, SEO & keywords'], ['links', 'Links'], ['snapshot', 'Report Snapshot'], ['toc', 'Table of Contents']
  ];
  const LIVE_ONLY = ['snapshot', 'toc'];

  KR.runPageCheck = async (opts) => {
    if (KR.me && KR.me.checker === false) throw new Error('Checks are run by the check team only. Open "Check results" to read their findings.');
    const prog = KR.progress(opts.progEl);
    const out = KR.$(opts.resultsEl);
    out.innerHTML = '';
    const live = opts.mode === 'live';
    const s = prog.step(live ? 'Fetching the page, Report Snapshot and Table of Contents…' : 'Fetching the preview page…');
    let page;
    try {
      page = await KR.api('pagecheck', 'extract', { url: opts.url });
    } catch (e) {
      s.fail('Could not read the page: ' + e.message);
      throw e;
    }
    s.done('Fetched "' + (page.h1 || page.meta.title || page.finalUrl) + '": ' + page.faqs.length + ' FAQs, ' + page.images.length + ' images, ' + page.links.length + ' links' +
      (live ? (page.snapshot.text ? '' : ' · Snapshot not read') + (page.toc.text ? '' : ' · TOC not read') : ''));
    const results = {};
    const kinds = CHECKS.filter((p) => live || LIVE_ONLY.indexOf(p[0]) < 0);
    if (!live) LIVE_ONLY.forEach((k) => { results[k] = { status: 'Skipped', issues: [], note: 'Checked in Live Tracker once the report is live' }; });
    const tasks = kinds.map((pair) => async () => {
      const kind = pair[0];
      const label = pair[1];
      const st = prog.step('Checking ' + label + '…');
      try {
        if (kind === 'facts') results.facts = await KR.factCheck(page.descriptionText, page.links, opts.web, st, page.h1);
        else results[kind] = await KR.api('pagecheck', 'check', { kind, page });
        st.done(label + ': ' + (results[kind].issues || []).length + ' issue(s)' + (kind === 'facts' && results.facts.reused ? ' · ' + results.facts.reused + ' claim(s) reused' : ''));
      } catch (e) {
        results[kind] = { status: 'Error', issues: [], error: e.message };
        st.fail(label + ': ' + e.message);
      }
    });
    await KR.runLimited(tasks, 4);
    await keywordCheck(page, opts, results, prog);
    KR.renderCheckResults(out, page, results, opts.mode);
    const sv = prog.step('Saving to the Google Sheet…');
    try {
      const r = await KR.api('pagecheck', 'save', { mode: opts.mode, url: page.finalUrl || opts.url, requestedUrl: opts.url, reportName: page.h1, user: KR.userName(), results });
      sv.done('Saved to the "' + r.sheet + '" sheet · ' + r.status + ' · visible to everyone in "Check results"');
    } catch (e) {
      sv.fail('Not saved to the sheet: ' + e.message);
    }
    return { page, results };
  };

  KR.renderCheckResults = (box, page, results, mode) => {
    const live = mode === 'live';
    const all = [];
    CHECKS.forEach((p) => { (results[p[0]] && results[p[0]].issues || []).forEach((x) => all.push(x)); });
    const c = KR.countSev(all);
    const status = c.error ? ['fix', 'Fix required'] : c.warning ? ['review', 'Review'] : ['pass', 'Pass'];
    let html = '<div class="card"><h2>' + esc(page.h1 || 'Page check') + ' <span class="status-pill ' + status[0] + '">' + status[1] + '</span></h2>' +
      '<p class="small muted"><a href="' + esc(page.finalUrl) + '" target="_blank" rel="noopener">' + esc(page.finalUrl) + '</a>' +
      (live && page.snapshot.url ? ' · <a href="' + esc(page.snapshot.url) + '" target="_blank" rel="noopener">Snapshot</a>' : '') +
      (live && page.toc.url ? ' · <a href="' + esc(page.toc.url) + '" target="_blank" rel="noopener">TOC</a>' : '') + ' · ' + (live ? 'Live check' : 'Publish check') + '</p>' +
      '<div class="summary">' +
      '<div class="cell"><div class="num ' + (c.error ? 'bad' : 'good') + '">' + c.error + '</div><div class="lbl">Errors</div></div>' +
      '<div class="cell"><div class="num">' + c.warning + '</div><div class="lbl">Warnings</div></div>' +
      '<div class="cell"><div class="num">' + c.check + '</div><div class="lbl">To be checked</div></div>' +
      '<div class="cell"><div class="num">' + (page.meta.title || '').length + '</div><div class="lbl">Meta title chars</div></div>' +
      '<div class="cell"><div class="num">' + (page.meta.description || '').length + '</div><div class="lbl">Meta description chars</div></div>' +
      '</div>' +
      '<p class="small"><b>Meta title:</b> ' + esc(page.meta.title || '–') + '<br><b>Meta description:</b> ' + esc(page.meta.description || '–') + '</p>';
    CHECKS.forEach((p) => {
      const r = results[p[0]] || {};
      if (r.status === 'Skipped') {
        html += '<details class="cat"><summary><span class="grow">' + esc(p[1]) + '</span><span class="tag">Live Tracker</span></summary><div class="cat-body"><p class="hint">' + esc(r.note || 'Not checked here.') + '</p></div></details>';
        return;
      }
      const cs = KR.countSev(r.issues);
      const badge = r.error ? '<span class="tag bad">error</span>' : (r.issues && r.issues.length ? '<span class="tag' + (cs.error ? ' bad' : '') + '">' + r.issues.length + ' issue(s)</span>' : '<span class="tag ok">OK</span>');
      let body = r.error ? '<p class="err">' + esc(r.error) + '</p>' + (r.issues && r.issues.length ? KR.issuesHtml(r.issues) : '') : KR.issuesHtml(r.issues);
      if (p[0] === 'facts' && !r.error) body = KR.factsBlock(r);
      if (p[0] === 'meta' && r.keywords) {
        body = '<p class="hint">Keywords checked against the Research List entry "' + esc(r.keywords.report) + '": primary "' + esc(r.keywords.primary) + '"' +
          (r.keywords.mustUse.length ? ' and must-use ' + r.keywords.mustUse.map((k) => '"' + esc(k) + '"').join(', ') : ' (no must-use keywords recorded)') + '.</p>' + body;
      }
      if (p[0] === 'image' && r.images && r.images.length) body += r.images.map((im) => '<h3>Text read from the image</h3><p class="small"><a href="' + esc(im.src) + '" target="_blank" rel="noopener">' + esc(im.src) + '</a> · alt: "' + esc(im.alt) + '"</p><div class="quote">' + esc(im.text) + '</div>').join('');
      html += '<details class="cat"' + (cs.error || r.error ? ' open' : '') + '><summary><span class="grow">' + esc(p[1]) + '</span>' + badge + '</summary><div class="cat-body">' + body + '</div></details>';
    });
    html += '</div>';
    box.innerHTML = html;
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (b) { KR.copy(b.getAttribute('data-copy'), b); return; }
    const d = e.target.closest('[data-deep]');
    if (d && !d.disabled) deepCheck(d);
  });
})();
