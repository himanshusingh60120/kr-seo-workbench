'use strict';
/* Shared check UI: issue lists, the web fact-check pipeline, and the page-check runner
   used by Publish Check and Live Tracker. */
(function () {
  const KR = window.KR;
  const { esc } = KR;

  const SEV_ORDER = { error: 0, warning: 1, check: 2 };

  KR.issuesHtml = (issues, emptyMsg) => {
    const list = (issues || []).slice().sort((a, b) => (SEV_ORDER[a.severity] || 9) - (SEV_ORDER[b.severity] || 9));
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

  // ---------- fact check: extract claims, verify on the web in batches ----------
  KR.factCheck = async (content, links, useWeb, step) => {
    const linked = (links || []).map((l) => l.text).filter(Boolean);
    const c = await KR.api('rd', 'claims', { content, linked, max: 12 });
    const claims = c.claims || [];
    if (!claims.length) return { status: 'OK', issues: [], claims: [], suggestions: [], searched: false };
    const verified = {};
    let searched = false;
    let searchError = '';
    if (useWeb) {
      let done = 0;
      const batches = KR.chunk(claims, 3);
      await KR.runLimited(batches.map((batch) => async () => {
        try {
          const r = await KR.api('rd', 'verify', { claims: batch });
          (r.results || []).forEach((x) => { verified[x.id] = x; });
          searched = searched || !!r.searched;
          if (r.searchError) searchError = r.searchError;
        } catch (e) {
          batch.forEach((cl) => { verified[cl.id] = { id: cl.id, verdict: 'Error', note: e.message }; });
        }
        done += batch.length;
        if (step) step.set('Verifying facts… ' + done + '/' + claims.length);
      }), 3);
    }
    const issues = [];
    const suggestions = [];
    const merged = claims.map((cl) => {
      const v = verified[cl.id] || { verdict: useWeb ? 'Error' : 'Not checked' };
      const m = Object.assign({}, cl, v);
      if (v.verdict === 'Contradicted') issues.push({ severity: 'error', section: 'Fact', quote: cl.sentence, problem: 'Contradicted by sources: ' + (v.note || cl.claim), fix: v.correction || 'Correct the statement to match the source.' });
      else if (v.verdict === 'Partially supported') issues.push({ severity: 'warning', section: 'Fact', quote: cl.sentence, problem: 'Partly correct: ' + (v.note || cl.claim), fix: v.correction || 'Correct the detail that differs from the source.' });
      else if (v.verdict === 'Unverifiable') issues.push({ severity: 'check', section: 'Fact', quote: cl.sentence, problem: 'No reliable source found for: ' + cl.claim, fix: 'Add a source link or remove the claim.' });
      if (!cl.hasLink) {
        if (v.sourceUrl) suggestions.push({ anchor: cl.anchorInContent ? cl.anchor : (cl.anchor || ''), url: v.sourceUrl, title: v.sourceTitle || '', claim: cl.claim, reachable: v.reachable, verdict: v.verdict });
        else if (v.verdict !== 'Contradicted') issues.push({ severity: 'check', section: 'Source link', quote: cl.sentence, problem: 'Claim has no source link.', fix: 'Link the organization name to its press release or official page.' });
      }
      return m;
    });
    return { status: issues.length ? 'Issues' : 'OK', issues, claims: merged, suggestions, searched, searchError, webUsed: !!useWeb };
  };

  KR.factsHtml = (facts) => {
    if (!facts) return '';
    if (facts.error) return '<p class="err">' + esc(facts.error) + '</p>';
    let html = '';
    if (facts.webUsed && !facts.searched) html += '<p class="note">Web search was not available' + (facts.searchError ? ' (' + esc(facts.searchError) + ')' : '') + ', so facts were judged from the AI model\'s knowledge only.</p>';
    if (!facts.claims || !facts.claims.length) return html + '<p class="ok-msg">No third-party factual claims found to verify.</p>';
    html += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Claim</th><th>Verdict</th><th>Correction / note</th><th>Source</th></tr></thead><tbody>' +
      facts.claims.map((c) => {
        const cls = c.verdict === 'Supported' ? 'ok' : (c.verdict === 'Contradicted' || c.verdict === 'Error') ? 'bad' : '';
        return '<tr><td>' + esc(c.claim) + (c.hasLink ? ' <span class="tag ok">linked</span>' : '') + '<div class="muted small">' + esc(c.sentence) + '</div></td>' +
          '<td><span class="tag ' + cls + '">' + esc(c.verdict) + '</span></td>' +
          '<td class="small">' + esc(c.correction || '') + (c.correction && c.note ? '<br>' : '') + esc(c.note || '') + '</td>' +
          '<td class="small">' + (c.sourceUrl ? '<a href="' + esc(c.sourceUrl) + '" target="_blank" rel="noopener">' + esc(c.sourceTitle || c.sourceUrl) + '</a>' + (c.reachable === false ? ' <span class="tag bad">not reachable</span>' : '') : '–') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    return html;
  };

  KR.suggestionsHtml = (sugs) => {
    if (!sugs || !sugs.length) return '<p class="hint">No external link suggestions (claims are already linked, or no reliable source was found).</p>';
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Anchor text</th><th>Link to</th><th>Supports the claim</th><th></th></tr></thead><tbody>' +
      sugs.map((s) => '<tr><td><b>' + esc(s.anchor || '(choose the organization name)') + '</b></td>' +
        '<td class="small"><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title || s.url) + '</a><div class="muted">' + esc(s.url) + '</div>' + (s.reachable === false ? '<span class="tag bad">not reachable, find another source</span>' : '') + '</td>' +
        '<td class="small">' + esc(s.claim) + '</td>' +
        '<td><button class="btn tiny" type="button" data-copy="' + esc('<a href="' + s.url + '" target="_blank" rel="noopener noreferrer">' + (s.anchor || '') + '</a>') + '">Copy HTML</button></td></tr>').join('') +
      '</tbody></table></div>';
  };

  // ---------- page check (Publish / Live) ----------
  const CHECKS = [
    ['data', 'Data consistency'], ['facts', 'Facts'], ['faq', 'FAQs'], ['image', 'Image'], ['language', 'Spelling & grammar'],
    ['meta', 'Meta & SEO'], ['links', 'Links'], ['snapshot', 'Report Snapshot'], ['toc', 'Table of Contents']
  ];

  KR.runPageCheck = async (opts) => {
    const prog = KR.progress(opts.progEl);
    const out = KR.$(opts.resultsEl);
    out.innerHTML = '';
    const s = prog.step('Fetching the page, Report Snapshot and Table of Contents…');
    let page;
    try {
      page = await KR.api('pagecheck', 'extract', { url: opts.url });
    } catch (e) {
      s.fail('Could not read the page: ' + e.message);
      throw e;
    }
    s.done('Fetched "' + (page.h1 || page.meta.title || page.finalUrl) + '": ' + page.faqs.length + ' FAQs, ' + page.images.length + ' images, ' + page.links.length + ' links' +
      (page.snapshot.text ? '' : ' · Snapshot not read') + (page.toc.text ? '' : ' · TOC not read'));
    const results = {};
    const tasks = CHECKS.map((pair) => async () => {
      const kind = pair[0];
      const label = pair[1];
      const st = prog.step('Checking ' + label + '…');
      try {
        if (kind === 'facts') results.facts = await KR.factCheck(page.descriptionText, page.links, opts.web, st);
        else results[kind] = await KR.api('pagecheck', 'check', { kind, page });
        st.done(label + ': ' + (results[kind].issues || []).length + ' issue(s)');
      } catch (e) {
        results[kind] = { status: 'Error', issues: [], error: e.message };
        st.fail(label + ': ' + e.message);
      }
    });
    await KR.runLimited(tasks, 4);
    KR.renderCheckResults(out, page, results, opts.mode);
    const sv = prog.step('Saving to the Google Sheet…');
    try {
      const r = await KR.api('pagecheck', 'save', { mode: opts.mode, url: page.finalUrl || opts.url, requestedUrl: opts.url, reportName: page.h1, user: KR.userName(), results });
      sv.done('Saved to the "' + r.sheet + '" sheet · ' + r.status);
    } catch (e) {
      sv.fail('Not saved to the sheet: ' + e.message);
    }
    return { page, results };
  };

  KR.renderCheckResults = (box, page, results, mode) => {
    const all = [];
    CHECKS.forEach((p) => { (results[p[0]] && results[p[0]].issues || []).forEach((x) => all.push(x)); });
    const c = KR.countSev(all);
    const status = c.error ? ['fix', 'Fix required'] : c.warning ? ['review', 'Review'] : ['pass', 'Pass'];
    let html = '<div class="card"><h2>' + esc(page.h1 || 'Page check') + ' <span class="status-pill ' + status[0] + '">' + status[1] + '</span></h2>' +
      '<p class="small muted"><a href="' + esc(page.finalUrl) + '" target="_blank" rel="noopener">' + esc(page.finalUrl) + '</a>' +
      (page.snapshot.url ? ' · <a href="' + esc(page.snapshot.url) + '" target="_blank" rel="noopener">Snapshot</a>' : '') +
      (page.toc.url ? ' · <a href="' + esc(page.toc.url) + '" target="_blank" rel="noopener">TOC</a>' : '') + ' · ' + (mode === 'live' ? 'Live check' : 'Publish check') + '</p>' +
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
      const cs = KR.countSev(r.issues);
      const badge = r.error ? '<span class="tag bad">error</span>' : (r.issues && r.issues.length ? '<span class="tag' + (cs.error ? ' bad' : '') + '">' + r.issues.length + ' issue(s)</span>' : '<span class="tag ok">OK</span>');
      let body = r.error ? '<p class="err">' + esc(r.error) + '</p>' : KR.issuesHtml(r.issues);
      if (p[0] === 'facts' && !r.error) body = KR.issuesHtml(r.issues) + '<h3>Claims checked</h3>' + KR.factsHtml(r) + '<h3>External link suggestions</h3>' + KR.suggestionsHtml(r.suggestions);
      if (p[0] === 'image' && r.images && r.images.length) body += r.images.map((im) => '<h3>Text read from the image</h3><p class="small"><a href="' + esc(im.src) + '" target="_blank" rel="noopener">' + esc(im.src) + '</a> · alt: "' + esc(im.alt) + '"</p><div class="quote">' + esc(im.text) + '</div>').join('');
      html += '<details class="cat"' + (cs.error || r.error ? ' open' : '') + '><summary><span class="grow">' + esc(p[1]) + '</span>' + badge + '</summary><div class="cat-body">' + body + '</div></details>';
    });
    html += '</div>';
    box.innerHTML = html;
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (b) KR.copy(b.getAttribute('data-copy'), b);
  });
})();
