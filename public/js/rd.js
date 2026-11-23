'use strict';
/* RD tab: the analyst pastes the RD and sees every use of the primary, must-use and secondary keywords highlighted in
   colour, with a count per keyword. A missing primary or must-use keyword is reported as an error. Data consistency,
   language, structure and fact checks run alongside, and the text of every problem found is shaded faint red in the
   same view (click an issue to jump to it). Every finished check is saved to the RD sheet automatically, so the whole
   team can read it in "Check results". Only the check team can run checks.
   If nothing has changed since the last check, the saved results are shown instead of paying for the AI again. */
(function () {
  const KR = window.KR;
  const { $, $$, esc } = KR;
  const S = KR.state;
  const B = KR.blocks;

  const PRIMARY_COLOR = { bg: '#2B71E2', fg: '#FFFFFF' };
  const PALETTE = ['#FFE08A', '#B9F0C9', '#FFC9DE', '#C9E4FF', '#E2D4FF', '#FFD8B5', '#C8F2F0', '#F5F0A8', '#FFCACA', '#D6E8B8',
    '#F2D0F5', '#CFE0E8', '#FFE3C2', '#D9F2C4', '#E8D9C9'];
  // Problem text: faint red with a red underline, so it cannot be mistaken for a keyword colour.
  const ISSUE_STYLE = 'background:#FFE3E3;box-shadow:inset 0 -2px 0 #E5484D;border-radius:2px';

  function lines2list(v) { return String(v || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean); }

  // ---------- Research List ----------
  async function loadResearchOptions() {
    try {
      const rows = await KR.loadResearch();
      const sel = $('#rdReport');
      const cur = sel.value;
      sel.innerHTML = '<option value="">Select an approved report</option>' + rows.map((r, i) => '<option value="' + i + '">' + esc(r.reportName) + ' · ' + esc(r.action || 'New report') + ' · ' + esc(r.primary) + '</option>').join('');
      if (cur && rows[Number(cur)]) sel.value = cur;
    } catch (e) {
      /* Sheets may not be configured yet; the fields can still be typed by hand. */
    }
  }

  function onReportPick() {
    const v = $('#rdReport').value;
    const r = v === '' ? null : (S.research || [])[Number(v)];
    if (!r) return;
    const must = String(r.mustUse || '').split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
    const mustSet = new Set(must.map((m) => m.toLowerCase()));
    $('#rdName').value = r.reportName || '';
    $('#rdPrimary').value = r.primary || '';
    $('#rdMust').value = must.join('\n');
    $('#rdSecondary').value = String(r.secondary || '').split(/\s*,\s*/).filter(Boolean).filter((s) => !mustSet.has(s.trim().toLowerCase())).join('\n');
  }

  // ---------- keyword matching ----------
  function reEscape(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Case-insensitive, flexible spaces/hyphens, "and" = "&", singular/plural of the last word.
  function kwPattern(kw) {
    const words = String(kw || '').toLowerCase().replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!words.length) return '';
    return words.map((w, i) => {
      if (w === 'and' || w === '&') return '(?:and|&)';
      if (i === words.length - 1) {
        const base = /s$/.test(w) && w.length > 3 ? w.slice(0, -1) : w;
        return reEscape(base) + '(?:s|es)?';
      }
      return reEscape(w);
    }).join('[\\s\\u00a0-]+');
  }

  function countIn(text, pat) {
    if (!pat) return 0;
    const re = new RegExp('(?<![A-Za-z0-9])' + pat + '(?![A-Za-z0-9])', 'gi');
    return (String(text || '').match(re) || []).length;
  }

  // must: the must-use keywords (required); secondaries: the other secondary keywords (nice to have).
  function buildKeywords(primary, secondaries, must) {
    const list = [];
    const seen = new Set();
    const mustSet = new Set((must || []).map((m) => String(m).toLowerCase().replace(/\s+/g, ' ').trim()));
    let sec = 0;
    const add = (kw, isPrimary) => {
      const k = String(kw || '').replace(/\s+/g, ' ').trim();
      const key = k.toLowerCase();
      if (!k || seen.has(key)) return;
      const pat = kwPattern(k);
      if (!pat) return;
      seen.add(key);
      const color = isPrimary ? PRIMARY_COLOR : { bg: PALETTE[sec++ % PALETTE.length], fg: '#232323' };
      list.push({ kw: k, primary: isPrimary, must: !isPrimary && mustSet.has(key), pat, bg: color.bg, fg: color.fg, count: 0 });
    };
    add(primary, true);
    (must || []).forEach((s) => add(s, false));
    (secondaries || []).forEach((s) => add(s, false));
    return list;
  }

  // Copy of the pasted content in an inert document, cleaned of anything executable.
  function safeRoot(html) {
    const doc = new DOMParser().parseFromString('<div id="kr-root">' + html + '</div>', 'text/html');
    const root = doc.getElementById('kr-root');
    root.querySelectorAll('script,style,iframe,object,embed,link,meta,img').forEach((x) => x.remove());
    root.querySelectorAll('*').forEach((el) => {
      Array.from(el.attributes).forEach((a) => {
        const n = a.name.toLowerCase();
        if (n.indexOf('on') === 0 || n === 'style' || n === 'contenteditable' || (n === 'href' && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
      });
      if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
    });
    return root;
  }

  // Wraps every keyword use in a coloured <mark>. Where keywords overlap, the longest one is highlighted.
  function highlight(root, list) {
    if (!list.length) return root.innerHTML;
    const order = list.map((k, i) => i).sort((a, b) => list[b].kw.length - list[a].kw.length);
    const re = new RegExp('(?<![A-Za-z0-9])(?:' + order.map((i) => '(' + list[i].pat + ')').join('|') + ')(?![A-Za-z0-9])', 'gi');
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach((node) => {
      const text = node.nodeValue;
      if (!text || !text.trim()) return;
      re.lastIndex = 0;
      const frag = doc.createDocumentFragment();
      let last = 0;
      let hit = false;
      let m;
      while ((m = re.exec(text))) {
        if (!m[0]) { re.lastIndex++; continue; }
        let g = 1;
        while (g < m.length && m[g] === undefined) g++;
        const k = order[g - 1];
        const item = list[k];
        if (!item) continue;
        hit = true;
        if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
        const mark = doc.createElement('mark');
        mark.textContent = m[0];
        mark.setAttribute('data-k', String(k));
        mark.setAttribute('title', item.kw + (item.primary ? ' (primary)' : item.must ? ' (must use)' : ' (secondary)'));
        mark.setAttribute('style', 'background:' + item.bg + ';color:' + item.fg + ';padding:0 2px;border-radius:3px');
        frag.appendChild(mark);
        last = m.index + m[0].length;
      }
      if (!hit) return;
      if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
    return root.innerHTML;
  }

  function analyseKeywords(primary, secondaries, must) {
    const list = buildKeywords(primary, secondaries, must);
    const text = B.blocksToText(B.extractBlocks($('#rdContent')));
    const words = B.wordCount(text);
    list.forEach((k) => { k.count = countIn(text, k.pat); });
    return { list, words, html: '' };
  }

  // The RD section a keyword usually belongs in (used in the fix of a missing must-use keyword).
  function sectionGuess(kw) {
    const n = String(kw || '').toLowerCase();
    if (/^(how|what|which|who|why|when|where|is|are|does|do|can|will)\b/.test(n)) return 'FAQs';
    if (/\b(companies|company|players|vendors|manufacturers|suppliers|competitive)\b/.test(n)) return 'Competitive Landscape';
    if (/\b(north america|europe|asia|pacific|latin america|middle east|africa|regional|region)\b/.test(n)) return 'Regional Analysis';
    if (/\b(cagr|forecast|outlook|share|largest|projection)\b/.test(n)) return 'Key Market Highlights';
    if (/\b(trends?|growth|drivers?|opportunit\w*|challenges?|restraints?|demand|dynamics)\b/.test(n)) return 'Market Dynamics';
    if (/\b(size|value|valuation|revenue|worth|industry|report|analysis|overview|global)\b/.test(n)) return 'Overview';
    return 'Segmental Analysis';
  }

  // A missing primary or must-use keyword is an error; other secondary keywords are only shown as not used.
  function keywordIssues(r) {
    const K = r && r.kw;
    if (!K || !K.list.length) return [];
    const tips = (r.review && r.review.keywordTips) || [];
    const out = [];
    K.list.forEach((k) => {
      if (k.count || (!k.primary && !k.must)) return;
      const tip = tips.find((t) => String(t.keyword || '').toLowerCase() === k.kw.toLowerCase());
      out.push({
        severity: 'error',
        section: 'Keywords',
        quote: '',
        problem: k.primary ? 'The primary keyword "' + k.kw + '" is not used in the content.' : 'Must-use keyword "' + k.kw + '" is not used in the content.',
        fix: tip && tip.suggestion ? tip.suggestion : (k.primary ? 'Use it in the Overview heading and the first paragraph.' : 'Use "' + k.kw + '" naturally in the ' + sectionGuess(k.kw) + '.')
      });
    });
    return out;
  }

  // ---------- problem locations (faint red) ----------
  // Every issue that quotes the content, in one list. The position in this list is the issue's highlight number.
  function issueItems(r) {
    const rv = r.review || {};
    const f = r.facts || {};
    return [].concat(rv.consistency || [], rv.language || [], rv.structure || [], f.issues || [])
      .filter((x) => x && String(x.quote || '').trim().length >= 3);
  }

  function normQuote(s) { return String(s || '').replace(/[\s\u00a0]+/g, ' ').trim(); }

  // The quote as a search pattern: any amount of white space between words, whole words at both ends.
  function quotePattern(q) {
    const words = normQuote(String(q || '').replace(/\u2026/g, ' ').replace(/\.{3,}/g, ' ')).replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '').split(' ').filter(Boolean);
    if (!words.length) return '';
    return (/^[A-Za-z0-9]/.test(words[0]) ? '(?<![A-Za-z0-9])' : '') + words.map(reEscape).join('[\\s\\u00a0]+') +
      (/[A-Za-z0-9]$/.test(words[words.length - 1]) ? '(?![A-Za-z0-9])' : '');
  }

  function wrapMatches(root, pat, idx, title) {
    if (!pat) return 0;
    let re;
    try { re = new RegExp(pat, 'gi'); } catch (e) { return 0; }
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    let count = 0;
    nodes.forEach((node) => {
      if (count >= 6) return;
      if (node.parentElement && node.parentElement.closest('[data-iq]')) return;
      const text = node.nodeValue;
      if (!text || !text.trim()) return;
      re.lastIndex = 0;
      const frag = doc.createDocumentFragment();
      let last = 0;
      let hit = false;
      let m;
      while (count < 6 && (m = re.exec(text))) {
        if (!m[0]) { re.lastIndex++; continue; }
        hit = true;
        count++;
        if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
        const span = doc.createElement('span');
        span.textContent = m[0];
        span.setAttribute('data-iq', String(idx));
        span.setAttribute('title', title);
        span.setAttribute('style', ISSUE_STYLE);
        frag.appendChild(span);
        last = m.index + m[0].length;
      }
      if (!hit) return;
      if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
    return count;
  }

  // Shades the quoted text of each issue. A long quote that is not found whole (for example because a link sits
  // inside it) is located by its opening words instead.
  function markIssues(root, items) {
    items.forEach((it, idx) => {
      const q = normQuote(it.quote);
      const title = (it.severity ? it.severity.toUpperCase() + ': ' : '') + it.problem;
      let n = wrapMatches(root, quotePattern(q), idx, title);
      if (!n && q.length > 60) {
        const head = q.slice(0, 50).replace(/\s+\S*$/, '');
        if (head.length > 20) n = wrapMatches(root, quotePattern(head), idx, title);
      }
      it.located = n > 0;
    });
    return root;
  }

  // ---------- rendering ----------
  function card(title, body) { return '<div class="card"><h2>' + esc(title) + '</h2>' + body + '</div>'; }

  function swatch(color, size) {
    return '<span style="background:' + color + ';width:' + size + 'px;height:' + size + 'px;border-radius:3px;display:inline-block;border:1px solid #C3D4DE;vertical-align:middle"></span>';
  }

  function contentHtml() {
    const r = S.rd;
    const marked = (r.issueItems || []).filter((x) => x.located).length;
    return (r.review || r.facts ? '<p class="hint"><span style="' + ISSUE_STYLE + ';padding:0 4px">Faint red</span> marks the text of a problem found below (' + marked + ' located). Hover over it to read the problem, or click an issue in the lists below to jump to it.</p>' : '') +
      '<div id="rdHighlight" class="kr-preview" style="max-height:640px">' + r.kw.html + '</div>';
  }

  function typeOf(k) { return k.primary ? 'Primary' : k.must ? 'Must use' : 'Secondary'; }

  function keywordHtml() {
    const K = S.rd && S.rd.kw;
    if (!K) return '';
    if (!K.list.length) return '<p class="hint">Enter the primary, must-use and secondary keywords (or pick a report from the Research List) to see them highlighted.</p>' + contentHtml();
    const tips = (S.rd.review && S.rd.review.keywordTips) || [];
    const p = K.list.find((k) => k.primary);
    const density = p && K.words ? Math.round((p.count * p.kw.split(/\s+/).length / K.words) * 10000) / 100 : 0;
    const used = K.list.filter((k) => k.count > 0).length;
    const must = K.list.filter((k) => k.must);
    const mustUsed = must.filter((k) => k.count > 0).length;
    let html = '<p class="small">' + K.words.toLocaleString('en-US') + ' words · ' + used + ' of ' + K.list.length + ' keywords used' +
      (must.length ? ' · <b>must-use: ' + mustUsed + ' of ' + must.length + ' used</b>' : ' · <b>no must-use keywords entered</b>') +
      (p ? ' · primary used ' + p.count + ' time' + (p.count === 1 ? '' : 's') + ' (' + density + '% of the words)' : '') + '</p>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px">' + K.list.map((k, i) =>
      '<button type="button" class="chip" data-kjump="' + i + '" title="Click to jump to the next use" style="display:inline-flex;align-items:center;gap:8px">' +
      swatch(k.bg, 14) + '<span>' + esc(k.kw) + '</span>' +
      '<span class="tag' + (k.count ? (k.primary ? ' kr' : '') : ' bad') + '">' + k.count + '×</span>' +
      (k.primary ? '<span class="tag kr">primary</span>' : k.must ? '<span class="tag kr">must use</span>' : '') + '</button>').join('') + '</div>';
    html += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Keyword</th><th>Type</th><th>Times used</th><th></th></tr></thead><tbody>' +
      K.list.map((k) => {
        const tip = !k.count ? tips.find((t) => t.keyword.toLowerCase() === k.kw.toLowerCase()) : null;
        const missing = (k.primary || k.must) ? '<span class="tag bad">Missing: required</span>' : '<span class="tag bad">Not used</span>';
        return '<tr><td>' + swatch(k.bg, 18) + '</td>' +
          '<td><b>' + esc(k.kw) + '</b></td><td>' + typeOf(k) + '</td><td>' + k.count + '</td>' +
          '<td class="small">' + (k.count ? '' : missing + (tip ? ' ' + esc(tip.suggestion) : '')) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    html += '<p class="hint">Counts include uses inside a longer keyword (for example the primary inside "… market size"); where keywords overlap, the highlight shows the longer one. Click a keyword above to jump through its uses.</p>';
    return html + contentHtml();
  }

  function renderRd() {
    const r = S.rd;
    if (!r) return;
    const rv = r.review || {};
    // The content view is rebuilt on every render: problem text first (faint red), then the keyword colours.
    r.issueItems = issueItems(r);
    if (r.kw) r.kw.html = highlight(markIssues(safeRoot(r.srcHtml || ''), r.issueItems), r.kw.list);
    let html = card('Keyword usage and problem locations', keywordHtml());
    const kwIssues = keywordIssues(r);
    html += card('Keyword requirements', KR.issuesHtml(kwIssues, 'The primary keyword and every must-use keyword are used.'));
    if (r.review) {
      html += card('Data consistency', KR.issuesHtml(rv.consistency, 'No data inconsistencies found.'));
      html += card('Language and style', KR.issuesHtml(rv.language, 'No language issues found.'));
      html += card('Structure', KR.issuesHtml(rv.structure, 'All standard sections are present.'));
    }
    if (r.facts) {
      html += card('Fact verification and source links', '<p class="lead">Sources found for claims that have no link yet are listed under "External link suggestions". Put the link on the anchor text shown.</p>' + KR.factsBlock(r.facts));
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

  // Scrolls the content view to an element inside it and outlines it briefly.
  function showInContent(el) {
    const box = $('#rdHighlight');
    if (!box || !el) return;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const delta = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.scrollTop += delta - box.clientHeight / 3;
    el.style.outline = '2px solid #232323';
    setTimeout(() => { el.style.outline = ''; }, 1500);
  }

  // Jumps to the next use of keyword i.
  function jumpTo(i) {
    const box = $('#rdHighlight');
    if (!box) return;
    const marks = $$('mark[data-k="' + i + '"]', box);
    if (!marks.length) { KR.toast('This keyword is not used in the content.'); return; }
    S.rd.jump = S.rd.jump || {};
    const next = ((S.rd.jump[i] === undefined ? -1 : S.rd.jump[i]) + 1) % marks.length;
    S.rd.jump[i] = next;
    showInContent(marks[next]);
  }

  // Jumps to the faint-red text of the issue whose quote was clicked.
  function jumpToIssue(quote) {
    const box = $('#rdHighlight');
    if (!box || !S.rd) return;
    const q = normQuote(quote);
    const idx = (S.rd.issueItems || []).findIndex((it) => normQuote(it.quote) === q);
    const el = idx >= 0 ? $('[data-iq="' + idx + '"]', box) : null;
    if (!el) { KR.toast('This text could not be located in the content (the quote is reworded, or it describes something missing).'); return; }
    showInContent(el);
  }

  // ---------- saved results (so an unchanged RD is not paid for twice) ----------
  const SAVE_KEY = 'kr_rd_last';
  const SAVE_HOURS = 24;

  // A short fingerprint of everything that affects the results.
  function sigOf(content, primary, secondaries, must, links, web) {
    const s = [content, primary, secondaries.join('|'), must.join('|'), links.map((l) => l.href).join('|'), web ? 'web' : 'noweb'].join('\u0001');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return s.length + ':' + (h >>> 0).toString(36);
  }

  function loadSaved(sig) {
    try {
      const o = JSON.parse(KR.store.get(SAVE_KEY, '') || 'null');
      if (o && o.sig === sig && Date.now() - o.at < SAVE_HOURS * 3600000 && o.review && o.facts) return o;
    } catch (e) { /* ignore */ }
    return null;
  }

  // Only complete, error-free runs are kept, so a failed check is always run again.
  function saveRun(sig, res) {
    if (!res.review || res.review.aiError || !res.facts || res.facts.error) return;
    if ((res.facts.claims || []).some((c) => c.verdict === 'Error')) return;
    KR.store.set(SAVE_KEY, JSON.stringify({ sig, at: Date.now(), review: res.review, facts: res.facts, linkStatus: res.linkStatus }));
  }

  // ---------- run ----------
  async function runRd(ev) {
    if (KR.me && KR.me.checker === false) {
      KR.toast('Checks are run by the check team only. Open "Check results" to read their findings.', 'err');
      return;
    }
    const btn = $('#rdRun');
    const prog = KR.progress('#rdProgress');
    const force = !!(ev && ev.shiftKey);
    try {
      const blocks = B.extractBlocks($('#rdContent'));
      const content = B.blocksToText(blocks);
      if (content.length < 300) throw new Error('Paste the full RD content first.');
      const links = $$('#rdContent a[href]').map((a) => ({ text: B.textOf(a), href: a.getAttribute('href') || '' })).filter((l) => /^https?:\/\//i.test(l.href));
      const primary = $('#rdPrimary').value.trim();
      const must = lines2list($('#rdMust').value);
      const secondaries = lines2list($('#rdSecondary').value);
      const reportName = $('#rdName').value.trim() || primary;
      const web = $('#rdWeb').checked;
      if (!must.length) prog.info('No must-use keywords entered. Pick the report from the Research List to fill them in.');
      KR.busy(btn, true, 'Verifying…');
      $('#rdSave').disabled = true;

      const res = S.rd = { reportName, primary, secondaries, must, content, links, words: B.wordCount(content), srcHtml: $('#rdContent').innerHTML, kw: null, review: null, facts: null, linkStatus: null };
      res.kw = analyseKeywords(primary, secondaries, must);
      const missingMust = res.kw.list.filter((k) => (k.must || k.primary) && !k.count).length;
      prog.info('Keywords highlighted: ' + res.kw.list.filter((k) => k.count > 0).length + ' of ' + res.kw.list.length + ' used' + (missingMust ? ' · ' + missingMust + ' required keyword(s) missing' : ''));
      renderRd();
      $('#rdResults').scrollIntoView({ behavior: 'smooth', block: 'start' });

      const sig = sigOf(content, primary, secondaries, must, links, web);
      const saved = force ? null : loadSaved(sig);
      if (saved) {
        res.review = saved.review;
        res.facts = saved.facts;
        res.linkStatus = saved.linkStatus || null;
        prog.info('Nothing has changed since the last check (' + new Date(saved.at).toLocaleString() + '), so the saved results are shown at no AI cost. Hold Shift and click "Verify content" to run everything again.');
        renderRd();
        $('#rdSave').disabled = false;
        return;
      }

      // The AI review sees every keyword (must-use first) so it can suggest where to add the missing ones.
      const allSecondaries = must.concat(secondaries.filter((s) => must.map((m) => m.toLowerCase()).indexOf(s.toLowerCase()) < 0));
      await Promise.all([
        (async () => {
          const s = prog.step('Data consistency, grammar and structure…');
          try {
            res.review = await KR.api('rd', 'review', { content, primary, secondaries: allSecondaries, reportName });
            s.done('Review complete' + (res.review.aiError ? ' (AI part failed: ' + res.review.aiError + ')' : ''));
          } catch (e) { s.fail('Review failed: ' + e.message); }
        })(),
        (async () => {
          const s = prog.step('Finding and verifying facts…');
          try {
            res.facts = await KR.factCheck(content, links, web, s, reportName);
            s.done('Facts: ' + res.facts.claims.length + ' claims' + (res.facts.reused ? ', ' + res.facts.reused + ' reused from earlier checks' : ''));
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
      saveRun(sig, res);
      $('#rdSave').disabled = false;
      // Saved straight away, so the whole team can read this check in "Check results".
      if (res.review || (res.facts && !res.facts.error)) {
        const sv = prog.step('Saving the check for the team…');
        if (await saveRd(true)) sv.done('Saved to the RD sheet · visible to everyone in "Check results"');
        else sv.fail('Not saved to the sheet. Click "Save to RD sheet again".');
      }
    } catch (e) {
      prog.error(e.message);
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  function lines(list) {
    return (list || []).map((x, i) => (i + 1) + '. [' + x.severity + '] ' + (x.section ? x.section + ': ' : '') + x.problem + (x.fix ? ' -> ' + x.fix : '') + (x.quote ? ' | "' + x.quote + '"' : '')).join('\n') || 'OK';
  }

  function kwLabel(k) { return k.kw + (k.primary ? ' [primary]' : k.must ? ' [must use]' : ''); }

  // auto = saved at the end of a check (no button state, a short message). Returns true when saved.
  async function saveRd(auto) {
    const btn = $('#rdSave');
    try {
      const user = KR.requireUser();
      const r = S.rd;
      if (!r) throw new Error('Run "Verify content" first.');
      const rv = r.review || {};
      const f = r.facts || { issues: [], claims: [], suggestions: [] };
      const list = (r.kw && r.kw.list) || [];
      const structure = keywordIssues(r).concat(rv.structure || []);
      const issueCount = (rv.consistency || []).length + (rv.language || []).length + structure.length + (f.issues || []).length;
      if (!auto) KR.busy(btn, true, 'Saving…');
      await KR.api('rd', 'save', {
        user,
        reportName: r.reportName,
        primary: r.primary,
        words: r.words,
        found: list.filter((k) => k.count > 0).map((k) => kwLabel(k) + ' (' + k.count + ')').join(', '),
        missing: list.filter((k) => !k.count).map(kwLabel).join(', '),
        consistency: lines(rv.consistency),
        language: lines(rv.language),
        structure: lines(structure),
        facts: (f.claims || []).map((c) => '[' + c.verdict + '] ' + c.claim + (c.correction ? ' -> ' + c.correction : '') + (c.sourceUrl ? ' (' + c.sourceUrl + ')' : '')).join('\n') || 'No claims',
        suggestions: (f.suggestions || []).map((s) => (s.anchor || '(anchor)') + ' -> ' + s.url).join('\n'),
        issueCount
      });
      KR.toast(auto ? 'Check saved: the team can read it in "Check results".' : 'Saved to the RD sheet.', 'ok');
      return true;
    } catch (e) {
      KR.toast((auto ? 'The check was not saved for the team: ' : '') + e.message, 'err');
      return false;
    } finally {
      if (!auto) KR.busy(btn, false);
    }
  }

  async function repairRows(btn) {
    KR.busy(btn, true, 'Fixing…');
    try {
      const r = await KR.api('keywords', 'repair');
      KR.toast('Updated ' + r.updatedRows + ' keyword rows (' + r.flagged + ' flagged by the SEO check).', 'ok');
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
    $('#rdSave').addEventListener('click', () => saveRd(false));
    $('#rdResults').addEventListener('click', (e) => {
      const b = e.target.closest('[data-kjump]');
      if (b) { jumpTo(Number(b.getAttribute('data-kjump'))); return; }
      if (e.target.closest('a,button,#rdHighlight')) return;
      const iss = e.target.closest('.issue');
      const q = iss ? iss.querySelector('.quote') : null;
      if (q) jumpToIssue(q.textContent);
    });
    const rep = $('#setRepair');
    if (rep) rep.addEventListener('click', (e) => repairRows(e.currentTarget));
    KR.hooks.tab.rd = loadResearchOptions;
  };
})();
