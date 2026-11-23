'use strict';
/* DM tab: structure pasted content into the Kings Research report HTML format. The H2 and H3 headings are chosen
   from the pasted content itself (AI reads the whole text; the standard section names are only the fallback), and
   every heading can be changed afterwards in "Headings". Also: segmentation table, lists, internal links
   (KR-Interlinker logic), one or more draggable images (alt text only inside each image's HTML alt attribute), and
   the CMS boxes. The meta title and description are built from the figures in the pasted content (market size,
   years, CAGR, forecast period), never from a template with invented numbers. */
(function () {
  const KR = window.KR;
  const { $, $$, esc } = KR;
  const B = KR.blocks;
  const D = (KR.state.dm = { units: [], links: [], imgs: [], keyword: '', period: '2026-2033', figures: {}, headingSource: '' });

  const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
  const H2_SET = ['market overview', 'key market highlights', 'market dynamics', 'market segmentation', 'segmental analysis', 'regional analysis', 'competitive landscape', 'research methodology', 'frequently asked questions'];
  const SECTION_OF = { 'key market highlights': 'highlights', 'market dynamics': 'dynamics', 'market segmentation': 'segmentation', 'segmental analysis': 'segmental', 'regional analysis': 'regional', 'competitive landscape': 'competitive', 'research methodology': 'methodology', 'frequently asked questions': 'faq' };
  const H3_SET = ['how we gather this information', 'custom offerings'];
  const STD_IMAGES = [
    { src: 'https://app.kingsresearch.com/uploads/media/1785508246086-research-methodology.webp', alt: 'Kings Research research methodology', after: 'how we gather this information' },
    { src: 'https://app.kingsresearch.com/uploads/media/1785832495783-why-kings-research.webp', alt: 'Why choose Kings Research', after: 'custom offerings' }
  ];
  const STOP = new Set(['this', 'that', 'with', 'from', 'have', 'will', 'been', 'they', 'their', 'which', 'when', 'what', 'your', 'about', 'more', 'into', 'than', 'also', 'some', 'other', 'these', 'those', 'such', 'most', 'like', 'just', 'over', 'after', 'before', 'then', 'each', 'only', 'even', 'well', 'back', 'very', 'much', 'both', 'through', 'should', 'could', 'would', 'make', 'made', 'being', 'there', 'where', 'here', 'were', 'them', 'many', 'come', 'work', 'need', 'take', 'used', 'uses', 'using', 'market', 'markets', 'global', 'growth', 'demand', 'industry']);
  const GENERIC = new Set(['market', 'markets', 'industry', 'global', 'size', 'share', 'report', 'analysis', 'trends', 'growth', 'forecast', 'and', 'the', 'for', 'with']);

  // ---------- image caption lines in the pasted content ----------
  // Writers often type the image's alt text as a line of its own next to the infographic in the document
  // ("<Market> Size & Share, By Revenue, 2026-2033"). The picture itself is dropped on paste but that line
  // stays, and it would be published as visible page text. Such lines are removed: alt text belongs only
  // inside the image's alt attribute.
  const CAPTION_RE = /\bsize\s*(?:&|and)\s*share\b[\s,]*by revenue[\s,]*(?:19|20)\d{2}\s*[-\u2013\u2014]\s*(?:19|20)\d{2}\.?$/i;

  function normCaption(s) { return String(s || '').toLowerCase().replace(/[\u2013\u2014]/g, '-').replace(/[^a-z0-9]+/g, ' ').trim(); }

  function isImageCaption(text, alts) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 160) return false;
    if (alts.indexOf(normCaption(t)) >= 0) return true;
    return CAPTION_RE.test(t);
  }

  // ---------- segmentation table ----------
  function tokensToRows(tok) {
    const rows = [];
    let i = 0;
    if (/^segmentation$/i.test(tok[0] || '')) { rows.push([tok[0], tok[1] || 'Details']); i = 2; }
    else rows.push(['Segmentation', 'Details']);
    while (i < tok.length) {
      const t = tok[i];
      if (/^by region/i.test(t)) {
        i++;
        let first = true;
        while (i < tok.length && !/^by /i.test(tok[i])) {
          const name = tok[i];
          const val = tok[i + 1] || '';
          rows.push(first ? [t, name, val] : [name, val]);
          first = false;
          i += 2;
        }
        if (first) rows.push([t, '']);
      } else {
        rows.push([t, tok[i + 1] || '']);
        i += 2;
      }
    }
    return rows;
  }

  function segCell(text, attrs, strong) {
    return '<td' + attrs + '>\n<p>' + (strong ? '<strong>' : '') + '<span>' + esc(text) + '</span>' + (strong ? '</strong>' : '') + '</p>\n</td>';
  }

  function renderSegTable(rows) {
    const head = rows[0];
    let body = rows.slice(1).filter((r) => r.some((c) => String(c).trim()));
    let groupLabel = null;
    body = body.map((r) => {
      if (r.length >= 3) {
        if (groupLabel !== null && (r[0] === groupLabel || r[0] === '')) return [r[1], r[2]];
        groupLabel = r[0];
        return r;
      }
      if (/^by /i.test(r[0])) groupLabel = null;
      return r;
    });
    let html = '<table width="936">\n<thead>\n<tr>\n' + segCell(head[0], ' width="220"', true) + '\n' + segCell(head[1] || 'Details', ' colspan="2" width="716"', true) + '\n</tr>\n</thead>\n<tbody>\n';
    for (let i = 0; i < body.length; i++) {
      const r = body[i];
      if (r.length >= 3) {
        let span = 1;
        while (i + span < body.length && body[i + span].length === 2 && !/^by /i.test(body[i + span][0])) span++;
        html += '<tr>\n' + segCell(r[0], ' rowspan="' + span + '" width="220"', true) + '\n' + segCell(r[1], ' width="240"') + '\n' + segCell(r[2], ' width="476"') + '\n</tr>\n';
        for (let k = 1; k < span; k++) {
          const c = body[i + k];
          html += '<tr>\n' + segCell(c[0], ' width="240"') + '\n' + segCell(c[1], ' width="476"') + '\n</tr>\n';
        }
        i += span - 1;
      } else {
        html += '<tr>\n' + segCell(r[0], ' width="220"', true) + '\n' + segCell(r[1] || '', ' colspan="2" width="716"') + '\n</tr>\n';
      }
    }
    return html + '</tbody>\n</table>';
  }

  function renderTable(rows) {
    if (rows.length && /segment/i.test(rows[0][0] || '')) return renderSegTable(rows);
    return '<table>\n<tbody>\n' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('\n') + '\n</tbody>\n</table>';
  }

  // ---------- headings chosen from the content (AI) ----------
  // Every pasted block is summarised for the AI: SHORT lines can be headings, LONG paragraphs, LIST items and
  // TABLE rows are context. The AI answers h2 / h3 / p for each SHORT or HEADING block.
  function blockKind(b) {
    if (b.kind === 'table') return 'TABLE';
    if (b.kind === 'li') return 'LIST';
    if (b.kind === 'h') return 'HEADING' + b.level;
    return String(b.text || '').trim().length <= 160 ? 'SHORT' : 'LONG';
  }

  function blockSummary(b, i) {
    const text = b.kind === 'table' ? (b.rows || []).slice(0, 3).map((r) => r.join(' | ')).join(' / ') : String(b.text || '');
    return { i, kind: blockKind(b), len: text.length, text: text.replace(/\s+/g, ' ').slice(0, 160) };
  }

  // Which part of the report an H2 starts (used for lists, links and the meta figures).
  function sectionFor(text) {
    const t = String(text || '').toLowerCase();
    if (/segmentation/.test(t)) return 'segmentation';
    if (/overview/.test(t)) return 'overview';
    if (/highlight/.test(t)) return 'highlights';
    if (/dynamic|driver|restraint|opportunit|challenge|trend/.test(t)) return 'dynamics';
    if (/segment/.test(t)) return 'segmental';
    if (/region|geograph/.test(t)) return 'regional';
    if (/competiti|key (companies|players)/.test(t)) return 'competitive';
    if (/methodolog/.test(t)) return 'methodology';
    if (/frequently asked|faq/.test(t)) return 'faq';
    return 'other';
  }

  // ---------- classify pasted blocks into report units ----------
  // levels: Map(block index -> 'h2' | 'h3' | 'p') from the AI, or null to use the standard section names.
  // better: Map(block index -> suggested wording) from the AI.
  function classify(raw, keyword, levels, better) {
    const units = [];
    let section = 'intro';
    let h2Count = 0;
    let lastH3 = '';
    let seg = null;
    const ai = levels instanceof Map && levels.size > 0;
    const monthRe = new RegExp('^In (' + MONTHS + ') \\d{4},');
    const pushLi = (html, text, listId) => {
      const last = units[units.length - 1];
      if (last && last.type === 'ul' && last.listId === listId) last.items.push({ html, text });
      else units.push({ type: 'ul', listId, items: [{ html, text }], section, sub: lastH3 });
    };
    const flushSeg = () => {
      if (seg && seg.length) units.push({ type: 'table', rows: tokensToRows(seg), section: 'segmentation' });
      seg = null;
    };
    const heading = (type, text, idx) => ({ type, text, section, src: idx, isHeading: true, better: (better && better.get(idx)) || '' });
    raw.forEach((b, idx) => {
      if (b.kind === 'table') { flushSeg(); units.push({ type: 'table', rows: b.rows, section }); return; }
      const t = String(b.text || '').replace(/\s+/g, ' ').trim();
      if (!t) return;
      const clean = t.replace(/[:\uFF1A]\s*$/, '');
      const tl = clean.toLowerCase();
      const lvl = ai ? levels.get(idx) : '';
      let isH2;
      if (ai) {
        isH2 = lvl === 'h2';
      } else {
        const short = clean.length <= 90 && b.kind !== 'li';
        isH2 = short && (H2_SET.indexOf(tl) >= 0 || (h2Count === 0 && /\boverview$/i.test(clean)));
      }
      if (isH2) {
        flushSeg();
        h2Count++;
        lastH3 = '';
        section = ai ? sectionFor(clean) : (SECTION_OF[tl] || (/overview$/i.test(clean) ? 'overview' : 'other'));
        const text = section === 'overview' && keyword && tl.indexOf(keyword.toLowerCase()) < 0 ? keyword + ' Overview' : clean;
        units.push(heading('h2', text, idx));
        return;
      }
      if (section === 'segmentation') { (seg = seg || []).push(clean); return; }
      const isH3 = ai
        ? lvl === 'h3'
        : (b.kind !== 'li' && (H3_SET.indexOf(tl) >= 0 || (/\?$/.test(clean) && clean.length <= 220) || (b.kind === 'h' && b.level >= 3)));
      if (isH3) {
        units.push(heading('h3', clean, idx));
        lastH3 = tl;
        return;
      }
      if (b.kind === 'h' && !(ai && lvl === 'p')) {
        units.push(heading(b.level <= 2 ? 'h2' : 'h3', clean, idx));
        if (b.level > 2) lastH3 = tl;
        return;
      }
      if (b.kind === 'li') { pushLi(b.html, t, b.listId + ':' + section); return; }
      if (section === 'highlights') { pushLi(b.html, t, 'hl'); return; }
      if (/key (companies|players)/.test(lastH3) && clean.length <= 120) { pushLi(b.html, t, 'kc'); return; }
      const prev = units[units.length - 1];
      if (section === 'competitive' && monthRe.test(clean) && prev && prev.type !== 'h3') { pushLi(b.html, t, 'cl'); return; }
      if ((section === 'regional' && clean.length <= 80 && !/[.?!:;,]$/.test(clean) && b.html.indexOf('<a ') < 0) || (b.bold && clean.length <= 80)) {
        units.push({ type: 'pstrong', text: clean, section });
        return;
      }
      units.push({ type: 'p', html: b.html, text: t, section, sub: lastH3 });
    });
    flushSeg();
    return units;
  }

  function finalizeUnits(units, withStd) {
    units.forEach((u) => {
      u.eligible = (u.type === 'p' || u.type === 'ul') &&
        ['intro', 'dynamics', 'segmental', 'regional', 'competitive', 'other'].indexOf(u.section) >= 0 &&
        !(u.type === 'ul' && (u.listId === 'kc' || /key (companies|players)/.test(u.sub || '')));
    });
    if (withStd) {
      STD_IMAGES.forEach((img) => {
        const hi = units.findIndex((u) => u.type === 'h3' && u.text.toLowerCase() === img.after);
        let pos = units.length;
        if (hi >= 0) { pos = hi + 1; while (pos < units.length && units[pos].type === 'p') pos++; }
        units.splice(pos, 0, { type: 'stdimg', src: img.src, alt: img.alt, section: 'methodology' });
      });
    }
    return units;
  }

  // Image k (0 = infographic) goes just before the (k+2)-th H2: the first after the Overview, the next after the
  // following section, and so on. Without headings, the first image goes after the first paragraph.
  function defaultPositions(units, n) {
    const h2 = [];
    units.forEach((u, i) => { if (u.type === 'h2') h2.push(i); });
    const out = [];
    for (let k = 0; k < n; k++) {
      if (h2[k + 1] !== undefined) out.push(h2[k + 1]);
      else if (k === 0 && h2.length < 2) {
        const p = units.findIndex((u) => u.type === 'p');
        out.push(p >= 0 ? p + 1 : units.length);
      } else out.push(units.length);
    }
    return out;
  }

  // ---------- headings editor ----------
  function setHeading(k, change) {
    const u = D.units[k];
    if (!u || !u.isHeading) return;
    if (change.text !== undefined) {
      const t = String(change.text).replace(/\s+/g, ' ').trim();
      if (t) {
        u.text = t;
        if (u.type === 'p') u.html = esc(t);
      }
    }
    if (change.level) {
      if (change.level === 'p') {
        if (u.type !== 'p') { u.type = 'p'; u.html = esc(u.text); u.eligible = false; }
      } else {
        u.type = change.level;
      }
    }
    renderDm();
  }

  function renderHeadings() {
    const box = $('#dmHeadings');
    if (!box) return;
    const heads = D.units.map((u, k) => ({ u, k })).filter((x) => x.u.isHeading);
    if (!D.units.length || !heads.length) { box.innerHTML = ''; return; }
    const sel = (u, v) => (u.type === v ? ' selected' : '');
    const sugg = heads.filter((x) => x.u.better && x.u.better !== x.u.text).length;
    const h2 = heads.filter((x) => x.u.type === 'h2').length;
    const h3 = heads.filter((x) => x.u.type === 'h3').length;
    box.innerHTML = '<h3>Headings: ' + h2 + ' H2 and ' + h3 + ' H3 <span class="hint">(' + esc(D.headingSource || '') + ')</span></h3>' +
      '<p class="hint">Change a level or the wording here; Preview and the HTML update straight away. "Text" turns a heading back into a normal paragraph.</p>' +
      (sugg ? '<div class="row"><button type="button" class="btn tiny" data-hall="1">Use all ' + sugg + ' suggested wordings</button></div>' : '') +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Level</th><th>Heading</th><th>Suggested wording (AI, from the text below the heading)</th></tr></thead><tbody>' +
      heads.map((x) => '<tr><td><select data-hlvl="' + x.k + '" style="width:auto;margin:0"><option value="h2"' + sel(x.u, 'h2') + '>H2</option><option value="h3"' + sel(x.u, 'h3') + '>H3</option><option value="p"' + sel(x.u, 'p') + '>Text</option></select></td>' +
        '<td><input type="text" data-htxt="' + x.k + '" value="' + esc(x.u.text) + '" style="margin:0"></td>' +
        '<td class="small">' + (x.u.better && x.u.better !== x.u.text ? esc(x.u.better) + ' <button type="button" class="btn tiny ghost" data-huse="' + x.k + '">Use</button>' : '') + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  // ---------- image inputs ----------
  function imageRowHtml(n) {
    return '<div class="paste-head"><span><b>Image ' + n + '</b>' + (n === 1 ? ' <span class="hint">(infographic)</span>' : '') + '</span><button type="button" class="btn tiny ghost dm-img-del">Remove</button></div>' +
      '<div class="grid2"><label>Image URL (.jpg or .webp)<input class="dm-img-url" type="url" placeholder="https://app.kingsresearch.com/uploads/media/....jpg"></label>' +
      '<label>Alt text <span class="hint">(leave empty for automatic)</span><input class="dm-img-alt" type="text"></label></div>';
  }

  function addImageRow() {
    const box = $('#dmImages');
    const row = document.createElement('div');
    row.className = 'group dm-img-row';
    row.innerHTML = imageRowHtml($$('.dm-img-row', box).length + 1);
    box.appendChild(row);
    renumberRows();
    return row;
  }

  function renumberRows() {
    $$('#dmImages .dm-img-row').forEach((row, i) => {
      const b = $('.paste-head b', row);
      if (b) b.textContent = 'Image ' + (i + 1);
      const hint = $('.paste-head .hint', row);
      if (i === 0 && !hint) $('.paste-head span', row).insertAdjacentHTML('beforeend', ' <span class="hint">(infographic)</span>');
      if (i > 0 && hint) hint.remove();
    });
  }

  function readImageInputs() {
    return $$('#dmImages .dm-img-row').map((row) => ({ url: $('.dm-img-url', row).value.trim(), alt: $('.dm-img-alt', row).value.trim() })).filter((x) => x.url);
  }

  function altFromUrl(url) {
    let name = '';
    try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch (e) { name = ''; }
    name = name.replace(/\.[a-z0-9]+$/i, '').replace(/^\d{6,}[-_]?/, '').replace(/[-_]+/g, ' ').trim();
    return name ? KR.titleCase(name) : '';
  }

  function defaultAlt(k, url) {
    if (k === 0) return D.keyword + ' Size & Share, By Revenue, ' + D.period;
    const fromName = altFromUrl(url);
    return fromName || (D.keyword + ' ' + (k + 1));
  }

  // Alt text edits after Optimize are applied straight to the HTML.
  function syncAlts() {
    if (!D.units.length || !D.imgs.length) return;
    const inputs = readImageInputs();
    D.imgs.forEach((im, k) => {
      const inp = inputs[k];
      if (inp && inp.url === im.src) im.alt = inp.alt || defaultAlt(k, im.src);
    });
    renderDm();
  }

  // ---------- interlinks ----------
  function preFilter(content, keyword, max) {
    const lower = content.toLowerCase();
    const words = new Set((lower.match(/\b[a-z][a-z0-9-]{3,}\b/g) || []).filter((w) => !STOP.has(w)));
    const self = keyword.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const selfCore = self.replace(/\s+market$/, '');
    return (KR.state.siteLinks || []).filter((l) => l.kw && l.kw !== self && l.kw.replace(/\s+market$/, '') !== selfCore).map((l) => {
      const kws = l.kw.split(/\s+/).filter((w) => w.length > 3 && !GENERIC.has(w));
      if (!kws.length) return null;
      let score = 0;
      let hits = 0;
      kws.forEach((w) => {
        if (words.has(w)) { score += 2; hits++; }
        else if (words.has(w.replace(/s$/, '')) || words.has(w + 's')) { score += 1.5; hits++; }
      });
      if (!hits) return null;
      score *= hits / kws.length;
      const phrase = l.kw.replace(/\s+market$/, '');
      if (phrase.length > 3 && lower.indexOf(phrase) >= 0) score += 6;
      if (l.type === 'report') score += 0.5;
      return Object.assign({}, l, { score });
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, max);
  }

  function findWord(text, word, ci) {
    const re = new RegExp('(^|[^A-Za-z0-9])(' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?=[^A-Za-z0-9]|$)', ci ? 'i' : '');
    const m = re.exec(text);
    return m ? m.index + m[1].length : -1;
  }

  function linkify(html, anchor, url) {
    const box = document.createElement('div');
    box.innerHTML = html;
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (const ci of [false, true]) {
      for (const node of nodes) {
        if (node.parentElement && node.parentElement.closest('a')) continue;
        const idx = findWord(node.nodeValue, anchor, ci);
        if (idx < 0) continue;
        const target = node.splitText(idx);
        target.splitText(anchor.length);
        const a = document.createElement('a');
        a.setAttribute('href', url);
        a.setAttribute('data-il', '1');
        target.parentNode.insertBefore(a, target);
        a.appendChild(target);
        return box.innerHTML;
      }
    }
    return null;
  }

  function applyLinks(units, links) {
    const out = units.map((u) => Object.assign({}, u, u.items ? { items: u.items.map((it) => Object.assign({}, it)) } : {}));
    const applied = [];
    (links || []).forEach((L) => {
      if (!L.enabled) return;
      for (let i = 0; i < out.length; i++) {
        const u = out[i];
        if (!u.eligible) continue;
        if (u.type === 'p') {
          const r = linkify(u.html, L.anchor, L.url);
          if (r) { u.html = r; applied.push(L); return; }
        } else if (u.type === 'ul') {
          for (const it of u.items) {
            const r = linkify(it.html, L.anchor, L.url);
            if (r) { it.html = r; applied.push(L); return; }
          }
        }
      }
    });
    return { units: out, applied };
  }

  // ---------- HTML output ----------
  function decorateLinks(html) {
    const box = document.createElement('div');
    box.innerHTML = html;
    $$('a', box).forEach((a) => {
      const href = a.getAttribute('href') || '';
      const internal = /^https?:\/\/([a-z0-9-]+\.)*kingsresearch\.com/i.test(href);
      const clean = document.createElement('a');
      clean.setAttribute('href', href);
      if (!internal) { clean.setAttribute('target', '_blank'); clean.setAttribute('rel', 'noopener noreferrer'); }
      while (a.firstChild) clean.appendChild(a.firstChild);
      const span = document.createElement('span');
      span.appendChild(clean);
      a.replaceWith(span);
    });
    return box.innerHTML;
  }

  function imgTag(src, alt, w, h) {
    return '<p><img style="display: block; margin-left: auto; margin-right: auto;" src="' + esc(src) + '" alt="' + esc(alt) + '"' + (w ? ' width="' + w + '"' : '') + (h ? ' height="' + h + '"' : '') + ' /></p>';
  }

  function unitHtml(u) {
    switch (u.type) {
      case 'h2': return '<h2><strong>' + esc(u.text) + '</strong></h2>';
      case 'h3': return '<h3><strong>' + esc(u.text) + '</strong></h3>';
      case 'pstrong': return '<p><strong>' + esc(u.text) + '</strong></p>';
      case 'p': return '<p>' + decorateLinks(u.html) + '</p>';
      case 'ul': return '<ul>\n' + u.items.map((it) => '<li>' + decorateLinks(it.html) + '</li>').join('\n') + '\n</ul>';
      case 'table': return renderTable(u.rows);
      case 'stdimg': return imgTag(u.src, u.alt, 1000, 563);
      default: return '';
    }
  }

  function imagesAt(pos, total) {
    const out = [];
    D.imgs.forEach((im, k) => {
      const p = Math.max(0, Math.min(total, im.pos));
      if (p === pos) out.push({ im, k });
    });
    return out;
  }

  function buildSource() {
    if (!D.units.length) return '';
    const units = applyLinks(D.units, D.links).units;
    const parts = [];
    units.forEach((u, i) => {
      imagesAt(i, units.length).forEach((x) => parts.push(imgTag(x.im.src, x.im.alt, x.im.w, x.im.h)));
      parts.push(unitHtml(u));
    });
    imagesAt(units.length, units.length).forEach((x) => parts.push(imgTag(x.im.src, x.im.alt, x.im.w, x.im.h)));
    return parts.join('\n');
  }

  function previewImg(im, k) {
    return '<div class="pv-img" draggable="true" data-img="' + k + '" title="Drag to move"><div class="pv-img-bar"><span>Image ' + (k + 1) + (k === 0 ? ' (infographic)' : '') + ': drag to move</span>' +
      '<button type="button" data-mv="-1" data-img="' + k + '" title="Move up">&#9650;</button><button type="button" data-mv="1" data-img="' + k + '" title="Move down">&#9660;</button></div>' +
      '<img src="' + esc(im.src) + '" alt="' + esc(im.alt) + '"></div>';
  }

  function renderPreview() {
    const box = $('#dmPreview');
    if (!D.units.length) { box.innerHTML = '<p class="hint">Run Optimize first.</p>'; return; }
    const units = applyLinks(D.units, D.links).units;
    let html = '';
    units.forEach((u, i) => {
      imagesAt(i, units.length).forEach((x) => { html += previewImg(x.im, x.k); });
      html += '<div class="pv-unit" data-i="' + i + '">' + unitHtml(u) + '</div>';
    });
    imagesAt(units.length, units.length).forEach((x) => { html += previewImg(x.im, x.k); });
    html += '<div class="pv-end" data-i="' + units.length + '">Drop here to place an image at the end</div>';
    box.innerHTML = html;
    // A broken image shows a clear note instead of its alt text, so alt text never appears as page text in the preview.
    $$('img', box).forEach((im) => {
      im.setAttribute('draggable', 'false');
      im.addEventListener('error', () => {
        const note = document.createElement('div');
        note.className = 'note';
        note.textContent = 'This image could not be loaded. Check the URL: ' + im.getAttribute('src');
        im.replaceWith(note);
      });
    });
  }

  function renderLinksTable() {
    const box = $('#dmLinksTable');
    if (!D.units.length) { box.innerHTML = ''; return; }
    if (!D.links.length) { box.innerHTML = '<p class="hint">No internal links were added.</p>'; return; }
    const placed = new Set(applyLinks(D.units, D.links).applied.map((l) => l.url));
    box.innerHTML = '<h3>Internal links (' + placed.size + ' placed)</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Use</th><th>Anchor text</th><th>Target page</th><th>Type</th><th>Why</th></tr></thead><tbody>' +
      D.links.map((l, i) => '<tr class="' + (l.enabled && !placed.has(l.url) ? 'warn-row' : '') + '"><td><input type="checkbox" data-li="' + i + '"' + (l.enabled ? ' checked' : '') + '></td><td><b>' + esc(l.anchor) + '</b></td>' +
        '<td class="small"><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.url) + '</a></td><td><span class="tag ' + esc(l.type) + '">' + esc(l.type) + '</span></td>' +
        '<td class="small">' + esc(l.reason) + (l.enabled && !placed.has(l.url) ? ' <b>(anchor not found in an eligible paragraph)</b>' : '') + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  function updateCounters() {
    const t = $('#dmMetaTitle').value.trim().length;
    const d = $('#dmMetaDesc').value.trim().length;
    const tc = $('#dmTitleCount');
    const dc = $('#dmDescCount');
    tc.textContent = t + ' / 60 characters';
    tc.classList.toggle('bad', t > 60 || (t > 0 && t < 30));
    dc.textContent = d + ' / 160 characters';
    dc.classList.toggle('bad', d > 160 || (d > 0 && d < 70));
  }

  function renderDm() {
    renderHeadings();
    renderLinksTable();
    renderPreview();
    $('#dmSource').value = buildSource();
    updateCounters();
  }

  // ---------- meta title and description from the content's own figures ----------
  // The text where the headline figures live: everything before the first section, the Overview and the
  // Key Market Highlights.
  function figureText() {
    return D.units.filter((u) => ['intro', 'overview', 'highlights'].indexOf(u.section) >= 0)
      .map((u) => (u.items ? u.items.map((i) => i.text).join(' ') : (u.text || ''))).join(' ');
  }

  // Reads the market size by year, the CAGR and the forecast period, exactly as written.
  function figuresFrom(text) {
    const t = String(text || '').replace(/[\u2012\u2013\u2014\u2212]/g, '-').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
    const f = {};
    const usd = (n, u) => 'USD ' + n + ' ' + u.toLowerCase();
    let m = t.match(/size (?:was valued at|is valued at|was estimated at|was estimated to be|stood at|was worth|was|is|reached)(?: valued at)?(?: approximately| around| about| nearly)? USD ([\d.,]+) (trillion|billion|million) in (\d{4})/i);
    if (m) f.base = { label: usd(m[1], m[2]), year: m[3] };
    m = t.match(/(?:grow|increase|rise|expand|climb)\w* from USD ([\d.,]+) (trillion|billion|million) in (\d{4}) to USD ([\d.,]+) (trillion|billion|million) by (?:the end of )?(\d{4})/i);
    if (m) {
      f.start = { label: usd(m[1], m[2]), year: m[3] };
      f.end = { label: usd(m[4], m[5]), year: m[6] };
    }
    if (!f.end) {
      m = t.match(/(?:reach|hit|attain|exceed|surpass|cross|touch|be worth|be valued at)\s+(?:a value of |a valuation of |approximately |around |about |nearly )?USD ([\d.,]+) (trillion|billion|million) by (?:the end of )?(\d{4})/i);
      if (m) f.end = { label: usd(m[1], m[2]), year: m[3] };
    }
    m = t.match(/CAGR of ([\d.]+) ?%/i) || t.match(/([\d.]+) ?% CAGR/i);
    if (m) f.cagr = m[1].replace(/\.$/, '');
    m = t.match(/forecast period \(?(\d{4}) ?(?:-|to) ?(\d{4})\)?/i) || t.match(/\((\d{4}) ?- ?(\d{4})\)/) || t.match(/from (\d{4}) to (\d{4})/i);
    if (m) f.period = [m[1], m[2]];
    else if (f.start && f.end) f.period = [f.start.year, f.end.year];
    return f;
  }

  function hasFigures(f) { return !!(f && (f.base || f.end || f.cagr)); }

  function figuresLine(f) {
    const parts = [];
    if (!f) return '';
    if (f.base) parts.push(f.base.year + ': ' + f.base.label);
    if (f.start && (!f.base || f.start.year !== f.base.year)) parts.push(f.start.year + ': ' + f.start.label);
    if (f.end) parts.push(f.end.year + ': ' + f.end.label);
    if (f.cagr) parts.push('CAGR ' + f.cagr + '%');
    if (f.period) parts.push('forecast period ' + f.period[0] + '-' + f.period[1]);
    return parts.join(' · ');
  }

  function unitTitle(label) { return String(label || '').replace(/\b(trillion|billion|million)\b/i, (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()); }

  function metaFromFigures(kw, f) {
    const lkw = KR.lowerKw(kw);
    const endY = f.end ? f.end.year : (f.period ? f.period[1] : (String(D.period).split('-')[1] || '2033'));
    const titles = [];
    if (f.end) titles.push(kw + ' to Reach ' + unitTitle(f.end.label) + ' by ' + f.end.year);
    if (f.period) titles.push(kw + ' Size, Share & Forecast, ' + f.period[0] + '-' + f.period[1]);
    titles.push(kw + ' Size, Share & Forecast ' + endY);
    titles.push(kw + ' Trends, Growth & Insights ' + endY);
    titles.push(kw + ' Report ' + endY);
    const title = titles.find((x) => x.length <= 60) || titles[titles.length - 1];

    let core = '';
    if (f.base && f.end) core = 'The ' + lkw + ' was valued at ' + f.base.label + ' in ' + f.base.year + ' and is projected to reach ' + f.end.label + ' by ' + f.end.year;
    else if (f.start && f.end) core = 'The ' + lkw + ' is projected to grow from ' + f.start.label + ' in ' + f.start.year + ' to ' + f.end.label + ' by ' + f.end.year;
    else if (f.end) core = 'The ' + lkw + ' is projected to reach ' + f.end.label + ' by ' + f.end.year;
    else if (f.base) core = 'The ' + lkw + ' was valued at ' + f.base.label + ' in ' + f.base.year;
    const withNumbers = [];
    if (core) {
      if (f.cagr && f.period) withNumbers.push(core + ', growing at a CAGR of ' + f.cagr + '% from ' + f.period[0] + ' to ' + f.period[1] + '.');
      if (f.cagr) withNumbers.push(core + ', at a CAGR of ' + f.cagr + '%.');
      withNumbers.push(core + '.');
    } else if (f.cagr) {
      withNumbers.push('The ' + lkw + ' is expected to grow at a CAGR of ' + f.cagr + '%' + (f.period ? ' from ' + f.period[0] + ' to ' + f.period[1] : '') + '.');
    }
    const generic = 'Explore the ' + lkw + ' size, share, growth drivers, segments, regional trends and key companies, with forecasts to ' + endY + '.';
    let desc = withNumbers.find((x) => x.length <= 160) || (withNumbers.length ? withNumbers.slice().sort((a, b) => a.length - b.length)[0] : generic);
    // Too short for Google: add what the report covers.
    const tails = [' Get segment, regional and company insights.', ' Explore segments, regions and key players.', ' See the key trends.'];
    for (const tail of tails) {
      if (desc.length < 140 && (desc + tail).length <= 160) { desc += tail; break; }
    }
    return { title, desc };
  }

  function applyMeta() {
    const f = D.figures || {};
    const m = metaFromFigures(D.keyword, f);
    $('#dmMetaTitle').value = m.title;
    $('#dmMetaDesc').value = m.desc;
    const box = $('#dmFigures');
    const line = figuresLine(f);
    box.textContent = line
      ? 'Figures read from the pasted content: ' + line + '. The meta title and description use these exact numbers. Check them before copying.'
      : 'No market size or CAGR was found in the Overview, so the description has no figures. Check that the Overview was pasted, or type the figures in.';
    box.classList.remove('hidden');
  }

  function imageSize(url) {
    return new Promise((resolve) => {
      const img = new Image();
      const t = setTimeout(() => resolve(null), 8000);
      img.onload = () => { clearTimeout(t); resolve(img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : null); };
      img.onerror = () => { clearTimeout(t); resolve(null); };
      img.src = url;
    });
  }

  async function optimize() {
    const btn = $('#dmOptimize');
    const prog = KR.progress('#dmProgress');
    try {
      const kwRaw = $('#dmKeyword').value.trim();
      if (!kwRaw) throw new Error('Enter the keyword this content is about (for example: Genetic Engineering Market).');
      const keyword = KR.titleCase(kwRaw);
      const pasted = B.extractBlocks($('#dmContent'));
      if (pasted.length < 3) throw new Error('Paste the content first.');
      const inputs = readImageInputs();
      inputs.forEach((x) => { if (!/^https?:\/\//i.test(x.url)) throw new Error('Image URLs must start with https:// (' + x.url + ').'); });
      // Caption lines typed next to the image in the document must not become page text.
      const alts = inputs.map((x) => normCaption(x.alt)).filter(Boolean);
      const raw = pasted.filter((b) => b.kind === 'table' || !isImageCaption(b.text, alts));
      const captions = pasted.length - raw.length;
      KR.busy(btn, true, 'Optimizing…');
      D.keyword = keyword;

      // Headings from the content itself; the standard section names only if the AI cannot answer.
      let levels = null;
      const better = new Map();
      let s = prog.step('AI: choosing the H2 and H3 headings from the content…');
      try {
        const r = await KR.api('dm', 'headings', { keyword, blocks: raw.map(blockSummary) });
        levels = new Map();
        (r.items || []).forEach((x) => {
          levels.set(x.i, x.level);
          if (x.better) better.set(x.i, x.better);
        });
        if (!Array.from(levels.values()).some((v) => v === 'h2')) levels = null;
        D.headingSource = levels ? 'chosen from the content by AI' : 'standard section names, because the AI found no main sections';
        if (levels) s.done('Headings chosen from the content'); else s.fail('The AI found no main sections, so the standard section names were used.');
      } catch (e) {
        levels = null;
        D.headingSource = 'standard section names, because the AI was not available';
        s.fail('AI headings not available (' + e.message + '), so the standard section names were used.');
      }

      s = prog.step('Structuring the content…');
      const units = finalizeUnits(classify(raw, keyword, levels, better), $('#dmStdImgs').checked);
      D.units = units;
      D.links = [];
      const count = (type) => units.filter((u) => u.type === type).length;
      s.done('Structured: ' + count('h2') + ' H2, ' + count('h3') + ' H3, ' + count('ul') + ' lists, ' + count('table') + ' table(s)');
      if (captions) prog.info('Removed ' + captions + ' image caption line' + (captions === 1 ? '' : 's') + ' from the content. The alt text is kept only inside the image.');
      if (!count('table')) prog.info('No segmentation table was detected. Check that the "Market Segmentation" section was pasted.');

      // The figures for the CMS boxes come from the Overview and highlights (or, failing that, the whole text).
      let figures = figuresFrom(figureText());
      if (!hasFigures(figures)) figures = figuresFrom(raw.map((b) => String(b.text || '')).join(' ').slice(0, 20000));
      D.figures = figures;
      const yrs = figureText().match(/\((\d{4})\s*[-\u2013\u2014]\s*(\d{4})\)/);
      D.period = figures.period ? figures.period.join('-') : (yrs ? yrs[1] + '-' + yrs[2] : '2026-2033');

      D.imgs = [];
      if (inputs.length) {
        s = prog.step('Loading ' + inputs.length + ' image' + (inputs.length === 1 ? '' : 's') + '…');
        const dims = await Promise.all(inputs.map((x) => imageSize(x.url)));
        const pos = defaultPositions(units, inputs.length);
        const failed = [];
        inputs.forEach((x, k) => {
          const d = dims[k];
          const w = d ? Math.min(1000, d.w) : 0;
          D.imgs.push({ src: x.url, alt: x.alt || defaultAlt(k, x.url), w, h: d && w ? Math.round(w * d.h / d.w) : 0, pos: pos[k] });
          if (!d) failed.push(x.url);
          if (!/\.(jpe?g|webp|png)(\?|$)/i.test(x.url)) prog.info('Image ' + (k + 1) + ' does not end in .jpg, .webp or .png. Make sure it is an image file.');
        });
        if (failed.length) s.fail(failed.length + ' image(s) did not load in the browser (they are still added to the HTML): ' + failed.join(', '));
        else s.done(inputs.length + ' image' + (inputs.length === 1 ? '' : 's') + ' placed (the first after the Overview). Drag them in Preview to move.');
      } else {
        prog.info('No image URL given, so no images were added.');
      }

      s = prog.step('Loading the Kings Research sitemaps (reports, blogs, press releases)…');
      if (!KR.state.siteLinks) {
        const r = await KR.api('dm', 'links');
        KR.state.siteLinks = r.links.map((x) => ({ url: x[0], kw: x[1], type: x[2] }));
      }
      s.done('Sitemaps: ' + KR.state.siteLinks.length.toLocaleString('en-US') + ' pages');

      const eligibleText = units.filter((u) => u.eligible).map((u) => (u.type === 'ul' ? u.items.map((it) => it.text).join('\n') : u.text)).join('\n\n');
      const candidates = preFilter(eligibleText, keyword, 180);
      if (!candidates.length) prog.info('No related internal pages were found for interlinking.');
      else {
        s = prog.step('AI: choosing internal links from ' + candidates.length + ' related pages…');
        const r = await KR.api('dm', 'interlink', {
          keyword,
          count: Number($('#dmCount').value) || 6,
          content: eligibleText.slice(0, 9000),
          links: candidates.map((l, i) => i + '. [' + l.type.toUpperCase() + '] ' + l.kw).join('\n')
        });
        const seen = new Set();
        const anchors = new Set();
        const lowerText = eligibleText.toLowerCase();
        D.links = (r.suggestions || []).map((x) => {
          const c = candidates[x.id];
          const a = String(x.anchor || '').trim();
          if (!c || !a || seen.has(c.url) || anchors.has(a.toLowerCase()) || lowerText.indexOf(a.toLowerCase()) < 0) return null;
          if (a.toLowerCase().indexOf(keyword.toLowerCase()) >= 0) return null;
          seen.add(c.url);
          anchors.add(a.toLowerCase());
          return { anchor: a, url: c.url, type: c.type, reason: x.reason || '', enabled: true };
        }).filter(Boolean);
        s.done('Internal links: ' + applyLinks(D.units, D.links).applied.length + ' placed');
      }
      applyMeta();
      if (hasFigures(figures)) prog.info('Meta boxes filled from the content: ' + figuresLine(figures) + '.');
      renderDm();
      KR.showSub('dm', 'dm-preview');
      KR.toast('Optimized. Check the headings and move the images if needed, then open "CMS boxes" to copy the meta title, meta description and HTML.', 'ok');
    } catch (e) {
      prog.error(e.message);
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  function moveImage(k, pos) {
    const im = D.imgs[k];
    if (!im) return;
    im.pos = Math.max(0, Math.min(D.units.length, pos));
    renderDm();
  }

  function initPreviewDnD() {
    const box = $('#dmPreview');
    let dragIdx = -1;
    const clearDrop = () => $$('.drop-before, .drop-after', box).forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    box.addEventListener('dragstart', (e) => {
      const blk = e.target.closest ? e.target.closest('.pv-img') : null;
      if (!blk) return;
      dragIdx = Number(blk.getAttribute('data-img'));
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', 'kr-image-' + dragIdx); } catch (err) { /* ignore */ }
    });
    box.addEventListener('dragend', () => { dragIdx = -1; clearDrop(); });
    box.addEventListener('dragover', (e) => {
      if (dragIdx < 0) return;
      const t = e.target.closest('.pv-unit, .pv-end');
      if (!t) return;
      e.preventDefault();
      clearDrop();
      if (t.classList.contains('pv-end')) { t.classList.add('drop-before'); return; }
      const r = t.getBoundingClientRect();
      t.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    });
    box.addEventListener('drop', (e) => {
      if (dragIdx < 0) return;
      const t = e.target.closest('.pv-unit, .pv-end');
      if (!t) return;
      e.preventDefault();
      let i = Number(t.dataset.i);
      if (t.classList.contains('drop-after')) i += 1;
      const k = dragIdx;
      dragIdx = -1;
      clearDrop();
      moveImage(k, i);
    });
    box.addEventListener('click', (e) => {
      const mv = e.target.closest('[data-mv]');
      if (mv) {
        const k = Number(mv.getAttribute('data-img'));
        if (D.imgs[k]) moveImage(k, D.imgs[k].pos + Number(mv.getAttribute('data-mv')));
        return;
      }
      const a = e.target.closest('a[href]');
      if (a) { e.preventDefault(); window.open(a.getAttribute('href'), '_blank', 'noopener'); }
    });
  }

  // More options from the AI. It is given the content's figures and the server drops any option with a number
  // that is not in the content.
  async function aiMeta(btn) {
    try {
      if (!D.units.length) throw new Error('Run Optimize first.');
      KR.busy(btn, true, 'Thinking…');
      const r = await KR.api('dm', 'meta', { keyword: D.keyword, overview: figureText().slice(0, 6000), period: D.period, figures: figuresLine(D.figures) });
      const chips = (list, field) => list.map((t) => '<button class="chip" type="button" data-fill="' + field + '" data-val="' + esc(t) + '">' + esc(t) + '<small>' + t.length + ' chars</small></button>').join('');
      $('#dmMetaSuggest').innerHTML = (r.titles.length ? '<h3>Title options (click to use)</h3><div class="chips">' + chips(r.titles, 'dmMetaTitle') + '</div>' : '') +
        (r.descriptions.length ? '<h3>Description options (click to use)</h3><div class="chips">' + chips(r.descriptions, 'dmMetaDesc') + '</div>' : '') +
        (r.dropped ? '<p class="hint">' + r.dropped + ' AI option(s) were left out because they used a number that is not in the content.</p>' : '') +
        (!r.titles.length && !r.descriptions.length ? '<p class="hint">No AI options passed the figures check. Keep the boxes above, which use the content\'s own figures.</p>' : '');
    } catch (e) {
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  async function saveDm(btn) {
    try {
      KR.requireUser();
      if (!D.units.length) throw new Error('Run Optimize first.');
      const applied = applyLinks(D.units, D.links).applied;
      const words = B.wordCount(D.units.map((u) => (u.items ? u.items.map((i) => i.text).join(' ') : (u.text || ''))).join(' '));
      KR.busy(btn, true, 'Saving…');
      await KR.api('dm', 'save', {
        keyword: D.keyword,
        image: D.imgs.map((im) => im.src).join('\n'),
        alt: D.imgs.map((im) => im.alt).join('\n'),
        metaTitle: $('#dmMetaTitle').value.trim(),
        metaDescription: $('#dmMetaDesc').value.replace(/\s+/g, ' ').trim(),
        interlinks: applied.map((l) => l.anchor + ' -> ' + l.url).join('\n'),
        h2: D.units.filter((u) => u.type === 'h2').length,
        h3: D.units.filter((u) => u.type === 'h3').length,
        words
      });
      KR.toast('Saved to the DM sheet.', 'ok');
    } catch (e) {
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  KR.initDm = () => {
    B.setupPaste($('#dmContent'), 'dmStats');
    $('#dmClear').addEventListener('click', () => B.clearPaste($('#dmContent')));
    addImageRow();
    $('#dmAddImg').addEventListener('click', () => { const row = addImageRow(); $('.dm-img-url', row).focus(); });
    $('#dmImages').addEventListener('click', (e) => {
      const del = e.target.closest('.dm-img-del');
      if (!del) return;
      const rows = $$('#dmImages .dm-img-row');
      const row = del.closest('.dm-img-row');
      if (rows.length <= 1) { $('.dm-img-url', row).value = ''; $('.dm-img-alt', row).value = ''; }
      else row.remove();
      renumberRows();
    });
    $('#dmImages').addEventListener('input', (e) => { if (e.target.classList.contains('dm-img-alt')) syncAlts(); });
    $('#dmOptimize').addEventListener('click', optimize);
    $('#dmLinksTable').addEventListener('change', (e) => {
      const i = e.target.dataset.li;
      if (i === undefined) return;
      D.links[Number(i)].enabled = e.target.checked;
      renderDm();
    });
    const heads = $('#dmHeadings');
    if (heads) {
      heads.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.hlvl !== undefined) setHeading(Number(t.dataset.hlvl), { level: t.value });
        else if (t.dataset.htxt !== undefined) setHeading(Number(t.dataset.htxt), { text: t.value });
      });
      heads.addEventListener('click', (e) => {
        const u = e.target.closest('[data-huse]');
        if (u) {
          const unit = D.units[Number(u.getAttribute('data-huse'))];
          if (unit && unit.better) setHeading(Number(u.getAttribute('data-huse')), { text: unit.better });
          return;
        }
        if (e.target.closest('[data-hall]')) {
          D.units.forEach((unit) => {
            if (unit.isHeading && unit.better) {
              unit.text = unit.better;
              if (unit.type === 'p') unit.html = esc(unit.text);
            }
          });
          renderDm();
        }
      });
    }
    $('#dmMetaTitle').addEventListener('input', updateCounters);
    $('#dmMetaDesc').addEventListener('input', updateCounters);
    $('#dmCopyTitle').addEventListener('click', (e) => KR.copy($('#dmMetaTitle').value.trim(), e.currentTarget));
    $('#dmCopyDesc').addEventListener('click', (e) => KR.copy($('#dmMetaDesc').value.replace(/\s+/g, ' ').trim(), e.currentTarget));
    $('#dmCopyHtml').addEventListener('click', (e) => KR.copy($('#dmSource').value, e.currentTarget));
    $('#dmMetaAi').addEventListener('click', (e) => aiMeta(e.currentTarget));
    $('#dmSave').addEventListener('click', (e) => saveDm(e.currentTarget));
    $('#dmMetaSuggest').addEventListener('click', (e) => {
      const c = e.target.closest('[data-fill]');
      if (!c) return;
      $('#' + c.dataset.fill).value = c.dataset.val;
      updateCounters();
    });
    initPreviewDnD();
    KR.hooks.sub['dm-preview'] = renderDm;
    KR.hooks.sub['dm-source'] = renderDm;
  };
})();
