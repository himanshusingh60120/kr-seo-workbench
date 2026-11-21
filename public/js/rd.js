'use strict';
/* RD tab: paste the written RD, check secondary-keyword coverage, data consistency, language and structure,
   verify facts on the web, and get external link suggestions with anchor texts. */
(function () {
  const KR = window.KR;
  const { $, $$, esc } = KR;
  const S = KR.state;
  const B = KR.blocks;

  async function loadResearchOptions() {
    try {
      const rows = await KR.loadResearch();
      const sel = $('#rdReport');
      const cur = sel.value;
      sel.innerHTML = '<option value="">Select an approved report</option>' + rows.map((r, i) => '<option value="' + i + '">' + esc(r.reportName) + ' · ' + esc(r.primary) + '</option>').join('');
      if (cur && rows[Number(cur)]) sel.value = cur;
    } catch (e) {
      /* Sheets may not be configured yet; the fields can still be typed by hand. */
    }
  }

  function onReportPick() {
    const r = (S.research || [])[Number($('#rdReport').value)];
    if (!r || $('#rdReport').value === '') return;
    $('#rdName').value = r.reportName || '';
    $('#rdPrimary').value = r.primary || '';
    $('#rdSecondary').value = String(r.secondary || '').split(/\s*,\s*/).filter(Boolean).join('\n');
  }

  async function runRd() {
    const btn = $('#rdRun');
    const prog = KR.progress('#rdProgress');
    const out = $('#rdResults');
    try {
      const blocks = B.extractBlocks($('#rdContent'));
      const content = B.blocksToText(blocks);
      if (content.length < 300) throw new Error('Paste the full RD content first.');
      const links = $$('#rdContent a[href]').map((a) => ({ text: B.textOf(a), href: a.getAttribute('href') || '' })).filter((l) => /^https?:\/\//i.test(l.href));
      const primary = $('#rdPrimary').value.trim();
      const secondaries = $('#rdSecondary').value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      const reportName = $('#rdName').value.trim() || primary;
      if (!primary) KR.toast('No primary keyword given: keyword coverage will only cover secondary keywords.');
      KR.busy(btn, true, 'Verifying…');
      $('#rdSave').disabled = true;
      out.innerHTML = '';
      const res = S.rd = { reportName, primary, secondaries, content, links, words: B.wordCount(content), review: null, facts: null, linkStatus: null };
      await Promise.all([
        (async () => {
          const s = prog.step('Keyword coverage, data consistency, grammar and structure…');
          try {
            res.review = await KR.api('rd', 'review', { content, primary, secondaries, reportName });
            s.done('Review complete' + (res.review.aiError ? ' (AI part failed: ' + res.review.aiError + ')' : ''));
          } catch (e) { s.fail('Review failed: ' + e.message); }
        })(),
        (async () => {
          const s = prog.step('Extracting and verifying facts…');
          try {
            res.facts = await KR.factCheck(content, links, $('#rdWeb').checked, s);
            s.done('Facts: ' + res.facts.claims.length + ' claims checked');
          } catch (e) {
            res.facts = { status: 'Error', issues: [], claims: [], suggestions: [], error: e.message };
            s.fail('Fact check failed: ' + e.message);
          }
        })(),
        (async () => {
          if (!links.length) return;
          const s = prog.step('Checking ' + links.length + ' existing links…');
          try {
            const r = await KR.api('rd', 'links', { urls: links.map((l) => l.href) });
            res.linkStatus = r.results || [];
            s.done('Existing links checked');
          } catch (e) { s.fail('Link check failed: ' + e.message); }
        })()
      ]);
      renderRd();
      $('#rdSave').disabled = false;
    } catch (e) {
      prog.error(e.message);
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  function card(title, body) { return '<div class="card"><h2>' + esc(title) + '</h2>' + body + '</div>'; }

  function renderRd() {
    const r = S.rd;
    const rv = r.review || {};
    let html = '';
    const cov = rv.coverage;
    if (cov) {
      html += card('Keyword coverage', '<p class="lead">' + cov.words.toLocaleString('en-US') + ' words · ' + cov.found + ' of ' + cov.rows.length + ' keywords used</p>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Keyword</th><th>Type</th><th>Times used</th><th>Status</th><th>Suggestion</th></tr></thead><tbody>' +
        cov.rows.map((k) => {
          const tip = (rv.keywordTips || []).find((t) => t.keyword.toLowerCase() === k.keyword.toLowerCase());
          return '<tr><td><b>' + esc(k.keyword) + '</b></td><td>' + esc(k.type) + '</td><td>' + k.count + (k.density !== null && k.density !== undefined ? ' <span class="muted small">(' + k.density + '% density)</span>' : '') + '</td>' +
            '<td>' + (k.count ? '<span class="tag ok">included</span>' : '<span class="tag bad">missing</span>') + '</td><td class="small">' + esc(tip ? tip.suggestion : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>');
    }
    if (r.review) {
      html += card('Data consistency', KR.issuesHtml(rv.consistency, 'No data inconsistencies found.'));
      html += card('Language and style', KR.issuesHtml(rv.language, 'No language issues found.'));
      html += card('Structure', KR.issuesHtml(rv.structure, 'All standard sections are present.'));
    }
    if (r.facts) {
      html += card('Fact verification', (r.facts.error ? '<p class="err">' + esc(r.facts.error) + '</p>' : KR.issuesHtml(r.facts.issues, 'All checked facts are supported.') + '<h3>Claims checked</h3>' + KR.factsHtml(r.facts)));
      html += card('External link suggestions', '<p class="lead">Sources found while verifying claims that have no link yet. Put the link on the anchor text shown.</p>' + KR.suggestionsHtml(r.facts.suggestions));
    }
    if (r.linkStatus && r.linkStatus.length) {
      html += card('Existing links', '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Anchor</th><th>URL</th><th>Status</th></tr></thead><tbody>' +
        r.linkStatus.map((s) => {
          const l = r.links.find((x) => x.href === s.url) || {};
          const st = s.competitor ? '<span class="tag bad">competitor site</span>' : s.ok ? '<span class="tag ok">' + s.status + '</span>' : '<span class="tag bad">' + esc(s.status || s.error || 'failed') + '</span>';
          return '<tr><td>' + esc(l.text || '') + '</td><td class="small"><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.url) + '</a></td><td>' + st + '</td></tr>';
        }).join('') + '</tbody></table></div>');
    }
    $('#rdResults').innerHTML = html;
  }

  function lines(list) {
    return (list || []).map((x, i) => (i + 1) + '. [' + x.severity + '] ' + (x.section ? x.section + ': ' : '') + x.problem + (x.fix ? ' -> ' + x.fix : '') + (x.quote ? ' | "' + x.quote + '"' : '')).join('\n') || 'OK';
  }

  async function saveRd() {
    const btn = $('#rdSave');
    try {
      const user = KR.requireUser();
      const r = S.rd;
      if (!r) throw new Error('Run "Verify content" first.');
      const rv = r.review || {};
      const cov = rv.coverage || { rows: [] };
      const f = r.facts || { issues: [], claims: [], suggestions: [] };
      const issueCount = (rv.consistency || []).length + (rv.language || []).length + (rv.structure || []).length + (f.issues || []).length;
      KR.busy(btn, true, 'Saving…');
      await KR.api('rd', 'save', {
        user,
        reportName: r.reportName,
        primary: r.primary,
        words: r.words,
        found: cov.rows.filter((k) => k.count > 0).map((k) => k.keyword + ' (' + k.count + ')').join(', '),
        missing: cov.rows.filter((k) => k.count === 0).map((k) => k.keyword).join(', '),
        consistency: lines(rv.consistency),
        language: lines(rv.language),
        structure: lines(rv.structure),
        facts: (f.claims || []).map((c) => '[' + c.verdict + '] ' + c.claim + (c.correction ? ' -> ' + c.correction : '') + (c.sourceUrl ? ' (' + c.sourceUrl + ')' : '')).join('\n') || 'No claims',
        suggestions: (f.suggestions || []).map((s) => (s.anchor || '(anchor)') + ' -> ' + s.url).join('\n'),
        issueCount
      });
      KR.toast('Saved to the RD sheet.', 'ok');
    } catch (e) {
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  KR.initRd = () => {
    B.setupPaste($('#rdContent'), 'rdStats');
    $('#rdClear').addEventListener('click', () => B.clearPaste($('#rdContent')));
    $('#rdReport').addEventListener('change', onReportPick);
    $('#rdRun').addEventListener('click', runRd);
    $('#rdSave').addEventListener('click', saveRd);
    KR.hooks.tab.rd = loadResearchOptions;
  };
})();
